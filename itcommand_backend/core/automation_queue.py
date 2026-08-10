"""Hand a management command to the automation runner instead of running it here.

There is no Celery in this deployment, and a long sync must not run inside an
HTTP request: "Run now" used to call `sync_brex` synchronously, so one click
could hold a Gunicorn worker for minutes while it paged through ninety days of
charges. With three workers, two clicks took two thirds of the site down.

The queue is the same `AppSettings` key/value table `run_automation` already
uses for its completion markers, so the API container and the automation
container need nothing between them but the database they already share.

Requests are idempotent: asking twice before the runner wakes leaves one
pending request, not two.
"""
from django.utils import timezone

from core.models.system import AppSettings


#: Only commands named here may be queued. A request arrives from an HTTP
#: handler, so the set of things it can start is closed rather than "whatever
#: string was posted".
QUEUEABLE = frozenset({"sync_brex", "fetch_exchange_rates"})


def _key(command):
    return f"automation.{command}.requested_at"


class NotQueueable(ValueError):
    """The command is not on the allow-list."""


def request_run(command, *, requested_by=""):
    """Ask the runner to run `command` on its next cycle.

    Returns the timestamp recorded. Idempotent — a second request while one is
    already pending overwrites it rather than queueing another run.
    """
    if command not in QUEUEABLE:
        raise NotQueueable(f"{command} cannot be queued.")

    now = timezone.now()
    AppSettings.objects.update_or_create(
        key=_key(command),
        defaults={
            "value": now.isoformat(),
            "description": (
                f"Pending on-demand run of {command}"
                + (f", requested by {requested_by}" if requested_by else "")
            ),
        },
    )
    return now


def pending(command):
    """The ISO timestamp of a pending request, or '' when none is waiting."""
    return (
        AppSettings.objects.filter(key=_key(command))
        .values_list("value", flat=True)
        .first()
        or ""
    )


def pending_commands():
    """Every queued command, in a stable order."""
    rows = AppSettings.objects.filter(
        key__startswith="automation.", key__endswith=".requested_at"
    ).values_list("key", flat=True)
    found = []
    for key in rows:
        command = key[len("automation.") : -len(".requested_at")]
        if command in QUEUEABLE:
            found.append(command)
    return sorted(found)


def clear_request(command):
    """Drop a pending request.

    Cleared *before* the command runs, not after: a command that crashes must
    not leave its request behind to be retried on every cycle forever. The
    daily schedule is what guarantees the work eventually happens.
    """
    AppSettings.objects.filter(key=_key(command)).delete()
