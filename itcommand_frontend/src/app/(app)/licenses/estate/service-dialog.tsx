"use client";

/**
 * Add or attach a service.
 *
 * The reference mockup uses a five-step wizard. This is a single form, because
 * that is what every other create/edit flow in IT Command is (see
 * `subscriptions/subscription-dialog.tsx`) — consistency with the app beats
 * fidelity to the mockup, and a wizard for nine fields is friction.
 *
 * A "service" is a `Subscription`. The estate fields are a view onto the same
 * row, so this writes to /api/subscriptions/ and the Subscriptions tab sees the
 * result immediately.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Layers, ServerCog, Wallet } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { todayInputValue, toDateInputValue } from "@/lib/date";
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

import type {
  DigitalProperty,
  LayerDef,
  Provider,
  ProviderAccount,
} from "./estate-types";

const FALLBACK_CURRENCIES = ["USD", "EUR", "GBP", "PKR", "AED", "INR"];

interface ServiceSeed {
  serviceId?: number;
  propertyId?: number;
  layer?: string;
}

interface ServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed: ServiceSeed | null;
  layers: LayerDef[];
  properties: DigitalProperty[];
  accounts: ProviderAccount[];
  providers: Provider[];
  onSaved: () => void;
}

interface FormValues {
  name: string;
  platform: string;
  identifier: string;
  digital_property: string;
  service_layer: string;
  provider_account: string;
  cost: string;
  currency: string;
  billing_cycle: string;
  start_date: string;
  expiry_date: string;
  auto_renew: boolean;
  url: string;
  notes: string;
}

const BLANK: FormValues = {
  name: "",
  platform: "",
  identifier: "",
  digital_property: "none",
  service_layer: "none",
  provider_account: "none",
  cost: "",
  currency: "USD",
  billing_cycle: "YEARLY",
  start_date: todayInputValue(),
  expiry_date: "",
  auto_renew: true,
  url: "",
  notes: "",
};

function errorMessage(reason: unknown, fallback: string): string {
  const data = (reason as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    // Field errors: surface the first one rather than a generic failure.
    for (const [field, value] of Object.entries(record)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") {
        return field === "non_field_errors" ? first : `${field}: ${first}`;
      }
    }
  }
  return fallback;
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </div>
  );
}

export function ServiceDialog({
  open,
  onOpenChange,
  seed,
  layers,
  properties,
  accounts,
  providers,
  onSaved,
}: ServiceDialogProps) {
  const [values, setValues] = useState<FormValues>(BLANK);
  const [currencies, setCurrencies] = useState<string[]>(FALLBACK_CURRENCIES);
  const [saving, setSaving] = useState(false);
  const [loadingService, setLoadingService] = useState(false);

  const editingId = seed?.serviceId ?? null;
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  /** Currency list comes from the admin-managed LOV, same as the Subscriptions form. */
  const loadCurrencies = useCallback(async () => {
    try {
      const response = await api.get<{ currencies?: { code?: string }[] }>(
        "/subscriptions/options/",
      );
      const codes = (response.data?.currencies ?? [])
        .map((row) => String(row?.code ?? "").toUpperCase())
        .filter((code) => code.length === 3);
      if (codes.length) setCurrencies(codes);
    } catch {
      // A missing options endpoint should not block adding a service.
      setCurrencies(FALLBACK_CURRENCIES);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadCurrencies();
  }, [open, loadCurrencies]);

  useEffect(() => {
    if (!open) return;

    if (!editingId) {
      setValues({
        ...BLANK,
        start_date: todayInputValue(),
        digital_property: seed?.propertyId ? String(seed.propertyId) : "none",
        service_layer: seed?.layer ?? "none",
      });
      return;
    }

    // Attaching an existing (usually orphaned) service: load it and prefill.
    setLoadingService(true);
    api
      .get<Record<string, unknown>>(`/subscriptions/${editingId}/`)
      .then(({ data }) => {
        setValues({
          name: String(data.name ?? ""),
          platform: String(data.platform ?? ""),
          identifier: String(data.identifier ?? ""),
          digital_property:
            data.digital_property != null
              ? String(data.digital_property)
              : seed?.propertyId
                ? String(seed.propertyId)
                : "none",
          service_layer:
            data.service_layer != null ? String(data.service_layer) : seed?.layer ?? "none",
          provider_account:
            data.provider_account != null ? String(data.provider_account) : "none",
          cost: String(data.cost ?? ""),
          currency: String(data.currency ?? "USD").toUpperCase(),
          billing_cycle: String(data.billing_cycle ?? "YEARLY"),
          start_date: toDateInputValue(String(data.start_date ?? "")) || todayInputValue(),
          expiry_date: toDateInputValue(String(data.expiry_date ?? "")),
          auto_renew: data.auto_renew === true,
          url: String(data.url ?? ""),
          notes: String(data.notes ?? ""),
        });
      })
      .catch((reason) => {
        toast.error(errorMessage(reason, "Could not load that service."));
        onOpenChange(false);
      })
      .finally(() => setLoadingService(false));
  }, [open, editingId, seed?.propertyId, seed?.layer, onOpenChange]);

  /**
   * `name` and `platform` are NOT NULL on Subscription but absent from the
   * brief's field list, so they are derived rather than demanded: the layer and
   * identifier make a readable name, and the chosen account names the platform.
   * Both stay editable.
   */
  const applyDerivedName = () => {
    const layerLabel = layers.find((layer) => layer.layer === values.service_layer)?.layer_label;
    const parts = [layerLabel, values.identifier].filter(Boolean);
    if (!values.name && parts.length) set("name", parts.join(" — "));

    if (!values.platform && values.provider_account !== "none") {
      const account = accounts.find((row) => String(row.id) === values.provider_account);
      const provider = account?.provider ? providerById.get(account.provider) : undefined;
      if (provider) set("platform", provider.name);
    }
  };

  const validate = (): string | null => {
    if (!values.name.trim() && !values.identifier.trim()) {
      return "Give the service a name or an identifier.";
    }
    if (!values.cost.trim() || Number.isNaN(Number(values.cost)) || Number(values.cost) < 0) {
      return "Cost must be a number of zero or more.";
    }
    if (!values.expiry_date) return "Set the renewal date.";
    if (values.start_date && values.expiry_date < values.start_date) {
      return "The renewal date cannot be before the start date.";
    }
    if (values.url) {
      try {
        const parsed = new URL(values.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return "The service URL must use http or https.";
        }
      } catch {
        return "The service URL must be valid, including https://.";
      }
    }
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }

    const layerLabel = layers.find((layer) => layer.layer === values.service_layer)?.layer_label;
    const account =
      values.provider_account !== "none"
        ? accounts.find((row) => String(row.id) === values.provider_account)
        : undefined;
    const provider = account?.provider ? providerById.get(account.provider) : undefined;

    const payload: Record<string, unknown> = {
      name:
        values.name.trim() ||
        [layerLabel, values.identifier.trim()].filter(Boolean).join(" — ") ||
        values.identifier.trim(),
      platform: values.platform.trim() || provider?.name || "Unspecified",
      identifier: values.identifier.trim(),
      digital_property:
        values.digital_property === "none" ? null : Number(values.digital_property),
      service_layer: values.service_layer === "none" ? null : values.service_layer,
      provider_account:
        values.provider_account === "none" ? null : Number(values.provider_account),
      cost: values.cost.trim(),
      currency: values.currency,
      billing_cycle: values.billing_cycle,
      start_date: values.start_date || todayInputValue(),
      expiry_date: values.expiry_date,
      auto_renew: values.auto_renew,
      url: values.url.trim(),
      notes: values.notes.trim(),
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.patch(`/subscriptions/${editingId}/`, payload);
        toast.success("Service updated.");
      } else {
        await api.post("/subscriptions/", payload);
        toast.success("Service added.");
      }
      onSaved();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save the service."));
    } finally {
      setSaving(false);
    }
  };

  const activeAccounts = accounts.filter((account) => account.is_active);
  const activeProperties = properties.filter((property) => property.is_active);

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{editingId ? "Attach service" : "Add service"}</DialogTitle>
          <DialogDescription>
            {editingId
              ? "Tie this service to a property and a layer so it stops showing as an orphan."
              : "A service is a subscription with a place in the stack. It appears on both the Estate and Subscriptions tabs."}
          </DialogDescription>
        </DialogHeader>

        {loadingService ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading service…</p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3">
              <SectionTitle icon={Layers}>Place in the stack</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Property" hint="Leave empty and it will be reported as an orphan.">
                  <Select
                    value={values.digital_property}
                    onValueChange={(value) => set("digital_property", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No property" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No property (orphan)</SelectItem>
                      {activeProperties.map((property) => (
                        <SelectItem key={property.id} value={String(property.id)}>
                          {property.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Layer">
                  <Select
                    value={values.service_layer}
                    onValueChange={(value) => set("service_layer", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {layers.map((layer) => (
                        <SelectItem key={layer.layer} value={layer.layer}>
                          {layer.layer_label}
                          {layer.is_required ? "" : " (optional)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field
                label="Identifier"
                htmlFor="estate-identifier"
                hint='What it points at — "zone: example.com", "ecs-prod · ap-south-1".'
              >
                <Input
                  id="estate-identifier"
                  value={values.identifier}
                  onChange={(event) => set("identifier", event.target.value)}
                  onBlur={applyDerivedName}
                  placeholder="zone: example.com"
                />
              </Field>
            </div>

            <div className="space-y-3">
              <SectionTitle icon={ServerCog}>Provider</SectionTitle>
              <Field
                label="Provider account"
                hint={
                  activeAccounts.length
                    ? "The login this is bought through."
                    : "No provider accounts yet — add one on the Accounts tab first."
                }
              >
                <Select
                  value={values.provider_account}
                  onValueChange={(value) => {
                    set("provider_account", value);
                    if (!values.platform && value !== "none") {
                      const account = accounts.find((row) => String(row.id) === value);
                      const provider = account?.provider
                        ? providerById.get(account.provider)
                        : undefined;
                      if (provider) set("platform", provider.name);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No account</SelectItem>
                    {activeAccounts.map((account) => (
                      <SelectItem key={account.id} value={String(account.id)}>
                        {account.provider_name} · {account.login_email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Service name" htmlFor="estate-name" hint="Derived from the layer and identifier if left blank.">
                  <Input
                    id="estate-name"
                    value={values.name}
                    onChange={(event) => set("name", event.target.value)}
                    placeholder="Registrar — example.com"
                  />
                </Field>
                <Field label="Platform" htmlFor="estate-platform" hint="Defaults to the provider's name.">
                  <Input
                    id="estate-platform"
                    value={values.platform}
                    onChange={(event) => set("platform", event.target.value)}
                    placeholder="Cloudflare"
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-3">
              <SectionTitle icon={Wallet}>Cost and renewal</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Cost" htmlFor="estate-cost">
                  <Input
                    id="estate-cost"
                    inputMode="decimal"
                    value={values.cost}
                    onChange={(event) => set("cost", event.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Currency">
                  <Select value={values.currency} onValueChange={(value) => set("currency", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Billing cycle">
                  <Select
                    value={values.billing_cycle}
                    onValueChange={(value) => set("billing_cycle", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="YEARLY">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start date" htmlFor="estate-start">
                  <Input
                    id="estate-start"
                    type="date"
                    value={values.start_date}
                    onChange={(event) => set("start_date", event.target.value)}
                  />
                </Field>
                <Field label="Renewal date" htmlFor="estate-expiry">
                  <Input
                    id="estate-expiry"
                    type="date"
                    value={values.expiry_date}
                    onChange={(event) => set("expiry_date", event.target.value)}
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                <div>
                  <Label htmlFor="estate-auto" className="text-sm">
                    Auto-renew
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Off means it lapses unless someone acts — that is what puts it
                    &quot;at risk&quot;.
                  </p>
                </div>
                <Switch
                  id="estate-auto"
                  checked={values.auto_renew}
                  onCheckedChange={(checked) => set("auto_renew", checked === true)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <SectionTitle icon={Link2}>Links</SectionTitle>
              <Field
                label="Service URL"
                htmlFor="estate-url"
                hint="The page for this service. The provider's console URL lives on the provider account."
              >
                <Input
                  id="estate-url"
                  value={values.url}
                  onChange={(event) => set("url", event.target.value)}
                  placeholder="https://dash.cloudflare.com/zone/example.com"
                />
              </Field>
              <Field label="Notes" htmlFor="estate-notes">
                <Textarea
                  id="estate-notes"
                  value={values.notes}
                  onChange={(event) => set("notes", event.target.value)}
                  rows={2}
                />
              </Field>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || loadingService}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
