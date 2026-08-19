"""Managers that cannot produce an unscoped queryset.

Layer 2 of the four in the blueprint. The point is not that scoping is
enforced -- Postgres RLS does that -- but that forgetting to scope is a loud
runtime error in the first test run rather than a silent leak in production.

    Message.objects.all()                  -> UnscopedQueryError
    Message.objects.for_session(session)   -> the caller's own rows
"""
from __future__ import annotations

from django.db import models


class UnscopedQueryError(RuntimeError):
    """Raised when mail data is queried without saying whose mail it is."""

    def __init__(self, model_name: str):
        super().__init__(
            "%s must be queried through .for_session(...) or .for_mailbox(...). "
            "An unscoped queryset over mail data is always a bug." % model_name
        )


class ScopedQuerySet(models.QuerySet):
    def for_mailbox(self, mailbox):
        mailbox_id = getattr(mailbox, "pk", mailbox)
        return self.filter(mailbox_id=mailbox_id)


class ScopedManager(models.Manager.from_queryset(ScopedQuerySet)):
    """A manager whose default access path is deliberately broken."""

    #: Django itself needs an unscoped queryset for migrations, related-object
    #: descriptors, dumpdata and the admin. Those go through
    #: `unscoped()`, which is grep-able; everything else must scope.
    def get_queryset(self):
        raise UnscopedQueryError(self.model.__name__)

    def unscoped(self) -> ScopedQuerySet:
        """Every caller of this is a place to look during a security review."""
        return ScopedQuerySet(self.model, using=self._db)

    def for_session(self, session) -> ScopedQuerySet:
        """The normal path. `session` is a MailSession, never a request field."""
        if session is None or not getattr(session, "mailbox_id", None):
            raise UnscopedQueryError(self.model.__name__)
        return self.unscoped().filter(mailbox_id=session.mailbox_id)

    def for_mailbox(self, mailbox) -> ScopedQuerySet:
        return self.unscoped().for_mailbox(mailbox)

    # -- writes ------------------------------------------------------------
    #
    # Creating a row means passing `mailbox=` explicitly, so a write is
    # already scoped by construction -- there is no ambiguity for the manager
    # to catch. Only *reads* can silently span mailboxes, so only reads are
    # blocked. Routing these through unscoped() keeps ORM ergonomics intact
    # without weakening anything.

    def create(self, **kwargs):
        return self.unscoped().create(**kwargs)

    def get_or_create(self, defaults=None, **kwargs):
        return self.unscoped().get_or_create(defaults=defaults, **kwargs)

    def update_or_create(self, defaults=None, **kwargs):
        return self.unscoped().update_or_create(defaults=defaults, **kwargs)

    def bulk_create(self, objs, **kwargs):
        return self.unscoped().bulk_create(objs, **kwargs)


class UnscopedManager(models.Manager):
    """For the two models that legitimately have no mailbox scope:
    `Mailbox` itself, and the audit log (which holds no message content and is
    meant to be readable by an administrator)."""
    pass
