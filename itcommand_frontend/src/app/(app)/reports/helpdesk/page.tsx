"use client";

import { Headset, Clock, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, Trend, useReport,
} from "@/components/reports/report-ui";

export default function HelpdeskReportPage() {
  const data = useReport<any>("/reports/helpdesk-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<Headset className="text-sky-500" />}
      title="Helpdesk Reports"
      subtitle="Ticket volume, SLA compliance and agent performance"
      exportPath="/reports/export/helpdesk/"
      exportName="helpdesk_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Total Tickets" value={t.total} />
        <Kpi label="Open" value={t.open} tone="blue" />
        <Kpi label="Resolved" value={t.resolved} tone="green" />
        <Kpi label="Overdue" value={t.overdue} tone="red" />
        <Kpi label="Avg Resolution" value={`${t.avg_resolution_hours}h`} tone="amber" />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Created vs Resolved (6 Months)" icon={<Clock className="w-4 h-4 text-neutral-400" />}>
          <Trend data={data.monthly} series={[
            { key: "created", color: "#6366f1", label: "Created" },
            { key: "resolved", color: "#10b981", label: "Resolved" },
          ]} />
        </ChartCard>
        <ChartCard title="SLA Status (Open Tickets)" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
          <Donut data={data.sla} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="By Status"><Donut data={data.by_status} height={260} /></ChartCard>
        <ChartCard title="By Priority"><Bars data={data.by_priority} color="#f59e0b" height={260} /></ChartCard>
        <ChartCard title="By Category"><Bars data={data.by_category} horizontal color="#8b5cf6" height={260} /></ChartCard>
      </div>

      <ChartCard title="Top Agents">
        {data.top_agents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Agent</TableHead><TableHead className="text-right">Assigned</TableHead><TableHead className="text-right">Resolved</TableHead><TableHead className="text-right">Resolution Rate</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.top_agents.map((a: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{a.agent}</TableCell>
                  <TableCell className="text-right">{a.total}</TableCell>
                  <TableCell className="text-right">{a.resolved}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{a.total ? Math.round((a.resolved / a.total) * 100) : 0}%</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-neutral-500">No assigned tickets yet.</p>}
      </ChartCard>
    </ReportShell>
  );
}
