"""Populate the admin-managed lists of values from the application's own choices.

Safe to re-run: existing rows are left alone unless --refresh-labels is given,
so a label you edited in the admin is never overwritten by accident.

Usage:
    python manage.py seed_lovs
    python manage.py seed_lovs --refresh-labels
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from core.currencies import ISO_4217_CODES
from core.lov import COMMON_CURRENCIES, GROUPS, seed_values
from core.models import ListOfValues


class Command(BaseCommand):
    help = "Seed the admin-managed lists of values (currencies, statuses, categories)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--refresh-labels',
            action='store_true',
            help='Overwrite labels of existing entries with the built-in defaults.',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        refresh = options['refresh_labels']
        created_total = updated_total = 0

        for key, spec in GROUPS.items():
            if key == 'currency':
                values = [c for c in COMMON_CURRENCIES if c[0] in ISO_4217_CODES]
            else:
                values = list(seed_values(key))
            if not values:
                self.stdout.write(self.style.WARNING(f"  {key}: no built-in values"))
                continue

            created = updated = 0
            for order, (code, label) in enumerate(values):
                normalized = code.upper() if spec.normalize_code else code
                existing = ListOfValues.objects.filter(group=key, code=normalized).first()
                if existing:
                    changed = False
                    # Seeded codes are the ones the app itself defines, so they
                    # are system values for non-extendable groups.
                    if existing.is_system != (not spec.extendable):
                        existing.is_system = not spec.extendable
                        changed = True
                    if refresh and existing.label != label:
                        existing.label = label
                        changed = True
                    if changed:
                        existing.save(update_fields=['is_system', 'label', 'updated_at'])
                        updated += 1
                    continue
                ListOfValues.objects.create(
                    group=key,
                    code=normalized,
                    label=label,
                    sort_order=order,
                    is_active=True,
                    is_system=not spec.extendable,
                )
                created += 1

            created_total += created
            updated_total += updated
            kind = 'extendable' if spec.extendable else 'system'
            self.stdout.write(
                f"  {spec.label} ({kind}): {created} added, {updated} updated, "
                f"{len(values)} total"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded lists of values — {created_total} added, {updated_total} updated."
            )
        )
