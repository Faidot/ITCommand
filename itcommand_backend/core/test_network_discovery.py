from unittest import mock

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from core import discovery
from core.models import (
    DiscoveredHost,
    IPAddressPool,
    NetworkDevice,
    NetworkIntegration,
    NetworkScan,
)
from core.network_sources import fetch_hosts
from core.test_calendar_feed import role_with
from core.test_subscriptions import create_user


class ScannerPrimitiveTests(TestCase):
    def test_target_expansion(self):
        hosts, error = discovery.expand_target("192.168.1.0/30")
        self.assertEqual(hosts, ["192.168.1.1", "192.168.1.2"])
        self.assertEqual(error, "")

        hosts, error = discovery.expand_target("10.0.0.7")
        self.assertEqual(hosts, ["10.0.0.7"])
        self.assertEqual(error, "")

    def test_an_oversized_range_is_refused_rather_than_truncated(self):
        hosts, error = discovery.expand_target("10.0.0.0/8")
        self.assertEqual(hosts, [])
        self.assertIn("limit", error)

    def test_a_bad_target_is_reported_clearly(self):
        hosts, error = discovery.expand_target("definitely not an ip")
        self.assertEqual(hosts, [])
        self.assertIn("valid IP address or CIDR", error)

    def test_mac_normalisation_pads_and_lowercases(self):
        self.assertEqual(discovery.normalise_mac("0:C:42:A:B:C"), "00:0c:42:0a:0b:0c")
        self.assertEqual(discovery.normalise_mac("00-0C-42-11-22-33"), "00:0c:42:11:22:33")
        self.assertEqual(discovery.normalise_mac("nonsense"), "")
        self.assertEqual(discovery.normalise_mac(None), "")

    def test_vendor_lookup_is_case_insensitive_and_degrades_quietly(self):
        self.assertEqual(discovery.vendor_from_mac("00:0c:42:11:22:33"), "MikroTik")
        self.assertEqual(discovery.vendor_from_mac("00:0C:42:11:22:33"), "MikroTik")
        self.assertEqual(discovery.vendor_from_mac("ff:ff:ff:11:22:33"), "")

    def test_arp_parsing_handles_real_output(self):
        sample = (
            "? (192.168.60.1) at 28:80:23:9a:c6:21 on en0 ifscope [ethernet]\n"
            "? (192.168.60.9) at (incomplete) on en0 [ethernet]\n"
            "gw.local (10.0.0.1) at 0:c:42:1:2:3 on eth0\n"
        )
        with mock.patch("core.discovery.subprocess.run") as runner:
            runner.return_value = mock.Mock(stdout=sample, returncode=0)
            table = discovery.arp_table()

        self.assertEqual(table["192.168.60.1"], "28:80:23:9a:c6:21")
        self.assertEqual(table["10.0.0.1"], "00:0c:42:01:02:03")
        self.assertNotIn("192.168.60.9", table, "incomplete entries must be skipped")

    def test_arp_uses_numeric_mode_so_dns_cannot_stall_a_scan(self):
        with mock.patch("core.discovery.subprocess.run") as runner:
            runner.return_value = mock.Mock(stdout="", returncode=0)
            discovery.arp_table()
        command = runner.call_args[0][0]
        self.assertIn("-an", command, "arp must run numerically; -a alone does reverse DNS")

    def test_a_failing_arp_command_returns_empty_rather_than_raising(self):
        with mock.patch("core.discovery.subprocess.run", side_effect=OSError("boom")):
            self.assertEqual(discovery.arp_table(), {})

    def test_ping_never_raises(self):
        with mock.patch("core.discovery.subprocess.run", side_effect=OSError("boom")):
            self.assertFalse(discovery.ping("10.0.0.1"))

    def test_sweep_reports_alive_hosts_with_vendor_and_hostname(self):
        with mock.patch("core.discovery.ping", side_effect=lambda ip, **kw: ip.endswith(".1")), \
             mock.patch("core.discovery.arp_table", return_value={"192.168.1.1": "00:0c:42:11:22:33"}), \
             mock.patch("core.discovery.reverse_dns", return_value="router.lan"):
            results, error = discovery.sweep("192.168.1.0/30")

        self.assertEqual(error, "")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["ip_address"], "192.168.1.1")
        self.assertEqual(results[0]["vendor_guess"], "MikroTik")
        self.assertEqual(results[0]["hostname"], "router.lan")


class ScanEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager = create_user(
            "net-manager@example.com",
            role_with("NET_MANAGER", network=True).slug,
        )
        # role_with only grants `view`; grant add/edit explicitly.
        role = self.manager.role
        from core.models import Role

        role_obj = Role.objects.get(slug=role)
        role_obj.permissions["network"] = {
            "view": True, "add": True, "edit": True, "delete": True
        }
        role_obj.save()

        self.viewer = create_user(
            "net-viewer@example.com", role_with("NET_VIEWER", network=True).slug
        )
        self.client.force_authenticate(self.manager)

    def fake_sweep(self, rows):
        return mock.patch("core.views.discovery.sweep", return_value=(rows, ""))

    def test_a_scan_records_hosts_and_a_run(self):
        rows = [{
            "ip_address": "192.168.5.10", "mac_address": "00:0c:42:aa:bb:cc",
            "hostname": "switch.lan", "vendor_guess": "MikroTik",
            "open_ports": [22, 443], "discovered_via": "SWEEP",
        }]
        with self.fake_sweep(rows):
            response = self.client.post(
                reverse("network_scan"), {"target": "192.168.5.0/30"}, format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["status"], "COMPLETED")
        self.assertEqual(response.data["hosts_found"], 1)
        self.assertEqual(response.data["hosts_new"], 1)

        host = DiscoveredHost.objects.get(ip_address="192.168.5.10")
        self.assertEqual(host.state, "NEW")
        self.assertEqual(host.vendor_guess, "MikroTik")
        self.assertEqual(NetworkScan.objects.count(), 1)

    def test_rescanning_updates_rather_than_duplicates(self):
        rows = [{
            "ip_address": "192.168.5.10", "mac_address": "", "hostname": "",
            "vendor_guess": "", "open_ports": [], "discovered_via": "SWEEP",
        }]
        with self.fake_sweep(rows):
            self.client.post(reverse("network_scan"), {"target": "192.168.5.0/30"}, format="json")
            self.client.post(reverse("network_scan"), {"target": "192.168.5.0/30"}, format="json")

        self.assertEqual(DiscoveredHost.objects.count(), 1)
        host = DiscoveredHost.objects.get()
        self.assertEqual(host.times_seen, 2)

    def test_an_oversized_range_is_rejected_before_scanning(self):
        response = self.client.post(
            reverse("network_scan"), {"target": "10.0.0.0/8"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(NetworkScan.objects.count(), 0)

    def test_a_missing_target_is_rejected(self):
        response = self.client.post(reverse("network_scan"), {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_scanning_an_ip_pool_uses_its_cidr(self):
        pool = IPAddressPool.objects.create(
            name="Office", network_address="192.168.9.0", cidr_prefix=30
        )
        with self.fake_sweep([]) as patched:
            self.client.post(reverse("network_scan"), {"pool": pool.pk}, format="json")
        self.assertEqual(patched.call_args[0][0], "192.168.9.0/30")

    def test_a_viewer_cannot_start_a_scan(self):
        self.client.force_authenticate(self.viewer)
        response = self.client.post(
            reverse("network_scan"), {"target": "192.168.5.0/30"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(NetworkScan.objects.count(), 0)

    def test_a_sweep_failure_is_recorded_not_raised(self):
        with mock.patch("core.views.discovery.sweep", return_value=([], "network unreachable")):
            response = self.client.post(
                reverse("network_scan"), {"target": "192.168.5.0/30"}, format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "FAILED")
        self.assertIn("unreachable", response.data["message"])


class PromoteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        from core.models import Role

        self.user = create_user("promo@example.com", role_with("PROMO", network=True).slug)
        role = Role.objects.get(slug=self.user.role)
        role.permissions["network"] = {"view": True, "add": True, "edit": True, "delete": True}
        role.save()
        self.client.force_authenticate(self.user)

        self.host = DiscoveredHost.objects.create(
            ip_address="192.168.7.20",
            mac_address="00:0c:42:de:ad:be",
            hostname="ap-01.lan",
            vendor_guess="MikroTik",
        )

    def test_promoting_creates_a_device_and_links_the_sighting(self):
        response = self.client.post(
            reverse("discovered-host-promote", args=[self.host.pk]),
            {"device_type": "ACCESS_POINT"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        device = NetworkDevice.objects.get(pk=response.data["device_id"])
        self.assertEqual(device.ip_address, "192.168.7.20")
        self.assertEqual(device.device_type, "ACCESS_POINT")
        self.assertEqual(device.brand, "MikroTik")
        self.assertEqual(device.status, "ONLINE")

        self.host.refresh_from_db()
        self.assertEqual(self.host.state, "LINKED")
        self.assertEqual(self.host.linked_device_id, device.pk)

    def test_promoting_twice_links_instead_of_duplicating(self):
        first = self.client.post(
            reverse("discovered-host-promote", args=[self.host.pk]), {}, format="json"
        )
        second = self.client.post(
            reverse("discovered-host-promote", args=[self.host.pk]), {}, format="json"
        )
        self.assertTrue(first.data["created"])
        self.assertFalse(second.data["created"])
        self.assertEqual(NetworkDevice.objects.filter(ip_address="192.168.7.20").count(), 1)

    def test_an_existing_device_at_that_ip_is_detected(self):
        NetworkDevice.objects.create(device_name="Known switch", ip_address="192.168.7.20")
        response = self.client.get(reverse("discovered-host-list"))
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        self.assertEqual(rows[0]["matched_device_name"], "Known switch")

    def test_ignoring_and_restoring_a_host(self):
        self.client.post(reverse("discovered-host-ignore", args=[self.host.pk]))
        self.host.refresh_from_db()
        self.assertEqual(self.host.state, "IGNORED")

        self.client.post(reverse("discovered-host-reset", args=[self.host.pk]))
        self.host.refresh_from_db()
        self.assertEqual(self.host.state, "NEW")


class NetworkIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        from core.models import Role

        self.user = create_user("netint@example.com", role_with("NETINT", network=True).slug)
        role = Role.objects.get(slug=self.user.role)
        role.permissions["network"] = {"view": True, "add": True, "edit": True, "delete": True}
        role.save()
        self.client.force_authenticate(self.user)

    def test_the_secret_is_encrypted_and_never_returned(self):
        response = self.client.post(
            reverse("network-integration-list"),
            {
                "name": "Core router", "kind": "MIKROTIK", "host": "192.168.1.1",
                "port": 443, "username": "readonly", "secret": "hunter2",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertNotIn("secret", response.data)
        self.assertNotIn("hunter2", str(response.data))

        integration = NetworkIntegration.objects.get()
        self.assertNotIn("hunter2", integration.encrypted_secret)
        self.assertEqual(integration.get_secret(), "hunter2")

    def test_updating_without_a_secret_keeps_the_stored_one(self):
        integration = NetworkIntegration.objects.create(
            name="Edge", kind="PFSENSE", host="10.0.0.1"
        )
        integration.set_secret("keep-me")
        integration.save()

        self.client.patch(
            reverse("network-integration-detail", args=[integration.pk]),
            {"port": 8443},
            format="json",
        )
        integration.refresh_from_db()
        self.assertEqual(integration.get_secret(), "keep-me")
        self.assertEqual(integration.port, 8443)

    def test_two_devices_of_the_same_kind_can_coexist(self):
        """The single-row Integration model could not do this."""
        NetworkIntegration.objects.create(name="R1", kind="MIKROTIK", host="10.0.0.1")
        NetworkIntegration.objects.create(name="R2", kind="MIKROTIK", host="10.0.0.2")
        self.assertEqual(NetworkIntegration.objects.filter(kind="MIKROTIK").count(), 2)

    def test_base_url_respects_the_tls_setting(self):
        integration = NetworkIntegration.objects.create(
            name="R", kind="MIKROTIK", host="10.0.0.1", port=8080, use_tls=False
        )
        self.assertEqual(integration.base_url, "http://10.0.0.1:8080")

    def test_a_disabled_integration_is_not_contacted(self):
        integration = NetworkIntegration.objects.create(
            name="Off", kind="MIKROTIK", host="10.0.0.1", is_enabled=False
        )
        results, error = fetch_hosts(integration)
        self.assertEqual(results, [])
        self.assertIn("disabled", error)

    def test_an_unreachable_device_reports_rather_than_raises(self):
        integration = NetworkIntegration.objects.create(
            name="Dead", kind="MIKROTIK", host="127.0.0.1", port=9,
            is_enabled=True, use_tls=False,
        )
        results, error = fetch_hosts(integration)
        self.assertEqual(results, [])
        self.assertTrue(error)

    def test_mikrotik_lease_parsing(self):
        integration = NetworkIntegration.objects.create(
            name="R", kind="MIKROTIK", host="10.0.0.1", is_enabled=True
        )
        leases = [
            {"address": "10.0.0.50", "mac-address": "00:0C:42:11:22:33", "host-name": "pc-1"},
            {"address": "not-an-ip", "mac-address": "x"},
        ]
        arp = [{"address": "10.0.0.51", "mac-address": "AC:DE:48:00:11:22"}]

        def fake_request(_integration, path, **kwargs):
            return (leases, "") if "lease" in path else (arp, "")

        with mock.patch("core.network_sources._request", side_effect=fake_request):
            results, error = fetch_hosts(integration)

        self.assertEqual(error, "")
        by_ip = {row["ip_address"]: row for row in results}
        self.assertEqual(set(by_ip), {"10.0.0.50", "10.0.0.51"})
        self.assertEqual(by_ip["10.0.0.50"]["hostname"], "pc-1")
        self.assertEqual(by_ip["10.0.0.50"]["vendor_guess"], "MikroTik")
        self.assertEqual(by_ip["10.0.0.51"]["vendor_guess"], "Apple")

    def test_an_adapter_exception_is_contained(self):
        integration = NetworkIntegration.objects.create(
            name="R", kind="MIKROTIK", host="10.0.0.1", is_enabled=True
        )
        with mock.patch("core.network_sources._request", side_effect=RuntimeError("kaboom")):
            results, error = fetch_hosts(integration)
        self.assertEqual(results, [])
        self.assertIn("kaboom", error)
