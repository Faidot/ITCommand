"use client";

import { UserPlus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, useReport,
} from "@/components/reports/report-ui";

export default function OnboardingReportPage() {
  const data = useReport<any>("/reports/onboarding-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<UserPlus className="text-green-500" />}
      title="Onboarding Reports"
      subtitle="Onboarding & offboarding progress and task completion"
      exportPath="/reports/export/onboarding/"
      exportName="onboarding_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Total Records" value={t.total} />
        <Kpi label="In Progress" value={t.in_progress} tone="blue" />
        <Kpi label="Completed" value={t.completed} tone="green" />
        <Kpi label="Overdue" value={t.overdue} tone="red" />
        <Kpi label="Task Completion" value={`${t.completion_rate}%`} tone="violet" />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="By Status"><Donut data={data.by_status} height={260} /></ChartCard>
        <ChartCard title="By Process Type"><Donut data={data.by_process} height={260} /></ChartCard>
        <ChartCard title="Tasks by Category"><Bars data={data.tasks_by_category} horizontal color="#10b981" height={260} /></ChartCard>
      </div>

      <ChartCard title="Active Records">
        {data.active_records.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Process</TableHead><TableHead>Status</TableHead><TableHead className="w-1/3">Progress</TableHead><TableHead>Target</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.active_records.map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.employee}</TableCell>
                  <TableCell>{r.process}</TableCell>
                  <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${r.progress}%` }} />
                      </div>
                      <span className="text-xs text-neutral-500 w-8">{r.progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell>{r.target_date ? <span className={r.overdue ? "text-red-600 font-medium" : ""}>{r.target_date}</span> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-neutral-500">No active onboarding records.</p>}
      </ChartCard>
    </ReportShell>
  );
}
