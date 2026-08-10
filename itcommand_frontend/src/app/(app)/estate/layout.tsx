"use client";

/**
 * The Digital Estate shell: a header and the sub-nav.
 *
 * No command palette here. The top bar already binds ⌘K globally and searches
 * /api/search/; the estate's properties, accounts and services were added to
 * that endpoint instead. A second binding meant two dialogs opened on one
 * keypress, and a search that only worked inside /estate is a worse answer
 * than one that works everywhere.
 *
 * The sub-nav is real routing rather than tab state. Each screen fetches its
 * own data and is independently linkable, which the previous tabbed version
 * was not — "send me the accounts page" meant "open the hub and click".
 */

import { usePathname } from "next/navigation";
import Link from "next/link";
import { CreditCard, Globe, KeyRound, LayoutDashboard, Plus, Server } from "lucide-react";

import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";

import { AddServiceProvider, useAddServiceDialog } from "./add-service-context";

const TABS = [
  { href: "/estate/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/estate/properties", label: "Properties", icon: Globe },
  { href: "/estate/accounts", label: "Accounts", icon: KeyRound },
  { href: "/estate/services", label: "Services", icon: Server },
  { href: "/estate/payments", label: "Cards & charges", icon: CreditCard },
];

function SubNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Split from the default export because it consumes the Add Service context,
 * which the provider below has to sit above.
 */
function EstateShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "estate", "add");
  const { open: openAddService } = useAddServiceDialog();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Digital Estate</h1>
          <p className="text-sm text-muted-foreground">
            Every property we own, the services that keep it running, and who can
            get into them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canAdd && (
            <Button size="sm" onClick={() => openAddService()}>
              <Plus className="mr-2 h-4 w-4" /> Add service
            </Button>
          )}
        </div>
      </div>

      <SubNav />
      {children}
    </div>
  );
}

export default function EstateLayout({ children }: { children: React.ReactNode }) {
  return (
    <AddServiceProvider>
      <EstateShell>{children}</EstateShell>
    </AddServiceProvider>
  );
}
