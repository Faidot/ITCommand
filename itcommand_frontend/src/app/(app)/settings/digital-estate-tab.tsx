"use client";

/**
 * Master Settings → Digital Estate.
 *
 * One-time setup only. Nothing configurable lives on the Estate page itself, so
 * this is where the provider catalog, the tracked layers and the alert windows
 * are decided.
 *
 * The layer editor is the part that matters: tracking a layer is what makes an
 * empty one a gap, so this list *is* the definition of "complete stack" for the
 * whole organisation.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Globe,
  Layers,
  Pencil,
  Plus,
  ServerCog,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { EstateTypesPanel } from "./estate-types-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LayerRow {
  layer: string;
  layer_label: string;
  is_tracked: boolean;
}

interface EstateSettingsPayload {
  enabled_layers: string[];
  renewal_warning_days: number;
  renewal_urgent_days: number;
  timeline_window_days: number;
  alert_on_auto_renew_off: boolean;
  alert_on_new_orphan: boolean;
  updated_by_name: string | null;
  updated_at: string | null;
  catalog: LayerRow[];
  all_layers: { layer: string; layer_label: string }[];
}

interface ProviderRow {
  id: number;
  name: string;
  slug: string;
  brand_color: string;
  console_url: string;
  logo_initial: string;
  is_active: boolean;
  account_count: number;
}

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

// ─────────────────────────────── layers ───────────────────────────────

/** service_type is a 16-character column, so the derived code has to fit it. */
function toLayerCode(label: string) {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
}

