"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  LayoutGrid,
  List,
  Loader2,
  GripVertical,
  AlertTriangle,
  ChevronDown,
  X,
  Paperclip,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Constants ────────────────────────────────────────────────
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

const SLA_BADGE: Record<string, { cls: string; label: string }> = {
  ON_TRACK: { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0", label: "On Track" },
  AT_RISK: { cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0", label: "At Risk" },
  BREACHED: { cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0", label: "Breached" },
};

const PRIORITY_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-yellow-500",
  LOW: "bg-green-500",
};

const KANBAN_COLUMNS = ["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED"];
const KANBAN_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  PENDING: "Pending",
  RESOLVED: "Resolved",
};
const KANBAN_COLORS: Record<string, string> = {
  OPEN: "border-t-blue-500",
  IN_PROGRESS: "border-t-violet-500",
  PENDING: "border-t-amber-500",
  RESOLVED: "border-t-emerald-500",
};

interface TicketItem {
  id: number;
  ticket_number: string;
  title: string;
  priority: string;
  status: string;
  requester: number;
  requester_name: string;
  requester_email: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  category: number | null;
  category_name: string | null;
  category_icon: string | null;
  is_overdue: boolean;
  sla_status: string;
  sla_progress_pct: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface CategoryItem {
  id: number;
  name: string;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDueDate(d: string | null) {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TicketsListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const isStaff = user?.role !== "VIEWER";

  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"table" | "kanban">("table");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  // New ticket dialog
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicket, setNewTicket] = useState({
    title: "",
    description: "",
    category: "",
    priority: "MEDIUM",
    asset: "",
  });
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (priorityFilter !== "ALL") params.append("priority", priorityFilter);
      if (categoryFilter !== "ALL") params.append("category", categoryFilter);
      if (search) params.append("search", search);
      const res = await api.get(`/helpdesk/tickets/?${params.toString()}`);
      setTickets(res.data.results || res.data);
    } catch {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, categoryFilter, search]);

  useEffect(() => {
    const loadDeps = async () => {
      try {
        const [catRes, userRes, assetRes] = await Promise.all([
          api.get("/helpdesk/categories/"),
          api.get("/users/"),
          api.get("/assets/"),
        ]);
        setCategories(catRes.data);
        setUsers(userRes.data);
        setAssets(Array.isArray(assetRes.data) ? assetRes.data : assetRes.data.results || []);
      } catch {}
    };
    loadDeps();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => fetchTickets(), 300);
    return () => clearTimeout(handler);
  }, [fetchTickets]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowNewTicket(true);
    }
  }, [searchParams]);

  // Create ticket
  const handleCreateTicket = async () => {
    if (!newTicket.title.trim() || !newTicket.description.trim()) {
      toast.error("Title and description are required");
      return;
    }
    setSubmitting(true);
    try {
      const payload: any = {
        title: newTicket.title,
        description: newTicket.description,
        priority: newTicket.priority,
      };
      if (newTicket.category) payload.category = parseInt(newTicket.category);
      if (newTicket.asset) payload.asset = parseInt(newTicket.asset);

      const res = await api.post("/helpdesk/tickets/", payload);
      const ticketId = res.data.id;
      const tkNum = res.data.ticket_number;

      // Upload attachments
      for (const file of newFiles) {
        const fd = new FormData();
        fd.append("file", file);
        await api.post(`/helpdesk/tickets/${ticketId}/attachments/`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      toast.success(`Ticket ${tkNum} created successfully!`);
      setShowNewTicket(false);
      setNewTicket({ title: "", description: "", category: "", priority: "MEDIUM", asset: "" });
      setNewFiles([]);
      fetchTickets();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  // Kanban drag handlers
  const [draggedTicket, setDraggedTicket] = useState<TicketItem | null>(null);

  const handleDragStart = (ticket: TicketItem) => {
    setDraggedTicket(ticket);
  };

  const handleDrop = async (newStatus: string) => {
    if (!draggedTicket || draggedTicket.status === newStatus) {
      setDraggedTicket(null);
      return;
    }
    try {
      await api.post(`/helpdesk/tickets/${draggedTicket.id}/status/`, { status: newStatus });
      toast.success(`Ticket ${draggedTicket.ticket_number} moved to ${KANBAN_LABELS[newStatus]}`);
      fetchTickets();
    } catch {
      toast.error("Failed to update ticket status");
    }
    setDraggedTicket(null);
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
          <p className="text-neutral-500">Manage and track all IT support tickets</p>
        </div>
        <Button onClick={() => setShowNewTicket(true)} className="bg-violet-600 hover:bg-violet-700">
          <Plus className="mr-2 h-4 w-4" /> New Ticket
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
          <Input
            placeholder="Search ticket #, title, requester..."
            className="pl-9 bg-white dark:bg-neutral-900"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Priorities</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[140px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1 ml-auto bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
          <button
            onClick={() => setView("table")}
            className={`p-2 rounded-md transition-colors ${view === "table" ? "bg-white dark:bg-neutral-700 shadow-sm" : "text-neutral-400 hover:text-neutral-600"}`}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("kanban")}
            className={`p-2 rounded-md transition-colors ${view === "kanban" ? "bg-white dark:bg-neutral-700 shadow-sm" : "text-neutral-400 hover:text-neutral-600"}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
        </div>
      ) : view === "table" ? (
        /* ── TABLE VIEW ── */
        <Card className="overflow-hidden bg-white dark:bg-neutral-900">
          <ScrollArea className="w-full">
            <Table>
              <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
                <TableRow>
                  <TableHead className="w-[100px]">Ticket #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-16 text-neutral-400">
                      No tickets found. Create your first ticket to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  tickets.map((t) => (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                      onClick={() => router.push(`/helpdesk/tickets/${t.id}`)}
                    >
                      <TableCell>
                        <span className="font-mono text-sm text-violet-600 dark:text-violet-400 font-medium">
                          {t.ticket_number}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 max-w-[250px]">
                          <span className="font-medium truncate">{t.title}</span>
                          {t.is_overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-[10px] bg-violet-100 text-violet-700">
                              {t.requester_name?.charAt(0) || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{t.requester_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-neutral-600 dark:text-neutral-400">{t.category_name || "—"}</TableCell>
                      <TableCell>
                        <Badge className={PRIORITY_BADGE[t.priority] + " text-[10px]"}>{t.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_BADGE[t.status] + " text-[10px]"}>
                          {t.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{t.assigned_to_name || <span className="text-neutral-400 italic">Unassigned</span>}</TableCell>
                      <TableCell>
                        <Badge className={SLA_BADGE[t.sla_status]?.cls + " text-[10px]"}>
                          {SLA_BADGE[t.sla_status]?.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-neutral-500">{formatDate(t.created_at)}</TableCell>
                      <TableCell className={`text-sm ${t.is_overdue ? "text-red-600 font-medium" : "text-neutral-500"}`}>
                        {formatDueDate(t.due_date)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </Card>
      ) : (
        /* ── KANBAN VIEW ── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 min-h-[500px]">
          {KANBAN_COLUMNS.map((col) => {
            const colTickets = tickets.filter((t) => t.status === col);
            return (
              <div
                key={col}
                className={`flex flex-col bg-neutral-50 dark:bg-neutral-900/50 rounded-xl border-t-4 ${KANBAN_COLORS[col]} min-h-[400px]`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(col)}
              >
                <div className="flex items-center justify-between p-3 border-b border-neutral-200 dark:border-neutral-800">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{KANBAN_LABELS[col]}</span>
                    <span className="text-xs bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 rounded-full font-mono">
                      {colTickets.length}
                    </span>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-2">
                  <div className="space-y-2">
                    {colTickets.map((t) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={() => handleDragStart(t)}
                        className="bg-white dark:bg-neutral-800 rounded-lg p-3 border border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
                        onClick={() => router.push(`/helpdesk/tickets/${t.id}`)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-mono text-[10px] text-violet-600 dark:text-violet-400">{t.ticket_number}</span>
                          <div className={`w-2.5 h-2.5 rounded-full ${PRIORITY_DOT[t.priority]}`} title={t.priority} />
                        </div>
                        <p className="text-sm font-medium mb-2 line-clamp-2">{t.title}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className="text-[8px] bg-violet-100 text-violet-700">
                                {t.requester_name?.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[10px] text-neutral-500 truncate max-w-[80px]">{t.requester_name}</span>
                          </div>
                          {t.due_date && (
                            <span className={`text-[10px] ${t.is_overdue ? "text-red-500 font-medium" : "text-neutral-400"}`}>
                              {formatDueDate(t.due_date)}
                            </span>
                          )}
                        </div>
                        {t.is_overdue && (
                          <div className="mt-2 flex items-center gap-1 text-[10px] text-red-500 font-medium">
                            <AlertTriangle className="h-3 w-3" /> Overdue
                          </div>
                        )}
                      </div>
                    ))}
                    {colTickets.length === 0 && (
                      <div className="text-center py-8 text-neutral-400 text-xs">No tickets</div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            );
          })}
        </div>
      )}

      {/* ── NEW TICKET DIALOG ── */}
      <Dialog open={showNewTicket} onOpenChange={setShowNewTicket}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Title *</label>
              <Input
                placeholder="Brief description of the issue"
                value={newTicket.title}
                onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description *</label>
              <Textarea
                placeholder="Detailed description of the issue, steps to reproduce, impact..."
                rows={4}
                value={newTicket.description}
                onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Category</label>
                <Select value={newTicket.category} onValueChange={(v) => setNewTicket({ ...newTicket, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Priority</label>
                <Select value={newTicket.priority} onValueChange={(v) => setNewTicket({ ...newTicket, priority: v })}>
                  <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Linked Asset (optional)</label>
              <Select value={newTicket.asset} onValueChange={(v) => setNewTicket({ ...newTicket, asset: v })}>
                <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                <SelectContent>
                  {assets.map((a: any) => (
                    <SelectItem key={a.id} value={a.id.toString()}>{a.asset_tag} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                <Paperclip className="inline h-3.5 w-3.5 mr-1" /> Attachments
              </label>
              <Input
                type="file"
                multiple
                onChange={(e) => {
                  if (e.target.files) setNewFiles(Array.from(e.target.files));
                }}
                className="file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-violet-50 file:text-violet-700"
              />
              {newFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {newFiles.map((f, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {f.name}
                      <button onClick={() => setNewFiles(newFiles.filter((_, j) => j !== i))} className="ml-1">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTicket(false)}>Cancel</Button>
            <Button onClick={handleCreateTicket} disabled={submitting} className="bg-violet-600 hover:bg-violet-700">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
