"use client";

/**
 * The Accounts tab.
 *
 * The MFA column is the reason this tab exists. An account with no second factor
 * that holds production infrastructure is the single most useful thing here, so
 * it is sorted to the top by default, counted in a banner, and coloured from the
 * severity the API returns — never from a client-side guess about what "SMS"
 * means.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import {
  normalizeAccount,
  normalizeProvider,
  Provider,
  ProviderAccount,
  resultsOf,
  SEVERITY_BADGE,
  SEVERITY_TONE,
} from "./estate-types";

const AUTH_METHODS = [
  ["PASSWORD", "Password"],
  ["SSO", "Single sign-on"],
  ["API_KEY", "API key"],
  ["IAM", "IAM / identity centre"],
  ["OTHER", "Other"],
] as const;

const MFA_METHODS = [
  ["APP", "Authenticator app"],
  ["KEY", "Hardware key"],
  ["SMS", "SMS"],
  ["NONE", "None"],
  ["UNKNOWN", "Not recorded"],
] as const;

/** Worst first: the list should open on the thing that needs doing. */
const MFA_RANK: Record<string, number> = { NONE: 0, UNKNOWN: 1, SMS: 2, APP: 3, KEY: 4 };

function errorMessage(reason: unknown, fallback: string): string {
  const data = (reason as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    for (const [field, value] of Object.entries(record)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") {
        return field === "non_field_errors" ? first : `${field}: ${first}`;
      }
    }
  }
  return fallback;
}

interface AccountFormValues {
  provider: string;
  login_email: string;
  auth_method: string;
  mfa_method: string;
  owner: string;
  console_url: string;
  notes: string;
  is_active: boolean;
}

const BLANK_ACCOUNT: AccountFormValues = {
  provider: "",
  login_email: "",
  auth_method: "PASSWORD",
  mfa_method: "UNKNOWN",
  owner: "none",
  console_url: "",
  notes: "",
  is_active: true,
};

