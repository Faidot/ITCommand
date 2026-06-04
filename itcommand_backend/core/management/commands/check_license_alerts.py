from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from core.models import SoftwareLicense, LicenseAlert, User, Notification

class Command(BaseCommand):
    help = 'Check software licenses for expiration and seat capacity, generating alerts and notifications.'

    def handle(self, *args, **options):
        today = timezone.now().date()
        thirty_days = today + timedelta(days=30)
        
        # Get active licenses
        active_licenses = SoftwareLicense.objects.filter(is_active=True)
        
        alerts_created = 0
        
        for license in active_licenses:
            # 1. Check Expiration
            if license.expiry_date:
                if license.expiry_date < today:
                    # Expired
                    alert, created = LicenseAlert.objects.get_or_create(
                        license=license,
                        alert_type='EXPIRED',
                        defaults={'message': f"License for '{license.product.name}' expired on {license.expiry_date}."}
                    )
                    if created:
                        alerts_created += 1
                        self._notify_admins(f"ALERT: License for '{license.product.name}' has EXPIRED.", link=f'/licenses/{license.id}')
                
                elif license.expiry_date <= thirty_days:
                    # Expiring Soon
                    alert, created = LicenseAlert.objects.get_or_create(
                        license=license,
                        alert_type='EXPIRING_SOON',
                        defaults={'message': f"License for '{license.product.name}' will expire on {license.expiry_date}."}
                    )
                    if created:
                        alerts_created += 1
                        self._notify_admins(f"License for '{license.product.name}' is expiring soon ({license.expiry_date}).", link=f'/licenses/{license.id}')

            # 2. Check Seats Capacity
            if license.seats_total is not None and license.seats_total > 0:
                usage_pct = license.seats_usage_pct
                
                if usage_pct >= 100:
                    # Seats Full
                    alert, created = LicenseAlert.objects.get_or_create(
                        license=license,
                        alert_type='SEATS_FULL',
                        defaults={'message': f"License for '{license.product.name}' has reached its seat limit ({license.seats_used}/{license.seats_total})."}
                    )
                    if created:
                        alerts_created += 1
                        self._notify_admins(f"ALERT: License for '{license.product.name}' is out of seats.", link=f'/licenses/{license.id}')
                
                elif usage_pct >= 80:
                    # Near Limit
                    alert, created = LicenseAlert.objects.get_or_create(
                        license=license,
                        alert_type='SEATS_NEAR_LIMIT',
                        defaults={'message': f"License for '{license.product.name}' is nearing seat capacity ({license.seats_used}/{license.seats_total})."}
                    )
                    if created:
                        alerts_created += 1
                        self._notify_admins(f"License for '{license.product.name}' is near seat capacity ({usage_pct}% used).", link=f'/licenses/{license.id}')

        self.stdout.write(self.style.SUCCESS(f'Successfully checked licenses. {alerts_created} new alerts created.'))

    def _notify_admins(self, message, link=None):
        admins = User.objects.filter(role__in=['ADMIN', 'SUPERADMIN'], is_active=True)
        for admin in admins:
            # Check if this exact unread message already exists
            if not Notification.objects.filter(user=admin, message=message, is_read=False).exists():
                Notification.objects.create(
                    user=admin,
                    message=message,
                    notification_type='LICENSE',
                    link=link or '/licenses'
                )
