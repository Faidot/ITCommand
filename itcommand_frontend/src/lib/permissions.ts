// Client-side helpers for the role/permission map that the API returns on
// /auth/me. The backend remains the source of truth and re-checks everything;
// these helpers gate the UI (hide nav, block pages) so a user never sees a
// module their role can't access.

export type ActionKey = "view" | "add" | "edit" | "delete";
export type PermMap = Record<string, Record<ActionKey, boolean>>;

export interface PermUser {
  role?: string;
  permissions?: PermMap;
}

/** Can this user perform `action` on `module`? */
export function can(user: PermUser | null | undefined, module: string, action: ActionKey = "view"): boolean {
  if (!user) return false;
  // Superadmin is always all-access, regardless of what's stored.
  if (user.role === "SUPERADMIN") return true;
  // Unknown/stale sessions fail closed until /auth/me returns a permission map.
  if (!user.permissions) return false;
  return !!user.permissions?.[module]?.[action];
}

/** Map a route path to its module key, so the layout can guard pages. */
const ROUTE_MODULES: Array<[string, string]> = [
  ["/dashboard", "dashboard"],
  ["/users", "users"],
  ["/departments", "departments"],
  ["/onboarding", "onboarding"],
  ["/seating", "seating"],
  ["/asset-notes", "assets"],
  ["/assets", "assets"],
  ["/licenses", "licenses"],
  ["/subscriptions", "subscriptions"],
  ["/vendors", "vendors"],
  ["/procurement", "procurement"],
  ["/network", "network"],
  ["/kb", "kb"],
  ["/helpdesk", "helpdesk"],
  ["/vault", "vault"],
  ["/finance", "finance"],
  ["/reports", "reports"],
  ["/settings", "settings"],
];

/** The module a given pathname belongs to, or null if it isn't gated. */
export function moduleForPath(pathname: string): string | null {
  for (const [prefix, mod] of ROUTE_MODULES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return mod;
  }
  return null;
}
