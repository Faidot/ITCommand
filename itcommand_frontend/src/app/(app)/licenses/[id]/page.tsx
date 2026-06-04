"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { KeyRound, Building, Calendar, DollarSign, CheckCircle2, AlertTriangle, XCircle, ArrowLeft, Users, Eye, EyeOff, RotateCcw, RefreshCw, Trash2, Pencil } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AssignSeatDialog } from "../assign-seat-dialog";
import { AddLicenseDialog } from "../add-license-dialog";
import { useAuthStore } from "@/store/authStore";

const LICENSE_TYPE_BADGE: Record<string, string> = {
  PERPETUAL: "bg-blue-100 text-blue-800",
  SUBSCRIPTION: "bg-violet-100 text-violet-800",
  VOLUME: "bg-amber-100 text-amber-800",
  OEM: "bg-neutral-100 text-neutral-800",
  OPEN_SOURCE: "bg-emerald-100 text-emerald-800",
  TRIAL: "bg-rose-100 text-rose-800",
};

export default function LicenseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const licenseId = params.id as string;
  
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [license, setLicense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [keyVisible, setKeyVisible] = useState(false);
  const [decryptedKey, setDecryptedKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);

  // Renew dialog
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewForm, setRenewForm] = useState({ new_expiry: "", cost: "", seats_added: "", notes: "" });
  const [suggestedExpiry, setSuggestedExpiry] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [savingFlag, setSavingFlag] = useState(false);
  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    fetchLicense();
  }, [licenseId]);

  const fetchLicense = async () => {
    try {
      const res = await api.get(`/licenses/${licenseId}/`);
      setLicense(res.data);
    } catch {
      toast.error("Failed to load license details");
      router.push("/licenses");
    } finally {
      setLoading(false);
    }
  };

  const openRenew = async () => {
    setRenewForm({ new_expiry: "", cost: "", seats_added: "", notes: "" });
    setSuggestedExpiry(null);
    setRenewOpen(true);
    // Ask the server for the suggested next expiry based on billing cycle.
    try {
      const res = await api.get(`/licenses/${licenseId}/suggest_next_expiry/`);
      if (res.data?.suggested_expiry) {
        setSuggestedExpiry(res.data.suggested_expiry);
        setRenewForm((f) => ({ ...f, new_expiry: res.data.suggested_expiry }));
      }
    } catch {
      /* non-blocking */
    }
  };

  const submitRenew = async () => {
    if (!renewForm.new_expiry) {
      toast.error("New expiry date is required.");
      return;
    }
    setRenewing(true);
    try {
      const payload: any = { new_expiry: renewForm.new_expiry };
      if (renewForm.cost) payload.cost = parseFloat(renewForm.cost);
      if (renewForm.seats_added) payload.seats_added = parseInt(renewForm.seats_added, 10);
      if (renewForm.notes) payload.notes = renewForm.notes;
      await api.post(`/licenses/${licenseId}/renew/`, payload);
      toast.success(`Renewed until ${renewForm.new_expiry}.`);
      setRenewOpen(false);
      fetchLicense();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Renewal failed.");
    } finally {
      setRenewing(false);
    }
  };

  const handleDelete = async () => {
    if (!license) return;
    if (!confirm(`Delete ${license.product_name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/licenses/${licenseId}/`);
      toast.success("License deleted.");
      router.push("/licenses/list");
    } catch (err: any) {
      // 409 from the server when there are active seat assignments.
      toast.error(err.response?.data?.detail || "Failed to delete license.");
    }
  };

  const toggleAutoRenew = async (next: boolean) => {
    if (!license) return;
    setSavingFlag(true);
    try {
      await api.patch(`/licenses/${licenseId}/`, { auto_renew: next });
      setLicense({ ...license, auto_renew: next });
      toast.success(next ? "Auto-renew enabled." : "Auto-renew disabled.");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Couldn't update auto-renew.");
    } finally {
      setSavingFlag(false);
    }
  };

  const handleRevealKey = async () => {
    if (decryptedKey) {
      // Already fetched, just toggle visibility
      setKeyVisible(true);
      hideKeyAfterDelay();
      return;
    }

    setKeyLoading(true);
    try {
      const res = await api.get(`/licenses/${licenseId}/key/`);
      setDecryptedKey(res.data.license_key);
      setKeyVisible(true);
      hideKeyAfterDelay();
    } catch {
      toast.error("Failed to reveal license key. Check your permissions.");
    } finally {
      setKeyLoading(false);
    }
  };

  const hideKeyAfterDelay = () => {
    setTimeout(() => {
      setKeyVisible(false);
    }, 10000);
  };

  const handleRevoke = async (userId: number, userName: string) => {
    if (!confirm(`Are you sure you want to revoke ${userName}'s access?`)) return;
    try {
      await api.post(`/licenses/${licenseId}/revoke/${userId}/`);
      toast.success("Access revoked successfully");
      fetchLicense(); // refresh
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to revoke access");
    }
  };

  if (loading || !license) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-6">
        <Button variant="ghost" size="icon" onClick={() => router.push("/licenses/list")}>
          <ArrowLeft className="h-5 w-5 text-neutral-500" />
        </Button>
        <div className="w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xl font-bold text-neutral-400">
          {license.product_name.charAt(0)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{license.product_name}</h1>
            <Badge variant={license.is_active ? "default" : "secondary"} className={license.is_active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0" : ""}>
              {license.is_active ? "Active" : "Inactive"}
            </Badge>
            {license.auto_renew && (
              <Badge variant="outline" className="border-violet-200 text-violet-700 bg-violet-50">
                <RefreshCw className="w-3 h-3 mr-1" /> Auto-renew
              </Badge>
            )}
          </div>
          <p className="text-neutral-500 text-sm mt-1">{license.product_vendor} • {license.product_category}</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            {(license.billing_cycle === "MONTHLY" || license.billing_cycle === "YEARLY") && (
              <Button onClick={openRenew} className="bg-violet-600 hover:bg-violet-700">
                <RotateCcw className="w-4 h-4 mr-2" /> Renew
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" /> Edit
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Details */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                <KeyRound className="w-4 h-4" /> License Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-y-4">
                <div>
                  <span className="text-neutral-500 block mb-1">License Type</span>
                  <Badge className={`${LICENSE_TYPE_BADGE[license.license_type] || "bg-neutral-100"} border-0 text-[10px]`}>
                    {license.license_type.replace("_", " ")}
                  </Badge>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-1">Billing Cycle</span>
                  <span className="font-medium">{license.billing_cycle ? license.billing_cycle.replace("_", " ") : "N/A"}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-1 flex items-center gap-1"><Calendar className="w-3 h-3"/> Purchase Date</span>
                  <span className="font-medium">{license.purchase_date || "N/A"}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-1 flex items-center gap-1"><Calendar className="w-3 h-3"/> Expiry Date</span>
                  <span className={`font-medium ${license.is_expired ? 'text-red-500' : ''}`}>
                    {license.expiry_date || "Perpetual"}
                    {license.is_expired && " (Expired)"}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3"/> Annual Cost</span>
                  <span className="font-medium text-emerald-600">Rs {license.annual_cost.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-1">PO Number</span>
                  <span className="font-medium">{license.purchase_order_number || "N/A"}</span>
                </div>
              </div>

              {/* Auto-renew toggle */}
              <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-violet-500" /> Auto-renew
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {license.billing_cycle === "MONTHLY"
                      ? "Extends expiry by one month each time it lapses."
                      : license.billing_cycle === "YEARLY"
                      ? "Extends expiry by one year each time it lapses."
                      : "Requires a Monthly or Yearly billing cycle."}
                  </div>
                </div>
                <Switch
                  checked={!!license.auto_renew}
                  onCheckedChange={toggleAutoRenew}
                  disabled={!isAdmin || savingFlag || (license.billing_cycle !== "MONTHLY" && license.billing_cycle !== "YEARLY")}
                />
              </div>

              {/* License Key Section */}
              <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
                <span className="text-neutral-500 block mb-2">License Key</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-sm bg-neutral-50 dark:bg-neutral-900 p-2 rounded border border-neutral-200 dark:border-neutral-800 truncate">
                    {keyVisible ? decryptedKey : (license.masked_key || "No key provided")}
                  </div>
                  {license.masked_key && (
                    <Button variant="outline" size="icon" onClick={handleRevealKey} disabled={keyLoading} title="Reveal Key (10s)">
                      {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-violet-500" />}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4" /> Capacity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-end mb-2">
                <div>
                  <div className="text-3xl font-bold text-neutral-900 dark:text-white">{license.seats_used}</div>
                  <div className="text-xs text-neutral-500 mt-1">Seats Used</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold text-neutral-400">{license.seats_total || "Unlimited"}</div>
                  <div className="text-xs text-neutral-500 mt-1">Total Seats</div>
                </div>
              </div>
              <div className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-full h-2 mt-4">
                <div 
                  className={`h-2 rounded-full ${license.seats_usage_pct >= 100 ? 'bg-red-500' : license.seats_usage_pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                  style={{ width: `${Math.min(license.seats_usage_pct, 100)}%` }}
                ></div>
              </div>
              <p className="text-xs text-center text-neutral-500 mt-2">
                {license.seats_available !== null ? `${license.seats_available} seats available` : "Unlimited seats available"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Assignments */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-bold">Assigned Users</CardTitle>
              <AssignSeatDialog 
                licenseId={license.id} 
                disabled={license.seats_available === 0} 
                onSuccess={fetchLicense} 
              />
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              <Table>
                <TableHeader className="bg-neutral-50 dark:bg-neutral-800/50">
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Assigned Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {license.assignments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center text-neutral-500">
                        No users assigned to this license.
                      </TableCell>
                    </TableRow>
                  ) : (
                    license.assignments.map((assignment: any) => (
                      <TableRow key={assignment.id} className={!assignment.is_active ? "opacity-50" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={assignment.user_avatar} />
                              <AvatarFallback className="text-xs bg-neutral-200 text-neutral-700">
                                {assignment.user_name?.charAt(0) || assignment.user_email?.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="font-medium text-sm">{assignment.user_name || "Unknown"}</span>
                              <span className="text-xs text-neutral-500">{assignment.user_email}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(assignment.assigned_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {assignment.is_active ? (
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0 text-[10px]">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Revoked</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {assignment.is_active && (
                            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => handleRevoke(assignment.user, assignment.user_name)}>
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Renew dialog */}
      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renew {license.product_name}</DialogTitle>
            <DialogDescription>
              {license.expiry_date
                ? <>Current expiry: <span className="font-medium">{license.expiry_date}</span></>
                : "No expiry on file."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> New expiry date
                <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={renewForm.new_expiry}
                onChange={(e) => setRenewForm({ ...renewForm, new_expiry: e.target.value })}
              />
              {suggestedExpiry && (
                <div className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                  <span>
                    Suggested from billing cycle ({license.billing_cycle?.toLowerCase()}):
                    <span className="font-mono font-medium ml-1 text-violet-600 dark:text-violet-400">{suggestedExpiry}</span>
                  </span>
                  {renewForm.new_expiry !== suggestedExpiry && (
                    <button
                      type="button"
                      className="text-violet-600 hover:underline"
                      onClick={() => setRenewForm({ ...renewForm, new_expiry: suggestedExpiry })}
                    >
                      Use suggestion
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Renewal cost</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={renewForm.cost}
                  onChange={(e) => setRenewForm({ ...renewForm, cost: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Seats added</label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={renewForm.seats_added}
                  onChange={(e) => setRenewForm({ ...renewForm, seats_added: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={renewForm.notes}
                onChange={(e) => setRenewForm({ ...renewForm, notes: e.target.value })}
                placeholder="PO number, renewal contact, terms changes…"
                className="min-h-20"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)} disabled={renewing}>Cancel</Button>
            <Button onClick={submitRenew} disabled={renewing || !renewForm.new_expiry}>
              {renewing ? "Renewing…" : "Renew"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog (reuses AddLicenseDialog in edit mode) */}
      <AddLicenseDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={() => { setEditOpen(false); fetchLicense(); }}
        initial={license}
      />
    </div>
  );
}
