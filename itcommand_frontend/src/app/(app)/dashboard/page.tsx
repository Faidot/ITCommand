"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users, Box, Wallet, Receipt, TrendingUp, CalendarDays, Activity,
  Headset, KeyRound, Globe, ShoppingCart, Building, Network, UserPlus, Map,
  BookOpen, ShieldAlert, ArrowRight, DollarSign,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMoney } from "@/lib/currency";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

const ACT_COLOR: Record<string, string> = {
  EXPENSE: "text-red-500", ASSET: "text-blue-500", TICKET: "text-sky-500", PROCUREMENT: "text-indigo-500",
};

function Kpi({ icon: Icon, label, value, sub, href, tone }: any) {
  const inner = (
    <Card className={href ? "hover:shadow-md hover:border-primary/40 transition-all cursor-pointer h-full" : "h-full"}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-neutral-500">{label}</CardTitle>
        <Icon className="h-4 w-4 text-neutral-400" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${tone || ""}`}>{value}</div>
        {sub && <p className="text-xs text-neutral-500 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ModuleCard({ icon: Icon, title, href, color, stats }: any) {
  return (
    <Link href={href}>
      <Card className="group hover:shadow-md hover:border-primary/40 transition-all cursor-pointer h-full">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`rounded-md bg-muted p-1.5 ${color}`}><Icon className="w-4 h-4" /></div>
              <span className="font-semibold text-sm">{title}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-primary transition-colors" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s: any, i: number) => (
              <div key={i}>
                <div className={`text-lg font-bold ${s.tone || ""}`}>{s.value}</div>
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const money = useMoney();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get("/dashboard/").then(r => setData(r.data)).catch(() => toast.error("Failed to load dashboard data"));
  }, []);

  if (!data) return null;
  const k = data.kpis;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-neutral-500">A complete overview of your IT Command Center</p>
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Kpi icon={Users} label="Users" value={k.total_users} sub={`${k.active_users} active`} href="/users" />
        <Kpi icon={Box} label="Assets" value={k.total_assets} sub={`${k.assets_assigned} assigned · ${money(k.asset_value)}`} href="/assets" />
        <Kpi icon={Wallet} label="Budget Used" value={`${k.budget_used_pct.toFixed(0)}%`} sub={`${money(k.total_spent)} / ${money(k.total_budget)}`} href="/finance/budget" tone={k.budget_used_pct > 90 ? "text-red-600" : ""} />
        <Kpi icon={Headset} label="Open Tickets" value={k.open_tickets} sub={`${k.overdue_tickets} overdue`} href="/helpdesk/tickets" tone={k.overdue_tickets > 0 ? "text-amber-600" : ""} />
        <Kpi icon={Network} label="Devices Online" value={`${k.devices_online}/${k.devices_total}`} href="/network" tone="text-emerald-600" />
        <Kpi icon={Receipt} label="Bills (7d)" value={k.upcoming_bills_count} sub={money(k.upcoming_bills_amount)} href="/finance/recurring-bills" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /> Income vs Expense (6 Months)</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.income_vs_expense}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" />
                <YAxis />
                <RechartsTooltip formatter={(v: any) => money(v)} />
                <Legend />
                <Line type="monotone" dataKey="income" name="Income" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" name="Expense" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Tickets by Status</CardTitle></CardHeader>
          <CardContent className="h-72 flex items-center justify-center">
            {data.tickets_by_status?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.tickets_by_status} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value"
                    label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {data.tickets_by_status.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-neutral-500 text-sm">No tickets.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Module status grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ModuleCard icon={Headset} title="Helpdesk" href="/helpdesk" color="text-sky-500" stats={[
          { label: "Open", value: data.helpdesk.open },
          { label: "Overdue", value: data.helpdesk.overdue, tone: data.helpdesk.overdue ? "text-red-600" : "" },
          { label: "Unassigned", value: data.helpdesk.unassigned },
        ]} />
        <ModuleCard icon={Globe} title="Digital Estate" href="/estate/dashboard" color="text-amber-500" stats={[
          { label: "Services", value: data.estate?.active ?? 0 },
          { label: "Renewing", value: data.estate?.expiring_soon ?? 0, tone: data.estate?.expiring_soon ? "text-amber-600" : "" },
          { label: "No MFA", value: data.estate?.accounts_missing_mfa ?? 0, tone: data.estate?.accounts_missing_mfa ? "text-red-600" : "" },
        ]} />
        <ModuleCard icon={ShoppingCart} title="Procurement" href="/procurement/requests" color="text-indigo-500" stats={[
          { label: "Pending", value: data.procurement.pending, tone: data.procurement.pending ? "text-amber-600" : "" },
          { label: "Approved", value: data.procurement.approved },
          { label: "Value", value: money(data.procurement.est_total) },
        ]} />
        <ModuleCard icon={Building} title="Vendors" href="/vendors" color="text-teal-500" stats={[
          { label: "Total", value: data.vendors.total },
          { label: "Active", value: data.vendors.active },
          { label: "Expiring", value: data.vendors.contracts_expiring, tone: data.vendors.contracts_expiring ? "text-amber-600" : "" },
        ]} />
        <ModuleCard icon={Network} title="Network" href="/network" color="text-cyan-500" stats={[
          { label: "Online", value: data.network.online, tone: "text-emerald-600" },
          { label: "Offline", value: data.network.offline, tone: data.network.offline ? "text-red-600" : "" },
          { label: "Warranty", value: data.network.warranty_expiring },
        ]} />
        <ModuleCard icon={UserPlus} title="Onboarding" href="/onboarding" color="text-green-500" stats={[
          { label: "Active", value: data.onboarding.in_progress },
          { label: "Pending", value: data.onboarding.not_started },
          { label: "Overdue", value: data.onboarding.overdue, tone: data.onboarding.overdue ? "text-red-600" : "" },
        ]} />
        <ModuleCard icon={Map} title="Seating" href="/seating" color="text-rose-500" stats={[
          { label: "Seats", value: data.seating.total },
          { label: "Occupied", value: data.seating.occupied },
          { label: "Rate", value: `${data.seating.pct}%` },
        ]} />
        <ModuleCard icon={BookOpen} title="Knowledge Base" href="/kb" color="text-orange-500" stats={[
          { label: "Published", value: data.kb.published },
          { label: "Total", value: data.kb.total },
          { label: "Views", value: data.kb.views },
        ]} />
      </div>

      {/* Alerts + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-5 w-5 text-amber-500" /> Expiring Soon</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-72 pr-3">
              {(data.warranties_expiring?.length || data.contracts_expiring?.length) ? (
                <div className="space-y-2">
                  {data.warranties_expiring.map((w: any, i: number) => (
                    <div key={`w${i}`} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                      <div className="min-w-0"><div className="font-medium truncate">{w.name}</div><div className="text-xs text-neutral-500">Warranty · {w.tag}</div></div>
                      <Badge variant={w.days <= 14 ? "destructive" : "secondary"}>{w.days}d</Badge>
                    </div>
                  ))}
                  {data.contracts_expiring.map((c: any, i: number) => (
                    <div key={`c${i}`} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                      <div className="min-w-0"><div className="font-medium truncate">{c.title}</div><div className="text-xs text-neutral-500">Contract · {c.vendor}</div></div>
                      <Badge variant={c.days <= 30 ? "destructive" : "secondary"}>{c.days}d</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-neutral-500 text-sm">Nothing expiring soon.</p>}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-5 w-5 text-blue-500" /> Monthly Expenses</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly_expenses}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" />
                <YAxis />
                <RechartsTooltip formatter={(v: any) => money(v)} />
                <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-5 w-5 text-emerald-500" /> Recent Activity</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-72 pr-3">
              {data.recent_activity.length > 0 ? (
                <div className="space-y-3">
                  {data.recent_activity.map((act: any, i: number) => (
                    <div key={i} className="flex flex-col space-y-1 pb-3 border-b last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{act.title}</span>
                        {act.amount !== null && <span className={`font-bold text-xs ${ACT_COLOR[act.type] || ""}`}>{money(act.amount)}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <CalendarDays className="h-3 w-3" />
                        <span>{act.date}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{act.type}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-neutral-500 text-sm">No recent activity.</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
