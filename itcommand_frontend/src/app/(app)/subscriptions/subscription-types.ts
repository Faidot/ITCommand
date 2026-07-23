export type BillingCycle = "MONTHLY" | "YEARLY";

export interface Subscription {
  id: number;
  name: string;
  platform: string;
  plan_type: string;
  category: string;
  cost: number;
  currency: string;
  billing_cycle: BillingCycle;
  start_date: string;
  expiry_date: string;
  purpose: string;
  team: string;
  department: number | null;
  department_name: string;
  owner: number | null;
  owner_name: string;
  owner_email: string;
  admin: number | null;
  admin_name: string;
  admin_email: string;
  vendor: number | null;
  vendor_name: string;
  vendor_contract: number | null;
  vendor_contract_title: string;
  vendor_contract_number: string;
  budget_category: number | null;
  budget_category_name: string;
  vault_credential: number | null;
  vault_credential_title: string;
  linked_license: number | null;
  linked_license_name: string;
  payment_card: number | null;
  payment_card_display: string | null;
  billing_descriptor: string;
  url: string;
  status: string;
  effective_status: string;
  auto_renew: boolean;
  renewal_reminder_enabled: boolean;
  renewal_reminder_days: number;
  cancellation_deadline: string | null;
  cancellation_reminder_enabled: boolean;
  cancellation_reminder_days: number;
  seats_total: number | null;
  seats_used: number;
  seats_available: number | null;
  seats_usage_pct: number;
  notes: string;
  monthly_cost: number;
  annual_cost: number;
  days_until_expiry: number | null;
}

export interface SubscriptionFormValues {
  name: string;
  platform: string;
  plan_type: string;
  category: string;
  cost: string;
  currency: string;
  billing_cycle: BillingCycle;
  start_date: string;
  expiry_date: string;
  purpose: string;
  team: string;
  department: string;
  owner: string;
  admin: string;
  vendor: string;
  vendor_contract: string;
  budget_category: string;
  vault_credential: string;
  linked_license: string;
  url: string;
  status: string;
  auto_renew: boolean;
  renewal_reminder_enabled: boolean;
  renewal_reminder_days: string;
  cancellation_deadline: string;
  cancellation_reminder_enabled: boolean;
  cancellation_reminder_days: string;
  seats_total: string;
  notes: string;
}

export interface UserOption {
  id: number;
  full_name: string;
  email: string;
  can_receive_subscription_alerts?: boolean;
}

export interface DepartmentOption {
  id: number;
  name: string;
}

export interface VendorOption {
  id: number;
  name: string;
}

export interface ContractOption {
  id: number;
  title: string;
  contract_number: string;
  vendor: number | null;
}

export interface BudgetCategoryOption {
  id: number;
  name: string;
}

export interface VaultCredentialOption {
  id: number;
  title: string;
}

export interface CurrencyOption {
  value: string;
  label: string;
}

export interface LicenseOption {
  id: number;
  name: string;
}

export interface CategorySpend {
  category: string;
  category_label: string;
  currency: string;
  monthly_spend: number;
  yearly_spend: number;
  count: number;
}

export interface CurrencySpend {
  currency: string;
  monthly_spend: number;
  yearly_spend: number;
  count: number;
}

export interface SubscriptionBudget {
  currency: string;
  monthly_threshold: number | null;
  yearly_threshold: number | null;
  monthly_spend: number;
  yearly_spend: number;
  monthly_usage_percent: number | null;
  yearly_usage_percent: number | null;
  monthly_exceeded: boolean;
  yearly_exceeded: boolean;
  // Spend now totals every currency converted into the budget currency.
  unconvertible: { currency: string; amount: string }[];
  rates_as_of: string | null;
}

export interface ConvertedSpend {
  currency: string;
  monthly_spend: number;
  yearly_spend: number;
  rates_as_of: string | null;
  /** Amounts with no exchange rate — reported, never silently counted. */
  unconvertible: { currency: string; amount: string }[];
  is_complete: boolean;
}

export interface CategoryBudgetUsage {
  category: string;
  category_label: string;
  currency: string;
  monthly_spend: number;
  yearly_spend: number;
  monthly_threshold: number | null;
  yearly_threshold: number | null;
  monthly_usage_percent: number | null;
  yearly_usage_percent: number | null;
  monthly_exceeded: boolean;
  yearly_exceeded: boolean;
}

export interface SubscriptionDashboard {
  converted: ConvertedSpend | null;
  monthly_spend: number;
  yearly_spend: number;
  active_count: number;
  expired_count: number;
  upcoming_count: number;
  currency: string;
  upcoming_renewals: Subscription[];
  spend_by_category: CategorySpend[];
  spend_by_currency: CurrencySpend[];
  budget: SubscriptionBudget | null;
  category_budgets: CategoryBudgetUsage[];
}

export interface SubscriptionSettings {
  notifications_enabled: boolean;
  notify_owners: boolean;
  default_renewal_reminder_days: number;
  default_cancellation_reminder_days: number;
  monthly_budget_threshold: number | null;
  yearly_budget_threshold: number | null;
  budget_currency: string;
}

