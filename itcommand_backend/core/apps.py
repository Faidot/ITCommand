from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # Imported for its side effect: registering the receivers.
        from core import signals  # noqa: F401
