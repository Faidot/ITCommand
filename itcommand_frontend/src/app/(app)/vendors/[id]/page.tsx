"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Building, Mail, Phone, Globe, Star, FileText, FileSpreadsheet, Box, KeyRound, Clock, Plus, Download, MessageSquare, Pencil, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { AddContractDialog } from "./add-contract-dialog";
import { AddVendorDialog } from "../add-vendor-dialog";
import { useAuthStore } from "@/store/authStore";
import { format, differenceInDays } from "date-fns";
import { formatMoney, useMoney } from "@/lib/currency";

export default function VendorDetailPage() {
  const money = useMoney();
  const params = useParams();
  const router = useRouter();
  const vendorId = params.id as string;

  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [vendor, setVendor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");

  const [addContractOpen, setAddContractOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handleDelete = async () => {
    if (!vendor) return;
    if (!confirm(`Delete vendor "${vendor.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/vendors/${vendorId}/`);
      toast.success("Vendor deleted.");
      router.push("/vendors");
    } catch (err: any) {
      // 409 from server when vendor has linked assets/contracts/licenses.
      toast.error(err.response?.data?.detail || "Failed to delete vendor.");
    }
  };

  useEffect(() => {
    fetchVendor();
    fetchRelatedData();
  }, [vendorId]);

  const fetchVendor = async () => {
    try {
      const res = await api.get(`/vendors/${vendorId}/`);
      setVendor(res.data);
    } catch {
      toast.error("Failed to load vendor details");
    } finally {
      setLoading(false);
    }
  };

  const fetchRelatedData = async () => {
    try {
      const [assRes, licRes, bilRes] = await Promise.all([
        api.get(`/vendors/${vendorId}/assets/`),
        api.get(`/vendors/${vendorId}/licenses/`),
        api.get(`/vendors/${vendorId}/bills/`)
      ]);
      setAssets(assRes.data);
      setLicenses(licRes.data);
      setBills(bilRes.data);
    } catch {
      console.error("Failed to load related data");
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await api.post(`/vendors/notes/`, {
        vendor: vendorId,
        note: newNote
      });
      setNewNote("");
      toast.success("Note added");
      fetchVendor(); // refresh timeline
    } catch {
      toast.error("Failed to add note");
    }
  };

  // A contract carries its own currency; everything else follows the
  // company-wide setting.
  const formatCurrency = (amount: number, currency?: string) =>
    currency
      ? formatMoney(amount, currency, { decimals: 0 })
      : money(amount, { decimals: 0 });

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading vendor details...</div>;
  if (!vendor) return <div className="p-8 text-center text-red-500">Vendor not found</div>;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <Button variant="ghost" size="icon" onClick={() => router.push('/vendors')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">
              {vendor.name}
            </h1>
            <Badge variant="outline" className="font-mono text-xs">{vendor.vendor_code}</Badge>
            {vendor.is_active ? (
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0">Active</Badge>
            ) : (
              <Badge variant="outline" className="text-neutral-500">Inactive</Badge>
            )}
            <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-200 border-0">
              {vendor.category.replace('_', ' ')}
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1 text-sm text-neutral-500">
            {[1,2,3,4,5].map(i => (
              <Star key={i} className={`w-4 h-4 ${i <= (vendor.rating || 0) ? "text-yellow-400 fill-yellow-400" : "text-neutral-200 dark:text-neutral-800"}`} />
            ))}
            <span className="ml-2">{vendor.rating ? `${vendor.rating}/5 Rating` : "No rating"}</span>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Left Column - Contact & Stats */}
        <div className="space-y-6 md:col-span-1">
          <Card className="p-5">
            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <Building className="w-5 h-5 text-violet-500" />
              Company Details
            </h3>
            <div className="space-y-3 text-sm">
              {vendor.website && (
                <div className="flex items-start gap-3">
                  <Globe className="w-4 h-4 text-neutral-400 mt-0.5" />
                  <a href={vendor.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{vendor.website}</a>
                </div>
              )}
              {vendor.email && (
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-neutral-400 mt-0.5" />
                  <span className="text-neutral-700 dark:text-neutral-300">{vendor.email}</span>
                </div>
              )}
              {vendor.phone && (
                <div className="flex items-start gap-3">
                  <Phone className="w-4 h-4 text-neutral-400 mt-0.5" />
                  <span className="text-neutral-700 dark:text-neutral-300">{vendor.phone}</span>
                </div>
              )}
              {(vendor.address || vendor.city || vendor.country) && (
                <div className="flex items-start gap-3 pt-2 border-t mt-2">
                  <div className="text-neutral-700 dark:text-neutral-300">
                    {vendor.address}<br />
                    {[vendor.city, vendor.country].filter(Boolean).join(", ")}
                  </div>
                </div>
              )}
              {vendor.tax_number && (
                <div className="pt-2 border-t mt-2">
                  <span className="text-neutral-500 block text-xs">Tax / NTN</span>
                  <span className="font-mono">{vendor.tax_number}</span>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-violet-500" />
              Primary Contact
            </h3>
            {vendor.primary_contact_name ? (
              <div className="space-y-3 text-sm">
                <div className="font-medium text-base">{vendor.primary_contact_name}</div>
                {vendor.primary_contact_email && (
                  <div className="flex items-start gap-3">
                    <Mail className="w-4 h-4 text-neutral-400 mt-0.5" />
                    <a href={`mailto:${vendor.primary_contact_email}`} className="text-blue-600 hover:underline break-all">{vendor.primary_contact_email}</a>
                  </div>
                )}
                {vendor.primary_contact_phone && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 text-neutral-400 mt-0.5" />
                    <span>{vendor.primary_contact_phone}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-neutral-500 text-sm">No primary contact added.</div>
            )}
          </Card>

          <Card className="p-5 bg-violet-50 dark:bg-violet-900/10 border-violet-100 dark:border-violet-800">
            <h3 className="font-semibold text-violet-800 dark:text-violet-300 mb-2">Total Spend</h3>
            <div className="text-3xl font-bold text-violet-900 dark:text-violet-100">
              {formatCurrency(vendor.total_spend)}
            </div>
          </Card>
        </div>

        {/* Right Column - Tabs */}
        <div className="md:col-span-3">
          <Tabs defaultValue="contracts" className="w-full">
            <TabsList className="w-full justify-start bg-transparent border-b rounded-none p-0 h-auto">
              <TabsTrigger value="contracts" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:bg-transparent py-3 px-4">
                Contracts ({vendor.contracts?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="payments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:bg-transparent py-3 px-4">
                Payments ({vendor.payments?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="assets" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:bg-transparent py-3 px-4">
                Assets ({assets.length})
              </TabsTrigger>
              <TabsTrigger value="licenses" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:bg-transparent py-3 px-4">
                Licenses ({licenses.length})
              </TabsTrigger>
              <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:bg-transparent py-3 px-4">
                Notes
              </TabsTrigger>
            </TabsList>

            <TabsContent value="contracts" className="mt-4">
              <Card>
                <div className="flex justify-between items-center p-4 border-b">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <FileText className="w-5 h-5 text-violet-500" /> Contracts & Agreements
                  </h3>
                  <Button size="sm" onClick={() => setAddContractOpen(true)} className="bg-violet-600 hover:bg-violet-700">
                    <Plus className="w-4 h-4 mr-1" /> Add Contract
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract #</TableHead>
                      <TableHead>Title & Type</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendor.contracts?.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-neutral-500">No contracts found.</TableCell></TableRow>
                    ) : (
                      vendor.contracts?.map((c: any) => {
                        const isExpired = c.status === 'EXPIRED';
                        const daysLeft = c.end_date ? differenceInDays(new Date(c.end_date), new Date()) : null;
                        const isExpiringSoon = c.status === 'ACTIVE' && daysLeft !== null && daysLeft <= 30 && daysLeft >= 0;

                        return (
                          <TableRow key={c.id} className={`${isExpired ? 'bg-red-50/50 dark:bg-red-900/10' : isExpiringSoon ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                            <TableCell className="font-mono text-xs">{c.contract_number}</TableCell>
                            <TableCell>
                              <div className="font-medium text-sm">{c.title}</div>
                              <Badge variant="outline" className="mt-1 text-[10px] uppercase">{c.contract_type}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              <div><span className="text-neutral-500">From:</span> {c.start_date || '—'}</div>
                              <div>
                                <span className="text-neutral-500">To:</span> {c.end_date || '—'}
                                {isExpiringSoon && <span className="text-amber-600 font-medium ml-2 text-xs">({daysLeft} days)</span>}
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              {c.value ? formatCurrency(parseFloat(c.value), c.currency) : '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`
                                ${c.status === 'ACTIVE' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : ''}
                                ${c.status === 'EXPIRED' ? 'border-red-200 text-red-700 bg-red-50' : ''}
                                ${c.status === 'DRAFT' ? 'border-neutral-200 text-neutral-700 bg-neutral-50' : ''}
                              `}>
                                {c.status}
                              </Badge>
                              {c.auto_renew && <div className="text-[10px] text-neutral-500 mt-1 flex items-center"><Clock className="w-3 h-3 mr-1" /> Auto-renews</div>}
                            </TableCell>
                            <TableCell>
                              {c.document && (
                                <a href={c.document} target="_blank" rel="noreferrer" className="text-violet-600 hover:text-violet-800 flex items-center text-sm">
                                  <Download className="w-4 h-4 mr-1" /> Doc
                                </a>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            <TabsContent value="payments" className="mt-4">
              <Card>
                <div className="p-4 border-b">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-violet-500" /> Payment History
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Contract</TableHead>
                      <TableHead>Method & Ref</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendor.payments?.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-neutral-500">No payment records found.</TableCell></TableRow>
                    ) : (
                      vendor.payments?.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap">{format(new Date(p.payment_date), 'MMM d, yyyy')}</TableCell>
                          <TableCell className="text-sm">{p.contract_title || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{p.payment_method.replace('_', ' ')}</Badge>
                            <div className="text-xs text-neutral-500 mt-1 font-mono">{p.reference_number || p.invoice_number}</div>
                          </TableCell>
                          <TableCell className="text-sm text-neutral-600">{p.description}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-600">
                            {formatCurrency(parseFloat(p.amount))}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            <TabsContent value="assets" className="mt-4">
              <Card>
                <div className="p-4 border-b">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Box className="w-5 h-5 text-violet-500" /> Supplied Assets
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset Tag</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Purchase Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-neutral-500">No assets linked to this vendor.</TableCell></TableRow>
                    ) : (
                      assets.map((a: any) => (
                        <TableRow key={a.id} className="cursor-pointer hover:bg-neutral-50" onClick={() => router.push(`/assets/${a.id}`)}>
                          <TableCell className="font-mono text-xs">{a.asset_tag}</TableCell>
                          <TableCell className="font-medium text-sm text-violet-600">{a.name}</TableCell>
                          <TableCell className="text-sm">{a.purchase_date || '—'}</TableCell>
                          <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            <TabsContent value="licenses" className="mt-4">
              <Card>
                <div className="p-4 border-b">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-violet-500" /> Supplied Licenses
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Seats</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {licenses.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-neutral-500">No licenses linked to this vendor.</TableCell></TableRow>
                    ) : (
                      licenses.map((l: any) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium text-sm text-violet-600">{l.product_name}</TableCell>
                          <TableCell className="text-sm"><Badge variant="outline">{l.license_type}</Badge></TableCell>
                          <TableCell className="text-sm">{l.seats_used} / {l.seats_total || '∞'}</TableCell>
                          <TableCell>
                            {l.is_expired ? <Badge variant="destructive">Expired</Badge> : <Badge className="bg-emerald-100 text-emerald-800">Active</Badge>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card className="p-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                  <MessageSquare className="w-5 h-5 text-violet-500" /> Vendor Notes Timeline
                </h3>
                
                <div className="flex gap-2 mb-8">
                  <Input 
                    placeholder="Add a new note or update..." 
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                  />
                  <Button onClick={handleAddNote} className="bg-violet-600 hover:bg-violet-700">Add Note</Button>
                </div>

                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-neutral-200 before:to-transparent">
                  {vendor.notes?.length === 0 ? (
                    <div className="text-center text-neutral-500 py-4 relative z-10">No notes recorded yet.</div>
                  ) : (
                    vendor.notes?.map((note: any) => (
                      <div key={note.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-neutral-100 dark:bg-neutral-800 text-neutral-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border bg-white dark:bg-neutral-900 shadow-sm">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">{note.created_by_name}</span>
                            <span className="text-xs text-neutral-500">{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                          </div>
                          <p className="text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">{note.note}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <AddContractDialog
        vendorId={parseInt(vendorId)}
        open={addContractOpen}
        onOpenChange={setAddContractOpen}
        onSuccess={() => fetchVendor()}
      />

      <AddVendorDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={() => fetchVendor()}
        initial={vendor}
      />
    </div>
  );
}
