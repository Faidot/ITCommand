"use client";

import { useEffect, useState } from "react";
import { BellRing, CalendarClock, CreditCard, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

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
  DepartmentOption,
  EMPTY_SUBSCRIPTION_FORM,
  BudgetCategoryOption,
  ContractOption,
  CurrencyOption,
  LicenseOption,
  Subscription,
  SubscriptionFormValues,
  UserOption,
  VaultCredentialOption,
  VendorOption,
  subscriptionToForm,
  validateSubscriptionForm,
} from "./subscription-types";

const CATEGORIES = [
  ["CLOUD", "Cloud infrastructure"],
  ["AI", "AI tools"],
  ["SAAS", "SaaS"],
  ["PRODUCTIVITY", "Productivity"],
  ["COMMUNICATION", "Communication"],
  ["DESIGN", "Design"],
  ["DEVELOPMENT", "Development"],
  ["SECURITY", "Security"],
  ["FINANCE", "Finance"],
  ["HR", "HR"],
  ["OTHER", "Other"],
] as const;

interface SubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription | null;
  users: UserOption[];
  departments: DepartmentOption[];
  vendors?: VendorOption[];
  contracts?: ContractOption[];
  budgetCategories?: BudgetCategoryOption[];
  vaultCredentials?: VaultCredentialOption[];
  licenses?: LicenseOption[];
  currencies?: CurrencyOption[];
  defaultReminderDays?: number;
  defaultCancellationReminderDays?: number;
  defaultCurrency?: string;
  onSubmit: (values: SubscriptionFormValues) => Promise<boolean>;
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}{required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b pb-2 text-sm font-semibold">
      <Icon className="h-4 w-4 text-primary" />
      {children}
    </div>
  );
}

