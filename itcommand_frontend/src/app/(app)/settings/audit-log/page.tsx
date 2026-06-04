"use client";

import React, { useEffect, useState } from "react";
import { Activity, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export default function AuditLogPage() {
  const { user } = useAuthStore();
  const [logs, setLogs] = useState<any[]>([]);
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

  useEffect(() => {
    if (user?.role === "SUPERADMIN") {
      fetchLogs();
    }
  }, [user, actionFilter, modelFilter]);

  if (user?.role !== "SUPERADMIN") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>You don't have permission to view audit logs.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const getActionBadge = (action: string) => {
    if (action === "CREATE") return <Badge className="bg-emerald-500 hover:bg-emerald-600">CREATE</Badge>;
    if (action === "UPDATE") return <Badge className="bg-blue-500 hover:bg-blue-600">UPDATE</Badge>;
    if (action === "DELETE") return <Badge variant="destructive">DELETE</Badge>;
    return <Badge>{action}</Badge>;
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="text-blue-500" /> Audit Logs</h1>
        <p className="text-neutral-500">Track all create, update, and delete actions across the platform</p>
      </div>

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
