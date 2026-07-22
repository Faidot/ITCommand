from django.db import migrations, models
from django.db.models import Count
from django.utils import timezone


def remove_duplicate_active_assignments(apps, schema_editor):
    LicenseAssignment = apps.get_model('core', 'LicenseAssignment')
    SeatAssignment = apps.get_model('core', 'SeatAssignment')
    now = timezone.now()

    duplicate_licenses = (
        LicenseAssignment.objects.filter(is_active=True)
        .values('license_id', 'user_id')
        .annotate(total=Count('id'))
        .filter(total__gt=1)
    )
    for group in duplicate_licenses.iterator():
        rows = LicenseAssignment.objects.filter(
            is_active=True,
            license_id=group['license_id'],
            user_id=group['user_id'],
        ).order_by('-assigned_date', '-id')
        keep = rows.first()
        rows.exclude(pk=keep.pk).update(is_active=False, revoked_date=now)

    for field in ('seat_id', 'user_id'):
        duplicates = (
            SeatAssignment.objects.filter(is_active=True, status='ACTIVE')
            .exclude(**{field: None})
            .values(field)
            .annotate(total=Count('id'))
            .filter(total__gt=1)
        )
        for group in duplicates.iterator():
            rows = SeatAssignment.objects.filter(
                is_active=True,
                status='ACTIVE',
                **{field: group[field]},
            ).order_by('-assigned_date', '-id')
            keep = rows.first()
            rows.exclude(pk=keep.pk).update(
                is_active=False,
                status='VACATED',
                vacated_date=now,
            )


class Migration(migrations.Migration):
    dependencies = [('core', '0041_asset_source_purchase_request_item')]

    operations = [
        migrations.RunPython(
            remove_duplicate_active_assignments,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name='licenseassignment',
            constraint=models.UniqueConstraint(
                fields=('license', 'user'),
                condition=models.Q(is_active=True),
                name='unique_active_license_assignment',
            ),
        ),
        migrations.AddConstraint(
            model_name='seatassignment',
            constraint=models.UniqueConstraint(
                fields=('seat',),
                condition=models.Q(is_active=True, status='ACTIVE'),
                name='unique_active_seat_occupant',
            ),
        ),
        migrations.AddConstraint(
            model_name='seatassignment',
            constraint=models.UniqueConstraint(
                fields=('user',),
                condition=models.Q(
                    is_active=True,
                    status='ACTIVE',
                    user__isnull=False,
                ),
                name='unique_active_seat_per_user',
            ),
        ),
    ]
