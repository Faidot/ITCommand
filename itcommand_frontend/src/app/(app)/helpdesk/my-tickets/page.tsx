"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ListTodo,
  Plus,
  AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0",
  IN_PROGRESS: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 border-0",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0",
  RESOLVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0",
  CLOSED: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 border-0",
};

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-0",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-0",
  LOW: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0",
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MyTicketsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMyTickets = useCallback(async () => {
    try {
      setLoading(true);
      // For VIEWER role, the backend already filters to their own tickets
      // For staff, we filter by requester=current user
      const params = user?.role === "VIEWER" ? "" : `?requester=${user?.id}`;
      const res = await api.get(`/helpdesk/tickets/${params}`);
      setTickets(res.data.results || res.data);
    } catch {
      toast.error("Failed to load your tickets");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchMyTickets();
  }, [fetchMyTickets, user]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListTodo className="h-6 w-6 text-violet-500" /> My Tickets
          </h1>
          <p className="text-neutral-500">Track tickets you&apos;ve submitted</p>
        </div>
        <Button
          onClick={() => router.push("/helpdesk/tickets?new=1")}
          className="bg-violet-600 hover:bg-violet-700"
        >
          <Plus className="mr-2 h-4 w-4" /> New Ticket
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
        </div>
      ) : (
        <Card className="overflow-hidden bg-white dark:bg-neutral-900">
          <Table>
            <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
              <TableRow>
                <TableHead>Ticket #</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-16 text-neutral-400">
                    You haven&apos;t submitted any tickets yet.
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((t: any) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                    onClick={() => router.push(`/helpdesk/tickets/${t.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm text-violet-600 dark:text-violet-400 font-medium">
                          {t.ticket_number}
                        </span>
                        {t.is_overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-sm">{t.title}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[t.status] + " text-[10px]"}>
                        {t.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={PRIORITY_BADGE[t.priority] + " text-[10px]"}>
                        {t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-neutral-500">{formatDate(t.created_at)}</TableCell>
                    <TableCell className="text-sm text-neutral-500">{formatDate(t.updated_at)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
