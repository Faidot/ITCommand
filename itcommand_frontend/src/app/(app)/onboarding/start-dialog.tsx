"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, UserPlus, UserMinus } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function StartOnboardingDialog({ 
  onSuccess, 
  processType = "ONBOARDING" 
}: { 
  onSuccess: () => void;
  processType?: "ONBOARDING" | "OFFBOARDING";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  
  const [userId, setUserId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchUsers();
      fetchTemplates();
      setUserId("");
      setTemplateId("");
      setStartDate(new Date().toISOString().split("T")[0]);
      setTargetDate("");
      setNotes("");
    }
  }, [open]);

  const fetchUsers = async () => {
    try {
      const res = await api.get("/users/");
      setUsers(res.data.results || res.data);
    } catch {
      toast.error("Failed to load users");
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await api.get("/onboarding/templates/");
      const allTemplates = res.data.results || res.data;
      setTemplates(allTemplates.filter((t: any) => t.process_type === processType && t.is_active));
    } catch {
      toast.error("Failed to load templates");
    }
  };

  const handleSubmit = async () => {
    if (!userId || !templateId) {
      toast.error("User and Template are required");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/onboarding/records/", {
        employee: parseInt(userId),
        template: parseInt(templateId),
        process_type: processType,
        start_date: startDate || null,
        target_completion_date: targetDate || null,
        status: "IN_PROGRESS",
        notes
      });
      toast.success(`${processType === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'} started successfully`);
      setOpen(false);
      onSuccess();
      router.push(`/onboarding/${res.data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to start process");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button 
        onClick={() => setOpen(true)} 
        className={processType === 'ONBOARDING' ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
      >
        {processType === 'ONBOARDING' ? <UserPlus className="mr-2 h-4 w-4" /> : <UserMinus className="mr-2 h-4 w-4" />}
        Start {processType === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Start {processType === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id.toString()}>{u.full_name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Checklist Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id.toString()}>{t.name} {t.department_name ? `(${t.department_name})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Target Completion</Label>
                <Input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional context..." />
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={handleSubmit} disabled={loading} className="bg-violet-600 hover:bg-violet-700">
                {loading ? "Starting..." : "Start Process"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
