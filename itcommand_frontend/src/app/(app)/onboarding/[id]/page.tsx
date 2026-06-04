"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ListTodo, ArrowLeft, Calendar, CheckCircle2, Clock, Check, Users, Monitor, Lock, ShieldCheck, MapPin, Building2, Box, ShoppingCart, FileText } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CATEGORY_ICONS: any = {
  ACCOUNTS: <Users className="w-4 h-4 text-blue-500" />,
  HARDWARE: <Monitor className="w-4 h-4 text-emerald-500" />,
  SOFTWARE: <ListTodo className="w-4 h-4 text-violet-500" />,
  ACCESS: <Lock className="w-4 h-4 text-amber-500" />,
  SECURITY: <ShieldCheck className="w-4 h-4 text-red-500" />,
  DEFAULT: <CheckCircle2 className="w-4 h-4 text-neutral-500" />
};

export default function OnboardingDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [seatAssignment, setSeatAssignment] = useState<any>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatDialogOpen, setSeatDialogOpen] = useState(false);
  const [offices, setOffices] = useState<any[]>([]);
  const [floors, setFloors] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<any>(null);
  const [selectedFloor, setSelectedFloor] = useState<any>(null);
  const [availableSeats, setAvailableSeats] = useState<any[]>([]);
  const [assigningSeat, setAssigningSeat] = useState(false);

  // ─── Assign-asset dialog ───────────────────────────────────────
  const [assignAssetTask, setAssignAssetTask] = useState<any>(null);
  const [availableAssets, setAvailableAssets] = useState<any[]>([]);
  const [assigningAsset, setAssigningAsset] = useState(false);

  // ─── Create-PR dialog ──────────────────────────────────────────
  const [createPrTask, setCreatePrTask] = useState<any>(null);
  const [prDraft, setPrDraft] = useState({
    title: "",
    item_name: "",
    item_category: "HARDWARE",
    quantity: "1",
    estimated_unit_price: "",
    justification: "",
  });
  const [creatingPr, setCreatingPr] = useState(false);

  useEffect(() => {
    fetchRecord();
  }, [params.id]);

  const fetchRecord = async () => {
    try {
      const res = await api.get(`/onboarding/records/${params.id}/`);
      setRecord(res.data);
    } catch {
      toast.error("Failed to load record details");
      router.push("/onboarding");
    } finally {
      setLoading(false);
    }
  };

  const fetchSeatAssignment = async (employeeId: number) => {
    setSeatLoading(true);
    try {
      const res = await api.get(`/seating/users/${employeeId}/seat/`);
      setSeatAssignment(res.data);
    } catch {
      setSeatAssignment(null);
    } finally {
      setSeatLoading(false);
    }
  };

  useEffect(() => {
    if (!record?.employee) return;
    fetchSeatAssignment(record.employee);
  }, [record?.employee]);

  const toggleTaskStatus = async (task: any) => {
    const newStatus = task.status === "DONE" ? "PENDING" : "DONE";
    try {
      await api.patch(`/onboarding/tasks/${task.id}/`, { status: newStatus });
      fetchRecord(); // Refresh to get updated stats and times
    } catch {
      toast.error("Failed to update task");
    }
  };

  const markAllComplete = async () => {
    if (!confirm("Are you sure you want to mark this entire record as complete?")) return;
    try {
      await api.post(`/onboarding/records/${record.id}/complete/`);
      toast.success("Record marked as completed");
      fetchRecord();
    } catch {
      toast.error("Failed to complete record");
    }
  };

  const deleteRecord = async () => {
    if (!record) return;
    if (!confirm(`Delete onboarding record for ${record.employee_name}? All tasks attached to it will be removed.`)) return;
    try {
      await api.delete(`/onboarding/records/${record.id}/`);
      toast.success("Record deleted.");
      router.push("/onboarding");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete record.");
    }
  };

  const markSeatTaskDoneIfPresent = async (kind: "assign" | "vacate") => {
    const titleNeedle = kind === "assign" ? "Assign workstation seat" : "Vacate and reassign seat";
    const task = record?.tasks?.find((t: any) => (t.title || "").toLowerCase() === titleNeedle.toLowerCase());
    if (!task) return;
    if (task.status === "DONE") return;
    try {
      await api.patch(`/onboarding/tasks/${task.id}/`, { status: "DONE" });
    } catch {
      // non-blocking
    }
  };

  const openSeatDialog = async () => {
    setSeatDialogOpen(true);
    try {
      const officesRes = await api.get("/seating/offices/");
      const officesData = officesRes.data.results || officesRes.data;
      setOffices(officesData);
      if (officesData.length > 0) {
        setSelectedOffice(officesData[0]);
        const floorsRes = await api.get(`/seating/offices/${officesData[0].id}/floors/`);
        setFloors(floorsRes.data);
        if (floorsRes.data.length > 0) {
          setSelectedFloor(floorsRes.data[0]);
          await loadAvailableSeats(floorsRes.data[0].id);
        }
      }
    } catch {
      toast.error("Failed to load seating options");
    }
  };

  const loadAvailableSeats = async (floorId: number) => {
    const res = await api.get(`/seating/floors/${floorId}/layout/`);
    const seats = res.data?.seats || [];
    const available = seats.filter((s: any) => !s.is_occupied && ["WORKSTATION", "CABIN", "HOT_DESK"].includes(s.seat_type));
    setAvailableSeats(available);
  };

  const handleOfficeChange = async (officeId: string) => {
    const office = offices.find((o) => String(o.id) === officeId);
    if (!office) return;
    setSelectedOffice(office);
    setSelectedFloor(null);
    setAvailableSeats([]);
    try {
      const floorsRes = await api.get(`/seating/offices/${office.id}/floors/`);
      setFloors(floorsRes.data);
      if (floorsRes.data.length > 0) {
        setSelectedFloor(floorsRes.data[0]);
        await loadAvailableSeats(floorsRes.data[0].id);
      }
    } catch {
      toast.error("Failed to load floors");
    }
  };

  const handleFloorChange = async (floorId: string) => {
    const floor = floors.find((f) => String(f.id) === floorId);
    if (!floor) return;
    setSelectedFloor(floor);
    setAvailableSeats([]);
    try {
      await loadAvailableSeats(floor.id);
    } catch {
      toast.error("Failed to load seats");
    }
  };

  const assignSelectedSeat = async (seatId: number) => {
    if (!record?.employee) return;
    setAssigningSeat(true);
    try {
      await api.post(`/seating/seats/${seatId}/assign/`, { user_id: record.employee });
      toast.success("Seat assigned");
      setSeatDialogOpen(false);
      await fetchSeatAssignment(record.employee);
      await markSeatTaskDoneIfPresent("assign");
      fetchRecord();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to assign seat");
    } finally {
      setAssigningSeat(false);
    }
  };

  const vacateCurrentSeat = async () => {
    if (!seatAssignment?.seat) {
      toast.error("No active seat assignment");
      return;
    }
    if (!confirm("Vacate this employee's seat?")) return;
    try {
      await api.post(`/seating/seats/${seatAssignment.seat}/vacate/`);
      toast.success("Seat vacated");
      setSeatAssignment(null);
      await markSeatTaskDoneIfPresent("vacate");
      fetchRecord();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to vacate seat");
    }
  };

  // ─── Asset / PR actions ───────────────────────────────────────

  const openAssignAsset = async (task: any) => {
    setAssignAssetTask(task);
    setAvailableAssets([]);
    try {
      // Fetch assets currently available (non-bulk single rows OR bulk rows
      // with quantity_available > 0). Backend filter only accepts status,
      // so we fetch AVAILABLE + locally include bulk rows with stock.
      const [availRes, allRes] = await Promise.all([
        api.get("/assets/?status=AVAILABLE"),
        api.get("/assets/"),
      ]);
      const avail = (availRes.data?.results || availRes.data) as any[];
      const all = (allRes.data?.results || allRes.data) as any[];
      const bulkWithStock = all.filter(
        (a: any) => a.is_bulk && (a.quantity_available ?? 0) > 0,
      );
      // Merge, prefer 'avail' rows (already AVAILABLE); deduplicate by id.
      const map = new Map<number, any>();
      [...avail, ...bulkWithStock].forEach((a) => map.set(a.id, a));
      setAvailableAssets(Array.from(map.values()));
    } catch {
      toast.error("Failed to load inventory.");
    }
  };

  const assignAssetToEmployee = async (asset: any) => {
    if (!record?.employee || !assignAssetTask) return;
    setAssigningAsset(true);
    try {
      if (asset.is_bulk) {
        await api.post(`/assets/${asset.id}/assign_unit/`, {
          user_id: record.employee,
          quantity: 1,
          notes: `Auto-assigned from onboarding task "${assignAssetTask.title}"`,
        });
      } else {
        await api.post(`/assets/${asset.id}/assign/`, {
          user_id: record.employee,
          note: `Auto-assigned from onboarding task "${assignAssetTask.title}"`,
        });
      }
      // Mark the originating task complete.
      await api.patch(`/onboarding/tasks/${assignAssetTask.id}/`, {
        status: "DONE",
        description: `${assignAssetTask.description || ""}\n[Asset assigned: ${asset.asset_tag} · ${asset.name}]`.trim(),
      });
      toast.success(`${asset.asset_tag} assigned to ${record.employee_name}.`);
      setAssignAssetTask(null);
      fetchRecord();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Assign failed.");
    } finally {
      setAssigningAsset(false);
    }
  };

  const openCreatePr = (task: any) => {
    setCreatePrTask(task);
    const defaultTitle = `${task.title} — for ${record?.employee_name || "new hire"}`;
    setPrDraft({
      title: defaultTitle,
      item_name: task.title.replace(/^Add\s+|^Order\s+|^Provision\s+/i, "").trim() || task.title,
      item_category: "HARDWARE",
      quantity: "1",
      estimated_unit_price: "",
      justification: task.description ||
        `Required for onboarding of ${record?.employee_name || "new hire"}.`,
    });
  };

  const submitCreatePr = async () => {
    if (!createPrTask) return;
    if (!prDraft.item_name.trim()) {
      toast.error("Item name is required.");
      return;
    }
    setCreatingPr(true);
    try {
      // 1) Create the PR (DRAFT)
      const createRes = await api.post("/procurement/requests/", {
        title: prDraft.title || `Procurement for ${record?.employee_name || ""}`,
        priority: "NORMAL",
        justification: prDraft.justification,
        items: [
          {
            item_name: prDraft.item_name,
            category: prDraft.item_category,
            quantity: parseInt(prDraft.quantity || "1", 10) || 1,
            estimated_unit_price: prDraft.estimated_unit_price
              ? parseFloat(prDraft.estimated_unit_price)
              : 0,
          },
        ],
      });
      const newPr = createRes.data;
      // 2) Submit it for approval
      try {
        await api.post(`/procurement/requests/${newPr.id}/submit/`, {
          comment: `Triggered from onboarding task: ${createPrTask.title}`,
        });
      } catch {
        /* leave as DRAFT if submit fails */
      }
      // 3) Stamp the task with the PR link
      await api.patch(`/onboarding/tasks/${createPrTask.id}/`, {
        description: `${createPrTask.description || ""}\n[PR created: ${newPr.pr_number}]`.trim(),
      });
      toast.success(`PR ${newPr.pr_number} created and submitted.`);
      setCreatePrTask(null);
      fetchRecord();
    } catch (err: any) {
      toast.error(
        err.response?.data?.detail || JSON.stringify(err.response?.data) || "Failed to create PR.",
      );
    } finally {
      setCreatingPr(false);
    }
  };

  if (loading || !record) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Group tasks by category
  const tasksByCategory = record.tasks.reduce((acc: any, task: any) => {
    if (!acc[task.category]) acc[task.category] = [];
    acc[task.category].push(task);
    return acc;
  }, {});

  const isCompleted = record.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-6">
        <Button variant="ghost" size="icon" onClick={() => router.push("/onboarding")}>
          <ArrowLeft className="h-5 w-5 text-neutral-500" />
        </Button>
        <Avatar className="h-16 w-16 border-2 border-white shadow-sm">
          <AvatarImage src={record.employee_avatar} />
          <AvatarFallback className="text-xl bg-violet-100 text-violet-700 font-bold">
            {record.employee_name?.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{record.employee_name}</h1>
            <Badge className={record.process_type === 'ONBOARDING' ? 'bg-emerald-100 text-emerald-800 border-0' : 'bg-red-100 text-red-800 border-0'}>
              {record.process_type}
            </Badge>
            <Badge variant={isCompleted ? 'default' : 'outline'} className={isCompleted ? 'bg-neutral-800 text-white border-0' : ''}>
              {record.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-neutral-500 text-sm mt-1">{record.template_name}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isCompleted && (
            <Button variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" onClick={markAllComplete}>
              <Check className="w-4 h-4 mr-2" /> Mark Completed
            </Button>
          )}
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={deleteRecord}
          >
            Delete record
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {Object.entries(tasksByCategory).map(([category, tasks]: [string, any]) => (
            <Card key={category}>
              <CardHeader className="py-3 px-4 bg-neutral-50 dark:bg-neutral-900 border-b flex flex-row items-center gap-2">
                {CATEGORY_ICONS[category] || CATEGORY_ICONS.DEFAULT}
                <CardTitle className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 tracking-wider">
                  {category}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {tasks.map((task: any) => (
                    <div key={task.id} className={`p-4 flex gap-4 items-start hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors ${task.status === 'DONE' ? 'opacity-60' : ''}`}>
                      <button 
                        onClick={() => toggleTaskStatus(task)}
                        className={`mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                          task.status === 'DONE' 
                            ? 'bg-emerald-500 border-emerald-500 text-white' 
                            : 'border-neutral-300 text-transparent hover:border-emerald-500'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex-1 space-y-1">
                        <div className={`font-medium text-sm ${task.status === 'DONE' ? 'line-through text-neutral-500' : ''}`}>
                          {task.title}
                        </div>
                        {task.description && (
                          <div className="text-xs text-neutral-500 whitespace-pre-wrap">{task.description}</div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[10px] py-0 h-5 text-neutral-500">
                            {task.assigned_role}
                          </Badge>
                          {task.due_date && (
                            <Badge variant="outline" className={`text-[10px] py-0 h-5 border-0 ${new Date(task.due_date) < new Date() && task.status !== 'DONE' ? 'bg-red-100 text-red-800' : 'bg-neutral-100 text-neutral-600'}`}>
                              <Calendar className="w-3 h-3 mr-1 inline" /> {task.due_date}
                            </Badge>
                          )}
                          {task.status === 'DONE' && task.completed_at && (
                            <span className="text-[10px] text-neutral-400">
                              Completed {new Date(task.completed_at).toLocaleDateString()} by {task.completed_by_name || 'System'}
                            </span>
                          )}
                        </div>
                        {/* Inline asset actions for hardware-related tasks */}
                        {(task.category === "HARDWARE" || task.category === "SOFTWARE") &&
                         task.status !== "DONE" && record.process_type === "ONBOARDING" && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => openAssignAsset(task)}
                            >
                              <Box className="w-3.5 h-3.5 mr-1.5" /> Assign from inventory
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => openCreatePr(task)}
                            >
                              <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Create PR
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-6">
          {/* Seat assignment (fast path) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-violet-500" /> Seat Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {seatLoading ? (
                <div className="text-sm text-neutral-500">Loading seat...</div>
              ) : seatAssignment ? (
                <div className="rounded-lg border p-3 bg-neutral-50 dark:bg-neutral-900/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-neutral-500">Current seat</div>
                      <div className="font-bold">{seatAssignment.seat_code || `Seat #${seatAssignment.seat}`}</div>
                    </div>
                    <Badge className="bg-blue-100 text-blue-800 border-0">Occupied</Badge>
                  </div>
                  <div className="text-xs text-neutral-500 mt-2">
                    Assigned on {seatAssignment.assigned_date ? new Date(seatAssignment.assigned_date).toLocaleDateString() : "—"}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button variant="outline" className="w-full text-red-600 border-red-200 hover:bg-red-50" onClick={vacateCurrentSeat}>
                      Vacate
                    </Button>
                    <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={openSeatDialog}>
                      Reassign
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border p-3 bg-neutral-50 dark:bg-neutral-900/40">
                  <div className="text-sm font-medium">No seat assigned</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Assign a workstation seat to complete the hardware setup.
                  </div>
                  <Button className="w-full mt-3 bg-emerald-600 hover:bg-emerald-700" onClick={openSeatDialog}>
                    Assign seat
                  </Button>
                </div>
              )}

              {record.process_type === "OFFBOARDING" && (
                <div className="text-[11px] text-neutral-500">
                  Offboarding tip: vacate seat as soon as the employee leaves to free capacity.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-bold">Progress Tracking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium">{record.progress_stats?.percentage || 0}% Completed</span>
                  <span className="text-neutral-500">{record.progress_stats?.completed || 0}/{record.progress_stats?.total || 0}</span>
                </div>
                <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-2.5">
                  <div 
                    className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500" 
                    style={{ width: `${record.progress_stats?.percentage || 0}%` }}
                  ></div>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-500 flex items-center gap-2"><Clock className="w-4 h-4"/> Started</span>
                  <span className="font-medium">{record.start_date || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500 flex items-center gap-2"><Calendar className="w-4 h-4"/> Target Date</span>
                  <span className="font-medium">{record.target_completion_date || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500 flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Completed</span>
                  <span className="font-medium">{record.actual_completion_date || 'N/A'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-bold">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
                {record.notes || "No additional notes provided."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Seat picker dialog */}
      <Dialog open={seatDialogOpen} onOpenChange={setSeatDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Assign seat for {record.employee_name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border p-3 bg-neutral-50 dark:bg-neutral-900/40 space-y-3">
              <div className="text-xs text-neutral-500 flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Choose location
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Tabs
                  value={selectedOffice?.id?.toString() || ""}
                  onValueChange={handleOfficeChange}
                  className="w-full"
                >
                  <TabsList className="w-full justify-start overflow-auto">
                    {offices.map((o) => (
                      <TabsTrigger key={o.id} value={o.id.toString()} className="whitespace-nowrap">
                        {o.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {floors.length > 0 && (
                  <Tabs value={selectedFloor?.id?.toString() || ""} onValueChange={handleFloorChange} className="w-full">
                    <TabsList className="w-full justify-start overflow-auto bg-transparent border">
                      {floors.map((f) => (
                        <TabsTrigger key={f.id} value={f.id.toString()} className="whitespace-nowrap">
                          {f.floor_name}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
              </div>
              <div className="text-xs text-neutral-500">
                Available seats: <span className="font-semibold">{availableSeats.length}</span>
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
              <Command shouldFilter={true}>
                <CommandInput placeholder="Search available seat code..." />
                <CommandList>
                  <CommandEmpty>No seats available on this floor.</CommandEmpty>
                  <CommandGroup heading="Available seats">
                    {availableSeats.slice(0, 200).map((s: any) => (
                      <CommandItem
                        key={s.id}
                        value={`${s.seat_code} ${s.label || ""}`}
                        onSelect={() => assignSelectedSeat(s.id)}
                        disabled={assigningSeat}
                      >
                        <span className="font-mono text-xs">{s.seat_code}</span>
                        {s.label ? <span className="text-xs text-muted-foreground ml-2">{s.label}</span> : null}
                        <span className="ml-auto text-xs text-emerald-600">Assign</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign existing asset dialog */}
      <Dialog open={!!assignAssetTask} onOpenChange={(v) => !v && setAssignAssetTask(null)}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle>Assign asset to {record.employee_name}</DialogTitle>
          </DialogHeader>
          <div className="p-4 pt-0">
            <div className="text-xs text-muted-foreground mb-2">
              Linked to onboarding task: <span className="font-medium">{assignAssetTask?.title}</span>
            </div>
            <Command shouldFilter={true}>
              <CommandInput placeholder="Search by tag, name, brand…" />
              <CommandList className="max-h-80">
                <CommandEmpty>No available assets found.</CommandEmpty>
                <CommandGroup heading="Available">
                  {availableAssets.map((a: any) => (
                    <CommandItem
                      key={a.id}
                      value={`${a.asset_tag} ${a.name} ${a.brand || ""} ${a.model || ""}`}
                      onSelect={() => !assigningAsset && assignAssetToEmployee(a)}
                      disabled={assigningAsset}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div>
                          <div className="font-medium text-sm">{a.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            <span className="font-mono">{a.asset_tag}</span>
                            {a.brand && <> · {a.brand} {a.model || ""}</>}
                            {a.is_bulk && <> · {a.quantity_available}/{a.quantity_total} available</>}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{a.category_name || a.asset_type}</Badge>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create PR dialog */}
      <Dialog open={!!createPrTask} onOpenChange={(v) => !v && setCreatePrTask(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create PR for {record.employee_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-xs text-muted-foreground">
              Linked to onboarding task: <span className="font-medium">{createPrTask?.title}</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">PR title</label>
              <Input
                value={prDraft.title}
                onChange={(e) => setPrDraft({ ...prDraft, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Item name <span className="text-destructive">*</span></label>
                <Input
                  value={prDraft.item_name}
                  onChange={(e) => setPrDraft({ ...prDraft, item_name: e.target.value })}
                  placeholder="Laptop, Monitor…"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Item category</label>
                <Select
                  value={prDraft.item_category}
                  onValueChange={(v) => setPrDraft({ ...prDraft, item_category: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HARDWARE">Hardware</SelectItem>
                    <SelectItem value="SOFTWARE">Software</SelectItem>
                    <SelectItem value="PERIPHERAL">Peripheral</SelectItem>
                    <SelectItem value="SERVICE">Service</SelectItem>
                    <SelectItem value="CONSUMABLE">Consumable</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Quantity</label>
                <Input
                  type="number"
                  min="1"
                  value={prDraft.quantity}
                  onChange={(e) => setPrDraft({ ...prDraft, quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Estimated unit price</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={prDraft.estimated_unit_price}
                  onChange={(e) => setPrDraft({ ...prDraft, estimated_unit_price: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Justification</label>
              <Textarea
                value={prDraft.justification}
                onChange={(e) => setPrDraft({ ...prDraft, justification: e.target.value })}
                className="min-h-20"
              />
            </div>
            <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <FileText className="h-3 w-3 mt-0.5 shrink-0" />
              PR is created as DRAFT and immediately submitted for approval. The onboarding task gets a link to the PR.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatePrTask(null)} disabled={creatingPr}>Cancel</Button>
            <Button onClick={submitCreatePr} disabled={creatingPr || !prDraft.item_name.trim()}>
              {creatingPr ? "Creating…" : "Create & submit PR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
