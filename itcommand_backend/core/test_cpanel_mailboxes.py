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
        # The error paths name the host and user in their messages, so the
        # fake has to carry them like the real client does.
        self.host = "cpanel.example.com"
        self.username = "terafort"

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

    #: The one place allowed to delete: a self-test that created the mailbox
    #: itself, moments earlier, on an address it forced to look disposable and
    #: refused to reuse. Every other caller would be operating on a mailbox
    #: somebody real depends on.
    DELETE_ALLOWED = {"cpanel_verify.py"}

    def test_nothing_reachable_from_a_request_can_delete_a_mailbox(self):
        """The guard is only worth having if nothing routes around it.

        Views especially: an HTTP request must never be able to cause
        permanent mail loss, whatever it contains.
        """
        import pathlib
        root = pathlib.Path(__file__).resolve().parent
        offenders = []
        for path in list(root.glob("views/*.py")) + list(
                root.glob("management/commands/*.py")) + [root / "mailbox_provisioning.py"]:
            if path.name in self.DELETE_ALLOWED:
                continue
            if "delete_mailbox" in path.read_text():
                offenders.append(path.name)
        self.assertEqual(offenders, [], "delete_mailbox is reachable from %s" % offenders)

    def test_the_one_allowed_caller_still_passes_the_acknowledgement(self):
        """Being on the allow-list is not permission to skip the guard."""
        import pathlib
        source = (pathlib.Path(__file__).resolve().parent
                  / "management" / "commands" / "cpanel_verify.py").read_text()
        self.assertIn("i_understand_this_deletes_mail=True", source)
        # And it must never delete without being asked.
        self.assertIn('opts["cleanup"]', source)

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


