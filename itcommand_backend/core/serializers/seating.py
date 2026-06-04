from rest_framework import serializers
from core.models import Office, Floor, Seat, SeatAssignment, FloorMapObject
from .users import UserSerializer

class OfficeSerializer(serializers.ModelSerializer):
    floor_count = serializers.SerializerMethodField()
    seat_count = serializers.SerializerMethodField()
    occupied_count = serializers.SerializerMethodField()
    pending_count = serializers.SerializerMethodField()

    class Meta:
        model = Office
        fields = '__all__'

    def get_floor_count(self, obj):
        return obj.floors.count()

    def get_seat_count(self, obj):
        from core.models import Seat
        return Seat.objects.filter(floor__office=obj).count()

    def get_occupied_count(self, obj):
        return SeatAssignment.objects.filter(
            seat__floor__office=obj, is_active=True, status='ACTIVE',
        ).count()

    def get_pending_count(self, obj):
        return SeatAssignment.objects.filter(
            seat__floor__office=obj, status='PENDING',
        ).count()

class FloorSerializer(serializers.ModelSerializer):
    office_name = serializers.CharField(source='office.name', read_only=True)
    
    class Meta:
        model = Floor
        fields = '__all__'

class SeatAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.full_name', read_only=True, default=None)
    user_avatar = serializers.CharField(source='user.avatar', read_only=True, default=None)
    user_department = serializers.CharField(source='user.department.name', read_only=True, default=None)
    user_email = serializers.CharField(source='user.email', read_only=True, default=None)
    user_designation = serializers.CharField(source='user.designation', read_only=True, default=None)
    user_assets = serializers.SerializerMethodField(read_only=True)
    # Pending-change extras
    seat_code = serializers.CharField(source='seat.seat_code', read_only=True)
    seat_floor_name = serializers.CharField(source='seat.floor.floor_name', read_only=True, default=None)
    seat_floor_id = serializers.IntegerField(source='seat.floor.id', read_only=True, default=None)
    seat_office_id = serializers.IntegerField(source='seat.floor.office.id', read_only=True, default=None)
    from_seat_code = serializers.CharField(source='from_seat.seat_code', read_only=True, default=None)
    proposed_by_name = serializers.CharField(source='proposed_by.full_name', read_only=True, default=None)
    current_occupant_name = serializers.SerializerMethodField()

    class Meta:
        model = SeatAssignment
        fields = '__all__'

    def get_current_occupant_name(self, obj):
        """For pending REPLACE: who's sitting there now?"""
        if obj.status != 'PENDING':
            return None
        cur = SeatAssignment.objects.filter(
            seat=obj.seat, is_active=True, status='ACTIVE',
        ).first()
        return cur.user.full_name if (cur and cur.user) else None

    def get_user_assets(self, obj):
        """Brief list of assets assigned to this user — for the hover tooltip
        in the seating plan. Only included for ACTIVE assignments."""
        if not obj.user_id or not obj.is_active:
            return []
        from core.models import Asset
        return [
            {
                'id': a.id,
                'asset_tag': a.asset_tag,
                'name': a.name,
                'category': a.category.name if a.category_id else None,
                'serial_number': a.serial_number or '',
                'status': a.status,
            }
            for a in Asset.objects
                .filter(assigned_to_id=obj.user_id)
                .select_related('category')
                .only('id', 'asset_tag', 'name', 'serial_number', 'status', 'category__name')[:12]
        ]

class SeatSerializer(serializers.ModelSerializer):
    is_occupied = serializers.ReadOnlyField()
    current_assignment = SeatAssignmentSerializer(read_only=True)
    
    class Meta:
        model = Seat
        fields = '__all__'


class FloorMapObjectSerializer(serializers.ModelSerializer):
    seat_code = serializers.CharField(source="seat.seat_code", read_only=True, default=None)
    is_occupied = serializers.BooleanField(source="seat.is_occupied", read_only=True, default=False)
    is_assignable = serializers.BooleanField(read_only=True)
    current_assignment = SeatAssignmentSerializer(source="seat.current_assignment", read_only=True, default=None)

    class Meta:
        model = FloorMapObject
        fields = "__all__"
