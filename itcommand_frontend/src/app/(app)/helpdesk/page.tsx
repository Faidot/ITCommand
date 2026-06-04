"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Headset,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Loader2,
  Timer,
  TrendingUp,
  ArrowRight,
  CircleDot,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#22c55e",
};

const SLA_BADGE: Record<string, { cls: string; label: string }> = {
  ON_TRACK: { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0", label: "On Track" },
  AT_RISK: { cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0", label: "At Risk" },
  BREACHED: { cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0", label: "Breached" },
};

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0",
  IN_PROGRESS: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 border-0",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0",
  RESOLVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0",
  CLOSED: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 border-0",
};

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-0",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-0",
  LOW: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0",
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function HelpdeskDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await api.get("/helpdesk/dashboard/");
        setData(res.data);
      } catch {
        toast.error("Failed to load helpdesk dashboard");
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!data) return null;

  const sc = data.status_counts;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Headset className="h-6 w-6 text-violet-500" /> Helpdesk Dashboard
          </h1>
          <p className="text-neutral-500">Overview of IT support tickets and SLA performance</p>
        </div>
        <Button onClick={() => router.push("/helpdesk/tickets?new=1")} className="bg-violet-600 hover:bg-violet-700">
          + New Ticket
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Open</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{sc.open}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-violet-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-violet-600 dark:text-violet-400">{sc.in_progress}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{sc.pending}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-1">
              Overdue <AlertTriangle className="h-3 w-3 text-red-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">{data.overdue_count}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Resolved Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{data.resolved_today}</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar Chart: Tickets by Category */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-5 w-5 text-violet-500" /> Tickets by Category
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.tickets_by_category}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <RechartsTooltip />
                <Bar dataKey="count" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pie Chart: Tickets by Priority */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDot className="h-5 w-5 text-orange-500" /> By Priority
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.tickets_by_priority}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, value }) => value > 0 ? `${name}: ${value}` : ''}
                >
                  {data.tickets_by_priority.map((entry: any, idx: number) => (
                    <Cell key={idx} fill={PRIORITY_COLORS[entry.name] || "#94a3b8"} />
                  ))}
                </Pie>
                <Legend />
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Avg Resolution + Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Avg Resolution Card */}
        <Card className="lg:col-span-3 flex flex-col items-center justify-center py-8">
          <Timer className="h-10 w-10 text-violet-500 mb-3" />
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Avg Resolution Time</p>
          <p className="text-4xl font-bold text-neutral-900 dark:text-white">
            {data.avg_resolution_time_hours !== null ? `${data.avg_resolution_time_hours}h` : "N/A"}
          </p>
          <p className="text-xs text-neutral-400 mt-1">Last 30 days</p>
        </Card>

        {/* My Assigned Tickets */}
        <Card className="lg:col-span-4.5 lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-violet-500" /> My Assigned Tickets
              </span>
              <Button variant="ghost" size="sm" onClick={() => router.push("/helpdesk/tickets?assigned_to=me")} className="text-xs">
                View All <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {data.my_open_tickets.length === 0 ? (
                <p className="text-neutral-400 text-sm text-center py-8">No assigned tickets</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Ticket</TableHead>
                      <TableHead className="text-xs">Priority</TableHead>
                      <TableHead className="text-xs">SLA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.my_open_tickets.map((t: any) => (
                      <TableRow key={t.id} className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800" onClick={() => router.push(`/helpdesk/tickets/${t.id}`)}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs text-violet-600">{t.ticket_number}</span>
                            <span className="text-sm font-medium truncate max-w-[160px]">{t.title}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={PRIORITY_BADGE[t.priority] + " text-[10px]"}>{t.priority}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={SLA_BADGE[t.sla_status]?.cls + " text-[10px]"}>{SLA_BADGE[t.sla_status]?.label}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recently Opened */}
        <Card className="lg:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Recently Opened
              </span>
              <Button variant="ghost" size="sm" onClick={() => router.push("/helpdesk/tickets")} className="text-xs">
                View All <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {data.recent_tickets.length === 0 ? (
                <p className="text-neutral-400 text-sm text-center py-8">No tickets yet</p>
              ) : (
                <div className="space-y-3">
                  {data.recent_tickets.map((t: any) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/helpdesk/tickets/${t.id}`)}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-mono text-[10px] text-neutral-400">{t.ticket_number}</span>
                        <span className="text-sm font-medium truncate">{t.title}</span>
                        <span className="text-[10px] text-neutral-400">{t.requester_name} · {formatDate(t.created_at)}</span>
                      </div>
                      <Badge className={STATUS_BADGE[t.status] + " text-[10px] ml-2 shrink-0"}>
                        {t.status.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
