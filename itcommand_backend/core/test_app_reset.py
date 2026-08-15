"""Factory reset.

This is the only endpoint in the app that destroys data it cannot rebuild, so
the tests are weighted towards the things that must *not* happen: a reset
reachable without the phrase or the password, one that removes the last
superadmin and locks everyone out permanently, or one that fails part-way and
leaves half a database behind.

The happy path is tested against a populated estate rather than one empty
model, because the failure mode that matters is a PROTECTed foreign key
refusing to delete in the wrong order — which only appears once the rows
actually reference each other.
"""
from django.contrib.auth import get_user_model
from django.db import connection
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core import reset as app_reset
from core.models import (
    AuditLog, Department, Location, Property, Provider, ProviderAccount, Role,
    Service, Vendor,
)

User = get_user_model()


class AppResetTests(APITestCase):
    def setUp(self):
        self.superadmin = User.objects.create_user(
            email="root@example.com", password="rootpw", role="SUPERADMIN",
        )
        self.other_superadmin = User.objects.create_user(
            email="root2@example.com", password="pw", role="SUPERADMIN",
        )
        self.admin = User.objects.create_user(
            email="admin@example.com", password="pw", role="ADMIN",
        )
        self.staff = User.objects.create_user(
            email="staff@example.com", password="pw", role="VIEWER",
        )
        self.preview_url = reverse("app_reset_preview")
        self.reset_url = reverse("app_reset")
        self.client.force_authenticate(self.superadmin)

    def _populate(self):
        """An estate whose rows reference each other, plus unrelated modules."""
        provider = Provider.objects.create(name="Cloudflare", slug="cloudflare")
        account = ProviderAccount.objects.create(
            provider=provider, account_email="ops@example.com", owner=self.admin,
        )
        prop = Property.objects.create(name="terafort.com", kind="INFRA")
        Service.objects.create(
            provider=provider, provider_account=account, property=prop,
            service_type="DNS", identifier="terafort.com DNS",
        )
        Department.objects.create(name="IT")
        Location.objects.create(name="HQ")
        Vendor.objects.create(name="Acme")

    def _reset(self, **overrides):
        body = {"password": "rootpw", "confirm": app_reset.CONFIRM_PHRASE}
        body.update(overrides)
        return self.client.post(self.reset_url, body, format="json")

    # ── the gates ────────────────────────────────────────────────────────

    def test_an_admin_cannot_reset_the_app(self):
        """Admin is not superadmin. Bulk destruction is a different authority."""
        self._populate()
        self.client.force_authenticate(self.admin)
        response = self._reset(password="pw")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Provider.objects.exists())

    def test_an_admin_cannot_even_see_the_preview(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(
            self.client.get(self.preview_url).status_code, status.HTTP_403_FORBIDDEN
        )

    def test_the_wrong_phrase_deletes_nothing(self):
        self._populate()
        for wrong in ["", "yes", "delete everything", "DELETE EVERYTHIN"]:
            with self.subTest(phrase=wrong):
                response = self._reset(confirm=wrong)
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertTrue(Provider.objects.exists())

    def test_whitespace_around_the_phrase_is_tolerated(self):
        """Deliberate: a trailing space off a copy-paste is not a reason to
        make someone type it a second time. The wording still has to match."""
        self.assertEqual(
            self._reset(confirm=f"  {app_reset.CONFIRM_PHRASE} ").status_code,
            status.HTTP_200_OK,
        )

    def test_the_phrase_alone_is_not_enough_without_the_password(self):
        self._populate()
        response = self._reset(password="not-my-password")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.data["detail"].lower())
        self.assertTrue(Provider.objects.exists())
        self.assertEqual(User.objects.count(), 4)

    def test_an_anonymous_caller_is_refused(self):
        self.client.force_authenticate(None)
        self.assertIn(
            self.client.post(self.reset_url, {}, format="json").status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    # ── the preview ──────────────────────────────────────────────────────

    def test_the_preview_counts_what_will_go_and_names_who_stays(self):
        """"All data" is an abstraction. The number is what makes someone stop."""
        self._populate()
        report = self.client.get(self.preview_url).json()

        by_model = {r["model"]: r["count"] for r in report["records"]}
        self.assertEqual(by_model["Provider"], 1)
        self.assertEqual(by_model["Service"], 1)
        self.assertEqual(by_model["Vendor"], 1)
        self.assertEqual(report["total_records"], sum(by_model.values()))

        self.assertEqual(report["users_deleted"], 2)  # the admin and the viewer
        self.assertEqual(
            sorted(u["email"] for u in report["users_kept"]),
            ["root2@example.com", "root@example.com"],
        )
        self.assertEqual(report["confirm_phrase"], app_reset.CONFIRM_PHRASE)

    def test_the_preview_writes_nothing(self):
        self._populate()
        before = Provider.objects.count(), User.objects.count()
        self.client.get(self.preview_url)
        self.assertEqual((Provider.objects.count(), User.objects.count()), before)

    # ── the reset ────────────────────────────────────────────────────────

    def test_it_empties_every_module(self):
        self._populate()
        response = self._reset()
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        self.assertFalse(Provider.objects.exists())
        self.assertFalse(ProviderAccount.objects.exists())
        self.assertFalse(Service.objects.exists())
        self.assertFalse(Property.objects.exists())
        self.assertFalse(Department.objects.exists())
        self.assertFalse(Location.objects.exists())
        self.assertFalse(Vendor.objects.exists())

    def test_every_superadmin_survives_and_everyone_else_does_not(self):
        """Deleting the last superadmin would lock the app permanently."""
        self._populate()
        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)

        self.assertEqual(
            sorted(User.objects.values_list("email", flat=True)),
            ["root2@example.com", "root@example.com"],
        )

    def test_a_superadmin_survives_the_deletion_of_what_they_point_at(self):
        """The hazard a self-referencing wipe hides.

        A superadmin has a department and may manage someone. Both rows are
        deleted by the reset. If either foreign key cascaded instead of
        nulling, the account kept "for safety" would go with them and the app
        would be permanently locked.
        """
        department = Department.objects.create(name="IT")
        self.superadmin.department = department
        self.superadmin.manager = self.other_superadmin
        self.superadmin.save()
        self.staff.manager = self.superadmin
        self.staff.save()

        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)

        self.superadmin.refresh_from_db()
        self.assertIsNone(self.superadmin.department_id)
        self.assertEqual(self.superadmin.manager, self.other_superadmin)
        self.assertTrue(User.objects.filter(pk=self.superadmin.pk).exists())

    def test_the_superadmin_who_ran_it_can_still_sign_in(self):
        """The point of keeping them is that somebody can start again."""
        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)
        self.superadmin.refresh_from_db()
        self.assertTrue(self.superadmin.check_password("rootpw"))
        self.assertTrue(self.superadmin.is_active)

    def test_roles_are_restored_to_the_shipped_defaults(self):
        """Reset means default permissions, not an empty permission table."""
        Role.objects.all().delete()
        Role.objects.create(
            slug="ADMIN", name="Admin", is_system=True, permissions={},
        )
        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)

        from core import rbac

        self.assertEqual(
            sorted(Role.objects.values_list("slug", flat=True)),
            sorted(slug for slug, *_ in rbac.DEFAULT_ROLES),
        )
        # The emptied permission map above was replaced, not kept.
        self.assertTrue(Role.objects.get(slug="ADMIN").permissions)

    def test_it_reports_what_it_removed(self):
        self._populate()
        body = self._reset().json()
        self.assertEqual(body["users_deleted"], 2)
        self.assertEqual(body["users_kept"], 2)
        self.assertEqual(body["by_model"]["Provider"], 1)
        self.assertGreaterEqual(body["records_deleted"], 7)

    def test_the_reset_itself_is_the_one_thing_left_in_the_audit_log(self):
        """The wipe erases the trail; this row is the only record it happened."""
        AuditLog.objects.create(
            user=self.admin, action="UPDATE", model_name="Vendor", object_id="1",
        )
        self._populate()
        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)

        entries = list(AuditLog.objects.all())
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry.action, "DELETE")
        self.assertEqual(entry.user, self.superadmin)
        self.assertEqual(entry.changes["action"], "app_factory_reset")
        self.assertEqual(
            sorted(entry.changes["users_kept"]),
            ["root2@example.com", "root@example.com"],
        )

    def test_resetting_an_already_empty_app_is_not_an_error(self):
        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)
        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)

    def test_the_app_still_works_afterwards(self):
        """A reset that leaves the app unusable is not a reset."""
        self._populate()
        self.assertEqual(self._reset().status_code, status.HTTP_200_OK)

        response = self.client.post(
            reverse("estate-provider-list"), {"name": "Fresh", "slug": "fresh"}, format="json",
        )
        self.assertIn(
            response.status_code,
            (status.HTTP_200_OK, status.HTTP_201_CREATED),
            response.data,
        )


