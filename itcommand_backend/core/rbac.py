"""Role-based access control catalog.

Single source of truth for the modules and actions used by the Roles &
Permissions section in Settings. Roles store a permission map shaped like:

    {
        "assets": {"view": true, "add": true, "edit": false, "delete": false},
        "finance": {"view": true, "add": false, "edit": false, "delete": false},
        ...
    }

Keeping the catalog here (rather than hard-coding it in views or the frontend)
means new modules/actions are declared in one place and flow everywhere.
"""

# The permission verbs every module supports.
ACTIONS = [
    {"key": "view", "label": "View"},
    {"key": "add", "label": "Add"},
    {"key": "edit", "label": "Edit"},
    {"key": "delete", "label": "Delete"},
]

ACTION_KEYS = [a["key"] for a in ACTIONS]

# The protectable areas of the app, grouped the same way the sidebar is so the
# settings UI can render them in sensible sections.
MODULES = [
    {"key": "dashboard", "label": "Dashboard", "group": "General"},
    {"key": "users", "label": "Users", "group": "People"},
    {"key": "departments", "label": "Departments", "group": "People"},
    {"key": "onboarding", "label": "Onboarding", "group": "People"},
    {"key": "seating", "label": "Seating Plan", "group": "People"},
    {"key": "assets", "label": "Asset Inventory", "group": "Assets"},
    # Replaced `licenses` and `subscriptions`, both retired in Phase 5.
    # Migration 0067 copied each role's `subscriptions` grants here first, so
    # no role's access changed on the way through.
    {"key": "estate", "label": "Digital Estate", "group": "Assets"},
    {"key": "vendors", "label": "Vendors", "group": "Procurement"},
    {"key": "procurement", "label": "Purchase Requests", "group": "Procurement"},
    {"key": "network", "label": "Network", "group": "Infrastructure"},
    {"key": "kb", "label": "Knowledge Base", "group": "Support"},
    {"key": "helpdesk", "label": "Helpdesk", "group": "Support"},
    {"key": "vault", "label": "Password Vault", "group": "Security"},
    {"key": "finance", "label": "Finance", "group": "Finance"},
    {"key": "reports", "label": "Reports", "group": "Finance"},
    {"key": "settings", "label": "Settings", "group": "Administration"},
]

MODULE_KEYS = [m["key"] for m in MODULES]


def blank_permissions():
    """A permission map with every action denied on every module."""
    return {m: {a: False for a in ACTION_KEYS} for m in MODULE_KEYS}


def full_permissions():
    """A permission map with every action allowed on every module."""
    return {m: {a: True for a in ACTION_KEYS} for m in MODULE_KEYS}


def _grant(perms, module, actions):
    for a in actions:
        perms[module][a] = True


# Default permission maps for the seeded roles. SUPERADMIN/ADMIN get everything
# via full_permissions(); the rest are sensible starting points an admin can
# refine in the UI.
def _viewer():
    p = blank_permissions()
    for m in ["dashboard", "assets", "estate", "kb", "helpdesk",
              "reports", "users", "departments", "vendors", "network", "seating"]:
        _grant(p, m, ["view"])
    return p


def _manager():
    p = _viewer()
    for m in ["assets", "estate", "vendors", "procurement",
              "network", "kb", "helpdesk", "onboarding", "seating", "vault", "finance"]:
        _grant(p, m, ["view", "add", "edit"])
    return p


def _employee():
    p = blank_permissions()
    _grant(p, "dashboard", ["view"])
    _grant(p, "kb", ["view"])
    _grant(p, "assets", ["view"])
    _grant(p, "helpdesk", ["view", "add"])
    return p


def _hr():
    p = blank_permissions()
    _grant(p, "dashboard", ["view"])
    for m in ["users", "departments", "onboarding", "seating"]:
        _grant(p, m, ["view", "add", "edit"])
    _grant(p, "kb", ["view"])
    return p


def _accounts():
    p = blank_permissions()
    _grant(p, "dashboard", ["view"])
    for m in ["finance", "estate", "vendors", "procurement", "reports"]:
        _grant(p, m, ["view", "add", "edit"])
    _grant(p, "assets", ["view"])
    return p


# slug -> (name, description, is_system, permissions)
DEFAULT_ROLES = [
    ("SUPERADMIN", "Superadmin", "Full, unrestricted access to every module.", True, full_permissions),
    ("ADMIN", "Admin", "Full access to operational modules and user management.", True, full_permissions),
    ("MANAGER", "Manager", "Can view and manage day-to-day records, but not delete or administer.", True, _manager),
    ("VIEWER", "Viewer", "Read-only access to the modules they need to see.", True, _viewer),
    ("HR", "HR", "Manages people: users, departments, onboarding and seating.", False, _hr),
    ("ACCOUNTS", "Accounts", "Manages finance, vendors, procurement and reports.", False, _accounts),
    ("EMPLOYEE", "Employee", "Self-service access: view basics and raise helpdesk tickets.", False, _employee),
]


def default_permissions_for(slug):
    for s, _name, _desc, _sys, builder in DEFAULT_ROLES:
        if s == slug:
            return builder()
    return blank_permissions()


def normalize_permissions(raw):
    """Coerce an arbitrary incoming permission map into the canonical shape:
    only known modules/actions, every value a strict bool, missing entries
    filled with False."""
    raw = raw or {}
    out = blank_permissions()
    for m in MODULE_KEYS:
        mod = raw.get(m) or {}
        if isinstance(mod, dict):
            for a in ACTION_KEYS:
                out[m][a] = bool(mod.get(a, False))
    return out
