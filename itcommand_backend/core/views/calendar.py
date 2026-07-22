from django.db.models import F
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.calendar_feed import build_ics
from core.models import CalendarFeedToken


def _site_url(request):
    """Absolute base for links inside events (the SPA, not the API)."""
    return f"{request.scheme}://{request.get_host()}"


class CalendarFeedView(APIView):
    """Serve one person's .ics feed.

    Deliberately unauthenticated: calendar clients cannot present a JWT, so
    the unguessable token in the URL is the credential. It is scoped to a
    single user, reveals only what their role may view, and can be rotated
    from Settings the moment it leaks.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request, token):
        feed = (
            CalendarFeedToken.objects.filter(token=token, is_enabled=True)
            .select_related("user")
            .first()
        )
        if not feed or not feed.user.is_active:
            # Same answer for "wrong token" and "disabled", so the endpoint
            # cannot be used to probe which tokens exist.
            return HttpResponse("Not found", status=status.HTTP_404_NOT_FOUND)

        body = build_ics(
            feed.user,
            sources=feed.selected_sources(),
            site_url=_site_url(request),
        )

        CalendarFeedToken.objects.filter(pk=feed.pk).update(
            last_accessed_at=timezone.now(), access_count=F("access_count") + 1
        )

        response = HttpResponse(body, content_type="text/calendar; charset=utf-8")
        response["Content-Disposition"] = 'inline; filename="itcommand.ics"'
        response["Cache-Control"] = "private, max-age=900"
        return response


class MyCalendarFeedView(APIView):
    """Let the signed-in user see, configure, rotate or disable their feed."""

    permission_classes = [permissions.IsAuthenticated]

    def _payload(self, request, feed):
        return {
            "is_enabled": feed.is_enabled,
            "url": request.build_absolute_uri(f"/api/calendar/{feed.token}.ics"),
            "include": feed.selected_sources(),
            "available_sources": [
                {"key": key, "label": label, "module": module}
                for key, label, module in CalendarFeedToken.SOURCES
            ],
            "last_accessed_at": feed.last_accessed_at,
            "access_count": feed.access_count,
        }

    def _feed_for(self, user):
        feed, _ = CalendarFeedToken.objects.get_or_create(
            user=user, defaults={"include": CalendarFeedToken.DEFAULT_SOURCES}
        )
        return feed

    def get(self, request):
        return Response(self._payload(request, self._feed_for(request.user)))

    def patch(self, request):
        feed = self._feed_for(request.user)
        if "is_enabled" in request.data:
            feed.is_enabled = bool(request.data["is_enabled"])
        if "include" in request.data:
            requested = request.data.get("include") or []
            if not isinstance(requested, list):
                return Response(
                    {"detail": "include must be a list."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            feed.include = [
                source for source in requested if source in CalendarFeedToken.DEFAULT_SOURCES
            ]
        feed.save()
        return Response(self._payload(request, feed))

    def post(self, request):
        """Rotate the token, invalidating the previous URL immediately."""
        feed = self._feed_for(request.user)
        feed.rotate()
        return Response(self._payload(request, feed))
