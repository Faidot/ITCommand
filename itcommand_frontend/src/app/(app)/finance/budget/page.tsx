"use client";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Wallet, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BudgetPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [years, setYears] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [dashboardData, setDashboardData] = useState<any>(null);
  
  const [isAddOpen, setIsAddOpen] = useState(false);

  const formSchema = z.object({
    category: z.string().min(1, "Required"),
    allocated_amount: z.string().min(1, "Required"),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { category: "", allocated_amount: "" }
  });

  const fetchDependencies = async () => {
    try {
      const [yrRes, catRes] = await Promise.all([
        api.get('/finance/years/'),
        api.get('/finance/categories/')
      ]);
      setYears(yrRes.data);
      setCategories(catRes.data);
      if (yrRes.data.length > 0) {
        const active = yrRes.data.find((y: any) => y.is_active) || yrRes.data[0];
        setSelectedYear(active.id.toString());
      }
    } catch (e) {
      toast.error("Failed to load dependencies");
    }
  };

  const fetchDashboard = async () => {
    try {
      const res = await api.get('/finance/dashboard/');
      setDashboardData(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchDependencies();
    fetchDashboard();
  }, []);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      await api.post('/finance/budgets/', {
        financial_year: parseInt(selectedYear),
        category: parseInt(values.category),
        allocated_amount: parseFloat(values.allocated_amount)
      });
      toast.success("Budget allocated successfully");
      setIsAddOpen(false);
      fetchDashboard();
    } catch (e: any) {
      toast.error(e.response?.data?.non_field_errors?.[0] || "Failed to allocate budget");
    }
  };

  if (!isAdmin) return <div className="p-8 text-center text-red-500">Access Denied</div>;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="w-6 h-6 text-indigo-600" /> IT Budget
          </h1>
          <p className="text-neutral-500">Manage financial year allocations</p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[180px] bg-white dark:bg-neutral-900">
              <SelectValue placeholder="Financial Year" />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y.id} value={y.id.toString()}>{y.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {user?.role !== "VIEWER" && <Button onClick={() => setIsAddOpen(true)}><Plus className="w-4 h-4 mr-2" /> Add Allocation</Button>}
        </div>
      </div>

      {dashboardData && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Budget</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold">${dashboardData.total_budget.toFixed(2)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Total Spent</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold text-red-600">${dashboardData.total_spent.toFixed(2)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Remaining</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold text-emerald-600">${dashboardData.remaining_budget.toFixed(2)}</div></CardContent>
            </Card>
          </div>

          <h3 className="text-lg font-semibold mt-4">Category Allocations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dashboardData.spent_by_category.map((cat: any) => {
              const pct = cat.allocated > 0 ? (cat.spent / cat.allocated) * 100 : 0;
              return (
                <Card key={cat.category_id}>
                  <CardContent className="pt-6">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold">{cat.category_name}</span>
                      <span className="text-sm text-neutral-500">${cat.spent.toFixed(0)} / ${cat.allocated.toFixed(0)}</span>
                    </div>
                    <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
                      <div className={`h-full ${pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{width: `${Math.min(pct, 100)}%`}}></div>
                    </div>
                    <div className="mt-2 text-xs text-neutral-500 text-right">${cat.remaining.toFixed(2)} remaining</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Allocate Budget</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="category" render={({field}) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger></FormControl>
                    <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="allocated_amount" render={({field}) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter><Button type="submit">Allocate</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
