"use client";

/**
 * The admin dashboard: a bento grid you can rearrange.
 *
 * Cards are a registry rather than inline markup, because three things now
 * need to vary per card at runtime — its order, its size, and how much detail
 * it renders — and none of that is expressible in fixed JSX.
 *
 * Each card's `render` receives its current width and height, so enlarging a
 * card shows *more* rather than stretching the same content over more pixels.
 * That is the point of a resizable board: size is a request for detail, not
 * for whitespace.
 *
 * Cards are filtered by the same `can()` the sidebar uses. The API already
 * zeroes out modules a role cannot view, which meant an estate-only user saw
 * "Assets 0" — a number that reads as a fact about the company when it is
 * really a fact about their access.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, BookOpen, Box, Building, CalendarDays, Check, CircleDot, Globe,
  Headset, LayoutGrid, Map as MapIcon, Network, RefreshCw, RotateCcw, ShieldAlert,
  ShoppingCart, TrendingUp, UserPlus, Users, Wallet,
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

import {
  Bento, CardLabel, EditableBento, Figure, Key, Meter, MIN_H, PairedBars, SPAN, TickArc,
} from "./bento";
import { CardLayout, Height, Width, useDashboardLayout } from "./use-layout";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WARN = "text-amber-600 dark:text-amber-400";
const BAD = "text-red-600 dark:text-red-400";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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

interface CardDef {
  id: string;
  module: string | null;
  href: string;
  w: Width;
  h: Height;
  render: (w: Width, h: Height) => React.ReactNode;
}

/** List height follows the card's height, so a taller card shows more rows. */
const listHeight = (h: Height) => (h === 2 ? "h-[24rem] pr-3" : "h-[11.5rem] pr-3");

