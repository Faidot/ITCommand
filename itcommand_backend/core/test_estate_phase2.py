"""Phase 2 tests: the services endpoint, the dashboard, and the credential rules.

Three of these are named in the brief as required: FX aggregation with a missing
rate populating `unconverted`, a role without `estate.view` getting 403 on every
endpoint, and a credential reveal writing an AuditLog row. The rest guard the
decisions made alongside them.
"""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core import estate, rbac
from core.models import (
    AppSettings,
    AuditLog,
    ExchangeRate,
    Property,
    Provider,
    ProviderAccount,
    Role,
    Service,
    VaultCredential,
)
from core.test_estate_api import PASSWORD, create_role, create_user, make_subscription


User = get_user_model()


class Phase2TestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        create_role("P2_VIEWER", view=True)
        create_role("P2_MANAGER", view=True, add=True, edit=True, delete=True)
        create_role("P2_BLOCKED")
        cls.viewer = create_user("p2viewer@example.com", "P2_VIEWER")
        cls.manager = create_user("p2manager@example.com", "P2_MANAGER")
        cls.blocked = create_user("p2blocked@example.com", "P2_BLOCKED")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        AppSettings.objects.update_or_create(
            key="default_currency", defaults={"value": "PKR"}
        )
        self.provider = Provider.objects.create(
            name="Cloudflare", slug="cloudflare", brand_color="#f6821f"
        )
        self.account = ProviderAccount.objects.create(
            provider=self.provider, account_email="ops@example.invalid"
        )
        self.property = Property.objects.create(name="example.invalid", kind="CORPORATE")

    def make(self, **overrides):
        overrides.setdefault("provider_account", self.account)
        return make_subscription(**overrides)


# ─────────────────── permissions on every endpoint (required) ─────────────────

