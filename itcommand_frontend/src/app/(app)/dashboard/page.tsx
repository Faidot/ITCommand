"use client";

/**
 * The admin dashboard, as a bento grid.
 *
 * Layout language borrowed from the reference boards: cards of unequal size on
 * a 12-column grid, one oversized figure per card with its unit set small
 * beside it, tick-mark arcs in place of pie charts, and colour spent only
 * where it carries meaning. Everything is drawn from theme tokens rather than
 * fixed colours, so it holds up in light and dark.
 *
 * Cards are filtered by the same `can()` the sidebar uses. The API already
 * zeroes out modules a role cannot view, which meant an estate-only user was
 * shown "Assets 0" — a number that reads as a fact about the company when it
 * is really a fact about their access. A module you lack is absent instead.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity, BookOpen, Box, Building, CalendarDays, CircleDot, Globe, Headset,
  Map, Network, RefreshCw, ShieldAlert, ShoppingCart, TrendingUp, UserPlus,
  Users, Wallet,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { useMoney } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

import { Bento, CardLabel, Figure, Key, Meter, PairedBars, TickArc } from "./bento";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WARN = "text-amber-600 dark:text-amber-400";
const BAD = "text-red-600 dark:text-red-400";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "1.2M" / "4.2k" — keeps a big figure from wrapping its card. */
function compact(n: number): { value: string; unit?: string } {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return { value: (n / 1_000_000).toFixed(1), unit: "M" };
  if (abs >= 10_000) return { value: (n / 1_000).toFixed(1), unit: "k" };
  return { value: String(Math.round(n)) };
}

interface Presence {
  online_count: number;
  window_seconds: number;
  online: { id: number; full_name: string; email: string; seconds_ago: number | null }[];
}

