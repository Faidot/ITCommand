from datetime import date, timedelta
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command as django_call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from core.management.commands.finance_autopost import advance_schedule
from core.models.network import NetworkDevice, NetworkDeviceStatusLog
from core.models.system import AppSettings, Notification
from core.models.users import User
from core.models.vendors import ContractStatus, Vendor, VendorContract


class CalendarScheduleTests(SimpleTestCase):
    def test_calendar_months_clamp_short_months(self):
        self.assertEqual(advance_schedule(date(2024, 1, 31), "MONTHLY"), date(2024, 2, 29))
        self.assertEqual(advance_schedule(date(2024, 2, 29), "YEARLY"), date(2025, 2, 28))
        self.assertEqual(advance_schedule(date(2026, 10, 31), "QUARTERLY"), date(2027, 1, 31))


class ContractAlertTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@example.com",
            password="test-password",
            full_name="Admin",
            role="ADMIN",
        )
        self.vendor = Vendor.objects.create(name="Example Vendor")
        self.contract = VendorContract.objects.create(
            vendor=self.vendor,
            title="Support",
            status=ContractStatus.ACTIVE,
            end_date=timezone.localdate() + timedelta(days=10),
        )

    def test_alert_is_stable_then_reopens_when_contract_changes(self):
        django_call_command("check_contract_alerts", stdout=StringIO())
        notification = Notification.objects.get(notification_type="CONTRACT")
        self.assertFalse(notification.is_read)

        notification.is_read = True
        notification.save(update_fields=["is_read"])
        django_call_command("check_contract_alerts", stdout=StringIO())
        notification.refresh_from_db()
        self.assertTrue(notification.is_read)
        self.assertEqual(Notification.objects.count(), 1)

        self.contract.end_date += timedelta(days=1)
        self.contract.save(update_fields=["end_date"])
        django_call_command("check_contract_alerts", stdout=StringIO())
        notification.refresh_from_db()
        self.assertFalse(notification.is_read)
        self.assertIn(str(self.contract.end_date), notification.message)

    def test_past_active_contract_is_marked_expired(self):
        self.contract.end_date = timezone.localdate() - timedelta(days=1)
        self.contract.status = ContractStatus.ACTIVE
        self.contract.save(update_fields=["end_date", "status"])

        django_call_command("check_contract_alerts", stdout=StringIO())

        self.contract.refresh_from_db()
        self.assertEqual(self.contract.status, ContractStatus.EXPIRED)
        self.assertIn("expired", Notification.objects.get().message)


class PingHistoryTests(TestCase):
    @patch("core.management.commands.ping_check.subprocess.run")
    def test_ping_status_transition_is_logged_once(self, run):
        run.return_value = SimpleNamespace(returncode=0)
        device = NetworkDevice.objects.create(
            device_name="Router",
            ip_address="192.0.2.10",
            status="OFFLINE",
        )

        django_call_command("ping_check", stdout=StringIO())
        django_call_command("ping_check", stdout=StringIO())

        device.refresh_from_db()
        self.assertEqual(device.status, "ONLINE")
        self.assertIsNotNone(device.last_seen_online)
        log = NetworkDeviceStatusLog.objects.get(device=device)
        self.assertEqual((log.old_status, log.new_status), ("OFFLINE", "ONLINE"))
        self.assertEqual(log.note, "Automated ping check")


class EmailReportTests(TestCase):
    @patch("core.management.commands.email_finance_report.send_mail")
    def test_delivery_failure_makes_command_fail(self, send_mail):
        User.objects.create_user(
            email="admin@example.com",
            password="test-password",
            full_name="Admin",
            role="ADMIN",
        )
        send_mail.side_effect = RuntimeError("SMTP unavailable")

        with self.assertRaises(CommandError):
            django_call_command("email_finance_report", stdout=StringIO())


class AutomationRunnerTests(TestCase):
    @override_settings(
        AUTOMATION_DAILY_COMMANDS=["example_daily_task"],
        AUTOMATION_INTERVAL_COMMANDS=[],
        AUTOMATION_INTERVAL_SECONDS=300,
        AUTOMATION_PING_ENABLED=False,
        AUTOMATION_EMAIL_REPORT_ENABLED=False,
        AUTOMATION_POLL_SECONDS=10,
        AUTOMATION_RETRY_SECONDS=30,
    )
    @patch("core.management.commands.run_automation.call_command")
    def test_success_marker_prevents_duplicate_daily_run(self, scheduled_call):
        django_call_command("run_automation", "--once", stdout=StringIO())
        django_call_command("run_automation", "--once", stdout=StringIO())

        scheduled_call.assert_called_once()
        marker = AppSettings.objects.get(key="automation.example_daily_task.last_success")
        self.assertEqual(marker.value, timezone.localdate().isoformat())

    @override_settings(
        AUTOMATION_DAILY_COMMANDS=["finance_autopost", "check_subscription_alerts"],
        AUTOMATION_INTERVAL_COMMANDS=["check_subscription_alerts"],
        AUTOMATION_INTERVAL_SECONDS=300,
        AUTOMATION_PING_ENABLED=False,
        AUTOMATION_EMAIL_REPORT_ENABLED=False,
        AUTOMATION_POLL_SECONDS=10,
        AUTOMATION_RETRY_SECONDS=30,
    )
    @patch("core.management.commands.run_automation.call_command")
    def test_interval_alert_check_does_not_repeat_unrelated_daily_work(
        self,
        scheduled_call,
    ):
        django_call_command("run_automation", "--once", stdout=StringIO())
        django_call_command("run_automation", "--once", stdout=StringIO())

        command_names = [call.args[0] for call in scheduled_call.call_args_list]
        self.assertEqual(
            command_names,
            [
                "finance_autopost",
                "check_subscription_alerts",
                "check_subscription_alerts",
            ],
        )
        self.assertEqual(command_names.count("finance_autopost"), 1)
