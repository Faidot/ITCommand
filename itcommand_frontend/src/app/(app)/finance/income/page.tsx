"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, Plus, Trash2, Paperclip, FileText, Search, Download, Printer, CalendarClock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RowActions } from "@/components/finance/row-actions";
import { DetailDialog } from "@/components/finance/detail-dialog";
import { SourceSelect } from "@/components/finance/source-select";
import { useMoney, useCurrencyCode } from "@/lib/currency";

type Entry = { title: string; amount: string; category: string };
const emptyShared = { source: "", income_date: "", financial_year: "", payment_method: "BANK_TRANSFER" };
const emptyBill = { bill_number: "", bill_date: "" };
const METHODS = ["BANK_TRANSFER", "CASH", "CARD", "CHEQUE", "ONLINE", "OTHER"];

function downloadBlob(data: BlobPart, filename: string) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function IncomePage() {
  const money = useMoney();
  const currencyCode = useCurrencyCode();
  const { user } = useAuthStore();
  const canModify = user?.role !== "VIEWER";

  const [income, setIncome] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [recurring, setRecurring] = useState<any[]>([]);

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [shared, setShared] = useState({ ...emptyShared });
  const [bill, setBill] = useState({ ...emptyBill });
  const [billFile, setBillFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<Entry[]>([{ title: "", amount: "", category: "" }]);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  // Recurring income dialog
  const [recOpen, setRecOpen] = useState(false);
  const [recEditing, setRecEditing] = useState<any>(null);
  const [recForm, setRecForm] = useState<any>({ title: "", source: "", amount: "", frequency: "MONTHLY", next_date: "", category: "" });

  const fetchData = async () => {
    try {
      const [incRes, catRes, yrRes, srcRes, recRes] = await Promise.all([
        api.get("/finance/income/"), api.get("/finance/categories/"), api.get("/finance/years/"),
        api.get("/finance/sources/?active=true"), api.get("/finance/recurring-income/"),
      ]);
      setIncome(incRes.data); setCategories(catRes.data); setYears(yrRes.data);
      setSources(srcRes.data); setRecurring(recRes.data); setSelected(new Set());
    } catch { toast.error("Failed to load"); }
  };
  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => income.filter((i) => {
    if (filterCat !== "ALL" && String(i.category) !== filterCat) return false;
    if (startDate && i.income_date < startDate) return false;
    if (endDate && i.income_date > endDate) return false;
    if (search && !`${i.title} ${i.source_name || ""} ${i.reference || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [income, search, filterCat, startDate, endDate]);

  const total = useMemo(() => filtered.reduce((s, i) => s + parseFloat(i.amount || 0), 0), [filtered]);
  const thisMonth = useMemo(() => {
    const now = new Date(); const m = now.getMonth(), y = now.getFullYear();
    return income.filter((i) => { const d = new Date(i.income_date); return d.getMonth() === m && d.getFullYear() === y; })
      .reduce((s, i) => s + parseFloat(i.amount || 0), 0);
  }, [income]);

  const resetForm = () => { setShared({ ...emptyShared }); setBill({ ...emptyBill }); setBillFile(null); setEntries([{ title: "", amount: "", category: "" }]); };
  const addEntry = () => setEntries([...entries, { title: "", amount: "", category: "" }]);
  const removeEntry = (i: number) => setEntries(entries.filter((_, idx) => idx !== i));
  const updateEntry = (i: number, f: keyof Entry, v: string) => setEntries(entries.map((e, idx) => (idx === i ? { ...e, [f]: v } : e)));
  const entriesTotal = entries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const onSubmit = async () => {
    const valid = entries.filter((e) => e.title.trim() && e.amount);
    if (valid.length === 0) { toast.error("Add at least one entry with a title and amount"); return; }
    if (!shared.income_date) { toast.error("Date is required"); return; }
    const fd = new FormData();
    if (billFile) fd.append("document", billFile);
    fd.append("bill_number", bill.bill_number);
    if (bill.bill_date) fd.append("bill_date", bill.bill_date);
    fd.append("income_date", shared.income_date);
    if (shared.source) fd.append("source", shared.source);
    fd.append("payment_method", shared.payment_method);
    if (shared.financial_year) fd.append("financial_year", shared.financial_year);
    fd.append("entries", JSON.stringify(valid.map((e) => ({ title: e.title, amount: parseFloat(e.amount), category: e.category ? parseInt(e.category) : null }))));
    setSubmitting(true);
    try {
      await api.post("/finance/income/upload/", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(valid.length > 1 ? `${valid.length} entries recorded` : "Income recorded");
      setIsOpen(false); resetForm(); fetchData();
    } catch { toast.error("Error recording income"); }
    finally { setSubmitting(false); }
  };

  const openEdit = (i: any) => {
    setEditing(i);
    setEditForm({
      title: i.title ?? "", amount: String(i.amount ?? ""), income_date: i.income_date ?? "",
      category: i.category ? String(i.category) : "", financial_year: i.financial_year ? String(i.financial_year) : "",
      payment_method: i.payment_method ?? "BANK_TRANSFER", source: i.source ? String(i.source) : "", reference: i.reference ?? "", description: i.description ?? "",
    });
    setEditOpen(true);
  };
  const submitEdit = async () => {
    if (!editForm.title?.trim()) { toast.error("Title is required"); return; }
    try {
      await api.patch(`/finance/income/${editing.id}/`, {
        title: editForm.title, amount: parseFloat(editForm.amount) || 0, income_date: editForm.income_date || null,
        category: editForm.category ? parseInt(editForm.category) : null, financial_year: editForm.financial_year ? parseInt(editForm.financial_year) : null,
        payment_method: editForm.payment_method, source: editForm.source ? parseInt(editForm.source) : null,
        reference: editForm.reference, description: editForm.description,
      });
      toast.success("Income updated"); setEditOpen(false); fetchData();
    } catch { toast.error("Update failed"); }
  };

  const deleteOne = async (id: number) => { if (!confirm("Delete this income entry?")) return; try { await api.delete(`/finance/income/${id}/`); toast.success("Deleted"); fetchData(); } catch { toast.error("Delete failed"); } };
  const deleteSelected = async () => { if (!confirm(`Delete ${selected.size} selected?`)) return; try { await Promise.all(Array.from(selected).map((id) => api.delete(`/finance/income/${id}/`))); toast.success("Deleted selected"); fetchData(); } catch { toast.error("Bulk delete failed"); } };
  const toggle = (id: number) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };
  const toggleAll = () => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((i) => i.id)));

  const exportData = async (fmt: "csv" | "xlsx") => {
    const p = new URLSearchParams({ format: fmt });
    if (startDate) p.append("start", startDate);
    if (endDate) p.append("end", endDate);
    if (filterCat !== "ALL") p.append("category", filterCat);
    try { const res = await api.get(`/finance/income/export/?${p.toString()}`, { responseType: "blob" }); downloadBlob(res.data, `income.${fmt}`); }
    catch { toast.error("Export failed"); }
  };

  // Recurring income
  const openRec = (r: any | null) => {
    setRecEditing(r);
    setRecForm(r ? { title: r.title, source: r.source ? String(r.source) : "", amount: String(r.amount), frequency: r.frequency, next_date: r.next_date, category: r.category ? String(r.category) : "", auto_post: !!r.auto_post }
      : { title: "", source: "", amount: "", frequency: "MONTHLY", next_date: "", category: "", auto_post: false });
    setRecOpen(true);
  };
  const submitRec = async () => {
    if (!recForm.title?.trim() || !recForm.amount || !recForm.next_date) { toast.error("Title, amount and next date are required"); return; }
    const payload = { title: recForm.title, source: recForm.source ? parseInt(recForm.source) : null, amount: parseFloat(recForm.amount), frequency: recForm.frequency, next_date: recForm.next_date, category: recForm.category ? parseInt(recForm.category) : null, auto_post: !!recForm.auto_post };
    try {
      if (recEditing) await api.patch(`/finance/recurring-income/${recEditing.id}/`, payload);
      else await api.post("/finance/recurring-income/", payload);
      toast.success("Saved"); setRecOpen(false); fetchData();
    } catch { toast.error("Save failed"); }
  };
  const receiveRec = async (r: any) => {
    try { await api.post(`/finance/recurring-income/${r.id}/receive/`, {}); toast.success("Income received and recorded"); fetchData(); }
    catch { toast.error("Failed"); }
  };
  const deleteRec = async (id: number) => { if (!confirm("Delete this scheduled income?")) return; try { await api.delete(`/finance/recurring-income/${id}/`); toast.success("Deleted"); fetchData(); } catch { toast.error("Delete failed"); } };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ArrowDownCircle className="text-emerald-500" /> Income</h1>
          <p className="text-neutral-500">Money coming in</p>
        </div>
        <div className="flex gap-2">
          {canModify && selected.size > 0 && <Button variant="outline" className="text-red-600" onClick={deleteSelected}><Trash2 className="w-4 h-4 mr-2" /> Delete ({selected.size})</Button>}
          {canModify && <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { resetForm(); setIsOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Add Income</Button>}
        </div>
      </div>

      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">Entries</TabsTrigger>
          <TabsTrigger value="scheduled"><CalendarClock className="w-4 h-4 mr-2" /> Scheduled ({recurring.length})</TabsTrigger>
        </TabsList>

        {/* Entries tab */}
        <TabsContent value="entries" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total (filtered)</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-emerald-600">{money(total)}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">This Month</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{money(thisMonth)}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Entries</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{filtered.length}</div></CardContent></Card>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <Input className="pl-9" placeholder="Search income..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
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
                  <TableHead>Date</TableHead><TableHead>Title</TableHead><TableHead>Source</TableHead><TableHead>Category</TableHead><TableHead>Method</TableHead><TableHead>Receipt</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-neutral-400 py-8">No income recorded</TableCell></TableRow>}
                {filtered.map((i) => (
                  <TableRow key={i.id} data-state={selected.has(i.id) ? "selected" : undefined}>
                    {canModify && <TableCell><Checkbox checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} /></TableCell>}
                    <TableCell>{i.income_date}</TableCell>
                    <TableCell className="font-medium cursor-pointer" onClick={() => setViewing(i)}>{i.title}</TableCell>
                    <TableCell>{i.source_name || "—"}</TableCell>
                    <TableCell>{i.category_name}</TableCell>
                    <TableCell><Badge variant="outline">{i.payment_method}</Badge></TableCell>
                    <TableCell>{i.bill_document_url ? <a href={i.bill_document_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 inline-flex items-center gap-1 text-sm"><FileText className="w-3.5 h-3.5" /> {i.bill_number || "View"}</a> : <span className="text-neutral-400 text-sm">{i.reference || "—"}</span>}</TableCell>
                    <TableCell className="text-right font-bold text-emerald-600">+${i.amount}</TableCell>
                    <TableCell><RowActions canModify={canModify} onView={() => setViewing(i)} onEdit={() => openEdit(i)} onDelete={() => deleteOne(i.id)} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Scheduled tab */}
        <TabsContent value="scheduled" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-neutral-500">Predictable recurring inflows (e.g. monthly department recharge). “Receive” records an income entry and advances the next date.</p>
            {canModify && <Button variant="outline" onClick={() => openRec(null)}><Plus className="w-4 h-4 mr-2" /> Schedule Income</Button>}
          </div>
          <div className="bg-white dark:bg-neutral-900 rounded-xl border overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Source</TableHead><TableHead>Frequency</TableHead><TableHead>Next Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-28"></TableHead></TableRow></TableHeader>
              <TableBody>
                {recurring.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-neutral-400 py-8">No scheduled income</TableCell></TableRow>}
                {recurring.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>{r.source_name || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.frequency}</Badge></TableCell>
                    <TableCell>{r.next_date}</TableCell>
                    <TableCell className="text-right font-bold">{money(r.amount)}</TableCell>
                    <TableCell><div className="flex items-center justify-end gap-1">
                      {canModify && <Button size="sm" variant="secondary" onClick={() => receiveRec(r)} title="Mark received"><CheckCircle2 className="w-4 h-4" /></Button>}
                      <RowActions canModify={canModify} onEdit={() => openRec(r)} onDelete={() => deleteRec(r.id)} />
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add Income</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-sm font-medium">Date *</label><Input type="date" value={shared.income_date} onChange={(e) => setShared({ ...shared, income_date: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Source</label>
                <SourceSelect value={shared.source} onChange={(v) => setShared({ ...shared, source: v })} sources={sources} onAdded={(s) => setSources((prev) => [...prev, s])} canAdd={canModify} />
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Financial Year</label>
                <Select value={shared.financial_year} onValueChange={(v) => setShared({ ...shared, financial_year: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{years.map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Method</label>
                <Select value={shared.payment_method} onValueChange={(v) => setShared({ ...shared, payment_method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-3 bg-neutral-50 dark:bg-neutral-900/40">
              <div className="flex items-center gap-2 text-sm font-medium"><Paperclip className="w-4 h-4" /> Receipt (optional)</div>
              <Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setBillFile(e.target.files?.[0] || null)} />
              <div className="grid grid-cols-2 gap-4"><Input placeholder="Reference / Receipt Number" value={bill.bill_number} onChange={(e) => setBill({ ...bill, bill_number: e.target.value })} /><Input type="date" value={bill.bill_date} onChange={(e) => setBill({ ...bill, bill_date: e.target.value })} /></div>
              <p className="text-xs text-neutral-500">One receipt can cover multiple entries below.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><label className="text-sm font-medium">Entries</label><Button type="button" size="sm" variant="outline" onClick={addEntry}><Plus className="w-4 h-4 mr-1" /> Add Entry</Button></div>
              {entries.map((e, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-5" placeholder="Title / Description" value={e.title} onChange={(ev) => updateEntry(i, "title", ev.target.value)} />
                  <Input className="col-span-3" type="number" step="0.01" placeholder="Amount" value={e.amount} onChange={(ev) => updateEntry(i, "amount", ev.target.value)} />
                  <div className="col-span-3"><Select value={e.category} onValueChange={(v) => updateEntry(i, "category", v)}><SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  <Button type="button" variant="ghost" size="icon" className="col-span-1" onClick={() => removeEntry(i)} disabled={entries.length === 1}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              ))}
              <div className="text-right text-sm font-semibold">Total: ${entriesTotal.toFixed(2)}</div>
            </div>
            <DialogFooter><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={onSubmit} disabled={submitting}>Save</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Edit Income</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><label className="text-sm font-medium">Title</label><Input value={editForm.title || ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Amount</label><Input type="number" step="0.01" value={editForm.amount || ""} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Date</label><Input type="date" value={editForm.income_date || ""} onChange={(e) => setEditForm({ ...editForm, income_date: e.target.value })} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Source</label><SourceSelect value={editForm.source || ""} onChange={(v) => setEditForm({ ...editForm, source: v })} sources={sources} onAdded={(s) => setSources((prev) => [...prev, s])} canAdd={canModify} /></div>
            <div className="space-y-1"><label className="text-sm font-medium">Category</label><Select value={editForm.category || ""} onValueChange={(v) => setEditForm({ ...editForm, category: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><label className="text-sm font-medium">Method</label><Select value={editForm.payment_method || "BANK_TRANSFER"} onValueChange={(v) => setEditForm({ ...editForm, payment_method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1 col-span-2"><label className="text-sm font-medium">Description</label><Input value={editForm.description || ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={submitEdit}>Update</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurring income dialog */}
      <Dialog open={recOpen} onOpenChange={setRecOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{recEditing ? "Edit Scheduled Income" : "Schedule Income"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1"><label className="text-sm font-medium">Title</label><Input value={recForm.title} onChange={(e) => setRecForm({ ...recForm, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-sm font-medium">Amount</label><Input type="number" step="0.01" value={recForm.amount} onChange={(e) => setRecForm({ ...recForm, amount: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Frequency</label><Select value={recForm.frequency} onValueChange={(v) => setRecForm({ ...recForm, frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MONTHLY">Monthly</SelectItem><SelectItem value="QUARTERLY">Quarterly</SelectItem><SelectItem value="YEARLY">Yearly</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><label className="text-sm font-medium">Next Date</label><Input type="date" value={recForm.next_date} onChange={(e) => setRecForm({ ...recForm, next_date: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Source</label><SourceSelect value={recForm.source} onChange={(v) => setRecForm({ ...recForm, source: v })} sources={sources} onAdded={(s) => setSources((prev) => [...prev, s])} canAdd={canModify} /></div>
              <div className="space-y-1 col-span-2"><label className="text-sm font-medium">Category</label><Select value={recForm.category} onValueChange={(v) => setRecForm({ ...recForm, category: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!recForm.auto_post} onChange={(e) => setRecForm({ ...recForm, auto_post: e.target.checked })} />
              Auto-post when due (the scheduled job records it automatically)
            </label>
            <DialogFooter><Button onClick={submitRec}>{recEditing ? "Update" : "Save"}</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* View */}
      {viewing && (
        <DetailDialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} title={viewing.title} subtitle={viewing.source_name}
          fields={[
            { label: "Amount", value: money(viewing.amount) }, { label: "Date", value: viewing.income_date },
            { label: "Source", value: viewing.source_name }, { label: "Category", value: viewing.category_name },
            { label: "Method", value: viewing.payment_method }, { label: "Financial Year", value: viewing.financial_year_name },
            { label: "Receipt", value: viewing.bill_document_url ? <a href={viewing.bill_document_url} target="_blank" rel="noopener noreferrer" className="text-blue-500">Open</a> : viewing.reference },
            { label: "Description", value: viewing.description, full: true },
          ]}
          footer={canModify && <div className="flex justify-end gap-2 pt-3"><Button variant="outline" onClick={() => { setViewing(null); openEdit(viewing); }}>Edit</Button></div>} />
      )}
    </div>
  );
}
