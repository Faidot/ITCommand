"""Builds a per-user iCalendar (.ics) feed of upcoming IT deadlines.

Written by hand rather than pulling in a dependency: RFC 5545 for all-day
events is a small, stable subset, and this keeps the deploy free of another
package to patch.

The feed is scoped twice over: to what the user's role may view, and to what
that user asked to include.
"""
from datetime import timedelta

from django.utils import timezone

from core.permissions import has_role_permission


PRODID = "-//ITCommand//Deadlines//EN"
#: How far back and forward to publish. Calendars cope badly with unbounded
#: feeds, and nobody needs a renewal from three years ago.
PAST_DAYS = 90
FUTURE_DAYS = 730


def _escape(text):
    """Escape per RFC 5545 §3.3.11."""
    return (
        str(text or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line):
    """Wrap at 75 octets, continuation lines start with a space (§3.1)."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return [line]
    chunks, current = [], b""
    for char in line:
        piece = char.encode("utf-8")
        limit = 75 if not chunks else 74
        if len(current) + len(piece) > limit:
            chunks.append(current.decode("utf-8"))
            current = b""
        current += piece
    if current:
        chunks.append(current.decode("utf-8"))
    return [chunks[0]] + [" " + chunk for chunk in chunks[1:]]


def _event(uid, start_date, summary, description="", url="", stamp=None):
    """One all-day VEVENT. DTEND is exclusive, hence the +1 day."""
    stamp = stamp or timezone.now()
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{stamp.strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART;VALUE=DATE:{start_date.strftime('%Y%m%d')}",
        f"DTEND;VALUE=DATE:{(start_date + timedelta(days=1)).strftime('%Y%m%d')}",
        f"SUMMARY:{_escape(summary)}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{_escape(description)}")
    if url:
        lines.append(f"URL:{_escape(url)}")
    lines += [
        "TRANSP:TRANSPARENT",
        # A day-before reminder is what makes this useful rather than decorative.
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{_escape(summary)}",
        "END:VALARM",
        "END:VEVENT",
    ]
    return lines


def _window():
    today = timezone.localdate()
    return today - timedelta(days=PAST_DAYS), today + timedelta(days=FUTURE_DAYS)


def _may(user, module):
    return has_role_permission(user, module, "view")


def collect_events(user, sources):
    """Gather (uid, date, summary, description, url) for everything in scope."""
    from core.models import (
        Asset,
        OnboardingTask,
        RecurringBill,
        Service,
        Ticket,
        VendorContract,
    )

    start, end = _window()
    events = []

    def in_window(value):
        return value and start <= value <= end

    # `subscriptions` is kept as the source key so existing calendar
    # subscriptions — the URL is in people's calendar clients, not ours to
    # change — keep working. What it emits is estate service renewals.
    if "subscriptions" in sources and _may(user, "estate"):
        for service in Service.objects.filter(
            status__in=("ACTIVE", "AT_RISK"), renewal_date__range=(start, end)
        ).select_related("provider", "property"):
            cycle = {
                "MONTHLY": "per month",
                "YEARLY": "per year",
                "USAGE": "usage-based",
                "FREE": "free",
            }.get(service.billing_cycle, service.billing_cycle.lower())
            attached = (
                service.property.name if service.property_id else "not attached to a property"
            )
            events.append((
                f"svc-renew-{service.pk}@itcommand",
                service.renewal_date,
                f"Renews: {service.identifier}",
                f"{service.get_service_type_display()} · {service.provider.name} · "
                f"{service.currency} {service.cost} {cycle}\n{attached}"
                + ("\nAuto-renews." if service.auto_renew else "\nDoes NOT auto-renew."),
                f"/estate/services?q={service.identifier}",
            ))

    if "contracts" in sources and _may(user, "vendors"):
        for contract in VendorContract.objects.filter(
            end_date__range=(start, end)
        ).select_related("vendor"):
            events.append((
                f"contract-{contract.pk}@itcommand",
                contract.end_date,
                f"Contract ends: {contract.title}",
                f"Vendor: {contract.vendor.name if contract.vendor else 'n/a'}"
                + ("\nAuto-renews." if contract.auto_renew else ""),
                f"/vendors/{contract.vendor_id}" if contract.vendor_id else "",
            ))

    if "warranties" in sources and _may(user, "assets"):
        for asset in Asset.objects.filter(warranty_expiry__range=(start, end)):
            events.append((
                f"warranty-{asset.pk}@itcommand",
                asset.warranty_expiry,
                f"Warranty ends: {asset.name}",
                f"Asset tag: {asset.asset_tag}",
                f"/assets?asset={asset.pk}",
            ))

    if "bills" in sources and _may(user, "finance"):
        for bill in RecurringBill.objects.filter(
            is_active=True, next_due_date__range=(start, end)
        ):
            events.append((
                f"bill-{bill.pk}@itcommand",
                bill.next_due_date,
                f"Bill due: {bill.title}",
                f"Amount: {bill.amount}",
                "/finance/recurring-bills",
            ))

    if "onboarding" in sources and _may(user, "onboarding"):
        for task in OnboardingTask.objects.filter(
            due_date__range=(start, end)
        ).select_related("record", "record__employee", "assigned_to"):
            if str(task.status).upper() in {"COMPLETED", "DONE", "SKIPPED"}:
                continue
            employee = getattr(getattr(task.record, "employee", None), "full_name", "")
            events.append((
                f"onboard-{task.pk}@itcommand",
                task.due_date,
                f"Onboarding: {task.title}",
                (f"For {employee}. " if employee else "")
                + (f"Assigned to {task.assigned_to.full_name}." if task.assigned_to else ""),
                "/onboarding",
            ))

    if "tickets" in sources and _may(user, "helpdesk"):
        for ticket in Ticket.objects.filter(due_date__range=(start, end)).select_related(
            "assigned_to"
        ):
            due = ticket.due_date
            events.append((
                f"ticket-{ticket.pk}@itcommand",
                due.date() if hasattr(due, "date") else due,
                f"Ticket due: {ticket.title}",
                f"Status: {ticket.status}"
                + (f" · Assigned to {ticket.assigned_to.full_name}" if ticket.assigned_to else ""),
                f"/helpdesk/tickets/{ticket.pk}",
            ))

    return [e for e in events if in_window(e[1])]


def build_ics(user, sources=None, site_url=""):
    """Render the user's feed as an iCalendar document."""
    from core.app_settings import company_name
    from core.models import CalendarFeedToken

    sources = sources or CalendarFeedToken.DEFAULT_SOURCES
    org = company_name() or "ITCommand"
    stamp = timezone.now()

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(f'{org} — IT deadlines')}",
        "X-WR-CALDESC:Renewals, expiries and due dates from ITCommand",
        # Ask subscribers to re-poll every 6 hours (honoured by Google/Outlook).
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
        "X-PUBLISHED-TTL:PT6H",
    ]

    for uid, date_value, summary, description, path in collect_events(user, sources):
        url = f"{site_url.rstrip('/')}{path}" if site_url and path else ""
        lines += _event(uid, date_value, summary, description, url, stamp=stamp)

    lines.append("END:VCALENDAR")

    folded = []
    for line in lines:
        folded.extend(_fold(line))
    # RFC 5545 requires CRLF line endings.
    return "\r\n".join(folded) + "\r\n"
