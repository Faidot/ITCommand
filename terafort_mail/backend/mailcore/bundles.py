"""Sorting mail into Renewals, Invoices, Alerts, Vendors and Store Policy.

Rules, not a model. A deterministic classifier can be read, argued with and
corrected; a model cannot explain why last quarter's renewal notice landed in
Alerts. When one of these is wrong the fix is a line here and a re-run.

**Bundles are a view, never a move.** Nothing in this module touches IMAP. The
result is a column on the cached row, so the user's phone and Roundcube keep
seeing an ordinary, unmangled mailbox — and a bad rule costs a re-run rather
than a hunt for misfiled mail.
"""
from __future__ import annotations

import re

RENEWALS = "Renewals"
INVOICES = "Invoices"
ALERTS = "Alerts"
VENDORS = "Vendors"
STORE_POLICY = "Store Policy"

#: Order matters. The first rule that matches wins, so the specific ones come
#: before the broad ones: an invoice from a vendor is an Invoice, not a Vendor.
RULES = [
    (INVOICES, {
        "subject": r"\b(invoice|receipt|payment\s+(due|received)|billing|statement|"
                   r"remittance|purchase\s+order|\bPO[-\s]?\d{3,})\b",
        "sender": r"(billing|invoices?|accounts?receivable|ar|payments?)@",
    }),
    (RENEWALS, {
        "subject": r"\b(renew(al|s|ing)?|expir(e|es|ing|ation)|subscription|"
                   r"licen[cs]e\s+(expir|renew)|auto-?renew|term\s+ends)\b",
        "sender": r"(renewals?|subscriptions?|licensing)@",
    }),
    (ALERTS, {
        "subject": r"\b(alert|alarm|warning|critical|down|outage|incident|"
                   r"failed|failure|degraded|breach|backup\s+(failed|verification)|"
                   r"monitor|uptime|threshold)\b",
        "sender": r"(alerts?|no-?reply|noreply|monitoring|nagios|uptime|status|"
                  r"notifications?)@",
    }),
    (STORE_POLICY, {
        "subject": r"\b(polic(y|ies)|procedure|compliance|guideline|handbook|"
                   r"code\s+of\s+conduct|returns?\s+process|store\s+(policy|update))\b",
        "sender": r"(policy|policies|compliance|hr)@",
    }),
    (VENDORS, {
        "subject": r"\b(quote|quotation|pricing|price\s+list|stock|availability|"
                   r"lead\s+time|catalog(ue)?|EOL|end\s+of\s+life|distribution)\b",
        "sender": r"(sales|partners?|accounts?|distribution|orders?)@",
    }),
]

_COMPILED = [
    (name, re.compile(spec["subject"], re.I), re.compile(spec["sender"], re.I))
    for name, spec in RULES
]

#: A List-Id almost always means bulk mail. It is a weak signal on its own —
#: plenty of legitimate vendor mail carries one — so it only nudges a message
#: into Alerts when nothing more specific matched.
_LIST_ID = re.compile(r"\b(alert|monitor|status|noc|ops)\b", re.I)


def classify(envelope) -> str:
    """Return a bundle name, or "" for ordinary mail.

    `envelope` needs `subject`, `from_addr` and optionally `list_id`. Most mail
    belongs in no bundle at all, and saying so is the correct answer — a
    classifier that always picks something is just noise with a label.
    """
    subject = getattr(envelope, "subject", "") or ""
    sender = getattr(envelope, "from_addr", "") or ""
    list_id = getattr(envelope, "list_id", "") or ""

    for name, subject_re, sender_re in _COMPILED:
        if subject_re.search(subject) or sender_re.search(sender):
            return name

    if list_id and _LIST_ID.search(list_id):
        return ALERTS
    return ""


def all_bundles() -> list:
    return [RENEWALS, INVOICES, ALERTS, VENDORS, STORE_POLICY]
