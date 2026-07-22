"use client";

import { ShoppingCart } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, Trend, useReport,
} from "@/components/reports/report-ui";
import { useMoney } from "@/lib/currency";

export default function ProcurementReportPage() {
  const money = useMoney();
  const data = useReport<any>("/reports/procurement-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<ShoppingCart className="text-indigo-500" />}
      title="Procurement Reports"
      subtitle="Purchase requests, approvals and spend"
      exportPath="/reports/export/procurement/"
      exportName="procurement_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Total PRs" value={t.total} />
        <Kpi label="Pending Approval" value={t.pending} tone="amber" />
        <Kpi label="Approved" value={t.approved} tone="green" />
        <Kpi label="Est. Spend" value={money(t.estimated_total)} tone="violet" />
        <Kpi label="Avg Approval" value={`${t.avg_approval_days}d`} tone="blue" />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="PR Volume & Spend (6 Months)">
          <Trend data={data.monthly} series={[{ key: "count", color: "#6366f1", label: "Requests" }]} />
        </ChartCard>
        <ChartCard title="By Status"><Donut data={data.by_status} /></ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="By Priority"><Bars data={data.by_priority} color="#f59e0b" height={260} /></ChartCard>
        <ChartCard title="Spend by Department"><Bars data={data.by_department} dataKey="value" horizontal isMoney color="#10b981" height={260} /></ChartCard>
      </div>

      <ChartCard title="Pending Approvals">
        {data.pending_list.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>PR #</TableHead><TableHead>Title</TableHead><TableHead>Requester</TableHead><TableHead>Priority</TableHead><TableHead className="text-right">Estimated</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.pending_list.map((p: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{p.pr_number}</TableCell>
                  <TableCell className="font-medium">{p.title}</TableCell>
                  <TableCell>{p.requested_by}</TableCell>
                  <TableCell><Badge variant={p.priority === "CRITICAL" || p.priority === "URGENT" ? "destructive" : "secondary"}>{p.priority}</Badge></TableCell>
                  <TableCell className="text-right">{money(p.estimated)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-neutral-500">No pending approvals.</p>}
      </ChartCard>
    </ReportShell>
  );
}
