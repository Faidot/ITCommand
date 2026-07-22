"use client";

import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { can, moduleForPath } from "@/lib/permissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Blocks a page when the signed-in user's role has no `view` permission for
 * the module that owns the current route. This is the UI counterpart to the
 * backend's HasModulePermission — the API re-checks every request, this just
 * keeps users out of pages they shouldn't reach (e.g. via a typed URL).
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuthStore();

  const routeModule = moduleForPath(pathname || "");

  if (routeModule && user && !can(user, routeModule, "view")) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            Your role ({user.role_label || user.role}) doesn&apos;t have access to this section.
            Contact an administrator if you need it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}
