"use client";

import React, { useEffect, useState } from "react";
import { Activity, ShieldAlert, ChevronDown, ChevronRight, Circle, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface ActiveUser {
  id: number;
  full_name: string;
  email: string;
  role: string;
  last_seen_at: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  seconds_ago: number | null;
}

interface Presence {
  window_seconds: number;
  online: ActiveUser[];
  recent: ActiveUser[];
  online_count: number;
}

/** "2m ago" — presence is only ever minute-accurate, so don't imply seconds. */
function ago(seconds: number | null) {
  if (seconds === null) return "never";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AuditLogPage() {
  const { user } = useAuthStore();
  const [logs, setLogs] = useState<any[]>([]);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState("ALL");
  const [modelFilter, setModelFilter] = useState("");
  
  const fetchLogs = async () => {
    try {
      let url = '/audit-logs/?';
      if (actionFilter !== "ALL") url += `action=${actionFilter}&`;
      if (modelFilter) url += `model=${modelFilter}&`;
      
      const res = await api.get(url);
      setLogs(res.data.results);
      setLoading(false);
    } catch {
      toast.error("Failed to load audit logs");
      setLoading(false);
    }
  };

  const fetchPresence = async () => {
    try {
      const res = await api.get("/users/active/");
      setPresence(res.data);
    } catch {
      // Presence is a nicety on this page; the audit table is the point.
    }
  };

  useEffect(() => {
    if (user?.role === "SUPERADMIN") {
      fetchLogs();
    }
  }, [user, actionFilter, modelFilter]);

  // Polled rather than pushed: JWT sessions are stateless and there is no
  // socket to listen on, so the honest refresh is a periodic re-read.
  useEffect(() => {
    if (user?.role !== "SUPERADMIN") return;
    void fetchPresence();
    const timer = setInterval(() => void fetchPresence(), 30000);
    return () => clearInterval(timer);
  }, [user]);

  if (user?.role !== "SUPERADMIN") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>You don&apos;t have permission to view audit logs.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const getActionBadge = (action: string) => {
    if (action === "CREATE") return <Badge className="bg-emerald-500 hover:bg-emerald-600">CREATE</Badge>;
    if (action === "UPDATE") return <Badge className="bg-blue-500 hover:bg-blue-600">UPDATE</Badge>;
    if (action === "DELETE") return <Badge variant="destructive">DELETE</Badge>;
    if (action === "LOGIN") return <Badge className="bg-teal-500 hover:bg-teal-600">LOGIN</Badge>;
    if (action === "LOGOUT") return <Badge variant="outline">LOGOUT</Badge>;
    if (action === "LOGIN_FAILED") return <Badge variant="destructive">LOGIN FAILED</Badge>;
    if (action === "REVEAL") return <Badge className="bg-amber-500 hover:bg-amber-600">REVEAL</Badge>;
    return <Badge>{action}</Badge>;
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="text-blue-500" /> Audit Logs</h1>
        <p className="text-neutral-500">
          Who is signed in, and every create, update, delete and sign-in across the platform
        </p>
      </div>

      {presence && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Circle
                className={`h-3 w-3 ${
                  presence.online_count > 0
                    ? "fill-emerald-500 text-emerald-500"
                    : "fill-neutral-400 text-neutral-400"
                }`}
              />
              {presence.online_count} signed in now
              <span className="text-xs font-normal text-neutral-500">
                {/* Said plainly: this is last-seen, not a held-open connection. */}
                active in the last {Math.round(presence.window_seconds / 60)} minutes ·
                refreshes every 30s
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {presence.online.length === 0 ? (
              <p className="text-sm text-neutral-500">Nobody has used the app recently.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {presence.online.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.full_name}</p>
                      <p className="truncate text-xs text-neutral-500">{row.email}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700">
                        {ago(row.seconds_ago)}
                      </Badge>
                      {row.last_login_at && (
                        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-neutral-500">
                          <LogIn className="h-3 w-3" />
                          {new Date(row.last_login_at).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {presence.recent.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Seen earlier
                </p>
                <div className="flex flex-wrap gap-2">
                  {presence.recent.map((row) => (
                    <Badge key={row.id} variant="outline" className="gap-1 text-[11px] font-normal">
                      {row.last_logout_at &&
                      row.last_seen_at &&
                      row.last_logout_at >= row.last_seen_at ? (
                        <LogOut className="h-3 w-3" />
                      ) : (
                        <Circle className="h-2 w-2 fill-neutral-300 text-neutral-300" />
                      )}
                      {row.full_name}
                      <span className="text-neutral-500">{ago(row.seconds_ago)}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle>System Activity</CardTitle>
            <div className="flex gap-2">
              <Input 
                placeholder="Filter by Model (e.g. Asset)" 
                value={modelFilter} 
                onChange={(e) => setModelFilter(e.target.value)} 
                className="w-48"
              />
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Action" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Actions</SelectItem>
                  <SelectItem value="CREATE">Create</SelectItem>
                  <SelectItem value="UPDATE">Update</SelectItem>
                  <SelectItem value="DELETE">Delete</SelectItem>
                  <SelectItem value="LOGIN">Sign in</SelectItem>
                  <SelectItem value="LOGOUT">Sign out</SelectItem>
                  <SelectItem value="LOGIN_FAILED">Failed sign in</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Object ID</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <TableRow className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800" onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}>
                      <TableCell>{expandedRow === log.id ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}</TableCell>
                      <TableCell className="font-mono text-xs text-neutral-500">{new Date(log.timestamp).toLocaleString()}</TableCell>
                      <TableCell>{log.user_name || log.user_email}</TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell className="font-medium">{log.model_name}</TableCell>
                      <TableCell className="font-mono text-xs">{log.object_id}</TableCell>
                      <TableCell className="font-mono text-xs">{log.ip_address}</TableCell>
                    </TableRow>
                    {expandedRow === log.id && (
                      <TableRow className="bg-neutral-50 dark:bg-neutral-900">
                        <TableCell colSpan={7} className="p-4">
                          <div className="text-xs font-mono text-neutral-400 mb-2">Changes payload:</div>
                          <pre className="bg-neutral-100 dark:bg-neutral-950 p-4 rounded-lg overflow-x-auto text-xs border">
                            {log.changes ? JSON.stringify(log.changes, null, 2) : "No payload data"}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
                {!loading && logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-neutral-500">No audit logs found matching criteria.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
