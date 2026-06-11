"use client";

import { Map } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, useReport,
} from "@/components/reports/report-ui";

export default function SeatingReportPage() {
  const data = useReport<any>("/reports/seating-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<Map className="text-rose-500" />}
      title="Seating Reports"
      subtitle="Office occupancy and seat utilization"
      exportPath="/reports/export/seating/"
      exportName="seating_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Total Seats" value={t.total_seats} />
        <Kpi label="Occupied" value={t.occupied} tone="green" />
        <Kpi label="Vacant" value={t.vacant} tone="amber" />
        <Kpi label="Occupancy" value={`${t.occupancy_pct}%`} tone="blue" />
        <Kpi label="Offices" value={t.offices} />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Overall Occupancy"><Donut data={data.occupancy_chart} /></ChartCard>
        <ChartCard title="By Seat Type">
          {data.by_type.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Occupied</TableHead><TableHead className="text-right">Occupancy</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.by_type.map((s: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right">{s.total}</TableCell>
                    <TableCell className="text-right">{s.occupied}</TableCell>
                    <TableCell className="text-right">{s.total ? Math.round((s.occupied / s.total) * 100) : 0}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-neutral-500">No seats configured.</p>}
        </ChartCard>
      </div>

      <ChartCard title="Occupancy by Office">
        {data.by_office.length > 0 ? (
          <div className="space-y-4">
            {data.by_office.map((o: any, i: number) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{o.office}</span>
                  <span className="text-neutral-500">{o.occupied}/{o.total} seats ({o.occupancy_pct}%)</span>
                </div>
                <div className="h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                  <div className={`h-full ${o.occupancy_pct > 90 ? "bg-red-500" : o.occupancy_pct > 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(o.occupancy_pct, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-neutral-500">No offices configured.</p>}
      </ChartCard>
    </ReportShell>
  );
}
