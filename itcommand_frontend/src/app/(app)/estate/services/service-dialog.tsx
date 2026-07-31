"use client";

/**
 * Edit one service — a single form, not the wizard.
 *
 * The five-step flow exists because *creating* a service means discovering
 * facts in order: you know which login bought it before you know what it costs.
 * Editing is the opposite — you already know everything and want to change one
 * field. Walking five steps to correct a renewal date would be a worse tool.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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

import {
  EstateProperty,
  ProviderAccount,
  Service,
  ServiceTypeDef,
  errorMessage,
  normalizeAccount,
  normalizeProperty,
  normalizeServiceType,
  resultsOf,
} from "../estate-types";

const BILLING_CYCLES = [
  ["MONTHLY", "Monthly"],
  ["YEARLY", "Yearly"],
  ["USAGE", "Usage-based"],
  ["FREE", "Free"],
] as const;

const STATUSES = [
  ["ACTIVE", "Active"],
  ["AT_RISK", "At risk"],
  ["EXPIRED", "Expired"],
  ["CANCELLED", "Cancelled"],
] as const;

interface FormValues {
  service_type: string;
  identifier: string;
  provider_account: string;
  property: string;
  status: string;
  renewal_date: string;
  auto_renew: boolean;
  cost: string;
  currency: string;
  billing_cycle: string;
  console_url: string;
  notes: string;
}

export function ServiceDialog({
  open,
  onOpenChange,
  service,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<FormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [properties, setProperties] = useState<EstateProperty[]>([]);
  const [types, setTypes] = useState<ServiceTypeDef[]>([]);

  const set = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
      setValues((current) => (current ? { ...current, [key]: value } : current)),
    [],
  );

  useEffect(() => {
    if (!open || !service) return;
    setValues({
      service_type: service.service_type,
      identifier: service.identifier,
      provider_account: service.provider_account
        ? String(service.provider_account)
        : "",
      property: service.property ? String(service.property) : "none",
      status: service.status,
      renewal_date: service.renewal_date ?? "",
      auto_renew: service.auto_renew,
      cost: String(service.cost ?? "0"),
      currency: service.currency,
      billing_cycle: service.billing_cycle,
      console_url: service.console_url,
      notes: service.notes,
    });

    void (async () => {
      const [acct, prop, cat] = await Promise.allSettled([
        api.get<unknown>("/estate/accounts/?page_size=200"),
        api.get<unknown>("/estate/properties/?page_size=200"),
        api.get<unknown>("/estate/providers/layers/"),
      ]);
      if (acct.status === "fulfilled") {
        setAccounts(resultsOf(acct.value.data, normalizeAccount));
      }
      if (prop.status === "fulfilled") {
        setProperties(resultsOf(prop.value.data, normalizeProperty));
      }
      if (cat.status === "fulfilled") {
        setTypes(resultsOf(cat.value.data, normalizeServiceType));
      }
    })();
  }, [open, service]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a.id) === values?.provider_account),
    [accounts, values?.provider_account],
  );

  const submit = async () => {
    if (!values || !service) return;
    if (!values.identifier.trim()) {
      toast.error("A service needs an identifier.");
      return;
    }
    if (!values.provider_account) {
      toast.error("Choose the account this is bought through.");
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/estate/services/${service.id}/`, {
        service_type: values.service_type,
        identifier: values.identifier.trim(),
        provider_account: Number(values.provider_account),
        // The account carries the provider. Sending them separately is how the
        // two drift apart, and the serializer rejects a mismatched pair.
        provider: selectedAccount?.provider ?? service.provider,
        property: values.property === "none" ? null : Number(values.property),
        status: values.status,
        renewal_date: values.renewal_date || null,
        auto_renew: values.auto_renew,
        cost: values.cost || "0",
        currency: values.currency.trim().toUpperCase(),
        billing_cycle: values.billing_cycle,
        console_url: values.console_url.trim(),
        notes: values.notes.trim(),
      });
      toast.success("Service updated.");
      onSaved();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save the service."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Edit service</DialogTitle>
          <DialogDescription>
            {service?.identifier ?? ""} — everything on one form, because you
            already know what you came to change.
          </DialogDescription>
        </DialogHeader>

        {values && (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="svc-identifier" className="text-xs">
                  Identifier
                </Label>
                <Input
                  id="svc-identifier"
                  value={values.identifier}
                  onChange={(event) => set("identifier", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={values.service_type}
                  onValueChange={(value) => set("service_type", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((type) => (
                      <SelectItem key={type.layer} value={type.layer}>
                        {type.layer_label}
                        {type.is_tracked ? " · stack" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Bought through</Label>
                <Select
                  value={values.provider_account}
                  onValueChange={(value) => set("provider_account", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={String(account.id)}>
                        {account.account_email} · {account.provider_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Property</Label>
                <Select
                  value={values.property}
                  onValueChange={(value) => set("property", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unattached" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unattached (orphan)</SelectItem>
                    {properties.map((property) => (
                      <SelectItem key={property.id} value={String(property.id)}>
                        {property.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="svc-cost" className="text-xs">
                  Cost
                </Label>
                <Input
                  id="svc-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.cost}
                  onChange={(event) => set("cost", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-currency" className="text-xs">
                  Currency
                </Label>
                <Input
                  id="svc-currency"
                  maxLength={3}
                  value={values.currency}
                  onChange={(event) =>
                    set("currency", event.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cycle</Label>
                <Select
                  value={values.billing_cycle}
                  onValueChange={(value) => set("billing_cycle", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_CYCLES.map(([code, label]) => (
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
                <Label htmlFor="svc-renewal" className="text-xs">
                  Renewal date
                </Label>
                <Input
                  id="svc-renewal"
                  type="date"
                  value={values.renewal_date}
                  onChange={(event) => set("renewal_date", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={values.status}
                  onValueChange={(value) => set("status", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(([code, label]) => (
                      <SelectItem key={code} value={code}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="svc-console" className="text-xs">
                Console URL
              </Label>
              <Input
                id="svc-console"
                value={values.console_url}
                onChange={(event) => set("console_url", event.target.value)}
                placeholder="Leave blank to use the provider's"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="svc-notes" className="text-xs">
                Notes
              </Label>
              <Textarea
                id="svc-notes"
                rows={2}
                value={values.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <Label htmlFor="svc-auto" className="text-sm">
                  Auto-renew
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Off plus a near renewal date is what makes a service at-risk.
                </p>
              </div>
              <Switch
                id="svc-auto"
                checked={values.auto_renew}
                onCheckedChange={(checked) => set("auto_renew", checked === true)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !values}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ServiceDialog;
