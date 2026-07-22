"use client";

import { useEffect, useState } from "react";
import { Download, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useMoney } from "@/lib/currency";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function AssetReportsPage() {
  const money = useMoney();
  const [data, setData] = useState<any>(null);

  const fetchData = async () => {
    try {
      const res = await api.get('/reports/asset-summary/');
      setData(res.data);
    } catch {
      toast.error("Failed to load reports");
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleExport = async () => {
    try {
      const res = await api.get('/reports/export/assets/?format=excel', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'assets_export.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error("Export failed");
    }
  };

  if (!data) return null;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MonitorSmartphone className="text-blue-500" /> Asset Reports</h1>
          <p className="text-neutral-500">Analytics and exports for IT inventory</p>
        </div>
        <Button onClick={handleExport}><Download className="w-4 h-4 mr-2" /> Export to Excel</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Assets</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.total_assets}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Value</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{money(data.total_value)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Assigned (%)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.assigned_percentage.toFixed(1)}%</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Expiring Warranties (60d)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{data.expiring_warranties.length}</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Assets by Status</CardTitle></CardHeader>
          <CardContent className="h-80 flex items-center justify-center">
            {data.assets_by_status.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.assets_by_status} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value" label={({name, percent}: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {data.assets_by_status.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-neutral-500">No data</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Total Value by Category</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.total_value_by_category} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="category" type="category" width={100} />
                <RechartsTooltip formatter={(value) => money(Number(value))} />
                <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-amber-500" /> Expiring Warranties (Next 60 Days)</CardTitle></CardHeader>
          <CardContent>
            {data.expiring_warranties.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Asset</TableHead><TableHead>Tag</TableHead><TableHead>Expiry Date</TableHead><TableHead className="text-right">Days Left</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.expiring_warranties.map((w: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell>{w.tag}</TableCell>
                      <TableCell>{w.warranty_date}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={w.days_remaining <= 14 ? 'destructive' : 'secondary'}>{w.days_remaining} days</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-neutral-500">No expiring warranties in the next 60 days.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recently Assigned (Last 30 Days)</CardTitle></CardHeader>
          <CardContent>
            {data.recently_assigned.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Date</TableHead><TableHead>Asset</TableHead><TableHead>Assigned To</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.recently_assigned.map((a: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{a.date}</TableCell>
                      <TableCell className="font-medium">{a.asset} <span className="text-xs text-neutral-500">({a.tag})</span></TableCell>
                      <TableCell>{a.to_user}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-neutral-500">No assets assigned in the last 30 days.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