export default function DashboardPage() {
  const money = useMoney();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<any>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const show = useCallback((m: string) => can(user, m, "view"), [user]);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const res = await api.get("/dashboard/");
      setData(res.data);
    } catch {
      toast.error("Failed to load dashboard data");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live presence is superadmin-only on the API; ask once and stay quiet if
  // it refuses rather than showing an error for a panel that is a bonus.
  useEffect(() => {
    if (user?.role !== "SUPERADMIN") return;
    const pull = () => api.get("/users/active/").then((r) => setPresence(r.data)).catch(() => {});
    void pull();
    const t = setInterval(pull, 30000);
    return () => clearInterval(t);
  }, [user]);

  if (!data) {
    return (
      <div className="mx-auto max-w-[1800px] space-y-4 p-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-12 gap-3">
          {[
            "md:col-span-6 xl:col-span-3", "md:col-span-3 xl:col-span-2",
            "md:col-span-3 xl:col-span-2", "xl:col-span-5",
            "md:col-span-6 xl:col-span-3", "md:col-span-6 xl:col-span-4",
            "md:col-span-6 xl:col-span-3", "md:col-span-3 xl:col-span-2",
          ].map((span, i) => (
            <Skeleton key={i} className={`col-span-12 h-40 rounded-2xl ${span}`} />
          ))}
        </div>
      </div>
    );
  }

  const k = data.kpis;
  const estate = data.estate ?? {};
  const estateMonthly = compact(num(estate.monthly_cost));
  const budgetPct = num(k.budget_used_pct);
  const devicesTotal = num(k.devices_total);
  const devicesOnline = num(k.devices_online);
  const alerts = [
    ...(data.warranties_expiring ?? []).map((w: any) => ({
      title: w.name, meta: `Warranty · ${w.tag}`, days: w.days,
    })),
    ...(data.contracts_expiring ?? []).map((c: any) => ({
      title: c.title, meta: `Contract · ${c.vendor}`, days: c.days,
    })),
  ].sort((a, b) => a.days - b.days);

  return (
    <div className="mx-auto max-w-[1800px] space-y-3 p-3 sm:p-4">
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.3rem,0.7vw+1.1rem,2.1rem)] font-semibold tracking-tight">
            Command Center
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {presence && (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/40 py-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {presence.online_count} online
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ── the grid ───────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-3">

        {/* Budget gauge — the hero metric */}
        {show("finance") && (
          <Bento span="col-span-12 md:col-span-6 xl:col-span-3" href="/finance/budget" className="min-h-[13rem]">
            <CardLabel icon={Wallet}>Budget used</CardLabel>
            <TickArc
              pct={budgetPct}
              value={budgetPct.toFixed(0)}
              unit="%"
              tone={budgetPct > 90 ? BAD : budgetPct > 75 ? WARN : "text-primary"}
            />
            <div className="mt-2 flex shrink-0 items-baseline justify-between text-xs text-muted-foreground">
              <span className="truncate">{money(num(k.total_spent))} spent</span>
              <span className="truncate">of {money(num(k.total_budget))}</span>
            </div>
          </Bento>
        )}

        {/* Estate spend */}
        {show("estate") && (
          <Bento span="col-span-6 md:col-span-3 xl:col-span-2" href="/estate/dashboard">
            <CardLabel icon={Globe}>Estate / month</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure
                value={estateMonthly.value}
                unit={`${estateMonthly.unit ?? ""}${String(estate.currency ?? "")}`}
              />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {num(estate.active)} services · {num(estate.properties)} properties
              </span>
            </div>
            {num(estate.accounts_missing_mfa) > 0 && (
              <Badge className="mt-2 w-fit border-transparent bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
                {num(estate.accounts_missing_mfa)} accounts without MFA
              </Badge>
            )}
          </Bento>
        )}

        {/* Assets */}
        {show("assets") && (
          <Bento span="col-span-6 md:col-span-3 xl:col-span-2" href="/assets">
            <CardLabel icon={Box}>Assets</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(k.total_assets)} />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {money(num(k.asset_value))} value
              </span>
            </div>
            <Meter
              label="Assigned"
              value={num(k.assets_assigned)}
              max={Math.max(1, num(k.total_assets))}
              display={`${num(k.assets_assigned)}/${num(k.total_assets)}`}
            />
          </Bento>
        )}

        {/* Income vs expense */}
        {show("finance") && (
          <Bento span="col-span-12 xl:col-span-5" className="min-h-[13rem]">
            <CardLabel icon={TrendingUp} action={
              <div className="flex items-center gap-3">
                <Key tone="bg-primary">Income</Key>
                <Key tone="bg-primary/25">Expense</Key>
              </div>
            }>
              Income vs expense · 6 months
            </CardLabel>
            <PairedBars points={data.income_vs_expense ?? []} format={money} />
          </Bento>
        )}

        {/* People + live presence */}
        {show("users") && (
          <Bento span="col-span-12 md:col-span-6 xl:col-span-3" href="/users">
            <CardLabel icon={Users}>People</CardLabel>
            <div className="flex flex-1 items-end justify-between gap-3">
              <div className="min-w-0">
                <Figure value={num(k.total_users)} />
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {num(k.active_users)} active accounts
                </span>
              </div>
              {presence && presence.online.length > 0 && (
                <div className="flex shrink-0 -space-x-2">
                  {presence.online.slice(0, 4).map((p) => (
                    <span
                      key={p.id}
                      title={`${p.full_name} · ${p.email}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-primary/10 text-[11px] font-semibold text-primary"
                    >
                      {p.full_name.slice(0, 2).toUpperCase()}
                    </span>
                  ))}
                  {presence.online.length > 4 && (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold">
                      +{presence.online.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          </Bento>
        )}

        {/* Helpdesk */}
        {show("helpdesk") && (
          <Bento span="col-span-12 md:col-span-6 xl:col-span-4" href="/helpdesk/tickets">
            <CardLabel icon={Headset}>Helpdesk</CardLabel>
            <div className="flex flex-1 items-end gap-4">
              <div className="min-w-0">
                <Figure value={num(data.helpdesk?.open)} unit="open" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 pb-1">
                <Meter label="Overdue" value={num(data.helpdesk?.overdue)} max={Math.max(1, num(data.helpdesk?.total))} tone="bg-red-500" />
                <Meter label="Unassigned" value={num(data.helpdesk?.unassigned)} max={Math.max(1, num(data.helpdesk?.total))} tone="bg-amber-500" />
                <Meter label="Resolved" value={num(data.helpdesk?.resolved)} max={Math.max(1, num(data.helpdesk?.total))} tone="bg-emerald-500" />
              </div>
            </div>
          </Bento>
        )}

        {/* Network health arc */}
        {show("network") && (
          <Bento span="col-span-12 md:col-span-6 xl:col-span-3" href="/network" className="min-h-[13rem]">
            <CardLabel icon={Network}>Network health</CardLabel>
            <TickArc
              pct={devicesTotal ? (devicesOnline / devicesTotal) * 100 : 0}
              value={devicesOnline}
              unit={`of ${devicesTotal}`}
              tone={num(data.network?.offline) ? WARN : "text-emerald-500"}
            />
            <div className="mt-2 flex shrink-0 items-baseline justify-between text-xs text-muted-foreground">
              <span className={num(data.network?.offline) ? BAD : ""}>
                {num(data.network?.offline)} offline
              </span>
              <span>{num(data.network?.warranty_expiring)} warranty 30d</span>
            </div>
          </Bento>
        )}

        {/* Seating arc */}
        {show("seating") && (
          <Bento span="col-span-6 md:col-span-3 xl:col-span-2" href="/seating">
            <CardLabel icon={Map}>Seating</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.seating?.pct)} unit="%" />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {num(data.seating?.occupied)} of {num(data.seating?.total)} seats
              </span>
            </div>
            <Meter label="Occupancy" value={num(data.seating?.occupied)} max={Math.max(1, num(data.seating?.total))} />
          </Bento>
        )}

        {/* Procurement */}
        {show("procurement") && (
          <Bento span="col-span-6 md:col-span-3 xl:col-span-2" href="/procurement/requests">
            <CardLabel icon={ShoppingCart}>Procurement</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.procurement?.pending)} unit="pending" tone={num(data.procurement?.pending) ? WARN : ""} />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {num(data.procurement?.approved)} approved
              </span>
            </div>
            <span className="truncate text-xs font-medium tabular-nums">
              {money(num(data.procurement?.est_total))}
            </span>
          </Bento>
        )}

        {/* Vendors */}
        {show("vendors") && (
          <Bento span="col-span-6 md:col-span-3 xl:col-span-2" href="/vendors">
            <CardLabel icon={Building}>Vendors</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.vendors?.total)} />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {num(data.vendors?.active)} active
              </span>
            </div>
            {num(data.vendors?.contracts_expiring) > 0 && (
              <Badge className="w-fit border-transparent bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                {num(data.vendors.contracts_expiring)} contracts expiring
              </Badge>
            )}
          </Bento>
        )}

        {/* Onboarding */}
        {show("onboarding") && (
          <Bento span="col-span-6 md:col-span-3 xl:col-span-2" href="/onboarding">
            <CardLabel icon={UserPlus}>Onboarding</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.onboarding?.in_progress)} unit="active" />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {num(data.onboarding?.not_started)} not started
              </span>
            </div>
            {num(data.onboarding?.overdue) > 0 && (
              <Badge className="w-fit border-transparent bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
                {num(data.onboarding.overdue)} overdue
              </Badge>
            )}
          </Bento>
        )}

        {/* Knowledge base */}
        {show("kb") && (
          <Bento span="col-span-6 md:col-span-3 xl:col-span-2" href="/kb">
            <CardLabel icon={BookOpen}>Knowledge base</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.kb?.published)} unit="live" />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {compact(num(data.kb?.views)).value}{compact(num(data.kb?.views)).unit} views
              </span>
            </div>
            <Meter label="Published" value={num(data.kb?.published)} max={Math.max(1, num(data.kb?.total))} display={`${num(data.kb?.published)}/${num(data.kb?.total)}`} />
          </Bento>
        )}

        {/* Expiring soon */}
        <Bento span="col-span-12 md:col-span-6 xl:col-span-4">
          <CardLabel icon={ShieldAlert} action={
            alerts.length ? <span className="text-xs font-semibold tabular-nums">{alerts.length}</span> : undefined
          }>
            Expiring soon
          </CardLabel>
          <ScrollArea className="h-[13rem] pr-3">
            {alerts.length ? (
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{a.meta}</div>
                    </div>
                    <Badge variant={a.days <= 14 ? "destructive" : "secondary"} className="shrink-0 tabular-nums">
                      {a.days}d
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pt-8 text-center text-sm text-muted-foreground">Nothing expiring soon.</p>
            )}
          </ScrollArea>
        </Bento>

        {/* Recent activity */}
        <Bento span="col-span-12 md:col-span-6 xl:col-span-4">
          <CardLabel icon={Activity}>Recent activity</CardLabel>
          <ScrollArea className="h-[13rem] pr-3">
            {data.recent_activity?.length ? (
              <div className="space-y-2">
                {data.recent_activity.map((act: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5">
                    <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{act.title}</span>
                        {act.amount !== null && act.amount !== undefined && (
                          <span className="shrink-0 text-xs font-semibold tabular-nums">{money(act.amount)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />
                        <span className="truncate">{act.date}</span>
                        <span className="rounded bg-muted px-1 uppercase">{act.type}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pt-8 text-center text-sm text-muted-foreground">No recent activity.</p>
            )}
          </ScrollArea>
        </Bento>

        {/* Who's online — superadmin only, and only when the API answered */}
        {presence && (
          <Bento span="col-span-12 md:col-span-6 xl:col-span-4">
            <CardLabel icon={Users} action={
              <span className="text-[11px] text-muted-foreground">
                last {Math.round(presence.window_seconds / 60)} min
              </span>
            }>
              Signed in now
            </CardLabel>
            <ScrollArea className="h-[13rem] pr-3">
              {presence.online.length ? (
                <div className="space-y-1.5">
                  {presence.online.map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-2.5 py-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                        {p.full_name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.full_name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{p.email}</div>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
                        {p.seconds_ago !== null && p.seconds_ago < 60 ? "now" : `${Math.floor((p.seconds_ago ?? 0) / 60)}m`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pt-8 text-center text-sm text-muted-foreground">Nobody active right now.</p>
              )}
            </ScrollArea>
          </Bento>
        )}
      </div>
    </div>
  );
}
