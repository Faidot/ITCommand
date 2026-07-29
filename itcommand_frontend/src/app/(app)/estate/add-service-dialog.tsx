"use client";

/**
 * Add Service — a five-step wizard.
 *
 * The steps follow the order the information actually arrives in: you know
 * which login bought it before you know what it costs. Each step validates
 * before letting you advance, so the failure arrives next to the field that
 * caused it rather than as a 400 on the last screen.
 *
 * Step 5 is skippable and says so. A service attached to no property is an
 * orphan, which is a state this module exists to *count*, not to forbid —
 * refusing to save one would just push people into inventing a property.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Globe,
  KeyRound,
  Plus,
  Server,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { todayInputValue } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
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
  Provider,
  ProviderAccount,
  ServiceTypeDef,
  errorMessage,
  normalizeAccount,
  normalizeProperty,
  normalizeProvider,
  normalizeServiceType,
  resultsOf,
} from "./estate-types";

/** Pre-fill, used when opening from a stack gap or a property page. */
export interface ServiceSeed {
  property?: number;
  service_type?: string;
  provider_account?: number;
}

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

const BILLING_CYCLES = [
  ["MONTHLY", "Monthly"],
  ["YEARLY", "Yearly"],
  ["USAGE", "Usage-based"],
  ["FREE", "Free"],
] as const;

const PROPERTY_KINDS = [
  ["MOBILE_GAME", "Mobile game"],
  ["APP", "App"],
  ["MARKETING", "Marketing site"],
  ["CORPORATE", "Corporate site"],
  ["STUDIO", "Studio site"],
  ["INFRA", "Infrastructure domain"],
  ["PARKED", "Parked"],
] as const;

const STEPS = [
  { key: "account", label: "Account", icon: KeyRound },
  { key: "type", label: "Type", icon: Tag },
  { key: "identifier", label: "Identifier", icon: Server },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "property", label: "Property", icon: Globe },
] as const;

interface FormValues {
  provider_account: string;
  newAccount: boolean;
  newAccountProvider: string;
  newAccountEmail: string;
  newAccountAuth: string;
  newAccountMfa: string;
  service_type: string;
  identifier: string;
  console_url: string;
  vault_credential: string;
  cost: string;
  currency: string;
  billing_cycle: string;
  renewal_date: string;
  auto_renew: boolean;
  property: string;
  newProperty: boolean;
  newPropertyName: string;
  newPropertyKind: string;
  notes: string;
}

