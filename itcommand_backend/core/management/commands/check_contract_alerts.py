from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from core.models.vendors import VendorContract
from core.models.notifications import Notification
from core.models.users import User

class Command(BaseCommand):
    help = 'Checks for vendor contracts expiring soon or already expired and generates notifications'

    def handle(self, *args, **kwargs):
        now = timezone.now().date()
        thirty_days_later = now + timedelta(days=30)
        
        # Get admin users to notify
        admins = User.objects.filter(role__in=['ADMIN', 'SUPERADMIN'], is_active=True)
        if not admins.exists():
            self.stdout.write(self.style.WARNING("No active admins to notify."))
            return

        # 1. Check for Expiring Contracts (within 30 days)
        expiring_contracts = VendorContract.objects.filter(
            status='ACTIVE',
            end_date__isnull=False,
            end_date__lte=thirty_days_later,
            end_date__gt=now
        )

        for contract in expiring_contracts:
            days_left = (contract.end_date - now).days
            message = f"Contract '{contract.title}' with {contract.vendor.name} is expiring in {days_left} days ({contract.end_date})."
            
            # Check if notification already exists recently to avoid spam
            recent_notif = Notification.objects.filter(
                title__contains=contract.contract_number,
                message=message,
                created_at__gte=timezone.now() - timedelta(days=7)
            ).exists()
            
            if not recent_notif:
                for admin in admins:
                    Notification.objects.create(
                        user=admin,
                        title=f"Contract Expiring Soon: {contract.contract_number}",
                        message=message,
                        type='WARNING',
                        link=f"/vendors/{contract.vendor.id}"
                    )
                self.stdout.write(self.style.SUCCESS(f"Notified admins about expiring contract: {contract.contract_number}"))


        # 2. Check for Expired Contracts
        # Note: The model's save method auto-updates status to EXPIRED if end_date < today
        # But for ones already marked EXPIRED, we might want to alert if not renewed.
        # We will just alert for newly expired ones (expired within the last 7 days)
        recently_expired = VendorContract.objects.filter(
            status='EXPIRED',
            end_date__isnull=False,
            end_date__gte=now - timedelta(days=7),
            end_date__lte=now
        )

        for contract in recently_expired:
            message = f"Contract '{contract.title}' with {contract.vendor.name} has expired on {contract.end_date} and is not renewed."
            
            recent_notif = Notification.objects.filter(
                title__contains=contract.contract_number,
                message=message,
                created_at__gte=timezone.now() - timedelta(days=3)
            ).exists()
            
            if not recent_notif:
                for admin in admins:
                    Notification.objects.create(
                        user=admin,
                        title=f"Contract Expired: {contract.contract_number}",
                        message=message,
                        type='ERROR',
                        link=f"/vendors/{contract.vendor.id}"
                    )
                self.stdout.write(self.style.SUCCESS(f"Notified admins about expired contract: {contract.contract_number}"))

        self.stdout.write(self.style.SUCCESS("Successfully checked contract alerts."))
