"""Phase 2 tests: the Digital Estate API.

The five the brief demands, plus the ones that protect decisions made in Phase 1:
that `active_q` cannot drift from `effective_status`, that a vault secret has no
path into these responses, and that a partial currency total always says so.
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
from core.estate_reports import active_q, spend_by_currency
from core.models import (
    AppSettings,
    Property,
    ExchangeRate,
    Provider,
    ProviderAccount,
    Role,
    Subscription,
    VaultCredential,
)


User = get_user_model()

PASSWORD = "EstateApiTestPassword!1"


def create_role(slug, *, view=False, add=False, edit=False, delete=False):
    permissions = rbac.blank_permissions()
    permissions["subscriptions"] = {
        "view": view,
        "add": add,
        "edit": edit,
        "delete": delete,
    }
    return Role.objects.create(
        slug=slug, name=slug.replace("_", " ").title(), permissions=permissions
    )


def create_user(email, role):
    return User.objects.create_user(
        email=email, password=PASSWORD, full_name=email.split("@")[0].title(), role=role
    )


def make_subscription(**overrides):
    today = timezone.localdate()
    fields = {
        "name": "Service",
        "platform": "Platform",
        "cost": Decimal("100.00"),
        "currency": "USD",
        "billing_cycle": "MONTHLY",
        "start_date": today - timedelta(days=30),
        "expiry_date": today + timedelta(days=180),
        "status": "ACTIVE",
        "auto_renew": True,
    }
    fields.update(overrides)
    return Subscription.objects.create(**fields)


class EstateApiTestCase(TestCase):
    """Shared fixtures: a reader, a writer, and a role with no estate sight."""

    @classmethod
    def setUpTestData(cls):
        create_role("ESTATE_VIEWER", view=True)
        create_role("ESTATE_MANAGER", view=True, add=True, edit=True, delete=True)
        create_role("ESTATE_BLOCKED")
        cls.viewer = create_user("viewer@example.com", "ESTATE_VIEWER")
        cls.manager = create_user("manager@example.com", "ESTATE_MANAGER")
        cls.blocked = create_user("blocked@example.com", "ESTATE_BLOCKED")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.manager)


# ───────────────────────────── permissions (required) ─────────────────────────

class EstatePermissionTests(EstateApiTestCase):
    """A role without `subscriptions.view` gets 403 on every new endpoint."""

    READ_ROUTES = (
        "estate-provider-list",
        "estate-account-list",
        "estate-property-list",
        "estate-provider-layers",
        "estate-account-mfa-summary",
        "estate-property-stacks",
        "estate_overview",
        "estate_gaps",
    )

    def setUp(self):
        super().setUp()
        self.provider = Provider.objects.create(name="AWS", slug="aws")
        self.property = Property.objects.create(
            name="example.com", kind="CORPORATE"
        )

    def test_every_read_endpoint_is_forbidden_without_view(self):
        self.client.force_authenticate(self.blocked)
        for route in self.READ_ROUTES:
            with self.subTest(route=route):
                self.assertEqual(
                    self.client.get(reverse(route)).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_detail_and_stack_are_forbidden_without_view(self):
        self.client.force_authenticate(self.blocked)
        for route, args in (
            ("estate-provider-detail", [self.provider.pk]),
            ("estate-property-detail", [self.property.pk]),
            ("estate-property-stack", [self.property.pk]),
        ):
            with self.subTest(route=route):
                self.assertEqual(
                    self.client.get(reverse(route, args=args)).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_every_read_endpoint_requires_authentication(self):
        self.client.force_authenticate(None)
        for route in self.READ_ROUTES:
            with self.subTest(route=route):
                self.assertEqual(
                    self.client.get(reverse(route)).status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )

    def test_view_only_role_can_read_but_not_write(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.client.get(reverse("estate-provider-list")).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.post(
                reverse("estate-provider-list"), {"name": "Fly.io"}, format="json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.delete(
                reverse("estate-provider-detail", args=[self.provider.pk])
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_manager_role_can_write(self):
        response = self.client.post(
            reverse("estate-property-list"),
            {"name": "newsite.io", "kind": "MARKETING"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


# ───────────────────────── active scope drift guard ──────────────────────────

class ActiveScopeTests(EstateApiTestCase):
    """`active_q` is SQL; `effective_status` is Python. They must agree."""

    def test_sql_active_filter_matches_the_python_property_row_for_row(self):
        today = timezone.localdate()
        make_subscription(name="active")
        make_subscription(
            name="expired",
            start_date=today - timedelta(days=400),
            expiry_date=today - timedelta(days=1),
        )
        make_subscription(
            name="scheduled",
            start_date=today + timedelta(days=5),
            expiry_date=today + timedelta(days=100),
        )
        make_subscription(name="paused", status="PAUSED")
        make_subscription(name="cancelled", status="CANCELLED")
        make_subscription(name="expires_today", expiry_date=today)
        make_subscription(name="starts_today", start_date=today)

        from_sql = set(
            Subscription.objects.filter(active_q(today)).values_list("name", flat=True)
        )
        from_python = {
            s.name
            for s in Subscription.objects.all()
            if s.effective_status == "ACTIVE"
        }
        self.assertEqual(from_sql, from_python)
        self.assertEqual(
            from_sql, {"active", "expires_today", "starts_today"}
        )


# ───────────────────── money: Decimal, never float (required) ────────────────

class MoneyAggregationTests(EstateApiTestCase):
    def test_spend_by_currency_returns_decimals_for_every_cycle(self):
        make_subscription(name="m", cost=Decimal("100.00"), billing_cycle="MONTHLY")
        make_subscription(
            name="y", cost=Decimal("1200.00"), billing_cycle="YEARLY", currency="USD"
        )
        rows = spend_by_currency(Subscription.objects.filter(active_q()))
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertIsInstance(row["monthly"], Decimal)
        self.assertIsInstance(row["yearly"], Decimal)
        self.assertNotIsInstance(row["monthly"], float)
        # 100/mo + 1200/yr == 200/mo == 2400/yr
        self.assertEqual(row["monthly"], Decimal("200"))
        self.assertEqual(row["yearly"], Decimal("2400"))
        self.assertEqual(row["count"], 2)

    def test_yearly_only_spend_is_divided_exactly_once(self):
        make_subscription(cost=Decimal("1200.00"), billing_cycle="YEARLY")
        rows = spend_by_currency(Subscription.objects.filter(active_q()))
        self.assertEqual(rows[0]["monthly"], Decimal("100"))

    def test_api_serialises_money_as_strings_not_json_floats(self):
        make_subscription(cost=Decimal("0.01"), billing_cycle="MONTHLY")
        response = self.client.get(reverse("estate_overview"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        monthly = response.data["total_spend"]["monthly"]
        self.assertIsInstance(monthly, str)
        self.assertEqual(monthly, "0.01")

    def test_currencies_are_grouped_separately_before_conversion(self):
        make_subscription(name="usd", currency="USD", cost=Decimal("10.00"))
        make_subscription(name="pkr", currency="PKR", cost=Decimal("20.00"))
        rows = spend_by_currency(Subscription.objects.filter(active_q()))
        self.assertEqual([r["currency"] for r in rows], ["PKR", "USD"])

    def test_inactive_subscriptions_are_excluded_from_spend(self):
        make_subscription(name="live", cost=Decimal("10.00"))
        make_subscription(name="dead", cost=Decimal("999.00"), status="CANCELLED")
        rows = spend_by_currency(Subscription.objects.filter(active_q()))
        self.assertEqual(rows[0]["monthly"], Decimal("10"))


# ──────────────── FX with a missing rate (required) ───────────────────────────

class FxTruncationTests(EstateApiTestCase):
    """The bug this module exists to stop repeating.

    A PKR 1,200/yr service plus a USD 500/mo service, with no USD->PKR rate, must
    never report "PKR 100/month" as if that were everything.
    """

    def setUp(self):
        super().setUp()
        AppSettings.objects.update_or_create(
            key="default_currency", defaults={"value": "PKR"}
        )
        make_subscription(
            name="Domain", currency="PKR", cost=Decimal("1200.00"), billing_cycle="YEARLY"
        )
        make_subscription(
            name="Cloud", currency="USD", cost=Decimal("500.00"), billing_cycle="MONTHLY"
        )

    def test_missing_rate_populates_the_unconvertible_block(self):
        response = self.client.get(reverse("estate_overview"))
        spend = response.data["total_spend"]

        self.assertEqual(spend["currency"], "PKR")
        self.assertEqual(spend["monthly"], "100.00")
        self.assertFalse(spend["is_complete"])
        self.assertEqual(len(spend["unconvertible"]), 1)
        excluded = spend["unconvertible"][0]
        self.assertEqual(excluded["currency"], "USD")
        self.assertEqual(excluded["amount"], "500.00")
        self.assertEqual(excluded["yearly_amount"], "6000.00")

    def test_coverage_says_how_many_currencies_made_it_in(self):
        response = self.client.get(reverse("estate_overview"))
        coverage = response.data["total_spend"]["coverage"]
        self.assertEqual(coverage["converted_currencies"], 1)
        self.assertEqual(coverage["total_currencies"], 2)
        self.assertEqual(coverage["excluded_currencies"], ["USD"])

    def test_the_excluded_amount_is_never_silently_dropped(self):
        """The larger figure must be reachable from the response, not just absent."""
        response = self.client.get(reverse("estate_overview"))
        by_currency = {
            row["currency"]: row for row in response.data["spend_by_currency"]
        }
        self.assertEqual(by_currency["USD"]["monthly"], "500.00")
        self.assertEqual(by_currency["PKR"]["monthly"], "100.00")

    def test_supplying_the_rate_completes_the_total(self):
        ExchangeRate.objects.create(
            base_currency="PKR",
            currency="USD",
            rate=Decimal("280.0000000000"),
            as_of=timezone.localdate(),
        )
        response = self.client.get(reverse("estate_overview"))
        spend = response.data["total_spend"]
        self.assertTrue(spend["is_complete"])
        self.assertEqual(spend["unconvertible"], [])
        # 100 PKR + (500 USD * 280) == 140,100 PKR / month
        self.assertEqual(spend["monthly"], "140100.00")

    def test_per_provider_spend_carries_its_own_completeness_flag(self):
        provider = Provider.objects.create(name="AWS", slug="aws")
        account = ProviderAccount.objects.create(
            provider=provider, account_email="root@example.com"
        )
        Subscription.objects.filter(name="Cloud").update(provider_account=account)

        response = self.client.get(reverse("estate_overview"))
        rows = {row["provider_name"]: row for row in response.data["spend_by_provider"]}
        self.assertFalse(rows["AWS"]["spend"]["is_complete"])
        excluded = rows["AWS"]["spend"]["unconvertible"]
        self.assertEqual(len(excluded), 1)
        self.assertEqual(excluded[0]["currency"], "USD")
        self.assertEqual(excluded[0]["amount"], "500.00")

    def test_a_provider_priced_only_in_an_unconvertible_currency_is_still_listed(self):
        provider = Provider.objects.create(name="AWS", slug="aws")
        account = ProviderAccount.objects.create(
            provider=provider, account_email="root@example.com"
        )
        Subscription.objects.filter(name="Cloud").update(provider_account=account)
        response = self.client.get(reverse("estate_overview"))
        names = [row["provider_name"] for row in response.data["spend_by_provider"]]
        self.assertIn("AWS", names)


# ─────────────── stack gaps: 0, some, all layers (required) ──────────────────

class StackGapTests(EstateApiTestCase):
    def setUp(self):
        super().setUp()
        self.provider = Provider.objects.create(name="Cloudflare", slug="cloudflare")
        self.account = ProviderAccount.objects.create(
            provider=self.provider, account_email="devops@example.com"
        )
        self.property = Property.objects.create(
            name="example.com", kind="CORPORATE"
        )

    def _attach(self, layer, **overrides):
        fields = {
            "name": f"{layer} service",
            "service_layer": layer,
            "digital_property": self.property,
            "provider_account": self.account,
        }
        fields.update(overrides)
        return make_subscription(**fields)

    def _stack(self):
        response = self.client.get(
            reverse("estate-property-stack", args=[self.property.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_property_with_zero_layers_reports_every_required_layer_as_a_gap(self):
        data = self._stack()
        self.assertEqual(data["gap_count"], len(estate.REQUIRED_LAYERS))
        self.assertEqual(set(data["missing_layers"]), set(estate.REQUIRED_LAYERS))
        self.assertTrue(all(not row["configured"] for row in data["layers"]))

    def test_every_tracked_layer_is_returned_even_when_empty(self):
        """The stack shows the layers this org tracks, in its configured order.

        Not the whole catalog: since Phase 4, tracking a layer is what makes an
        empty one a gap, so an untracked layer has no empty slot to show. The
        default tracked set is the seven required ones.
        """
        data = self._stack()
        self.assertEqual(len(data["layers"]), len(estate.REQUIRED_LAYERS))
        self.assertEqual(
            [row["layer"] for row in data["layers"]], list(estate.REQUIRED_LAYERS)
        )
        self.assertTrue(all(row["is_tracked"] for row in data["layers"]))

    def test_property_with_some_layers_reports_only_the_rest(self):
        self._attach("REGISTRAR")
        self._attach("DNS")
        data = self._stack()
        self.assertEqual(data["gap_count"], len(estate.REQUIRED_LAYERS) - 2)
        self.assertNotIn("REGISTRAR", data["missing_layers"])
        self.assertNotIn("DNS", data["missing_layers"])
        configured = {row["layer"] for row in data["layers"] if row["configured"]}
        self.assertEqual(configured, {"REGISTRAR", "DNS"})

    def test_property_with_all_required_layers_has_no_gaps(self):
        for layer in estate.REQUIRED_LAYERS:
            self._attach(layer)
        data = self._stack()
        self.assertEqual(data["gap_count"], 0)
        self.assertEqual(data["missing_layers"], [])

    def test_untracked_layer_shows_no_empty_slot(self):
        """Storage is off by default, so it does not clutter every property."""
        data = self._stack()
        self.assertNotIn("STORAGE", [row["layer"] for row in data["layers"]])

    def test_untracked_layer_still_shows_a_service_bound_to_it(self):
        """Turning a layer off must hide the empty slot, never the money.

        A service on an untracked layer is real spend; dropping it from the
        stack because of a settings change would make it invisible everywhere
        except the orphan report, which it is not.
        """
        self._attach("STORAGE", name="S3 bucket")
        data = self._stack()
        storage = next(row for row in data["layers"] if row["layer"] == "STORAGE")
        self.assertFalse(storage["is_tracked"])
        self.assertFalse(storage["is_gap"])
        self.assertTrue(storage["configured"])
        self.assertEqual(storage["services"][0]["name"], "S3 bucket")

    def test_expired_service_does_not_fill_a_layer(self):
        today = timezone.localdate()
        self._attach(
            "REGISTRAR",
            start_date=today - timedelta(days=400),
            expiry_date=today - timedelta(days=1),
        )
        data = self._stack()
        self.assertIn("REGISTRAR", data["missing_layers"])

    def test_two_services_on_one_layer_are_both_returned(self):
        self._attach("DNS")
        self._attach("DNS", name="second dns")
        data = self._stack()
        dns = next(row for row in data["layers"] if row["layer"] == "DNS")
        self.assertEqual(dns["service_count"], 2)
        self.assertEqual(len(dns["services"]), 2)

    def test_service_on_the_property_with_no_layer_is_surfaced_not_hidden(self):
        self._attach(None, name="unplaced")
        data = self._stack()
        self.assertEqual(data["unassigned_count"], 1)
        self.assertEqual(data["unassigned_services"][0]["name"], "unplaced")

    def test_stacks_query_count_does_not_grow_with_the_number_of_properties(self):
        """The property cards are the Estate tab's centrepiece and load on sight.

        One spend query per card would make the page cost O(properties). Pinned
        with a real assertion rather than a comment, because this is exactly the
        kind of thing a later 'small refactor' reintroduces.
        """
        url = reverse("estate-property-stacks")

        def add_properties(start, stop):
            for index in range(start, stop):
                prop = Property.objects.create(name=f"p{index}.io", kind="APP")
                make_subscription(
                    name=f"svc-{index}", digital_property=prop, service_layer="DNS"
                )

        def count_queries():
            with CaptureQueriesContext(connection) as captured:
                response = self.client.get(url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            return len(captured.captured_queries), len(response.data["results"])

        add_properties(0, 3)
        # Warm up first: the very first request also materialises singletons and
        # settings rows, which is a one-off cost, not per-property work. Measuring
        # a cold call against a warm one compares the wrong two things.
        count_queries()
        few_queries, few_rows = count_queries()

        add_properties(3, 15)
        many_queries, many_rows = count_queries()

        self.assertGreater(many_rows, few_rows)
        self.assertEqual(
            few_queries,
            many_queries,
            f"query count grew from {few_queries} to {many_queries} when properties "
            f"went from {few_rows} to {many_rows} — an N+1 has been reintroduced",
        )

    def test_stacks_list_returns_one_row_per_active_property(self):
        other = Property.objects.create(name="second.io", kind="APP")
        Property.objects.create(name="retired.io", kind="PARKED", is_active=False)
        self._attach("REGISTRAR")
        response = self.client.get(reverse("estate-property-stacks"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {row["name"] for row in response.data["results"]}
        self.assertEqual(names, {"example.com", "second.io"})
        row = next(r for r in response.data["results"] if r["name"] == "example.com")
        self.assertEqual(row["gap_count"], len(estate.REQUIRED_LAYERS) - 1)
        self.assertEqual(len(row["layers"]), len(estate.SERVICE_LAYERS))
        self.assertIn("is_complete", row["spend"])
        self.assertEqual(other.subscriptions.count(), 0)


class EstateGapsEndpointTests(EstateApiTestCase):
    def setUp(self):
        super().setUp()
        self.property = Property.objects.create(
            name="example.com", kind="CORPORATE"
        )

    def test_orphaned_service_is_listed(self):
        make_subscription(name="mystery charge")
        response = self.client.get(reverse("estate_gaps"))
        self.assertEqual(response.data["orphan_count"], 1)
        self.assertEqual(
            response.data["orphaned_services"][0]["name"], "mystery charge"
        )

    def test_bound_service_is_not_an_orphan(self):
        make_subscription(digital_property=self.property, service_layer="DNS")
        response = self.client.get(reverse("estate_gaps"))
        self.assertEqual(response.data["orphan_count"], 0)

    def test_property_with_gaps_is_listed_with_its_missing_layers(self):
        make_subscription(digital_property=self.property, service_layer="REGISTRAR")
        response = self.client.get(reverse("estate_gaps"))
        self.assertEqual(response.data["property_gap_count"], 1)
        row = response.data["properties_with_gaps"][0]
        self.assertEqual(row["name"], "example.com")
        self.assertNotIn("REGISTRAR", row["missing_layers"])
        self.assertEqual(row["missing_count"], len(estate.REQUIRED_LAYERS) - 1)

    def test_fully_configured_property_disappears_from_gaps(self):
        for layer in estate.REQUIRED_LAYERS:
            make_subscription(
                name=layer, digital_property=self.property, service_layer=layer
            )
        response = self.client.get(reverse("estate_gaps"))
        self.assertEqual(response.data["property_gap_count"], 0)

    def test_inactive_property_is_not_reported_as_a_gap(self):
        Property.objects.filter(pk=self.property.pk).update(is_active=False)
        response = self.client.get(reverse("estate_gaps"))
        self.assertEqual(response.data["property_gap_count"], 0)

    def test_worst_property_is_listed_first(self):
        worse = Property.objects.create(name="bare.io", kind="APP")
        for layer in estate.REQUIRED_LAYERS[:-1]:
            make_subscription(
                name=layer, digital_property=self.property, service_layer=layer
            )
        response = self.client.get(reverse("estate_gaps"))
        self.assertEqual(
            response.data["properties_with_gaps"][0]["name"], worse.name
        )


# ─────────────────────── vault secrets must not leak ─────────────────────────

class VaultCredentialExposureTests(EstateApiTestCase):
    def setUp(self):
        super().setUp()
        self.provider = Provider.objects.create(name="AWS", slug="aws")

    def _make_credential(self, **overrides):
        fields = {
            "title": "AWS root login",
            "username": "root@example.com",
            "encrypted_password": "not-a-real-ciphertext",
            "visibility": "ORG",
        }
        fields.update(overrides)
        return VaultCredential.objects.create(**fields)

    def test_no_secret_field_appears_anywhere_in_the_account_payload(self):
        credential = self._make_credential()
        ProviderAccount.objects.create(
            provider=self.provider,
            account_email="root@example.com",
            vault_credential=credential,
        )
        response = self.client.get(reverse("estate-account-list"))
        body = response.content.decode()
        for forbidden in (
            "encrypted_password",
            "not-a-real-ciphertext",
            "encrypted_totp_secret",
            "encrypted_recovery_codes",
            "encrypted_custom_fields",
            "masked_password",
        ):
            self.assertNotIn(forbidden, body)

    def test_org_visible_credential_title_is_shown(self):
        credential = self._make_credential()
        ProviderAccount.objects.create(
            provider=self.provider,
            account_email="root@example.com",
            vault_credential=credential,
        )
        response = self.client.get(reverse("estate-account-list"))
        self.assertEqual(
            response.data["results"][0]["vault_credential_title"], "AWS root login"
        )

    def test_private_credential_title_is_masked_from_a_non_owner(self):
        credential = self._make_credential(
            title="Secret ops account", visibility="PRIVATE", created_by=self.viewer
        )
        ProviderAccount.objects.create(
            provider=self.provider,
            account_email="root@example.com",
            vault_credential=credential,
        )
        response = self.client.get(reverse("estate-account-list"))
        row = response.data["results"][0]
        self.assertEqual(row["vault_credential_title"], "Restricted")
        self.assertNotIn("Secret ops account", response.content.decode())
        # The link itself is still visible, so the account does not read as unlinked.
        self.assertEqual(row["vault_credential"], credential.pk)

    def test_owner_still_sees_their_own_private_credential_title(self):
        credential = self._make_credential(
            title="My ops account", visibility="PRIVATE", created_by=self.manager
        )
        ProviderAccount.objects.create(
            provider=self.provider,
            account_email="root@example.com",
            vault_credential=credential,
        )
        response = self.client.get(reverse("estate-account-list"))
        self.assertEqual(
            response.data["results"][0]["vault_credential_title"], "My ops account"
        )

    def test_cannot_attach_a_private_credential_belonging_to_someone_else(self):
        """Otherwise the field is an oracle for enumerating private vault rows."""
        credential = self._make_credential(
            title="Someone else's", visibility="PRIVATE", created_by=self.viewer
        )
        response = self.client.post(
            reverse("estate-account-list"),
            {
                "provider": self.provider.pk,
                "login_email": "new@example.com",
                "vault_credential": credential.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("vault_credential", response.data)


# ───────────────────────────── CRUD behaviour ─────────────────────────────────

class ProviderCrudTests(EstateApiTestCase):
    def test_slug_is_derived_from_the_name_when_omitted(self):
        response = self.client.post(
            reverse("estate-provider-list"), {"name": "Fly.io"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["slug"], "flyio")

    def test_duplicate_derived_slug_is_a_400_not_a_500(self):
        Provider.objects.create(name="Fly", slug="flyio")
        response = self.client.post(
            reverse("estate-provider-list"), {"name": "Fly.io"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("slug", response.data)

    def test_deleting_a_provider_with_accounts_is_a_409_not_a_500(self):
        provider = Provider.objects.create(name="AWS", slug="aws")
        ProviderAccount.objects.create(
            provider=provider, account_email="root@example.com"
        )
        response = self.client.delete(
            reverse("estate-provider-detail", args=[provider.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["account_count"], 1)
        self.assertTrue(Provider.objects.filter(pk=provider.pk).exists())

    def test_deleting_an_unused_provider_works(self):
        provider = Provider.objects.create(name="Vercel", slug="vercel")
        response = self.client.delete(
            reverse("estate-provider-detail", args=[provider.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_layers_endpoint_serves_the_stack_order(self):
        response = self.client.get(reverse("estate-provider-layers"))
        self.assertEqual(
            [row["layer"] for row in response.data],
            [code for code, _ in estate.SERVICE_LAYERS],
        )
        self.assertTrue(response.data[0]["is_required"])
        self.assertFalse(response.data[-1]["is_required"])

    def test_account_count_is_annotated(self):
        provider = Provider.objects.create(name="AWS", slug="aws")
        ProviderAccount.objects.create(provider=provider, account_email="a@example.com")
        ProviderAccount.objects.create(provider=provider, account_email="b@example.com")
        response = self.client.get(reverse("estate-provider-list"))
        self.assertEqual(response.data["results"][0]["account_count"], 2)


class ProviderAccountCrudTests(EstateApiTestCase):
    def setUp(self):
        super().setUp()
        self.provider = Provider.objects.create(
            name="AWS", slug="aws", console_url="https://console.aws.amazon.com"
        )

    def test_duplicate_login_at_one_provider_is_a_400_not_a_500(self):
        """The DB constraint surfaces through DRF's UniqueTogetherValidator.

        It lands in `non_field_errors`, not on `login_email` — the serializer
        deliberately does not duplicate the rule to field-scope it. Pinned here
        so the Phase 3 form knows where to look for the message.
        """
        ProviderAccount.objects.create(
            provider=self.provider, account_email="root@example.com"
        )
        response = self.client.post(
            reverse("estate-account-list"),
            {"provider": self.provider.pk, "login_email": "root@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("non_field_errors", response.data)
        self.assertEqual(ProviderAccount.objects.count(), 1)

    def test_mfa_severity_travels_with_the_row(self):
        ProviderAccount.objects.create(
            provider=self.provider, account_email="legacy@example.com", mfa_type="NONE"
        )
        response = self.client.get(reverse("estate-account-list"))
        row = response.data["results"][0]
        self.assertEqual(row["mfa_severity"], "critical")
        self.assertFalse(row["has_mfa"])

    def test_effective_console_url_falls_back_to_the_provider(self):
        ProviderAccount.objects.create(
            provider=self.provider, account_email="root@example.com"
        )
        response = self.client.get(reverse("estate-account-list"))
        self.assertEqual(
            response.data["results"][0]["effective_console_url"],
            "https://console.aws.amazon.com",
        )

    def test_missing_mfa_filter_finds_none_and_unknown(self):
        ProviderAccount.objects.create(
            provider=self.provider, account_email="a@example.com", mfa_type="NONE"
        )
        ProviderAccount.objects.create(
            provider=self.provider, account_email="b@example.com", mfa_type="UNKNOWN"
        )
        ProviderAccount.objects.create(
            provider=self.provider, account_email="c@example.com", mfa_type="APP"
        )
        response = self.client.get(
            reverse("estate-account-list"), {"missing_mfa": "true"}
        )
        self.assertEqual(response.data["count"], 2)

    def test_mfa_summary_counts_and_severities(self):
        ProviderAccount.objects.create(
            provider=self.provider, account_email="a@example.com", mfa_type="NONE"
        )
        ProviderAccount.objects.create(
            provider=self.provider, account_email="b@example.com", mfa_type="SMS"
        )
        response = self.client.get(reverse("estate-account-mfa-summary"))
        by_method = {row["mfa_method"]: row for row in response.data["methods"]}
        self.assertEqual(by_method["NONE"]["count"], 1)
        self.assertEqual(by_method["NONE"]["severity"], "critical")
        self.assertEqual(by_method["SMS"]["severity"], "warning")
        self.assertEqual(response.data["unprotected"], 1)
        self.assertEqual(response.data["total"], 2)

    def test_service_count_is_annotated(self):
        account = ProviderAccount.objects.create(
            provider=self.provider, account_email="root@example.com"
        )
        make_subscription(provider_account=account)
        response = self.client.get(reverse("estate-account-list"))
        self.assertEqual(response.data["results"][0]["service_count"], 1)


class PropertyCrudTests(EstateApiTestCase):
    def test_name_is_normalised_on_create(self):
        response = self.client.post(
            reverse("estate-property-list"),
            {"name": "  Example.COM ", "kind": "CORPORATE"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "example.com")

    def test_duplicate_name_is_a_400_not_an_integrity_error(self):
        Property.objects.create(name="example.com", kind="CORPORATE")
        response = self.client.post(
            reverse("estate-property-list"),
            {"name": "EXAMPLE.COM", "kind": "APP"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.data)

    def test_deleting_a_property_orphans_its_services_and_says_how_many(self):
        prop = Property.objects.create(name="example.com", kind="CORPORATE")
        subscription = make_subscription(digital_property=prop)
        response = self.client.delete(
            reverse("estate-property-detail", args=[prop.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["orphaned_count"], 1)
        subscription.refresh_from_db()
        self.assertTrue(subscription.is_orphan)

    def test_kind_filter(self):
        Property.objects.create(name="game.gg", kind="MOBILE_GAME")
        Property.objects.create(name="corp.com", kind="CORPORATE")
        response = self.client.get(
            reverse("estate-property-list"), {"kind": "MOBILE_GAME"}
        )
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "game.gg")


# ───────────────────────────── overview shape ────────────────────────────────

class OverviewTests(EstateApiTestCase):
    def setUp(self):
        super().setUp()
        self.provider = Provider.objects.create(
            name="Namecheap", slug="namecheap", brand_color="#ff6c2c"
        )
        self.account = ProviderAccount.objects.create(
            provider=self.provider, account_email="domains@example.com", mfa_type="NONE"
        )
        self.property = Property.objects.create(
            name="example.com", kind="CORPORATE"
        )

    def test_kpis_are_present_and_counted(self):
        make_subscription(
            name="domain",
            digital_property=self.property,
            provider_account=self.account,
            service_layer="REGISTRAR",
        )
        make_subscription(name="orphan", provider_account=self.account)
        response = self.client.get(reverse("estate_overview"))
        kpis = response.data["kpis"]
        self.assertEqual(kpis["service_count"], 2)
        self.assertEqual(kpis["property_count"], 1)
        self.assertEqual(kpis["account_count"], 1)
        self.assertEqual(kpis["orphan_count"], 1)
        self.assertEqual(kpis["accounts_without_mfa"], 1)
        self.assertEqual(kpis["stack_gap_count"], len(estate.REQUIRED_LAYERS) - 1)

    def test_at_risk_counts_only_non_auto_renewing_soon_expiring_services(self):
        today = timezone.localdate()
        make_subscription(
            name="at risk", auto_renew=False, expiry_date=today + timedelta(days=5)
        )
        make_subscription(
            name="safe", auto_renew=True, expiry_date=today + timedelta(days=5)
        )
        make_subscription(
            name="far off", auto_renew=False, expiry_date=today + timedelta(days=200)
        )
        response = self.client.get(reverse("estate_overview"))
        self.assertEqual(response.data["kpis"]["at_risk_count"], 1)
        self.assertEqual(response.data["at_risk_services"][0]["name"], "at risk")

    def test_timeline_is_ordered_and_carries_server_computed_urgency(self):
        today = timezone.localdate()
        make_subscription(name="soon", expiry_date=today + timedelta(days=3))
        make_subscription(name="later", expiry_date=today + timedelta(days=20))
        make_subscription(name="much later", expiry_date=today + timedelta(days=60))
        make_subscription(name="outside", expiry_date=today + timedelta(days=200))

        response = self.client.get(reverse("estate_overview"))
        timeline = response.data["renewal_timeline"]
        self.assertEqual([row["name"] for row in timeline], ["soon", "later", "much later"])
        self.assertEqual(timeline[0]["urgency"], "critical")
        self.assertEqual(timeline[1]["urgency"], "warning")
        self.assertEqual(timeline[2]["urgency"], "muted")

    def test_timeline_window_is_configurable_and_clamped(self):
        today = timezone.localdate()
        make_subscription(name="far", expiry_date=today + timedelta(days=200))
        response = self.client.get(reverse("estate_overview"), {"days": "365"})
        self.assertEqual(len(response.data["renewal_timeline"]), 1)
        self.assertEqual(response.data["thresholds"]["timeline_window_days"], 365)

        response = self.client.get(reverse("estate_overview"), {"days": "not-a-number"})
        self.assertEqual(
            response.data["thresholds"]["timeline_window_days"],
            estate.TIMELINE_WINDOW_DAYS,
        )

    def test_spend_by_layer_is_in_stack_order_not_by_size(self):
        make_subscription(
            name="analytics", service_layer="ANALYTICS", cost=Decimal("900.00")
        )
        make_subscription(
            name="registrar", service_layer="REGISTRAR", cost=Decimal("10.00")
        )
        response = self.client.get(reverse("estate_overview"))
        layers = [row["layer"] for row in response.data["spend_by_layer"]]
        self.assertLess(layers.index("REGISTRAR"), layers.index("ANALYTICS"))

    def test_layer_catalog_is_served_so_the_frontend_need_not_hardcode_it(self):
        response = self.client.get(reverse("estate_overview"))
        self.assertEqual(
            [row["layer"] for row in response.data["layers"]],
            [code for code, _ in estate.SERVICE_LAYERS],
        )

    def test_thresholds_are_served_rather_than_duplicated_in_the_ui(self):
        response = self.client.get(reverse("estate_overview"))
        thresholds = response.data["thresholds"]
        self.assertEqual(
            thresholds["at_risk_window_days"], estate.AT_RISK_WINDOW_DAYS
        )
        self.assertEqual(thresholds["urgent_window_days"], estate.URGENT_WINDOW_DAYS)
