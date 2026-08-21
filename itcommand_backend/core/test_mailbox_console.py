"""The mailbox console: sync, passwords, quotas, and the two-stage deletion.

The tests that earn their place here are the refusals. Anyone can make a
happy path work; what matters is that the only operation which destroys mail
cannot be reached by accident, by a non-superadmin, or by a typo.
"""
from unittest import mock

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from core import cpanel, mailbox_admin
from core.models import User
from core.models.mailboxes import ManagedMailbox

from .test_cpanel_mailboxes import FakeCpanel


class ListingFake(FakeCpanel):
    """FakeCpanel that can also answer list/parse and password changes."""

    def __init__(self, rows=(), **kw):
        super().__init__(**kw)
        self.rows = list(rows)
        self.passwords = []
        self.quotas = []
        self.deleted = []

    def list_mailboxes(self, with_disk=True):
        return self.rows

    @staticmethod
    def parse_mailbox_row(row):
        return cpanel.CpanelClient.parse_mailbox_row(row)

    def change_password(self, address, password):
        if self.fail_with:
            raise self.fail_with
        self.passwords.append((address, password))
        return {"ok": 1}

    def set_quota(self, address, quota_mb):
        self.quotas.append((address, quota_mb))
        return {"ok": 1}

    def delete_mailbox(self, address, *, i_understand_this_deletes_mail=False):
        if not i_understand_this_deletes_mail:
            raise cpanel.CpanelRejected("guard not acknowledged")
        self.deleted.append(address)
        return {"ok": 1}


def row(address, quota="5120", used="120", suspended=False):
    return {"email": address, "diskquota": quota, "diskused": used,
            "suspended_login": suspended}


class PasswordPolicyTests(TestCase):
    def test_too_short_is_refused(self):
        with self.assertRaises(mailbox_admin.PasswordPolicyError):
            mailbox_admin.validate_password("Ab1!x")

    def test_needs_three_character_classes(self):
        with self.assertRaises(mailbox_admin.PasswordPolicyError):
            mailbox_admin.validate_password("onlylowercaseletters")

    def test_common_passwords_are_refused(self):
        for weak in ("Password123!", "Qwerty123456!", "Letmein12345!"):
            with self.assertRaises(mailbox_admin.PasswordPolicyError):
                mailbox_admin.validate_password(weak)

    def test_it_must_not_contain_the_address(self):
        with self.assertRaises(mailbox_admin.PasswordPolicyError) as ctx:
            mailbox_admin.validate_password("Kofi-Mensah-2026!",
                                            address="kofi@terafort.com")
        self.assertIn("kofi", str(ctx.exception))

    def test_it_must_not_contain_the_persons_name(self):
        with self.assertRaises(mailbox_admin.PasswordPolicyError):
            mailbox_admin.validate_password("xQ7-Mensah-plop!",
                                            full_name="Kofi Mensah")

    def test_too_few_distinct_characters(self):
        with self.assertRaises(mailbox_admin.PasswordPolicyError):
            mailbox_admin.validate_password("AAAAaaaa1111!!!!")

    def test_a_reasonable_password_passes(self):
        mailbox_admin.validate_password("Tr7-quiet#harbour", address="kofi@terafort.com")

    def test_generated_passwords_always_satisfy_the_policy(self):
        """The generator and the validator must not disagree, or user creation
        would intermittently fail on its own output."""
        from core import mailbox_provisioning
        for _ in range(50):
            mailbox_admin.validate_password(mailbox_provisioning.generate_password())


class SyncTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="kofi@terafort.com", password="x", full_name="Kofi Mensah")

    def test_it_creates_rows_and_links_by_exact_address(self):
        fake = ListingFake(rows=[row("kofi@terafort.com"), row("info@terafort.com")])
        report = mailbox_admin.sync_mailboxes(client=fake)
        self.assertEqual(report["on_server"], 2)
        self.assertEqual(ManagedMailbox.objects.count(), 2)
        self.assertEqual(
            ManagedMailbox.objects.get(address="kofi@terafort.com").user, self.user)
        self.assertIsNone(
            ManagedMailbox.objects.get(address="info@terafort.com").user)

    def test_a_shared_mailbox_is_not_an_error(self):
        fake = ListingFake(rows=[row("support@terafort.com")])
        mailbox_admin.sync_mailboxes(client=fake)
        box = ManagedMailbox.objects.get(address="support@terafort.com")
        self.assertTrue(box.is_shared)
        self.assertEqual(box.status, "ACTIVE")

    def test_quota_and_usage_are_recorded(self):
        fake = ListingFake(rows=[row("kofi@terafort.com", quota="2048", used="512")])
        mailbox_admin.sync_mailboxes(client=fake)
        box = ManagedMailbox.objects.get(address="kofi@terafort.com")
        self.assertEqual(box.quota_mb, 2048)
        self.assertEqual(box.disk_used_mb, 512)
        self.assertEqual(box.usage_percent, 25.0)

    def test_unlimited_quota_is_none_not_zero(self):
        """Zero would mean no space at all, which is the opposite."""
        fake = ListingFake(rows=[row("info@terafort.com", quota="unlimited")])
        mailbox_admin.sync_mailboxes(client=fake)
        box = ManagedMailbox.objects.get(address="info@terafort.com")
        self.assertIsNone(box.quota_mb)
        self.assertIsNone(box.usage_percent)

    def test_a_vanished_mailbox_is_flagged_not_deleted(self):
        """A mailbox disappearing is also what a half-failed sync looks like."""
        mailbox_admin.sync_mailboxes(client=ListingFake(rows=[row("gone@terafort.com")]))
        mailbox_admin.sync_mailboxes(client=ListingFake(rows=[]))
        box = ManagedMailbox.objects.get(address="gone@terafort.com")
        self.assertFalse(box.exists_in_cpanel)
        self.assertEqual(box.status, "MISSING")
        self.assertIsNotNone(box.missing_since)

    def test_syncing_twice_does_not_duplicate(self):
        fake = ListingFake(rows=[row("kofi@terafort.com")])
        mailbox_admin.sync_mailboxes(client=fake)
        mailbox_admin.sync_mailboxes(client=fake)
        self.assertEqual(ManagedMailbox.objects.count(), 1)