export const EMPTY_SUBSCRIPTION_FORM: SubscriptionFormValues = {
  name: "",
  platform: "",
  plan_type: "",
  category: "SAAS",
  cost: "",
  currency: "USD",
  billing_cycle: "MONTHLY",
  start_date: "",
  expiry_date: "",
  purpose: "",
  team: "",
  department: "none",
  owner: "none",
  admin: "none",
  vendor: "none",
  vendor_contract: "none",
  budget_category: "none",
  vault_credential: "none",
  linked_license: "none",
  url: "",
  status: "ACTIVE",
  auto_renew: false,
  renewal_reminder_enabled: true,
  renewal_reminder_days: "30",
  cancellation_deadline: "",
  cancellation_reminder_enabled: false,
  cancellation_reminder_days: "7",
  seats_total: "",
  notes: "",
};

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function listFromResponse<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (isRecord(value) && Array.isArray(value.results)) return value.results as T[];
  return [];
}

export function normalizeSubscription(value: unknown): Subscription | null {
  if (!isRecord(value)) return null;
  const id = numberValue(value.id, Number.NaN);
  if (!Number.isFinite(id)) return null;

  const billing = stringValue(value.billing_cycle, "MONTHLY").toUpperCase();
  const cost = numberValue(value.cost);
  const monthlyCost = numberValue(
    value.monthly_cost,
    billing === "YEARLY" ? cost / 12 : cost,
  );
  const annualCost = numberValue(
    value.annual_cost,
    billing === "YEARLY" ? cost : cost * 12,
  );
  const status = stringValue(value.status, "ACTIVE").toUpperCase();

  return {
    id,
    name: stringValue(value.name, "Unnamed subscription"),
    platform: stringValue(value.platform),
    plan_type: stringValue(value.plan_type),
    category: stringValue(value.category, "Other"),
    cost,
    currency: stringValue(value.currency, "USD").toUpperCase(),
    billing_cycle: billing === "YEARLY" ? "YEARLY" : "MONTHLY",
    start_date: stringValue(value.start_date),
    expiry_date: stringValue(value.expiry_date),
    purpose: stringValue(value.purpose),
    team: stringValue(value.team),
    department: nullableNumber(value.department),
    department_name: stringValue(value.department_name),
    owner: nullableNumber(value.owner),
    owner_name: stringValue(value.owner_name),
    owner_email: stringValue(value.owner_email),
    admin: nullableNumber(value.admin),
    admin_name: stringValue(value.admin_name),
    admin_email: stringValue(value.admin_email),
    vendor: nullableNumber(value.vendor),
    vendor_name: stringValue(value.vendor_name),
    vendor_contract: nullableNumber(value.vendor_contract),
    vendor_contract_title: stringValue(value.vendor_contract_title),
    vendor_contract_number: stringValue(value.vendor_contract_number),
    budget_category: nullableNumber(value.budget_category),
    budget_category_name: stringValue(value.budget_category_name),
    vault_credential: nullableNumber(value.vault_credential),
    vault_credential_title: stringValue(value.vault_credential_title),
    linked_license: nullableNumber(value.linked_license),
    linked_license_name: stringValue(value.linked_license_name),
    payment_card: nullableNumber(value.payment_card),
    payment_card_display: nullableString(value.payment_card_display),
    billing_descriptor: stringValue(value.billing_descriptor),
    seats_total: nullableNumber(value.seats_total),
    seats_used: numberValue(value.seats_used),
    seats_available: nullableNumber(value.seats_available),
    seats_usage_pct: numberValue(value.seats_usage_pct),
    url: stringValue(value.url),
    status,
    effective_status: stringValue(value.effective_status, status).toUpperCase(),
    auto_renew: value.auto_renew === true,
    renewal_reminder_enabled: value.renewal_reminder_enabled !== false,
    renewal_reminder_days: numberValue(value.renewal_reminder_days, 30),
    cancellation_deadline: nullableString(value.cancellation_deadline),
    cancellation_reminder_enabled: value.cancellation_reminder_enabled === true,
    cancellation_reminder_days: numberValue(value.cancellation_reminder_days, 7),
    notes: stringValue(value.notes),
    monthly_cost: monthlyCost,
    annual_cost: annualCost,
    days_until_expiry: nullableNumber(value.days_until_expiry),
  };
}