function AccountDialog({
  open,
  onOpenChange,
  account,
  providers,
  users,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: ProviderAccount | null;
  providers: Provider[];
  users: { id: number; full_name: string }[];
  onSaved: () => void;
}) {
  const [values, setValues] = useState<AccountFormValues>(BLANK_ACCOUNT);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    if (account) {
      setValues({
        provider: account.provider ? String(account.provider) : "",
        login_email: account.login_email,
        auth_method: account.auth_method || "PASSWORD",
        mfa_method: account.mfa_method || "UNKNOWN",
        owner: account.owner ? String(account.owner) : "none",
        console_url: account.console_url,
        notes: account.notes,
        is_active: account.is_active,
      });
    } else {
      setValues({ ...BLANK_ACCOUNT, provider: providers[0] ? String(providers[0].id) : "" });
    }
  }, [open, account, providers]);

  const submit = async () => {
    if (!values.provider) {
      toast.error("Choose a provider.");
      return;
    }
    if (!values.login_email.trim()) {
      toast.error("Enter the login this account signs in with.");
      return;
    }

    const payload = {
      provider: Number(values.provider),
      login_email: values.login_email.trim(),
      auth_method: values.auth_method,
      mfa_method: values.mfa_method,
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
            A login held at a provider. Services are bought through an account, so this is
            where &quot;who can get into this, and is it protected&quot; is answered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Select value={values.provider} onValueChange={(value) => set("provider", value)}>
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
                value={values.login_email}
                onChange={(event) => set("login_email", event.target.value)}
                placeholder="devops@example.com"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Sign-in method</Label>
              <Select value={values.auth_method} onValueChange={(value) => set("auth_method", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTH_METHODS.map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Second factor</Label>
              <Select value={values.mfa_method} onValueChange={(value) => set("mfa_method", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MFA_METHODS.map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                &quot;Not recorded&quot; is honest until someone checks — it is not the same
                as &quot;none&quot;.
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

function AccountsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Card>
        <CardContent className="space-y-2 pt-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function AccountsTab() {
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "subscriptions", "add");
  const canEdit = can(user, "subscriptions", "edit");

  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [users, setUsers] = useState<{ id: number; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [mfaFilter, setMfaFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderAccount | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    const [accountsResult, providersResult, usersResult] = await Promise.allSettled([
      api.get<unknown>("/estate/accounts/?page_size=200"),
      api.get<unknown>("/estate/providers/?page_size=200"),
      api.get<unknown>("/users/?page_size=200"),
    ]);

    if (accountsResult.status === "fulfilled") {
      setAccounts(resultsOf(accountsResult.value.data, normalizeAccount));
    } else {
      toast.error(errorMessage(accountsResult.reason, "Failed to load provider accounts."));
    }
    if (providersResult.status === "fulfilled") {
      setProviders(resultsOf(providersResult.value.data, normalizeProvider));
    }
    if (usersResult.status === "fulfilled") {
      setUsers(
        resultsOf(usersResult.value.data, (row) => ({
          id: Number(row.id ?? 0),
          full_name: String(row.full_name ?? ""),
        })).filter((row) => row.id > 0),
      );
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return accounts
      .filter((account) => {
        if (mfaFilter === "missing" && account.has_mfa) return false;
        if (mfaFilter === "weak" && account.mfa_method !== "SMS") return false;
        if (mfaFilter === "unowned" && account.owner !== null) return false;
        if (!needle) return true;
        return (
          account.login_email.toLowerCase().includes(needle) ||
          account.provider_name.toLowerCase().includes(needle) ||
          account.owner_name.toLowerCase().includes(needle)
        );
      })
      .sort(
        (left, right) =>
          (MFA_RANK[left.mfa_method] ?? 9) - (MFA_RANK[right.mfa_method] ?? 9) ||
          left.provider_name.localeCompare(right.provider_name),
      );
  }, [accounts, search, mfaFilter]);

  const unprotected = accounts.filter((account) => account.mfa_method === "NONE").length;
  const unverified = accounts.filter((account) => account.mfa_method === "UNKNOWN").length;

  if (loading) return <AccountsSkeleton />;

  // Defined once and rendered by both branches below. The empty state has its
  // own "Add account" button, so it needs the dialog mounted just as much as
  // the table does — leaving it out of that branch made the very first account
  // unaddable, the one moment the button matters most.
  const accountDialog = (
    <AccountDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      account={editing}
      providers={providers}
      users={users}
      onSaved={() => {
        setDialogOpen(false);
        setEditing(null);
        void loadData(true);
      }}
    />
  );

  if (accounts.length === 0) {
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="pt-1">
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className={`rounded-xl p-2.5 ${SEVERITY_TONE.muted}`}>
                <KeyRound className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium">
                No provider accounts yet. Add the logins you hold at AWS, Cloudflare and the rest
                so services can be traced back to a person.
              </p>
              {canAdd && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" /> Add account
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {accountDialog}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unprotected > 0 && (
        <Card className="border-red-300 dark:border-red-900">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm font-medium">
                  {unprotected} account{unprotected === 1 ? "" : "s"} with no second factor
                  {unverified > 0 && `, ${unverified} never checked`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Anyone with the password owns every service bought through it.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setMfaFilter("missing")}>
              Show them
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-1">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search login, provider or owner"
              className="pl-8"
            />
          </div>
          <Select value={mfaFilter} onValueChange={setMfaFilter}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              <SelectItem value="missing">Missing MFA</SelectItem>
              <SelectItem value="weak">SMS only</SelectItem>
              <SelectItem value="unowned">No owner</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {canAdd && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add account
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Provider</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Sign-in</TableHead>
                  <TableHead>MFA</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Services</TableHead>
                  <TableHead>Vault</TableHead>
                  <TableHead className="pr-4 text-right">Console</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <ShieldCheck className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
                      <p className="font-medium">No accounts match</p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          setSearch("");
                          setMfaFilter("all");
                        }}
                      >
                        Clear the search and filter
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((account) => (
                    <TableRow
                      key={account.id}
                      className={canEdit ? "cursor-pointer" : undefined}
                      onClick={
                        canEdit
                          ? () => {
                              setEditing(account);
                              setDialogOpen(true);
                            }
                          : undefined
                      }
                    >
                      <TableCell className="pl-4">
                        <span className="flex items-center gap-2">
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                            style={{ backgroundColor: account.brand_color || "#64748b" }}
                          >
                            {account.provider_name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-medium">{account.provider_name}</span>
                          {!account.is_active && (
                            <Badge variant="outline" className="text-[10px]">
                              inactive
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm">
                        {account.login_email}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {account.auth_method_label}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[11px] ${SEVERITY_BADGE[account.mfa_severity]}`}>
                          {account.mfa_method_label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {account.owner_name || (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <UserX className="h-3.5 w-3.5" /> Unassigned
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {account.service_count}
                      </TableCell>
                      <TableCell className="text-sm">
                        {account.vault_credential_title ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <KeyRound className="h-3.5 w-3.5" />
                                <span className="max-w-[140px] truncate">
                                  {account.vault_credential_title}
                                </span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {account.vault_credential_title === "Restricted"
                                ? "Linked to a vault entry you cannot see. Reveal it from the Vault."
                                : "Reveal the password from the Vault, not here."}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {account.effective_console_url ? (
                          <a
                            href={account.effective_console_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            Open <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {accountDialog}
    </div>
  );
}

export default AccountsTab;
