"""The complete route table.

Worth reading as a whole: there is no path parameter anywhere that names a
mailbox, an account or a user. `message_id` is our own UUID and is always
looked up with the session's mailbox in the filter.
"""
from django.urls import path

from . import internal, views, views_compose, views_files, views_mail

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
    path("api/sync", views_mail.sync_view, name="mail_sync"),
    path("api/messages", views_mail.messages_view, name="mail_messages"),
    path("api/search", views_mail.search_view, name="mail_search"),
    path("api/messages/<uuid:message_id>/body", views_mail.message_body_view,
         name="mail_message_body"),
    path("api/messages/<uuid:message_id>/flag", views_mail.flag_view,
         name="mail_message_flag"),
    path("api/messages/<uuid:message_id>/load-images", views_mail.load_images_view,
         name="mail_message_images"),
    path("api/messages/<uuid:message_id>/report-phishing",
         views_mail.report_phishing_view, name="mail_message_phish"),
    path("api/threads/<uuid:thread_id>", views_mail.thread_view, name="mail_thread"),

    # bytes that came from a message. Both harden their responses; see
    # views_files for why neither is ever served inline.
    path("api/proxy/image", views_files.image_proxy_view, name="mail_image_proxy"),
    path("api/messages/<uuid:message_id>/attachments/<int:index>",
         views_files.attachment_view, name="mail_attachment"),

    # composing
    path("api/compose/send", views_compose.send_view, name="mail_send"),
    path("api/compose/undo", views_compose.undo_view, name="mail_undo"),
    path("api/outbox", views_compose.outbox_view, name="mail_outbox"),
    path("api/outbox/flush", views_compose.flush_view, name="mail_outbox_flush"),
    path("api/messages/<uuid:message_id>/reply", views_compose.reply_view,
         name="mail_reply"),
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
    path("internal/v1/break-glass", internal.InternalBreakGlassView.as_view(),
         name="mail_internal_break_glass"),

    # ops
    path("api/probe", views.probe_view, name="mail_probe"),
]
