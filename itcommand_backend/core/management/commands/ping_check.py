import subprocess
import platform
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from core.models.network import NetworkDevice, NetworkDeviceStatusLog


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

        for device in devices:
            try:
                if platform.system().lower() == 'windows':
                    command = ['ping', '-n', '3', '-w', '2000', str(device.ip_address)]
                else:
                    command = ['ping', '-c', '3', '-W', '2', str(device.ip_address)]
                result = subprocess.run(
                    command,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10
                )
                new_status = 'ONLINE' if result.returncode == 0 else 'OFFLINE'
                old_status = device.status

                with transaction.atomic():
                    device.status = new_status
                    update_fields = ['status']
                    if new_status == 'ONLINE':
                        device.last_seen_online = timezone.now()
                        update_fields.append('last_seen_online')
                    device.save(update_fields=update_fields)

                    if old_status != new_status:
                        NetworkDeviceStatusLog.objects.create(
                            device=device,
                            old_status=old_status,
                            new_status=new_status,
                            note='Automated ping check',
                            changed_by=None,
                        )

                if new_status == 'ONLINE':
                    online += 1
                    self.stdout.write(f"  ✓ {device.device_name} ({device.ip_address}) - ONLINE")
                else:
                    offline += 1
                    self.stdout.write(f"  ✗ {device.device_name} ({device.ip_address}) - OFFLINE")
            except Exception as e:
                errors += 1
                self.stdout.write(f"  ! {device.device_name} ({device.ip_address}) - ERROR: {e}")

        self.stdout.write(self.style.SUCCESS(
            f"\nPing check complete: {online} online, {offline} offline, {errors} errors (of {total} devices)"
        ))
