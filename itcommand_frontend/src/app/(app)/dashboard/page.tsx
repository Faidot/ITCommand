"use client";

/**
 * The admin dashboard.
 *
 * Keeps the layout that worked — KPI row, charts, module grid, alerts and
 * activity — and sharpens it rather than replacing it.
 *
 * Two things changed beyond styling:
 *
 * **Sizing.** Headline numbers and card padding scale with
 * `clamp(min, preferred + vw, max)`, so the same board is legible on a phone,
 * a laptop and a wall-mounted TV. Breakpoints alone jump: a 1440px laptop and
 * a 3840px display land in the same bucket and render identical 24px figures,
 * which is small from across a room.
 *
 * **Permissions.** The API zeroes out modules a role cannot view, so an
 * estate-only user was shown "Assets 0" — a number that reads as a fact about
 * the company when it is really a fact about their access. Cards are filtered
 * by the same `can()` the sidebar uses, so a module you lack is absent rather
 * than falsely empty.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Users, Box, Wallet, Receipt, TrendingUp, CalendarDays, Activity,
  Headset, Globe, ShoppingCart, Building, Network, UserPlus, Map,
  BookOpen, ShieldAlert, ArrowRight, DollarSign, RefreshCw,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useMoney } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

const ACT_COLOR: Record<string, string> = {
  EXPENSE: "text-red-500", ASSET: "text-blue-500", TICKET: "text-sky-500", PROCUREMENT: "text-indigo-500",
};

/** The headline figure scales with the viewport; everything else follows Tailwind. */
const FIGURE = "text-[clamp(1.35rem,0.9vw+1rem,2.25rem)]";
const MODULE_FIGURE = "text-[clamp(1rem,0.55vw+0.8rem,1.6rem)]";

/** Soft tinted chip behind each icon — colour without shouting. */
const TINT: Record<string, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  green: "bg-green-500/10 text-green-600 dark:text-green-400",
  orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

interface KpiProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: string;
  tint?: keyof typeof TINT;
}

