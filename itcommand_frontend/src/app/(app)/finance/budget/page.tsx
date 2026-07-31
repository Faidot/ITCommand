"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Wallet, BellRing } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend } from "recharts";
import { RowActions } from "@/components/finance/row-actions";
import { DetailDialog } from "@/components/finance/detail-dialog";
import { useMoney, useCurrencyCode } from "@/lib/currency";

export default function BudgetPage() {
  const money = useMoney();
  const currencyCode = useCurrencyCode();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [years, setYears] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [budgets, setBudgets] = useState<any[]>([]);

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);
  const [formCategory, setFormCategory] = useState("");
  const [formAmount, setFormAmount] = useState("");

  const [trendMonths, setTrendMonths] = useState("6");
  const [trendCat, setTrendCat] = useState("ALL");

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState("");
  const [cloneRollover, setCloneRollover] = useState(false);

  const fetchDependencies = async () => {
    try {
      const [yrRes, catRes] = await Promise.all([api.get("/finance/years/"), api.get("/finance/categories/")]);
      setYears(yrRes.data);
      setCategories(catRes.data);
      if (yrRes.data.length > 0) {
        const active = yrRes.data.find((y: any) => y.is_active) || yrRes.data[0];
        setSelectedYear(active.id.toString());
      }
    } catch { toast.error("Failed to load dependencies"); }
  };

  const fetchDashboard = useCallback(async () => {
    try {
      const p = new URLSearchParams({ months: trendMonths });
      if (trendCat !== "ALL") p.append("category", trendCat);
      const res = await api.get(`/finance/dashboard/?${p.toString()}`); setDashboardData(res.data);
    } catch (e) { console.error(e); }
  }, [trendMonths, trendCat]);

  const fetchBudgets = useCallback(async () => {
    if (!selectedYear) return;
    try { const res = await api.get(`/finance/budgets/?financial_year=${selectedYear}`); setBudgets(res.data); }
    catch { toast.error("Failed to load allocations"); }
  }, [selectedYear]);

  useEffect(() => { fetchDependencies(); }, []);
  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);
  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const doClone = async () => {
    if (!cloneSource || cloneSource === selectedYear) { toast.error("Pick a different source year"); return; }
    try {
      const res = await api.post("/finance/budgets/clone/", { source: parseInt(cloneSource), target: parseInt(selectedYear), rollover: cloneRollover });
      toast.success(`Cloned ${res.data.created} allocation(s); skipped ${res.data.skipped} existing.`);
      setCloneOpen(false); fetchBudgets(); fetchDashboard();
    } catch (e: any) { toast.error(e.response?.data?.detail || "Clone failed"); }
  };

  const spentFor = (categoryId: number) =>
    dashboardData?.spent_by_category?.find((c: any) => c.category_id === categoryId)?.spent ?? 0;

  const openAdd = () => { setEditing(null); setFormCategory(""); setFormAmount(""); setIsOpen(true); };
  const openEdit = (b: any) => { setEditing(b); setFormCategory(String(b.category)); setFormAmount(String(b.allocated_amount)); setIsOpen(true); };

  const onSubmit = async () => {
    if (!formCategory || !formAmount) { toast.error("Category and amount are required"); return; }
    const payload = { financial_year: parseInt(selectedYear), category: parseInt(formCategory), allocated_amount: parseFloat(formAmount) };
    try {
      if (editing) { await api.patch(`/finance/budgets/${editing.id}/`, payload); toast.success("Allocation updated"); }
      else { await api.post("/finance/budgets/", payload); toast.success("Budget allocated"); }
      setIsOpen(false);
      fetchBudgets(); fetchDashboard();
    } catch (e: any) {
      toast.error(e.response?.data?.non_field_errors?.[0] || "Failed to save allocation");
    }
  };

  const deleteBudget = async (id: number) => {
    if (!confirm("Delete this allocation?")) return;
    try { await api.delete(`/finance/budgets/${id}/`); toast.success("Deleted"); fetchBudgets(); fetchDashboard(); }
    catch { toast.error("Delete failed"); }
  };

  if (!isAdmin) return <div className="p-8 text-center text-red-500">Access Denied</div>;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Wallet className="w-6 h-6 text-indigo-600" /> IT Budget</h1>
          <p className="text-neutral-500">Manage financial year allocations</p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[180px] bg-white dark:bg-neutral-900"><SelectValue placeholder="Financial Year" /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y.id} value={y.id.toString()}>{y.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={() => { setCloneSource(""); setCloneRollover(false); setCloneOpen(true); }}>Clone from year</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Allocation</Button>
        </div>
      </div>

      {dashboardData && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Budget</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{money(dashboardData.total_budget)}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Spent</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-red-600">{money(dashboardData.total_spent)}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Remaining</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-emerald-600">{money(dashboardData.remaining_budget)}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Net Cash Flow</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${(dashboardData.net_cash_flow ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{money(dashboardData.net_cash_flow)}</div><div className="text-xs text-neutral-500">Income {money(dashboardData.total_income, { decimals: 0 })}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Pending Approvals</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-amber-600">{dashboardData.pending_approvals_count || 0}</div><div className="text-xs text-neutral-500">{money(dashboardData.pending_approvals_amount, { decimals: 0 })}</div></CardContent></Card>
          </div>

          {dashboardData.monthly_trend?.length > 0 && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Income vs Expense{trendCat !== "ALL" ? ` — ${categories.find((c) => String(c.id) === trendCat)?.name || ""}` : ""}</CardTitle>
                <div className="flex gap-2">
                  <Select value={trendCat} onValueChange={setTrendCat}>
                    <SelectTrigger className="w-[150px] h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="ALL">All Categories</SelectItem>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={trendMonths} onValueChange={setTrendMonths}>
                    <SelectTrigger className="w-[110px] h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="6">6 months</SelectItem><SelectItem value="12">12 months</SelectItem><SelectItem value="24">24 months</SelectItem></SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboardData.monthly_trend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-800" />
                      <XAxis dataKey="month" fontSize={12} />
                      <YAxis fontSize={12} />
                      <RTooltip formatter={(v: any) => money(Number(v))} />
                      <Legend />
                      <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" name="Expense" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <h3 className="text-lg font-semibold mt-4">Category Allocations</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {budgets.length === 0 && <p className="text-sm text-neutral-400 col-span-full">No allocations for this year yet.</p>}
        {budgets.map((b) => {
          const allocated = parseFloat(b.allocated_amount);
          const spent = spentFor(b.category);
          const remaining = allocated - spent;
          const pct = allocated > 0 ? (spent / allocated) * 100 : 0;
          return (
            <Card key={b.id}>
              <CardContent className="pt-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold cursor-pointer" onClick={() => setViewing({ ...b, spent, remaining })}>{b.category_name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-neutral-500">{money(spent, { decimals: 0 })} / {money(allocated, { decimals: 0 })}</span>
                    <RowActions onView={() => setViewing({ ...b, spent, remaining })} onEdit={() => openEdit(b)} onDelete={() => deleteBudget(b.id)} />
                  </div>
                </div>
                <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
                  <div className={`h-full ${pct > 90 ? "bg-red-500" : pct > 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <div className="mt-2 text-xs text-neutral-500 text-right">{money(remaining)} remaining</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add / Edit */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Allocation" : "Allocate Budget"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Category</label>
              <Select value={formCategory} onValueChange={setFormCategory} disabled={!!editing}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Amount ({currencyCode})</label>
              <Input type="number" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} />
            </div>
            <DialogFooter><Button onClick={onSubmit}>{editing ? "Update" : "Allocate"}</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clone allocations from another year */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Clone allocations into {years.find((y) => String(y.id) === selectedYear)?.name || "this year"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Copy from year</label>
              <Select value={cloneSource} onValueChange={setCloneSource}>
                <SelectTrigger><SelectValue placeholder="Select source year" /></SelectTrigger>
                <SelectContent>{years.filter((y) => String(y.id) !== selectedYear).map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cloneRollover} onChange={(e) => setCloneRollover(e.target.checked)} />
              Roll over remaining budget (add leftover to each allocation)
            </label>
            <p className="text-xs text-neutral-500">Existing allocations in the target year are left untouched.</p>
            <DialogFooter><Button onClick={doClone}>Clone</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* View detail */}
      {viewing && (
        <DetailDialog
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          title={viewing.category_name}
          subtitle={viewing.financial_year_name}
          fields={[
            { label: "Allocated", value: money(parseFloat(viewing.allocated_amount)) },
            { label: "Spent", value: money(viewing.spent ?? 0) },
            { label: "Remaining", value: money(viewing.remaining ?? 0) },
            { label: "Notes", value: viewing.notes, full: true },
          ]}
          footer={<div className="flex justify-end gap-2 pt-3"><Button variant="outline" onClick={() => { setViewing(null); openEdit(viewing); }}>Edit</Button></div>}
        />
      )}
    </div>
  );
}
