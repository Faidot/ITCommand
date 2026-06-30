"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ClipboardList, ChevronRight, ChevronDown, Search,
  MonitorSmartphone, KeyRound, Repeat, Map, Headset, ShieldCheck, UserPlus,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, useReport,
} from "@/components/reports/report-ui";

/** A compact count, dimmed when zero. */
function CountChip({ value, tone = "default" }: { value: number; tone?: string }) {
  const zero = !value;
  const tones: Record<string, string> = {
    default: "text-neutral-700",
    blue: "text-blue-600",
    amber: "text-amber-600",
    violet: "text-violet-600",
    rose: "text-rose-600",
    sky: "text-sky-600",
    emerald: "text-emerald-600",
  };
  return (
    <span className={`font-medium tabular-nums ${zero ? "text-neutral-300" : tones[tone] || tones.default}`}>
      {value}
    </span>
  );
}

const ROLE_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  SUPERADMIN: "destructive",
  ADMIN: "default",
  MANAGER: "secondary",
  VIEWER: "outline",
};

function DetailSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-neutral-600">{icon} {title}</div>
      {children}
    </div>
  );
}

function UserDetail({ u }: { u: any }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4 bg-muted/40 rounded-lg">
      {/* Assets */}
      <DetailSection title={`Assets (${u.assets.length})`} icon={<MonitorSmartphone className="w-4 h-4 text-blue-500" />}>
        {u.assets.length ? (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Tag</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Held As</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {u.assets.map((a: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{a.tag}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{a.category}</TableCell>
                  <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{a.kind}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-sm text-neutral-400">No assets assigned.</p>}
      </DetailSection>

      {/* Licenses & subscriptions */}
      <DetailSection title={`Licenses & Subscriptions (${u.licenses.length})`} icon={<KeyRound className="w-4 h-4 text-amber-500" />}>
        {u.licenses.length ? (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead><TableHead>Type</TableHead><TableHead>Expiry</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {u.licenses.map((l: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{l.product}</TableCell>
                  <TableCell>
                    {l.is_subscription
                      ? <Badge className="gap-1"><Repeat className="w-3 h-3" /> Subscription</Badge>
                      : <Badge variant="secondary">{l.type}</Badge>}
                  </TableCell>
                  <TableCell className={l.expired ? "text-red-600" : ""}>
                    {l.expiry || "—"}{l.expired ? " (expired)" : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-sm text-neutral-400">No licenses or subscriptions.</p>}
      </DetailSection>

      {/* Seat + tickets + vault + org */}
      <DetailSection title="Seat" icon={<Map className="w-4 h-4 text-rose-500" />}>
        {u.seat
          ? <p className="text-sm">{u.seat.code} · {u.seat.floor} · {u.seat.office}</p>
          : <p className="text-sm text-neutral-400">No seat assigned.</p>}
      </DetailSection>

      <DetailSection title="Helpdesk Tickets" icon={<Headset className="w-4 h-4 text-sky-500" />}>
        <p className="text-sm text-neutral-600">
          Submitted: <b>{u.tickets.submitted_total}</b> ({u.tickets.submitted_open} open) ·
          {" "}Assigned: <b>{u.tickets.assigned_total}</b> ({u.tickets.assigned_open} open)
        </p>
      </DetailSection>

      <DetailSection title="Onboarding" icon={<UserPlus className="w-4 h-4 text-green-500" />}>
        {u.onboarding.length ? (
          <div className="flex flex-wrap gap-2">
            {u.onboarding.map((o: any, i: number) => (
              <Badge key={i} variant="outline">{o.process}: {o.status}</Badge>
            ))}
          </div>
        ) : <p className="text-sm text-neutral-400">No onboarding records.</p>}
      </DetailSection>

      <DetailSection title="Vault & Reporting line" icon={<ShieldCheck className="w-4 h-4 text-violet-500" />}>
        <p className="text-sm text-neutral-600">
          Vault — shared with: <b>{u.vault.shared_with_me}</b> · created: <b>{u.vault.created}</b>
        </p>
        {(u.manager || u.team_lead) && (
          <p className="text-sm text-neutral-600">
            {u.manager && <>Manager: <b>{u.manager}</b> </>}
            {u.team_lead && <>· Team lead: <b>{u.team_lead}</b></>}
          </p>
        )}
      </DetailSection>
    </div>
  );
}

export default function MasterReportPage() {
  const data = useReport<any>("/reports/master-user/");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("ALL");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const users = data?.users ?? [];
  const roles = useMemo(
    () => Array.from(new Set<string>(users.map((u: any) => String(u.role)))).sort(),
    [users]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u: any) => {
      if (role !== "ALL" && u.role !== role) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.department || "").toLowerCase().includes(q) ||
        (u.designation || "").toLowerCase().includes(q)
      );
    });
  }, [users, query, role]);

  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<ClipboardList className="text-primary" />}
      title="Master Report"
      subtitle="User-wise view of every asset, subscription and record linked to each person"
      exportPath="/reports/export/master-user/"
      exportName="master_user_report.xlsx"
    >
      <KpiGrid cols={6}>
        <Kpi label="Total Users" value={t.total_users} />
        <Kpi label="With Assets" value={t.users_with_assets} tone="blue" />
        <Kpi label="Assigned Assets" value={t.assigned_assets} tone="blue" />
        <Kpi label="Active Licenses" value={t.active_licenses} tone="amber" />
        <Kpi label="Subscriptions" value={t.active_subscriptions} tone="violet" />
        <Kpi label="Seats Assigned" value={t.seats_assigned} tone="green" />
      </KpiGrid>

      <ChartCard title={`Users (${filtered.length})`}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              placeholder="Search by name, email, department…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All roles</SelectItem>
              {roles.map((r: string) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-center" title="Assets"><MonitorSmartphone className="w-4 h-4 mx-auto text-blue-500" /></TableHead>
              <TableHead className="text-center" title="Subscriptions"><Repeat className="w-4 h-4 mx-auto text-violet-500" /></TableHead>
              <TableHead className="text-center" title="Licenses"><KeyRound className="w-4 h-4 mx-auto text-amber-500" /></TableHead>
              <TableHead className="text-center" title="Seat"><Map className="w-4 h-4 mx-auto text-rose-500" /></TableHead>
              <TableHead className="text-center" title="Open tickets"><Headset className="w-4 h-4 mx-auto text-sky-500" /></TableHead>
              <TableHead className="text-center" title="Vault items"><ShieldCheck className="w-4 h-4 mx-auto text-violet-500" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-neutral-400 py-8">No users match your filters.</TableCell></TableRow>
            )}
            {filtered.map((u: any) => {
              const open = expanded.has(u.id);
              return (
                <Fragment key={u.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => toggle(u.id)}
                  >
                    <TableCell>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}</TableCell>
                    <TableCell>
                      <div className="font-medium flex items-center gap-2">
                        {u.name}
                        {!u.is_active && <Badge variant="outline" className="text-neutral-400">Inactive</Badge>}
                      </div>
                      <div className="text-xs text-neutral-500">{u.email}</div>
                    </TableCell>
                    <TableCell><Badge variant={ROLE_TONE[u.role] || "secondary"}>{u.role}</Badge></TableCell>
                    <TableCell>{u.department}</TableCell>
                    <TableCell className="text-center"><CountChip value={u.counts.assets} tone="blue" /></TableCell>
                    <TableCell className="text-center"><CountChip value={u.counts.subscriptions} tone="violet" /></TableCell>
                    <TableCell className="text-center"><CountChip value={u.counts.licenses} tone="amber" /></TableCell>
                    <TableCell className="text-center"><CountChip value={u.counts.seat} tone="rose" /></TableCell>
                    <TableCell className="text-center"><CountChip value={u.counts.tickets_open} tone="sky" /></TableCell>
                    <TableCell className="text-center"><CountChip value={u.counts.vault} tone="violet" /></TableCell>
                  </TableRow>
                  {open && (
                    <TableRow>
                      <TableCell colSpan={10} className="p-2">
                        <UserDetail u={u} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </ChartCard>
    </ReportShell>
  );
}
