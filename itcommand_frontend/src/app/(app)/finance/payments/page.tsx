"use client";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export default function PaymentsPage() {
  const { user } = useAuthStore();
  const [payments, setPayments] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const formSchema = z.object({ title: z.string(), amount: z.string(), payment_date: z.string(), paid_to: z.string(), payment_method: z.string(), bank_reference: z.string().optional() });
  const form = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema), defaultValues: {payment_method: 'BANK_TRANSFER'} });

  const fetchData = async () => {
    try {
      const res = await api.get('/finance/direct-payments/');
      setPayments(res.data);
    } catch { toast.error("Failed to load"); }
  };

  useEffect(() => { fetchData(); }, []);

  const onSubmit = async (vals: z.infer<typeof formSchema>) => {
    try {
      await api.post('/finance/direct-payments/', { ...vals, amount: parseFloat(vals.amount) });
      toast.success("Payment recorded");
      setIsOpen(false);
      fetchData();
    } catch { toast.error("Error"); }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Banknote className="text-blue-500" /> Direct Payments</h1>
          <p className="text-neutral-500">Record one-off wire transfers and cheques</p>
        </div>
        {user?.role !== "VIEWER" && <Button onClick={() => setIsOpen(true)}><Plus className="w-4 h-4 mr-2" /> Record Payment</Button>}
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Paid To</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map(p => (
              <TableRow key={p.id}>
                <TableCell>{p.payment_date}</TableCell>
                <TableCell className="font-medium">{p.title}</TableCell>
                <TableCell>{p.paid_to}</TableCell>
                <TableCell><Badge variant="outline">{p.payment_method}</Badge></TableCell>
                <TableCell>{p.bank_reference}</TableCell>
                <TableCell className="text-right font-bold">${p.amount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({field}) => <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="paid_to" render={({field}) => <FormItem><FormLabel>Paid To</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="amount" render={({field}) => <FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="payment_date" render={({field}) => <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="payment_method" render={({field}) => (
                  <FormItem><FormLabel>Method</FormLabel><Select onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem><SelectItem value="CHEQUE">Cheque</SelectItem><SelectItem value="CARD">Card</SelectItem></SelectContent></Select></FormItem>
              )} />
              <FormField control={form.control} name="bank_reference" render={({field}) => <FormItem><FormLabel>Reference</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <DialogFooter><Button type="submit">Save</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