function LayerEditor({
  settings,
  onSave,
  saving,
  onCatalogChanged,
}: {
  settings: EstateSettingsPayload;
  onSave: (enabled: string[]) => void;
  saving: boolean;
  onCatalogChanged: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState<string[]>(settings.enabled_layers);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  /** Codes created here but not yet saved to `enabled_layers` on the server. */
  const [pending, setPending] = useState<string[]>([]);

  // Merged rather than replaced: refetching the catalog after creating a layer
  // would otherwise reset the list and drop the one just added.
  useEffect(() => {
    setEnabled([
      ...settings.enabled_layers,
      ...pending.filter((code) => !settings.enabled_layers.includes(code)),
    ]);
  }, [settings.enabled_layers, pending]);

  const createLayer = async () => {
    const label = newLabel.trim();
    const code = toLayerCode(label);
    if (!label || !code) return;
    if (settings.all_layers.some((row) => row.layer === code)) {
      toast.error(`${code} already exists — add it from "Not tracked" below.`);
      return;
    }
    setCreating(true);
    try {
      // Creates the service type, then tracks it in one step. Doing this in
      // two panels meant adding a type, scrolling back, and finding it in a
      // list of eleven — for what reads as a single decision.
      await api.post("/lov/", { group: "subscription_category", code, label });
      setPending((current) => [...current, code]);
      await onCatalogChanged();
      setNewLabel("");
      toast.success(`${label} added. Save below to start tracking it.`);
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not add that layer."));
    } finally {
      setCreating(false);
    }
  };

  const labelFor = (code: string) =>
    settings.all_layers.find((row) => row.layer === code)?.layer_label ?? code;
  const available = settings.all_layers.filter((row) => !enabled.includes(row.layer));

  const move = (index: number, delta: number) => {
    const next = [...enabled];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setEnabled(next);
  };

  const dirty =
    enabled.length !== settings.enabled_layers.length ||
    enabled.some((code, index) => settings.enabled_layers[index] !== code);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" /> Tracked layers
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Which layers this organisation expects every property to have, in stack order.
          A tracked layer with nothing in it is reported as a gap — so this list decides
          what &quot;complete&quot; means.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          {enabled.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              No layers tracked. Every layer will be shown and none will count as a gap.
            </p>
          ) : (
            enabled.map((code, index) => (
              <div
                key={code}
                className="flex items-center gap-2 rounded-lg border px-3 py-2"
              >
                <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="flex-1 text-sm font-medium">{labelFor(code)}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${labelFor(code)} up`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={index === enabled.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${labelFor(code)} down`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => setEnabled(enabled.filter((row) => row !== code))}
                  aria-label={`Stop tracking ${labelFor(code)}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-1.5 rounded-lg border border-dashed p-3">
          <Label className="text-xs text-muted-foreground">Add a new layer</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void createLayer()}
              placeholder="Podcast hosting"
              className="h-8 min-w-[180px] flex-1 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={creating || !newLabel.trim()}
              onClick={() => void createLayer()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add layer
            </Button>
          </div>
          {newLabel.trim() && (
            <p className="text-[11px] text-muted-foreground">
              Stored as{" "}
              <span className="font-mono">{toLayerCode(newLabel) || "—"}</span>. This
              becomes a service type as well, so it can be chosen when adding a
              service — and once tracked, a property without one counts as a gap.
            </p>
          )}
        </div>

        {available.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Not tracked</Label>
            <div className="flex flex-wrap gap-1.5">
              {available.map((row) => (
                <Button
                  key={row.layer}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setEnabled([...enabled, row.layer])}
                >
                  <Plus className="mr-1 h-3 w-3" /> {row.layer_label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              An untracked layer stays selectable when adding a service, and any service
              already on one keeps showing — only the empty slot disappears.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 border-t pt-3">
          <Button size="sm" disabled={!dirty || saving} onClick={() => onSave(enabled)}>
            {saving ? "Saving…" : "Save layer order"}
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEnabled(settings.enabled_layers)}
            >
              Reset
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────── thresholds ───────────────────────────────

function ThresholdEditor({
  settings,
  onSave,
  saving,
}: {
  settings: EstateSettingsPayload;
  onSave: (changes: Partial<EstateSettingsPayload>) => void;
  saving: boolean;
}) {
  const [warning, setWarning] = useState(String(settings.renewal_warning_days));
  const [urgent, setUrgent] = useState(String(settings.renewal_urgent_days));
  const [timeline, setTimeline] = useState(String(settings.timeline_window_days));
  const [autoRenewAlert, setAutoRenewAlert] = useState(settings.alert_on_auto_renew_off);
  const [orphanAlert, setOrphanAlert] = useState(settings.alert_on_new_orphan);

  useEffect(() => {
    setWarning(String(settings.renewal_warning_days));
    setUrgent(String(settings.renewal_urgent_days));
    setTimeline(String(settings.timeline_window_days));
    setAutoRenewAlert(settings.alert_on_auto_renew_off);
    setOrphanAlert(settings.alert_on_new_orphan);
  }, [settings]);

  const warningNum = Number(warning);
  const urgentNum = Number(urgent);
  const inverted = Number.isFinite(warningNum) && Number.isFinite(urgentNum) && urgentNum > warningNum;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4" /> Alert thresholds
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          How far ahead a renewal starts to matter, and what the estate warns about.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="estate-warning" className="text-xs">
              Warning window (amber)
            </Label>
            <Input
              id="estate-warning"
              inputMode="numeric"
              value={warning}
              onChange={(event) => setWarning(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Also the at-risk window when auto-renew is off.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estate-urgent" className="text-xs">
              Urgent window (red)
            </Label>
            <Input
              id="estate-urgent"
              inputMode="numeric"
              value={urgent}
              onChange={(event) => setUrgent(event.target.value)}
            />
            {inverted && (
              <p className="text-[11px] text-red-600 dark:text-red-400">
                Red cannot be wider than amber — nothing would ever render amber.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estate-timeline" className="text-xs">
              Timeline window
            </Label>
            <Input
              id="estate-timeline"
              inputMode="numeric"
              value={timeline}
              onChange={(event) => setTimeline(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              How far ahead the renewal timeline looks.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="estate-alert-auto" className="text-sm">
                Warn when auto-renew is off
              </Label>
              <p className="text-[11px] text-muted-foreground">
                A service approaching renewal that will not renew itself.
              </p>
            </div>
            <Switch
              id="estate-alert-auto"
              checked={autoRenewAlert}
              onCheckedChange={(checked) => setAutoRenewAlert(checked === true)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="estate-alert-orphan" className="text-sm">
                Warn on a new orphan
              </Label>
              <p className="text-[11px] text-muted-foreground">
                A service billed but tied to no property.
              </p>
            </div>
            <Switch
              id="estate-alert-orphan"
              checked={orphanAlert}
              onCheckedChange={(checked) => setOrphanAlert(checked === true)}
            />
          </div>
        </div>

        <div className="border-t pt-3">
          <Button
            size="sm"
            disabled={saving || inverted}
            onClick={() =>
              onSave({
                renewal_warning_days: Number(warning),
                renewal_urgent_days: Number(urgent),
                timeline_window_days: Number(timeline),
                alert_on_auto_renew_off: autoRenewAlert,
                alert_on_new_orphan: orphanAlert,
              })
            }
          >
            {saving ? "Saving…" : "Save thresholds"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────── providers ───────────────────────────────

function ProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderRow | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const [consoleUrl, setConsoleUrl] = useState("");
  const [initial, setInitial] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(provider?.name ?? "");
    setColor(provider?.brand_color || "#64748b");
    setConsoleUrl(provider?.console_url ?? "");
    setInitial(provider?.logo_initial ?? "");
    setIsActive(provider?.is_active ?? true);
  }, [open, provider]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Give the provider a name.");
      return;
    }
    const payload = {
      name: name.trim(),
      brand_color: color.trim(),
      console_url: consoleUrl.trim(),
      logo_initial: initial.trim(),
      is_active: isActive,
    };
    setSaving(true);
    try {
      if (provider) await api.patch(`/estate/providers/${provider.id}/`, payload);
      else await api.post("/estate/providers/", payload);
      toast.success(provider ? "Provider updated" : "Provider added");
      onSaved();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save the provider."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{provider ? `Edit ${provider.name}` : "Add provider"}</DialogTitle>
          <DialogDescription>
            A service provider you hold accounts with. The slug is derived from the name.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="provider-name" className="text-xs">
              Name
            </Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Cloudflare"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="provider-color" className="text-xs">
                Brand colour
              </Label>
              <div className="flex items-center gap-2">
                <input
                  id="provider-color"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#64748b"}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border bg-transparent"
                />
                <Input value={color} onChange={(event) => setColor(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-initial" className="text-xs">
                Initial
              </Label>
              <Input
                id="provider-initial"
                maxLength={2}
                value={initial}
                onChange={(event) => setInitial(event.target.value)}
                placeholder="Defaults to the first letter"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-console" className="text-xs">
              Console URL
            </Label>
            <Input
              id="provider-console"
              value={consoleUrl}
              onChange={(event) => setConsoleUrl(event.target.value)}
              placeholder="https://dash.cloudflare.com"
            />
            <p className="text-[11px] text-muted-foreground">
              Accounts inherit this unless they set their own.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <Label htmlFor="provider-active" className="text-sm">
              Active
            </Label>
            <Switch
              id="provider-active"
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
            {saving ? "Saving…" : provider ? "Save changes" : "Add provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderCatalog({
  providers,
  onChanged,
}: {
  providers: ProviderRow[];
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderRow | null>(null);

  const remove = async (provider: ProviderRow) => {
    if (!window.confirm(`Delete ${provider.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/estate/providers/${provider.id}/`);
      toast.success(`${provider.name} deleted`);
      onChanged();
    } catch (reason) {
      // The API returns a 409 explaining how many accounts still use it.
      toast.error(errorMessage(reason, "Could not delete the provider."));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerCog className="h-4 w-4" /> Provider catalog
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Seed the built-ins with{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              manage.py seed_estate
            </code>
            , then edit here.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Add provider
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {providers.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No providers yet. Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              manage.py seed_estate
            </code>{" "}
            to load the ten common ones, or add your own.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Provider</TableHead>
                  <TableHead>Console</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="pl-6">
                      <span className="flex items-center gap-2">
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold text-white"
                          style={{ backgroundColor: provider.brand_color || "#64748b" }}
                        >
                          {provider.logo_initial || provider.name.slice(0, 1)}
                        </span>
                        <span className="font-medium">{provider.name}</span>
                        {!provider.is_active && (
                          <Badge variant="outline" className="text-[10px]">
                            inactive
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                      {provider.console_url || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {provider.account_count}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditing(provider);
                          setDialogOpen(true);
                        }}
                        aria-label={`Edit ${provider.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-600"
                        onClick={() => void remove(provider)}
                        aria-label={`Delete ${provider.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editing}
        onSaved={() => {
          setDialogOpen(false);
          setEditing(null);
          onChanged();
        }}
      />
    </Card>
  );
}

// ─────────────────────────────── tab ───────────────────────────────

export function DigitalEstateTab({ role }: { role?: string }) {
  const [settings, setSettings] = useState<EstateSettingsPayload | null>(null);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [settingsResult, providersResult] = await Promise.allSettled([
      api.get<EstateSettingsPayload>("/estate/settings/"),
      api.get<{ results?: ProviderRow[] }>("/estate/providers/?page_size=200"),
    ]);
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value.data);
    else toast.error("Could not load the estate settings.");
    if (providersResult.status === "fulfilled") {
      const data = providersResult.value.data;
      setProviders(Array.isArray(data) ? data : data?.results ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (changes: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await api.put<EstateSettingsPayload>("/estate/settings/", changes);
      setSettings(response.data);
      toast.success("Digital Estate settings saved");
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save the settings."));
    } finally {
      setSaving(false);
    }
  };

  if (role !== "SUPERADMIN") {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Only a superadmin can configure the Digital Estate.
        </CardContent>
      </Card>
    );
  }

  if (loading || !settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-2 pt-1 text-sm">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            One-time setup for the Estate tab. Property kinds are managed under{" "}
            <strong>Lists of values → Digital property kinds</strong>, and exchange rates
            under <strong>Integrations</strong>.
          </span>
        </CardContent>
      </Card>

      <LayerEditor
        settings={settings}
        saving={saving}
        onCatalogChanged={load}
        onSave={(enabled) => void save({ enabled_layers: enabled })}
      />
      <ThresholdEditor
        settings={settings}
        saving={saving}
        onSave={(changes) => void save(changes)}
      />
      <ProviderCatalog providers={providers} onChanged={() => void load()} />

      {settings.updated_at && (
        <p className="text-center text-xs text-muted-foreground">
          Last changed by {settings.updated_by_name || "someone"} on{" "}
          {new Date(settings.updated_at).toLocaleDateString()}
        </p>
      )}

      {/* Adding a type is an estate question, so it is answered here rather
          than only under List of Values, where nobody thinks to look. */}
      <EstateTypesPanel />
    </div>
  );
}

export default DigitalEstateTab;
