import subprocess
import platform
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models.network import NetworkDevice


class Command(BaseCommand):
    help = 'Ping all network devices with IP addresses and update their status'

    def handle(self, *args, **options):
        devices = NetworkDevice.objects.filter(
            ip_address__isnull=False
        ).exclude(
            status__in=['DECOMMISSIONED', 'MAINTENANCE']
        )

        total = devices.count()
        online = 0
        offline = 0
        errors = 0

        param = '-n' if platform.system().lower() == 'windows' else '-c'

        for device in devices:
            try:
                result = subprocess.run(
                    ['ping', param, '3', '-W', '2', str(device.ip_address)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10
                )
                if result.returncode == 0:
                    device.status = 'ONLINE'
                    device.last_seen_online = timezone.now()
                    device.save(update_fields=['status', 'last_seen_online'])
                    online += 1
                    self.stdout.write(f"  ✓ {device.device_name} ({device.ip_address}) - ONLINE")
                else:
                    device.status = 'OFFLINE'
                    device.save(update_fields=['status'])
                    offline += 1
                    self.stdout.write(f"  ✗ {device.device_name} ({device.ip_address}) - OFFLINE")
            except Exception as e:
                errors += 1
                self.stdout.write(f"  ! {device.device_name} ({device.ip_address}) - ERROR: {e}")

        self.stdout.write(self.style.SUCCESS(
            f"\nPing check complete: {online} online, {offline} offline, {errors} errors (of {total} devices)"
        ))
