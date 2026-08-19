"""The complete route table.

Worth reading as a whole: there is no path parameter anywhere that names a
mailbox, an account or a user. `message_id` is our own UUID and is always
looked up with the session's mailbox in the filter.
"""
from django.urls import path

from . import internal, views

urlpatterns = [
    # authentication
    path("api/auth/login", views.LoginView.as_view(), name="mail_login"),
    path("api/auth/mfa", views.MfaView.as_view(), name="mail_mfa"),
    path("api/auth/logout", views.logout_view, name="mail_logout"),
    path("api/me", views.me_view, name="mail_me"),

    # the cross-origin landing point for the IT Command button
    path("auth/handoff", views.handoff_view, name="mail_handoff"),

    # scoped mail data
    path("api/folders", views.folders_view, name="mail_folders"),
    path("api/messages/<uuid:message_id>", views.message_view, name="mail_message"),
    path("api/messages/<uuid:message_id>/archive", views.message_archive_view,
         name="mail_message_archive"),

    # service-to-service. Not reachable with a session cookie; see internal.py.
    path("internal/v1/auth/login", internal.InternalLoginView.as_view(),
         name="mail_internal_login"),
    path("internal/v1/auth/mfa", internal.InternalMfaView.as_view(),
         name="mail_internal_mfa"),
    path("internal/v1/auth/session", internal.InternalSessionView.as_view(),
         name="mail_internal_session"),

    # ops
    path("api/probe", views.probe_view, name="mail_probe"),
]
