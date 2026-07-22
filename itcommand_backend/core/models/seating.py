from django.db import models
from django.db.models import JSONField
from .users import User

class Office(models.Model):
    name = models.CharField(max_length=255)
    address = models.TextField()
    floor_count = models.IntegerField(default=1)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

class Floor(models.Model):
    office = models.ForeignKey(Office, on_delete=models.CASCADE, related_name='floors')
    floor_number = models.IntegerField()
    floor_name = models.CharField(max_length=255)
    width_units = models.IntegerField(default=20)
    height_units = models.IntegerField(default=15)

    class Meta:
        ordering = ['floor_number']

    def __str__(self):
        return f"{self.office.name} - {self.floor_name}"

class Seat(models.Model):
    SEAT_TYPES = [
        ('WORKSTATION', 'Workstation'),
        ('CABIN', 'Cabin'),
        ('HOT_DESK', 'Hot Desk'),
        ('MEETING_ROOM', 'Meeting Room'),
        ('DESK', 'Desk'),
        ('ROOM', 'Room'),
        ('STORAGE', 'Storage'),
    ]

    floor = models.ForeignKey(Floor, on_delete=models.CASCADE, related_name='seats')
    seat_code = models.CharField(max_length=50, unique=True)
    seat_type = models.CharField(max_length=20, choices=SEAT_TYPES, default='WORKSTATION')
    grid_x = models.IntegerField(default=0)
    grid_y = models.IntegerField(default=0)
    grid_width = models.IntegerField(default=1)
    grid_height = models.IntegerField(default=1)
    label = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_occupied(self):
        return self.assignments.filter(is_active=True).exists()

    @property
    def current_assignment(self):
        return self.assignments.filter(is_active=True).first()

    def __str__(self):
        return self.seat_code

class SeatAssignment(models.Model):
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('PENDING', 'Pending'),
        ('VACATED', 'Vacated'),
    ]
    CHANGE_TYPE_CHOICES = [
        ('NEW', 'New assignment'),
        ('REPLACE', 'Replace current occupant'),
        ('MOVE', 'Move from another seat'),
        ('VACATE', 'Vacate seat'),
    ]

    seat = models.ForeignKey(Seat, on_delete=models.CASCADE, related_name='assignments')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='seat_assignments')
    assigned_date = models.DateTimeField(auto_now_add=True)
    vacated_date = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='assigned_seats')
    created_at = models.DateTimeField(auto_now_add=True)

    # Pending-change workflow ─────────────────────────────────
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    change_type = models.CharField(max_length=10, choices=CHANGE_TYPE_CHOICES, default='NEW')
    proposed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='proposed_seat_changes',
    )
    proposed_at = models.DateTimeField(null=True, blank=True)
    effective_date = models.DateField(null=True, blank=True)
    from_seat = models.ForeignKey(
        Seat, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pending_move_outs',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['seat'],
                condition=models.Q(is_active=True, status='ACTIVE'),
                name='unique_active_seat_occupant',
            ),
            models.UniqueConstraint(
                fields=['user'],
                condition=models.Q(
                    is_active=True,
                    status='ACTIVE',
                    user__isnull=False,
                ),
                name='unique_active_seat_per_user',
            ),
        ]

    def __str__(self):
        who = self.user.full_name if self.user else 'Unknown'
        return f"{who} -> {self.seat.seat_code} [{self.status}]"


class FloorMapObject(models.Model):
    """A single element on the floor designer canvas.

    Covers both assignable seats (WORKSTATION, CABIN, HOT_DESK, MEETING_ROOM)
    and decorative furniture / structure (DESK, CHAIR, TABLE, WALL, DOOR,
    PLANT, ROOM, TEXT). Coordinates are pixel-based floats so the 2D editor
    and the 3D view share one source of truth.
    """

    OBJECT_TYPES = [
        # Assignable — get a linked Seat so people can be placed on them
        ("WORKSTATION", "Workstation"),
        ("CABIN", "Cabin"),
        ("HOT_DESK", "Hot Desk"),
        ("MEETING_ROOM", "Meeting Room"),
        # Decorative / structural
        ("DESK", "Desk"),
        ("CHAIR", "Chair"),
        ("TABLE", "Table"),
        ("WALL", "Wall"),
        ("DOOR", "Door"),
        ("PLANT", "Plant"),
        ("ROOM", "Room"),
        ("TEXT", "Text"),
        # Amenities
        ("CAFE", "Cafe / Pantry"),
        ("RECEPTION", "Reception"),
        ("PRINTER", "Printer"),
        ("WHITEBOARD", "Whiteboard"),
        # Legacy
        ("SEAT", "Seat"),
    ]

    # Types that carry a linked Seat for assignment (anything a person uses).
    ASSIGNABLE_TYPES = {"WORKSTATION", "CABIN", "HOT_DESK", "MEETING_ROOM",
                        "DESK", "ROOM", "CHAIR", "RECEPTION", "SEAT"}

    floor = models.ForeignKey(Floor, on_delete=models.CASCADE, related_name="map_objects")
    object_type = models.CharField(max_length=20, choices=OBJECT_TYPES)

    # For assignable objects, we link to a real Seat record so assignments work.
    seat = models.OneToOneField(
        Seat,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="map_object",
    )

    x = models.FloatField(default=0)
    y = models.FloatField(default=0)
    width = models.FloatField(default=40)
    height = models.FloatField(default=40)
    rotation = models.FloatField(default=0)
    elevation = models.FloatField(default=0, help_text="Height off the floor for the 3D view")
    z_index = models.IntegerField(default=0)
    locked = models.BooleanField(default=False)
    label = models.CharField(max_length=120, blank=True, default="")
    color = models.CharField(max_length=20, blank=True, default="")
    style = JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["z_index", "id"]

    @property
    def is_assignable(self):
        return self.object_type in self.ASSIGNABLE_TYPES

    def __str__(self):
        return f"{self.object_type} on {self.floor} ({self.id})"
