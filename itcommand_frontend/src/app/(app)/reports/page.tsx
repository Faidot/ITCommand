"use client";

import Link from "next/link";
import {
  TrendingUp, MonitorSmartphone, Headset, KeyRound, ShoppingCart,
  Building, Map, Network, UserPlus, BookOpen, Users, BarChart3, ArrowRight,
  ClipboardList,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { can } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";

const REPORTS = [
  { title: "Master Report", desc: "User-wise: assets, subscriptions & all linked data", href: "/reports/master", icon: ClipboardList, color: "text-primary", module: "users" },
  { title: "Financial", desc: "Budgets, spend & cash flow", href: "/reports/financial", icon: TrendingUp, color: "text-emerald-500", module: "finance" },
  { title: "Assets", desc: "Inventory, value & warranties", href: "/reports/assets", icon: MonitorSmartphone, color: "text-blue-500", module: "assets" },
  { title: "Helpdesk", desc: "Tickets, SLA & agents", href: "/reports/helpdesk", icon: Headset, color: "text-sky-500", module: "helpdesk" },
  { title: "Licenses", desc: "Software spend & seats", href: "/reports/licenses", icon: KeyRound, color: "text-amber-500", module: "licenses" },
  { title: "Procurement", desc: "Requests, approvals & spend", href: "/reports/procurement", icon: ShoppingCart, color: "text-indigo-500", module: "procurement" },
  { title: "Vendors", desc: "Contracts & payments", href: "/reports/vendors", icon: Building, color: "text-teal-500", module: "vendors" },
  { title: "Seating", desc: "Office occupancy", href: "/reports/seating", icon: Map, color: "text-rose-500", module: "seating" },
  { title: "Network", desc: "Devices & IP utilization", href: "/reports/network", icon: Network, color: "text-cyan-500", module: "network" },
  { title: "Onboarding", desc: "Progress & task completion", href: "/reports/onboarding", icon: UserPlus, color: "text-green-500", module: "onboarding" },
  { title: "Knowledge Base", desc: "Articles, views & feedback", href: "/reports/kb", icon: BookOpen, color: "text-orange-500", module: "kb" },
  { title: "People", desc: "Headcount, roles & departments", href: "/reports/users", icon: Users, color: "text-blue-500", module: "users" },
];

export default function ReportsHubPage() {
  const { user } = useAuthStore();
  const visible = REPORTS.filter((r) => can(user, "reports", "view") || can(user, r.module, "view"));

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="text-primary" /> Reports</h1>
        <p className="text-neutral-500">Detailed analytics and Excel exports across every module</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="group hover:shadow-md hover:border-primary/40 transition-all cursor-pointer h-full">
              <CardContent className="p-5 flex items-start gap-4">
                <div className={`shrink-0 rounded-lg bg-muted p-3 ${r.color}`}>
                  <r.icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{r.title}</h3>
                    <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="text-sm text-neutral-500 mt-0.5">{r.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
