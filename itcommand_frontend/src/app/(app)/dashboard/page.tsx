"use client";

/**
 * The admin dashboard: every module's headline numbers, on one screen.
 *
 * Two rules drive the whole layout.
 *
 * **It fits the viewport.** The grid is sized from `100dvh` and every tile
 * shares the leftover height, so a wall display shows the same board a laptop
 * does — larger, not longer. Scrolling a status board defeats the point of
 * having one. Below `sm` that stops being achievable: eleven modules on a
 * 375px phone would be too small to read, so there and only there the grid
 * scrolls rather than shrinking into illegibility.
 *
 * **It shows only what you may see.** The API already zeroes out modules a
 * role cannot view, which meant an estate-only user saw "Assets 0" — a number
 * that reads as a fact about the company when it is really a fact about their
 * permissions. Tiles are now filtered by the same `can()` the sidebar uses, so
 * an absent module is absent rather than falsely empty.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity, BookOpen, Box, Building, Globe, Headset, Map, Network,
  RefreshCw, ShoppingCart, UserPlus, Users, Wallet,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { useMoney } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { FLUID, ModuleTile, TrendStrip } from "./dashboard-ui";

interface Dashboard {
  kpis: Record<string, number>;
  income_vs_expense: { month: string; income: number; expense: number }[];
  helpdesk: Record<string, number>;
  estate: Record<string, number | string | boolean | unknown[]>;
  procurement: Record<string, number>;
  vendors: Record<string, number>;
  network: Record<string, number>;
  onboarding: Record<string, number>;
  seating: Record<string, number>;
  kb: Record<string, number>;
  warranties_expiring: unknown[];
  contracts_expiring: unknown[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function DashboardPage() {
  const money = useMoney();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<Dashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const res = await api.get<Dashboard>("/dashboard/");
      setData(res.data);
    } catch {
      toast.error("Failed to load dashboard data");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="grid h-[calc(100dvh-9rem)] grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-full w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const k = data.kpis;
  const estate = data.estate;

  // Each entry names the module it belongs to, so one `can()` filter governs
  // the whole board — the same rule the sidebar and route guard already use.
  const tiles: {
    module: string;
    node: React.ReactNode;
  }[] = [
    {
      module: "users",
      node: (
        <ModuleTile
          key="users" icon={Users} title="People" href="/users"
          headline={num(k.total_users)}
          stats={[
            { label: "active", value: num(k.active_users), tone: "ok" },
            { label: "inactive", value: num(k.total_users) - num(k.active_users), tone: "muted" },
          ]}
        />
      ),
    },
    {
      module: "assets",
      node: (
        <ModuleTile
          key="assets" icon={Box} title="Assets" href="/assets"
          headline={num(k.total_assets)}
          alert={data.warranties_expiring.length ? `${data.warranties_expiring.length} warranty` : undefined}
          stats={[
            { label: "assigned", value: num(k.assets_assigned) },
            { label: "value", value: money(num(k.asset_value)) },
          ]}
        />
      ),
    },
    {
      module: "finance",
      node: (
        <ModuleTile
          key="finance" icon={Wallet} title="Budget" href="/finance/budget"
          headline={`${num(k.budget_used_pct).toFixed(0)}%`}
          headlineTone={num(k.budget_used_pct) > 90 ? "bad" : num(k.budget_used_pct) > 75 ? "warn" : "ok"}
          stats={[
            { label: "spent", value: money(num(k.total_spent)) },
            { label: "budget", value: money(num(k.total_budget)) },
            { label: "bills 7d", value: num(k.upcoming_bills_count) },
          ]}
        />
      ),
    },
    {
      module: "helpdesk",
      node: (
        <ModuleTile
          key="helpdesk" icon={Headset} title="Helpdesk" href="/helpdesk/tickets"
          headline={num(data.helpdesk.open)}
          headlineTone={num(data.helpdesk.overdue) > 0 ? "warn" : "ok"}
          alert={num(data.helpdesk.overdue) ? `${num(data.helpdesk.overdue)} overdue` : undefined}
          stats={[
            { label: "unassigned", value: num(data.helpdesk.unassigned), tone: num(data.helpdesk.unassigned) ? "warn" : undefined },
            { label: "resolved", value: num(data.helpdesk.resolved), tone: "ok" },
            { label: "total", value: num(data.helpdesk.total) },
          ]}
        />
      ),
    },
    {
      module: "estate",
      node: (
        <ModuleTile
          key="estate" icon={Globe} title="Digital Estate" href="/estate/dashboard"
          headline={money(num(estate.monthly_cost))}
          alert={num(estate.accounts_missing_mfa) ? `${num(estate.accounts_missing_mfa)} no MFA` : undefined}
          stats={[
            { label: "services", value: num(estate.active) },
            { label: "properties", value: num(estate.properties) },
            { label: "renewing 60d", value: num(estate.expiring_soon), tone: num(estate.expiring_soon) ? "warn" : undefined },
            { label: "orphans", value: num(estate.orphans), tone: num(estate.orphans) ? "warn" : undefined },
          ]}
        />
      ),
    },
    {
      module: "network",
      node: (
        <ModuleTile
          key="network" icon={Network} title="Network" href="/network"
          headline={`${num(data.network.online)}/${num(data.network.total)}`}
          headlineTone={num(data.network.offline) ? "warn" : "ok"}
          stats={[
            { label: "offline", value: num(data.network.offline), tone: num(data.network.offline) ? "bad" : undefined },
            { label: "warranty 30d", value: num(data.network.warranty_expiring) },
          ]}
        />
      ),
    },
    {
      module: "procurement",
      node: (
        <ModuleTile
          key="procurement" icon={ShoppingCart} title="Procurement" href="/procurement/requests"
          headline={num(data.procurement.pending)}
          headlineTone={num(data.procurement.pending) ? "warn" : "ok"}
          stats={[
            { label: "approved", value: num(data.procurement.approved), tone: "ok" },
            { label: "estimated", value: money(num(data.procurement.est_total)) },
          ]}
        />
      ),
    },
    {
      module: "vendors",
      node: (
        <ModuleTile
          key="vendors" icon={Building} title="Vendors" href="/vendors"
          headline={num(data.vendors.total)}
          alert={data.contracts_expiring.length ? `${data.contracts_expiring.length} contract` : undefined}
          stats={[
            { label: "active", value: num(data.vendors.active), tone: "ok" },
            { label: "expiring 90d", value: num(data.vendors.contracts_expiring), tone: num(data.vendors.contracts_expiring) ? "warn" : undefined },
          ]}
        />
      ),
    },
    {
      module: "onboarding",
      node: (
        <ModuleTile
          key="onboarding" icon={UserPlus} title="Onboarding" href="/onboarding"
          headline={num(data.onboarding.in_progress)}
          headlineTone={num(data.onboarding.overdue) ? "warn" : undefined}
          stats={[
            { label: "not started", value: num(data.onboarding.not_started) },
            { label: "overdue", value: num(data.onboarding.overdue), tone: num(data.onboarding.overdue) ? "bad" : undefined },
          ]}
        />
      ),
    },
    {
      module: "seating",
      node: (
        <ModuleTile
          key="seating" icon={Map} title="Seating" href="/seating"
          headline={`${num(data.seating.pct)}%`}
          stats={[
            { label: "occupied", value: num(data.seating.occupied) },
            { label: "seats", value: num(data.seating.total) },
          ]}
        />
      ),
    },
    {
      module: "kb",
      node: (
        <ModuleTile
          key="kb" icon={BookOpen} title="Knowledge Base" href="/kb"
          headline={num(data.kb.published)}
          stats={[
            { label: "total", value: num(data.kb.total) },
            { label: "views", value: num(data.kb.views) },
          ]}
        />
      ),
    },
  ];

  const visible = tiles.filter((t) => can(user, t.module, "view"));
  const showTrend = can(user, "finance", "view") && data.income_vs_expense.length > 0;

  return (
    // `dvh` not `vh`: on mobile browsers the toolbar collapses on scroll and
    // `vh` keeps the old height, leaving a strip cut off the bottom.
    // Fixed height above `sm` so nothing scrolls; auto below it, where fitting
    // eleven modules on screen would mean text nobody can read.
    <div className="flex flex-col gap-[clamp(0.4rem,0.6vh,1rem)] sm:h-[calc(100dvh-9rem)] sm:overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className={`truncate font-semibold tracking-tight ${FLUID.title}`}>Dashboard</h1>
          <p className={`truncate text-muted-foreground ${FLUID.caption}`}>
            {visible.length} module{visible.length === 1 ? "" : "s"} you can see
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border text-sm text-muted-foreground">
          Your role has no modules assigned. Contact an administrator.
        </div>
      ) : (
        <div
          className={`grid min-h-0 flex-1 auto-rows-fr grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 ${FLUID.gap}`}
        >
          {visible.map((t) => t.node)}

          {showTrend && (
            <div
              className={`col-span-2 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card ${FLUID.pad}`}
            >
              <div className="flex shrink-0 items-center gap-1.5">
                <Activity className="h-[clamp(0.75rem,0.6vw,1.5rem)] w-[clamp(0.75rem,0.6vw,1.5rem)] shrink-0 text-muted-foreground" />
                <span className={`truncate font-medium ${FLUID.label}`}>Income vs expense · 6 months</span>
              </div>
              <TrendStrip points={data.income_vs_expense} format={money} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
