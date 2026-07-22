from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone
from django.db import transaction
from core.models import Office, Floor, Seat, SeatAssignment, User, FloorMapObject
from core.serializers.seating import (
    OfficeSerializer,
    FloorSerializer,
    SeatSerializer,
    SeatAssignmentSerializer,
    FloorMapObjectSerializer,
)
from core.permissions import IsAdminOrSuperadmin, HasModulePermission, has_role_permission


# ───────────────────────── Layout helpers ─────────────────────────

def _unique_seat_code(floor, preferred=None):
    """Return a seat_code that is globally unique."""
    base = (preferred or f"S{floor.id}-{floor.seats.count() + 1}").strip()
    code = base or f"S{floor.id}-1"
    i = 1
    while Seat.objects.filter(seat_code=code).exists():
        code = f"{base}-{i}"
        i += 1
    return code


def _sync_seat(obj, seat_code=None):
    """Keep the linked Seat in sync with an assignable FloorMapObject.

    Assignable objects get a Seat (so people can be assigned). Non-assignable
    objects drop any Seat they previously had.
    """
    if obj.object_type in FloorMapObject.ASSIGNABLE_TYPES:
        valid_seat_types = {c[0] for c in Seat.SEAT_TYPES}
        seat_type = obj.object_type if obj.object_type in valid_seat_types else 'WORKSTATION'
        if obj.seat_id:
            seat = obj.seat
            seat.seat_type = seat_type
            seat.label = obj.label or ''
            if seat_code and seat_code != seat.seat_code and \
                    not Seat.objects.filter(seat_code=seat_code).exclude(id=seat.id).exists():
                seat.seat_code = seat_code
            seat.save()
        else:
            seat = Seat.objects.create(
                floor=obj.floor,
                seat_code=_unique_seat_code(obj.floor, seat_code),
                seat_type=seat_type,
                grid_x=0, grid_y=0,
                label=obj.label or '',
            )
            obj.seat = seat
            obj.save(update_fields=['seat'])
    elif obj.seat_id:
        old = obj.seat
        obj.seat = None
        obj.save(update_fields=['seat'])
        old.delete()


class OfficeViewSet(viewsets.ModelViewSet):
    queryset = Office.objects.all()
    serializer_class = OfficeSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'seating'

    @action(detail=True, methods=['get'])
    def floors(self, request, pk=None):
        office = self.get_object()
        floors = office.floors.all()
        return Response(FloorSerializer(floors, many=True).data)

class FloorViewSet(viewsets.ModelViewSet):
    queryset = Floor.objects.all()
    serializer_class = FloorSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'seating'

    @action(detail=True, methods=['get'])
    def layout(self, request, pk=None):
        """Full designer payload: the floor + every canvas object + legacy seats."""
        floor = self.get_object()
        objects = floor.map_objects.select_related('seat').all()
        seats = floor.seats.all()
        return Response({
            'floor': FloorSerializer(floor).data,
            'objects': FloorMapObjectSerializer(objects, many=True).data,
            'seats': SeatSerializer(seats, many=True).data,
        })

    @action(detail=True, methods=['post'])
    def save_layout(self, request, pk=None):
        """Bulk-persist the whole canvas in one request.

        Body: { "objects": [ {id?, object_type, x, y, width, height,
                rotation, elevation, z_index, locked, label, color,
                style, seat_code?}, ... ] }

        Objects with a positive integer `id` are updated; others are created.
        Objects no longer present are deleted (along with their linked seats).
        """
        floor = self.get_object()
        incoming = request.data.get('objects', [])
        if not isinstance(incoming, list):
            return Response({'detail': 'objects must be a list'},
                            status=status.HTTP_400_BAD_REQUEST)

        keep_ids = set()
        for item in incoming:
            oid = item.get('id')
            fields = dict(
                object_type=item.get('object_type', 'WORKSTATION'),
                x=item.get('x', 0) or 0,
                y=item.get('y', 0) or 0,
                width=item.get('width', 40) or 40,
                height=item.get('height', 40) or 40,
                rotation=item.get('rotation', 0) or 0,
                elevation=item.get('elevation', 0) or 0,
                z_index=item.get('z_index', 0) or 0,
                locked=bool(item.get('locked', False)),
                label=item.get('label', '') or '',
                color=item.get('color', '') or '',
                style=item.get('style', {}) or {},
            )
            obj = None
            if isinstance(oid, int) and oid > 0:
                obj = FloorMapObject.objects.filter(id=oid, floor=floor).first()
            if obj:
                for k, v in fields.items():
                    setattr(obj, k, v)
                obj.save()
            else:
                obj = FloorMapObject.objects.create(floor=floor, **fields)

            _sync_seat(obj, item.get('seat_code'))
            keep_ids.add(obj.id)

        removed = FloorMapObject.objects.filter(floor=floor).exclude(id__in=keep_ids)
        for r in removed.select_related('seat'):
            if r.seat_id:
                r.seat.delete()  # cascades SeatAssignments
        removed.delete()

        objects = floor.map_objects.select_related('seat').all()
        return Response(FloorMapObjectSerializer(objects, many=True).data)

