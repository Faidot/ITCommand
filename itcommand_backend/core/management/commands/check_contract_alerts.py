"""Create or refresh vendor-contract notifications for active administrators."""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models.system import Notification
from core.models.users import User
from core.models.vendors import ContractStatus, VendorContract


ALERT_TYPE = "CONTRACT"


class Command(BaseCommand):
    help = "Check vendor contracts for upcoming or past expiry dates."

    def handle(self, *args, **kwargs):
        today = timezone.localdate()
        alert_through = today + timedelta(days=30)

        # A contract can pass its end date without being saved again. Keep its
        # persisted status accurate before creating notifications.
        VendorContract.objects.filter(
            status=ContractStatus.ACTIVE,
            end_date__lt=today,
        ).update(status=ContractStatus.EXPIRED)

        admins = list(User.objects.filter(
            role__in=["ADMIN", "SUPERADMIN"],
            is_active=True,
        ))
        if not admins:
            self.stdout.write(self.style.WARNING("No active admins to notify."))
            return

        contracts = list(
            VendorContract.objects.select_related("vendor").filter(
                status=ContractStatus.ACTIVE,
                end_date__isnull=False,
                end_date__gte=today,
                end_date__lte=alert_through,
            )
        )
        contracts.extend(
            VendorContract.objects.select_related("vendor").filter(
                status=ContractStatus.EXPIRED,
                end_date__isnull=False,
                end_date__lt=today,
            )
        )

        created = updated = unchanged = 0
        for contract in contracts:
            if contract.status == ContractStatus.EXPIRED:
                message = (
                    f"Contract '{contract.title}' with {contract.vendor.name} "
                    f"expired on {contract.end_date} and has not been renewed."
                )
            else:
                message = (
                    f"Contract '{contract.title}' with {contract.vendor.name} "
                    f"expires on {contract.end_date}."
                )

            # The contract id makes this stable even when one vendor has several
            # contracts. Unchanged alerts preserve the user's read state; a new
            # date/status changes the message and reopens the existing alert.
            link = f"/vendors/{contract.vendor_id}?contract={contract.id}"
            for admin in admins:
                result = self._upsert_notification(admin, link, message)
                if result == "created":
                    created += 1
                elif result == "updated":
                    updated += 1
                else:
                    unchanged += 1

        self.stdout.write(self.style.SUCCESS(
            "Contract alerts checked: "
            f"{created} created, {updated} updated/reopened, "
            f"{unchanged} unchanged."
        ))

    @staticmethod
    def _upsert_notification(user, link, message):
        notification = Notification.objects.filter(
            user=user,
            notification_type=ALERT_TYPE,
            link=link,
        ).order_by("id").first()

        if notification is None:
            Notification.objects.create(
                user=user,
                notification_type=ALERT_TYPE,
                message=message,
                link=link,
            )
            return "created"

        if notification.message == message:
            return "unchanged"

        notification.message = message
        notification.is_read = False
        notification.save(update_fields=["message", "is_read"])
        return "updated"
