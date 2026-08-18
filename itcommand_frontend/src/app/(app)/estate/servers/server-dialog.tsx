"use client";

/**
 * Add or edit a server.
 *
 * The account comes first and everything else follows from it: the service
 * list is filtered to that account, because a server billed through one
 * account and attributed to another makes both the cost report and the "what
 * does this account hold" answer wrong without anything looking broken. The
 * API refuses that combination too — this only saves the round trip.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  EstateProperty,
  EstateServer,
  ProviderAccount,
  SERVER_ENVIRONMENT_CHOICES,
  SERVER_ROLE_CHOICES,
  SERVER_STATUS_CHOICES,
  Service,
  errorMessage,
  normalizeAccount,
  normalizeProperty,
  normalizeService,
  resultsOf,
} from "../estate-types";

const BLANK = {
  provider_account: "",
  name: "",
  server_role: "OTHER",
  environment: "PRODUCTION",
  status: "RUNNING",
  public_ip: "",
  private_ip: "",
  hostname: "",
  region: "",
  size: "",
  operating_system: "",
  property: "",
  service: "",
  provisioned_on: "",
  expires_on: "",
  console_url: "",
  notes: "",
};

type Draft = typeof BLANK;

function toDraft(server: EstateServer): Draft {
  return {
    provider_account: String(server.provider_account),
    name: server.name,
    server_role: server.server_role,
    environment: server.environment,
    status: server.status,
    public_ip: server.public_ip ?? "",
    private_ip: server.private_ip ?? "",
    hostname: server.hostname,
    region: server.region,
    size: server.size,
    operating_system: server.operating_system,
    property: server.property ? String(server.property) : "",
    service: server.service ? String(server.service) : "",
    provisioned_on: server.provisioned_on ?? "",
    expires_on: server.expires_on ?? "",
    console_url: server.console_url,
    notes: server.notes,
  };
}

export function ServerDialog({
  open,
  onOpenChange,
  server,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: EstateServer | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...BLANK });
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [properties, setProperties] = useState<EstateProperty[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(server ? toDraft(server) : { ...BLANK });
  }, [open, server]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get<unknown>("/estate/accounts/?page_size=300"),
      api.get<unknown>("/estate/properties/?page_size=300"),
      api.get<unknown>("/estate/services/?page_size=500"),
    ])
      .then(([a, p, s]) => {
        setAccounts(resultsOf(a.data, normalizeAccount));
        setProperties(resultsOf(p.data, normalizeProperty));
        setServices(resultsOf(s.data, normalizeService));
      })
      .catch((reason) => toast.error(errorMessage(reason, "Could not load the pickers.")));
  }, [open]);

  // Only the services billed through the chosen account: attaching one from a
  // different account is the mistake this prevents rather than reports.
  const servicesForAccount = useMemo(() => {
    if (!draft.provider_account) return [];
    const accountId = Number(draft.provider_account);
    return services.filter((s) => s.provider_account === accountId);
  }, [services, draft.provider_account]);

  const pickAccount = useCallback((value: string) => {
    setDraft((current) => ({
      ...current,
      provider_account: value,
      // The previously chosen service almost certainly belongs to the old
      // account, and a stale one here is exactly the mismatch above.
      service: "",
    }));
  }, []);

  const save = async () => {
    if (!draft.provider_account) {
      toast.error("Choose the account this server is bought through.");
      return;
    }
    if (!draft.name.trim()) {
      toast.error("Give the server a name.");
      return;
    }
    setSaving(true);
    const body = {
      provider_account: Number(draft.provider_account),
      name: draft.name.trim(),
      server_role: draft.server_role,
      environment: draft.environment,
      status: draft.status,
      // Empty strings would fail the IP validator; null is "not recorded".
      public_ip: draft.public_ip.trim() || null,
      private_ip: draft.private_ip.trim() || null,
      hostname: draft.hostname.trim(),
      region: draft.region.trim(),
      size: draft.size.trim(),
      operating_system: draft.operating_system.trim(),
      property: draft.property ? Number(draft.property) : null,
      service: draft.service ? Number(draft.service) : null,
      provisioned_on: draft.provisioned_on || null,
      expires_on: draft.expires_on || null,
      console_url: draft.console_url.trim(),
      notes: draft.notes,
    };
    try {
      if (server) await api.patch(`/estate/servers/${server.id}/`, body);
      else await api.post("/estate/servers/", body);
      toast.success(server ? "Server updated." : "Server added.");
      onSaved();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save that server."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{server ? "Edit server" : "Add server"}</DialogTitle>
          <DialogDescription>
            A server belongs to the account that pays for it, and to the property
            it keeps running.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Bought through *</Label>
            <Select value={draft.provider_account} onValueChange={pickAccount}>
              <SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.provider_name} · {a.account_email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-name">Name *</Label>
            <Input
              id="s-name" value={draft.name} placeholder="web-01"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={draft.server_role} onValueChange={(v) => setDraft({ ...draft, server_role: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVER_ROLE_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <Select value={draft.environment} onValueChange={(v) => setDraft({ ...draft, environment: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVER_ENVIRONMENT_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-public">Public IP</Label>
            <Input
              id="s-public" value={draft.public_ip} placeholder="203.0.113.9"
              onChange={(e) => setDraft({ ...draft, public_ip: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-private">Private IP</Label>
            <Input
              id="s-private" value={draft.private_ip} placeholder="10.0.0.4"
              onChange={(e) => setDraft({ ...draft, private_ip: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-host">Hostname</Label>
            <Input
              id="s-host" value={draft.hostname} placeholder="web-01.terafort.com"
              onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-region">Region</Label>
            <Input
              id="s-region" value={draft.region} placeholder="eu-west-1"
              onChange={(e) => setDraft({ ...draft, region: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-size">Size / plan</Label>
            <Input
              id="s-size" value={draft.size} placeholder="t3.medium"
              onChange={(e) => setDraft({ ...draft, size: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-os">Operating system</Label>
            <Input
              id="s-os" value={draft.operating_system} placeholder="Ubuntu 24.04"
              onChange={(e) => setDraft({ ...draft, operating_system: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Keeps running</Label>
            <Select
              value={draft.property || "none"}
              onValueChange={(v) => setDraft({ ...draft, property: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Nothing yet" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nothing yet</SelectItem>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Billed under</Label>
            <Select
              value={draft.service || "none"}
              onValueChange={(v) => setDraft({ ...draft, service: v === "none" ? "" : v })}
              disabled={!draft.provider_account}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={draft.provider_account ? "No single service" : "Choose an account first"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No single service</SelectItem>
                {servicesForAccount.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.identifier}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVER_STATUS_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-expires">Expires</Label>
            <Input
              id="s-expires" type="date" value={draft.expires_on}
              onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-console">Console URL</Label>
            <Input
              id="s-console" value={draft.console_url}
              placeholder="Leave blank to use the account's"
              onChange={(e) => setDraft({ ...draft, console_url: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-notes">Notes</Label>
            <Textarea
              id="s-notes" rows={2} value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {server ? "Save" : "Add server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
