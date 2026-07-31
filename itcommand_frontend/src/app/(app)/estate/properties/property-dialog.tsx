"use client";

/** Add or edit a property — a domain, app or site we own. */

import { useEffect, useState } from "react";
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

import { EstateProperty, errorMessage, resultsOf } from "../estate-types";

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

interface FormValues {
  name: string;
  kind: string;
  owner: string;
  department: string;
  notes: string;
  is_active: boolean;
}

const BLANK: FormValues = {
  name: "",
  kind: "APP",
  owner: "none",
  department: "none",
  notes: "",
  is_active: true,
};

export function PropertyDialog({
  open,
  onOpenChange,
  property,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: EstateProperty | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<FormValues>(BLANK);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<{ id: number; full_name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setValues(
      property
        ? {
            name: property.name,
            kind: property.kind || "APP",
            owner: property.owner ? String(property.owner) : "none",
            department: property.department ? String(property.department) : "none",
            notes: property.notes,
            is_active: property.is_active,
          }
        : BLANK,
    );

    void (async () => {
      const [people, depts] = await Promise.allSettled([
        api.get<unknown>("/users/?page_size=200"),
        api.get<unknown>("/departments/?page_size=200"),
      ]);
      if (people.status === "fulfilled") {
        setUsers(
          resultsOf(people.value.data, (row) => ({
            id: Number(row.id ?? 0),
            full_name: String(row.full_name ?? ""),
          })).filter((row) => row.id > 0),
        );
      }
      if (depts.status === "fulfilled") {
        setDepartments(
          resultsOf(depts.value.data, (row) => ({
            id: Number(row.id ?? 0),
            name: String(row.name ?? ""),
          })).filter((row) => row.id > 0),
        );
      }
    })();
  }, [open, property]);

  const submit = async () => {
    if (!values.name.trim()) {
      toast.error("A property needs a name.");
      return;
    }
    const payload = {
      name: values.name.trim(),
      kind: values.kind,
      owner: values.owner === "none" ? null : Number(values.owner),
      department: values.department === "none" ? null : Number(values.department),
      notes: values.notes.trim(),
      is_active: values.is_active,
    };

    setSaving(true);
    try {
      if (property) {
        await api.patch(`/estate/properties/${property.id}/`, payload);
        toast.success("Property updated.");
      } else {
        await api.post("/estate/properties/", payload);
        toast.success("Property added.");
      }
      onSaved();
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
          <DialogTitle>{property ? "Edit property" : "Add property"}</DialogTitle>
          <DialogDescription>
            Something the company owns and expects to keep working: a domain, an
            app, a marketing site.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="property-name" className="text-xs">
                Name
              </Label>
              <Input
                id="property-name"
                value={values.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kind</Label>
              <Select value={values.kind} onValueChange={(value) => set("kind", value)}>
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Owner</Label>
              <Select value={values.owner} onValueChange={(value) => set("owner", value)}>
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
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select
                value={values.department}
                onValueChange={(value) => set("department", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={String(department.id)}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="property-notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="property-notes"
              rows={2}
              value={values.notes}
              onChange={(event) => set("notes", event.target.value)}
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
              checked={values.is_active}
              onCheckedChange={(checked) => set("is_active", checked === true)}
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

export default PropertyDialog;
