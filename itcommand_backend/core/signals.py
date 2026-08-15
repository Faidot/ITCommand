"""Signal wiring for the core app.

Kept to cache invalidation. Anything with real behaviour belongs in the view
or the model that owns it, where it can be read alongside the code it affects.
"""
from django.core.signals import request_started
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from core.estate import clear_type_cache
from core.models.system import ListOfValues


@receiver(post_save, sender=ListOfValues)
@receiver(post_delete, sender=ListOfValues)
def _refresh_estate_types(sender, **kwargs):
    """A type added or removed in Settings must take effect immediately.

    Only reaches this process — other Gunicorn workers pick the change up when
    their own cache expires, which is what the short TTL is for.
    """
    clear_type_cache()


@receiver(request_started)
def _reset_type_cache_per_request(sender, **kwargs):
    """Scope the type cache to one request.

    The alternative — caching for the life of the process — meant an edit took
    up to the TTL to reach the other Gunicorn workers, and in tests it survived
    the transaction rollback that removed the row, so one test could leave a
    type visible to the next.

    One query per request rather than one per serialized row is the whole win;
    holding it longer buys almost nothing and costs correctness.
    """
    clear_type_cache()