class SeatViewSet(viewsets.ModelViewSet):
    queryset = Seat.objects.all()
    serializer_class = SeatSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'seating'

    def get_queryset(self):
        qs = super().get_queryset()
        floor_id = self.request.query_params.get('floor_id')
        if floor_id:
            qs = qs.filter(floor_id=floor_id)
        return qs

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign(self, request, pk=None):
        seat = Seat.objects.select_for_update().get(pk=self.get_object().pk)
        user_id = request.data.get('user_id')
        notes = request.data.get('notes', '')

        if not user_id:
            return Response({'detail': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target_user = User.objects.select_for_update().get(id=user_id)
        except User.DoesNotExist:
            return Response({'detail': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        # 1. Vacate previous seat for this user if any
        previous_assignments = SeatAssignment.objects.filter(user=target_user, is_active=True)
        for pa in previous_assignments:
            pa.is_active = False
            pa.vacated_date = timezone.now()
            pa.save()

        # 2. Vacate current occupant of this seat if any
        current_occupants = SeatAssignment.objects.filter(seat=seat, is_active=True)
        for co in current_occupants:
            co.is_active = False
            co.vacated_date = timezone.now()
            co.save()

        # 3. Create new assignment
        assignment = SeatAssignment.objects.create(
            seat=seat,
            user=target_user,
            assigned_by=request.user,
            notes=notes
        )

        return Response(SeatAssignmentSerializer(assignment).data)

    @action(detail=True, methods=['post'])
    def vacate(self, request, pk=None):
        seat = self.get_object()
        assignments = SeatAssignment.objects.filter(seat=seat, is_active=True)
        for a in assignments:
            a.is_active = False
            a.vacated_date = timezone.now()
            a.save()
        return Response({'detail': 'Seat vacated successfully'})

    @action(detail=True, methods=['post'])
    def propose(self, request, pk=None):
        """Create a PENDING change for this seat — does NOT apply until approved.

        Body: {user_id, effective_date?, notes?, change_type?}
        change_type is auto-detected:
          - if target user already has an active seat elsewhere → MOVE (from_seat=that)
          - else if this seat has an active occupant → REPLACE
          - else → NEW
        """
        seat = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'detail': 'user_id is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        target_user = User.objects.filter(id=user_id).first()
        if not target_user:
            return Response({'detail': 'User not found'},
                            status=status.HTTP_404_NOT_FOUND)

        # Block duplicate pending for the same seat+user
        existing = SeatAssignment.objects.filter(
            seat=seat, user=target_user, status='PENDING',
        ).first()
        if existing:
            return Response({'detail': 'A pending change for this seat & user already exists.'},
                            status=status.HTTP_400_BAD_REQUEST)

        user_current = SeatAssignment.objects.filter(
            user=target_user, is_active=True, status='ACTIVE',
        ).first()
        seat_current = SeatAssignment.objects.filter(
            seat=seat, is_active=True, status='ACTIVE',
        ).first()

        change_type = request.data.get('change_type')
        if not change_type:
            if user_current and user_current.seat_id != seat.id:
                change_type = 'MOVE'
            elif seat_current:
                change_type = 'REPLACE'
            else:
                change_type = 'NEW'

        from_seat = user_current.seat if (change_type == 'MOVE' and user_current) else None
        effective_date = request.data.get('effective_date') or None
        notes = request.data.get('notes', '') or ''

        pending = SeatAssignment.objects.create(
            seat=seat, user=target_user,
            status='PENDING', change_type=change_type,
            is_active=False,
            proposed_by=request.user, proposed_at=timezone.now(),
            effective_date=effective_date,
            from_seat=from_seat, notes=notes,
        )
        return Response(SeatAssignmentSerializer(pending).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def propose_vacate(self, request, pk=None):
        """Propose vacating the seat — does NOT apply until approved."""
        seat = self.get_object()
        current = SeatAssignment.objects.filter(
            seat=seat, is_active=True, status='ACTIVE',
        ).first()
        if not current:
            return Response({'detail': 'Seat is not currently occupied.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if SeatAssignment.objects.filter(seat=seat, status='PENDING', change_type='VACATE').exists():
            return Response({'detail': 'A pending vacate already exists.'},
                            status=status.HTTP_400_BAD_REQUEST)
        pending = SeatAssignment.objects.create(
            seat=seat, user=current.user,
            status='PENDING', change_type='VACATE',
            is_active=False,
            proposed_by=request.user, proposed_at=timezone.now(),
            effective_date=request.data.get('effective_date') or None,
            notes=request.data.get('notes', '') or '',
        )
        return Response(SeatAssignmentSerializer(pending).data,
                        status=status.HTTP_201_CREATED)


class SeatAssignmentViewSet(viewsets.ModelViewSet):
    """Lists assignments (default: PENDING) and exposes approve / reject."""
    queryset = SeatAssignment.objects.select_related(
        'seat', 'seat__floor', 'seat__floor__office',
        'user', 'proposed_by', 'from_seat',
    ).all().order_by('-proposed_at', '-created_at')
    serializer_class = SeatAssignmentSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'seating'
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        status_f = self.request.query_params.get('status') or 'PENDING'
        if status_f != 'ALL':
            qs = qs.filter(status=status_f)
        office_id = self.request.query_params.get('office')
        if office_id:
            qs = qs.filter(seat__floor__office_id=office_id)
        floor_id = self.request.query_params.get('floor')
        if floor_id:
            qs = qs.filter(seat__floor_id=floor_id)
        return qs

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def approve(self, request, pk=None):
        pending = SeatAssignment.objects.select_for_update().get(
            pk=self.get_object().pk
        )
        if pending.status != 'PENDING':
            return Response({'detail': 'Not pending.'}, status=status.HTTP_400_BAD_REQUEST)

        seat = pending.seat
        now = timezone.now()

        if pending.change_type == 'VACATE':
            for active in SeatAssignment.objects.filter(seat=seat, is_active=True, status='ACTIVE'):
                active.is_active = False
                active.vacated_date = now
                active.status = 'VACATED'
                active.save()
            pending.status = 'VACATED'
            pending.is_active = False
            pending.vacated_date = now
            pending.save()
        else:
            # Deactivate current ACTIVE on target seat
            for active in SeatAssignment.objects.filter(seat=seat, is_active=True, status='ACTIVE'):
                active.is_active = False
                active.vacated_date = now
                active.status = 'VACATED'
                active.save()
            # If user has another active seat elsewhere, vacate it (MOVE / REPLACE)
            for prev in SeatAssignment.objects.filter(user=pending.user, is_active=True, status='ACTIVE'):
                prev.is_active = False
                prev.vacated_date = now
                prev.status = 'VACATED'
                prev.save()
            pending.is_active = True
            pending.status = 'ACTIVE'
            pending.assigned_by = request.user
            pending.save()
        return Response(SeatAssignmentSerializer(pending).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        pending = self.get_object()
        if pending.status != 'PENDING':
            return Response({'detail': 'Not pending.'}, status=status.HTTP_400_BAD_REQUEST)
        pending.delete()
        return Response({'detail': 'Rejected.'})


class FloorMapObjectViewSet(viewsets.ModelViewSet):
    queryset = FloorMapObject.objects.select_related("floor", "seat").all()
    serializer_class = FloorMapObjectSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'seating'

    def get_queryset(self):
        qs = super().get_queryset()
        floor_id = self.request.query_params.get("floor_id")
        if floor_id:
            qs = qs.filter(floor_id=floor_id)
        return qs

class SeatingStatsView(APIView):
    permission_classes = [HasModulePermission]
    rbac_module = 'seating'

    def get(self, request):
        total_seats = Seat.objects.count()
        occupied_seats = SeatAssignment.objects.filter(is_active=True).values('seat').distinct().count()
        available_seats = total_seats - occupied_seats
        
        utilization = round((occupied_seats / total_seats * 100) if total_seats > 0 else 0, 1)

        return Response({
            'total_seats': total_seats,
            'occupied_seats': occupied_seats,
            'available_seats': available_seats,
            'utilization_pct': utilization
        })

class UserSeatView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, user_id):
        if (
            str(request.user.id) != str(user_id)
            and not has_role_permission(request.user, 'seating', 'view')
        ):
            return Response(
                {'detail': 'Permission denied.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        assignment = SeatAssignment.objects.filter(user_id=user_id, is_active=True).first()
        if assignment:
            return Response(SeatAssignmentSerializer(assignment).data)
        return Response({'detail': 'No active seat assignment'}, status=status.HTTP_404_NOT_FOUND)
