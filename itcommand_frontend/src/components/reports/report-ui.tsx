"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#3b82f6",
];

/** Fetch a report endpoint once on mount. Returns null until loaded. */
export function useReport<T = any>(endpoint: string) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    api.get(endpoint)
      .then((res) => { if (alive) setData(res.data); })
      .catch(() => toast.error("Failed to load report"));
    return () => { alive = false; };
  }, [endpoint]);
  return data;
}

/** Download an Excel export from the given path. */
export async function downloadExport(path: string, filename: string) {
  try {
    const res = await api.get(path, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch {
    toast.error("Export failed");
  }
}

export function ReportShell({
  icon, title, subtitle, exportPath, exportName, children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  exportPath?: string;
  exportName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">{icon} {title}</h1>
          {subtitle && <p className="text-neutral-500">{subtitle}</p>}
        </div>
        {exportPath && (
          <Button onClick={() => downloadExport(exportPath, exportName || "export.xlsx")}>
            <Download className="w-4 h-4 mr-2" /> Export to Excel
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  const map: Record<number, string> = {
    3: "md:grid-cols-3", 4: "md:grid-cols-4", 5: "md:grid-cols-5", 6: "md:grid-cols-6",
  };
  return <div className={`grid grid-cols-2 ${map[cols] || "md:grid-cols-4"} gap-4`}>{children}</div>;
}

const TONES: Record<string, string> = {
  default: "",
  green: "text-emerald-600",
  red: "text-red-600",
  amber: "text-amber-600",
  blue: "text-blue-600",
  violet: "text-violet-600",
};

export function Kpi({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: keyof typeof TONES }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 font-medium">{label}</CardTitle></CardHeader>
      <CardContent><div className={`text-2xl font-bold ${TONES[tone] || ""}`}>{value}</div></CardContent>
    </Card>
  );
}

export function ChartCard({ title, icon, children, className }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base">{icon} {title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const money = (v: any) => `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** Donut chart for {name,value} arrays. */
export function Donut({ data, isMoney = false, height = 300 }: { data: any[]; isMoney?: boolean; height?: number }) {
  if (!data || data.length === 0 || data.every((d) => !d.value))
    return <div className="flex items-center justify-center text-neutral-400" style={{ height }}>No data</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value"
          label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <RechartsTooltip formatter={(v: any) => (isMoney ? money(v) : v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Vertical or horizontal single-series bar chart. */
export function Bars({ data, dataKey = "value", xKey = "name", color = "#6366f1", isMoney = false, horizontal = false, height = 300 }:
  { data: any[]; dataKey?: string; xKey?: string; color?: string; isMoney?: boolean; horizontal?: boolean; height?: number }) {
  if (!data || data.length === 0)
    return <div className="flex items-center justify-center text-neutral-400" style={{ height }}>No data</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {horizontal ? (
        <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" />
          <YAxis dataKey={xKey} type="category" width={110} tick={{ fontSize: 12 }} />
          <RechartsTooltip formatter={(v: any) => (isMoney ? money(v) : v)} />
          <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      ) : (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
          <YAxis />
          <RechartsTooltip formatter={(v: any) => (isMoney ? money(v) : v)} />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

/** Multi-series line/area trend chart. `series` = [{key,color,label}]. */
export function Trend({ data, xKey = "month", series, isMoney = false, height = 300 }:
  { data: any[]; xKey?: string; series: { key: string; color: string; label: string }[]; isMoney?: boolean; height?: number }) {
  if (!data || data.length === 0)
    return <div className="flex items-center justify-center text-neutral-400" style={{ height }}>No data</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
        <YAxis />
        <RechartsTooltip formatter={(v: any) => (isMoney ? money(v) : v)} />
        <Legend />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export { money };
