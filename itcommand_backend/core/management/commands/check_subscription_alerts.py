"""Generate due subscription reminders and budget notifications."""

from django.core.management.base import BaseCommand

from core.subscription_alerts import check_subscription_alerts


class Command(BaseCommand):
    help = (
        "Check subscription renewal, expiry, cancellation, and budget alerts."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report due deliveries without writing alerts or notifications.",
        )

    def handle(self, *args, **options):
        summary = check_subscription_alerts(dry_run=options["dry_run"])
        if summary.disabled:
            self.stdout.write(self.style.WARNING(
                "Subscription notifications are disabled; nothing was sent."
            ))
            return

        if summary.dry_run:
            message = (
                f"Subscription alert dry run: {summary.candidates} due deliveries; "
                f"{summary.alert_logs_created} alert logs and "
                f"{summary.notifications_created} notifications would be created, "
                f"{summary.notifications_updated} notifications would be updated, "
                f"{summary.notifications_retired} obsolete notifications would be retired, "
                f"{summary.unchanged} unchanged."
            )
        else:
            message = (
                f"Subscription alerts: {summary.candidates} due deliveries; "
                f"{summary.alert_logs_created} alert logs created, "
                f"{summary.notifications_created} notifications created, "
                f"{summary.notifications_updated} notifications updated/reopened, "
                f"{summary.notifications_retired} obsolete notifications retired, "
                f"{summary.unchanged} unchanged."
            )
        self.stdout.write(self.style.SUCCESS(message))
