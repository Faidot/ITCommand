"use client";

import { BookOpen } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ReportShell, KpiGrid, Kpi, ChartCard, Donut, Bars, useReport,
} from "@/components/reports/report-ui";

export default function KBReportPage() {
  const data = useReport<any>("/reports/kb-summary/");
  if (!data) return null;
  const t = data.totals;
  const helpfulRate = (t.helpful + t.not_helpful) ? Math.round((t.helpful / (t.helpful + t.not_helpful)) * 100) : 0;

  return (
    <ReportShell
      icon={<BookOpen className="text-orange-500" />}
      title="Knowledge Base Reports"
      subtitle="Articles, views and feedback"
      exportPath="/reports/export/kb/"
      exportName="kb_export.xlsx"
    >
      <KpiGrid cols={5}>
        <Kpi label="Total Articles" value={t.total} />
        <Kpi label="Published" value={t.published} tone="green" />
        <Kpi label="Drafts" value={t.draft} tone="amber" />
        <Kpi label="Total Views" value={t.total_views} tone="blue" />
        <Kpi label="Helpful Rate" value={`${helpfulRate}%`} tone="violet" />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="By Status"><Donut data={data.by_status} height={260} /></ChartCard>
        <ChartCard title="By Category"><Bars data={data.by_category} horizontal color="#f97316" height={260} /></ChartCard>
        <ChartCard title="Feedback"><Donut data={data.feedback} height={260} /></ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Most Viewed Articles">
          {data.top_viewed.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Views</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.top_viewed.map((a: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium max-w-[260px] truncate">{a.title}</TableCell>
                    <TableCell>{a.category}</TableCell>
                    <TableCell className="text-right">{a.views}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-neutral-500">No articles yet.</p>}
        </ChartCard>

        <ChartCard title="Recently Updated">
          {data.recently_updated.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Author</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.recently_updated.map((a: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium max-w-[200px] truncate">{a.title}</TableCell>
                    <TableCell>{a.author}</TableCell>
                    <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                    <TableCell>{a.updated}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <p className="text-neutral-500">No articles yet.</p>}
        </ChartCard>
      </div>
    </ReportShell>
  );
}
