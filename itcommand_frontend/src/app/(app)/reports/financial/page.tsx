"use client";

import { useEffect, useState } from "react";
import { Download, TrendingUp, PieChart as PieChartIcon } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function FinancialReportsPage() {
  const [data, setData] = useState<any>(null);

  const fetchData = async () => {
    try {
      const res = await api.get('/reports/financial-summary/');
      setData(res.data);
    } catch {
      toast.error("Failed to load reports");
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleExport = async () => {
    try {
      const res = await api.get('/reports/export/financial/?format=excel', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'financial_export.xlsx');
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

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="text-emerald-500" /> Financial Reports</h1>
          <p className="text-neutral-500">Analytics and exports for IT spending</p>
        </div>
        <Button onClick={handleExport}><Download className="w-4 h-4 mr-2" /> Export to Excel</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Budget</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">${totalAllocated.toFixed(2)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Spent</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">${totalSpent.toFixed(2)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Remaining</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">${(totalAllocated - totalSpent).toFixed(2)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Burn Rate</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{burnRate.toFixed(1)}%</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Monthly Expenses (Last 12 Months)</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly_expenses}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" />
                <YAxis />
                <RechartsTooltip formatter={(value) => `$${value}`} />
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
                  <Pie data={data.top_categories} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value" label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {data.top_categories.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => `$${value}`} />
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
                    <TableCell className="text-right">${b.allocated.toFixed(0)}</TableCell>
                    <TableCell className="text-right">${b.spent.toFixed(0)}</TableCell>
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
            <CardHeader><CardTitle>Petty Cash Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between"><span className="text-neutral-500">Total In</span><span className="font-medium text-emerald-600">${data.petty_cash.total_in.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Total Out</span><span className="font-medium text-red-600">${data.petty_cash.total_out.toFixed(2)}</span></div>
              <div className="flex justify-between pt-2 border-t font-bold"><span className="text-neutral-500">Balance</span><span>${data.petty_cash.balance.toFixed(2)}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Commitments</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between"><span className="text-neutral-500">Direct Payments (Total)</span><span className="font-medium">${data.direct_payments_total.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Recurring (Monthly Avg)</span><span className="font-medium text-blue-600">${data.monthly_commitment.toFixed(2)}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
