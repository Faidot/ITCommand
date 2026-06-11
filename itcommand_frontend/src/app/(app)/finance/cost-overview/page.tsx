"use client";

import { useEffect, useState } from "react";
import { ChartBar, TrendingUp, TrendingDown, Boxes, KeyRound, ShoppingCart, Wallet } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CostOverviewPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get("/finance/cost-overview/").then((r) => setData(r.data)).catch(() => toast.error("Failed to load cost overview"));
  }, []);

  if (!data) return <div className="p-8 text-center text-neutral-400">Loading…</div>;

  const maxModule = Math.max(1, ...data.modules.map((m: any) => m.amount));
  const moduleIcon: Record<string, any> = {
    "Expenses (booked)": Wallet, "Assets (purchase)": Boxes, "Licenses": KeyRound, "Procurement (actual)": ShoppingCart,
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ChartBar className="text-indigo-500" /> IT Cost Overview</h1>
        <p className="text-neutral-500">Aggregated IT spend across finance and linked modules{data.financial_year ? ` · ${data.financial_year}` : ""}</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 flex items-center gap-1"><TrendingUp className="w-4 h-4 text-emerald-500" /> Income</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-emerald-600">{money(data.total_income)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500 flex items-center gap-1"><TrendingDown className="w-4 h-4 text-rose-500" /> Expenses</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-rose-600">{money(data.total_expenses)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Budget Remaining</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{money(data.remaining_budget)}</div><div className="text-xs text-neutral-500">of {money(data.total_budget)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-neutral-500">Net Cash Flow</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${data.net_cash_flow >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{money(data.net_cash_flow)}</div></CardContent></Card>
      </div>

      {/* Total cost of ownership across modules */}
      <Card>
        <CardHeader><CardTitle className="text-base">Total IT Cost by Module</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="text-3xl font-bold mb-2">{money(data.grand_total_cost)}<span className="text-sm font-normal text-neutral-500"> total cost of ownership</span></div>
          {data.modules.map((m: any) => {
            const Icon = moduleIcon[m.module] || Wallet;
            const pct = (m.amount / maxModule) * 100;
            return (
              <div key={m.module} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2"><Icon className="w-4 h-4 text-neutral-400" /> {m.module}</span>
                  <span className="font-semibold">{money(m.amount)}</span>
                </div>
                <div className="w-full h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-neutral-500 pt-1">Procurement estimated (in pipeline): {money(data.procurement_estimated)}</p>
        </CardContent>
      </Card>

      {/* Booked spend by category */}
      <Card>
        <CardHeader><CardTitle className="text-base">Booked Spend by Category</CardTitle></CardHeader>
        <CardContent>
          {data.by_category.length === 0 ? (
            <p className="text-sm text-neutral-400">No categorized spend yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.by_category.map((c: any) => (
                <div key={c.category} className="flex justify-between items-center border rounded-lg p-3">
                  <span className="text-sm font-medium">{c.category}</span>
                  <span className="font-bold">{money(c.spent)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-neutral-400">Asset, license and procurement figures are pulled live from those modules (read-only). Link an individual expense to an asset/license/PR from the Expenses page.</p>
    </div>
  );
}