const BLANK: FormValues = {
  provider_account: "",
  newAccount: false,
  newAccountProvider: "",
  newAccountEmail: "",
  newAccountAuth: "PASSWORD",
  newAccountMfa: "UNKNOWN",
  service_type: "",
  identifier: "",
  console_url: "",
  vault_credential: "none",
  cost: "0",
  currency: "PKR",
  billing_cycle: "MONTHLY",
  renewal_date: "",
  auto_renew: true,
  property: "none",
  newProperty: false,
  newPropertyName: "",
  newPropertyKind: "APP",
  notes: "",
};

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {STEPS.map((entry, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <div key={entry.key} className="flex flex-1 items-center gap-1">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "bg-primary/15 text-primary ring-2 ring-primary/40"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 rounded ${done ? "bg-primary" : "bg-muted"}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Step {step + 1} of {STEPS.length} · {STEPS[step].label}
      </p>
    </div>
  );
}

export function AddServiceDialog({
  open,
  onOpenChange,
  seed,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed?: ServiceSeed;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [saving, setSaving] = useState(false);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [properties, setProperties] = useState<EstateProperty[]>([]);
  const [types, setTypes] = useState<ServiceTypeDef[]>([]);
  const [credentials, setCredentials] = useState<{ id: number; title: string }[]>([]);

  const set = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
      setValues((current) => ({ ...current, [key]: value })),
    [],
  );

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setValues({
      ...BLANK,
      property: seed?.property ? String(seed.property) : "none",
      service_type: seed?.service_type ?? "",
      provider_account: seed?.provider_account ? String(seed.provider_account) : "",
    });

    void (async () => {
      const [prov, acct, prop, cat, creds] = await Promise.allSettled([
        api.get<unknown>("/estate/providers/?page_size=200&is_active=true"),
        api.get<unknown>("/estate/accounts/?page_size=200"),
        api.get<unknown>("/estate/properties/?page_size=200"),
        api.get<unknown>("/estate/providers/layers/"),
        api.get<unknown>("/vault/credentials/?page_size=200"),
      ]);
      if (prov.status === "fulfilled") {
        setProviders(resultsOf(prov.value.data, normalizeProvider));
      }
      if (acct.status === "fulfilled") {
        setAccounts(resultsOf(acct.value.data, normalizeAccount));
      }
      if (prop.status === "fulfilled") {
        setProperties(resultsOf(prop.value.data, normalizeProperty));
      }
      if (cat.status === "fulfilled") {
        setTypes(resultsOf(cat.value.data, normalizeServiceType));
      }
      // Optional: the vault list is gated behind its own unlock. A 403 here is
      // normal and simply means no credential picker, not a broken wizard.
      if (creds.status === "fulfilled") {
        setCredentials(
          resultsOf(creds.value.data, (row) => ({
            id: Number(row.id ?? 0),
            title: String(row.title ?? ""),
          })).filter((row) => row.id > 0),
        );
      }
    })();
  }, [open, seed]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => String(account.id) === values.provider_account),
    [accounts, values.provider_account],
  );

  /** What is wrong with the current step, or null when it may be left. */
  const stepError = useMemo((): string | null => {
    if (step === 0) {
      if (values.newAccount) {
        if (!values.newAccountProvider) return "Choose a provider for the new account.";
        if (!values.newAccountEmail.trim()) return "Enter the login for the new account.";
        return null;
      }
      return values.provider_account ? null : "Choose the account this is bought through.";
    }
    if (step === 1) return values.service_type ? null : "Choose what kind of service this is.";
    if (step === 2) return values.identifier.trim() ? null : "Give the service an identifier.";
    if (step === 3) {
      const cost = Number(values.cost);
      if (!Number.isFinite(cost) || cost < 0) return "Cost must be zero or more.";
      if (values.currency.trim().length !== 3) return "Use a three-letter currency code.";
      return null;
    }
    // Step 5 is optional by design.
    if (step === 4 && values.newProperty && !values.newPropertyName.trim()) {
      return "Name the new property, or switch back to picking an existing one.";
    }
    return null;
  }, [step, values]);

  const next = () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = async (skipProperty = false) => {
    if (stepError && !skipProperty) {
      toast.error(stepError);
      return;
    }

    setSaving(true);
    try {
      // Create the account first when asked; the service needs its id.
      let accountId = values.provider_account;
      let providerId = selectedAccount?.provider ? String(selectedAccount.provider) : "";
      if (values.newAccount) {
        const created = await api.post<{ id: number; provider: number }>(
          "/estate/accounts/",
          {
            provider: Number(values.newAccountProvider),
            login_email: values.newAccountEmail.trim(),
            auth_method: values.newAccountAuth,
            mfa_method: values.newAccountMfa,
          },
        );
        accountId = String(created.data.id);
        providerId = String(created.data.provider);
      }

      let propertyId: number | null = null;
      if (!skipProperty) {
        if (values.newProperty && values.newPropertyName.trim()) {
          const created = await api.post<{ id: number }>("/estate/properties/", {
            name: values.newPropertyName.trim(),
            kind: values.newPropertyKind,
          });
          propertyId = created.data.id;
        } else if (values.property !== "none") {
          propertyId = Number(values.property);
        }
      }

      await api.post("/estate/services/", {
        service_type: values.service_type,
        identifier: values.identifier.trim(),
        provider: Number(providerId),
        provider_account: Number(accountId),
        property: propertyId,
        cost: values.cost || "0",
        currency: values.currency.trim().toUpperCase(),
        billing_cycle: values.billing_cycle,
        renewal_date: values.renewal_date || null,
        auto_renew: values.auto_renew,
        console_url: values.console_url.trim(),
        vault_credential:
          values.vault_credential === "none" ? null : Number(values.vault_credential),
        notes: values.notes.trim(),
      });

      toast.success(
        propertyId ? "Service added." : "Service added. It is unattached, so it counts as an orphan.",
      );
      onSaved();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not add the service."));
    } finally {
      setSaving(false);
    }
  };

  const accountsForPicker = accounts.filter((account) => account.is_active);

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Add a service</DialogTitle>
          <DialogDescription>
            Something we pay for or manage: a domain, a DNS zone, a hosting plan,
            a SaaS seat.
          </DialogDescription>
        </DialogHeader>

        <ProgressBar step={step} />

        <div className="min-h-[280px] space-y-3 py-1">
          {/* ── 1. Account ─────────────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-3">
              {!values.newAccount ? (
                <>
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
                        {accountsForPicker.map((account) => (
                          <SelectItem key={account.id} value={String(account.id)}>
                            {account.account_email} · {account.provider_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {accountsForPicker.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No accounts yet — add the first one below.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => set("newAccount", true)}
                  >
                    <Plus className="mr-2 h-4 w-4" /> New account
                  </Button>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Provider</Label>
                      <Select
                        value={values.newAccountProvider}
                        onValueChange={(value) => set("newAccountProvider", value)}
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
                      <Label htmlFor="wiz-email" className="text-xs">
                        Login
                      </Label>
                      <Input
                        id="wiz-email"
                        value={values.newAccountEmail}
                        onChange={(event) => set("newAccountEmail", event.target.value)}
                        placeholder="devops@example.com"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Sign-in method</Label>
                      <Select
                        value={values.newAccountAuth}
                        onValueChange={(value) => set("newAccountAuth", value)}
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
                        value={values.newAccountMfa}
                        onValueChange={(value) => set("newAccountMfa", value)}
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
                        &quot;Not recorded&quot; is honest until someone checks — it
                        is not the same as &quot;none&quot;.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => set("newAccount", false)}
                  >
                    Use an existing account instead
                  </Button>
                </>
              )}
            </div>
          )}

          {/* ── 2. Type ────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((type) => {
                const selected = values.service_type === type.layer;
                return (
                  <button
                    key={type.layer}
                    type="button"
                    onClick={() => set("service_type", type.layer)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "hover:border-primary/40"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{type.layer_label}</span>
                      {type.is_tracked ? (
                        <Badge variant="outline" className="text-[10px]">
                          stack
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {type.is_tracked
                        ? "Holds a position in a property's stack."
                        : "Tracked and billed, but outside the stack."}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── 3. Identifier ──────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wiz-identifier" className="text-xs">
                  Identifier
                </Label>
                <Input
                  id="wiz-identifier"
                  value={values.identifier}
                  onChange={(event) => set("identifier", event.target.value)}
                  placeholder="zone: example.com, or ecs-prod · ap-south-1"
                />
                <p className="text-[11px] text-muted-foreground">
                  What this is in the provider&apos;s own terms. Doubles as its name
                  in every list.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiz-console" className="text-xs">
                  Console URL
                </Label>
                <Input
                  id="wiz-console"
                  value={values.console_url}
                  onChange={(event) => set("console_url", event.target.value)}
                  placeholder="Leave blank to use the provider's"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Vault credential</Label>
                <Select
                  value={values.vault_credential}
                  onValueChange={(value) => set("vault_credential", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {credentials.map((credential) => (
                      <SelectItem key={credential.id} value={String(credential.id)}>
                        {credential.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Links to a vault entry. The password stays in the vault and is
                  only ever revealed there.
                </p>
              </div>
            </div>
          )}

          {/* ── 4. Billing ─────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-cost" className="text-xs">
                    Cost
                  </Label>
                  <Input
                    id="wiz-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={values.cost}
                    onChange={(event) => set("cost", event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-currency" className="text-xs">
                    Currency
                  </Label>
                  <Input
                    id="wiz-currency"
                    value={values.currency}
                    maxLength={3}
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
              {(values.billing_cycle === "USAGE" || values.billing_cycle === "FREE") && (
                <p className="text-[11px] text-muted-foreground">
                  Usage-based and free services count as zero in monthly spend —
                  a fixed figure would be a guess inside a total.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-renewal" className="text-xs">
                    Renewal date
                  </Label>
                  <Input
                    id="wiz-renewal"
                    type="date"
                    value={values.renewal_date}
                    min={todayInputValue()}
                    onChange={(event) => set("renewal_date", event.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <div className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5">
                    <Label htmlFor="wiz-auto" className="text-sm">
                      Auto-renew
                    </Label>
                    <Switch
                      id="wiz-auto"
                      checked={values.auto_renew}
                      onCheckedChange={(checked) => set("auto_renew", checked === true)}
                    />
                  </div>
                </div>
              </div>
              {!values.auto_renew && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  With auto-renew off, this becomes at-risk as the renewal date
                  approaches.
                </p>
              )}
            </div>
          )}

          {/* ── 5. Property (optional) ─────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Optional. A service attached to nothing is an <strong>orphan</strong> —
                a valid state this page counts, not an error. Skip if you do not
                know yet.
              </div>
              {!values.newProperty ? (
                <>
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => set("newProperty", true)}
                  >
                    <Plus className="mr-2 h-4 w-4" /> New property
                  </Button>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="wiz-prop-name" className="text-xs">
                        Name
                      </Label>
                      <Input
                        id="wiz-prop-name"
                        value={values.newPropertyName}
                        onChange={(event) => set("newPropertyName", event.target.value)}
                        placeholder="example.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Kind</Label>
                      <Select
                        value={values.newPropertyKind}
                        onValueChange={(value) => set("newPropertyKind", value)}
                      >
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => set("newProperty", false)}
                  >
                    Pick an existing property instead
                  </Button>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="wiz-notes" className="text-xs">
                  Notes
                </Label>
                <Textarea
                  id="wiz-notes"
                  rows={2}
                  value={values.notes}
                  onChange={(event) => set("notes", event.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}
            disabled={saving}
          >
            {step === 0 ? (
              "Cancel"
            ) : (
              <>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </>
            )}
          </Button>
          <div className="flex gap-2">
            {step === STEPS.length - 1 && (
              <Button
                variant="ghost"
                onClick={() => void submit(true)}
                disabled={saving}
              >
                Skip and save
              </Button>
            )}
            <Button
              onClick={() => (step === STEPS.length - 1 ? void submit() : next())}
              disabled={saving}
            >
              {saving
                ? "Saving…"
                : step === STEPS.length - 1
                  ? "Add service"
                  : "Continue"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddServiceDialog;
