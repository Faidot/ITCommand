from django.core.management.base import BaseCommand
from core.models import ChecklistTemplate, ChecklistTemplateItem, Office, Floor, Seat

class Command(BaseCommand):
    help = 'Seeds initial data for onboarding and seating modules.'

    def handle(self, *args, **options):
        # 1. Seating Data
        office, created = Office.objects.get_or_create(
            name="Headquarters",
            defaults={
                "address": "123 Main St, Tech City",
                "floor_count": 1,
                "description": "Main corporate office"
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS('Created default Office: Headquarters'))

        floor, created = Floor.objects.get_or_create(
            office=office,
            floor_number=1,
            defaults={
                "floor_name": "Ground Floor",
                "width_units": 20,
                "height_units": 15
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS('Created default Floor: Ground Floor'))
            
            # Create a few default seats in a small grid
            for i in range(1, 6):
                Seat.objects.get_or_create(
                    floor=floor,
                    seat_code=f"HQ-F1-A{i:02d}",
                    defaults={
                        "seat_type": "WORKSTATION",
                        "grid_x": i * 2,
                        "grid_y": 2,
                        "label": f"Desk {i}"
                    }
                )
            self.stdout.write(self.style.SUCCESS('Created default Seats on Ground Floor'))

        # 2. Onboarding Data
        dev_template, created = ChecklistTemplate.objects.get_or_create(
            name="General Developer Onboarding",
            process_type="ONBOARDING",
            defaults={"description": "Standard checklist for new software engineers."}
        )
        if created:
            items = [
                ("Create Google Workspace account", "ACCOUNTS", "IT", 1),
                ("Issue MacBook Pro", "HARDWARE", "IT", 2),
                ("Grant GitHub access", "ACCESS", "MANAGER", 3),
                ("Setup AWS IAM User", "ACCESS", "IT", 4),
                ("Schedule HR orientation", "COMMUNICATION", "HR", 5)
            ]
            for title, category, role, order in items:
                ChecklistTemplateItem.objects.create(
                    template=dev_template,
                    title=title,
                    category=category,
                    assigned_role=role,
                    order=order
                )
            self.stdout.write(self.style.SUCCESS('Created Developer Onboarding Template'))

        offboarding_template, created = ChecklistTemplate.objects.get_or_create(
            name="General Employee Offboarding",
            process_type="OFFBOARDING",
            defaults={"description": "Standard checklist for departing employees."}
        )
        if created:
            items = [
                ("Suspend email account", "ACCOUNTS", "IT", 1),
                ("Collect company laptop", "HARDWARE", "IT", 2),
                ("Revoke VPN and internal access", "SECURITY", "IT", 3),
                ("Conduct exit interview", "COMMUNICATION", "HR", 4)
            ]
            for title, category, role, order in items:
                ChecklistTemplateItem.objects.create(
                    template=offboarding_template,
                    title=title,
                    category=category,
                    assigned_role=role,
                    order=order
                )
            self.stdout.write(self.style.SUCCESS('Created General Offboarding Template'))

        self.stdout.write(self.style.SUCCESS('Seeding complete!'))
