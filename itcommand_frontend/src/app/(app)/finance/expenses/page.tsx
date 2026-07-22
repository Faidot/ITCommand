"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle, Plus, Trash2, Paperclip, FileText, Search, Download, Printer, AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { RowActions } from "@/components/finance/row-actions";
import { DetailDialog } from "@/components/finance/detail-dialog";
import { SourceSelect } from "@/components/finance/source-select";
import { useMoney, useCurrencyCode } from "@/lib/currency";

type Entry = { title: string; amount: string; category: string };

const emptyShared = { paid_to: "", expense_date: "", financial_year: "", payment_method: "BANK_TRANSFER", source: "" };
const emptyBill = { bill_number: "", bill_date: "" };
const METHODS = ["PETTY_CASH", "BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "ONLINE", "OTHER"];

function downloadBlob(data: BlobPart, filename: string) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const statusBadge = (s: string) => {
  if (s === "APPROVED") return <Badge className="bg-emerald-600 hover:bg-emerald-700 border-0">Approved</Badge>;
  if (s === "REJECTED") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge className="bg-amber-500 hover:bg-amber-600 border-0">Pending</Badge>;
};

export default function ExpensesPage() {
  const money = useMoney();
  const currencyCode = useCurrencyCode();
  const { user } = useAuthStore();
  const canModify = user?.role !== "VIEWER";
  const canApprove = ["MANAGER", "ADMIN", "SUPERADMIN"].includes(user?.role || "");

  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [budgetByCat, setBudgetByCat] = useState<Record<string, any>>({});

  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [shared, setShared] = useState({ ...emptyShared });
  const [bill, setBill] = useState({ ...emptyBill });
  const [billFile, setBillFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<Entry[]>([{ title: "", amount: "", category: "" }]);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  const fetchData = async () => {
    try {
      const [expRes, catRes, yrRes, srcRes, astRes, licRes, prRes, subRes, dashRes] = await Promise.all([
        api.get("/finance/expenses/"),
        api.get("/finance/categories/"),
        api.get("/finance/years/"),
        api.get("/finance/sources/?active=true"),
        api.get("/assets/").catch(() => ({ data: [] })),
        api.get("/licenses/").catch(() => ({ data: [] })),
        api.get("/procurement/requests/").catch(() => ({ data: [] })),
        api.get("/subscriptions/").catch(() => ({ data: [] })),
        api.get("/finance/dashboard/").catch(() => ({ data: { spent_by_category: [] } })),
      ]);
      setExpenses(expRes.data);
      setCategories(catRes.data);
      setYears(yrRes.data);
      setSources(srcRes.data);
      setAssets(Array.isArray(astRes.data) ? astRes.data : astRes.data.results || []);
      setLicenses(Array.isArray(licRes.data) ? licRes.data : licRes.data.results || []);
      setPrs(Array.isArray(prRes.data) ? prRes.data : prRes.data.results || []);
      setSubscriptions(Array.isArray(subRes.data) ? subRes.data : subRes.data.results || []);
      const map: Record<string, any> = {};
      (dashRes.data.spent_by_category || []).forEach((c: any) => { map[String(c.category_id)] = c; });
      setBudgetByCat(map);
      setSelected(new Set());
    } catch { toast.error("Failed to load"); }
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => expenses.filter((e) => {
    if (filterCat !== "ALL" && String(e.category) !== filterCat) return false;
    if (filterStatus !== "ALL" && e.status !== filterStatus) return false;
    if (startDate && e.expense_date < startDate) return false;
    if (endDate && e.expense_date > endDate) return false;
    if (search && !`${e.title} ${e.paid_to} ${e.receipt_number || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [expenses, search, filterCat, filterStatus, startDate, endDate]);

  const total = useMemo(() => filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0), [filtered]);
  const pendingCount = useMemo(() => expenses.filter((e) => e.status === "PENDING").length, [expenses]);
  const thisMonth = useMemo(() => {
    const now = new Date(); const m = now.getMonth(), y = now.getFullYear();
    return expenses.filter((e) => e.status === "APPROVED").filter((e) => { const d = new Date(e.expense_date); return d.getMonth() === m && d.getFullYear() === y; })
      .reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  }, [expenses]);

  // Budget guardrail — compute overspend warnings for the entries being added
  const overspendWarnings = useMemo(() => {
    const byCat: Record<string, number> = {};
    entries.forEach((e) => { if (e.category && e.amount) byCat[e.category] = (byCat[e.category] || 0) + (parseFloat(e.amount) || 0); });
    const warns: string[] = [];
    Object.entries(byCat).forEach(([cat, amt]) => {
      const b = budgetByCat[cat];
      if (b && amt > b.remaining) {
        const catName = categories.find((c) => String(c.id) === cat)?.name || "category";
        warns.push(`${catName}: ${money(amt)} exceeds remaining budget of ${money(b.remaining)}`);
      }
    });
    return warns;
  }, [entries, budgetByCat, categories]);

  const resetForm = () => { setShared({ ...emptyShared }); setBill({ ...emptyBill }); setBillFile(null); setEntries([{ title: "", amount: "", category: "" }]); };
  const addEntry = () => setEntries([...entries, { title: "", amount: "", category: "" }]);
  const removeEntry = (i: number) => setEntries(entries.filter((_, idx) => idx !== i));
  const updateEntry = (i: number, field: keyof Entry, value: string) => setEntries(entries.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  const entriesTotal = entries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const onSubmit = async () => {
    const valid = entries.filter((e) => e.title.trim() && e.amount);
    if (valid.length === 0) { toast.error("Add at least one entry with a title and amount"); return; }
    if (!shared.expense_date) { toast.error("Date is required"); return; }
    if (overspendWarnings.length > 0 && !confirm(`Budget warning:\n\n${overspendWarnings.join("\n")}\n\nRecord anyway?`)) return;

    const fd = new FormData();
    if (billFile) fd.append("document", billFile);
    fd.append("bill_number", bill.bill_number);
    if (bill.bill_date) fd.append("bill_date", bill.bill_date);
    fd.append("expense_date", shared.expense_date);
    fd.append("paid_to", shared.paid_to);
    fd.append("payment_method", shared.payment_method);
    if (shared.source) fd.append("source", shared.source);
    if (shared.financial_year) fd.append("financial_year", shared.financial_year);
    fd.append("entries", JSON.stringify(valid.map((e) => ({ title: e.title, amount: parseFloat(e.amount), category: e.category ? parseInt(e.category) : null }))));

    setSubmitting(true);
    try {
      await api.post("/finance/expenses/upload/", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(canApprove && user?.role !== "MANAGER" ? "Expense recorded" : "Expense submitted for approval");
      setIsOpen(false);
      resetForm();
      fetchData();
    } catch { toast.error("Error recording expense"); }
    finally { setSubmitting(false); }
  };

  const openEdit = (e: any) => {
    setEditing(e);
    setEditForm({
      title: e.title ?? "", amount: String(e.amount ?? ""), expense_date: e.expense_date ?? "",
      category: e.category ? String(e.category) : "", financial_year: e.financial_year ? String(e.financial_year) : "",
      payment_method: e.payment_method ?? "BANK_TRANSFER", paid_to: e.paid_to ?? "",
      source: e.source ? String(e.source) : "",
      linked_asset: e.linked_asset ? String(e.linked_asset) : "",
      linked_license: e.linked_license ? String(e.linked_license) : "",
      linked_subscription: e.linked_subscription ? String(e.linked_subscription) : "",
      linked_purchase_request: e.linked_purchase_request ? String(e.linked_purchase_request) : "",
      receipt_number: e.receipt_number ?? "", description: e.description ?? "",
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editForm.title?.trim()) { toast.error("Title is required"); return; }
    const payload: any = {
      title: editForm.title, amount: parseFloat(editForm.amount) || 0, expense_date: editForm.expense_date || null,
      category: editForm.category ? parseInt(editForm.category) : null,
      financial_year: editForm.financial_year ? parseInt(editForm.financial_year) : null,
      payment_method: editForm.payment_method, paid_to: editForm.paid_to,
      source: editForm.source ? parseInt(editForm.source) : null,
      linked_asset: editForm.linked_asset ? parseInt(editForm.linked_asset) : null,
      linked_license: editForm.linked_license ? parseInt(editForm.linked_license) : null,
      linked_subscription: editForm.linked_subscription ? parseInt(editForm.linked_subscription) : null,
      linked_purchase_request: editForm.linked_purchase_request ? parseInt(editForm.linked_purchase_request) : null,
      receipt_number: editForm.receipt_number, description: editForm.description,
    };
    try { await api.patch(`/finance/expenses/${editing.id}/`, payload); toast.success("Expense updated"); setEditOpen(false); fetchData(); }
    catch { toast.error("Update failed"); }
  };

  const approve = async (e: any) => { try { await api.post(`/finance/expenses/${e.id}/approve/`, {}); toast.success("Approved"); fetchData(); } catch { toast.error("Approve failed"); } };
  const reject = async (e: any) => { const reason = window.prompt("Reason for rejection (optional):") ?? ""; try { await api.post(`/finance/expenses/${e.id}/reject/`, { reason }); toast.success("Rejected"); fetchData(); } catch { toast.error("Reject failed"); } };

  const deleteOne = async (id: number) => { if (!confirm("Delete this expense?")) return; try { await api.delete(`/finance/expenses/${id}/`); toast.success("Deleted"); fetchData(); } catch { toast.error("Delete failed"); } };
  const deleteSelected = async () => { if (!confirm(`Delete ${selected.size} selected expense(s)?`)) return; try { await Promise.all(Array.from(selected).map((id) => api.delete(`/finance/expenses/${id}/`))); toast.success("Deleted selected"); fetchData(); } catch { toast.error("Bulk delete failed"); } };
  const toggle = (id: number) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };
  const toggleAll = () => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((e) => e.id)));

  const exportData = async (fmt: "csv" | "xlsx") => {
    const p = new URLSearchParams({ format: fmt });
    if (startDate) p.append("start", startDate);
    if (endDate) p.append("end", endDate);
    if (filterCat !== "ALL") p.append("category", filterCat);
    if (filterStatus !== "ALL") p.append("status", filterStatus);
    try { const res = await api.get(`/finance/expenses/export/?${p.toString()}`, { responseType: "blob" }); downloadBlob(res.data, `expenses.${fmt}`); }
    catch { toast.error("Export failed"); }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ArrowUpCircle className="text-rose-500" /> Expenses</h1>
          <p className="text-neutral-500">Money going out — approvals required before they count against the budget</p>
        </div>
        <div className="flex gap-2">
          {canModify && selected.size > 0 && <Button variant="outline" className="text-red-600" onClick={deleteSelected}><Trash2 className="w-4 h-4 mr-2" /> Delete ({selected.size})</Button>}
          {canModify && <Button onClick={() => { resetForm(); setIsOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Log Expense</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total (filtered)</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-rose-600">{money(total)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Approved This Month</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{money(thisMonth)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-amber-500" /> Pending</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-amber-600">{pendingCount}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Entries</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{filtered.length}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input className="pl-9" placeholder="Search expenses..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All Status</SelectItem><SelectItem value="PENDING">Pending</SelectItem><SelectItem value="APPROVED">Approved</SelectItem><SelectItem value="REJECTED">Rejected</SelectItem></SelectContent>
        </Select>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All Categories</SelectItem>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" className="w-[150px]" value={startDate} onChange={(e) => setStartDate(e.target.value)} title="From" />
        <Input type="date" className="w-[150px]" value={endDate} onChange={(e) => setEndDate(e.target.value)} title="To" />
        <Button variant="outline" onClick={() => exportData("csv")}><Download className="w-4 h-4 mr-2" /> CSV</Button>
        <Button variant="outline" onClick={() => exportData("xlsx")}><Download className="w-4 h-4 mr-2" /> XLSX</Button>
        <Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print</Button>
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {canModify && <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && selected.size === filtered.length} onCheckedChange={toggleAll} /></TableHead>}
              <TableHead>Date</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Paid To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Bill</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-neutral-400 py-8">No expenses logged</TableCell></TableRow>}
            {filtered.map((e) => (
              <TableRow key={e.id} data-state={selected.has(e.id) ? "selected" : undefined}>
                {canModify && <TableCell><Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} /></TableCell>}
                <TableCell>{e.expense_date}</TableCell>
                <TableCell className="font-medium cursor-pointer" onClick={() => setViewing(e)}>{e.title}</TableCell>
                <TableCell>{e.category_name}</TableCell>
                <TableCell>{e.paid_to}</TableCell>
                <TableCell>{statusBadge(e.status)}</TableCell>
                <TableCell>
                  {e.bill_document_url ? (
                    <a href={e.bill_document_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 inline-flex items-center gap-1 text-sm"><FileText className="w-3.5 h-3.5" /> {e.bill_number || "View"}</a>
                  ) : (<span className="text-neutral-400 text-sm">{e.bill_number || "—"}</span>)}
                </TableCell>
                <TableCell className="text-right font-bold">{money(e.amount)}</TableCell>
                <TableCell>
                  <RowActions
                    canModify={canModify}
                    onView={() => setViewing(e)}
                    onEdit={() => openEdit(e)}
                    onDelete={() => deleteOne(e.id)}
                    extra={canApprove && e.status === "PENDING" ? (
                      <>
                        <DropdownMenuItem onClick={() => approve(e)} className="text-emerald-600 focus:text-emerald-600"><Check className="w-4 h-4 mr-2" /> Approve</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => reject(e)} className="text-red-600 focus:text-red-600"><X className="w-4 h-4 mr-2" /> Reject</DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : undefined}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add: multi-entry + bill */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Log Expense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-sm font-medium">Date *</label><Input type="date" value={shared.expense_date} onChange={(e) => setShared({ ...shared, expense_date: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Paid To</label><Input value={shared.paid_to} onChange={(e) => setShared({ ...shared, paid_to: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Financial Year</label>
                <Select value={shared.financial_year} onValueChange={(v) => setShared({ ...shared, financial_year: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{years.map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Payment Method</label>
                <Select value={shared.payment_method} onValueChange={(v) => setShared({ ...shared, payment_method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1 col-span-2"><label className="text-sm font-medium">Source (fund)</label>
                <SourceSelect value={shared.source} onChange={(v) => setShared({ ...shared, source: v })} sources={sources} onAdded={(s) => setSources((prev) => [...prev, s])} canAdd={canModify} />
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-3 bg-neutral-50 dark:bg-neutral-900/40">
              <div className="flex items-center gap-2 text-sm font-medium"><Paperclip className="w-4 h-4" /> Bill / Receipt (optional)</div>
              <Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setBillFile(e.target.files?.[0] || null)} />
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="Bill / Receipt Number" value={bill.bill_number} onChange={(e) => setBill({ ...bill, bill_number: e.target.value })} />
                <Input type="date" value={bill.bill_date} onChange={(e) => setBill({ ...bill, bill_date: e.target.value })} />
              </div>
              <p className="text-xs text-neutral-500">One uploaded bill can cover multiple entries below.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><label className="text-sm font-medium">Entries</label><Button type="button" size="sm" variant="outline" onClick={addEntry}><Plus className="w-4 h-4 mr-1" /> Add Entry</Button></div>
              {entries.map((e, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-5" placeholder="Title / Description" value={e.title} onChange={(ev) => updateEntry(i, "title", ev.target.value)} />
                  <Input className="col-span-3" type="number" step="0.01" placeholder="Amount" value={e.amount} onChange={(ev) => updateEntry(i, "amount", ev.target.value)} />
                  <div className="col-span-3">
                    <Select value={e.category} onValueChange={(v) => updateEntry(i, "category", v)}>
                      <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                      <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="col-span-1" onClick={() => removeEntry(i)} disabled={entries.length === 1}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              ))}
              <div className="text-right text-sm font-semibold">Total: ${entriesTotal.toFixed(2)}</div>
            </div>

            {overspendWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400">
                <div className="flex items-center gap-2 font-medium mb-1"><AlertTriangle className="w-4 h-4" /> Budget warning</div>
                <ul className="list-disc pl-5 space-y-0.5">{overspendWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}

            <DialogFooter><Button onClick={onSubmit} disabled={submitting}>Save</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit single expense */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Edit Expense</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><label className="text-sm font-medium">Title</label><Input value={editForm.title || ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Amount</label><Input type="number" step="0.01" value={editForm.amount || ""} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Date</label><Input type="date" value={editForm.expense_date || ""} onChange={(e) => setEditForm({ ...editForm, expense_date: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Paid To</label><Input value={editForm.paid_to || ""} onChange={(e) => setEditForm({ ...editForm, paid_to: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Category</label>
              <Select value={editForm.category || ""} onValueChange={(v) => setEditForm({ ...editForm, category: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><label className="text-sm font-medium">Financial Year</label>
              <Select value={editForm.financial_year || ""} onValueChange={(v) => setEditForm({ ...editForm, financial_year: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{years.map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><label className="text-sm font-medium">Method</label>
              <Select value={editForm.payment_method || "BANK_TRANSFER"} onValueChange={(v) => setEditForm({ ...editForm, payment_method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><label className="text-sm font-medium">Receipt #</label><Input value={editForm.receipt_number || ""} onChange={(e) => setEditForm({ ...editForm, receipt_number: e.target.value })} /></div>
            <div className="space-y-1 col-span-2"><label className="text-sm font-medium">Source (fund)</label><SourceSelect value={editForm.source || ""} onChange={(v) => setEditForm({ ...editForm, source: v })} sources={sources} onAdded={(s) => setSources((prev) => [...prev, s])} canAdd={canModify} /></div>
            <div className="col-span-2 border-t pt-3 mt-1 text-xs uppercase tracking-wide text-neutral-400">Link to other modules (optional)</div>
            <div className="space-y-1"><label className="text-sm font-medium">Asset</label>
              <Select value={editForm.linked_asset || ""} onValueChange={(v) => setEditForm({ ...editForm, linked_asset: v })}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger><SelectContent>{assets.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name || a.asset_tag || `Asset #${a.id}`}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><label className="text-sm font-medium">License</label>
              <Select value={editForm.linked_license || ""} onValueChange={(v) => setEditForm({ ...editForm, linked_license: v })}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger><SelectContent>{licenses.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.product_name || `License #${l.id}`}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><label className="text-sm font-medium">Subscription</label>
              <Select value={editForm.linked_subscription || ""} onValueChange={(v) => setEditForm({ ...editForm, linked_subscription: v })}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger><SelectContent>{subscriptions.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name || `Subscription #${s.id}`}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1 col-span-2"><label className="text-sm font-medium">Purchase Request</label>
              <Select value={editForm.linked_purchase_request || ""} onValueChange={(v) => setEditForm({ ...editForm, linked_purchase_request: v })}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger><SelectContent>{prs.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.pr_number || p.title || `PR #${p.id}`}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1 col-span-2"><label className="text-sm font-medium">Description</label><Input value={editForm.description || ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={submitEdit}>Update</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View detail */}
      {viewing && (
        <DetailDialog
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          title={viewing.title}
          subtitle={viewing.category_name}
          fields={[
            { label: "Amount", value: money(viewing.amount) },
            { label: "Status", value: statusBadge(viewing.status) },
            { label: "Date", value: viewing.expense_date },
            { label: "Paid To", value: viewing.paid_to },
            { label: "Source", value: viewing.source_name },
            { label: "Method", value: viewing.payment_method },
            { label: "Approved By", value: viewing.approved_by_name },
            { label: "Financial Year", value: viewing.financial_year_name },
            { label: "Receipt #", value: viewing.receipt_number },
            { label: "Bill", value: viewing.bill_document_url ? <a href={viewing.bill_document_url} target="_blank" rel="noopener noreferrer" className="text-blue-500">Open document</a> : viewing.bill_number },
            { label: "Linked Asset", value: viewing.linked_asset_name },
            { label: "Linked License", value: viewing.linked_license_name },
            { label: "Linked Subscription", value: viewing.linked_subscription_name },
            { label: "Linked PR", value: viewing.linked_pr_number },
            { label: "Rejection Reason", value: viewing.rejection_reason, full: true },
            { label: "Description", value: viewing.description, full: true },
            {
              label: "Approval Timeline", full: true,
              value: (viewing.approval_logs?.length ?? 0) === 0 ? "—" : (
                <div className="relative pl-4 space-y-1 mt-1 before:absolute before:left-1 before:top-1 before:bottom-1 before:w-px before:bg-neutral-200 dark:before:bg-neutral-700">
                  {viewing.approval_logs.map((l: any) => (
                    <div key={l.id} className="relative text-sm flex items-center gap-2">
                      <span className={`absolute -left-[13px] w-2 h-2 rounded-full ${l.action === "APPROVED" ? "bg-emerald-500" : l.action === "REJECTED" ? "bg-red-500" : "bg-neutral-400"}`} />
                      <span className="font-medium">{l.action[0] + l.action.slice(1).toLowerCase()}</span>
                      <span className="text-neutral-500">by {l.by_name || "—"} · {new Date(l.at).toLocaleString()}</span>
                      {l.note && <span className="text-neutral-400">— {l.note}</span>}
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
          footer={
            <div className="flex justify-end gap-2 pt-3">
              {canApprove && viewing.status === "PENDING" && <><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { approve(viewing); setViewing(null); }}>Approve</Button><Button variant="destructive" onClick={() => { reject(viewing); setViewing(null); }}>Reject</Button></>}
              {canModify && <Button variant="outline" onClick={() => { setViewing(null); openEdit(viewing); }}>Edit</Button>}
            </div>
          }
        />
      )}
    </div>
  );
}
