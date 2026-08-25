"""Send queued mail whose moment has come.

Runs for sessions that are still live. Anything belonging to a signed-out user
cannot be sent — we hold no credential — and waits for them to return, which
is the trade-off the blueprint accepted and the composer warns about up front.
"""
import time

from django.core.management.base import BaseCommand

from mailcore import outbox, sessions


class Command(BaseCommand):
    help = "Send due messages for every live session. Loops unless --once."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="One pass, then exit.")
        parser.add_argument("--interval", type=int, default=5,
                            help="Seconds between passes (default 5).")

    def handle(self, *args, **opts):
        store = sessions.get_store()
        if not hasattr(store, "live_sessions"):
            self.stdout.write(self.style.WARNING(
                "This session store cannot enumerate live sessions, so the "
                "worker has nothing to iterate. Sends still go out when the "
                "client calls /api/outbox/flush, which it does on load."))
            return

        while True:
            for session in store.live_sessions():
                try:
                    report = outbox.run_due(session)
                    if report["sent"]:
                        self.stdout.write("sent %d for %s"
                                          % (len(report["sent"]), session.mailbox_address))
                except Exception:  # noqa: BLE001
                    self.stderr.write("outbox run failed for %s" % session.mailbox_address)
            if opts["once"]:
                return
            time.sleep(max(1, opts["interval"]))
