"""Run ITCommand's recurring maintenance tasks in a long-lived process.

The Docker ``automation`` service runs this command. Daily/monthly completion
markers are persisted in ``AppSettings`` so container restarts do not duplicate
successful work. Use ``--once`` for a one-shot operational check.
"""

import time
from datetime import timedelta

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models.system import AppSettings


class Command(BaseCommand):
    help = (
        "Run scheduled finance, license, subscription, contract, email, "
        "and network automation."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--once",
            action="store_true",
            help="Run tasks that are due now, then exit.",
        )
        parser.add_argument(
            "--poll-seconds",
            type=int,
            default=None,
            help="Override AUTOMATION_POLL_SECONDS for this process.",
        )

    def handle(self, *args, **options):
        poll_seconds = options["poll_seconds"] or settings.AUTOMATION_POLL_SECONDS
        poll_seconds = max(10, poll_seconds)
        retry_after = {}
        last_interval_run = {}
        last_ping_at = None

        self.stdout.write(self.style.SUCCESS(
            "Automation runner started "
            f"(poll={poll_seconds}s, timezone={settings.TIME_ZONE})."
        ))

        while True:
            now = timezone.now()
            local_now = timezone.localtime(now)
            failures = []
            interval_commands = set(settings.AUTOMATION_INTERVAL_COMMANDS)

            for command_name in settings.AUTOMATION_DAILY_COMMANDS:
                # An interval command may still be present in an existing
                # deployment's daily configuration. Run it only on its short,
                # independent cadence so it is not duplicated in this loop.
                if command_name in interval_commands:
                    continue
                marker = local_now.date().isoformat()
                if self._marker_value(command_name) == marker:
                    continue
                if not self._retry_due(command_name, now, retry_after):
                    continue
                if self._run(command_name):
                    self._set_marker(command_name, marker)
                else:
                    failures.append(command_name)
                    retry_after[command_name] = now + timedelta(
                        seconds=settings.AUTOMATION_RETRY_SECONDS
                    )

            for command_name in settings.AUTOMATION_INTERVAL_COMMANDS:
                last_run = last_interval_run.get(command_name)
                if (
                    last_run is not None
                    and (now - last_run).total_seconds()
                    < settings.AUTOMATION_INTERVAL_SECONDS
                ):
                    continue
                if not self._retry_due(command_name, now, retry_after):
                    continue
                if self._run(command_name):
                    last_interval_run[command_name] = now
                    retry_after.pop(command_name, None)
                else:
                    failures.append(command_name)
                    retry_after[command_name] = now + timedelta(
                        seconds=settings.AUTOMATION_RETRY_SECONDS
                    )

            if (
                settings.AUTOMATION_EMAIL_REPORT_ENABLED
                and local_now.day >= settings.FINANCE_REPORT_DAY
            ):
                command_name = "email_finance_report"
                marker = local_now.strftime("%Y-%m")
                if (
                    self._marker_value(command_name) != marker
                    and self._retry_due(command_name, now, retry_after)
                ):
                    if self._run(command_name):
                        self._set_marker(command_name, marker)
                    else:
                        failures.append(command_name)
                        retry_after[command_name] = now + timedelta(
                            seconds=settings.AUTOMATION_RETRY_SECONDS
                        )

            if settings.AUTOMATION_PING_ENABLED:
                ping_due = (
                    last_ping_at is None
                    or (now - last_ping_at).total_seconds()
                    >= settings.PING_CHECK_INTERVAL_SECONDS
                )
                if ping_due and self._retry_due("ping_check", now, retry_after):
                    if self._run("ping_check"):
                        last_ping_at = now
                    else:
                        failures.append("ping_check")
                        retry_after["ping_check"] = now + timedelta(
                            seconds=settings.AUTOMATION_RETRY_SECONDS
                        )

            if options["once"]:
                if failures:
                    raise CommandError(
                        "Automation task(s) failed: " + ", ".join(sorted(set(failures)))
                    )
                return

            time.sleep(poll_seconds)

    def _run(self, command_name):
        self.stdout.write(f"==> Running {command_name}")
        try:
            call_command(command_name, stdout=self.stdout, stderr=self.stderr)
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"{command_name} failed: {exc}"))
            return False
        return True

    @staticmethod
    def _retry_due(command_name, now, retry_after):
        return command_name not in retry_after or now >= retry_after[command_name]

    @staticmethod
    def _marker_key(command_name):
        return f"automation.{command_name}.last_success"

    def _marker_value(self, command_name):
        return AppSettings.objects.filter(
            key=self._marker_key(command_name)
        ).values_list("value", flat=True).first()

    def _set_marker(self, command_name, value):
        AppSettings.objects.update_or_create(
            key=self._marker_key(command_name),
            defaults={
                "value": value,
                "description": f"Last successful automated run of {command_name}.",
            },
        )
