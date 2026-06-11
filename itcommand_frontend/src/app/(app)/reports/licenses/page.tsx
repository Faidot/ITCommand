"use client";

import { KeyRound, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, useReport, money,
} from "@/components/reports/report-ui";

export default function LicenseReportPage() {
  const data = useReport<any>("/reports/license-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<KeyRound className="text-amber-500" />}
      title="License Reports"
      subtitle="Software licenses, spend and seat utilization"
      exportPath="/reports/export/licenses/"
      exportName="licenses_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Total Licenses" value={t.total} />
        <Kpi label="Active" value={t.active} tone="green" />
        <Kpi label="Expired" value={t.expired} tone="red" />
        <Kpi label="Expiring (60d)" value={t.expiring_soon} tone="amber" />
        <Kpi label="Annual Cost" value={money(t.total_annual_cost)} tone="violet" />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="By License Type"><Donut data={data.by_type} height={260} /></ChartCard>
        <ChartCard title="By Category"><Bars data={data.by_category} horizontal color="#10b981" height={260} /></ChartCard>
        <ChartCard title="Cost by Category"><Bars data={data.cost_by_category} horizontal isMoney color="#8b5cf6" height={260} /></ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Expiring Soon (Next 60 Days)" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
          {data.expiring.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Type</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Days</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.expiring.map((l: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{l.product}</TableCell>
                    <TableCell>{l.type}</TableCell>
                    <TableCell>{l.expiry_date}</TableCell>
                    <TableCell className="text-right"><Badge variant={l.days_remaining <= 14 ? "destructive" : "secondary"}>{l.days_remaining}d</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-neutral-500">No licenses expiring in the next 60 days.</p>}
        </ChartCard>

        <ChartCard title="Seat Utilization">
          {data.seat_utilization.length > 0 ? (
            <div className="space-y-3">
              {data.seat_utilization.map((s: any, i: number) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{s.product}</span>
                    <span className="text-neutral-500">{s.seats_used}/{s.seats_total} ({s.usage_pct}%)</span>
                  </div>
                  <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <div className={`h-full ${s.usage_pct > 90 ? "bg-red-500" : s.usage_pct > 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(s.usage_pct, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-neutral-500">No seat-based licenses.</p>}
        </ChartCard>
      </div>
    </ReportShell>
  );
}
