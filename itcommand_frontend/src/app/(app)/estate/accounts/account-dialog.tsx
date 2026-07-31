"use client";

/**
 * Add or edit a provider account.
 *
 * The API still speaks `login_email` / `auth_method` / `mfa_method`; the
 * columns behind them were renamed in Phase 1 and the JSON keys follow in
 * Phase 3's backend pass. Until then this is one of two places that knows.
 */

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

import {
  Provider,
  ProviderAccount,
  errorMessage,
  normalizeProvider,
  resultsOf,
} from "../estate-types";

const AUTH_TYPES = [
  ["PASSWORD", "Password"],
  ["SSO", "Single sign-on"],
  ["API_KEY", "API key"],
  ["IAM", "IAM / identity centre"],
  ["OTHER", "Other"],
] as const;

const MFA_TYPES = [
  ["SECURITY_KEY", "Security key"],
  ["APP", "Authenticator app"],
  ["SMS", "SMS"],
  ["NONE", "None"],
  ["UNKNOWN", "Not recorded"],
] as const;

interface FormValues {
  provider: string;
  account_email: string;
  auth_type: string;
  mfa_type: string;
  owner: string;
  console_url: string;
  notes: string;
  is_active: boolean;
}

const BLANK: FormValues = {
  provider: "",
  account_email: "",
  auth_type: "PASSWORD",
  mfa_type: "UNKNOWN",
  owner: "none",
  console_url: "",
  notes: "",
  is_active: true,
};

export function AccountDialog({
  open,
  onOpenChange,
  account,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: ProviderAccount | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<FormValues>(BLANK);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [users, setUsers] = useState<{ id: number; full_name: string }[]>([]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [prov, people] = await Promise.allSettled([
        api.get<unknown>("/estate/providers/?page_size=200"),
        api.get<unknown>("/users/?page_size=200"),
      ]);
      const list =
        prov.status === "fulfilled"
          ? resultsOf(prov.value.data, normalizeProvider)
          : [];
      setProviders(list);
      if (people.status === "fulfilled") {
        setUsers(
          resultsOf(people.value.data, (row) => ({
            id: Number(row.id ?? 0),
            full_name: String(row.full_name ?? ""),
          })).filter((row) => row.id > 0),
        );
      }

      if (account) {
        setValues({
          provider: account.provider ? String(account.provider) : "",
          account_email: account.account_email,
          auth_type: account.auth_type || "PASSWORD",
          mfa_type: account.mfa_type || "UNKNOWN",
          owner: account.owner ? String(account.owner) : "none",
          console_url: account.console_url,
          notes: account.notes,
          is_active: account.is_active,
        });
      } else {
        setValues({ ...BLANK, provider: list[0] ? String(list[0].id) : "" });
      }
    })();
  }, [open, account]);

  const submit = async () => {
    if (!values.provider) {
      toast.error("Choose a provider.");
      return;
    }
    if (!values.account_email.trim()) {
      toast.error("Enter the login this account signs in with.");
      return;
    }

    const payload = {
      provider: Number(values.provider),
      login_email: values.account_email.trim(),
      auth_method: values.auth_type,
      mfa_method: values.mfa_type,
      owner: values.owner === "none" ? null : Number(values.owner),
      console_url: values.console_url.trim(),
      notes: values.notes.trim(),
      is_active: values.is_active,
    };

    setSaving(true);
    try {
      if (account) {
        await api.patch(`/estate/accounts/${account.id}/`, payload);
        toast.success("Account updated.");
      } else {
        await api.post("/estate/accounts/", payload);
        toast.success("Account added.");
      }
      onSaved();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save the account."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{account ? "Edit account" : "Add provider account"}</DialogTitle>
          <DialogDescription>
            A login held at a provider. Services are bought through an account, so
            this is where &quot;who can get into this, and is it protected&quot; is
            answered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Select
                value={values.provider}
                onValueChange={(value) => set("provider", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={String(provider.id)}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-login" className="text-xs">
                Login
              </Label>
              <Input
                id="account-login"
                value={values.account_email}
                onChange={(event) => set("account_email", event.target.value)}
                placeholder="devops@example.com"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Sign-in method</Label>
              <Select
                value={values.auth_type}
                onValueChange={(value) => set("auth_type", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTH_TYPES.map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Second factor</Label>
              <Select
                value={values.mfa_type}
                onValueChange={(value) => set("mfa_type", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MFA_TYPES.map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                &quot;Not recorded&quot; is honest until someone checks — it is not
                the same as &quot;none&quot;.
              </p>
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
              <Label htmlFor="account-console" className="text-xs">
                Console URL
              </Label>
              <Input
                id="account-console"
                value={values.console_url}
                onChange={(event) => set("console_url", event.target.value)}
                placeholder="Leave blank to use the provider's"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="account-notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="account-notes"
              value={values.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <Label htmlFor="account-active" className="text-sm">
              Active
            </Label>
            <Switch
              id="account-active"
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
            {saving ? "Saving…" : account ? "Save changes" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AccountDialog;
