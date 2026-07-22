"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { listFromResponse, type UserOption } from "./subscription-types";

export function AssignSeatDialog({
  subscriptionId,
  disabled,
  disabledReason,
  onSuccess,
}: {
  subscriptionId: string | number;
  disabled: boolean;
  disabledReason?: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // The subscriptions options endpoint exposes users without requiring the
  // separate Users module permission, so a subscriptions manager can staff
  // seats without being granted access to the whole user directory.
  const fetchUsers = useCallback(async () => {
    try {
      const response = await api.get<unknown>("/subscriptions/options/");
      const data = response.data as { users?: unknown };
      setUsers(listFromResponse<UserOption>(data?.users));
    } catch {
      toast.error("Could not load the list of people.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedUserId("");
    setNotes("");
    void fetchUsers();
  }, [open, fetchUsers]);

  const handleSubmit = async () => {
    if (!selectedUserId) {
      toast.error("Please choose a person.");
      return;
    }
    setLoading(true);
    try {
      await api.post(`/subscriptions/${subscriptionId}/assign/`, {
        user_id: Number(selectedUserId),
        notes,
      });
      toast.success("Seat assigned.");
      setOpen(false);
      onSuccess();
    } catch (error) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not assign the seat.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => setOpen(true)}
      >
        <UserPlus className="mr-2 h-4 w-4" /> Assign seat
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Assign a seat</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="assign-seat-user">Person</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id="assign-seat-user">
                  <SelectValue placeholder="Choose a person" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={String(user.id)}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign-seat-notes">Notes (optional)</Label>
              <Input
                id="assign-seat-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Why this person needs access…"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => void handleSubmit()} disabled={loading}>
                {loading ? "Assigning…" : "Assign seat"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
