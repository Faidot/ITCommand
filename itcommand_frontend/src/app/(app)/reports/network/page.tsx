"use client";

import { Network, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, useReport,
} from "@/components/reports/report-ui";

export default function NetworkReportPage() {
  const data = useReport<any>("/reports/network-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<Network className="text-cyan-500" />}
      title="Network Reports"
      subtitle="Device inventory, status and IP utilization"
      exportPath="/reports/export/network/"
      exportName="network_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Total Devices" value={t.total} />
        <Kpi label="Online" value={t.online} tone="green" />
        <Kpi label="Offline" value={t.offline} tone="red" />
        <Kpi label="IP Used / Cap" value={`${t.ip_used}/${t.ip_capacity}`} tone="blue" />
        <Kpi label="Warranty (60d)" value={t.warranty_expiring} tone="amber" />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="By Status"><Donut data={data.by_status} height={260} /></ChartCard>
        <ChartCard title="By Device Type"><Bars data={data.by_type} horizontal color="#06b6d4" height={260} /></ChartCard>
        <ChartCard title="By Location"><Bars data={data.by_location} horizontal color="#6366f1" height={260} /></ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="IP Pool Utilization">
          {data.ip_pools.length > 0 ? (
            <div className="space-y-3">
              {data.ip_pools.map((p: any, i: number) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{p.name} <span className="text-xs text-neutral-400">{p.network}</span></span>
                    <span className="text-neutral-500">{p.used}/{p.capacity} ({p.usage_pct}%)</span>
                  </div>
                  <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <div className={`h-full ${p.usage_pct > 90 ? "bg-red-500" : p.usage_pct > 70 ? "bg-amber-500" : "bg-cyan-500"}`} style={{ width: `${Math.min(p.usage_pct, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-neutral-500">No IP pools configured.</p>}
        </ChartCard>

        <ChartCard title="Warranty Expiring (Next 60 Days)" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
          {data.warranty_expiring.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Type</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Days</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.warranty_expiring.map((d: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{d.device}</TableCell>
                    <TableCell>{d.type}</TableCell>
                    <TableCell>{d.expiry_date}</TableCell>
                    <TableCell className="text-right"><Badge variant={d.days_remaining <= 14 ? "destructive" : "secondary"}>{d.days_remaining}d</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-neutral-500">No warranties expiring soon.</p>}
        </ChartCard>
      </div>
    </ReportShell>
  );
}