export default function DashboardPage() {
  const money = useMoney();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<any>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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

  useEffect(() => {
    if (user?.role !== "SUPERADMIN") return;
    const pull = () => api.get("/users/active/").then((r) => setPresence(r.data)).catch(() => {});
    void pull();
    const t = setInterval(pull, 30000);
    return () => clearInterval(t);
  }, [user]);

  /* ── card registry ───────────────────────────────────────────── */
  const cards: CardDef[] = useMemo(() => {
    if (!data) return [];
    const k = data.kpis ?? {};
    const estate = data.estate ?? {};
    const est = compact(num(estate.monthly_cost));
    const budgetPct = num(k.budget_used_pct);
    const devTotal = num(k.devices_total);
    const devOnline = num(k.devices_online);
    const alerts = [
      ...(data.warranties_expiring ?? []).map((w: any) => ({ title: w.name, meta: `Warranty · ${w.tag}`, days: w.days })),
      ...(data.contracts_expiring ?? []).map((c: any) => ({ title: c.title, meta: `Contract · ${c.vendor}`, days: c.days })),
    ].sort((a: any, b: any) => a.days - b.days);

    const defs: CardDef[] = [
      {
        id: "budget", module: "finance", href: "/finance/budget", w: 3, h: 1,
        render: (w) => (
          <>
            <CardLabel icon={Wallet}>Budget used</CardLabel>
            <TickArc pct={budgetPct} value={budgetPct.toFixed(0)} unit="%"
              tone={budgetPct > 90 ? BAD : budgetPct > 75 ? WARN : "text-primary"} />
            <div className="mt-2 flex shrink-0 items-baseline justify-between text-xs text-muted-foreground">
              <span className="truncate">{money(num(k.total_spent))} spent</span>
              <span className="truncate">of {money(num(k.total_budget))}</span>
            </div>
            {/* Wider is a request for the breakdown, not a bigger gauge. */}
            {w >= 4 && (
              <div className="mt-2 shrink-0">
                <Meter label="Bills due in 7 days" value={num(k.upcoming_bills_count)}
                  max={Math.max(1, num(k.upcoming_bills_count))}
                  display={money(num(k.upcoming_bills_amount))} tone="bg-amber-500" />
              </div>
            )}
          </>
        ),
      },
      {
        id: "estate", module: "estate", href: "/estate/dashboard", w: 2, h: 1,
        render: (w) => (
          <>
            <CardLabel icon={Globe}>Estate / month</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={est.value} unit={`${est.unit ?? ""}${String(estate.currency ?? "")}`} />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {num(estate.active)} services · {num(estate.properties)} properties
              </span>
            </div>
            <Meter
              label={num(estate.accounts_missing_mfa) ? "Accounts without MFA" : "Renewing in 60d"}
              value={num(estate.accounts_missing_mfa) || num(estate.expiring_soon)}
              max={Math.max(1, num(estate.active))}
              display={String(num(estate.accounts_missing_mfa) || num(estate.expiring_soon))}
              tone={num(estate.accounts_missing_mfa) ? "bg-red-500" : "bg-amber-500"}
            />
            {w >= 4 && (
              <div className="mt-1.5 shrink-0 space-y-1.5">
                <Meter label="Orphaned services" value={num(estate.orphans)} max={Math.max(1, num(estate.active))} tone="bg-amber-500" />
                <Meter label="Renewing in 60 days" value={num(estate.expiring_soon)} max={Math.max(1, num(estate.active))} />
              </div>
            )}
          </>
        ),
      },
      {
        id: "assets", module: "assets", href: "/assets", w: 2, h: 1,
        render: () => (
          <>
            <CardLabel icon={Box}>Assets</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(k.total_assets)} />
              <span className="mt-1 truncate text-xs text-muted-foreground">{money(num(k.asset_value))} value</span>
            </div>
            <Meter label="Assigned" value={num(k.assets_assigned)} max={Math.max(1, num(k.total_assets))}
              display={`${num(k.assets_assigned)}/${num(k.total_assets)}`} />
          </>
        ),
      },
      {
        id: "trend", module: "finance", href: "/reports/financial", w: 4, h: 1,
        render: () => (
          <>
            <CardLabel icon={TrendingUp} action={
              <div className="flex items-center gap-3">
                <Key tone="bg-primary">Income</Key>
                <Key tone="bg-primary/30">Expense</Key>
              </div>
            }>
              Income vs expense · 6 months
            </CardLabel>
            <PairedBars points={data.income_vs_expense ?? []} format={money} />
          </>
        ),
      },
      {
        id: "people", module: "users", href: "/users", w: 3, h: 1,
        render: (w) => (
          <>
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
                  {presence.online.slice(0, w >= 4 ? 7 : 4).map((p) => (
                    <span key={p.id} title={`${p.full_name} · ${p.email}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-primary/10 text-[11px] font-semibold text-primary">
                      {p.full_name.slice(0, 2).toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Meter label="Active" value={num(k.active_users)} max={Math.max(1, num(k.total_users))}
              display={`${num(k.active_users)}/${num(k.total_users)}`} />
          </>
        ),
      },
      {
        id: "helpdesk", module: "helpdesk", href: "/helpdesk/tickets", w: 4, h: 1,
        render: () => (
          <>
            <CardLabel icon={Headset}>Helpdesk</CardLabel>
            <div className="flex flex-1 items-end gap-4">
              <Figure value={num(data.helpdesk?.open)} unit="open" />
              <div className="min-w-0 flex-1 space-y-1.5 pb-1">
                <Meter label="Overdue" value={num(data.helpdesk?.overdue)} max={Math.max(1, num(data.helpdesk?.total))} tone="bg-red-500" />
                <Meter label="Unassigned" value={num(data.helpdesk?.unassigned)} max={Math.max(1, num(data.helpdesk?.total))} tone="bg-amber-500" />
                <Meter label="Resolved" value={num(data.helpdesk?.resolved)} max={Math.max(1, num(data.helpdesk?.total))} tone="bg-emerald-500" />
              </div>
            </div>
          </>
        ),
      },
      {
        id: "network", module: "network", href: "/network", w: 3, h: 1,
        render: () => (
          <>
            <CardLabel icon={Network}>Network health</CardLabel>
            <TickArc pct={devTotal ? (devOnline / devTotal) * 100 : 0} value={devOnline} unit={`of ${devTotal}`}
              tone={num(data.network?.offline) ? WARN : "text-emerald-500"} />
            <div className="mt-2 flex shrink-0 items-baseline justify-between text-xs text-muted-foreground">
              <span className={num(data.network?.offline) ? BAD : ""}>{num(data.network?.offline)} offline</span>
              <span>{num(data.network?.warranty_expiring)} warranty 30d</span>
            </div>
          </>
        ),
      },
      {
        id: "seating", module: "seating", href: "/seating", w: 2, h: 1,
        render: () => (
          <>
            <CardLabel icon={MapIcon}>Seating</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.seating?.pct)} unit="%" />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {num(data.seating?.occupied)} of {num(data.seating?.total)} seats
              </span>
            </div>
            <Meter label="Occupancy" value={num(data.seating?.occupied)} max={Math.max(1, num(data.seating?.total))} />
          </>
        ),
      },
      {
        id: "procurement", module: "procurement", href: "/procurement/requests", w: 2, h: 1,
        render: () => (
          <>
            <CardLabel icon={ShoppingCart}>Procurement</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.procurement?.pending)} unit="pending" tone={num(data.procurement?.pending) ? WARN : ""} />
              <span className="mt-1 truncate text-xs text-muted-foreground">{num(data.procurement?.approved)} approved</span>
            </div>
            <Meter label="Approved" value={num(data.procurement?.approved)} max={Math.max(1, num(data.procurement?.total))}
              display={money(num(data.procurement?.est_total))} />
          </>
        ),
      },
      {
        id: "vendors", module: "vendors", href: "/vendors", w: 2, h: 1,
        render: () => (
          <>
            <CardLabel icon={Building}>Vendors</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.vendors?.total)} />
              <span className="mt-1 truncate text-xs text-muted-foreground">{num(data.vendors?.active)} active</span>
            </div>
            <Meter
              label={num(data.vendors?.contracts_expiring) ? "Contracts expiring" : "Active"}
              value={num(data.vendors?.contracts_expiring) || num(data.vendors?.active)}
              max={Math.max(1, num(data.vendors?.total))}
              display={num(data.vendors?.contracts_expiring)
                ? `${num(data.vendors.contracts_expiring)} soon`
                : `${num(data.vendors?.active)}/${num(data.vendors?.total)}`}
              tone={num(data.vendors?.contracts_expiring) ? "bg-amber-500" : "bg-primary"}
            />
          </>
        ),
      },
      {
        id: "onboarding", module: "onboarding", href: "/onboarding", w: 2, h: 1,
        render: () => (
          <>
            <CardLabel icon={UserPlus}>Onboarding</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.onboarding?.in_progress)} unit="active" />
              <span className="mt-1 truncate text-xs text-muted-foreground">{num(data.onboarding?.not_started)} not started</span>
            </div>
            <Meter
              label={num(data.onboarding?.overdue) ? "Overdue" : "In progress"}
              value={num(data.onboarding?.overdue) || num(data.onboarding?.in_progress)}
              max={Math.max(1, num(data.onboarding?.in_progress) + num(data.onboarding?.not_started))}
              display={num(data.onboarding?.overdue)
                ? `${num(data.onboarding.overdue)} late`
                : `${num(data.onboarding?.in_progress)}`}
              tone={num(data.onboarding?.overdue) ? "bg-red-500" : "bg-primary"}
            />
          </>
        ),
      },
      {
        id: "kb", module: "kb", href: "/kb", w: 2, h: 1,
        render: () => (
          <>
            <CardLabel icon={BookOpen}>Knowledge base</CardLabel>
            <div className="flex flex-1 flex-col justify-center">
              <Figure value={num(data.kb?.published)} unit="live" />
              <span className="mt-1 truncate text-xs text-muted-foreground">
                {compact(num(data.kb?.views)).value}{compact(num(data.kb?.views)).unit} views
              </span>
            </div>
            <Meter label="Published" value={num(data.kb?.published)} max={Math.max(1, num(data.kb?.total))}
              display={`${num(data.kb?.published)}/${num(data.kb?.total)}`} />
          </>
        ),
      },
      {
        id: "expiring", module: null, href: "/reports/assets", w: 4, h: 1,
        render: (_w, h) => (
          <>
            <CardLabel icon={ShieldAlert} action={
              alerts.length ? <span className="text-xs font-semibold tabular-nums">{alerts.length}</span> : undefined
            }>
              Expiring soon
            </CardLabel>
            <ScrollArea className={listHeight(h)}>
              {alerts.length ? (
                <div className="space-y-2">
                  {alerts.map((a: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{a.title}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{a.meta}</div>
                      </div>
                      <Badge variant={a.days <= 14 ? "destructive" : "secondary"} className="shrink-0 tabular-nums">{a.days}d</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="pt-8 text-center text-sm text-muted-foreground">Nothing expiring soon.</p>}
            </ScrollArea>
          </>
        ),
      },
      {
        id: "activity", module: null, href: "/settings/audit-log", w: 4, h: 1,
        render: (_w, h) => (
          <>
            <CardLabel icon={Activity}>Recent activity</CardLabel>
            <ScrollArea className={listHeight(h)}>
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
              ) : <p className="pt-8 text-center text-sm text-muted-foreground">No recent activity.</p>}
            </ScrollArea>
          </>
        ),
      },
    ];

    if (presence) {
      defs.push({
        id: "presence", module: null, href: "/settings/audit-log", w: 4, h: 1,
        render: (_w, h) => (
          <>
            <CardLabel icon={Users} action={
              <span className="text-[11px] text-muted-foreground">last {Math.round(presence.window_seconds / 60)} min</span>
            }>
              Signed in now
            </CardLabel>
            <ScrollArea className={listHeight(h)}>
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
              ) : <p className="pt-8 text-center text-sm text-muted-foreground">Nobody active right now.</p>}
            </ScrollArea>
          </>
        ),
      });
    }

    return defs;
  }, [data, presence, money]);

  // Only cards this role may see. The layout is built from that set, so a
  // saved arrangement can never reintroduce a module somebody lost access to.
  const allowed = useMemo(
    () => cards.filter((c) => c.module === null || can(user, c.module, "view")),
    [cards, user],
  );

  const defaults = useMemo<CardLayout[]>(
    () => allowed.map((c) => ({ id: c.id, w: c.w, h: c.h })),
    [allowed],
  );

  const { layout, move, resize, toggle, reset } = useDashboardLayout(user?.id, defaults);
  const byId = useMemo(() => new Map(allowed.map((c) => [c.id, c])), [allowed]);
  const ordered = useMemo(() => layout.filter((l) => byId.has(l.id)), [layout, byId]);
  const visible = editing ? ordered : ordered.filter((l) => !l.hidden);
  const hiddenCount = ordered.filter((l) => l.hidden).length;

  if (!data) {
    return (
      <div className="mx-auto max-w-[1800px] space-y-4 p-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-12 gap-3">
          {["md:col-span-6 xl:col-span-3", "md:col-span-3 xl:col-span-2", "md:col-span-3 xl:col-span-2",
            "xl:col-span-4", "md:col-span-6 xl:col-span-3", "md:col-span-6 xl:col-span-4",
            "md:col-span-6 xl:col-span-3", "md:col-span-3 xl:col-span-2"].map((span, i) => (
            <Skeleton key={i} className={`col-span-12 h-40 rounded-2xl ${span}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.3rem,0.7vw+1.1rem,2.1rem)] font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground">
            {editing
              ? "Drag a card to reorder · − and + to resize · eye to hide"
              : new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {presence && !editing && (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/40 py-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {presence.online_count} online
            </Badge>
          )}
          {editing && (
            <>
              {hiddenCount > 0 && <span className="text-xs text-muted-foreground">{hiddenCount} hidden</span>}
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="mr-2 h-4 w-4" /> Reset
              </Button>
            </>
          )}
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          )}
          <Button variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing((e) => !e)}>
            {editing ? <Check className="mr-2 h-4 w-4" /> : <LayoutGrid className="mr-2 h-4 w-4" />}
            {editing ? "Done" : "Customise"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {visible.map((l) => {
          const def = byId.get(l.id);
          if (!def) return null;

          if (!editing) {
            return (
              <Bento key={l.id} span={SPAN[l.w]} className={MIN_H[l.h]} href={def.href}>
                {def.render(l.w, l.h)}
              </Bento>
            );
          }

          // Index into `ordered`, not the filtered view, so a drop lands where
          // it looks like it will even with hidden cards in the list.
          const realIndex = ordered.findIndex((o) => o.id === l.id);
          return (
            <EditableBento
              key={l.id}
              card={l}
              index={realIndex}
              dragging={dragFrom === realIndex}
              over={dragOver === realIndex}
              onDragStart={setDragFrom}
              onDragOver={setDragOver}
              onDrop={(to) => {
                if (dragFrom !== null) move(dragFrom, to);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
              onResize={resize}
              onToggle={toggle}
            >
              {def.render(l.w, l.h)}
            </EditableBento>
          );
        })}
      </div>
    </div>
  );
}
