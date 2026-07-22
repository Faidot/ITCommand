"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, TrendingUp, BookOpen } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMoney } from "@/lib/currency";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function FinancialReportsPage() {
  const fmt = useMoney();
  const [data, setData] = useState<any>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const fetchData = useCallback(async (s?: string, e?: string) => {
    try {
      const params = new URLSearchParams();
      if (s) params.set("start_date", s);
      if (e) params.set("end_date", e);
      const res = await api.get(`/reports/financial-summary/${params.toString() ? `?${params}` : ""}`);
      setData(res.data);
      // Populate the date inputs from the resolved period on first load.
      if (res.data.period) {
        if (!s) setStart(res.data.period.start);
        if (!e) setEnd(res.data.period.end);
      }
    } catch {
      toast.error("Failed to load reports");
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (start) params.set("start_date", start);
      if (end) params.set("end_date", end);
      const res = await api.get(`/reports/export/financial/?${params}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `financial_export.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error("Export failed");
    }
  };

  if (!data) return null;

  const totalAllocated = data.budget_utilization.reduce((sum: number, b: any) => sum + b.allocated, 0);
  const totalSpent = data.budget_utilization.reduce((sum: number, b: any) => sum + b.spent, 0);
  const burnRate = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;
  const ls = data.ledger_summary || {};

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="text-emerald-500" /> Financial Reports</h1>
          <p className="text-neutral-500">Analytics and exports for IT spending</p>
        </div>
        <Button onClick={handleExport}><Download className="w-4 h-4 mr-2" /> Export to Excel</Button>
      </div>

      {/* Date range filter */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">From</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">To</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm" />
          </div>
          <Button onClick={() => fetchData(start, end)}>Apply</Button>
          <span className="text-sm text-neutral-500 ml-auto">
            Showing <span className="font-medium">{data.period?.start}</span> → <span className="font-medium">{data.period?.end}</span>
          </span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Budget</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmt(totalAllocated)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Spent (Period)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{fmt(totalSpent)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Remaining</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">{fmt(totalAllocated - totalSpent)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Burn Rate</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{burnRate.toFixed(1)}%</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Monthly Expenses</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly_expenses}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" />
                <YAxis />
                <RechartsTooltip formatter={(value) => fmt(Number(value))} />
                <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top 5 Expense Categories</CardTitle></CardHeader>
          <CardContent className="h-80 flex items-center justify-center">
            {data.top_categories.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.top_categories} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value" label={({name, percent}: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {data.top_categories.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => fmt(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-neutral-500">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Budget Utilization by Category</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="w-1/3">Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.budget_utilization.map((b: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{b.category}</TableCell>
                    <TableCell className="text-right">{fmt(b.allocated)}</TableCell>
                    <TableCell className="text-right">{fmt(b.spent)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                          <div className={`h-full ${b.percentage > 90 ? 'bg-red-500' : b.percentage > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{width: `${Math.min(b.percentage, 100)}%`}}></div>
                        </div>
                        <span className="text-xs text-neutral-500 w-8">{b.percentage.toFixed(0)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Petty Cash (Period)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between"><span className="text-neutral-500">Total In</span><span className="font-medium text-emerald-600">{fmt(data.petty_cash.total_in)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Total Out</span><span className="font-medium text-red-600">{fmt(data.petty_cash.total_out)}</span></div>
              <div className="flex justify-between pt-2 border-t font-bold"><span className="text-neutral-500">Net</span><span>{fmt(data.petty_cash.balance)}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Commitments</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between"><span className="text-neutral-500">Direct Payments (Period)</span><span className="font-medium">{fmt(data.direct_payments_total)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Recurring (Monthly)</span><span className="font-medium text-blue-600">{fmt(data.monthly_commitment)}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5 text-indigo-500" /> Ledger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg border p-3"><div className="text-xs text-neutral-500">Opening Balance</div><div className="text-lg font-bold">{fmt(ls.opening_balance)}</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-neutral-500">Money In</div><div className="text-lg font-bold text-emerald-600">{fmt(ls.total_in)}</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-neutral-500">Money Out</div><div className="text-lg font-bold text-red-600">{fmt(ls.total_out)}</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-neutral-500">Net</div><div className={`text-lg font-bold ${ls.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(ls.net)}</div></div>
            <div className="rounded-lg border p-3 bg-muted/40"><div className="text-xs text-neutral-500">Closing Balance</div><div className="text-lg font-bold">{fmt(ls.closing_balance)}</div></div>
          </div>

          <div className="max-h-[480px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={6} className="font-medium text-neutral-500">Opening Balance</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(ls.opening_balance)}</TableCell>
                </TableRow>
                {data.ledger.map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                    <TableCell><span className={`text-xs px-1.5 py-0.5 rounded ${r.credit > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{r.type}</span></TableCell>
                    <TableCell className="font-medium max-w-[260px] truncate">{r.description}</TableCell>
                    <TableCell className="text-neutral-500">{r.party}</TableCell>
                    <TableCell className="text-right text-red-600">{r.debit ? fmt(r.debit) : ''}</TableCell>
                    <TableCell className="text-right text-emerald-600">{r.credit ? fmt(r.credit) : ''}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(r.balance)}</TableCell>
                  </TableRow>
                ))}
                {data.ledger.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-neutral-500 py-6">No transactions in this period.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
