"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api from "@/lib/api";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";

export function AssignSeatDialog({ 
  licenseId, 
  disabled, 
  onSuccess 
}: { 
  licenseId: string | number; 
  disabled: boolean;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchUsers();
      setSelectedUserId("");
      setNotes("");
    }
  }, [open]);

  const fetchUsers = async () => {
    try {
      // Assuming there's a /users/ endpoint or similar we can fetch from
      const res = await api.get("/users/");
      setUsers(res.data.results || res.data);
    } catch {
      toast.error("Failed to load users");
    }
  };

  const handleSubmit = async () => {
    if (!selectedUserId) {
      toast.error("Please select a user");
      return;
    }

    setLoading(true);
    try {
      await api.post(`/licenses/${licenseId}/assign/`, {
        user_id: parseInt(selectedUserId),
        notes: notes
      });
      toast.success("Seat assigned successfully");
      setOpen(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to assign seat");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button 
        size="sm" 
        className="bg-violet-600 hover:bg-violet-700" 
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <UserPlus className="mr-2 h-4 w-4" /> Assign Seat
      </Button>
      
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Assign License Seat</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id.toString()}>
                      {u.full_name || u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input 
                value={notes} 
                onChange={e => setNotes(e.target.value)} 
                placeholder="Reason for assignment..." 
              />
            </div>
            <div className="flex justify-end pt-4">
              <Button onClick={handleSubmit} disabled={loading} className="bg-violet-600 hover:bg-violet-700">
                {loading ? "Assigning..." : "Assign Seat"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
