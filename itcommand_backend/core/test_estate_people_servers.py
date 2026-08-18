"""Logins on an account, and servers.

Two models added because the estate could not answer two questions:

* one AWS account has several people in it, and they do not share a second
  factor — so "AWS has MFA" was able to be true while somebody on it had none;
* a server bought through an account had nowhere to live.

The tests below lean on the parts that are easy to get wrong and silent when
wrong: the MFA rollup taking the *weakest* login rather than any other summary,
and the accounts list not turning into one query per row now that it reads the
people.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core import estate
from core.models import (
    AccountUser, Property, Provider, ProviderAccount, Server, Service,
)

User = get_user_model()


def make_account(provider=None, login="ops@example.com", **kwargs):
    provider = provider or Provider.objects.create(name="AWS", slug="aws")
    return ProviderAccount.objects.create(
        provider=provider, account_email=login, **kwargs
    )


class MfaRollupTests(TestCase):
    """An account is only as protected as its softest way in."""

    def setUp(self):
        self.account = make_account(mfa_type="SECURITY_KEY")

    def test_an_account_with_no_people_keeps_its_own_answer(self):
        """Accounts nobody has broken out yet must not change behaviour."""
        self.assertEqual(self.account.effective_mfa_type, "SECURITY_KEY")
        self.assertTrue(self.account.has_mfa)
        self.assertEqual(self.account.mfa_severity, "ok")

    def test_one_person_without_mfa_makes_the_whole_account_critical(self):
        """The case the old model could not express: the account says it has a
        security key, and one of the four people on it has nothing."""
        AccountUser.objects.create(
            provider_account=self.account, login="root@example.com",
            mfa_type="SECURITY_KEY", role="OWNER",
        )
        AccountUser.objects.create(
            provider_account=self.account, login="iam:alice", mfa_type="APP",
        )
        AccountUser.objects.create(
            provider_account=self.account, login="iam:bob", mfa_type="NONE",
        )

        self.assertEqual(self.account.effective_mfa_type, "NONE")
        self.assertFalse(self.account.has_mfa)
        self.assertEqual(self.account.mfa_severity, "critical")
        self.assertEqual(self.account.people_without_mfa, 1)

    def test_a_deactivated_login_no_longer_drags_the_account_down(self):
        """Switching a login off is how a removed one is recorded, so it must
        stop counting — otherwise nobody would ever clear the warning."""
        AccountUser.objects.create(
            provider_account=self.account, login="iam:alice", mfa_type="APP",
        )
        gone = AccountUser.objects.create(
            provider_account=self.account, login="iam:bob", mfa_type="NONE",
        )
        self.assertEqual(self.account.effective_mfa_type, "NONE")

        gone.is_active = False
        gone.save()
        self.account.refresh_from_db()
        self.assertEqual(self.account.effective_mfa_type, "APP")

    def test_unknown_ranks_between_sms_and_app(self):
        """Nobody has checked, so it must not read as safe — but it is not
        evidence of absence either, and must not outrank a known NONE."""
        self.assertEqual(estate.worst_mfa(["APP", "UNKNOWN"]), "UNKNOWN")
        self.assertEqual(estate.worst_mfa(["UNKNOWN", "NONE"]), "NONE")
        self.assertEqual(estate.worst_mfa(["UNKNOWN", "SMS"]), "SMS")

    def test_the_weakest_wins_not_the_commonest(self):
        """A majority or an average would let one open door hide behind four
        locked ones."""
        self.assertEqual(
            estate.worst_mfa(["SECURITY_KEY", "SECURITY_KEY", "SECURITY_KEY", "NONE"]),
            "NONE",
        )


class AccountUserApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@example.com", password="pw", role="ADMIN",
        )
        self.alice = User.objects.create_user(
            email="alice@example.com", password="pw", role="VIEWER", full_name="Alice",
        )
        self.client.force_authenticate(self.admin)
        self.aws = Provider.objects.create(name="AWS", slug="aws")
        self.figma = Provider.objects.create(name="Figma", slug="figma")
        self.aws_account = make_account(self.aws, "1234-5678", login_kind="ACCOUNT_ID")
        self.figma_account = make_account(self.figma, "billing@example.com")
        self.url = reverse("estate-account-user-list")

    def test_a_username_login_is_accepted(self):
        """The original complaint: some providers issue usernames, not emails."""
        response = self.client.post(self.url, {
            "provider_account": self.aws_account.id,
            "login": "iam:alice",
            "login_kind": "USERNAME",
            "role": "ADMIN",
            "mfa_type": "APP",
            "user": self.alice.id,
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["login_kind_label"], "Username")
        self.assertEqual(response.data["name"], "Alice")

    def test_a_login_with_no_linked_user_still_gets_a_name(self):
        """A service account or a contractor is a real login; hiding it would
        defeat the point of keeping the list."""
        person = AccountUser.objects.create(
            provider_account=self.aws_account,
            login="svc-deploy",
            display_name="Deploy robot",
        )
        self.assertEqual(person.name, "Deploy robot")

    def test_the_same_login_cannot_be_added_twice_to_one_account(self):
        AccountUser.objects.create(provider_account=self.aws_account, login="iam:bob")
        response = self.client.post(self.url, {
            "provider_account": self.aws_account.id, "login": "iam:bob",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_same_login_may_exist_on_a_different_account(self):
        """One person legitimately has the same email at two providers."""
        AccountUser.objects.create(provider_account=self.aws_account, login="a@example.com")
        response = self.client.post(self.url, {
            "provider_account": self.figma_account.id, "login": "a@example.com",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_an_empty_login_is_refused(self):
        response = self.client.post(self.url, {
            "provider_account": self.aws_account.id, "login": "   ",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_filtering_by_account_answers_who_can_get_into_this(self):
        AccountUser.objects.create(provider_account=self.aws_account, login="iam:alice")
        AccountUser.objects.create(provider_account=self.aws_account, login="iam:bob")
        AccountUser.objects.create(provider_account=self.figma_account, login="c@example.com")

        response = self.client.get(self.url, {"account": self.aws_account.id})
        self.assertEqual(response.data["count"], 2)

    def test_the_leaver_view_gathers_logins_and_servers_together(self):
        """Answering half of "what does this person hold" is how a machine gets
        left running under a leaver's name."""
        AccountUser.objects.create(
            provider_account=self.aws_account, login="iam:alice",
            user=self.alice, role="ADMIN", mfa_type="NONE",
        )
        AccountUser.objects.create(
            provider_account=self.figma_account, login="alice@example.com",
            user=self.alice, role="MEMBER", mfa_type="APP",
        )
        Server.objects.create(
            provider_account=self.aws_account, name="web-01", owner=self.alice,
        )

        response = self.client.get(
            reverse("estate-account-user-for-user", args=[self.alice.id])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["login_count"], 2)
        self.assertEqual(response.data["privileged_count"], 1)
        self.assertEqual(response.data["without_mfa"], 1)
        self.assertEqual(response.data["server_count"], 1)
        self.assertEqual(
            sorted(r["provider_name"] for r in response.data["logins"]),
            ["AWS", "Figma"],
        )

    def test_deleting_an_account_takes_its_logins_with_it(self):
        """A login to an account that no longer exists is not information."""
        AccountUser.objects.create(provider_account=self.figma_account, login="x@example.com")
        self.figma_account.delete()
        self.assertEqual(AccountUser.objects.filter(login="x@example.com").count(), 0)

    def test_the_accounts_list_does_not_query_once_per_row(self):
        """The MFA rollup reads each account's people, so without the viewset's
        prefetch this is one extra query per row.

        Asserted as "the count does not grow with the rows" rather than against
        a fixed number: the absolute count depends on how many of the people
        happen to link to a user, and pinning it would make this test fail for
        reasons that have nothing to do with the N+1 it exists to catch.
        """
        url = reverse("estate-account-list")

        def populate(start, count):
            for i in range(start, start + count):
                account = make_account(self.aws, f"acct-{i}@example.com")
                for j in range(3):
                    AccountUser.objects.create(
                        provider_account=account, login=f"user-{i}-{j}",
                        user=self.alice if j == 0 else None, mfa_type="APP",
                    )

        def people_queries(captured):
            # Only the queries that touch the people table. The total count
            # also moves with presence tracking, which writes `last_seen_at` on
            # a throttle and has nothing to do with this.
            return [q for q in captured.captured_queries
                    if "core_accountuser" in q["sql"]]

        populate(0, 2)
        with CaptureQueriesContext(connection) as few:
            self.client.get(url)

        populate(2, 12)
        with CaptureQueriesContext(connection) as many:
            response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(people_queries(few)), 1)
        self.assertEqual(
            len(people_queries(many)), 1,
            f"14 accounts cost {len(people_queries(many))} queries against the "
            "people table; the prefetch collapses it to one.",
        )

    def test_the_account_row_reports_its_people(self):
        AccountUser.objects.create(
            provider_account=self.aws_account, login="root", role="OWNER", mfa_type="APP",
        )
        AccountUser.objects.create(
            provider_account=self.aws_account, login="iam:bob", mfa_type="NONE",
        )
        response = self.client.get(reverse("estate-account-list"))
        row = next(r for r in response.data["results"] if r["id"] == self.aws_account.id)
        self.assertEqual(row["people_count"], 2)
        self.assertEqual(row["people_without_mfa"], 1)
        self.assertEqual(row["privileged_count"], 1)
        self.assertEqual(row["mfa_severity"], "critical")


class ServerApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@example.com", password="pw", role="ADMIN",
        )
        self.client.force_authenticate(self.admin)
        self.aws = Provider.objects.create(name="AWS", slug="aws")
        self.account = make_account(self.aws, "1234-5678")
        self.other_account = make_account(self.aws, "9999-0000")
        self.property = Property.objects.create(name="terafort.com", kind="INFRA")
        self.url = reverse("estate-server-list")

    def _service(self, account=None):
        return Service.objects.create(
            provider=self.aws,
            provider_account=account or self.account,
            service_type="HOSTING",
            identifier="EC2 plan",
        )

    def test_a_server_records_where_it_lives_and_what_it_runs(self):
        response = self.client.post(self.url, {
            "provider_account": self.account.id,
            "name": "web-01",
            "server_role": "WEB",
            "environment": "PRODUCTION",
            "public_ip": "203.0.113.9",
            "private_ip": "10.0.0.4",
            "region": "eu-west-1",
            "size": "t3.medium",
            "property": self.property.id,
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["provider_name"], "AWS")
        self.assertEqual(response.data["property_name"], "terafort.com")
        self.assertTrue(response.data["is_live"])

    def test_a_bad_ip_is_refused_rather_than_stored(self):
        """A typo'd address is worse than a blank one — somebody will try it."""
        response = self.client.post(self.url, {
            "provider_account": self.account.id,
            "name": "web-02",
            "public_ip": "203.0.113.999",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("public_ip", response.data)

    def test_a_service_on_another_account_cannot_be_attached(self):
        """Otherwise the server is attributed to one account and paid for by
        another, and both the cost report and the account view go quietly wrong."""
        foreign = self._service(self.other_account)
        response = self.client.post(self.url, {
            "provider_account": self.account.id,
            "name": "web-03",
            "service": foreign.id,
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("service", response.data)

    def test_a_service_on_the_same_account_is_accepted(self):
        response = self.client.post(self.url, {
            "provider_account": self.account.id,
            "name": "web-04",
            "service": self._service().id,
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_two_servers_may_share_a_name_across_accounts_but_not_within_one(self):
        Server.objects.create(provider_account=self.account, name="web-01")
        clash = self.client.post(self.url, {
            "provider_account": self.account.id, "name": "web-01",
        }, format="json")
        self.assertEqual(clash.status_code, status.HTTP_400_BAD_REQUEST)

        ok = self.client.post(self.url, {
            "provider_account": self.other_account.id, "name": "web-01",
        }, format="json")
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)

    def test_an_account_with_servers_cannot_be_deleted(self):
        """PROTECT, because deleting the account would orphan a live machine."""
        Server.objects.create(provider_account=self.account, name="web-01")
        from django.db.models import ProtectedError

        with self.assertRaises(ProtectedError):
            self.account.delete()

    def test_orphan_filter_finds_servers_nothing_claims(self):
        Server.objects.create(provider_account=self.account, name="claimed",
                              property=self.property)
        Server.objects.create(provider_account=self.account, name="nobody-knows")
        response = self.client.get(self.url, {"orphan": "1"})
        self.assertEqual(
            [r["name"] for r in response.data["results"]], ["nobody-knows"]
        )

    def test_summary_counts_live_and_orphaned(self):
        Server.objects.create(provider_account=self.account, name="a", status="RUNNING")
        Server.objects.create(provider_account=self.account, name="b",
                              status="DECOMMISSIONED", property=self.property)
        response = self.client.get(reverse("estate-server-summary"))
        self.assertEqual(response.data["total"], 2)
        self.assertEqual(response.data["live"], 1)
        self.assertEqual(response.data["orphans"], 1)

    def test_a_decommissioned_server_is_not_live(self):
        server = Server.objects.create(
            provider_account=self.account, name="old", status="DECOMMISSIONED",
        )
        self.assertFalse(server.is_live)

    def test_the_console_url_falls_back_to_the_account(self):
        self.account.console_url = "https://console.aws.amazon.com"
        self.account.save()
        server = Server.objects.create(provider_account=self.account, name="web-01")
        self.assertEqual(
            server.effective_console_url, "https://console.aws.amazon.com"
        )

    def test_hosting_separates_a_box_in_the_office_from_one_in_a_region(self):
        response = self.client.post(self.url, {
            "provider_account": self.account.id, "name": "nas-01",
            "hosting": "ON_PREMISE",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["hosting_label"], "On-site")

    def test_a_hosting_type_added_in_settings_is_valid_on_save(self):
        """Callable choices, so an admin's addition needs no migration and no
        restart — the same contract Service.service_type has."""
        from core.models import ListOfValues

        ListOfValues.objects.create(
            group="estate_server_hosting", code="EDGE", label="Edge site",
        )
        estate.clear_type_cache()
        self.addCleanup(estate.clear_type_cache)

        self.assertIn("EDGE", estate.server_hosting_codes())
        response = self.client.post(self.url, {
            "provider_account": self.account.id, "name": "edge-01",
            "hosting": "EDGE",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        server = Server.objects.get(name="edge-01")
        server.full_clean()   # the model must accept it too, not just DRF

    def test_the_summary_breaks_down_by_hosting(self):
        Server.objects.create(provider_account=self.account, name="a", hosting="CLOUD")
        Server.objects.create(provider_account=self.account, name="b", hosting="ON_PREMISE")
        Server.objects.create(provider_account=self.account, name="c", hosting="ON_PREMISE")
        response = self.client.get(reverse("estate-server-summary"))
        counts = {row["hosting"]: row["count"] for row in response.data["by_hosting"]}
        self.assertEqual(counts, {"ON_PREMISE": 2, "CLOUD": 1})

    def test_expiry_is_stored_when_given(self):
        server = Server.objects.create(
            provider_account=self.account, name="prepaid",
            expires_on=date(2027, 3, 1),
        )
        self.assertEqual(server.expires_on, date(2027, 3, 1))