export function subscriptionToForm(subscription: Subscription): SubscriptionFormValues {
  return {
    name: subscription.name,
    platform: subscription.platform,
    plan_type: subscription.plan_type,
    category: subscription.category,
    cost: String(subscription.cost),
    currency: subscription.currency,
    billing_cycle: subscription.billing_cycle,
    start_date: subscription.start_date,
    expiry_date: subscription.expiry_date,
    purpose: subscription.purpose,
    team: subscription.team,
    department: subscription.department === null ? "none" : String(subscription.department),
    owner: subscription.owner === null ? "none" : String(subscription.owner),
    admin: subscription.admin === null ? "none" : String(subscription.admin),
    vendor: subscription.vendor === null ? "none" : String(subscription.vendor),
    vendor_contract:
      subscription.vendor_contract === null ? "none" : String(subscription.vendor_contract),
    budget_category:
      subscription.budget_category === null ? "none" : String(subscription.budget_category),
    vault_credential:
      subscription.vault_credential === null ? "none" : String(subscription.vault_credential),
    linked_license:
      subscription.linked_license === null ? "none" : String(subscription.linked_license),
    seats_total: subscription.seats_total === null ? "" : String(subscription.seats_total),
    url: subscription.url,
    status: subscription.status,
    auto_renew: subscription.auto_renew,
    renewal_reminder_enabled: subscription.renewal_reminder_enabled,
    renewal_reminder_days: String(subscription.renewal_reminder_days),
    cancellation_deadline: subscription.cancellation_deadline || "",
    cancellation_reminder_enabled: subscription.cancellation_reminder_enabled,
    cancellation_reminder_days: String(subscription.cancellation_reminder_days),
    notes: subscription.notes,
  };
}

export function subscriptionPayload(values: SubscriptionFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    platform: values.platform.trim(),
    plan_type: values.plan_type.trim(),
    category: values.category.trim(),
    cost: Number(values.cost),
    currency: values.currency.trim().toUpperCase(),
    billing_cycle: values.billing_cycle,
    start_date: values.start_date,
    expiry_date: values.expiry_date,
    purpose: values.purpose.trim(),
    team: values.team.trim(),
    department: values.department === "none" ? null : Number(values.department),
    owner: values.owner === "none" ? null : Number(values.owner),
    admin: values.admin === "none" ? null : Number(values.admin),
    vendor: values.vendor === "none" ? null : Number(values.vendor),
    vendor_contract:
      values.vendor_contract === "none" ? null : Number(values.vendor_contract),
    budget_category:
      values.budget_category === "none" ? null : Number(values.budget_category),
    vault_credential:
      values.vault_credential === "none" ? null : Number(values.vault_credential),
    linked_license:
      values.linked_license === "none" ? null : Number(values.linked_license),
    seats_total: values.seats_total.trim() === "" ? null : Number(values.seats_total),
    url: values.url.trim(),
    status: values.status,
    auto_renew: values.auto_renew,
    renewal_reminder_enabled: values.renewal_reminder_enabled,
    renewal_reminder_days: Number(values.renewal_reminder_days),
    cancellation_deadline: values.cancellation_deadline || null,
    cancellation_reminder_enabled: values.cancellation_reminder_enabled,
    cancellation_reminder_days: Number(values.cancellation_reminder_days),
    notes: values.notes.trim(),
  };
}

export function validateSubscriptionForm(values: SubscriptionFormValues): string | null {
  if (!values.name.trim()) return "Subscription name is required.";
  if (!values.platform.trim()) return "Platform is required.";
  if (!values.plan_type.trim()) return "Plan type is required.";
  if (!values.category.trim()) return "Category is required.";
  if (values.cost === "" || !Number.isFinite(Number(values.cost)) || Number(values.cost) < 0) {
    return "Cost must be zero or greater.";
  }
  if (!/^[A-Za-z]{3}$/.test(values.currency.trim())) {
    return "Currency must be a 3-letter currency code.";
  }
  if (!values.start_date) return "Start date is required.";
  if (!values.expiry_date) return "Expiry or renewal date is required.";
  if (values.expiry_date < values.start_date) return "Expiry date cannot be before the start date.";
  if (!values.purpose.trim()) return "Please record why this subscription is used.";
  if (!Number.isInteger(Number(values.renewal_reminder_days)) || Number(values.renewal_reminder_days) < 0) {
    return "Renewal reminder must be a whole number of days.";
  }
  if (!Number.isInteger(Number(values.cancellation_reminder_days)) || Number(values.cancellation_reminder_days) < 0) {
    return "Cancellation reminder must be a whole number of days.";
  }
  if (values.seats_total.trim() !== "") {
    const seats = Number(values.seats_total);
    if (!Number.isInteger(seats) || seats < 0) {
      return "Seats must be a whole number, or blank for unlimited.";
    }
  }
  if (values.cancellation_reminder_enabled && !values.cancellation_deadline) {
    return "A cancellation deadline is required when cancellation reminders are enabled.";
  }
  if (values.cancellation_deadline && values.cancellation_deadline < values.start_date) {
    return "Cancellation deadline cannot be before the start date.";
  }
  if (values.cancellation_deadline && values.cancellation_deadline > values.expiry_date) {
    return "Cancellation deadline cannot be after the expiry date.";
  }
  if (values.url) {
    try {
      const url = new URL(values.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "Website must use http or https.";
    } catch {
      return "Website must be a valid URL, including https://.";
    }
  }
  return null;
}

export function formatMoney(amount: number, currency: string, compact = false): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "USD",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(amount);
  } catch {
    return `${currency || "USD"} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