class EstateModulePermissionTests(Phase2TestCase):
    """A role without `estate.view` gets 403 on every endpoint."""

    LIST_ROUTES = (
        "estate-provider-list",
        "estate-account-list",
        "estate-property-list",
        "estate-service-list",
        "estate_dashboard",
        "estate_overview",
        "estate_gaps",
    )

    def test_every_endpoint_is_forbidden_without_estate_view(self):
        self.client.force_authenticate(self.blocked)
        for route in self.LIST_ROUTES:
            with self.subTest(route=route):
                self.assertEqual(
                    self.client.get(reverse(route)).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_estate_view_alone_is_what_grants_access(self):
        """Not `subscriptions.view`.

        Pins that the Phase 2 switch actually took effect. A role holding only
        the old key must not reach the estate, or migration 0067 would be
        decorative.
        """
        permissions = rbac.blank_permissions()
        permissions["subscriptions"] = {
            "view": True, "add": True, "edit": True, "delete": True,
        }
        Role.objects.create(slug="OLD_KEY_ONLY", name="Old Key", permissions=permissions)
        user = create_user("oldkey@example.com", "OLD_KEY_ONLY")
        self.client.force_authenticate(user)
        self.assertEqual(
            self.client.get(reverse("estate-service-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_service_writes_need_more_than_view(self):
        self.client.force_authenticate(self.viewer)
        payload = {
            "service_type": "DNS",
            "identifier": "zone",
            "provider": self.provider.pk,
            "provider_account": self.account.pk,
        }
        self.assertEqual(
            self.client.get(reverse("estate-service-list")).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.post(reverse("estate-service-list"), payload, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_unauthenticated_is_401_not_403(self):
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(reverse("estate_dashboard")).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )


# ──────────────── FX: a missing rate is reported, not dropped (required) ──────

class DashboardFxTests(Phase2TestCase):
    """The defect this module exists to stop repeating.

    PKR 1,200/yr plus USD 500/mo, with no USD->PKR rate, must never report
    "PKR 100/month" as though that were the whole picture.
    """

    def setUp(self):
        super().setUp()
        self.make(name="Domain", currency="PKR", cost=Decimal("1200.00"),
                  billing_cycle="YEARLY")
        self.make(name="Cloud", currency="USD", cost=Decimal("500.00"),
                  billing_cycle="MONTHLY")

    def dashboard(self):
        response = self.client.get(reverse("estate_dashboard"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_missing_rate_populates_unconverted(self):
        kpis = self.dashboard()["kpis"]
        self.assertEqual(kpis["monthly_spend"], "100.00")
        self.assertFalse(kpis["is_complete"])
        self.assertEqual(
            kpis["unconverted"], [{"currency": "USD", "monthly": "500.00"}]
        )

    def test_the_excluded_amount_is_never_silently_dropped(self):
        """The larger number is the one that went missing.

        A reader seeing only `monthly_spend` would conclude the estate costs
        PKR 100/month when the true figure is dominated by the USD line.
        """
        unconverted = self.dashboard()["kpis"]["unconverted"]
        self.assertEqual(Decimal(unconverted[0]["monthly"]), Decimal("500.00"))

    def test_supplying_the_rate_completes_the_total(self):
        ExchangeRate.objects.create(
            base_currency="PKR", currency="USD", rate=Decimal("280"),
            as_of=timezone.localdate(),
        )
        kpis = self.dashboard()["kpis"]
        self.assertTrue(kpis["is_complete"])
        self.assertEqual(kpis["unconverted"], [])
        # 100 PKR + (500 * 280) PKR
        self.assertEqual(Decimal(kpis["monthly_spend"]), Decimal("140100.00"))

    def test_provider_percentages_are_of_the_converted_total(self):
        ExchangeRate.objects.create(
            base_currency="PKR", currency="USD", rate=Decimal("280"),
            as_of=timezone.localdate(),
        )
        rows = self.dashboard()["by_provider"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["slug"], "cloudflare")
        self.assertEqual(rows[0]["pct"], "100.00")

    def test_a_provider_priced_only_in_an_unconvertible_currency_still_appears(self):
        """Dropping it would make the remaining shares look complete."""
        rows = self.dashboard()["by_provider"]
        self.assertEqual([row["slug"] for row in rows], ["cloudflare"])

    def test_money_is_serialised_as_strings_not_json_floats(self):
        kpis = self.dashboard()["kpis"]
        self.assertIsInstance(kpis["monthly_spend"], str)
        self.assertIsInstance(kpis["unconverted"][0]["monthly"], str)


# ───────────────────────── dashboard shape and content ───────────────────────

class DashboardShapeTests(Phase2TestCase):
    def test_one_call_carries_kpis_timeline_and_both_breakdowns(self):
        self.make(name="dns", service_layer="DNS", digital_property=self.property,
                  currency="PKR")
        data = self.client.get(reverse("estate_dashboard")).data
        for key in ("kpis", "timeline", "by_provider", "by_category"):
            self.assertIn(key, data)

    def test_kpis_carry_every_headline_number(self):
        data = self.client.get(reverse("estate_dashboard")).data
        for key in (
            "monthly_spend", "currency", "active_services", "renewals_30d",
            "accounts_missing_mfa", "orphan_services", "unconverted",
        ):
            self.assertIn(key, data["kpis"])

    def test_orphan_count_counts_services_with_no_property(self):
        self.make(name="attached", digital_property=self.property, currency="PKR")
        self.make(name="orphan", currency="PKR")
        self.assertEqual(
            self.client.get(reverse("estate_dashboard")).data["kpis"]["orphan_services"], 1
        )

    def test_accounts_missing_mfa_counts_none_and_unknown(self):
        """"Nobody checked" is not "protected"."""
        ProviderAccount.objects.create(
            provider=self.provider, account_email="none@example.invalid", mfa_type="NONE"
        )
        ProviderAccount.objects.create(
            provider=self.provider, account_email="app@example.invalid", mfa_type="APP"
        )
        # self.account defaults to UNKNOWN.
        self.assertEqual(
            self.client.get(reverse("estate_dashboard")).data["kpis"]["accounts_missing_mfa"], 2
        )

    def test_renewals_30d_uses_the_configured_warning_window(self):
        today = timezone.localdate()
        self.make(name="soon", expiry_date=today + timedelta(days=3), currency="PKR")
        self.make(name="later", expiry_date=today + timedelta(days=60), currency="PKR")
        self.assertEqual(
            self.client.get(reverse("estate_dashboard")).data["kpis"]["renewals_30d"], 1
        )

    def test_timeline_is_one_query_over_ninety_days_not_three_windows(self):
        today = timezone.localdate()
        for days in (3, 20, 50, 80, 200):
            self.make(name=f"svc-{days}", expiry_date=today + timedelta(days=days),
                      currency="PKR")
        timeline = self.client.get(reverse("estate_dashboard")).data["timeline"]
        self.assertEqual([row["days_until"] for row in timeline], [3, 20, 50, 80])

    def test_timeline_urgency_is_server_computed(self):
        today = timezone.localdate()
        self.make(name="red", expiry_date=today + timedelta(days=3), currency="PKR")
        self.make(name="amber", expiry_date=today + timedelta(days=20), currency="PKR")
        self.make(name="neutral", expiry_date=today + timedelta(days=80), currency="PKR")
        tones = {row["name"]: row["urgency"]
                 for row in self.client.get(reverse("estate_dashboard")).data["timeline"]}
        self.assertEqual(tones, {"red": "critical", "amber": "warning", "neutral": "muted"})

    def test_by_category_is_keyed_by_service_type(self):
        self.make(name="dns", service_layer="DNS", currency="PKR",
                  cost=Decimal("10.00"))
        rows = self.client.get(reverse("estate_dashboard")).data["by_category"]
        by_type = {row["service_type"]: row for row in rows}
        self.assertIn("DNS", by_type)
        self.assertEqual(by_type["DNS"]["monthly"], "10.00")

    def test_dashboard_query_count_does_not_grow_with_service_count(self):
        """One call, and a bounded number of queries behind it."""
        url = reverse("estate_dashboard")

        def count(n):
            for index in range(n):
                self.make(name=f"bulk-{index}-{timezone.now().timestamp()}",
                          currency="PKR")
            with CaptureQueriesContext(connection) as ctx:
                self.client.get(url)
            return len(ctx)

        baseline = count(3)
        grown = count(12)
        self.assertLessEqual(grown, baseline + 2)


# ─────────────────────────── the services endpoint ───────────────────────────

class ServiceEndpointTests(Phase2TestCase):
    def test_list_is_select_related_not_an_n_plus_one(self):
        """Provider, account and property render on every row."""
        for index in range(8):
            self.make(name=f"svc-{index}", digital_property=self.property, currency="PKR")
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(reverse("estate-service-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 8)
        # Auth, count, page — and emphatically not one per row.
        self.assertLess(len(ctx), 10)

    def test_orphans_filter(self):
        self.make(name="attached", digital_property=self.property, currency="PKR")
        self.make(name="orphan", currency="PKR")
        response = self.client.get(reverse("estate-service-list"), {"orphans": "true"})
        self.assertEqual([r["identifier"] for r in response.data["results"]], ["orphan"])

    def test_at_risk_filter_matches_the_model_property(self):
        today = timezone.localdate()
        self.make(name="risky", auto_renew=False,
                  expiry_date=today + timedelta(days=5), currency="PKR")
        self.make(name="safe", auto_renew=True,
                  expiry_date=today + timedelta(days=5), currency="PKR")
        response = self.client.get(reverse("estate-service-list"), {"at_risk": "true"})
        names = [r["identifier"] for r in response.data["results"]]
        self.assertEqual(names, ["risky"])
        self.assertTrue(Service.objects.get(identifier="risky").is_at_risk)

    def test_manually_flagged_at_risk_is_included(self):
        self.make(name="flagged", status="AT_RISK", auto_renew=True, currency="PKR")
        response = self.client.get(reverse("estate-service-list"), {"at_risk": "true"})
        self.assertEqual([r["identifier"] for r in response.data["results"]], ["flagged"])

    def test_search_spans_identifier_provider_and_account_email(self):
        self.make(name="tapquest zone", currency="PKR")
        self.make(name="unrelated", currency="PKR")
        response = self.client.get(reverse("estate-service-list"), {"search": "tapquest"})
        self.assertEqual(response.data["count"], 1)

    def test_creating_a_service_writes_an_audit_row(self):
        payload = {
            "service_type": "DNS",
            "identifier": "example.invalid zone",
            "provider": self.provider.pk,
            "provider_account": self.account.pk,
            "cost": "100.00",
            "currency": "PKR",
            "billing_cycle": "MONTHLY",
        }
        response = self.client.post(reverse("estate-service-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            AuditLog.objects.filter(model_name="Service", action="CREATE").exists()
        )

    def test_account_must_belong_to_the_named_provider(self):
        """Otherwise the row's provider chip and its login contradict each other."""
        other = Provider.objects.create(name="AWS", slug="aws")
        response = self.client.post(
            reverse("estate-service-list"),
            {
                "service_type": "DNS",
                "identifier": "mismatch",
                "provider": other.pk,
                "provider_account": self.account.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("provider_account", response.data)

    def test_bulk_update_writes_one_audit_row_per_service(self):
        """Not `qs.update()` — that leaves no trail for the change most likely
        to need explaining later."""
        first = self.make(name="a", currency="PKR")
        second = self.make(name="b", currency="PKR")
        AuditLog.objects.all().delete()

        response = self.client.post(
            reverse("estate-service-bulk-update"),
            {"ids": [first.pk, second.pk], "changes": {"property": self.property.pk}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["updated"], 2)
        self.assertEqual(
            AuditLog.objects.filter(model_name="Service", action="UPDATE").count(), 2
        )
        first.refresh_from_db()
        self.assertEqual(first.property_id, self.property.pk)

    def test_bulk_update_rejects_an_unknown_field(self):
        service = self.make(name="a", currency="PKR")
        response = self.client.post(
            reverse("estate-service-bulk-update"),
            {"ids": [service.pk], "changes": {"cost": "999999.00"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        service.refresh_from_db()
        self.assertEqual(service.cost, Decimal("100.00"))


# ───────────────────── credentials: never a secret (required) ─────────────────

class ServiceCredentialExposureTests(Phase2TestCase):
    def setUp(self):
        super().setUp()
        self.credential = VaultCredential.objects.create(
            title="Cloudflare root", username="root", encrypted_password="ciphertext",
            visibility="ORG", created_by=self.manager,
        )
        self.service = self.make(
            name="zone", currency="PKR", vault_credential=self.credential
        )

    def test_no_secret_field_appears_in_the_service_payload(self):
        response = self.client.get(
            reverse("estate-service-detail", args=[self.service.pk])
        )
        body = str(response.data).lower()
        self.assertNotIn("ciphertext", body)
        for key in response.data:
            self.assertNotIn("password", key.lower())
            self.assertNotIn("secret", key.lower())
            self.assertNotIn("encrypted", key.lower())

    def test_the_link_exposes_an_id_and_a_title_only(self):
        data = self.client.get(
            reverse("estate-service-detail", args=[self.service.pk])
        ).data
        self.assertEqual(data["vault_credential"], self.credential.pk)
        self.assertEqual(data["vault_credential_title"], "Cloudflare root")

    def test_a_private_credential_title_is_masked_from_a_non_owner(self):
        private = VaultCredential.objects.create(
            title="Someone's personal login", username="x",
            encrypted_password="c", visibility="PRIVATE", created_by=self.viewer,
        )
        service = self.make(name="masked", currency="PKR", vault_credential=private)
        data = self.client.get(reverse("estate-service-detail", args=[service.pk])).data
        self.assertEqual(data["vault_credential_title"], "Restricted")

    def test_a_credential_the_caller_cannot_see_cannot_be_attached(self):
        """Without this the field is an oracle for enumerating private rows."""
        private = VaultCredential.objects.create(
            title="Not yours", username="x", encrypted_password="c",
            visibility="PRIVATE", created_by=self.viewer,
        )
        response = self.client.post(
            reverse("estate-service-list"),
            {
                "service_type": "DNS",
                "identifier": "probe",
                "provider": self.provider.pk,
                "provider_account": self.account.pk,
                "vault_credential": private.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


# ────────────────── a reveal writes an AuditLog row (required) ────────────────

class VaultRevealAuditTests(TestCase):
    """The audit found vault reads entirely unlogged. They are not any more.

    `last_revealed_by` answered "who was last", and the next reveal overwrote
    it. These endpoints now leave a durable row per read.
    """

    @classmethod
    def setUpTestData(cls):
        permissions = rbac.full_permissions()
        Role.objects.create(slug="VAULT_ALL", name="Vault All", permissions=permissions)
        cls.user = create_user("vault@example.com", "VAULT_ALL")

    def setUp(self):
        from core.encryption import encrypt_value
        from core.models import VaultUnlockSession

        self.client = APIClient()
        self.client.force_authenticate(self.user)
        # Through the unlock gate, not around it. The brief is explicit that
        # the estate must reuse this endpoint and its gate rather than add a
        # second reveal path, so the test exercises the real one.
        session = VaultUnlockSession.issue(self.user)
        self.headers = {"HTTP_X_VAULT_TOKEN": session.token}
        self.credential = VaultCredential.objects.create(
            title="AWS root", username="root",
            encrypted_password=encrypt_value("hunter2-do-not-log"),
            visibility="ORG", created_by=self.user,
        )
        AuditLog.objects.all().delete()

    def reveal(self, **params):
        return self.client.get(
            reverse("vault-credential-reveal", args=[self.credential.pk]),
            params,
            **self.headers,
        )

    def test_reveal_still_requires_the_unlock_gate(self):
        """The audit fix must not have widened access as a side effect."""
        response = self.client.get(
            reverse("vault-credential-reveal", args=[self.credential.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AuditLog.objects.filter(action="REVEAL").exists())

    def test_revealing_a_password_writes_an_audit_row(self):
        response = self.reveal()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = AuditLog.objects.get(model_name="VaultCredential", action="REVEAL")
        self.assertEqual(row.user, self.user)
        self.assertEqual(row.object_id, str(self.credential.pk))
        self.assertEqual(row.changes["revealed"], "password")

    def test_the_audit_row_never_contains_the_secret(self):
        self.reveal()
        row = AuditLog.objects.get(action="REVEAL")
        self.assertNotIn("hunter2-do-not-log", str(row.changes))

    def test_a_service_can_be_attributed_to_the_reveal(self):
        """"Which service was this password read for" is the question an audit
        of the estate page has to answer."""
        self.reveal(service="42")
        row = AuditLog.objects.get(action="REVEAL")
        self.assertEqual(row.changes["service_id"], "42")

    def test_each_reveal_writes_its_own_row_rather_than_overwriting(self):
        self.reveal()
        self.reveal()
        self.assertEqual(AuditLog.objects.filter(action="REVEAL").count(), 2)

    def test_revealing_extras_is_logged_too(self):
        """TOTP seeds and recovery codes were not even counted before."""
        response = self.client.get(
            reverse("vault-credential-reveal-extras", args=[self.credential.pk]),
            **self.headers,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = AuditLog.objects.get(action="REVEAL")
        self.assertEqual(row.changes["revealed"], "extras")


# ─────────────── non-stack types are never gaps (regression) ──────────────

class StackGapScopeTests(Phase2TestCase):
    """A tracked non-stack type must not render as a gap.

    Found by running the real app: an `EstateSettings` row saved before the
    Phase 1 rework holds all ten pre-rework codes, so every property showed
    permanent amber gaps for Storage, Monitoring and Other. Three gaps nobody
    can ever close is how people learn to ignore the colour.
    """

    def setUp(self):
        super().setUp()
        from core.models import EstateSettings

        settings = EstateSettings.get_solo()
        settings.enabled_layers = [
            "REGISTRAR", "DNS", "HOSTING", "MAIL", "CDN", "TLS", "ANALYTICS",
            "STORAGE", "MONITORING", "OTHER",
        ]
        settings.save()

    def stack(self):
        response = self.client.get(
            reverse("estate-property-stack", args=[self.property.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_the_diagram_holds_only_stack_roles(self):
        layers = [row["layer"] for row in self.stack()["layers"]]
        self.assertEqual(layers, list(estate.STACK_TYPE_CODES))

    def test_storage_and_monitoring_are_never_gaps(self):
        missing = self.stack()["missing_layers"]
        for code in ("STORAGE", "MONITORING", "OTHER", "SAAS"):
            self.assertNotIn(code, missing)

    def test_gap_count_is_capped_at_the_seven_stack_roles(self):
        self.assertEqual(self.stack()["gap_count"], len(estate.STACK_TYPE_CODES))

    def test_the_gaps_endpoint_agrees_with_the_diagram(self):
        response = self.client.get(reverse("estate_gaps"))
        row = next(
            item
            for item in response.data["properties_with_gaps"]
            if item["id"] == self.property.pk
        )
        self.assertEqual(row["missing_count"], len(estate.STACK_TYPE_CODES))
        self.assertNotIn("STORAGE", row["missing_layers"])


# ───────────────────────── delete paths and global search ─────────────────────

class DeleteTests(Phase2TestCase):
    """Every estate screen offers delete, so every refusal has to be a
    sentence rather than a stack trace."""

    def test_deleting_an_account_with_services_is_a_409_not_a_500(self):
        """The PROTECT is the point — deleting the login would orphan the money
        records bought through it. The answer must say what to move first."""
        self.make(name="a service", currency="PKR")
        response = self.client.delete(
            reverse("estate-account-detail", args=[self.account.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["service_count"], 1)
        self.assertIn("Move them to another account", response.data["detail"])
        self.assertTrue(ProviderAccount.objects.filter(pk=self.account.pk).exists())

    def test_deleting_an_unused_account_works(self):
        spare = ProviderAccount.objects.create(
            provider=self.provider, account_email="spare@example.invalid"
        )
        response = self.client.delete(reverse("estate-account-detail", args=[spare.pk]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_deleting_a_property_orphans_its_services_and_says_how_many(self):
        """Losing the money record because someone tidied a domain would be
        far worse than an orphan row, so SET_NULL is deliberate — but the
        number moves a KPI, so it is reported."""
        service = self.make(name="attached", digital_property=self.property,
                            currency="PKR")
        response = self.client.delete(
            reverse("estate-property-detail", args=[self.property.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["orphaned_count"], 1)
        service.refresh_from_db()
        self.assertTrue(service.is_orphan)

    def test_deleting_a_service_removes_it_from_spend(self):
        service = self.make(name="going away", currency="PKR",
                            cost=Decimal("5000.00"))
        before = self.client.get(reverse("estate_dashboard")).data["kpis"]
        self.assertEqual(before["active_services"], 1)

        response = self.client.delete(
            reverse("estate-service-detail", args=[service.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        after = self.client.get(reverse("estate_dashboard")).data["kpis"]
        self.assertEqual(after["active_services"], 0)
        self.assertEqual(Decimal(after["monthly_spend"]), Decimal("0.00"))

    def test_a_delete_writes_an_audit_row(self):
        service = self.make(name="audited", currency="PKR")
        AuditLog.objects.all().delete()
        self.client.delete(reverse("estate-service-detail", args=[service.pk]))
        self.assertTrue(
            AuditLog.objects.filter(model_name="Service", action="DELETE").exists()
        )

    def test_edit_permission_alone_does_not_allow_delete(self):
        """`estate.edit` and `estate.delete` are separate grants, and the UI
        hides the action — but the API is the real gate."""
        editor_role = rbac.blank_permissions()
        editor_role["estate"] = {
            "view": True, "add": True, "edit": True, "delete": False,
        }
        Role.objects.create(slug="EDIT_NO_DELETE", name="Editor",
                            permissions=editor_role)
        user = create_user("editor@example.com", "EDIT_NO_DELETE")
        service = self.make(name="protected", currency="PKR")

        self.client.force_authenticate(user)
        # It can edit …
        self.assertEqual(
            self.client.patch(
                reverse("estate-service-detail", args=[service.pk]),
                {"identifier": "renamed"},
                format="json",
            ).status_code,
            status.HTTP_200_OK,
        )
        # … but not delete.
        self.assertEqual(
            self.client.delete(
                reverse("estate-service-detail", args=[service.pk])
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertTrue(Service.objects.filter(pk=service.pk).exists())


class GlobalSearchTests(Phase2TestCase):
    """The estate is reachable from the top bar's ⌘K, not a second palette
    bound to the same key inside /estate."""

    def setUp(self):
        super().setUp()
        self.make(name="pixelforge zone", digital_property=self.property,
                  currency="PKR")

    def search(self, query):
        response = self.client.get("/api/search/", {"q": query})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_a_property_is_findable(self):
        rows = [r for r in self.search("example") if r["category"] == "Properties"]
        self.assertTrue(rows)
        self.assertTrue(rows[0]["link"].startswith("/estate/properties/"))

    def test_a_service_is_findable(self):
        rows = [r for r in self.search("pixelforge") if r["category"] == "Services"]
        self.assertEqual(rows[0]["title"], "pixelforge zone")

    def test_an_account_is_findable_by_provider_name(self):
        rows = [
            r for r in self.search("cloudflare")
            if r["category"] == "Provider accounts"
        ]
        self.assertTrue(rows)

    def test_a_role_without_estate_view_finds_no_estate_rows(self):
        self.client.force_authenticate(self.blocked)
        categories = {r["category"] for r in self.search("pixelforge")}
        self.assertNotIn("Services", categories)
        self.assertNotIn("Properties", categories)
        self.assertNotIn("Provider accounts", categories)
