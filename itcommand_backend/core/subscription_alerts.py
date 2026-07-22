"""Subscription reminder and budget-alert delivery.

The interval automation command calls :func:`check_subscription_alerts`.  Alert
logs provide a stable, unique event key, while notifications are also upserted
by their user/type/link tuple.  That makes retries safe and lets a failed
notification write be repaired on the next run without sending duplicates.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.models import (
    Notification,
    Subscription,
    SubscriptionAlertLog,
    SubscriptionSettings,
    User,
)
from core.permissions import has_role_permission


NOTIFICATION_TYPE = "SUBSCRIPTION"
SUBSCRIPTION_LINK_PATH = "/subscriptions"


@dataclass(frozen=True)
class AlertCandidate:
    alert_type: str
    event_key: str
    message: str
    link: str
    scheduled_for: date
    subscription: Subscription | None = None


@dataclass
class SubscriptionAlertSummary:
    """Counters returned to the management command and tests."""

    candidates: int = 0
    alert_logs_created: int = 0
    notifications_created: int = 0
    notifications_updated: int = 0
    notifications_retired: int = 0
    unchanged: int = 0
    disabled: bool = False
    dry_run: bool = False


def check_subscription_alerts(*, today=None, dry_run=False):
    """Create due, permission-scoped subscription notifications.

    A recipient must currently have ``subscriptions.view``.  Subscription
    owners (when enabled) and the explicitly assigned subscription admin are
    notified, along with users who can manage subscriptions.  Company-wide
    budget alerts only go to the latter group.
    """

    today = today or timezone.localdate()
    summary = SubscriptionAlertSummary(dry_run=dry_run)
    settings = _get_settings(dry_run=dry_run)

    if not settings.notifications_enabled:
        summary.disabled = True
        summary.notifications_retired += _retire_all_unread_notifications(
            dry_run=dry_run,
        )
        return summary

    viewers, managers = _authorized_recipients()
    subscription_ids = list(Subscription.objects.values_list("pk", flat=True))

    for subscription_id in subscription_ids:
        # Reload under the same row lock used by the post-commit refresh. If a
        # write wins first, this sees its current dates/status; if this check
        # wins first, the write's refresh runs afterward and becomes final.
        with transaction.atomic():
            subscription = (
                Subscription.objects.select_for_update()
                .select_related("owner", "admin")
                .filter(pk=subscription_id)
                .first()
            )
            if subscription is None:
                summary.notifications_retired += retire_subscription_notifications(
                    subscription_id,
                    dry_run=dry_run,
                )
                continue
            _process_subscription(
                subscription,
                settings=settings,
                viewers=viewers,
                managers=managers,
                today=today,
                summary=summary,
                dry_run=dry_run,
            )

    # Budget alerts are reconciled separately because they belong to the
    # company/period rather than one subscription.
    subscriptions = list(Subscription.objects.all())
    budget_candidates = _budget_candidates(subscriptions, settings, today)
    valid_budget_deliveries = {
        (recipient.pk, candidate.link)
        for candidate in budget_candidates
        for recipient in managers.values()
    }
    for candidate in budget_candidates:
        _deliver_to_recipients(
            candidate,
            managers.values(),
            summary=summary,
            dry_run=dry_run,
        )
    summary.notifications_retired += _retire_budget_notifications(
        keep=valid_budget_deliveries,
        dry_run=dry_run,
    )

    summary.notifications_retired += _retire_orphaned_notifications(
        dry_run=dry_run,
    )

    return summary


def refresh_subscription_alerts(subscription_id, *, today=None, dry_run=False):
    """Refresh one subscription immediately after an app write.

    This path deliberately excludes company-wide budget candidates.  It makes
    a newly configured cancellation deadline deliver promptly without running
    finance, license, or any other automation command.  The row lock ensures a
    concurrent update cannot interleave delivery with stale-alert retirement.
    """

    today = today or timezone.localdate()
    summary = SubscriptionAlertSummary(dry_run=dry_run)
    with transaction.atomic():
        subscription = (
            Subscription.objects.select_for_update()
            .select_related("owner", "admin")
            .filter(pk=subscription_id)
            .first()
        )
        if subscription is None:
            summary.notifications_retired += retire_subscription_notifications(
                subscription_id,
                dry_run=dry_run,
            )
            return summary

        settings = _get_settings(dry_run=dry_run)
        if not settings.notifications_enabled:
            summary.disabled = True
            summary.notifications_retired += retire_subscription_notifications(
                subscription.pk,
                dry_run=dry_run,
            )
            return summary

        viewers, managers = _authorized_recipients()
        _process_subscription(
            subscription,
            settings=settings,
            viewers=viewers,
            managers=managers,
            today=today,
            summary=summary,
            dry_run=dry_run,
        )
    return summary


def _process_subscription(
    subscription,
    *,
    settings,
    viewers,
    managers,
    today,
    summary,
    dry_run,
):
    recipients = dict(managers)
    if (
        settings.notify_owners
        and subscription.owner_id
        and subscription.owner_id in viewers
    ):
        recipients[subscription.owner_id] = viewers[subscription.owner_id]
    if subscription.admin_id and subscription.admin_id in viewers:
        recipients[subscription.admin_id] = viewers[subscription.admin_id]

    candidates = _subscription_candidates(subscription, settings, today)
    valid_deliveries = {
        (recipient.pk, candidate.link)
        for candidate in candidates
        for recipient in recipients.values()
    }
    for candidate in candidates:
        _deliver_to_recipients(
            candidate,
            recipients.values(),
            summary=summary,
            dry_run=dry_run,
        )

    summary.notifications_retired += retire_subscription_notifications(
        subscription.pk,
        keep=valid_deliveries,
        dry_run=dry_run,
    )


def retire_subscription_notifications(subscription_id, *, keep=(), dry_run=False):
    """Delete obsolete unread notifications for one subscription.

    Subscription notification links are generated exclusively by this module
    and contain an exact ``subscription=<id>&`` prefix. Alert logs preserve the
    delivery audit. User-read notifications are retained as inbox history, but
    stale unread rows are deleted so reverting to a prior schedule can create a
    fresh alert without resurrecting something the user explicitly dismissed.
    """

    prefix = f"{SUBSCRIPTION_LINK_PATH}?subscription={subscription_id}&"
    notifications = Notification.objects.filter(
        notification_type=NOTIFICATION_TYPE,
        is_read=False,
        link__startswith=prefix,
    )
    return _retire_notifications(notifications, keep=keep, dry_run=dry_run)


def _retire_budget_notifications(*, keep=(), dry_run=False):
    notifications = Notification.objects.filter(
        Q(link__startswith=f"{SUBSCRIPTION_LINK_PATH}?alert=monthly-budget&")
        | Q(link__startswith=f"{SUBSCRIPTION_LINK_PATH}?alert=yearly-budget&"),
        notification_type=NOTIFICATION_TYPE,
        is_read=False,
    )
    return _retire_notifications(notifications, keep=keep, dry_run=dry_run)


def _retire_all_unread_notifications(*, dry_run=False):
    notifications = Notification.objects.filter(
        notification_type=NOTIFICATION_TYPE,
        is_read=False,
    )
    return _retire_notifications(notifications, dry_run=dry_run)


def _retire_notifications(notifications, *, keep=(), dry_run=False):
    keep = set(keep)
    notifications = notifications.only("id", "user_id", "link")
    stale_ids = [
        notification.pk
        for notification in notifications
        if (notification.user_id, notification.link) not in keep
    ]
    if dry_run:
        return len(stale_ids)
    if not stale_ids:
        return 0
    deleted, _ = Notification.objects.filter(pk__in=stale_ids).delete()
    return deleted


def _retire_orphaned_notifications(*, dry_run):
    notifications_by_subscription = {}
    notifications = Notification.objects.filter(
        notification_type=NOTIFICATION_TYPE,
        is_read=False,
        link__startswith=f"{SUBSCRIPTION_LINK_PATH}?subscription=",
    ).only("id", "link")
    for notification in notifications:
        subscription_id = _subscription_id_from_link(notification.link)
        if subscription_id is not None:
            notifications_by_subscription.setdefault(subscription_id, []).append(
                notification.pk
            )
    if not notifications_by_subscription:
        return 0
    existing_ids = set(
        Subscription.objects.filter(pk__in=notifications_by_subscription).values_list(
            "pk", flat=True
        )
    )
    stale_ids = [
        notification_id
        for subscription_id, notification_ids in notifications_by_subscription.items()
        if subscription_id not in existing_ids
        for notification_id in notification_ids
    ]
    if dry_run:
        return len(stale_ids)
    if not stale_ids:
        return 0
    deleted, _ = Notification.objects.filter(pk__in=stale_ids).delete()
    return deleted


def _subscription_id_from_link(link):
    try:
        parsed = urlsplit(link or "")
        if parsed.path != SUBSCRIPTION_LINK_PATH:
            return None
        values = parse_qs(parsed.query).get("subscription", [])
        if len(values) != 1:
            return None
        return int(values[0])
    except (TypeError, ValueError):
        return None


def _get_settings(*, dry_run):
    existing = SubscriptionSettings.objects.filter(pk=1).first()
    if existing is not None or dry_run:
        return existing or SubscriptionSettings(pk=1)
    return SubscriptionSettings.get_solo()


def _authorized_recipients():
    viewers = {}
    managers = {}
    for user in User.objects.filter(is_active=True):
        if not has_role_permission(user, "subscriptions", "view"):
            continue
        viewers[user.id] = user
        if any(
            has_role_permission(user, "subscriptions", action)
            for action in ("add", "edit", "delete")
        ):
            managers[user.id] = user
    return viewers, managers


def _subscription_candidates(subscription, settings, today):
    candidates = []
    if subscription.status == "CANCELLED":
        return candidates
    if subscription.status == "ACTIVE":
        if subscription.expiry_date < today:
            candidates.append(_expired_candidate(subscription))
        elif subscription.start_date <= today and subscription.renewal_reminder_enabled:
            reminder_days = _reminder_days(
                subscription.renewal_reminder_days,
                settings.default_renewal_reminder_days,
            )
            reminder_date = subscription.expiry_date - timedelta(days=reminder_days)
            if reminder_date <= today <= subscription.expiry_date:
                candidates.append(
                    _renewal_or_expiry_candidate(subscription, reminder_date)
                )

    if subscription.cancellation_reminder_enabled:
        cancellation_date = (
            subscription.cancellation_deadline or subscription.expiry_date
        )
        reminder_days = _reminder_days(
            subscription.cancellation_reminder_days,
            settings.default_cancellation_reminder_days,
        )
        reminder_date = cancellation_date - timedelta(days=reminder_days)
        if reminder_date <= today <= cancellation_date:
            candidates.append(
                _cancellation_candidate(
                    subscription,
                    reminder_date=reminder_date,
                    cancellation_date=cancellation_date,
                )
            )
    return candidates


def _reminder_days(subscription_value, default_value):
    return subscription_value if subscription_value is not None else default_value


def _renewal_or_expiry_candidate(subscription, reminder_date):
    cost = f"{subscription.currency} {subscription.cost:.2f}"
    cycle = "month" if subscription.billing_cycle == "MONTHLY" else "year"
    if subscription.auto_renew:
        alert_type = "RENEWAL"
        event = "renewal"
        message = (
            f"Subscription '{subscription.name}' on {subscription.platform} will "
            f"automatically renew on {subscription.expiry_date} at {cost} per "
            f"{cycle}. Review it before the charge."
        )
    else:
        alert_type = "EXPIRY"
        event = "upcoming-expiry"
        message = (
            f"Subscription '{subscription.name}' on {subscription.platform} "
            f"expires on {subscription.expiry_date}."
        )
    return AlertCandidate(
        alert_type=alert_type,
        event_key=f"subscription:{subscription.pk}:{event}:{subscription.expiry_date}",
        message=message,
        link=(
            f"/subscriptions?subscription={subscription.pk}&alert={event}"
            f"&date={subscription.expiry_date}"
        ),
        scheduled_for=reminder_date,
        subscription=subscription,
    )


def _expired_candidate(subscription):
    return AlertCandidate(
        alert_type="EXPIRY",
        event_key=(
            f"subscription:{subscription.pk}:expired:{subscription.expiry_date}"
        ),
        message=(
            f"Subscription '{subscription.name}' on {subscription.platform} "
            f"expired on {subscription.expiry_date}. Renew or close it out."
        ),
        link=(
            f"/subscriptions?subscription={subscription.pk}&alert=expired"
            f"&date={subscription.expiry_date}"
        ),
        scheduled_for=subscription.expiry_date,
        subscription=subscription,
    )


def _cancellation_candidate(subscription, *, reminder_date, cancellation_date):
    return AlertCandidate(
        alert_type="CANCELLATION",
        event_key=(
            f"subscription:{subscription.pk}:cancellation:{cancellation_date}"
        ),
        message=(
            f"Cancellation reminder: review '{subscription.name}' on "
            f"{subscription.platform} by {cancellation_date} to avoid an unwanted "
            "renewal or charge."
        ),
        link=(
            f"/subscriptions?subscription={subscription.pk}&alert=cancellation"
            f"&date={cancellation_date}"
        ),
        scheduled_for=reminder_date,
        subscription=subscription,
    )


def _budget_candidates(subscriptions, settings, today):
    budget_currency = settings.budget_currency
    active = [
        subscription
        for subscription in subscriptions
        if subscription.status == "ACTIVE"
        and subscription.start_date <= today <= subscription.expiry_date
        and subscription.currency == budget_currency
    ]
    monthly_billed = sum(
        (item.cost for item in active if item.billing_cycle == "MONTHLY"),
        Decimal("0.00"),
    )
    yearly_billed = sum(
        (item.cost for item in active if item.billing_cycle == "YEARLY"),
        Decimal("0.00"),
    )
    yearly_spend = monthly_billed * Decimal("12") + yearly_billed
    monthly_spend = yearly_spend / Decimal("12")

    candidates = []
    if (
        settings.monthly_budget_threshold is not None
        and settings.monthly_budget_threshold > 0
        and monthly_spend >= settings.monthly_budget_threshold
    ):
        period = today.strftime("%Y-%m")
        candidates.append(AlertCandidate(
            alert_type="MONTHLY_BUDGET",
            event_key=(
                f"budget:monthly:{period}:{budget_currency}:"
                f"{settings.monthly_budget_threshold}"
            ),
            message=(
                f"Subscription monthly spend is {budget_currency} "
                f"{monthly_spend:.2f}, reaching the configured budget threshold "
                f"of {budget_currency} {settings.monthly_budget_threshold:.2f}."
            ),
            link=f"/subscriptions?alert=monthly-budget&period={period}",
            scheduled_for=today,
        ))
    if (
        settings.yearly_budget_threshold is not None
        and settings.yearly_budget_threshold > 0
        and yearly_spend >= settings.yearly_budget_threshold
    ):
        period = str(today.year)
        candidates.append(AlertCandidate(
            alert_type="YEARLY_BUDGET",
            event_key=(
                f"budget:yearly:{period}:{budget_currency}:"
                f"{settings.yearly_budget_threshold}"
            ),
            message=(
                f"Subscription annualized spend is {budget_currency} "
                f"{yearly_spend:.2f}, reaching the configured budget threshold "
                f"of {budget_currency} {settings.yearly_budget_threshold:.2f}."
            ),
            link=f"/subscriptions?alert=yearly-budget&period={period}",
            scheduled_for=today,
        ))
    return candidates


def _deliver_to_recipients(candidate, recipients, *, summary, dry_run):
    for recipient in recipients:
        summary.candidates += 1
        dedupe_key = f"{candidate.event_key}:recipient:{recipient.pk}"
        if dry_run:
            _simulate_delivery(candidate, recipient, dedupe_key, summary)
        else:
            _deliver(candidate, recipient, dedupe_key, summary)


def _simulate_delivery(candidate, recipient, dedupe_key, summary):
    if not SubscriptionAlertLog.objects.filter(dedupe_key=dedupe_key).exists():
        summary.alert_logs_created += 1
    notification = Notification.objects.filter(
        user=recipient,
        notification_type=NOTIFICATION_TYPE,
        link=candidate.link,
    ).order_by("id").first()
    if notification is None:
        summary.notifications_created += 1
    elif notification.message != candidate.message:
        summary.notifications_updated += 1
    else:
        summary.unchanged += 1


def _deliver(candidate, recipient, dedupe_key, summary):
    # The unique alert row and row lock serialize concurrent automation runs.
    with transaction.atomic():
        alert_log, created = SubscriptionAlertLog.objects.get_or_create(
            dedupe_key=dedupe_key,
            defaults={
                "subscription": candidate.subscription,
                "alert_type": candidate.alert_type,
                "recipient": recipient,
                "message": candidate.message,
                "scheduled_for": candidate.scheduled_for,
            },
        )
        alert_log = SubscriptionAlertLog.objects.select_for_update().get(
            pk=alert_log.pk
        )
        if created:
            summary.alert_logs_created += 1
        elif alert_log.message != candidate.message:
            alert_log.message = candidate.message
            alert_log.save(update_fields=["message"])

        notification = Notification.objects.filter(
            user=recipient,
            notification_type=NOTIFICATION_TYPE,
            link=candidate.link,
        ).order_by("id").first()
        if notification is None:
            Notification.objects.create(
                user=recipient,
                notification_type=NOTIFICATION_TYPE,
                message=candidate.message,
                link=candidate.link,
            )
            summary.notifications_created += 1
        elif notification.message != candidate.message:
            notification.message = candidate.message
            notification.is_read = False
            notification.save(update_fields=["message", "is_read"])
            summary.notifications_updated += 1
        else:
            summary.unchanged += 1
