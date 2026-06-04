"use client";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileSpreadsheet, Plus, CalendarCheck2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function RecurringBillsPage() {
  const { user } = useAuthStore();
  const [bills, setBills] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [payingBill, setPayingBill] = useState<any>(null);

  const formSchema = z.object({ title: z.string(), vendor: z.string(), amount: z.string(), frequency: z.string(), next_due_date: z.string() });
  const form = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema), defaultValues: {frequency: 'MONTHLY'} });

  const payFormSchema = z.object({ amount_paid: z.string(), paid_date: z.string(), reference: z.string().optional() });
  const payForm = useForm<z.infer<typeof payFormSchema>>({ resolver: zodResolver(payFormSchema) });

  const fetchData = async () => {
    try {
      const res = await api.get('/finance/recurring-bills/');
      setBills(res.data);
    } catch { toast.error("Failed to load"); }
  };

  useEffect(() => { fetchData(); }, []);

  const onSubmit = async (vals: z.infer<typeof formSchema>) => {
    try {
      await api.post('/finance/recurring-bills/', { ...vals, amount: parseFloat(vals.amount) });
      toast.success("Bill scheduled");
      setIsAddOpen(false);
      fetchData();
    } catch { toast.error("Error"); }
  };

  const onPay = async (vals: z.infer<typeof payFormSchema>) => {
    try {
      await api.post('/finance/bill-payments/', { recurring_bill: payingBill.id, ...vals, amount_paid: parseFloat(vals.amount_paid) });
      toast.success("Payment recorded and next due date updated.");
      setIsPayOpen(false);
      fetchData();
    } catch { toast.error("Error"); }
  };

  const getUrgency = (dateStr: string) => {
    const due = new Date(dateStr);
    const diff = Math.ceil((due.getTime() - new Date().getTime()) / (1000*3600*24));
    if (diff < 0) return <Badge variant="destructive">Overdue</Badge>;
    if (diff <= 7) return <Badge className="bg-red-500 hover:bg-red-600 border-0">Due in {diff} days</Badge>;
    if (diff <= 30) return <Badge className="bg-amber-500 hover:bg-amber-600 border-0">Due in {diff} days</Badge>;
    return <Badge variant="secondary">Due in {diff} days</Badge>;
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileSpreadsheet className="text-purple-500" /> Recurring Bills</h1>
          <p className="text-neutral-500">Subscriptions and fixed operational costs</p>
        </div>
        {user?.role !== "VIEWER" && <Button onClick={() => setIsAddOpen(true)}><Plus className="w-4 h-4 mr-2" /> Schedule Bill</Button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {bills.map(b => (
          <Card key={b.id}>
            <CardHeader className="pb-2">
              <div className="flex justify-between">
                <CardTitle className="text-base">{b.title}</CardTitle>
                <Badge variant="outline">{b.frequency}</Badge>
              </div>
              <p className="text-sm text-neutral-500">{b.vendor}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-bold">${b.amount}</div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-neutral-500">Due {b.next_due_date}</span>
                {getUrgency(b.next_due_date)}
              </div>
            </CardContent>
            <CardFooter className="pt-2 border-t mt-2">
              {user?.role !== "VIEWER" && <Button variant="secondary" className="w-full" onClick={() => { setPayingBill(b); payForm.reset({amount_paid: b.amount, paid_date: new Date().toISOString().split('T')[0]}); setIsPayOpen(true); }}>
                <CalendarCheck2 className="w-4 h-4 mr-2" /> Mark as Paid
              </Button>}
            </CardFooter>
          </Card>
        ))}
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Recurring Bill</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({field}) => <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="vendor" render={({field}) => <FormItem><FormLabel>Vendor</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="amount" render={({field}) => <FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="frequency" render={({field}) => (
                  <FormItem><FormLabel>Frequency</FormLabel><Select onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="MONTHLY">Monthly</SelectItem><SelectItem value="QUARTERLY">Quarterly</SelectItem><SelectItem value="YEARLY">Yearly</SelectItem></SelectContent></Select></FormItem>
              )} />
              <FormField control={form.control} name="next_due_date" render={({field}) => <FormItem><FormLabel>First Due Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>} />
              <DialogFooter><Button type="submit">Save</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isPayOpen} onOpenChange={setIsPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay Bill: {payingBill?.title}</DialogTitle></DialogHeader>
          <Form {...payForm}>
            <form onSubmit={payForm.handleSubmit(onPay)} className="space-y-4">
              <FormField control={payForm.control} name="amount_paid" render={({field}) => <FormItem><FormLabel>Amount Paid</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>} />
              <FormField control={payForm.control} name="paid_date" render={({field}) => <FormItem><FormLabel>Date Paid</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>} />
              <FormField control={payForm.control} name="reference" render={({field}) => <FormItem><FormLabel>Reference (Opt)</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <DialogFooter><Button type="submit">Record Payment</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
