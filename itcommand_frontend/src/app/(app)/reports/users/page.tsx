"use client";

import { Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, useReport,
} from "@/components/reports/report-ui";

export default function UsersReportPage() {
  const data = useReport<any>("/reports/user-summary/");
  if (!data) return null;
  const t = data.totals;

  return (
    <ReportShell
      icon={<Users className="text-blue-500" />}
      title="People Reports"
      subtitle="Headcount, roles and department breakdown"
      exportPath="/reports/export/users/"
      exportName="users_export.xlsx"
    >
      <KpiGrid cols={4}>
        <Kpi label="Total Users" value={t.total} />
        <Kpi label="Active" value={t.active} tone="green" />
        <Kpi label="Inactive" value={t.inactive} tone="red" />
        <Kpi label="Departments" value={t.departments} tone="blue" />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="By Role"><Donut data={data.by_role} /></ChartCard>
        <ChartCard title="By Department"><Bars data={data.by_department} horizontal color="#3b82f6" /></ChartCard>
      </div>

      <ChartCard title="Recently Joined (Last 30 Days)">
        {data.recently_joined.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Joined</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.recently_joined.map((u: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                  <TableCell>{u.department}</TableCell>
                  <TableCell>{u.joined}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-neutral-500">No new users in the last 30 days.</p>}
      </ChartCard>
    </ReportShell>
  );
}
