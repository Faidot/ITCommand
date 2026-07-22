from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from core import rbac
from core.models import Notification, Role


User = get_user_model()


def role_with_permissions(slug, grants=()):
    """Create/update a role with only the explicitly listed grants."""
    permissions = rbac.blank_permissions()
    for module, action in grants:
        permissions[module][action] = True
    role, _ = Role.objects.update_or_create(
        slug=slug,
        defaults={
            'name': slug.replace('_', ' ').title(),
            'permissions': permissions,
        },
    )
    return role


def make_user(email, role, *, active=True):
    return User.objects.create_user(
        email=email,
        password='StrongTestPassword!1',
        full_name=email.split('@')[0].replace('.', ' ').title(),
        role=role,
        is_active=active,
    )


class RolePermissionEnforcementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.role = role_with_permissions('LIMITED')
        self.user = make_user('limited@example.com', self.role.slug)
        self.client.force_authenticate(self.user)

    def test_safe_methods_require_the_role_json_view_permission(self):
        response = self.client.get(reverse('asset-list'))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        permissions = self.role.permissions
        permissions['assets']['view'] = True
        self.role.permissions = permissions
        self.role.save(update_fields=['permissions'])

        response = self.client.get(reverse('asset-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # A view grant does not accidentally grant writes.
        response = self.client.post(reverse('asset-list'), {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_list_also_requires_the_users_view_grant(self):
        response = self.client.get(reverse('user-list'))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        permissions = self.role.permissions
        permissions['users']['view'] = True
        self.role.permissions = permissions
        self.role.save(update_fields=['permissions'])

        response = self.client.get(reverse('user-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class UserPrivilegeBoundaryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        role_with_permissions('SUPERADMIN')
        role_with_permissions('ADMIN')
        role_with_permissions('VIEWER')
        self.admin = make_user('admin@example.com', 'ADMIN')
        self.client.force_authenticate(self.admin)

    def test_admin_cannot_create_a_superadmin(self):
        response = self.client.post(
            reverse('user-list'),
            {
                'email': 'escalated@example.com',
                'full_name': 'Escalated User',
                'role': 'SUPERADMIN',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email='escalated@example.com').exists())

    def test_admin_cannot_promote_an_existing_user_to_superadmin(self):
        target = make_user('viewer@example.com', 'VIEWER')

        response = self.client.patch(
            reverse('user-detail', args=[target.pk]),
            {'role': 'SUPERADMIN'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        target.refresh_from_db()
        self.assertEqual(target.role, 'VIEWER')

    def test_single_delete_cannot_deactivate_the_current_user(self):
        superadmin = make_user('root@example.com', 'SUPERADMIN')
        self.client.force_authenticate(superadmin)

        response = self.client.delete(reverse('user-detail', args=[superadmin.pk]))

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        superadmin.refresh_from_db()
        self.assertTrue(superadmin.is_active)

    def test_single_delete_preserves_the_last_active_superadmin(self):
        target = make_user('last.root@example.com', 'SUPERADMIN')
        inactive_peer = make_user('former.root@example.com', 'SUPERADMIN', active=False)
        self.client.force_authenticate(inactive_peer)

        response = self.client.delete(reverse('user-detail', args=[target.pk]))

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        target.refresh_from_db()
        self.assertTrue(target.is_active)

    def test_admin_cannot_reset_a_superadmin_password(self):
        target = make_user('protected.root@example.com', 'SUPERADMIN')
        old_hash = target.password

        response = self.client.post(reverse('user-reset-password', args=[target.pk]))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        target.refresh_from_db()
        self.assertEqual(target.password, old_hash)


class NotificationOwnershipTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.actor = make_user('actor@example.com', 'VIEWER')
        self.other = make_user('other@example.com', 'VIEWER')
        self.client.force_authenticate(self.actor)

    def test_api_cannot_create_a_notification_for_another_user(self):
        response = self.client.post(
            reverse('notification-list'),
            {
                'user': self.other.pk,
                'message': 'Client-created notification',
                'notification_type': 'SYSTEM',
                'link': '/example',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        notification = Notification.objects.get(message='Client-created notification')
        self.assertEqual(notification.user, self.actor)
        self.assertEqual(response.data['user'], self.actor.pk)