class DeletionFlowTests(TestCase):
    def setUp(self):
        self.box = ManagedMailbox.objects.create(
            address="leaver@terafort.com", domain="terafort.com")

    def test_requesting_deletion_suspends_but_destroys_nothing(self):
        fake = ListingFake()
        box = mailbox_admin.request_deletion(self.box, by="admin@terafort.com",
                                             reason="left the company", client=fake)
        self.assertTrue(box.pending_deletion)
        self.assertTrue(box.suspended)
        self.assertEqual(fake.suspended, ["leaver@terafort.com"])
        self.assertEqual(fake.deleted, [], "mail was destroyed at the request stage")
        self.assertEqual(box.status, "PENDING_DELETION")

    def test_the_grace_period_is_thirty_days(self):
        box = mailbox_admin.request_deletion(self.box, by="a@b.c", client=ListingFake())
        self.assertEqual(box.days_until_purge, ManagedMailbox.PURGE_GRACE_DAYS - 1)
        self.assertFalse(box.purge_due)

    def test_cancelling_restores_the_mailbox(self):
        fake = ListingFake()
        mailbox_admin.request_deletion(self.box, by="a@b.c", client=fake)
        box = mailbox_admin.cancel_deletion(self.box, client=fake)
        self.assertFalse(box.pending_deletion)
        self.assertFalse(box.suspended)
        self.assertEqual(fake.unsuspended, ["leaver@terafort.com"])

    def test_purge_refuses_without_a_deletion_request(self):
        with self.assertRaises(mailbox_admin.MailboxAdminError) as ctx:
            mailbox_admin.purge(self.box, actor="a@b.c",
                                confirm_address="leaver@terafort.com",
                                client=ListingFake())
        self.assertIn("marked for deletion first", str(ctx.exception))

    def test_purge_refuses_inside_the_grace_period(self):
        fake = ListingFake()
        mailbox_admin.request_deletion(self.box, by="a@b.c", client=fake)
        with self.assertRaises(mailbox_admin.MailboxAdminError) as ctx:
            mailbox_admin.purge(self.box, actor="a@b.c",
                                confirm_address="leaver@terafort.com", client=fake)
        self.assertIn("grace period", str(ctx.exception))
        self.assertEqual(fake.deleted, [])

    def test_purge_refuses_a_mistyped_address(self):
        fake = ListingFake()
        mailbox_admin.request_deletion(self.box, by="a@b.c", client=fake)
        self.box.purge_after = timezone.now() - timezone.timedelta(days=1)
        self.box.save(update_fields=["purge_after"])
        with self.assertRaises(mailbox_admin.MailboxAdminError) as ctx:
            mailbox_admin.purge(self.box, actor="a@b.c",
                                confirm_address="leaver@terafort.co", client=fake)
        self.assertIn("Type the full address", str(ctx.exception))
        self.assertEqual(fake.deleted, [])

    def test_purge_works_once_everything_lines_up(self):
        fake = ListingFake()
        mailbox_admin.request_deletion(self.box, by="a@b.c", client=fake)
        self.box.purge_after = timezone.now() - timezone.timedelta(days=1)
        self.box.save(update_fields=["purge_after"])
        box = mailbox_admin.purge(self.box, actor="a@b.c",
                                  confirm_address="leaver@terafort.com", client=fake)
        self.assertEqual(fake.deleted, ["leaver@terafort.com"])
        self.assertIsNotNone(box.purged_at)
        self.assertEqual(box.status, "PURGED")

    def test_force_skips_only_the_grace_period(self):
        """Forcing must not also waive the marking or the typed confirmation."""
        fake = ListingFake()
        mailbox_admin.request_deletion(self.box, by="a@b.c", client=fake)
        with self.assertRaises(mailbox_admin.MailboxAdminError):
            mailbox_admin.purge(self.box, actor="a@b.c", confirm_address="wrong@x.com",
                                force=True, client=fake)
        self.assertEqual(fake.deleted, [])
        mailbox_admin.purge(self.box, actor="a@b.c",
                            confirm_address="leaver@terafort.com",
                            force=True, client=fake)
        self.assertEqual(fake.deleted, ["leaver@terafort.com"])

    def test_scheduled_purge_is_a_dry_run_by_default(self):
        fake = ListingFake()
        mailbox_admin.request_deletion(self.box, by="a@b.c", client=fake)
        self.box.purge_after = timezone.now() - timezone.timedelta(days=1)
        self.box.save(update_fields=["purge_after"])
        report = mailbox_admin.purge_due(client=fake)
        self.assertEqual(report["due"], ["leaver@terafort.com"])
        self.assertEqual(fake.deleted, [], "a dry run deleted mail")

    def test_scheduled_purge_skips_mailboxes_still_in_grace(self):
        fake = ListingFake()
        mailbox_admin.request_deletion(self.box, by="a@b.c", client=fake)
        report = mailbox_admin.purge_due(client=fake, dry_run=False)
        self.assertEqual(report["due"], [])
        self.assertEqual(fake.deleted, [])


