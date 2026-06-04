from rest_framework import serializers
from core.models.kb import KBCategory, KBArticle, KBTag, KBFeedback


class KBTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = KBTag
        fields = '__all__'
        read_only_fields = ['slug', 'created_at']


class KBCategorySerializer(serializers.ModelSerializer):
    article_count = serializers.SerializerMethodField()
    children = serializers.SerializerMethodField()

    class Meta:
        model = KBCategory
        fields = '__all__'
        read_only_fields = ['slug', 'created_at']

    def get_article_count(self, obj):
        return obj.articles.filter(status='PUBLISHED').count()

    def get_children(self, obj):
        children = obj.children.all()
        return KBCategorySerializer(children, many=True).data


class KBFeedbackSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.full_name', read_only=True, default=None)

    class Meta:
        model = KBFeedback
        fields = '__all__'
        read_only_fields = ['user', 'created_at']


class KBArticleListSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source='author.full_name', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)
    category_slug = serializers.CharField(source='category.slug', read_only=True, default=None)
    tags = KBTagSerializer(many=True, read_only=True)
    feedback_summary = serializers.SerializerMethodField()

    class Meta:
        model = KBArticle
        fields = [
            'id', 'title', 'slug', 'category', 'category_name', 'category_slug',
            'excerpt', 'tags', 'status', 'visibility', 'author', 'author_name',
            'view_count', 'is_pinned', 'feedback_summary', 'created_at', 'updated_at'
        ]

    def get_feedback_summary(self, obj):
        total = obj.feedbacks.count()
        helpful = obj.feedbacks.filter(is_helpful=True).count()
        return {'total': total, 'helpful': helpful}


class KBArticleDetailSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source='author.full_name', read_only=True, default=None)
    last_edited_by_name = serializers.CharField(source='last_edited_by.full_name', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)
    category_slug = serializers.CharField(source='category.slug', read_only=True, default=None)
    tags = KBTagSerializer(many=True, read_only=True)
    tag_ids = serializers.PrimaryKeyRelatedField(many=True, queryset=KBTag.objects.all(), source='tags', write_only=True, required=False)
    feedback_summary = serializers.SerializerMethodField()
    user_feedback = serializers.SerializerMethodField()

    class Meta:
        model = KBArticle
        fields = '__all__'
        read_only_fields = ['slug', 'excerpt', 'view_count', 'author', 'last_edited_by', 'created_at', 'updated_at']

    def get_feedback_summary(self, obj):
        total = obj.feedbacks.count()
        helpful = obj.feedbacks.filter(is_helpful=True).count()
        return {'total': total, 'helpful': helpful}

    def get_user_feedback(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            fb = obj.feedbacks.filter(user=request.user).first()
            if fb:
                return {'is_helpful': fb.is_helpful, 'comment': fb.comment}
        return None
