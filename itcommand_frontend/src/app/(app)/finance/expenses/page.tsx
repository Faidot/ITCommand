"use client";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Receipt, Plus, Trash2 } from "lucide-react";
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

export default function ExpensesPage() {
  const { user } = useAuthStore();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  
  const [isOpen, setIsOpen] = useState(false);

  const formSchema = z.object({
    title: z.string().min(2),
    amount: z.string(),
    expense_date: z.string(),
    category: z.string(),
    financial_year: z.string(),
    payment_method: z.string(),
    paid_to: z.string(),
    receipt_number: z.string().optional(),
    description: z.string().optional()
  });

  const form = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema) });

  const fetchData = async () => {
    try {
      const [expRes, catRes, yrRes] = await Promise.all([
        api.get('/finance/expenses/'),
        api.get('/finance/categories/'),
        api.get('/finance/years/')
      ]);
      setExpenses(expRes.data);
      setCategories(catRes.data);
      setYears(yrRes.data);
    } catch { toast.error("Failed to load"); }
  };

  useEffect(() => { fetchData(); }, []);

  const onSubmit = async (vals: z.infer<typeof formSchema>) => {
    try {
      await api.post('/finance/expenses/', { ...vals, amount: parseFloat(vals.amount), category: parseInt(vals.category), financial_year: parseInt(vals.financial_year) });
      toast.success("Expense recorded");
      setIsOpen(false);
      fetchData();
    } catch { toast.error("Error recording expense"); }
  };

  const deleteExp = async(id:number) => {
    await api.delete(`/finance/expenses/${id}/`);
    fetchData();
  }

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="text-rose-500" /> Expenses</h1>
          <p className="text-neutral-500">Track day-to-day IT spending</p>
        </div>
        {user?.role !== "VIEWER" && <Button onClick={() => setIsOpen(true)}><Plus className="w-4 h-4 mr-2" /> Log Expense</Button>}
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Paid To</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map(e => (
              <TableRow key={e.id}>
                <TableCell>{e.expense_date}</TableCell>
                <TableCell className="font-medium">{e.title}</TableCell>
                <TableCell>{e.category_name}</TableCell>
                <TableCell>{e.paid_to}</TableCell>
                <TableCell><Badge variant="outline">{e.payment_method}</Badge></TableCell>
                <TableCell className="text-right font-bold">${e.amount}</TableCell>
                <TableCell>{user?.role !== "VIEWER" && <Button variant="ghost" size="icon" className="text-red-500" onClick={()=>deleteExp(e.id)}><Trash2 className="w-4 h-4"/></Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Log Expense</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="title" render={({field}) => <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
                <FormField control={form.control} name="amount" render={({field}) => <FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>} />
                <FormField control={form.control} name="expense_date" render={({field}) => <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>} />
                <FormField control={form.control} name="paid_to" render={({field}) => <FormItem><FormLabel>Paid To</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
                
                <FormField control={form.control} name="category" render={({field}) => (
                  <FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{categories.map(c=><SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent></Select></FormItem>
                )} />
                <FormField control={form.control} name="financial_year" render={({field}) => (
                  <FormItem><FormLabel>Financial Year</FormLabel><Select onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{years.map(y=><SelectItem key={y.id} value={y.id.toString()}>{y.name}</SelectItem>)}</SelectContent></Select></FormItem>
                )} />
                <FormField control={form.control} name="payment_method" render={({field}) => (
                  <FormItem><FormLabel>Method</FormLabel><Select onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="PETTY_CASH">Petty Cash</SelectItem><SelectItem value="CARD">Card</SelectItem><SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem><SelectItem value="CHEQUE">Cheque</SelectItem></SelectContent></Select></FormItem>
                )} />
                <FormField control={form.control} name="receipt_number" render={({field}) => <FormItem><FormLabel>Receipt #</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              </div>
              <DialogFooter><Button type="submit">Save</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
