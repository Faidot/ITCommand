"use client";

/** Add or edit a digital property. Single form, same shape as every other
 *  create/edit dialog in the app. */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { DigitalProperty } from "./estate-types";

/** Mirrors `core.estate.PROPERTY_KINDS`. Phase 4 moves this behind the
 *  ListOfValues registry, at which point this list comes from the API. */
const PROPERTY_KINDS = [
  ["MOBILE_GAME", "Mobile game"],
  ["APP", "App"],
  ["MARKETING", "Marketing site"],
  ["CORPORATE", "Corporate site"],
  ["STUDIO", "Studio site"],
  ["INFRA", "Infrastructure domain"],
  ["PARKED", "Parked"],
  ["OTHER", "Other"],
] as const;

function errorMessage(reason: unknown, fallback: string): string {
  const data = (reason as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") {
        return field === "detail" || field === "non_field_errors" ? first : `${field}: ${first}`;
      }
    }
  }
  return fallback;
}

export function PropertyDialog({
  open,
  onOpenChange,
  property,
  users,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: DigitalProperty | null;
  users: { id: number; full_name: string }[];
  departments: { id: number; name: string }[];
  onSaved: (saved: DigitalProperty) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("OTHER");
  const [owner, setOwner] = useState("none");
  const [department, setDepartment] = useState("none");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(property?.name ?? "");
    setKind(property?.kind ?? "OTHER");
    setOwner(property?.owner ? String(property.owner) : "none");
    setDepartment(property?.department ? String(property.department) : "none");
    setNotes(property?.notes ?? "");
    setIsActive(property?.is_active ?? true);
  }, [open, property]);

  const normalizedName = useMemo(() => name.trim().toLowerCase(), [name]);

  const submit = async () => {
    if (!normalizedName) {
      toast.error("A property needs a name — the domain or app identifier.");
      return;
    }

    const payload = {
      name: normalizedName,
      kind,
      owner: owner === "none" ? null : Number(owner),
      department: department === "none" ? null : Number(department),
      notes: notes.trim(),
      is_active: isActive,
    };

    setSaving(true);
    try {
      const response = property
        ? await api.patch(`/estate/properties/${property.id}/`, payload)
        : await api.post("/estate/properties/", payload);
      toast.success(property ? "Property updated." : "Property added.");
      onSaved(response.data as DigitalProperty);
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save the property."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{property ? `Edit ${property.name}` : "Add property"}</DialogTitle>
          <DialogDescription>
            Something the company owns and expects to keep working — a domain, an app, a site.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="property-name" className="text-xs">
              Name
            </Label>
            <Input
              id="property-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="example.com"
            />
            <p className="text-[11px] text-muted-foreground">
              Stored lower-case, so Example.com and example.com are the same property.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_KINDS.map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Owner</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {users.map((person) => (
                    <SelectItem key={person.id} value={String(person.id)}>
                      {person.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Department</Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={String(dept.id)}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="property-notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="property-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="property-active" className="text-sm">
                Active
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Retired properties keep their history but drop out of gap reporting.
              </p>
            </div>
            <Switch
              id="property-active"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : property ? "Save changes" : "Add property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
