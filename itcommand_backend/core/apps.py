from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        _watch_env_in_development()

        # Imported for its side effect: registering the receivers.
        from core import signals  # noqa: F401


def _watch_env_in_development():
    """Reload when .env changes, not only when .py does.

    Settings are read from .env once at import, so editing it changes nothing
    until the process restarts — the app keeps serving the old value while the
    file plainly says otherwise.

    Worth knowing which file: python-decouple walks up from settings.py and
    stops at the FIRST .env it meets, which here is itcommand_backend/.env.
    The repository-root .env is never read. Both are watched so neither can
    quietly go stale.
    """
    from pathlib import Path

    from django.conf import settings

    if not settings.DEBUG:
        return
    try:
        from django.utils.autoreload import autoreload_started

        def watch(sender, **kwargs):
            # `extra_files` is the documented hook; StatReloader has no
            # watch_file(). Guarded inside the handler, because an exception
            # raised during autoreload_started takes the server down with it.
            try:
                for candidate in (Path(settings.BASE_DIR) / ".env",
                                  Path(settings.BASE_DIR).parent / ".env"):
                    if candidate.exists():
                        sender.extra_files.add(candidate)
            except Exception:  # noqa: BLE001
                pass

        autoreload_started.connect(watch, dispatch_uid="core-watch-env")
    except Exception:  # noqa: BLE001
        pass
