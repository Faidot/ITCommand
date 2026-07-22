"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Search, Plus, Filter } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMoney, useCurrencyCode } from "@/lib/currency";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-neutral-100 text-neutral-700 border-neutral-200",
  SUBMITTED: "bg-blue-100 text-blue-800 border-blue-200",
  UNDER_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  ORDERED: "bg-purple-100 text-purple-800 border-purple-200",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-800 border-amber-200",
  RECEIVED: "bg-teal-100 text-teal-800 border-teal-200",
  CANCELLED: "bg-neutral-200 text-neutral-500 border-neutral-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "bg-neutral-100 text-neutral-600",
  NORMAL: "bg-blue-50 text-blue-600",
  URGENT: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
};

export default function ProcurementRequestsPage() {
  const money = useMoney();
  const router = useRouter();
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");

  useEffect(() => {
    const handler = setTimeout(() => fetchPRs(), 300);
    return () => clearTimeout(handler);
  }, [searchQuery, statusFilter, priorityFilter]);

  const fetchPRs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (priorityFilter !== "ALL") params.append("priority", priorityFilter);
      const res = await api.get(`/procurement/requests/?${params.toString()}`);
      setPrs(res.data.results || res.data);
    } catch {
      toast.error("Failed to load purchase requests");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => money(amount, { decimals: 0 });

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-violet-500" /> Purchase Requests
          </h1>
          <p className="text-neutral-500">Create, track, and manage procurement requests.</p>
        </div>
        <Button onClick={() => router.push("/procurement/requests/new")} className="bg-violet-600 hover:bg-violet-700">
          <Plus className="mr-2 h-4 w-4" /> New Purchase Request
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500" />
          <Input placeholder="Search by PR#, title..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SUBMITTED">Submitted</SelectItem>
            <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="ORDERED">Ordered</SelectItem>
            <SelectItem value="PARTIALLY_RECEIVED">Partially Received</SelectItem>
            <SelectItem value="RECEIVED">Received</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Priority</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
            <SelectItem value="NORMAL">Normal</SelectItem>
            <SelectItem value="URGENT">Urgent</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
            <TableRow>
              <TableHead>PR #</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Requested By</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Items</TableHead>
              <TableHead className="text-right">Est. Cost</TableHead>
              <TableHead>Required By</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-10 text-neutral-500">Loading...</TableCell></TableRow>
            ) : prs.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-10 text-neutral-500">No purchase requests found.</TableCell></TableRow>
            ) : (
              prs.map((pr) => (
                <TableRow
                  key={pr.id}
                  className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  onClick={() => router.push(`/procurement/requests/${pr.id}`)}
                >
                  <TableCell className="font-mono text-xs text-violet-600 font-medium">{pr.pr_number}</TableCell>
                  <TableCell className="font-medium max-w-[200px] truncate">{pr.title}</TableCell>
                  <TableCell className="text-sm">{pr.requested_by_name}</TableCell>
                  <TableCell className="text-sm">{pr.department_name || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs border-0 ${PRIORITY_COLORS[pr.priority] || ""}`}>
                      {pr.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs border ${STATUS_COLORS[pr.status] || ""}`}>
                      {pr.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{pr.items_count}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(pr.total_estimated_cost)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{pr.required_by_date || "—"}</TableCell>
                  <TableCell className="text-sm text-neutral-500 whitespace-nowrap">
                    {new Date(pr.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
