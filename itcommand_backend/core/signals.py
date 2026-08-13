"""Signal wiring for the core app.

Kept to cache invalidation. Anything with real behaviour belongs in the view
or the model that owns it, where it can be read alongside the code it affects.
"""
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