class IntegrationConfigApiTests(TestCase):
    """cPanel needs a host, username and domain as well as a token, so the
    settings API has to accept `config`. It also has to refuse anything the
    provider did not declare -- this row feeds a URL builder and an HTTP
    client, so an open dict would be a real hole."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="cfgadmin@terafort.com", password="pw12345!",
            full_name="Cfg Admin", role="SUPERADMIN")
        token = RefreshToken.for_user(self.admin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.url = "/api/integrations/"

    def _put(self, **body):
        body.setdefault("provider", "CPANEL")
        return self.client.put(self.url, body, content_type="application/json")

    def test_config_fields_are_advertised_to_the_ui(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, 200)
        cpanel_row = next(i for i in r.data["integrations"] if i["provider"] == "CPANEL")
        keys = {f["key"] for f in cpanel_row["config_fields"]}
        self.assertEqual(
            keys,
            {"host", "cpanel_username", "domain", "port", "default_quota_mb", "verify_cert"})

    def test_config_round_trips(self):
        r = self._put(config={"host": "cpanel.example.com",
                              "cpanel_username": "terafort",
                              "domain": "terafort.com"})
        self.assertEqual(r.status_code, 200)
        row = Integration.objects.get(provider="CPANEL")
        self.assertEqual(row.config["host"], "cpanel.example.com")
        self.assertEqual(row.config["domain"], "terafort.com")

    def test_partial_updates_merge_rather_than_replace(self):
        self._put(config={"host": "a.example.com", "cpanel_username": "tf"})
        self._put(config={"domain": "terafort.com"})
        row = Integration.objects.get(provider="CPANEL")
        self.assertEqual(row.config["host"], "a.example.com")
        self.assertEqual(row.config["cpanel_username"], "tf")

    def test_undeclared_keys_are_refused(self):
        r = self._put(config={"host": "a.example.com", "evil_key": "x"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("evil_key", r.data["detail"])

    def test_config_must_be_an_object(self):
        self.assertEqual(self._put(config="not-a-dict").status_code, 400)

    def test_enabling_without_required_config_is_refused_by_name(self):
        row = Integration.objects.create(provider="CPANEL")
        row.set_api_key("tok")
        row.save()
        r = self._put(is_enabled=True)
        self.assertEqual(r.status_code, 400)
        self.assertIn("cPanel hostname", r.data["detail"])

    def test_enabling_with_everything_present_succeeds(self):
        r = self._put(api_key="tok",
                      config={"host": "cpanel.example.com",
                              "cpanel_username": "terafort",
                              "domain": "terafort.com"},
                      is_enabled=True)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Integration.objects.get(provider="CPANEL").is_enabled)

    def test_the_saved_config_actually_builds_a_working_client(self):
        """The end of the chain: what the UI saves is what the client uses."""
        self._put(api_key="tok",
                  config={"host": "cpanel.example.com",
                          "cpanel_username": "terafort",
                          "domain": "terafort.com"},
                  is_enabled=True)
        client = cpanel.CpanelClient.from_integration()
        self.assertEqual(client.domain, "terafort.com")
        self.assertEqual(client.username, "terafort")
        self.assertEqual(
            client._url("Email", "add_pop"),
            "https://cpanel.example.com:2083/execute/Email/add_pop")


class ConnectionTestApiTests(TestCase):
    """The Test connection button.

    The three failure modes must stay distinct: not configured, unreachable,
    refused. Collapsing them into "test failed" is how somebody ends up
    regenerating a token that was fine because the hostname had a typo.
    """

    URL = "/api/integrations/test/"

    def setUp(self):
        self.admin = User.objects.create_user(
            email="testadmin@terafort.com", password="pw12345!",
            full_name="Test Admin", role="SUPERADMIN")
        token = RefreshToken.for_user(self.admin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    def _row(self, enabled=True):
        row = Integration.objects.create(
            provider="CPANEL", is_enabled=enabled,
            config={"host": "cpanel.example.com", "cpanel_username": "terafort",
                    "domain": "terafort.com"})
        row.set_api_key("tok")
        row.save()
        return row

    def _post(self):
        return self.client.post(self.URL, {"provider": "CPANEL"},
                                content_type="application/json")

    def test_not_configured_says_so(self):
        r = self._post()
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["ok"])
        self.assertIn("not been set up", r.data["output"])

    def test_it_works_before_the_integration_is_enabled(self):
        """The whole point is to check before switching it on."""
        self._row(enabled=False)
        fake = FakeCpanel(existing=["a@terafort.com"])
        fake.check = lambda: {"host": "cpanel.example.com", "port": 2083,
                              "cpanel_user": "terafort", "domain": "terafort.com",
                              "reachable": True, "mailbox_count": 1,
                              "default_quota_mb": 5120, "sample": ["a@terafort.com"]}
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post()
        self.assertTrue(r.data["ok"])

    def test_success_reports_what_it_found(self):
        self._row()
        fake = FakeCpanel()
        fake.check = lambda: {"host": "cpanel.example.com", "port": 2083,
                              "cpanel_user": "terafort", "domain": "terafort.com",
                              "reachable": True, "mailbox_count": 12,
                              "default_quota_mb": 5120, "sample": []}
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post()
        self.assertTrue(r.data["ok"])
        self.assertIn("12 mailbox", r.data["output"])
        self.assertIn("terafort.com", r.data["output"])

    def test_success_carries_the_caveat(self):
        """A green tick here is easy to over-read: the probe never exercises
        add_pop, which is the call whose parameters are unverified."""
        self._row()
        fake = FakeCpanel()
        fake.check = lambda: {"host": "h", "port": 2083, "cpanel_user": "u",
                              "domain": "terafort.com", "reachable": True,
                              "mailbox_count": 0, "default_quota_mb": 5120, "sample": []}
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post()
        self.assertIn("list_pops", r.data["caveat"])

    def test_unreachable_does_not_blame_the_token(self):
        self._row()
        fake = FakeCpanel()
        fake.check = mock.Mock(side_effect=cpanel.CpanelUnavailable("timed out"))
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post()
        self.assertFalse(r.data["ok"])
        self.assertIn("NOT been rejected", r.data["output"])

    def test_refusal_points_at_the_token(self):
        self._row()
        fake = FakeCpanel()
        fake.check = mock.Mock(side_effect=cpanel.CpanelRejected("Access denied"))
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            r = self._post()
        self.assertFalse(r.data["ok"])
        self.assertIn("API token", r.data["output"])

    def test_the_result_is_recorded_on_the_integration(self):
        row = self._row()
        fake = FakeCpanel()
        fake.check = mock.Mock(side_effect=cpanel.CpanelRejected("Access denied"))
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            self._post()
        row.refresh_from_db()
        self.assertEqual(row.last_status, "ERROR")
        self.assertIn("Access denied", row.last_error)

    def test_a_non_superadmin_cannot_run_it(self):
        viewer = User.objects.create_user(
            email="viewer@terafort.com", password="pw12345!",
            full_name="Viewer", role="VIEWER")
        token = RefreshToken.for_user(viewer).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.assertEqual(self._post().status_code, 403)

    def test_the_button_is_advertised_to_the_ui(self):
        r = self.client.get("/api/integrations/")
        row = next(i for i in r.data["integrations"] if i["provider"] == "CPANEL")
        self.assertTrue(row["supports_connection_test"])


class CpanelVerifyCommandTests(TestCase):
    """The self-test creates a real mailbox, so its guards matter more than its
    happy path. It must never be able to touch a real person's address."""

    def _run(self, **opts):
        from io import StringIO

        from django.core.management import call_command
        out = StringIO()
        opts.setdefault("yes", True)
        call_command("cpanel_verify", stdout=out, stderr=out, **opts)
        return out.getvalue()

    def test_refuses_an_address_that_does_not_look_disposable(self):
        from django.core.management.base import CommandError
        fake = FakeCpanel()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            with self.assertRaises(CommandError) as ctx:
                self._run(address="kofi@terafort.com")
        self.assertIn("does not look like a test address", str(ctx.exception))
        self.assertEqual(fake.created, [], "it tried to create a real person's mailbox")

    def test_refuses_an_address_that_already_exists(self):
        from django.core.management.base import CommandError
        fake = FakeCpanel(existing=["selftest@terafort.com"])
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            with self.assertRaises(CommandError) as ctx:
                self._run(address="selftest@terafort.com")
        self.assertIn("already exists", str(ctx.exception))

    def test_happy_path_exercises_all_four_calls(self):
        fake = FakeCpanel()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            out = self._run(address="itcommand-selftest@terafort.com")
        self.assertIn("All four calls work", out)
        self.assertEqual(len(fake.created), 1)
        self.assertEqual(fake.suspended, ["itcommand-selftest@terafort.com"])
        self.assertEqual(fake.unsuspended, ["itcommand-selftest@terafort.com"])

    def test_it_leaves_the_mailbox_unless_cleanup_is_asked_for(self):
        fake = FakeCpanel()
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            out = self._run(address="itcommand-selftest@terafort.com")
        self.assertIn("still on your server", out)

    def test_a_failing_call_is_reported_with_cpanels_own_error(self):
        from django.core.management.base import CommandError
        fake = FakeCpanel(fail_with=cpanel.CpanelRejected("Invalid parameter 'quota'"))
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            with self.assertRaises(CommandError):
                self._run(address="itcommand-selftest@terafort.com")

    def test_add_pop_succeeding_but_not_appearing_is_caught(self):
        """A mailbox created on the wrong domain would otherwise look fine."""
        from django.core.management.base import CommandError
        fake = FakeCpanel()
        fake.mailbox_addresses = lambda: set()   # never shows up in list_pops
        with mock.patch.object(cpanel.CpanelClient, "from_integration", return_value=fake):
            with self.assertRaises(CommandError):
                self._run(address="itcommand-selftest@terafort.com")
