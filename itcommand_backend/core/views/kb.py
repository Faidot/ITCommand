from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q, Count, Sum, F
from django.utils import timezone
from datetime import timedelta

from core.models.kb import KBCategory, KBArticle, KBTag, KBFeedback
from core.permissions import ReadOnlyViewerOrHigher, HasModulePermission
from core.serializers.kb import (
    KBCategorySerializer, KBArticleListSerializer,
    KBArticleDetailSerializer, KBTagSerializer, KBFeedbackSerializer
)


def visible_to(user, qs):
    """Restrict an article queryset to what `user`'s role is allowed to see.

    VIEWER → All-Staff only. MANAGER → All-Staff + IT-Only. ADMIN/SUPERADMIN →
    everything. Applied everywhere articles surface (list, dashboard, suggest,
    related) so titles/excerpts never leak above a user's clearance.
    """
    role = getattr(user, 'role', None)
    if role == 'VIEWER':
        return qs.filter(visibility='ALL_STAFF')
    if role == 'MANAGER':
        return qs.filter(visibility__in=['ALL_STAFF', 'IT_ONLY'])
    # ADMIN / SUPERADMIN see all
    return qs


class KBCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = KBCategorySerializer
    queryset = KBCategory.objects.filter(parent__isnull=True).order_by('order', 'name')
    permission_classes = [HasModulePermission]
    rbac_module = 'kb'


class KBTagViewSet(viewsets.ModelViewSet):
    serializer_class = KBTagSerializer
    queryset = KBTag.objects.all()
    permission_classes = [HasModulePermission]
    rbac_module = 'kb'

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(name__icontains=search)
        return qs


class KBArticleViewSet(viewsets.ModelViewSet):
    queryset = KBArticle.objects.all()
    lookup_field = 'slug'
    permission_classes = [HasModulePermission]
    rbac_module = 'kb'

    def get_permissions(self):
        # Feedback is a normal-user action (thumbs up/down), so any authenticated
        # user may POST it even though they can't author articles.
        if self.action == 'feedback':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return KBArticleDetailSerializer
        if self.action in ['create', 'update', 'partial_update']:
            return KBArticleDetailSerializer
        return KBArticleListSerializer

    def get_queryset(self):
        qs = visible_to(self.request.user, super().get_queryset())

        # Filters
        cat = self.request.query_params.get('category')
        if cat:
            qs = qs.filter(Q(category__slug=cat) | Q(category__id=cat))

        st = self.request.query_params.get('status')
        if st:
            qs = qs.filter(status=st)
        elif self.action == 'list':
            # Default to published for list unless explicitly filtered
            if not self.request.query_params.get('include_drafts'):
                qs = qs.filter(status='PUBLISHED')

        vis = self.request.query_params.get('visibility')
        if vis:
            qs = qs.filter(visibility=vis)

        tag = self.request.query_params.get('tag')
        if tag:
            qs = qs.filter(tags__slug=tag)

        pinned = self.request.query_params.get('is_pinned')
        if pinned == 'true':
            qs = qs.filter(is_pinned=True)

        author = self.request.query_params.get('author')
        if author:
            qs = qs.filter(author_id=author)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(content__icontains=search) | Q(tags__name__icontains=search)).distinct()

        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def perform_create(self, serializer):
        serializer.save(author=self.request.user, last_edited_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(last_edited_by=self.request.user)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        # Increment view count atomically (avoids a read-modify-write race).
        KBArticle.objects.filter(pk=instance.pk).update(view_count=F('view_count') + 1)
        instance.refresh_from_db()
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='history')
    def version_history(self, request, slug=None):
        article = self.get_object()
        history = article.history.all()
        data = [{
            'history_id': h.history_id,
            'title': h.title,
            'status': h.status,
            'history_date': h.history_date,
            'history_user': h.history_user.full_name if h.history_user else 'Unknown',
            'history_type': h.history_type,
        } for h in history]
        return Response(data)

    @action(detail=True, methods=['post'], url_path='restore/(?P<version_id>[^/.]+)')
    def restore_version(self, request, slug=None, version_id=None):
        article = self.get_object()
        try:
            historical = article.history.get(history_id=version_id)
        except article.history.model.DoesNotExist:
            return Response({'error': 'Version not found'}, status=status.HTTP_404_NOT_FOUND)

        article.title = historical.title
        article.content = historical.content
        article.status = historical.status
        article.visibility = historical.visibility
        article.category_id = historical.category_id
        article.last_edited_by = request.user
        article.save()
        return Response(KBArticleDetailSerializer(article, context={'request': request}).data)

    @action(detail=True, methods=['get'])
    def related(self, request, slug=None):
        """Up to 5 published articles sharing a tag or category with this one,
        respecting the viewer's visibility clearance."""
        article = self.get_object()
        qs = visible_to(request.user, KBArticle.objects.filter(status='PUBLISHED')).exclude(pk=article.pk)
        related = qs.filter(
            Q(tags__in=article.tags.all()) | Q(category=article.category)
        ).annotate(
            shared=Count('tags', filter=Q(tags__in=article.tags.all()))
        ).distinct().order_by('-shared', '-view_count')[:5]
        return Response(KBArticleListSerializer(related, many=True).data)

    @action(detail=True, methods=['post', 'get'], url_path='feedback')
    def feedback(self, request, slug=None):
        article = self.get_object()
        if request.method == 'GET':
            fbs = article.feedbacks.all()
            return Response(KBFeedbackSerializer(fbs, many=True).data)

        is_helpful = request.data.get('is_helpful')
        comment = request.data.get('comment', '')
        if is_helpful is None:
            return Response({'error': 'is_helpful required'}, status=status.HTTP_400_BAD_REQUEST)

        fb, created = KBFeedback.objects.update_or_create(
            article=article, user=request.user,
            defaults={'is_helpful': is_helpful, 'comment': comment}
        )
        return Response(KBFeedbackSerializer(fb).data)


class KBDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        now = timezone.now()
        ninety_days_ago = now - timedelta(days=90)

        # Only surface articles this user is cleared to see.
        published = visible_to(request.user, KBArticle.objects.filter(status='PUBLISHED'))

        most_viewed = KBArticleListSerializer(
            published.order_by('-view_count')[:10], many=True
        ).data

        recently_updated = KBArticleListSerializer(
            published.order_by('-updated_at')[:10], many=True
        ).data

        needs_review = KBArticleListSerializer(
            published.filter(updated_at__lt=ninety_days_ago).order_by('updated_at')[:10], many=True
        ).data

        return Response({
            'total_articles': published.count(),
            'total_categories': KBCategory.objects.count(),
            'total_views': published.aggregate(v=Sum('view_count'))['v'] or 0,
            'most_viewed_articles': most_viewed,
            'recently_updated': recently_updated,
            'articles_needing_review': needs_review,
        })


class KBSuggestView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        cat_id = request.query_params.get('ticket_category_id')
        if not cat_id:
            return Response([])
        articles = visible_to(request.user, KBArticle.objects.filter(
            linked_tickets_category_id=cat_id, status='PUBLISHED'
        )).order_by('-view_count')[:5]
        return Response(KBArticleListSerializer(articles, many=True).data)