export function SubscriptionDialog({
  open,
  onOpenChange,
  subscription,
  users,
  departments,
  vendors = [],
  contracts = [],
  budgetCategories = [],
  vaultCredentials = [],
  licenses = [],
  currencies = [],
  defaultReminderDays = 30,
  defaultCancellationReminderDays = 7,
  defaultCurrency = "USD",
  onSubmit,
}: SubscriptionDialogProps) {
  const [values, setValues] = useState<SubscriptionFormValues>({
    ...EMPTY_SUBSCRIPTION_FORM,
    renewal_reminder_days: String(defaultReminderDays),
    cancellation_reminder_days: String(defaultCancellationReminderDays),
    currency: defaultCurrency,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(
      subscription
        ? subscriptionToForm(subscription)
        : {
            ...EMPTY_SUBSCRIPTION_FORM,
            renewal_reminder_days: String(defaultReminderDays),
            cancellation_reminder_days: String(defaultCancellationReminderDays),
            currency: defaultCurrency,
          },
    );
  }, [defaultCancellationReminderDays, defaultCurrency, defaultReminderDays, open, subscription]);

  // Contracts belong to a vendor; the API rejects a mismatched pair, so only
  // offer contracts for the chosen vendor and drop a contract that no longer
  // matches when the vendor changes.
  const visibleContracts =
    values.vendor === "none"
      ? contracts
      : contracts.filter((contract) => String(contract.vendor) === values.vendor);

  const setVendor = (vendor: string) => {
    setValues((current) => {
      const contract = contracts.find((item) => String(item.id) === current.vendor_contract);
      const keepContract =
        vendor === "none" || !contract || String(contract.vendor) === vendor;
      return {
        ...current,
        vendor,
        vendor_contract: keepContract ? current.vendor_contract : "none",
      };
    });
  };

  const currencyOptions = (() => {
    const base = currencies.length
      ? currencies
      : [{ value: "USD", label: "US Dollar" }];
    const current = values.currency;
    return current && !base.some((c) => c.value === current)
      ? [...base, { value: current, label: "Current value" }]
      : base;
  })();

  const set = <K extends keyof SubscriptionFormValues>(key: K, value: SubscriptionFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    const validationError = validateSubscriptionForm(values);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const saved = await onSubmit(values);
      if (saved) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>{subscription ? `Edit ${subscription.name}` : "Add subscription"}</DialogTitle>
          <DialogDescription>
            Track ownership, business purpose, spend, renewal dates, and reminders in one record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-4">
            <SectionTitle icon={CreditCard}>Service and billing</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Subscription name" htmlFor="subscription-name" required>
                <Input
                  id="subscription-name"
                  value={values.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="e.g. AWS Production"
                  autoFocus
                />
              </Field>
              <Field label="Platform" htmlFor="subscription-platform" required>
                <Input
                  id="subscription-platform"
                  list="subscription-platforms"
                  value={values.platform}
                  onChange={(event) => set("platform", event.target.value)}
                  placeholder="AWS, ChatGPT, Claude…"
                />
                <datalist id="subscription-platforms">
                  {[
                    "AWS", "Microsoft Azure", "Google Cloud", "ChatGPT", "Claude AI",
                    "Slack", "Notion", "Figma", "GitHub", "Microsoft 365",
                  ].map((platform) => <option key={platform} value={platform} />)}
                </datalist>
              </Field>
              <Field label="Plan type" htmlFor="subscription-plan" required>
                <Input
                  id="subscription-plan"
                  value={values.plan_type}
                  onChange={(event) => set("plan_type", event.target.value)}
                  placeholder="Business, Enterprise, Pro…"
                />
              </Field>
              <Field label="Category" htmlFor="subscription-category" required>
                <Select value={values.category} onValueChange={(value) => set("category", value)}>
                  <SelectTrigger id="subscription-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cost" htmlFor="subscription-cost" required>
                <Input
                  id="subscription-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.cost}
                  onChange={(event) => set("cost", event.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Currency"
                  htmlFor="subscription-currency"
                  required
                  hint="What this service is actually billed in."
                >
                  <Select
                    value={values.currency}
                    onValueChange={(value) => set("currency", value)}
                  >
                    <SelectTrigger id="subscription-currency">
                      <SelectValue placeholder="Choose a currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {currencyOptions.map((currency) => (
                        <SelectItem key={currency.value} value={currency.value}>
                          {currency.value} — {currency.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Billing cycle" htmlFor="subscription-billing" required>
                  <Select
                    value={values.billing_cycle}
                    onValueChange={(value: "MONTHLY" | "YEARLY") => set("billing_cycle", value)}
                  >
                    <SelectTrigger id="subscription-billing"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="YEARLY">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Start date" htmlFor="subscription-start" required>
                <Input
                  id="subscription-start"
                  type="date"
                  value={values.start_date}
                  onChange={(event) => set("start_date", event.target.value)}
                />
              </Field>
              <Field label="Renewal / expiry date" htmlFor="subscription-expiry" required>
                <Input
                  id="subscription-expiry"
                  type="date"
                  min={values.start_date || undefined}
                  value={values.expiry_date}
                  onChange={(event) => set("expiry_date", event.target.value)}
                />
              </Field>
              <Field label="Status" htmlFor="subscription-status">
                <Select value={values.status} onValueChange={(value) => set("status", value)}>
                  <SelectTrigger id="subscription-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="PAUSED">Paused</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Service URL" htmlFor="subscription-url" hint="Include https:// so members can open it safely.">
                <Input
                  id="subscription-url"
                  type="url"
                  value={values.url}
                  onChange={(event) => set("url", event.target.value)}
                  placeholder="https://console.example.com"
                />
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle icon={Users}>Usage and ownership</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Team" htmlFor="subscription-team">
                <Input
                  id="subscription-team"
                  value={values.team}
                  onChange={(event) => set("team", event.target.value)}
                  placeholder="Engineering, Support…"
                />
              </Field>
              <Field label="Department" htmlFor="subscription-department">
                <Select value={values.department} onValueChange={(value) => set("department", value)}>
                  <SelectTrigger id="subscription-department"><SelectValue placeholder="No department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No department</SelectItem>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={String(department.id)}>{department.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Business owner" htmlFor="subscription-owner" hint="The person accountable for this subscription.">
                <Select value={values.owner} onValueChange={(value) => set("owner", value)}>
                  <SelectTrigger id="subscription-owner"><SelectValue placeholder="No owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No owner</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.full_name || user.email}
                        {user.can_receive_subscription_alerts === false ? " (no alert access)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Platform admin" htmlFor="subscription-admin" hint="The member who administers the vendor account.">
                <Select value={values.admin} onValueChange={(value) => set("admin", value)}>
                  <SelectTrigger id="subscription-admin"><SelectValue placeholder="No admin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No admin</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.full_name || user.email}
                        {user.can_receive_subscription_alerts === false ? " (no alert access)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {vendors.length > 0 ? (
                <Field
                  label="Vendor"
                  htmlFor="subscription-vendor"
                  hint="Links this subscription's cost into vendor spend reporting."
                >
                  <Select value={values.vendor} onValueChange={setVendor}>
                    <SelectTrigger id="subscription-vendor"><SelectValue placeholder="No vendor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No vendor</SelectItem>
                      {vendors.map((vendor) => (
                        <SelectItem key={vendor.id} value={String(vendor.id)}>{vendor.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {contracts.length > 0 ? (
                <Field
                  label="Vendor contract"
                  htmlFor="subscription-contract"
                  hint={
                    values.vendor === "none"
                      ? "Pick a vendor first to narrow this list."
                      : "Only contracts for the selected vendor are shown."
                  }
                >
                  <Select
                    value={values.vendor_contract}
                    onValueChange={(value) => set("vendor_contract", value)}
                  >
                    <SelectTrigger id="subscription-contract"><SelectValue placeholder="No contract" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No contract</SelectItem>
                      {visibleContracts.map((contract) => (
                        <SelectItem key={contract.id} value={String(contract.id)}>
                          {contract.title}
                          {contract.contract_number ? ` (${contract.contract_number})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {budgetCategories.length > 0 ? (
                <Field
                  label="Budget category"
                  htmlFor="subscription-budget-category"
                  hint="Reconciles this spend against the IT budget."
                >
                  <Select
                    value={values.budget_category}
                    onValueChange={(value) => set("budget_category", value)}
                  >
                    <SelectTrigger id="subscription-budget-category"><SelectValue placeholder="No budget category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No budget category</SelectItem>
                      {budgetCategories.map((category) => (
                        <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {vaultCredentials.length > 0 ? (
                <Field
                  label="Vault credential"
                  htmlFor="subscription-vault-credential"
                  hint="The admin login stored in the vault for this service."
                >
                  <Select
                    value={values.vault_credential}
                    onValueChange={(value) => set("vault_credential", value)}
                  >
                    <SelectTrigger id="subscription-vault-credential"><SelectValue placeholder="No credential" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No credential</SelectItem>
                      {vaultCredentials.map((credential) => (
                        <SelectItem key={credential.id} value={String(credential.id)}>{credential.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {licenses.length > 0 ? (
                <Field
                  label="Related licence"
                  htmlFor="subscription-linked-license"
                  hint="Cross-links a software licence covering the same service."
                >
                  <Select
                    value={values.linked_license}
                    onValueChange={(value) => set("linked_license", value)}
                  >
                    <SelectTrigger id="subscription-linked-license"><SelectValue placeholder="No licence" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No licence</SelectItem>
                      {licenses.map((license) => (
                        <SelectItem key={license.id} value={String(license.id)}>{license.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field
                label="Seats"
                htmlFor="subscription-seats"
                hint="Leave blank for unlimited. Assign people to seats from the subscription's page."
              >
                <Input
                  id="subscription-seats"
                  type="number"
                  min={0}
                  step={1}
                  value={values.seats_total}
                  onChange={(event) => set("seats_total", event.target.value)}
                  placeholder="Unlimited"
                />
              </Field>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="subscription-purpose">
                  Why it&apos;s used<span className="ml-1 text-destructive">*</span>
                </Label>
                <Textarea
                  id="subscription-purpose"
                  value={values.purpose}
                  onChange={(event) => set("purpose", event.target.value)}
                  placeholder="e.g. Hosting production servers and nightly backups"
                  rows={3}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle icon={BellRing}>Renewal and cancellation reminders</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="subscription-renewal-reminder">Renewal reminder</Label>
                    <p className="text-xs text-muted-foreground">Notify members before the expiry date.</p>
                  </div>
                  <Switch
                    id="subscription-renewal-reminder"
                    checked={values.renewal_reminder_enabled}
                    onCheckedChange={(checked) => set("renewal_reminder_enabled", checked)}
                  />
                </div>
                <Field label="Days before renewal" htmlFor="subscription-reminder-days">
                  <Input
                    id="subscription-reminder-days"
                    type="number"
                    min="0"
                    step="1"
                    disabled={!values.renewal_reminder_enabled}
                    value={values.renewal_reminder_days}
                    onChange={(event) => set("renewal_reminder_days", event.target.value)}
                  />
                </Field>
                <div className="flex items-center justify-between gap-4 rounded-md bg-muted/50 p-3">
                  <div>
                    <Label htmlFor="subscription-auto-renew">Auto-renewal</Label>
                    <p className="text-xs text-muted-foreground">Flag services that charge automatically.</p>
                  </div>
                  <Switch
                    id="subscription-auto-renew"
                    checked={values.auto_renew}
                    onCheckedChange={(checked) => set("auto_renew", checked)}
                  />
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="subscription-cancellation-reminder">Cancellation reminder</Label>
                    <p className="text-xs text-muted-foreground">Warn before the last cancellation date.</p>
                  </div>
                  <Switch
                    id="subscription-cancellation-reminder"
                    checked={values.cancellation_reminder_enabled}
                    onCheckedChange={(checked) => set("cancellation_reminder_enabled", checked)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cancellation deadline" htmlFor="subscription-cancellation-date">
                    <Input
                      id="subscription-cancellation-date"
                      type="date"
                      disabled={!values.cancellation_reminder_enabled}
                      value={values.cancellation_deadline}
                      onChange={(event) => set("cancellation_deadline", event.target.value)}
                    />
                  </Field>
                  <Field label="Days before" htmlFor="subscription-cancellation-days">
                    <Input
                      id="subscription-cancellation-days"
                      type="number"
                      min="0"
                      step="1"
                      disabled={!values.cancellation_reminder_enabled}
                      value={values.cancellation_reminder_days}
                      onChange={(event) => set("cancellation_reminder_days", event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle icon={ShieldCheck}>Internal notes</SectionTitle>
            <Textarea
              aria-label="Internal notes"
              value={values.notes}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="Contract details, approval context, cancellation instructions, or anything else the team should know."
              rows={3}
            />
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            <CalendarClock className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : subscription ? "Save changes" : "Add subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
