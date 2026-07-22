from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from core import rbac
from core.models import (
    AccountWorkspace,
    Asset,
    KBArticle,
    PurchaseRequest,
    RecurringBill,
    Role,
    Ticket,
    TicketCategory,
    TicketComment,
    VaultCredential,
    VaultUnlockSession,
    Vendor,
)


User = get_user_model()


def role_with_permissions(slug, grants=()):
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


def make_user(email, role):
    return User.objects.create_user(
        email=email,
        password='StrongTestPassword!1',
        full_name=email.split('@')[0].replace('.', ' ').title(),
        role=role,
    )


def response_items(response):
    data = response.data
    return data.get('results', []) if isinstance(data, dict) else data


class SelfServiceVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user('self.service@example.com', 'SELF_SERVICE')
        self.other = make_user('other.requester@example.com', 'VIEWER')
        self.client.force_authenticate(self.user)

    def test_helpdesk_view_only_role_sees_only_own_tickets_and_public_comments(self):
        role_with_permissions('SELF_SERVICE', [('helpdesk', 'view')])
        category = TicketCategory.objects.create(name='Access')
        own = Ticket.objects.create(
            title='My ticket', description='Mine', requester=self.user,
            category=category,
        )
        other = Ticket.objects.create(
            title='Other ticket', description='Other', requester=self.other,
            category=category,
        )
        TicketComment.objects.create(
            ticket=own, author=self.other, body='Visible reply', is_internal=False,
        )
        TicketComment.objects.create(
            ticket=own, author=self.other, body='Internal note', is_internal=True,
        )

        # A helpdesk-only role must not receive KB content through ticket detail.
        KBArticle.objects.create(
            title='Internal runbook', content='Internal', author=self.other,
            status='PUBLISHED', visibility='IT_ONLY',
            linked_tickets_category=category,
        )

        listing = self.client.get(reverse('ticket-list'))
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(
            {item['id'] for item in response_items(listing)},
            {own.pk},
        )

        detail = self.client.get(reverse('ticket-detail', args=[own.pk]))
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [comment['body'] for comment in detail.data['comments']],
            ['Visible reply'],
        )
        self.assertEqual(detail.data['suggested_kb_articles'], [])

        hidden = self.client.get(reverse('ticket-detail', args=[other.pk]))
        self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)

        dashboard = self.client.get(reverse('helpdesk_dashboard'))
        self.assertEqual(dashboard.status_code, status.HTTP_200_OK)
        self.assertEqual(dashboard.data['status_counts']['open'], 1)
        self.assertEqual(
            {item['id'] for item in dashboard.data['recent_tickets']},
            {own.pk},
        )

    def test_procurement_view_only_role_sees_only_own_requests(self):
        role_with_permissions('SELF_SERVICE', [('procurement', 'view')])
        own = PurchaseRequest.objects.create(
            title='My purchase', requested_by=self.user, status='DRAFT',
        )
        other = PurchaseRequest.objects.create(
            title='Other purchase', requested_by=self.other, status='SUBMITTED',
        )

        listing = self.client.get(reverse('procurement-request-list'))
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(
            {item['id'] for item in response_items(listing)},
            {own.pk},
        )

        hidden = self.client.get(
            reverse('procurement-request-detail', args=[other.pk])
        )
        self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)

        dashboard = self.client.get(reverse('procurement_dashboard'))
        self.assertEqual(dashboard.status_code, status.HTTP_200_OK)
        self.assertEqual(dashboard.data['status_counts'], {'DRAFT': 1})
        self.assertEqual(dashboard.data['pending_approval_count'], 0)
        self.assertEqual(
            {item['id'] for item in dashboard.data['recent_prs']},
            {own.pk},
        )


class KnowledgeBaseVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        role_with_permissions('KB_READER', [('kb', 'view')])
        self.reader = make_user('kb.reader@example.com', 'KB_READER')
        self.author = make_user('kb.author@example.com', 'ADMIN')
        self.client.force_authenticate(self.reader)

    def test_view_only_custom_role_gets_published_all_staff_articles_only(self):
        public = KBArticle.objects.create(
            title='Public article', content='Public', author=self.author,
            status='PUBLISHED', visibility='ALL_STAFF',
        )
        it_only = KBArticle.objects.create(
            title='IT article', content='IT', author=self.author,
            status='PUBLISHED', visibility='IT_ONLY',
        )
        admin_only = KBArticle.objects.create(
            title='Admin article', content='Admin', author=self.author,
            status='PUBLISHED', visibility='ADMIN_ONLY',
        )
        draft = KBArticle.objects.create(
            title='Draft article', content='Draft', author=self.author,
            status='DRAFT', visibility='ALL_STAFF',
        )

        listing = self.client.get(reverse('kb-article-list'))
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(
            {item['id'] for item in response_items(listing)},
            {public.pk},
        )

        for hidden in (it_only, admin_only, draft):
            response = self.client.get(
                reverse('kb-article-detail', args=[hidden.slug])
            )
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        dashboard = self.client.get(reverse('kb_dashboard'))
        self.assertEqual(dashboard.status_code, status.HTTP_200_OK)
        self.assertEqual(dashboard.data['total_articles'], 1)
        self.assertEqual(
            {item['id'] for item in dashboard.data['recently_updated']},
            {public.pk},
        )


class VaultVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        role_with_permissions('MANAGER', [('vault', 'view'), ('vault', 'edit')])
        self.user = make_user('vault.manager@example.com', 'MANAGER')
        self.other = make_user('vault.other@example.com', 'MANAGER')
        self.workspace = AccountWorkspace.objects.create(
            name='Shared Workspace',
            login_email='workspace@example.com',
            owner_name='IT',
            created_by=self.user,
        )
        self.own_private = VaultCredential.objects.create(
            title='Own private', username='own', encrypted_password='cipher',
            visibility='PRIVATE', created_by=self.user, workspace=self.workspace,
            tags=['own-tag'],
        )
        self.other_private = VaultCredential.objects.create(
            title='Other private', username='other', encrypted_password='cipher',
            visibility='PRIVATE', created_by=self.other, workspace=self.workspace,
            tags=['other-secret-tag'],
        )
        self.org = VaultCredential.objects.create(
            title='Organization credential', username='org', encrypted_password='cipher',
            visibility='ORG', created_by=self.other, workspace=self.workspace,
            tags=['org-tag'],
        )
        session = VaultUnlockSession.issue(self.user)
        self.client.force_authenticate(self.user)
        self.headers = {'HTTP_X_VAULT_TOKEN': session.token}

        stored_session = VaultUnlockSession.objects.get(pk=session.pk)
        self.assertNotEqual(stored_session.token, session.token)
        self.assertEqual(
            stored_session.token,
            VaultUnlockSession.digest_token(session.token),
        )

    def test_bulk_tags_and_workspace_credentials_reuse_visibility_scope(self):
        bulk = self.client.post(
            reverse('vault-credential-bulk-action'),
            {
                'ids': [self.own_private.pk, self.other_private.pk],
                'action': 'favorite_on',
            },
            format='json',
            **self.headers,
        )
        self.assertEqual(bulk.status_code, status.HTTP_200_OK)
        self.assertEqual(bulk.data['affected'], 1)
        self.own_private.refresh_from_db()
        self.other_private.refresh_from_db()
        self.assertTrue(self.own_private.is_favorite)
        self.assertFalse(self.other_private.is_favorite)

        tags = self.client.get(
            reverse('vault-credential-tags'), **self.headers
        )
        self.assertEqual(tags.status_code, status.HTTP_200_OK)
        self.assertEqual(set(tags.data), {'own-tag', 'org-tag'})

        credentials = self.client.get(
            reverse('vault-workspace-credentials', args=[self.workspace.pk]),
            **self.headers,
        )
        self.assertEqual(credentials.status_code, status.HTTP_200_OK)
        self.assertEqual(
            {item['id'] for item in credentials.data},
            {self.own_private.pk, self.org.pk},
        )

        workspace = self.client.get(
            reverse('vault-workspace-detail', args=[self.workspace.pk]),
            **self.headers,
        )
        self.assertEqual(workspace.status_code, status.HTTP_200_OK)
        self.assertEqual(workspace.data['credential_count'], 2)


class GlobalSearchScopeTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_search_only_returns_permitted_and_visible_records(self):
        role_with_permissions(
            'MANAGER', [('vault', 'view'), ('finance', 'view')]
        )
        user = make_user('search.manager@example.com', 'MANAGER')
        other = make_user('search.other@example.com', 'MANAGER')
        VaultCredential.objects.create(
            title='Acme Own Secret', username='own', encrypted_password='cipher',
            visibility='PRIVATE', created_by=user,
        )
        VaultCredential.objects.create(
            title='Acme Other Secret', username='other', encrypted_password='cipher',
            visibility='PRIVATE', created_by=other,
        )
        VaultCredential.objects.create(
            title='Acme Organization Secret', username='org', encrypted_password='cipher',
            visibility='ORG', created_by=other,
        )
        vendor = Vendor.objects.create(name='Acme Vendor', created_by=user)
        RecurringBill.objects.create(
            title='Hosting subscription', vendor=vendor, amount='99.00',
            next_due_date=date.today(), created_by=user,
        )
        self.client.force_authenticate(user)

        response = self.client.get(reverse('global_search'), {'q': 'Acme'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item['title'] for item in response.data}
        self.assertIn('Acme Own Secret', titles)
        self.assertIn('Acme Organization Secret', titles)
        self.assertIn('Hosting subscription', titles)
        self.assertNotIn('Acme Other Secret', titles)

    def test_search_fails_closed_for_a_role_without_module_view_grants(self):
        role_with_permissions('NO_SEARCH')
        user = make_user('restricted@example.com', 'NO_SEARCH')
        make_user('leak.target@example.com', 'VIEWER')
        Asset.objects.create(name='Leak Laptop')
        self.client.force_authenticate(user)

        response = self.client.get(reverse('global_search'), {'q': 'Leak'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])
