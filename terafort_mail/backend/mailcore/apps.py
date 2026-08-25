from django.apps import AppConfig


class MailcoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "mailcore"
    verbose_name = "Terafort Mail core"

    def ready(self):
        self._watch_env_in_development()

    @staticmethod
    def _watch_env_in_development():
        """Reload when .env changes, not only when .py does.

        Django's autoreloader watches imported Python files. Settings are read
        from .env once at import, so editing it changes nothing until the
        process restarts — and the app goes on serving the old value while the
        file on disk plainly says otherwise. That gap cost real debugging time
        twice: a route that read as "not found" because a feature flag was
        still false in memory.

        Development only. In production the process is restarted deliberately
        and nothing should be watching files.
        """
        from django.conf import settings

        if not settings.DEBUG:
            return
        try:
            from pathlib import Path

            from django.utils.autoreload import autoreload_started

            def watch(sender, **kwargs):
                # `extra_files` is the documented hook; StatReloader has no
                # watch_file(). The try sits INSIDE the handler because that is
                # where the failure happened — a guard around connect() does
                # not cover the callback, and an exception here is raised
                # during autoreload_started and takes the whole server down.
                try:
                    for candidate in (Path(settings.BASE_DIR).parent / ".env",
                                      Path(settings.BASE_DIR) / ".env"):
                        if candidate.exists():
                            sender.extra_files.add(candidate)
                except Exception:  # noqa: BLE001
                    pass

            autoreload_started.connect(watch, dispatch_uid="mailcore-watch-env")
        except Exception:  # noqa: BLE001 - a convenience must never block boot
            pass
