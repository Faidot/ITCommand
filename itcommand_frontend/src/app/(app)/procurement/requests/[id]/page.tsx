"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Clock, CheckCircle2, XCircle, Truck, Package, Box, Upload, Download, Trash2, MessageSquare, Receipt } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/store/authStore";
import { format } from "date-fns";
import { useMoney, useCurrencyCode } from "@/lib/currency";

const SC: Record<string,string> = {
  DRAFT:"bg-neutral-100 text-neutral-700",SUBMITTED:"bg-blue-100 text-blue-800",
  UNDER_REVIEW:"bg-yellow-100 text-yellow-800",APPROVED:"bg-emerald-100 text-emerald-800",
  REJECTED:"bg-red-100 text-red-800",ORDERED:"bg-purple-100 text-purple-800",
  PARTIALLY_RECEIVED:"bg-amber-100 text-amber-800",RECEIVED:"bg-teal-100 text-teal-800",
  CANCELLED:"bg-neutral-200 text-neutral-500"
};
const PC: Record<string,string> = {LOW:"bg-neutral-100 text-neutral-600",NORMAL:"bg-blue-50 text-blue-600",URGENT:"bg-orange-100 text-orange-700",CRITICAL:"bg-red-100 text-red-700"};

export default function PRDetailPage() {
  const money = useMoney();
  const params = useParams(); const router = useRouter();
  const { user } = useAuthStore();
  const prId = params.id as string;
  const [pr, setPr] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [createAssetsOpen, setCreateAssetsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [receiveItems, setReceiveItems] = useState<any[]>([]);
  const [assetItems, setAssetItems] = useState<any[]>([]);
  const [assetCategories, setAssetCategories] = useState<any[]>([]);
  const [uploadFile, setUploadFile] = useState<File|null>(null);
  const [uploadType, setUploadType] = useState("QUOTATION");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { fetchPR(); }, [prId]);
  useEffect(() => {
    api.get("/asset-categories/")
      .then(r => setAssetCategories(r.data.results || r.data))
      .catch(() => {/* non-blocking */});
  }, []);

  const fetchPR = async () => {
    try { const r = await api.get(`/procurement/requests/${prId}/`); setPr(r.data); }
    catch { toast.error("Failed to load PR"); }
    finally { setLoading(false); }
  };

  const fmt = (a: number) => money(a, { decimals: 0 });
  const isManager = user?.role && ['MANAGER','ADMIN','SUPERADMIN'].includes(user.role);
  const isOwner = pr?.requested_by === user?.id;

  const doAction = async (url:string, data:any={}) => {
    setActionLoading(true);
    try { await api.post(url, data); toast.success("Action completed"); fetchPR(); }
    catch(e:any) { toast.error(e.response?.data?.error || "Action failed"); }
    finally { setActionLoading(false); }
  };

  const handleApprove = () => { doAction(`/procurement/requests/${prId}/approve/`,{comment}); setApproveOpen(false); setComment(""); };
  const handleReject = () => { if(!rejectionReason){toast.error("Reason required");return;} doAction(`/procurement/requests/${prId}/reject/`,{rejection_reason:rejectionReason}); setRejectOpen(false); setRejectionReason(""); };
  const handleSubmit = () => doAction(`/procurement/requests/${prId}/submit/`);
  const handleOrder = () => doAction(`/procurement/requests/${prId}/order/`);

  const handleConvertExpense = async () => {
    if (!confirm("Create a finance expense from this purchase request?")) return;
    setActionLoading(true);
    try {
      const r = await api.post(`/procurement/requests/${prId}/convert-to-expense/`, {});
      toast.success(`Expense created (${r.data.status === "APPROVED" ? "approved" : "pending approval"})`);
    } catch (e: any) { toast.error(e.response?.data?.detail || "Failed to convert"); }
    finally { setActionLoading(false); }
  };

  const handleReceive = async () => {
    setActionLoading(true);
    try {
      await api.post(`/procurement/requests/${prId}/receive/`, { items: receiveItems });
      toast.success("Receipt recorded"); setReceiveOpen(false); fetchPR();
    } catch(e:any) { toast.error(e.response?.data?.error||"Failed"); }
    finally { setActionLoading(false); }
  };

  const handleCreateAssets = async () => {
    const selected = assetItems.filter(i=>i.selected);
    if(!selected.length){toast.error("Select items");return;}
    // Required-spec validation: any selected item whose chosen category
    // has required spec fields must have non-empty values.
    for (const it of selected) {
      const cat = assetCategories.find((c: any) => String(c.id) === String(it.category));
      const schema: any[] = cat?.spec_schema || [];
      for (const f of schema) {
        if (f.required && (it.specs?.[f.key] == null || it.specs?.[f.key] === "")) {
          toast.error(`${it.item_name}: ${f.label} is required`);
          return;
        }
      }
    }
    setActionLoading(true);
    try {
      const r = await api.post(`/procurement/requests/${prId}/create-assets/`, {
        items: selected.map((i: any) => ({
          item_id: i.id,
          asset_name: i.asset_name,
          serial_number: i.serial_number,
          category: i.category ? parseInt(i.category, 10) : null,
          specs: i.specs || {},
        })),
      });
      toast.success(`${r.data.created_count} assets created`); setCreateAssetsOpen(false); fetchPR();
    } catch(e:any) { toast.error(e.response?.data?.detail || e.response?.data?.error || "Failed to create assets"); }
    finally { setActionLoading(false); }
  };

  const handleUpload = async () => {
    if(!uploadFile){toast.error("Select a file");return;}
    const fd = new FormData(); fd.append("document",uploadFile); fd.append("document_type",uploadType); fd.append("pr",prId);
    try { await api.post(`/procurement/requests/${prId}/documents/`,fd,{headers:{"Content-Type":"multipart/form-data"}}); toast.success("Uploaded"); setUploadOpen(false); setUploadFile(null); fetchPR(); }
    catch { toast.error("Upload failed"); }
  };

  const openReceive = () => { setReceiveItems(pr.items.map((i:any)=>({id:i.id,item_name:i.item_name,quantity:i.quantity,received_quantity:i.received_quantity,actual_unit_price:i.actual_unit_price||i.estimated_unit_price}))); setReceiveOpen(true); };

  // PR item categories that can become Asset rows. Mirrors the backend allowlist.
  const ASSETABLE_CATEGORIES = new Set(['HARDWARE', 'PERIPHERAL', 'OTHER']);

  const openCreateAssets = () => {
    setAssetItems(
      pr.items
        .filter((i: any) => ASSETABLE_CATEGORIES.has(i.category))
        .map((i: any) => {
          const ordered = i.quantity ?? 1;
          const received = i.received_quantity ?? 0;
          // Effective quantity = what the server will use (received, or ordered if
          // nothing was recorded as received). Display this so admin understands
          // the asset row's quantity_total before saving.
          const effectiveQty = received > 0 ? received : ordered;
          const unit = parseFloat(i.actual_unit_price ?? i.estimated_unit_price ?? "0") || 0;
          return {
            id: i.id,
            item_name: i.item_name,
            asset_name: i.item_name,
            serial_number: '',
            category: '',         // user picks AssetCategory id
            specs: {} as Record<string, any>,
            selected: true,
            // read-only context inherited from the PR (display only):
            ordered_qty: ordered,
            received_qty: received,
            effective_qty: effectiveQty,
            unit_price: unit,
            total_price: +(unit * effectiveQty).toFixed(2),
          };
        })
    );
    setCreateAssetsOpen(true);
  };

  if(loading) return <div className="p-8 text-center text-neutral-500">Loading...</div>;
  if(!pr) return <div className="p-8 text-center text-red-500">PR not found</div>;

  const hasAssetable = pr.items?.some((i: any) =>
    ['HARDWARE', 'PERIPHERAL', 'OTHER'].includes(i.category)
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={()=>router.push('/procurement/requests')}><ArrowLeft className="h-5 w-5"/></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{pr.title}</h1>
            <Badge variant="outline" className="font-mono text-xs">{pr.pr_number}</Badge>
            <Badge className={`border-0 ${SC[pr.status]||""}`}>{pr.status.replace(/_/g," ")}</Badge>
            <Badge className={`border-0 ${PC[pr.priority]||""}`}>{pr.priority}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-500 mt-2">
            <span>By: <strong className="text-neutral-700 dark:text-neutral-300">{pr.requested_by_name}</strong></span>
            {pr.department_name&&<span>Dept: <strong className="text-neutral-700 dark:text-neutral-300">{pr.department_name}</strong></span>}
            {pr.required_by_date&&<span>Required: <strong className="text-neutral-700 dark:text-neutral-300">{pr.required_by_date}</strong></span>}
            {pr.vendor_name&&<span>Vendor: <strong className="text-neutral-700 dark:text-neutral-300">{pr.vendor_name}</strong></span>}
            {pr.budget_category_name&&<span>Budget: <strong className="text-neutral-700 dark:text-neutral-300">{pr.budget_category_name}</strong></span>}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {pr.status==='DRAFT'&&isOwner&&<><Button variant="outline" onClick={()=>router.push(`/procurement/requests/new`)}>Edit</Button><Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSubmit} disabled={actionLoading}>Submit for Approval</Button></>}
        {['SUBMITTED','UNDER_REVIEW'].includes(pr.status)&&isManager&&<><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={()=>setApproveOpen(true)}><CheckCircle2 className="w-4 h-4 mr-1"/>Approve</Button><Button variant="destructive" onClick={()=>setRejectOpen(true)}><XCircle className="w-4 h-4 mr-1"/>Reject</Button></>}
        {pr.status==='APPROVED'&&isManager&&<Button className="bg-purple-600 hover:bg-purple-700" onClick={handleOrder}><Truck className="w-4 h-4 mr-1"/>Mark as Ordered</Button>}
        {['ORDERED','PARTIALLY_RECEIVED'].includes(pr.status)&&<Button className="bg-teal-600 hover:bg-teal-700" onClick={openReceive}><Package className="w-4 h-4 mr-1"/>Record Receipt</Button>}
        {['RECEIVED','PARTIALLY_RECEIVED'].includes(pr.status) && (
          <Button
            className="bg-violet-600 hover:bg-violet-700"
            onClick={openCreateAssets}
            disabled={!hasAssetable}
            title={hasAssetable ? undefined : "Only hardware / peripheral / other items can be added as assets"}
          >
            <Box className="w-4 h-4 mr-1"/>Add to Assets
          </Button>
        )}
        {['RECEIVED','PARTIALLY_RECEIVED'].includes(pr.status) && isManager && (
          <Button variant="outline" className="text-rose-600" onClick={handleConvertExpense} disabled={actionLoading}><Receipt className="w-4 h-4 mr-1"/>Convert to Expense</Button>
        )}
        <Button variant="outline" onClick={()=>setUploadOpen(true)}><Upload className="w-4 h-4 mr-1"/>Upload Document</Button>
      </div>

      {/* Justification & Rejection */}
      {pr.justification&&<Card className="p-4"><h3 className="font-semibold text-sm text-neutral-500 mb-1">Justification</h3><p className="text-sm">{pr.justification}</p></Card>}
      {pr.rejection_reason&&<Card className="p-4 border-red-200 bg-red-50 dark:bg-red-900/10"><h3 className="font-semibold text-sm text-red-600 mb-1">Rejection Reason</h3><p className="text-sm text-red-700">{pr.rejection_reason}</p></Card>}

      {/* Items Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b"><h3 className="font-semibold text-lg">Items ({pr.items?.length||0})</h3></div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead className="text-center">Qty</TableHead><TableHead>Unit</TableHead>
            <TableHead className="text-right">Est. Price</TableHead><TableHead className="text-right">Est. Total</TableHead>
            <TableHead className="text-right">Actual Price</TableHead><TableHead className="text-center">Received</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {pr.items?.map((item:any)=>(
              <TableRow key={item.id}>
                <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{item.category}</Badge></TableCell>
                <TableCell className="text-center">{item.quantity}</TableCell>
                <TableCell className="text-sm">{item.unit}</TableCell>
                <TableCell className="text-right text-sm">{fmt(item.estimated_unit_price)}</TableCell>
                <TableCell className="text-right font-medium">{fmt(item.estimated_total)}</TableCell>
                <TableCell className="text-right text-sm">{item.actual_unit_price?fmt(item.actual_unit_price):"—"}</TableCell>
                <TableCell className="text-center">{item.received_quantity}/{item.quantity}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{item.status}</Badge></TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-neutral-50 dark:bg-neutral-900/50 font-semibold">
              <TableCell colSpan={5} className="text-right">Grand Total</TableCell>
              <TableCell className="text-right text-violet-600 text-lg">{fmt(pr.total_estimated_cost)}</TableCell>
              <TableCell className="text-right">{pr.total_actual_cost?fmt(pr.total_actual_cost):"—"}</TableCell>
              <TableCell colSpan={2}></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Documents */}
      <Card className="p-4">
        <h3 className="font-semibold text-lg mb-3">Documents</h3>
        {pr.documents?.length===0?<p className="text-neutral-500 text-sm">No documents uploaded.</p>:
          <div className="space-y-2">{pr.documents?.map((d:any)=>(
            <div key={d.id} className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-800 p-3 rounded-lg">
              <div className="flex items-center gap-3"><Badge variant="outline" className="text-xs">{d.document_type}</Badge><span className="text-sm font-medium">{d.title||"Document"}</span><span className="text-xs text-neutral-500">by {d.uploaded_by_name}</span></div>
              <a href={d.document} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><Download className="w-4 h-4 mr-1"/>Download</Button></a>
            </div>))}</div>}
      </Card>

      {/* Timeline */}
      <Card className="p-4">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Clock className="w-5 h-5 text-violet-500"/>Approval Timeline</h3>
        {pr.approval_logs?.length===0?<p className="text-neutral-500 text-sm">No activity yet.</p>:
          <div className="space-y-3">{pr.approval_logs?.map((log:any)=>(
            <div key={log.id} className="flex items-start gap-3 p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 text-xs font-bold">{log.actor_name?.charAt(0)||"?"}</div>
              <div className="flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{log.actor_name}</strong><Badge variant="outline" className={`text-[10px] ${log.action==='APPROVED'?'border-emerald-200 text-emerald-700 bg-emerald-50':log.action==='REJECTED'?'border-red-200 text-red-700 bg-red-50':'border-neutral-200'}`}>{log.action}</Badge><span className="text-xs text-neutral-500 ml-auto">{format(new Date(log.timestamp),'MMM d, yyyy h:mm a')}</span></div>
              {log.comment&&<p className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">{log.comment}</p>}</div>
            </div>))}</div>}
      </Card>

      {/* Approve Dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Approve Purchase Request</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4"><p className="text-sm text-neutral-500">Approving <strong>{pr.pr_number}</strong> — {pr.title}</p><div className="space-y-2"><Label>Comment (optional)</Label><Textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add approval notes..."/></div></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setApproveOpen(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleApprove} disabled={actionLoading}>Approve</Button></div>
      </DialogContent></Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Reject Purchase Request</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4"><div className="space-y-2"><Label>Rejection Reason <span className="text-red-500">*</span></Label><Textarea value={rejectionReason} onChange={e=>setRejectionReason(e.target.value)} placeholder="Why is this request being rejected?"/></div></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setRejectOpen(false)}>Cancel</Button><Button variant="destructive" onClick={handleReject} disabled={actionLoading}>Reject</Button></div>
      </DialogContent></Dialog>

      {/* Receive Dialog */}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Record Receipt</DialogTitle></DialogHeader>
        <div className="py-4 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-24">Ordered</TableHead><TableHead className="w-32">Received Qty</TableHead><TableHead className="w-32">Actual Price</TableHead></TableRow></TableHeader>
          <TableBody>{receiveItems.map((item,i)=>(<TableRow key={item.id}><TableCell className="text-sm font-medium">{item.item_name}</TableCell><TableCell className="text-center">{item.quantity}</TableCell>
            <TableCell><Input type="number" min={0} max={item.quantity} value={item.received_quantity} onChange={e=>{const v=[...receiveItems];v[i].received_quantity=parseInt(e.target.value)||0;setReceiveItems(v);}} className="h-8"/></TableCell>
            <TableCell><Input type="number" step="0.01" value={item.actual_unit_price} onChange={e=>{const v=[...receiveItems];v[i].actual_unit_price=parseFloat(e.target.value)||0;setReceiveItems(v);}} className="h-8"/></TableCell>
          </TableRow>))}</TableBody></Table></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setReceiveOpen(false)}>Cancel</Button><Button className="bg-teal-600 hover:bg-teal-700" onClick={handleReceive} disabled={actionLoading}>Confirm Receipt</Button></div>
      </DialogContent></Dialog>

      {/* Create Assets Dialog */}
      <Dialog open={createAssetsOpen} onOpenChange={setCreateAssetsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add to Assets — from PR Items</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2 mt-1">
            Each asset will inherit from this PR:{" "}
            <span className="font-medium">Vendor</span> ={" "}
            <span className="font-medium">{pr.preferred_vendor_name || pr.preferred_vendor || "—"}</span>
            {" · "}
            <span className="font-medium">Purchase date</span> ={" "}
            <span className="font-medium">
              {pr.approved_at ? format(new Date(pr.approved_at), "yyyy-MM-dd") : "today"}
            </span>
            . Quantity and unit price come from each line.
          </div>
          <div className="py-2 space-y-3">
            {assetItems.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No items can be converted to assets. Only items with category{" "}
                <strong>Hardware</strong>, <strong>Peripheral</strong> or <strong>Other</strong> are
                eligible — Software / Service / Consumable lines are excluded.
              </p>
            )}
            {assetItems.map((item, i) => {
              const cat = assetCategories.find((c: any) => String(c.id) === String(item.category));
              const schema: any[] = cat?.spec_schema || [];
              const updateItem = (patch: any) => {
                const v = [...assetItems];
                v[i] = { ...v[i], ...patch };
                setAssetItems(v);
              };
              const updateSpec = (key: string, value: any) => {
                const v = [...assetItems];
                v[i] = { ...v[i], specs: { ...(v[i].specs || {}), [key]: value } };
                setAssetItems(v);
              };
              return (
                <div key={item.id} className={`rounded-lg border p-3 space-y-3 ${item.selected ? '' : 'opacity-60'}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={item.selected}
                      onCheckedChange={(c) => updateItem({ selected: !!c })}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{item.item_name}</div>
                      <div className="text-[11px] text-muted-foreground">From PR line item #{item.id}</div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded border px-2 py-1 bg-card">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Quantity</div>
                          <div className="font-medium tabular-nums">
                            {item.effective_qty}
                            {item.received_qty > 0 && item.received_qty !== item.ordered_qty && (
                              <span className="text-[10px] text-amber-600 ml-1">received of {item.ordered_qty}</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded border px-2 py-1 bg-card">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Unit Price</div>
                          <div className="font-medium tabular-nums">{money(item.unit_price)}</div>
                        </div>
                        <div className="rounded border px-2 py-1 bg-card">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div>
                          <div className="font-medium tabular-nums">{money(item.total_price)}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {item.selected && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Asset name</Label>
                          <Input
                            value={item.asset_name}
                            onChange={(e) => updateItem({ asset_name: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Serial number</Label>
                          <Input
                            value={item.serial_number}
                            onChange={(e) => updateItem({ serial_number: e.target.value })}
                            className="h-9"
                            placeholder="SN…"
                          />
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Asset category</Label>
                        <Select
                          value={item.category || ""}
                          onValueChange={(v) => updateItem({ category: v, specs: {} })}
                        >
                          <SelectTrigger className="h-9"><SelectValue placeholder="Select category…" /></SelectTrigger>
                          <SelectContent>
                            {assetCategories.map((c: any) => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {schema.length > 0 && (
                        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                            {cat.name} specs
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {schema.map((f: any) => {
                              const v = item.specs?.[f.key] ?? "";
                              const label = (
                                <Label className="text-xs flex items-center gap-1">
                                  {f.label}
                                  {f.required && <span className="text-destructive">*</span>}
                                </Label>
                              );
                              if (f.type === "select") {
                                return (
                                  <div key={f.key} className="space-y-1">
                                    {label}
                                    <Select value={v || ""} onValueChange={(val) => updateSpec(f.key, val)}>
                                      <SelectTrigger className="h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
                                      <SelectContent>
                                        {(f.options || []).map((opt: string) => (
                                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                );
                              }
                              if (f.type === "bool") {
                                return (
                                  <div key={f.key} className="space-y-1 flex items-center justify-between gap-2 col-span-2">
                                    {label}
                                    <Checkbox checked={!!v} onCheckedChange={(c) => updateSpec(f.key, !!c)} />
                                  </div>
                                );
                              }
                              return (
                                <div key={f.key} className="space-y-1">
                                  {label}
                                  <Input
                                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                                    value={v}
                                    onChange={(e) => updateSpec(
                                      f.key,
                                      f.type === "number"
                                        ? (e.target.value === "" ? null : Number(e.target.value))
                                        : e.target.value
                                    )}
                                    className="h-9"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateAssetsOpen(false)}>Cancel</Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700"
              onClick={handleCreateAssets}
              disabled={actionLoading || assetItems.filter(i => i.selected).length === 0}
            >
              Create {assetItems.filter(i => i.selected).length} Asset{assetItems.filter(i => i.selected).length === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4"><div className="space-y-2"><Label>Document Type</Label><Select value={uploadType} onValueChange={setUploadType}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
          <SelectItem value="QUOTATION">Quotation</SelectItem><SelectItem value="INVOICE">Invoice</SelectItem><SelectItem value="DELIVERY_NOTE">Delivery Note</SelectItem><SelectItem value="PO">Purchase Order</SelectItem><SelectItem value="OTHER">Other</SelectItem>
        </SelectContent></Select></div><div className="space-y-2"><Label>File</Label><Input type="file" accept=".pdf,.doc,.docx,.jpg,.png" onChange={e=>setUploadFile(e.target.files?.[0]||null)}/></div></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setUploadOpen(false)}>Cancel</Button><Button className="bg-violet-600 hover:bg-violet-700" onClick={handleUpload}>Upload</Button></div>
      </DialogContent></Dialog>
    </div>
  );
}
