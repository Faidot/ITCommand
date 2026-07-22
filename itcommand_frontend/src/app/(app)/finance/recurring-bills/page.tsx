"use client";

import { useEffect, useMemo, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReceiptText, Plus, CalendarCheck2, AlertTriangle, Clock, Wallet } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RowActions } from "@/components/finance/row-actions";
import { DetailDialog } from "@/components/finance/detail-dialog";
import { PaymentCalendar, CalEvent } from "@/components/finance/payment-calendar";
import { useMoney, useCurrencyCode } from "@/lib/currency";

const dayDiff = (s: string) => Math.ceil((new Date(s).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
const freqDays = (f: string) => (f === "YEARLY" ? 365 : f === "QUARTERLY" ? 90 : 30);
const monthly = (b: any) => { const a = parseFloat(b.amount || 0); return b.frequency === "YEARLY" ? a / 12 : b.frequency === "QUARTERLY" ? a / 3 : a; };
const addDays = (s: string, n: number) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };

export default function RecurringBillsPage() {
  const money = useMoney();
  const currencyCode = useCurrencyCode();
  const { user } = useAuthStore();
  const canModify = user?.role !== "VIEWER";

  const [bills, setBills] = useState<any[]>([]);
  const [paymentsByBill, setPaymentsByBill] = useState<Record<number, any[]>>({});
  const [vendors, setVendors] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [tab, setTab] = useState("ALL");

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);

  // Paid dialog (plain state — conditional fields)
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [payingBill, setPayingBill] = useState<any>(null);
  const [pay, setPay] = useState<any>({ amount_paid: "", paid_date: "", reference: "", paid_from: "IT", category: "", source: "" });

  const [autoPost, setAutoPost] = useState(false);
  const [autoPayFrom, setAutoPayFrom] = useState("COMPANY");

  const formSchema = z.object({ title: z.string(), vendor: z.string().optional(), amount: z.string(), frequency: z.string(), next_due_date: z.string(), category: z.string().optional(), payment_method: z.string().optional(), notes: z.string().optional() });
  const form = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema), defaultValues: { frequency: "MONTHLY" } });

  const fetchData = async () => {
    try {
      const [res, payRes, venRes, catRes, srcRes] = await Promise.all([
        api.get("/finance/recurring-bills/"), api.get("/finance/bill-payments/"),
        api.get("/vendors/"), api.get("/finance/categories/"), api.get("/finance/sources/?active=true"),
      ]);
      setBills(res.data);
      setVendors(venRes.data); setCategories(catRes.data); setSources(srcRes.data);
      const grouped: Record<number, any[]> = {};
      payRes.data.forEach((p: any) => { (grouped[p.recurring_bill] ||= []).push(p); });
      Object.values(grouped).forEach((arr) => arr.sort((a, b) => (a.paid_date < b.paid_date ? 1 : -1)));
      setPaymentsByBill(grouped);
    } catch { toast.error("Failed to load"); }
  };
  useEffect(() => { fetchData(); }, []);

  const statusOf = (b: any): "OVERDUE" | "DUE_SOON" | "UPCOMING" => { const d = dayDiff(b.next_due_date); return d < 0 ? "OVERDUE" : d <= 7 ? "DUE_SOON" : "UPCOMING"; };
  const stats = useMemo(() => ({
    overdue: bills.filter((b) => statusOf(b) === "OVERDUE"),
    dueSoon: bills.filter((b) => statusOf(b) === "DUE_SOON"),
    active: bills.length,
    monthlyTotal: bills.reduce((s, b) => s + monthly(b), 0),
  }), [bills]);
  const filtered = useMemo(() => bills.filter((b) => tab === "ALL" || statusOf(b) === tab), [bills, tab]);

  const openAdd = () => { setEditing(null); setAutoPost(false); setAutoPayFrom("COMPANY"); form.reset({ title: "", vendor: "", amount: "", frequency: "MONTHLY", next_due_date: "", category: "", payment_method: "", notes: "" }); setIsAddOpen(true); };
  const openEdit = (b: any) => { setEditing(b); setAutoPost(!!b.auto_post); setAutoPayFrom(b.auto_pay_from || "COMPANY"); form.reset({ title: b.title ?? "", vendor: b.vendor ? String(b.vendor) : "", amount: String(b.amount ?? ""), frequency: b.frequency ?? "MONTHLY", next_due_date: b.next_due_date ?? "", category: b.category ? String(b.category) : "", payment_method: b.payment_method ?? "", notes: b.notes ?? "" }); setIsAddOpen(true); };

  const onSubmit = async (vals: z.infer<typeof formSchema>) => {
    const payload: any = { ...vals, amount: parseFloat(vals.amount), vendor: vals.vendor ? parseInt(vals.vendor) : null, category: vals.category ? parseInt(vals.category) : null, auto_post: autoPost, auto_pay_from: autoPayFrom };
    try {
      if (editing) { await api.patch(`/finance/recurring-bills/${editing.id}/`, payload); toast.success("Updated"); }
      else { await api.post("/finance/recurring-bills/", payload); toast.success("Bill scheduled"); }
      setIsAddOpen(false); fetchData();
    } catch { toast.error("Error saving"); }
  };

  const openPay = (b: any) => { setPayingBill(b); setPay({ amount_paid: b.amount, paid_date: new Date().toISOString().split("T")[0], reference: "", paid_from: "IT", category: b.category ? String(b.category) : "", source: "" }); setIsPayOpen(true); };
  const submitPay = async () => {
    if (!pay.amount_paid || !pay.paid_date) { toast.error("Amount and date are required"); return; }
    const payload: any = {
      recurring_bill: payingBill.id, amount_paid: parseFloat(pay.amount_paid), paid_date: pay.paid_date,
      reference: pay.reference, paid_from: pay.paid_from,
    };
    if (pay.paid_from === "IT") { payload.category = pay.category ? parseInt(pay.category) : null; payload.source = pay.source ? parseInt(pay.source) : null; }
    try {
      await api.post("/finance/bill-payments/", payload);
      toast.success(pay.paid_from === "IT" ? "Paid from IT budget — expense recorded." : "Recorded as paid (company account) — no IT budget impact.");
      setIsPayOpen(false); fetchData();
    } catch { toast.error("Error recording payment"); }
  };

  const deleteBill = async (id: number) => { if (!confirm("Delete this recurring bill and its history?")) return; try { await api.delete(`/finance/recurring-bills/${id}/`); toast.success("Deleted"); fetchData(); } catch { toast.error("Delete failed"); } };

  const voidPayment = async (p: any) => {
    if (!confirm("Void this payment? Any linked IT expense will be removed and the due date rolled back one cycle.")) return;
    try {
      await api.delete(`/finance/bill-payments/${p.id}/`);
      toast.success("Payment voided");
      const updated = { ...viewing };
      await fetchData();
      setViewing(updated);
    } catch { toast.error("Void failed"); }
  };

  const statusBadge = (b: any) => { const s = statusOf(b), d = dayDiff(b.next_due_date); if (s === "OVERDUE") return <Badge variant="destructive">Overdue {Math.abs(d)}d</Badge>; if (s === "DUE_SOON") return <Badge className="bg-amber-500 hover:bg-amber-600 border-0">Due in {d}d</Badge>; return <Badge variant="secondary">In {d}d</Badge>; };

  const calendarEvents = (b: any): CalEvent[] => {
    const evs: CalEvent[] = [];
    (paymentsByBill[b.id] || []).forEach((p) => evs.push({ date: p.paid_date, label: `Paid ${money(p.amount_paid)}${p.paid_from === "COMPANY" ? " (company)" : " (IT)"}`, type: "paid" }));
    if (b.next_due_date) {
      evs.push({ date: b.next_due_date, label: `Due ${money(b.amount)}`, type: "due" });
      for (let k = 1; k <= 3; k++) evs.push({ date: addDays(b.next_due_date, freqDays(b.frequency) * k), label: `Projected ${money(b.amount)}`, type: "projected" });
    }
    return evs;
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ReceiptText className="text-purple-500" /> Recurring Bills</h1>
          <p className="text-neutral-500">Scheduled & recurring payments with due status, calendar and history</p>
        </div>
        {canModify && <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Schedule Bill</Button>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-red-500" /> Overdue</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-red-600">{stats.overdue.length}</div><div className="text-xs text-neutral-500">{money(stats.overdue.reduce((s, b) => s + parseFloat(b.amount || 0), 0))}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 flex items-center gap-1"><Clock className="w-4 h-4 text-amber-500" /> Due in 7 days</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-amber-600">{stats.dueSoon.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 flex items-center gap-1"><ReceiptText className="w-4 h-4" /> Active</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{stats.active}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 flex items-center gap-1"><Wallet className="w-4 h-4" /> Est. Monthly</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{money(stats.monthlyTotal)}</div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="ALL">All</TabsTrigger><TabsTrigger value="OVERDUE">Overdue</TabsTrigger><TabsTrigger value="DUE_SOON">Due Soon</TabsTrigger><TabsTrigger value="UPCOMING">Upcoming</TabsTrigger></TabsList>
      </Tabs>

      <div className="bg-white dark:bg-neutral-900 rounded-xl border overflow-hidden">
        <Table>
          <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Vendor</TableHead><TableHead>Category</TableHead><TableHead>Frequency</TableHead><TableHead>Next Due</TableHead><TableHead>Status</TableHead><TableHead>Last Paid</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-neutral-400 py-8">No bills in this view</TableCell></TableRow>}
            {filtered.map((b) => {
              const last = paymentsByBill[b.id]?.[0];
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-medium cursor-pointer" onClick={() => setViewing(b)}>{b.title}</TableCell>
                  <TableCell>{vendors.find((v) => v.id === b.vendor)?.name || "—"}</TableCell>
                  <TableCell>{b.category_name || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{b.frequency}</Badge></TableCell>
                  <TableCell>{b.next_due_date}</TableCell>
                  <TableCell>{statusBadge(b)}</TableCell>
                  <TableCell className="text-sm text-neutral-500">{last ? `${last.paid_date} (${money(last.amount_paid)})` : "—"}</TableCell>
                  <TableCell className="text-right font-bold">{money(b.amount)}</TableCell>
                  <TableCell><div className="flex items-center justify-end gap-1">
                    {canModify && <Button size="sm" variant="secondary" onClick={() => openPay(b)}><CalendarCheck2 className="w-4 h-4" /></Button>}
                    <RowActions canModify={canModify} onView={() => setViewing(b)} onEdit={() => openEdit(b)} onDelete={() => deleteBill(b.id)} />
                  </div></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Add / Edit */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Recurring Bill" : "Schedule Recurring Bill"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="vendor" render={({ field }) => (<FormItem><FormLabel>Vendor</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl><SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent></Select></FormItem>)} />
                <FormField control={form.control} name="category" render={({ field }) => (<FormItem><FormLabel>Category</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></FormItem>)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="amount" render={({ field }) => <FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>} />
                <FormField control={form.control} name="frequency" render={({ field }) => (<FormItem><FormLabel>Frequency</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="MONTHLY">Monthly</SelectItem><SelectItem value="QUARTERLY">Quarterly</SelectItem><SelectItem value="YEARLY">Yearly</SelectItem></SelectContent></Select></FormItem>)} />
              </div>
              <FormField control={form.control} name="next_due_date" render={({ field }) => <FormItem><FormLabel>Next Due Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="payment_method" render={({ field }) => <FormItem><FormLabel>Payment Method (Opt)</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="notes" render={({ field }) => <FormItem><FormLabel>Notes (Opt)</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <div className="rounded-lg border p-3 space-y-2 bg-neutral-50 dark:bg-neutral-900/40">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />
                  Auto-post when due (scheduled job records the payment)
                </label>
                {autoPost && (
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-500">Auto-pay from</label>
                    <Select value={autoPayFrom} onValueChange={setAutoPayFrom}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="COMPANY">Company accounts (no IT budget hit)</SelectItem><SelectItem value="IT">IT budget (creates an expense)</SelectItem></SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter><Button type="submit">{editing ? "Update" : "Save"}</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Paid dialog */}
      <Dialog open={isPayOpen} onOpenChange={setIsPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment: {payingBill?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border p-3 space-y-2 bg-neutral-50 dark:bg-neutral-900/40">
              <label className="text-sm font-medium">Paid directly from company accounts?</label>
              <div className="flex gap-2">
                <Button type="button" variant={pay.paid_from === "COMPANY" ? "default" : "outline"} className="flex-1" onClick={() => setPay({ ...pay, paid_from: "COMPANY" })}>Yes — Company</Button>
                <Button type="button" variant={pay.paid_from === "IT" ? "default" : "outline"} className="flex-1" onClick={() => setPay({ ...pay, paid_from: "IT" })}>No — From IT Budget</Button>
              </div>
              <p className="text-xs text-neutral-500">{pay.paid_from === "COMPANY" ? "Recorded as paid only — does NOT reduce the IT budget." : "Creates an IT expense and reduces the IT budget."}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-sm font-medium">Amount Paid</label><Input type="number" step="0.01" value={pay.amount_paid} onChange={(e) => setPay({ ...pay, amount_paid: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Date Paid</label><Input type="date" value={pay.paid_date} onChange={(e) => setPay({ ...pay, paid_date: e.target.value })} /></div>
            </div>
            {pay.paid_from === "IT" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-sm font-medium">Budget Category</label><Select value={pay.category} onValueChange={(v) => setPay({ ...pay, category: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><label className="text-sm font-medium">Source</label><Select value={pay.source} onValueChange={(v) => setPay({ ...pay, source: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{sources.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent></Select></div>
              </div>
            )}
            <div className="space-y-1"><label className="text-sm font-medium">Reference (Opt)</label><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
            <DialogFooter><Button onClick={submitPay}>Record Payment</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* View detail with calendar + history */}
      {viewing && (
        <DetailDialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} title={viewing.title} subtitle={viewing.frequency}
          fields={[
            { label: "Amount", value: money(viewing.amount) }, { label: "Next Due", value: viewing.next_due_date },
            { label: "Vendor", value: vendors.find((v) => v.id === viewing.vendor)?.name }, { label: "Category", value: viewing.category_name },
            { label: "Status", value: statusBadge(viewing) }, { label: "Active", value: viewing.is_active ? "Yes" : "No" },
            { label: "Notes", value: viewing.notes, full: true },
            {
              label: "Payment History", full: true,
              value: (paymentsByBill[viewing.id]?.length ?? 0) === 0 ? "No payments yet" : (
                <div className="space-y-1 mt-1">
                  {paymentsByBill[viewing.id].map((p) => (
                    <div key={p.id} className="flex justify-between items-center text-sm border-b last:border-0 py-1">
                      <span>{p.paid_date}</span>
                      <Badge variant="outline" className="text-[10px]">{p.paid_from === "COMPANY" ? "Company" : "IT"}</Badge>
                      <span className="font-medium">${p.amount_paid}</span>
                      {canModify && <Button variant="ghost" size="sm" className="h-6 text-red-500" onClick={() => voidPayment(p)}>Void</Button>}
                    </div>
                  ))}
                </div>
              ),
            },
            { label: "Schedule & Timeline", full: true, value: <PaymentCalendar events={calendarEvents(viewing)} /> },
          ]}
          footer={canModify && <div className="flex justify-end gap-2 pt-3"><Button variant="secondary" onClick={() => { setViewing(null); openPay(viewing); }}>Record Payment</Button><Button variant="outline" onClick={() => { setViewing(null); openEdit(viewing); }}>Edit</Button></div>} />
      )}
    </div>
  );
}
