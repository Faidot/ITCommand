"""Track when each user was last active.

JWT sessions are stateless: there is no server-side session table to count, so
"who is online" cannot be read off anything that already exists. The only
honest signal available is the timestamp of a user's most recent authenticated
request, which is what this records.

Deliberately cheap. `touch_seen` throttles itself to one write per user per
minute and updates a single column, so the cost of knowing who is around is a
handful of narrow UPDATEs a minute rather than one per request.
"""


class LastSeenMiddleware:
    """Stamp `last_seen_at` on the authenticated user, at most once a minute."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Signing out is the one authenticated request that must not count as
        # presence: the JWT is still valid on the way out, so stamping
        # last_seen_at here would land *after* the sign-out and put the user
        # straight back online. LogoutView sets the flag.
        if getattr(request, 'skip_presence', False):
            return response

        # After the view, so a request that fails authentication or 500s does
        # not get counted as somebody being present.
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and response.status_code < 400:
            try:
                user.touch_seen()
            except Exception:
                # Presence is telemetry. It must never be the reason a request
                # fails — a broken clock or a locked row is not worth a 500.
                pass

        return response
