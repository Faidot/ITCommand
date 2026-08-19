"""Mailbox provisioning: creating a person and their mailbox as one act.

Nothing here touches a real cPanel host. The client is a fake that records
what it was asked to do, because the questions worth testing are about our
decisions, not about cPanel's HTTP.

The tests that matter most are the refusals: what happens when cPanel is down,
when the mailbox already exists, and whether a password ever reaches the
database.
"""
from unittest import mock

from django.test import TestCase
from django.urls import reverse
from rest_framework_simplejwt.tokens import RefreshToken

from core import cpanel, mailbox_provisioning
from core.models import User
from core.models.integrations import Integration


class FakeCpanel:
    """Records calls instead of making them."""

    def __init__(self, existing=(), fail_with=None):
        self.existing = {a.lower() for a in existing}
        self.fail_with = fail_with
        self.created = []
        self.suspended = []
        self.unsuspended = []
        self.domain = "terafort.com"
        self.quota_mb = 5120

    def create_mailbox(self, address, password, quota_mb=None):
        if self.fail_with:
            raise self.fail_with
        if address.lower() in self.existing:
            raise cpanel.MailboxExists("account already exists")
        self.created.append((address, password, quota_mb))
        self.existing.add(address.lower())
        return {"ok": 1}

    def suspend_mailbox(self, address):
        if self.fail_with:
            raise self.fail_with
        self.suspended.append(address)
        return {"ok": 1}

    def unsuspend_mailbox(self, address):
        self.unsuspended.append(address)
        return {"ok": 1}

    def mailbox_addresses(self):
        return set(self.existing)


class PasswordTests(TestCase):
    def test_generated_passwords_are_long_and_mixed(self):
        for _ in range(25):
            pw = mailbox_provisioning.generate_password()
            self.assertEqual(len(pw), mailbox_provisioning.PASSWORD_LENGTH)
            self.assertTrue(any(c.islower() for c in pw))
            self.assertTrue(any(c.isupper() for c in pw))
            self.assertTrue(any(c.isdigit() for c in pw))
            self.assertTrue(any(not c.isalnum() for c in pw))

    def test_ambiguous_characters_are_excluded(self):
        """This password gets read off a screen and typed by hand."""
        joined = "".join(mailbox_provisioning.generate_password() for _ in range(40))
        for glyph in "lI1O0":
            self.assertNotIn(glyph, joined)

    def test_passwords_do_not_repeat(self):
        seen = {mailbox_provisioning.generate_password() for _ in range(200)}
        self.assertEqual(len(seen), 200)


class ProvisionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="new@terafort.com", password="placeholder", full_name="New Person")

    def test_creates_the_mailbox_and_switches_the_user_to_dovecot(self):
        fake = FakeCpanel()
        result = mailbox_provisioning.provision_mailbox(self.user, client=fake)

        self.assertTrue(result["created"])
        self.assertEqual(len(fake.created), 1)
        address, password, _ = fake.created[0]
        self.assertEqual(address, "new@terafort.com")
        self.assertEqual(result["password"], password)

        self.user.refresh_from_db()
        self.assertTrue(self.user.uses_mailbox_auth)

    def test_no_usable_local_password_remains(self):
        """The line that makes 'one credential' true rather than aspirational."""
        fake = FakeCpanel()
        result = mailbox_provisioning.provision_mailbox(self.user, client=fake)
        self.user.refresh_from_db()
        self.assertFalse(self.user.has_usable_password())
        self.assertFalse(self.user.check_password(result["password"]))

    def test_the_mailbox_password_is_never_stored(self):
        fake = FakeCpanel()
        result = mailbox_provisioning.provision_mailbox(self.user, client=fake)
        self.user.refresh_from_db()
        self.assertNotIn(result["password"], self.user.password)
        self.assertNotIn(result["password"], str(self.user.__dict__))

    def test_an_existing_mailbox_is_linked_and_no_password_is_invented(self):
        """We did not set that mailbox's password, so we must not hand one out
        -- an operator would try to give it to somebody."""
        fake = FakeCpanel(existing=["new@terafort.com"])
        result = mailbox_provisioning.provision_mailbox(self.user, client=fake)

        self.assertTrue(result["linked"])
        self.assertFalse(result["created"])
        self.assertIsNone(result["password"])
        self.assertEqual(fake.created, [])
        self.user.refresh_from_db()
        self.assertTrue(self.user.uses_mailbox_auth)

    def test_cpanel_outage_leaves_the_user_untouched(self):
        """A user switched to MAILBOX with no mailbox behind it cannot sign in
        at all. Better to change nothing."""
        fake = FakeCpanel(fail_with=cpanel.CpanelUnavailable("host down"))
        with self.assertRaises(mailbox_provisioning.ProvisioningError):
            mailbox_provisioning.provision_mailbox(self.user, client=fake)
        self.user.refresh_from_db()
        self.assertFalse(self.user.uses_mailbox_auth)
        self.assertTrue(self.user.has_usable_password())

    def test_cpanel_rejection_is_reported_with_the_address(self):
        fake = FakeCpanel(fail_with=cpanel.CpanelRejected("quota exceeded"))
        with self.assertRaises(mailbox_provisioning.ProvisioningError) as ctx:
            mailbox_provisioning.provision_mailbox(self.user, client=fake)
        self.assertIn("new@terafort.com", str(ctx.exception))


class SuspendTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="leaver@terafort.com", password="x", full_name="Leaver")
        self.user.auth_source = User.AUTH_MAILBOX
        self.user.save(update_fields=["auth_source"])

    def test_suspends_by_address(self):
        fake = FakeCpanel()
        self.assertTrue(mailbox_provisioning.suspend_mailbox_for(self.user, client=fake))
        self.assertEqual(fake.suspended, ["leaver@terafort.com"])

    def test_a_local_user_has_no_mailbox_to_suspend(self):
        self.user.auth_source = User.AUTH_LOCAL
        self.user.save(update_fields=["auth_source"])
        fake = FakeCpanel()
        self.assertFalse(mailbox_provisioning.suspend_mailbox_for(self.user, client=fake))
        self.assertEqual(fake.suspended, [])

    def test_cpanel_failure_does_not_raise_into_deactivation(self):
        """Losing cPanel must not stop you removing someone's access."""
        fake = FakeCpanel(fail_with=cpanel.CpanelUnavailable("down"))
        self.assertFalse(mailbox_provisioning.suspend_mailbox_for(self.user, client=fake))


class LinkExistingTests(TestCase):
    def setUp(self):
        self.matched = User.objects.create_user(
            email="has@terafort.com", password="x", full_name="Has Mailbox")
        self.unmatched = User.objects.create_user(
            email="none@terafort.com", password="x", full_name="No Mailbox")

    def test_dry_run_changes_nothing(self):
        fake = FakeCpanel(existing=["has@terafort.com"])
        report = mailbox_provisioning.link_existing_mailboxes(dry_run=True, client=fake)
        self.assertEqual(report["linked"], ["has@terafort.com"])
        self.matched.refresh_from_db()
        self.assertFalse(self.matched.uses_mailbox_auth)

    def test_apply_links_only_the_matched_user(self):
        fake = FakeCpanel(existing=["has@terafort.com"])
        mailbox_provisioning.link_existing_mailboxes(dry_run=False, client=fake)
        self.matched.refresh_from_db()
        self.unmatched.refresh_from_db()
        self.assertTrue(self.matched.uses_mailbox_auth)
        self.assertFalse(self.unmatched.uses_mailbox_auth)

    def test_it_never_creates_a_mailbox(self):
        fake = FakeCpanel(existing=["has@terafort.com"])
        mailbox_provisioning.link_existing_mailboxes(dry_run=False, client=fake)
        self.assertEqual(fake.created, [])


