"use client";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PiggyBank, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PettyCashPage() {
  const { user } = useAuthStore();
  const [txs, setTxs] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  
  const [isTopupOpen, setIsTopupOpen] = useState(false);
  const [isExpOpen, setIsExpOpen] = useState(false);

  const formSchema = z.object({ amount: z.string(), description: z.string(), date: z.string(), reference: z.string().optional() });
  const form = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema) });

  const fetchData = async () => {
    try {
      const [txRes, dashRes] = await Promise.all([ api.get('/finance/petty-cash/'), api.get('/finance/dashboard/') ]);
      setTxs(txRes.data);
      setBalance(dashRes.data.petty_cash_balance);
    } catch { toast.error("Failed to load"); }
  };

  useEffect(() => { fetchData(); }, []);

  const onSubmit = async (vals: z.infer<typeof formSchema>, type: string) => {
    try {
      await api.post('/finance/petty-cash/', { ...vals, amount: parseFloat(vals.amount), transaction_type: type });
      toast.success("Transaction recorded");
      setIsTopupOpen(false); setIsExpOpen(false);
      fetchData();
    } catch { toast.error("Error recording"); }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><PiggyBank className="text-pink-500" /> Petty Cash</h1>
          <p className="text-neutral-500">Manage cash on hand</p>
        </div>
        <div className="flex gap-2">
          {user?.role !== "VIEWER" && <Button variant="outline" className="text-emerald-600" onClick={() => setIsTopupOpen(true)}><Plus className="w-4 h-4 mr-2" /> Top-Up</Button>}
          {user?.role !== "VIEWER" && <Button variant="outline" className="text-red-600" onClick={() => setIsExpOpen(true)}><Minus className="w-4 h-4 mr-2" /> Expense</Button>}
        </div>
      </div>

      <Card className="bg-gradient-to-br from-neutral-900 to-neutral-800 text-white">
        <CardContent className="pt-6">
          <p className="text-neutral-400">Current Balance</p>
          <p className="text-5xl font-bold mt-2">${balance.toFixed(2)}</p>
        </CardContent>
      </Card>

      <div className="bg-white dark:bg-neutral-900 rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {txs.map(t => (
              <TableRow key={t.id}>
                <TableCell>{t.date}</TableCell>
                <TableCell><Badge variant={t.transaction_type === 'TOPUP' ? 'default' : 'destructive'}>{t.transaction_type}</Badge></TableCell>
                <TableCell>{t.description}</TableCell>
                <TableCell>{t.reference}</TableCell>
                <TableCell className={`text-right font-bold ${t.transaction_type === 'TOPUP' ? 'text-emerald-500' : 'text-red-500'}`}>
                  {t.transaction_type === 'TOPUP' ? '+' : '-'}${t.amount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isTopupOpen || isExpOpen} onOpenChange={(o) => {if(!o){setIsTopupOpen(false); setIsExpOpen(false)}}}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isTopupOpen ? 'Record Top-Up' : 'Record Expense'}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(v => onSubmit(v, isTopupOpen ? 'TOPUP' : 'EXPENSE'))} className="space-y-4">
              <FormField control={form.control} name="amount" render={({field}) => <FormItem><FormLabel>Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="description" render={({field}) => <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="date" render={({field}) => <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>} />
              <FormField control={form.control} name="reference" render={({field}) => <FormItem><FormLabel>Reference (Opt)</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>} />
              <DialogFooter><Button type="submit">Save</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
