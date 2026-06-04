"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Lock,
  Send,
  Paperclip,
  Download,
  FileText,
  Clock,
  AlertTriangle,
  User as UserIcon,
  X,
  CheckCircle2,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const SLA_BAR: Record<string, string> = {
  ON_TRACK: "bg-emerald-500",
  AT_RISK: "bg-amber-500",
  BREACHED: "bg-red-500",
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeRemaining(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "N/A";
  if (seconds <= 0) return "Overdue";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  return `${hrs}h ${mins}m`;
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const ticketId = params.id;

  const isManager = user?.role === "MANAGER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);

  // Comment form
  const [commentBody, setCommentBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);

  // Attachment upload
  const [uploadingFile, setUploadingFile] = useState(false);

  const fetchTicket = useCallback(async () => {
    try {
      const res = await api.get(`/helpdesk/tickets/${ticketId}/`);
      setTicket(res.data);
    } catch {
      toast.error("Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket();
    api.get("/users/").then((r) => setUsers(r.data)).catch(() => {});
  }, [fetchTicket]);

  // Status change
  const handleStatusChange = async (newStatus: string) => {
    try {
      await api.post(`/helpdesk/tickets/${ticketId}/status/`, { status: newStatus });
      toast.success(`Status changed to ${newStatus.replace("_", " ")}`);
      fetchTicket();
    } catch {
      toast.error("Failed to update status");
    }
  };

  // Priority change
  const handlePriorityChange = async (newPriority: string) => {
    try {
      await api.patch(`/helpdesk/tickets/${ticketId}/`, { priority: newPriority });
      toast.success(`Priority updated to ${newPriority}`);
      fetchTicket();
    } catch {
      toast.error("Failed to update priority");
    }
  };

  // Assign
  const handleAssign = async (userId: string) => {
    try {
      await api.post(`/helpdesk/tickets/${ticketId}/assign/`, { user_id: parseInt(userId) });
      toast.success("Ticket assigned");
      fetchTicket();
    } catch {
      toast.error("Failed to assign ticket");
    }
  };

  // Add comment
  const handleAddComment = async () => {
    if (!commentBody.trim()) return;
    setSendingComment(true);
    try {
      await api.post(`/helpdesk/tickets/${ticketId}/comments/`, {
        body: commentBody,
        is_internal: isInternal,
      });
      setCommentBody("");
      setIsInternal(false);
      fetchTicket();
      toast.success("Comment added");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setSendingComment(false);
    }
  };

  // Upload attachment
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/helpdesk/tickets/${ticketId}/attachments/`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("File uploaded");
      fetchTicket();
    } catch {
      toast.error("Failed to upload file");
    } finally {
      setUploadingFile(false);
    }
  };

  // Close ticket
  const handleClose = async () => {
    try {
      await api.post(`/helpdesk/tickets/${ticketId}/status/`, { status: "CLOSED" });
      toast.success("Ticket closed");
      fetchTicket();
    } catch {
      toast.error("Failed to close ticket");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20 text-neutral-400">
        <p>Ticket not found</p>
        <Button variant="outline" onClick={() => router.back()} className="mt-4">Go Back</Button>
      </div>
    );
  }

  const slaPct = Math.min(ticket.sla_progress_pct || 0, 100);
  const slaStatus = ticket.sla_status || "ON_TRACK";

  return (
    <div className="flex flex-col gap-4 w-full max-w-7xl mx-auto p-4">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="self-start -ml-2 text-neutral-500">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Tickets
      </Button>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── LEFT PANEL (70%) ── */}
        <div className="flex-1 lg:w-[70%] space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-sm text-violet-600 dark:text-violet-400 font-semibold">{ticket.ticket_number}</span>
                <Badge className={STATUS_BADGE[ticket.status] + " text-[10px]"}>{ticket.status.replace("_", " ")}</Badge>
                <Badge className={PRIORITY_BADGE[ticket.priority] + " text-[10px]"}>{ticket.priority}</Badge>
                <Badge className={SLA_BADGE[slaStatus]?.cls + " text-[10px]"}>{SLA_BADGE[slaStatus]?.label}</Badge>
                {ticket.is_overdue && (
                  <Badge className="bg-red-500 text-white text-[10px] border-0">
                    <AlertTriangle className="h-3 w-3 mr-1" /> OVERDUE
                  </Badge>
                )}
              </div>
              <h1 className="text-xl font-bold">{ticket.title}</h1>
            </div>
          </div>

          {/* Description */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-neutral-500">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
            </CardContent>
          </Card>

          {/* Attachments */}
          {ticket.attachments && ticket.attachments.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-neutral-500 flex items-center gap-1">
                  <Paperclip className="h-4 w-4" /> Attachments ({ticket.attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {ticket.attachments.map((att: any) => (
                    <a
                      key={att.id}
                      href={att.file}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                    >
                      <FileText className="h-4 w-4 text-violet-500" />
                      <span className="text-sm truncate max-w-[150px]">{att.file.split("/").pop()}</span>
                      <Download className="h-3 w-3 text-neutral-400" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments / Activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-neutral-500">Activity & Comments</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[500px] pr-2">
                <div className="space-y-4">
                  {(!ticket.comments || ticket.comments.length === 0) ? (
                    <p className="text-center text-neutral-400 text-sm py-8">No activity yet</p>
                  ) : (
                    ticket.comments.map((c: any) => (
                      <div
                        key={c.id}
                        className={`flex gap-3 p-3 rounded-lg ${
                          c.is_internal
                            ? "bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50"
                            : "bg-neutral-50 dark:bg-neutral-800/50"
                        }`}
                      >
                        <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                          <AvatarFallback className="text-[10px] bg-violet-100 text-violet-700">
                            {c.author_name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{c.author_name}</span>
                            {c.is_internal && (
                              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                <Lock className="h-3 w-3" /> Internal Note
                              </span>
                            )}
                            <span className="text-[10px] text-neutral-400 ml-auto">{formatDate(c.created_at)}</span>
                          </div>
                          <p className="text-sm mt-1 whitespace-pre-wrap">{c.body}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              {/* Comment Input */}
              <Separator className="my-4" />
              <div className="space-y-3">
                <Textarea
                  placeholder="Write a comment..."
                  rows={3}
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  className="resize-none"
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isManager && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isInternal}
                          onChange={(e) => setIsInternal(e.target.checked)}
                          className="rounded border-neutral-300"
                        />
                        <Lock className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs text-neutral-500">Internal Note</span>
                      </label>
                    )}
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" onChange={handleFileUpload} />
                      <span className="flex items-center gap-1 text-xs text-neutral-500 hover:text-violet-600 transition-colors">
                        <Paperclip className="h-3.5 w-3.5" />
                        {uploadingFile ? "Uploading..." : "Attach File"}
                      </span>
                    </label>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleAddComment}
                    disabled={sendingComment || !commentBody.trim()}
                    className="bg-violet-600 hover:bg-violet-700"
                  >
                    {sendingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                    Send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT PANEL (30%) — Ticket Info Sidebar ── */}
        <div className="lg:w-[30%] space-y-4">
          {/* Status */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-1 block">Status</label>
                {isManager ? (
                  <Select value={ticket.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">Open</SelectItem>
                      <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="RESOLVED">Resolved</SelectItem>
                      <SelectItem value="CLOSED">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge className={STATUS_BADGE[ticket.status]}>{ticket.status.replace("_", " ")}</Badge>
                )}
              </div>

              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-1 block">Priority</label>
                {isManager ? (
                  <Select value={ticket.priority} onValueChange={handlePriorityChange}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="CRITICAL">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge className={PRIORITY_BADGE[ticket.priority]}>{ticket.priority}</Badge>
                )}
              </div>

              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-1 block">Category</label>
                <p className="text-sm">{ticket.category_name || "—"}</p>
              </div>
            </CardContent>
          </Card>

          {/* Assignment */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-1 block">Assigned To</label>
                {isAdmin ? (
                  <Select
                    value={ticket.assigned_to?.toString() || "unassigned"}
                    onValueChange={(v) => v !== "unassigned" && handleAssign(v)}
                  >
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users.map((u: any) => (
                        <SelectItem key={u.id} value={u.id.toString()}>
                          {u.full_name} ({u.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2">
                    {ticket.assigned_to_name ? (
                      <>
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px] bg-violet-100 text-violet-700">
                            {ticket.assigned_to_name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{ticket.assigned_to_name}</span>
                      </>
                    ) : (
                      <span className="text-sm text-neutral-400 italic">Unassigned</span>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-1 block">Requester</label>
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
                      {ticket.requester_name?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{ticket.requester_name}</span>
                    <span className="text-[10px] text-neutral-400">{ticket.requester_email}</span>
                  </div>
                </div>
              </div>

              {ticket.asset && (
                <>
                  <Separator />
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-1 block">Linked Asset</label>
                    <button
                      onClick={() => router.push("/assets")}
                      className="flex items-center gap-1.5 text-sm text-violet-600 hover:underline"
                    >
                      <span className="font-mono text-xs">{ticket.asset_tag}</span>
                      <span>{ticket.asset_name}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* KB Suggestions */}
          {ticket.suggested_kb_articles && ticket.suggested_kb_articles.length > 0 && (
            <Card className="border-violet-200 bg-violet-50/50 dark:border-violet-900/50 dark:bg-violet-900/10">
              <CardContent className="pt-4 space-y-3">
                <label className="text-xs text-violet-600 dark:text-violet-400 uppercase tracking-wider font-semibold flex items-center gap-1 block">
                  <BookOpen className="w-3.5 h-3.5" /> Suggested Articles
                </label>
                <div className="space-y-2">
                  {ticket.suggested_kb_articles.map((art: any) => (
                    <a
                      key={art.id}
                      href={`/kb/articles/${art.slug}`}
                      target="_blank"
                      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-violet-400 hover:underline line-clamp-2"
                    >
                      {art.title}
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* SLA */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <label className="text-xs text-neutral-500 uppercase tracking-wider font-medium block">SLA</label>
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500">Due Date</span>
                <span className={`text-sm font-medium ${ticket.is_overdue ? "text-red-500" : ""}`}>
                  {formatDate(ticket.due_date)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500">Time Remaining</span>
                <span className={`text-sm font-semibold ${ticket.is_overdue ? "text-red-500" : ""}`}>
                  {formatTimeRemaining(ticket.time_remaining_seconds)}
                </span>
              </div>
              {/* SLA Progress Bar */}
              <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${SLA_BAR[slaStatus] || "bg-emerald-500"}`}
                  style={{ width: `${slaPct}%` }}
                />
              </div>
              <p className="text-[10px] text-neutral-400 text-center">{slaPct}% elapsed</p>
            </CardContent>
          </Card>

          {/* Timestamps */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-neutral-500">Created</span>
                <span className="text-xs">{formatDate(ticket.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-neutral-500">Updated</span>
                <span className="text-xs">{formatDate(ticket.updated_at)}</span>
              </div>
              {ticket.resolved_at && (
                <div className="flex justify-between">
                  <span className="text-xs text-neutral-500">Resolved</span>
                  <span className="text-xs text-emerald-600">{formatDate(ticket.resolved_at)}</span>
                </div>
              )}
              {ticket.closed_at && (
                <div className="flex justify-between">
                  <span className="text-xs text-neutral-500">Closed</span>
                  <span className="text-xs">{formatDate(ticket.closed_at)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Close Button */}
          {ticket.status === "RESOLVED" && isManager && (
            <Button
              variant="outline"
              className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={handleClose}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Close Ticket
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