class UserCreationApiTests(TestCase):
    """The end-to-end path an admin actually takes."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@terafort.com", password="pw12345!",
            full_name="Admin", role="SUPERADMIN")
        token = RefreshToken.for_user(self.admin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.url = reverse("user-list")

    def _create(self, **extra):
        body = {"email": "hire@terafort.com", "full_name": "New Hire", "role": "VIEWER"}
        body.update(extra)
        return self.client.post(self.url, body, content_type="application/json")

    def test_creating_a_user_creates_their_mailbox_with_one_password(self):
        fake = FakeCpanel()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._create()
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data["mailbox"]["created"])
        self.assertEqual(r.data["password_opens"], "IT Command and the mailbox")

        address, password, _ = fake.created[0]
        self.assertEqual(address, "hire@terafort.com")
        self.assertEqual(r.data["temp_password"], password)

        created = User.objects.get(email="hire@terafort.com")
        self.assertTrue(created.uses_mailbox_auth)
        self.assertFalse(created.has_usable_password())

    def test_opting_out_gives_a_local_account_as_before(self):
        fake = FakeCpanel()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._create(create_mailbox=False)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(fake.created, [])
        self.assertEqual(r.data["password_opens"], "IT Command only")
        created = User.objects.get(email="hire@terafort.com")
        self.assertFalse(created.uses_mailbox_auth)
        self.assertTrue(created.has_usable_password())

    def test_cpanel_failure_still_creates_a_usable_account_and_warns(self):
        """201 with a warning, not a 500. Hiding it behind an error would have
        somebody create the user a second time."""
        fake = FakeCpanel(fail_with=cpanel.CpanelUnavailable("down"))
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._create()
        self.assertEqual(r.status_code, 201)
        self.assertIn("mailbox_warning", r.data)
        self.assertEqual(r.data["password_opens"], "IT Command only")
        created = User.objects.get(email="hire@terafort.com")
        self.assertTrue(created.has_usable_password(), "the new user cannot sign in at all")
        self.assertFalse(created.uses_mailbox_auth)

    def test_deactivating_a_user_suspends_their_mailbox(self):
        fake = FakeCpanel()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            self._create()
            target = User.objects.get(email="hire@terafort.com")
            r = self.client.delete(reverse("user-detail", args=[target.pk]))
        self.assertIn(r.status_code, (200, 204))
        self.assertEqual(fake.suspended, ["hire@terafort.com"])
        target.refresh_from_db()
        self.assertFalse(target.is_active)

    def test_deactivation_suspends_rather_than_deletes(self):
        """Nothing in the API path may destroy mail."""
        fake = FakeCpanel()
        self.assertFalse(hasattr(fake, "deleted"))
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            self._create()
            target = User.objects.get(email="hire@terafort.com")
            self.client.delete(reverse("user-detail", args=[target.pk]))
        self.assertEqual(fake.suspended, ["hire@terafort.com"])


class DestructiveGuardTests(TestCase):
    """delete_mailbox destroys mail permanently and must be hard to reach."""

    def _client(self):
        return cpanel.CpanelClient(
            host="cpanel.example.com", username="tf", token="t",
            domain="terafort.com")

    def test_delete_refuses_without_the_explicit_acknowledgement(self):
        with self.assertRaises(cpanel.CpanelRejected) as ctx:
            self._client().delete_mailbox("someone@terafort.com")
        self.assertIn("permanently destroys", str(ctx.exception))

    def test_no_view_or_command_calls_delete_mailbox(self):
        """The guard is only worth having if nothing routes around it."""
        import pathlib
        root = pathlib.Path(__file__).resolve().parent
        offenders = []
        for path in list(root.glob("views/*.py")) + list(
                root.glob("management/commands/*.py")) + [root / "mailbox_provisioning.py"]:
            if "delete_mailbox" in path.read_text():
                offenders.append(path.name)
        self.assertEqual(offenders, [], "delete_mailbox is reachable from %s" % offenders)

    def test_zero_quota_is_refused(self):
        """cPanel reads 0 as unlimited; reaching that by accident fills a disk."""
        with self.assertRaises(cpanel.CpanelRejected) as ctx:
            self._client().create_mailbox("a@terafort.com", "pw", quota_mb=0)
        self.assertIn("unlimited", str(ctx.exception))

    def test_a_foreign_domain_is_refused(self):
        with self.assertRaises(cpanel.CpanelRejected) as ctx:
            self._client().create_mailbox("a@someoneelse.com", "pw")
        self.assertIn("terafort.com", str(ctx.exception))


class IntegrationRegistrationTests(TestCase):
    def test_cpanel_is_a_registered_provider(self):
        self.assertIn("CPANEL", dict(Integration.PROVIDER_CHOICES))
        self.assertIn("CPANEL", Integration.PROVIDER_SPECS)

    def test_the_token_is_encrypted_like_every_other_provider(self):
        row = Integration.objects.create(provider="CPANEL", is_enabled=True)
        row.set_api_key("secret-cpanel-token")
        row.save()
        row.refresh_from_db()
        self.assertNotIn("secret-cpanel-token", row.encrypted_api_key)
        self.assertEqual(row.get_api_key(), "secret-cpanel-token")

    def test_a_disabled_integration_is_never_used(self):
        Integration.objects.create(provider="CPANEL", is_enabled=False)
        with self.assertRaises(cpanel.CpanelNotConfigured):
            cpanel.CpanelClient.from_integration()


class UnconfiguredIsSilentTests(TestCase):
    """A deployment that has not turned cPanel on must behave exactly as it did
    before this feature existed -- no warnings, no noise."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin2@terafort.com", password="pw12345!",
            full_name="Admin", role="SUPERADMIN")
        token = RefreshToken.for_user(self.admin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    def test_no_integration_means_no_warning_and_a_local_account(self):
        self.assertFalse(mailbox_provisioning.cpanel_is_configured())
        r = self.client.post(
            reverse("user-list"),
            {"email": "quiet@terafort.com", "full_name": "Quiet", "role": "VIEWER"},
            content_type="application/json")
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("mailbox_warning", r.data)
        self.assertNotIn("mailbox", r.data)
        self.assertIn("temp_password", r.data)
        created = User.objects.get(email="quiet@terafort.com")
        self.assertFalse(created.uses_mailbox_auth)
        self.assertTrue(created.has_usable_password())

    def test_configured_but_broken_does_warn(self):
        """The distinction that matters: set up and failing is not silent."""
        fake = FakeCpanel(fail_with=cpanel.CpanelUnavailable("down"))
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self.client.post(
                reverse("user-list"),
                {"email": "loud@terafort.com", "full_name": "Loud", "role": "VIEWER"},
                content_type="application/json")
        self.assertEqual(r.status_code, 201)
        self.assertIn("mailbox_warning", r.data)