function Kpi({ icon: Icon, label, value, sub, href, tone, tint = "indigo" }: KpiProps) {
  const inner = (
    <Card
      className={`h-full overflow-hidden border-border/60 transition-all ${
        href ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5" : ""
      }`}
    >
      <CardContent className="flex h-full flex-col justify-between gap-2 p-[clamp(0.75rem,0.8vw,1.35rem)]">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className={`shrink-0 rounded-lg p-1.5 ${TINT[tint]}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <div>
          <div className={`font-semibold leading-none tabular-nums ${FIGURE} ${tone || ""}`}>{value}</div>
          {sub && <p className="mt-1.5 truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

interface ModuleStat {
  label: string;
  value: React.ReactNode;
  tone?: string;
}

function ModuleCard({
  icon: Icon, title, href, tint = "indigo", stats,
}: {
  icon: React.ElementType;
  title: string;
  href: string;
  tint?: keyof typeof TINT;
  stats: ModuleStat[];
}) {
  return (
    <Link href={href} className="block h-full">
      <Card className="group h-full overflow-hidden border-border/60 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
        <CardContent className="p-[clamp(0.75rem,0.8vw,1.35rem)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`shrink-0 rounded-lg p-1.5 ${TINT[tint]}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="truncate text-sm font-semibold">{title}</span>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0">
                <div className={`truncate font-semibold tabular-nums ${MODULE_FIGURE} ${s.tone || ""}`}>
                  {s.value}
                </div>
                <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function DashboardPage() {
  const money = useMoney();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  if (!data) {
    return (
      <div className="mx-auto max-w-[1800px] space-y-6 p-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  const k = data.kpis;
  const show = (m: string) => can(user, m, "view");

  // Only the KPIs this role can actually see. The API already blanks the rest,
  // and a zero that means "hidden" is indistinguishable from one that means
  // "none" — so they are removed rather than shown empty.
  const kpis = [
    show("users") && <Kpi key="u" icon={Users} label="Users" value={k.total_users} sub={`${k.active_users} active`} href="/users" tint="indigo" />,
    show("assets") && <Kpi key="a" icon={Box} label="Assets" value={k.total_assets} sub={`${k.assets_assigned} assigned · ${money(k.asset_value)}`} href="/assets" tint="sky" />,
    show("finance") && <Kpi key="b" icon={Wallet} label="Budget Used" value={`${(k.budget_used_pct ?? 0).toFixed(0)}%`} sub={`${money(k.total_spent)} / ${money(k.total_budget)}`} href="/finance/budget" tint="emerald" tone={k.budget_used_pct > 90 ? "text-red-600 dark:text-red-400" : ""} />,
    show("helpdesk") && <Kpi key="t" icon={Headset} label="Open Tickets" value={k.open_tickets} sub={`${k.overdue_tickets} overdue`} href="/helpdesk/tickets" tint="rose" tone={k.overdue_tickets > 0 ? "text-amber-600 dark:text-amber-400" : ""} />,
    show("network") && <Kpi key="n" icon={Network} label="Devices Online" value={`${k.devices_online}/${k.devices_total}`} href="/network" tint="cyan" tone="text-emerald-600 dark:text-emerald-400" />,
    show("finance") && <Kpi key="r" icon={Receipt} label="Bills (7d)" value={k.upcoming_bills_count} sub={money(k.upcoming_bills_amount)} href="/finance/recurring-bills" tint="amber" />,
  ].filter(Boolean);

  const modules = [
    show("helpdesk") && <ModuleCard key="h" icon={Headset} title="Helpdesk" href="/helpdesk" tint="sky" stats={[
      { label: "Open", value: data.helpdesk.open },
      { label: "Overdue", value: data.helpdesk.overdue, tone: data.helpdesk.overdue ? "text-red-600 dark:text-red-400" : "" },
      { label: "Unassigned", value: data.helpdesk.unassigned },
    ]} />,
    show("estate") && <ModuleCard key="e" icon={Globe} title="Digital Estate" href="/estate/dashboard" tint="amber" stats={[
      { label: "Services", value: data.estate?.active ?? 0 },
      { label: "Renewing", value: data.estate?.expiring_soon ?? 0, tone: data.estate?.expiring_soon ? "text-amber-600 dark:text-amber-400" : "" },
      { label: "No MFA", value: data.estate?.accounts_missing_mfa ?? 0, tone: data.estate?.accounts_missing_mfa ? "text-red-600 dark:text-red-400" : "" },
    ]} />,
    show("procurement") && <ModuleCard key="p" icon={ShoppingCart} title="Procurement" href="/procurement/requests" tint="indigo" stats={[
      { label: "Pending", value: data.procurement.pending, tone: data.procurement.pending ? "text-amber-600 dark:text-amber-400" : "" },
      { label: "Approved", value: data.procurement.approved },
      { label: "Value", value: money(data.procurement.est_total) },
    ]} />,
    show("vendors") && <ModuleCard key="v" icon={Building} title="Vendors" href="/vendors" tint="teal" stats={[
      { label: "Total", value: data.vendors.total },
      { label: "Active", value: data.vendors.active },
      { label: "Expiring", value: data.vendors.contracts_expiring, tone: data.vendors.contracts_expiring ? "text-amber-600 dark:text-amber-400" : "" },
    ]} />,
    show("network") && <ModuleCard key="n" icon={Network} title="Network" href="/network" tint="cyan" stats={[
      { label: "Online", value: data.network.online, tone: "text-emerald-600 dark:text-emerald-400" },
      { label: "Offline", value: data.network.offline, tone: data.network.offline ? "text-red-600 dark:text-red-400" : "" },
      { label: "Warranty", value: data.network.warranty_expiring },
    ]} />,
    show("onboarding") && <ModuleCard key="o" icon={UserPlus} title="Onboarding" href="/onboarding" tint="green" stats={[
      { label: "Active", value: data.onboarding.in_progress },
      { label: "Pending", value: data.onboarding.not_started },
      { label: "Overdue", value: data.onboarding.overdue, tone: data.onboarding.overdue ? "text-red-600 dark:text-red-400" : "" },
    ]} />,
    show("seating") && <ModuleCard key="s" icon={Map} title="Seating" href="/seating" tint="rose" stats={[
      { label: "Seats", value: data.seating.total },
      { label: "Occupied", value: data.seating.occupied },
      { label: "Rate", value: `${data.seating.pct}%` },
    ]} />,
    show("kb") && <ModuleCard key="k" icon={BookOpen} title="Knowledge Base" href="/kb" tint="orange" stats={[
      { label: "Published", value: data.kb.published },
      { label: "Total", value: data.kb.total },
      { label: "Views", value: data.kb.views },
    ]} />,
  ].filter(Boolean);

  const hasAlerts = data.warranties_expiring?.length || data.contracts_expiring?.length;

  return (
    // max-w widened from 7xl: on a large display the old cap left the board in
    // a narrow column with empty space either side.
    <div className="mx-auto max-w-[1800px] space-y-6 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.25rem,0.6vw+1.05rem,2rem)] font-semibold tracking-tight">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">A complete overview of your IT Command Center</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">{kpis}</div>
      )}

      {/* Charts */}
      {(show("finance") || show("helpdesk")) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {show("finance") && (
            <Card className="border-border/60 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className={`rounded-lg p-1.5 ${TINT.emerald}`}><DollarSign className="h-4 w-4" /></span>
                  Income vs Expense · 6 months
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[clamp(16rem,22vh+9rem,26rem)] min-h-[16rem]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.income_vs_expense} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
                    <RechartsTooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="income" name="Income" stroke="#10b981" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="expense" name="Expense" stroke="#ef4444" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {show("helpdesk") && (
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className={`rounded-lg p-1.5 ${TINT.sky}`}><Headset className="h-4 w-4" /></span>
                  Tickets by Status
                </CardTitle>
              </CardHeader>
              <CardContent className="flex h-[clamp(16rem,22vh+9rem,26rem)] min-h-[16rem] items-center justify-center">
                {data.tickets_by_status?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.tickets_by_status} cx="50%" cy="50%" innerRadius="52%" outerRadius="80%" paddingAngle={3} dataKey="value"
                        label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                        {data.tickets_by_status.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground">No tickets.</p>}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {modules.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{modules}</div>
      )}

      {/* Alerts + expenses + activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className={`rounded-lg p-1.5 ${TINT.amber}`}><ShieldAlert className="h-4 w-4" /></span>
              Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72 pr-3">
              {hasAlerts ? (
                <div className="space-y-2">
                  {data.warranties_expiring.map((w: any, i: number) => (
                    <div key={`w${i}`} className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{w.name}</div>
                        <div className="text-xs text-muted-foreground">Warranty · {w.tag}</div>
                      </div>
                      <Badge variant={w.days <= 14 ? "destructive" : "secondary"}>{w.days}d</Badge>
                    </div>
                  ))}
                  {data.contracts_expiring.map((c: any, i: number) => (
                    <div key={`c${i}`} className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.title}</div>
                        <div className="text-xs text-muted-foreground">Contract · {c.vendor}</div>
                      </div>
                      <Badge variant={c.days <= 30 ? "destructive" : "secondary"}>{c.days}d</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Nothing expiring soon.</p>}
            </ScrollArea>
          </CardContent>
        </Card>

        {show("finance") && (
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className={`rounded-lg p-1.5 ${TINT.indigo}`}><TrendingUp className="h-4 w-4" /></span>
                Monthly Expenses
              </CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly_expenses} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
                  <RechartsTooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className={`rounded-lg p-1.5 ${TINT.emerald}`}><Activity className="h-4 w-4" /></span>
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72 pr-3">
              {data.recent_activity?.length > 0 ? (
                <div className="space-y-3">
                  {data.recent_activity.map((act: any, i: number) => (
                    <div key={i} className="flex flex-col space-y-1 border-b pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{act.title}</span>
                        {act.amount !== null && (
                          <span className={`text-xs font-bold ${ACT_COLOR[act.type] || ""}`}>{money(act.amount)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />
                        <span>{act.date}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{act.type}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No recent activity.</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
