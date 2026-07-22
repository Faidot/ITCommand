"use client";

import { Building, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, Trend, useReport,
} from "@/components/reports/report-ui";
import { useMoney } from "@/lib/currency";

export default function VendorReportPage() {
  const money = useMoney();
  const data = useReport<any>("/reports/vendor-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<Building className="text-teal-500" />}
      title="Vendor Reports"
      subtitle="Vendors, contracts and payment history"
      exportPath="/reports/export/vendors/"
      exportName="vendors_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Vendors" value={t.total_vendors} />
        <Kpi label="Active Contracts" value={t.active_contracts} tone="green" />
        <Kpi label="Contract Value" value={money(t.contract_value)} tone="violet" />
        <Kpi label="Total Paid" value={money(t.total_payments)} tone="blue" />
        <Kpi label="Expiring (90d)" value={t.expiring_contracts} tone="amber" />
      </KpiGrid>

      <ChartCard title="Payments (Last 12 Months)">
        <Trend data={data.monthly_payments} series={[{ key: "value", color: "#14b8a6", label: "Paid" }]} isMoney />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="Vendors by Category"><Donut data={data.by_category} height={260} /></ChartCard>
        <ChartCard title="Contracts by Status"><Donut data={data.contracts_by_status} height={260} /></ChartCard>
        <ChartCard title="Contracts by Type"><Bars data={data.contracts_by_type} horizontal color="#6366f1" height={260} /></ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Top Vendors by Spend">
          {data.top_vendors.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead className="text-right">Payments</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.top_vendors.map((v: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell className="text-right">{v.count}</TableCell>
                    <TableCell className="text-right">{money(v.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-neutral-500">No payments recorded.</p>}
        </ChartCard>

        <ChartCard title="Expiring Contracts (Next 90 Days)" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
          {data.expiring.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Contract</TableHead><TableHead>End</TableHead><TableHead className="text-right">Days</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.expiring.map((c: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{c.vendor}</TableCell>
                    <TableCell>{c.contract}</TableCell>
                    <TableCell>{c.end_date}</TableCell>
                    <TableCell className="text-right"><Badge variant={c.days_remaining <= 30 ? "destructive" : "secondary"}>{c.days_remaining}d</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-neutral-500">No contracts expiring soon.</p>}
        </ChartCard>
      </div>
    </ReportShell>
  );
}