class DeletionOrderTests(APITestCase):
    """The ordering is the part that silently breaks as models are added."""

    def test_a_model_is_deleted_before_anything_it_points_at(self):
        ordered = app_reset.deletion_order(
            [m for m in app_reset._wipeable_models()]
        )
        position = {model: i for i, model in enumerate(ordered)}

        for model in ordered:
            for target in app_reset._forward_relations(model):
                if target in position:
                    self.assertLess(
                        position[model], position[target],
                        f"{model.__name__} points at {target.__name__} and must be "
                        f"deleted first, or a PROTECT will refuse the delete.",
                    )

    def test_every_model_appears_exactly_once(self):
        models = app_reset._wipeable_models()
        ordered = app_reset.deletion_order(models)
        self.assertEqual(len(ordered), len(models))
        self.assertEqual(set(ordered), set(models))

    def test_the_wipe_covers_every_table_in_the_app(self):
        """A new model must not quietly survive a reset.

        The check is against the database's own table list rather than a
        hardcoded count, so adding a model to `core` is enough to keep this
        honest without editing the test.
        """
        from django.apps import apps

        covered = {m._meta.db_table for m in app_reset._wipeable_models()}
        covered.add(apps.get_model("core", "User")._meta.db_table)
        core_tables = {
            m._meta.db_table for m in apps.get_app_config("core").get_models()
        }
        self.assertEqual(core_tables - covered, set())

        with connection.cursor() as cursor:
            existing = set(connection.introspection.table_names(cursor))
        self.assertTrue(covered & existing, "no core tables found to check against")