class ConsoleApiTests(TestCase):
    """Who can do what. The purge endpoint is the one that matters."""

    def setUp(self):
        self.superadmin = User.objects.create_user(
            email="super@terafort.com", password="pw12345!",
            full_name="Super", role="SUPERADMIN")
        self.admin = User.objects.create_user(
            email="admin@terafort.com", password="pw12345!",
            full_name="Admin", role="ADMIN")
        self.viewer = User.objects.create_user(
            email="viewer@terafort.com", password="pw12345!",
            full_name="Viewer", role="VIEWER")
        self.box = ManagedMailbox.objects.create(
            address="leaver@terafort.com", domain="terafort.com")

    def _as(self, user):
        token = RefreshToken.for_user(user).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    def _url(self, name, **kw):
        return reverse("mailbox-%s" % name, kwargs=kw)

    def _post(self, name, body=None, **kw):
        return self.client.post(self._url(name, **kw), body or {},
                                content_type="application/json")

    def test_a_viewer_cannot_see_the_mailbox_list(self):
        self._as(self.viewer)
        self.assertEqual(self.client.get(reverse("mailbox-list")).status_code, 403)

    def test_an_admin_can_see_the_list(self):
        self._as(self.admin)
        self.assertEqual(self.client.get(reverse("mailbox-list")).status_code, 200)

    def test_the_summary_counts_shared_and_linked(self):
        ManagedMailbox.objects.create(address="info@terafort.com", domain="terafort.com")
        self._as(self.admin)
        data = self.client.get(self._url("summary")).json()
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["shared"], 2)

    def test_admin_can_set_a_generated_password(self):
        self._as(self.admin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post("set-password", pk=self.box.pk)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["password_generated"])
        self.assertEqual(len(fake.passwords), 1)

    def test_a_custom_password_must_pass_the_policy(self):
        self._as(self.admin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post("set-password", {"password": "password123"}, pk=self.box.pk)
        self.assertEqual(r.status_code, 400)
        self.assertIn("password", r.json())
        self.assertEqual(fake.passwords, [], "a weak password reached cPanel")

    def test_a_good_custom_password_is_accepted(self):
        self._as(self.admin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post("set-password", {"password": "Tr7-quiet#harbour"},
                           pk=self.box.pk)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["password_generated"])
        self.assertEqual(fake.passwords[0][1], "Tr7-quiet#harbour")

    def test_suspend_and_restore(self):
        self._as(self.admin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            self.assertEqual(self._post("suspend", pk=self.box.pk).status_code, 200)
            self.assertEqual(self._post("restore", pk=self.box.pk).status_code, 200)
        self.assertEqual(fake.suspended, ["leaver@terafort.com"])
        self.assertEqual(fake.unsuspended, ["leaver@terafort.com"])

    def test_a_zero_quota_is_refused(self):
        self._as(self.admin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post("set-quota", {"quota_mb": 0}, pk=self.box.pk)
        self.assertEqual(r.status_code, 400)
        self.assertIn("unlimited", r.json()["detail"])

    def test_creating_a_shared_mailbox(self):
        self._as(self.admin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post("create-standalone", {"address": "info@terafort.com"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["is_shared"])
        self.assertTrue(r.json()["password"])
        self.assertEqual(len(fake.created), 1)

    def test_a_mailbox_can_only_be_linked_to_a_matching_address(self):
        """Attaching the wrong person to a mailbox is an access-control bug."""
        self._as(self.admin)
        r = self._post("link-user", {"user": self.admin.pk}, pk=self.box.pk)
        self.assertEqual(r.status_code, 400)
        self.box.refresh_from_db()
        self.assertIsNone(self.box.user)

    def test_linking_a_matching_user_works(self):
        owner = User.objects.create_user(
            email="leaver@terafort.com", password="x", full_name="Leaver")
        self._as(self.admin)
        r = self._post("link-user", {"user": owner.pk}, pk=self.box.pk)
        self.assertEqual(r.status_code, 200)
        self.box.refresh_from_db()
        self.assertEqual(self.box.user, owner)

    def test_an_admin_may_request_deletion(self):
        self._as(self.admin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post("request-deletion", {"reason": "left"}, pk=self.box.pk)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["pending_deletion"])
        self.assertEqual(fake.deleted, [], "requesting deletion destroyed mail")

    def test_an_admin_may_not_purge(self):
        """Requesting deletion is reversible; purging is not. Different powers."""
        self._as(self.admin)
        r = self._post("purge", {"confirm_address": self.box.address}, pk=self.box.pk)
        self.assertEqual(r.status_code, 403)

    def test_a_viewer_may_not_purge(self):
        self._as(self.viewer)
        self.assertEqual(
            self._post("purge", {"confirm_address": self.box.address},
                       pk=self.box.pk).status_code, 403)

    def test_superadmin_purge_still_needs_the_whole_ceremony(self):
        self._as(self.superadmin)
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post("purge", {"confirm_address": self.box.address}, pk=self.box.pk)
            self.assertEqual(r.status_code, 409)
            self.assertEqual(fake.deleted, [])

            self._post("request-deletion", pk=self.box.pk)
            r = self._post("purge", {"confirm_address": self.box.address}, pk=self.box.pk)
            self.assertEqual(r.status_code, 409)
            self.assertEqual(fake.deleted, [])

            r = self._post("purge", {"confirm_address": "typo@terafort.com", "force": True},
                           pk=self.box.pk)
            self.assertEqual(r.status_code, 409)
            self.assertEqual(fake.deleted, [])

            r = self._post("purge", {"confirm_address": self.box.address, "force": True},
                           pk=self.box.pk)
            self.assertEqual(r.status_code, 200)
        self.assertEqual(fake.deleted, ["leaver@terafort.com"])


class UserPurgeTests(TestCase):
    """Permanently deleting a person, and what it does to their mail."""

    def setUp(self):
        self.superadmin = User.objects.create_user(
            email="super@terafort.com", password="pw12345!",
            full_name="Super", role="SUPERADMIN")
        self.other_super = User.objects.create_user(
            email="super2@terafort.com", password="pw12345!",
            full_name="Super Two", role="SUPERADMIN")
        self.leaver = User.objects.create_user(
            email="leaver@terafort.com", password="x", full_name="Leaver")
        self.box = ManagedMailbox.objects.create(
            address="leaver@terafort.com", domain="terafort.com", user=self.leaver)
        token = RefreshToken.for_user(self.superadmin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    def _purge(self, user, **body):
        body.setdefault("confirm_email", user.email)
        return self.client.post(reverse("user-purge", kwargs={"pk": user.pk}),
                                body, content_type="application/json")

    def test_an_active_user_cannot_be_purged(self):
        """Deactivation first, so permanent deletion is never one step."""
        r = self._purge(self.leaver)
        self.assertEqual(r.status_code, 409)
        self.assertIn("Deactivate", r.json()["detail"])
        self.assertTrue(User.objects.filter(pk=self.leaver.pk).exists())

    def test_a_mistyped_address_is_refused(self):
        self.leaver.is_active = False
        self.leaver.save(update_fields=["is_active"])
        r = self._purge(self.leaver, confirm_email="leaver@terafort.co")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.leaver.pk).exists())

    def test_you_cannot_purge_yourself(self):
        """Two independent things stop this.

        While you are active, the self-check refuses you outright. Once you are
        deactivated, your token stops authenticating and the request never
        reaches the view at all -- so there is no window in between where
        deactivating yourself first would let you through.
        """
        r = self._purge(self.superadmin)
        self.assertEqual(r.status_code, 409)
        self.assertIn("your own account", r.json()["detail"])

        self.superadmin.is_active = False
        self.superadmin.save(update_fields=["is_active"])
        self.assertEqual(self._purge(self.superadmin).status_code, 401)
        self.assertTrue(User.objects.filter(pk=self.superadmin.pk).exists())

    def test_an_admin_may_not_purge_a_user(self):
        admin = User.objects.create_user(
            email="adm@terafort.com", password="pw12345!", full_name="Adm", role="ADMIN")
        token = RefreshToken.for_user(admin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.leaver.is_active = False
        self.leaver.save(update_fields=["is_active"])
        self.assertEqual(self._purge(self.leaver).status_code, 403)

    def test_purging_a_user_marks_the_mailbox_but_keeps_the_mail(self):
        """Deleting a record and destroying mail are different decisions."""
        self.leaver.is_active = False
        self.leaver.save(update_fields=["is_active"])
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._purge(self.leaver)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(User.objects.filter(pk=self.leaver.pk).exists())

        self.box.refresh_from_db()
        self.assertTrue(self.box.pending_deletion)
        self.assertIsNone(self.box.user, "the FK should null rather than cascade")
        self.assertEqual(fake.deleted, [], "the user purge destroyed mail")
        self.assertIn("recoverable", r.json()["mailbox"])


class QuotaTests(TestCase):
    """Storage is shown in gigabytes and set in gigabytes. Unlimited has to be
    asked for by name, because cPanel reads 0 as unlimited and an empty form
    field must never mean 'remove the limit'."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="qadmin@terafort.com", password="pw12345!",
            full_name="Q Admin", role="ADMIN")
        token = RefreshToken.for_user(self.admin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.box = ManagedMailbox.objects.create(
            address="q@terafort.com", domain="terafort.com",
            quota_mb=5120, disk_used_mb=1536)

    def _post(self, body):
        return self.client.post(
            reverse("mailbox-set-quota", kwargs={"pk": self.box.pk}),
            body, content_type="application/json")

    def test_gigabyte_fields_are_exposed(self):
        r = self.client.get(reverse("mailbox-detail", kwargs={"pk": self.box.pk}))
        self.assertEqual(r.json()["quota_gb"], 5.0)
        self.assertEqual(r.json()["disk_used_gb"], 1.5)

    def test_unlimited_reports_no_gigabytes_rather_than_zero(self):
        self.box.quota_mb = None
        self.box.save(update_fields=["quota_mb"])
        r = self.client.get(reverse("mailbox-detail", kwargs={"pk": self.box.pk}))
        self.assertIsNone(r.json()["quota_gb"])
        self.assertIsNone(r.json()["usage_percent"])

    def test_setting_a_quota_in_gigabytes(self):
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post({"quota_gb": 10})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(fake.quotas, [("q@terafort.com", 10240)])
        self.box.refresh_from_db()
        self.assertEqual(self.box.quota_mb, 10240)

    def test_fractional_gigabytes_round_to_megabytes(self):
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            self._post({"quota_gb": 2.5})
        self.assertEqual(fake.quotas, [("q@terafort.com", 2560)])

    def test_megabytes_still_work(self):
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            self._post({"quota_mb": 3072})
        self.assertEqual(fake.quotas, [("q@terafort.com", 3072)])

    def test_an_empty_size_is_refused_rather_than_meaning_unlimited(self):
        """The whole reason unlimited is a named flag."""
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post({"quota_gb": ""})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(fake.quotas, [])
        self.box.refresh_from_db()
        self.assertEqual(self.box.quota_mb, 5120, "the limit was removed by an empty field")

    def test_zero_is_still_refused(self):
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post({"quota_gb": 0})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(fake.quotas, [])

    def test_unlimited_asked_for_by_name_works(self):
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post({"unlimited": True})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(fake.quotas, [("q@terafort.com", 0)])
        self.box.refresh_from_db()
        self.assertIsNone(self.box.quota_mb)

    def test_a_viewer_cannot_change_a_quota(self):
        viewer = User.objects.create_user(
            email="qviewer@terafort.com", password="pw12345!",
            full_name="V", role="VIEWER")
        token = RefreshToken.for_user(viewer).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.assertEqual(self._post({"quota_gb": 10}).status_code, 403)


class CreateUserFromMailboxTests(TestCase):
    """Giving an existing mailbox an IT Command account.

    The mailbox came first, so we never set its password and do not know it.
    The account must therefore be created without inventing one -- claiming a
    password we do not have is worse than admitting we cannot supply it.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            email="cuadmin@terafort.com", password="pw12345!",
            full_name="CU Admin", role="ADMIN")
        self._as(self.admin)
        self.box = ManagedMailbox.objects.create(
            address="info@terafort.com", domain="terafort.com")

    def _as(self, user):
        token = RefreshToken.for_user(user).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    def _post(self, body=None, box=None):
        return self.client.post(
            reverse("mailbox-create-user", kwargs={"pk": (box or self.box).pk}),
            body or {}, content_type="application/json")

    def test_it_creates_a_mailbox_backed_account(self):
        r = self._post({"full_name": "Info Desk", "role": "VIEWER"})
        self.assertEqual(r.status_code, 200)
        user = User.objects.get(email="info@terafort.com")
        self.assertTrue(user.uses_mailbox_auth)
        self.assertFalse(user.has_usable_password())
        self.box.refresh_from_db()
        self.assertEqual(self.box.user, user)

    def test_no_password_is_invented_for_a_mailbox_we_did_not_create(self):
        r = self._post({"full_name": "Info Desk"})
        self.assertIsNone(r.json()["password"])
        self.assertIn("do not know it", r.json()["note"])

    def test_resetting_the_password_returns_a_new_one(self):
        fake = ListingFake()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post({"full_name": "Info Desk", "reset_password": True})
        self.assertTrue(r.json()["password"])
        self.assertEqual(len(fake.passwords), 1)
        self.assertIn("both IT Command and the mailbox", r.json()["note"])

    def test_a_name_is_required(self):
        r = self._post({})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(User.objects.filter(email="info@terafort.com").exists())

    def test_an_already_linked_mailbox_is_refused(self):
        owner = User.objects.create_user(
            email="info@terafort.com", password="x", full_name="Owner")
        self.box.user = owner
        self.box.save(update_fields=["user"])
        self.assertEqual(self._post({"full_name": "Someone"}).status_code, 409)

    def test_an_existing_unlinked_account_is_adopted_not_duplicated(self):
        """The account was there all along, just not attached."""
        existing = User.objects.create_user(
            email="info@terafort.com", password="x", full_name="Info Desk")
        r = self._post({"full_name": "Different Name"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(User.objects.filter(email="info@terafort.com").count(), 1)
        self.box.refresh_from_db()
        self.assertEqual(self.box.user, existing)
        self.assertIn("already existed", r.json()["message"])

    def test_a_mailbox_not_on_the_server_is_refused(self):
        self.box.exists_in_cpanel = False
        self.box.save(update_fields=["exists_in_cpanel"])
        self.assertEqual(self._post({"full_name": "X"}).status_code, 409)

    def test_an_admin_cannot_mint_a_superadmin_from_here(self):
        """Creating a superadmin is a user-management decision, not a mailbox one."""
        r = self._post({"full_name": "Sneaky", "role": "SUPERADMIN"})
        self.assertEqual(r.status_code, 403)
        self.assertFalse(User.objects.filter(email="info@terafort.com").exists())

    def test_a_superadmin_may(self):
        boss = User.objects.create_user(
            email="boss@terafort.com", password="pw12345!",
            full_name="Boss", role="SUPERADMIN")
        self._as(boss)
        r = self._post({"full_name": "Deputy", "role": "SUPERADMIN"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(User.objects.get(email="info@terafort.com").role, "SUPERADMIN")

    def test_an_unknown_role_is_refused(self):
        self.assertEqual(self._post({"full_name": "X", "role": "WIZARD"}).status_code, 400)

    def test_a_viewer_cannot_create_users_from_mailboxes(self):
        viewer = User.objects.create_user(
            email="cuviewer@terafort.com", password="pw12345!",
            full_name="V", role="VIEWER")
        self._as(viewer)
        self.assertEqual(self._post({"full_name": "X"}).status_code, 403)
