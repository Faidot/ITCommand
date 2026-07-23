"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAxiosError } from "axios";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  WalletCards,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { summarizeBulkDelete, useBulkSelection } from "@/hooks/use-bulk-selection";
import api from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { SubscriptionDialog } from "./subscription-dialog";
import {
  CategoryBudgetUsage,
  CategorySpend,
  CurrencySpend,
  BudgetCategoryOption,
  ContractOption,
  CurrencyOption,
  DepartmentOption,
  LicenseOption,
  VaultCredentialOption,
  VendorOption,
  Subscription,
  SubscriptionBudget,
  SubscriptionDashboard,
  SubscriptionFormValues,
  SubscriptionSettings,
  ConvertedSpend,
  UserOption,
  formatDate,
  formatMoney,
  listFromResponse,
  normalizeSubscription,
  subscriptionPayload,
} from "./subscription-types";

const CATEGORY_LABELS: Record<string, string> = {
  CLOUD: "Cloud infrastructure",
  AI: "AI tools",
  SAAS: "SaaS",
  PRODUCTIVITY: "Productivity",
  COMMUNICATION: "Communication",
  DESIGN: "Design",
  DEVELOPMENT: "Development",
  SECURITY: "Security",
  FINANCE: "Finance",
  HR: "HR",
  OTHER: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  EXPIRED: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  SCHEDULED: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  PAUSED: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  CANCELLED: "border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = numeric(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const data: unknown = error.response?.data;
  if (typeof data === "string" && data.trim()) return data;
  if (!isRecord(data)) return fallback;
  if (typeof data.detail === "string") return data.detail;

  for (const value of Object.values(data)) {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return fallback;
}

function calculatedDaysUntil(dateValue: string): number | null {
  if (!dateValue) return null;
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - now.getTime()) / 86_400_000);
}

function daysUntil(subscription: Subscription): number | null {
  return subscription.days_until_expiry ?? calculatedDaysUntil(subscription.expiry_date);
}

function renewalLabel(subscription: Subscription): { text: string; className: string } {
  const days = daysUntil(subscription);
  if (days === null) return { text: "No renewal date", className: "text-muted-foreground" };
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, className: "text-red-600 dark:text-red-400" };
  if (days === 0) return { text: "Renews today", className: "text-red-600 dark:text-red-400" };
  if (days <= 7) return { text: `In ${days} days`, className: "text-red-600 dark:text-red-400" };
  if (days <= 30) return { text: `In ${days} days`, className: "text-amber-600 dark:text-amber-400" };
  return { text: `In ${days} days`, className: "text-muted-foreground" };
}

function normalizedStatus(subscription: Subscription): string {
  if (subscription.effective_status) return subscription.effective_status;
  const days = daysUntil(subscription);
  if (days !== null && days < 0 && subscription.status === "ACTIVE") return "EXPIRED";
  return subscription.status || "ACTIVE";
}

/** Annualised cost, so monthly and yearly plans sort on the same basis. */
function annualCostOf(subscription: Subscription): number {
  const cost = Number(subscription.cost) || 0;
  return subscription.billing_cycle === "MONTHLY" ? cost * 12 : cost;
}

type SortKey = "name" | "cost" | "renewal" | "status";

function SortHeader({
  label, col, sortKey, sortDir, onSort,
}: {
  label: string; col: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`inline-flex items-center gap-1 select-none hover:text-foreground ${active ? "text-foreground font-medium" : ""}`}
    >
      {label}
      <Icon className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-40"}`} />
    </button>
  );
}

function subscriptionsFromResponse(value: unknown): Subscription[] {
  return listFromResponse<unknown>(value)
    .map(normalizeSubscription)
    .filter((subscription): subscription is Subscription => subscription !== null);
}

function nextPagePath(value: unknown): string | null {
  if (!isRecord(value) || typeof value.next !== "string" || !value.next) return null;
  try {
    const url = new URL(value.next, window.location.origin);
    const apiMarker = "/api/";
    const apiIndex = url.pathname.indexOf(apiMarker);
    const path = apiIndex >= 0 ? url.pathname.slice(apiIndex + 4) : url.pathname;
    return `${path.startsWith("/") ? path : `/${path}`}${url.search}`;
  } catch {
    return null;
  }
}

async function fetchEverySubscription(): Promise<Subscription[]> {
  const subscriptions: Subscription[] = [];
  let path: string | null = "/subscriptions/?page_size=200";
  const visitedPaths = new Set<string>();

  while (path && !visitedPaths.has(path)) {
    visitedPaths.add(path);
    const response = await api.get<unknown>(path);
    subscriptions.push(...subscriptionsFromResponse(response.data));
    path = nextPagePath(response.data);
  }
  return subscriptions;
}

function computedDashboard(subscriptions: Subscription[], currency = "USD"): SubscriptionDashboard {
  const active = subscriptions.filter((subscription) => normalizedStatus(subscription) === "ACTIVE");
  const matchingCurrency = active.filter((subscription) => subscription.currency === currency);
  const upcoming = active
    .filter((subscription) => {
      const days = daysUntil(subscription);
      return days !== null && days >= 0 && days <= 60;
    })
    .sort((left, right) => (daysUntil(left) ?? 9999) - (daysUntil(right) ?? 9999));

  const categoryMap = new Map<string, CategorySpend>();
  const currencyMap = new Map<string, CurrencySpend>();
  for (const subscription of active) {
    const annualCost = subscription.billing_cycle === "MONTHLY"
      ? subscription.cost * 12
      : subscription.cost;
    const categoryKey = `${subscription.category}:${subscription.currency}`;
    const category = categoryMap.get(categoryKey) || {
      category: subscription.category,
      category_label: CATEGORY_LABELS[subscription.category] || subscription.category,
      currency: subscription.currency,
      monthly_spend: 0,
      yearly_spend: 0,
      count: 0,
    };
    category.yearly_spend += annualCost;
    category.count += 1;
    categoryMap.set(categoryKey, category);

    const byCurrency = currencyMap.get(subscription.currency) || {
      currency: subscription.currency,
      monthly_spend: 0,
      yearly_spend: 0,
      count: 0,
    };
    byCurrency.yearly_spend += annualCost;
    byCurrency.count += 1;
    currencyMap.set(subscription.currency, byCurrency);
  }
  categoryMap.forEach((category) => {
    category.monthly_spend = category.yearly_spend / 12;
  });
  currencyMap.forEach((totals) => {
    totals.monthly_spend = totals.yearly_spend / 12;
  });

  const matchingYearlySpend = matchingCurrency.reduce(
    (total, subscription) => total + (
      subscription.billing_cycle === "MONTHLY"
        ? subscription.cost * 12
        : subscription.cost
    ),
    0,
  );

  return {
    monthly_spend: matchingYearlySpend / 12,
    yearly_spend: matchingYearlySpend,
    active_count: active.length,
    expired_count: subscriptions.filter((subscription) => normalizedStatus(subscription) === "EXPIRED").length,
    upcoming_count: upcoming.length,
    currency,
    upcoming_renewals: upcoming,
    spend_by_category: Array.from(categoryMap.values()),
    spend_by_currency: Array.from(currencyMap.values()),
    budget: null,
    converted: null,
    category_budgets: [],
  };
}

function normalizeCategorySpend(value: unknown): CategorySpend | null {
  if (!isRecord(value)) return null;
  const category = textValue(value.category, "OTHER");
  return {
    category,
    category_label: textValue(value.category_label, CATEGORY_LABELS[category] || category),
    currency: textValue(value.currency, "USD"),
    monthly_spend: numeric(value.monthly_spend),
    yearly_spend: numeric(value.yearly_spend),
    count: numeric(value.count),
  };
}

function normalizeCurrencySpend(value: unknown): CurrencySpend | null {
  if (!isRecord(value)) return null;
  const currency = textValue(value.currency);
  if (!currency) return null;
  return {
    currency,
    monthly_spend: numeric(value.monthly_spend),
    yearly_spend: numeric(value.yearly_spend),
    count: numeric(value.count),
  };
}

function normalizeBudget(value: unknown): SubscriptionBudget | null {
  if (!isRecord(value)) return null;
  return {
    currency: textValue(value.currency, "USD"),
    monthly_threshold: nullableNumeric(value.monthly_threshold),
    yearly_threshold: nullableNumeric(value.yearly_threshold),
    monthly_spend: numeric(value.monthly_spend),
    yearly_spend: numeric(value.yearly_spend),
    monthly_usage_percent: nullableNumeric(value.monthly_usage_percent),
    yearly_usage_percent: nullableNumeric(value.yearly_usage_percent),
    monthly_exceeded: boolValue(value.monthly_exceeded),
    yearly_exceeded: boolValue(value.yearly_exceeded),
    unconvertible: Array.isArray(value.unconvertible)
      ? value.unconvertible.flatMap((row) =>
          isRecord(row)
            ? [{ currency: textValue(row.currency, "?"), amount: textValue(row.amount, "0") }]
            : [],
        )
      : [],
    rates_as_of: typeof value.rates_as_of === "string" ? value.rates_as_of : null,
  };
}

/** Converted cross-currency totals, or null when the backend omits them. */
function normalizeConverted(value: unknown): ConvertedSpend | null {
  if (!isRecord(value)) return null;
  const unconvertible = Array.isArray(value.unconvertible)
    ? value.unconvertible.flatMap((row) =>
        isRecord(row)
          ? [{ currency: textValue(row.currency, "?"), amount: textValue(row.amount, "0") }]
          : [],
      )
    : [];
  return {
    currency: textValue(value.currency, "USD"),
    monthly_spend: numeric(value.monthly_spend),
    yearly_spend: numeric(value.yearly_spend),
    rates_as_of: typeof value.rates_as_of === "string" ? value.rates_as_of : null,
    unconvertible,
    is_complete: boolValue(value.is_complete, unconvertible.length === 0),
  };
}

function normalizeDashboard(value: unknown, subscriptions: Subscription[], fallbackCurrency: string): SubscriptionDashboard {
  const fallback = computedDashboard(subscriptions, fallbackCurrency);
  if (!isRecord(value)) return fallback;

  const currency = textValue(value.default_currency, fallback.currency);
  const upcoming = listFromResponse<unknown>(value.upcoming_renewals)
    .map(normalizeSubscription)
    .filter((subscription): subscription is Subscription => subscription !== null);
  const categories = Array.isArray(value.spend_by_category)
    ? value.spend_by_category.map(normalizeCategorySpend).filter((item): item is CategorySpend => item !== null)
    : [];
  const currencies = Array.isArray(value.spend_by_currency)
    ? value.spend_by_currency.map(normalizeCurrencySpend).filter((item): item is CurrencySpend => item !== null)
    : [];

  return {
    monthly_spend: numeric(value.monthly_spend, fallback.monthly_spend),
    yearly_spend: numeric(value.yearly_spend, fallback.yearly_spend),
    active_count: numeric(value.active_count, fallback.active_count),
    expired_count: numeric(value.expired_count, fallback.expired_count),
    upcoming_count: numeric(value.upcoming_count, upcoming.length || fallback.upcoming_count),
    currency,
    upcoming_renewals: upcoming.length ? upcoming : fallback.upcoming_renewals,
    spend_by_category: categories.length ? categories : fallback.spend_by_category,
    spend_by_currency: currencies.length ? currencies : fallback.spend_by_currency,
    budget: normalizeBudget(value.budget),
    converted: normalizeConverted(value.converted),
    category_budgets: Array.isArray(value.category_budgets)
      ? value.category_budgets.flatMap((row) => (isRecord(row) ? [{
          category: textValue(row.category, "OTHER"),
          category_label: textValue(row.category_label, textValue(row.category, "Other")),
          currency: textValue(row.currency, currency),
          monthly_spend: numeric(row.monthly_spend),
          yearly_spend: numeric(row.yearly_spend),
          monthly_threshold: nullableNumeric(row.monthly_threshold),
          yearly_threshold: nullableNumeric(row.yearly_threshold),
          monthly_usage_percent: nullableNumeric(row.monthly_usage_percent),
          yearly_usage_percent: nullableNumeric(row.yearly_usage_percent),
          monthly_exceeded: boolValue(row.monthly_exceeded),
          yearly_exceeded: boolValue(row.yearly_exceeded),
        }] : []))
      : [],
  };
}

function normalizeSettings(value: unknown): SubscriptionSettings | null {
  if (!isRecord(value)) return null;
  return {
    notifications_enabled: boolValue(value.notifications_enabled, true),
    notify_owners: boolValue(value.notify_owners, true),
    default_renewal_reminder_days: numeric(value.default_renewal_reminder_days, 30),
    default_cancellation_reminder_days: numeric(value.default_cancellation_reminder_days, 7),
    monthly_budget_threshold: nullableNumeric(value.monthly_budget_threshold),
    yearly_budget_threshold: nullableNumeric(value.yearly_budget_threshold),
    budget_currency: textValue(value.budget_currency, "USD"),
  };
}

function normalizeUsers(value: unknown): UserOption[] {
  return listFromResponse<unknown>(value).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = numeric(item.id, Number.NaN);
    if (!Number.isFinite(id)) return [];
    return [{
      id,
      full_name: textValue(item.full_name),
      email: textValue(item.email),
      can_receive_subscription_alerts: boolValue(
        item.can_receive_subscription_alerts,
        true,
      ),
    }];
  });
}

function normalizeDepartments(value: unknown): DepartmentOption[] {
  return listFromResponse<unknown>(value).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = numeric(item.id, Number.NaN);
    const name = textValue(item.name);
    if (!Number.isFinite(id) || !name) return [];
    return [{ id, name }];
  });
}

/** Shared shape for the {id, <label>} selector lists returned by /options/. */
function normalizeNamed<T>(value: unknown, labelKey: string, build: (id: number, label: string, item: Record<string, unknown>) => T): T[] {
  return listFromResponse<unknown>(value).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = numeric(item.id, Number.NaN);
    const label = textValue(item[labelKey]);
    if (!Number.isFinite(id) || !label) return [];
    return [build(id, label, item)];
  });
}

interface SubscriptionOptions {
  users: UserOption[];
  departments: DepartmentOption[];
  vendors: VendorOption[];
  contracts: ContractOption[];
  budgetCategories: BudgetCategoryOption[];
  vaultCredentials: VaultCredentialOption[];
  licenses: LicenseOption[];
  currencies: CurrencyOption[];
}

const EMPTY_OPTIONS: SubscriptionOptions = {
  users: [],
  departments: [],
  vendors: [],
  contracts: [],
  budgetCategories: [],
  vaultCredentials: [],
  licenses: [],
  currencies: [],
};

function optionsFromResponse(value: unknown): SubscriptionOptions {
  if (!isRecord(value)) return EMPTY_OPTIONS;
  return {
    users: normalizeUsers(value.users),
    departments: normalizeDepartments(value.departments),
    vendors: normalizeNamed(value.vendors, "name", (id, name) => ({ id, name })),
    contracts: normalizeNamed(value.contracts, "title", (id, title, item) => ({
      id,
      title,
      contract_number: textValue(item.contract_number),
      vendor: Number.isFinite(numeric(item.vendor, Number.NaN))
        ? numeric(item.vendor)
        : null,
    })),
    budgetCategories: normalizeNamed(value.budget_categories, "name", (id, name) => ({ id, name })),
    vaultCredentials: normalizeNamed(value.vault_credentials, "title", (id, title) => ({ id, title })),
    licenses: normalizeNamed(value.licenses, "name", (id, name) => ({ id, name })),
    currencies: listFromResponse<CurrencyOption>(value.currencies),
  };
}

function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  const Icon = status === "ACTIVE"
    ? CheckCircle2
    : status === "EXPIRED" || status === "CANCELLED"
      ? XCircle
      : status === "PAUSED"
        ? PauseCircle
        : CalendarClock;
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] || STATUS_STYLES.CANCELLED}>
      <Icon className="mr-1 h-3 w-3" />{label}
    </Badge>
  );
}

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  tone: string;
}) {
  return (
    <Card className="hover:-translate-y-0">
      <CardContent className="flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${tone}`}><Icon className="h-5 w-5" /></div>
      </CardContent>
    </Card>
  );
}

function BudgetMeter({
  label,
  spend,
  threshold,
  percent,
  exceeded,
  currency,
}: {
  label: string;
  spend: number;
  threshold: number | null;
  percent: number | null;
  exceeded: boolean;
  currency: string;
}) {
  const normalizedPercent = Math.max(0, percent || 0);
  const visiblePercent = Math.min(normalizedPercent, 100);
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-sm">
            {threshold
              ? `${formatMoney(spend, currency)} of ${formatMoney(threshold, currency)}`
              : `${formatMoney(spend, currency)} · no threshold set`}
          </p>
        </div>
        {percent !== null && (
          <Badge variant={exceeded ? "destructive" : "secondary"}>{Math.round(percent)}%</Badge>
        )}
      </div>
      {threshold !== null && threshold > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${exceeded ? "bg-red-500" : normalizedPercent >= 80 ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${visiblePercent}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BudgetProgress({ budget }: { budget: SubscriptionBudget }) {
  const exceeded = budget.monthly_exceeded || budget.yearly_exceeded;
  return (
    <div className={`rounded-xl border p-4 ${exceeded ? "border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30" : "bg-card/60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 ${exceeded ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-primary/10 text-primary"}`}>
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <p className="font-medium">Subscription budget</p>
            <p className="text-xs text-muted-foreground">
              All subscriptions converted into {budget.currency}
              {budget.rates_as_of ? ` · rates as of ${budget.rates_as_of}` : ""}
            </p>
          </div>
        </div>
        {exceeded && <Badge variant="destructive">Threshold exceeded</Badge>}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <BudgetMeter label="Monthly" spend={budget.monthly_spend} threshold={budget.monthly_threshold} percent={budget.monthly_usage_percent} exceeded={budget.monthly_exceeded} currency={budget.currency} />
        <BudgetMeter label="Yearly" spend={budget.yearly_spend} threshold={budget.yearly_threshold} percent={budget.yearly_usage_percent} exceeded={budget.yearly_exceeded} currency={budget.currency} />
      </div>
      {budget.unconvertible.length > 0 && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          No exchange rate for {budget.unconvertible.map((u) => `${u.currency} ${u.amount}`).join(", ")} — not included above.
        </p>
      )}
    </div>
  );
}

function CategoryBudgets({ rows }: { rows: CategoryBudgetUsage[] }) {
  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <div className="mb-3">
        <p className="font-medium">Category budgets</p>
        <p className="text-xs text-muted-foreground">Spend per category vs its allocation, converted into the budget currency.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.category} className={`rounded-lg border p-3 ${row.monthly_exceeded || row.yearly_exceeded ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : ""}`}>
            <p className="text-sm font-medium mb-2">{row.category_label}</p>
            <div className="space-y-3">
              {row.monthly_threshold !== null && (
                <BudgetMeter label="Monthly" spend={row.monthly_spend} threshold={row.monthly_threshold} percent={row.monthly_usage_percent} exceeded={row.monthly_exceeded} currency={row.currency} />
              )}
              {row.yearly_threshold !== null && (
                <BudgetMeter label="Yearly" spend={row.yearly_spend} threshold={row.yearly_threshold} percent={row.yearly_usage_percent} exceeded={row.yearly_exceeded} currency={row.currency} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrowserAlertsButton() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setPermission(window.Notification.permission);
  }, []);

  if (permission === "unsupported") return null;

  const enable = async () => {
    const nextPermission = await window.Notification.requestPermission();
    setPermission(nextPermission);
    if (nextPermission === "granted") toast.success("Browser subscription alerts enabled.");
    else if (nextPermission === "denied") toast.error("Browser notifications are blocked in your browser settings.");
  };

  return (
    <Button
      variant="outline"
      onClick={() => void enable()}
      disabled={permission !== "default"}
      title={permission === "denied" ? "Enable notifications in your browser settings" : undefined}
    >
      <BellRing className="mr-2 h-4 w-4" />
      {permission === "granted" ? "Browser alerts on" : permission === "denied" ? "Alerts blocked" : "Enable browser alerts"}
    </Button>
  );
}

export default function SubscriptionsPage() {
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const router = useRouter();
  const openedDeepLink = useRef<number | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dashboard, setDashboard] = useState<SubscriptionDashboard>(() => computedDashboard([]));
  const [settings, setSettings] = useState<SubscriptionSettings | null>(null);
  const [options, setOptions] = useState<SubscriptionOptions>(EMPTY_OPTIONS);
  const { users, departments } = options;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [billingFilter, setBillingFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("renewal");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "cost" ? "desc" : "asc"); }
  };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const sel = useBulkSelection<number>();
  const clearSelection = sel.clear;
  const [bulkBusy, setBulkBusy] = useState(false);

  const canAdd = can(user, "subscriptions", "add");
  const canEdit = can(user, "subscriptions", "edit");
  const canDelete = can(user, "subscriptions", "delete");

  const loadData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    const [subscriptionsResult, dashboardResult, optionsResult, settingsResult] = await Promise.allSettled([
      fetchEverySubscription(),
      api.get<unknown>("/subscriptions/dashboard/?days=60"),
      api.get<unknown>("/subscriptions/options/"),
      api.get<unknown>("/subscriptions/settings/"),
    ]);

    const loadedSubscriptions = subscriptionsResult.status === "fulfilled" ? subscriptionsResult.value : [];
    if (subscriptionsResult.status === "rejected") {
      toast.error(errorMessage(subscriptionsResult.reason, "Failed to load subscriptions."));
    }

    const loadedSettings = settingsResult.status === "fulfilled"
      ? normalizeSettings(settingsResult.value.data)
      : null;
    if (settingsResult.status === "rejected") {
      toast.error(errorMessage(
        settingsResult.reason,
        "Alert and budget settings could not be loaded; editing them is disabled.",
      ));
    }
    const fallbackCurrency = loadedSettings?.budget_currency || "USD";
    const loadedDashboard = dashboardResult.status === "fulfilled"
      ? normalizeDashboard(dashboardResult.value.data, loadedSubscriptions, fallbackCurrency)
      : computedDashboard(loadedSubscriptions, fallbackCurrency);

    setSubscriptions(loadedSubscriptions);
    setDashboard(loadedDashboard);
    setSettings(loadedSettings);
    if (optionsResult.status === "fulfilled") {
      setOptions(optionsFromResponse(optionsResult.value.data));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const linkedId = Number(searchParams?.get("subscription"));
    if (!Number.isInteger(linkedId) || linkedId <= 0 || openedDeepLink.current === linkedId) return;
    const linkedSubscription = subscriptions.find((subscription) => subscription.id === linkedId);
    if (!linkedSubscription) return;
    openedDeepLink.current = linkedId;
    // Notification links use /subscriptions?subscription=<id>; send them to the
    // detail page so there is a single place a subscription is viewed.
    router.replace(`/subscriptions/${linkedId}`);
  }, [searchParams, subscriptions, router]);

  const userOptions = useMemo(() => {
    if (!user || users.some((option) => option.id === user.id)) return users;
    return [{ id: user.id, full_name: user.full_name, email: user.email }, ...users];
  }, [user, users]);

  const categories = useMemo(
    () => Array.from(new Set(subscriptions.map((subscription) => subscription.category))).sort(),
    [subscriptions],
  );

  const filteredSubscriptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return subscriptions.filter((subscription) => {
      const matchesSearch = !query || [
        subscription.name,
        subscription.platform,
        subscription.plan_type,
        subscription.purpose,
        subscription.team,
        subscription.department_name,
        subscription.owner_name,
        subscription.admin_name,
      ].some((value) => value.toLowerCase().includes(query));
      const matchesStatus = statusFilter === "ALL" || normalizedStatus(subscription) === statusFilter;
      const matchesCategory = categoryFilter === "ALL" || subscription.category === categoryFilter;
      const matchesBilling = billingFilter === "ALL" || subscription.billing_cycle === billingFilter;
      return matchesSearch && matchesStatus && matchesCategory && matchesBilling;
    });
  }, [billingFilter, categoryFilter, search, statusFilter, subscriptions]);

  const sortedSubscriptions = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const big = dir === 1 ? Infinity : -Infinity; // push "no value" to the end
    return [...filteredSubscriptions].sort((a, b) => {
      switch (sortKey) {
        case "cost":
          return (annualCostOf(a) - annualCostOf(b)) * dir;
        case "renewal": {
          const da = daysUntil(a); const db = daysUntil(b);
          return ((da ?? big) - (db ?? big)) * dir;
        }
        case "status":
          return normalizedStatus(a).localeCompare(normalizedStatus(b)) * dir;
        case "name":
        default:
          return (a.name || "").localeCompare(b.name || "") * dir;
      }
    });
  }, [filteredSubscriptions, sortKey, sortDir]);

  const visibleIds = useMemo(
    () => sortedSubscriptions.map((subscription) => subscription.id),
    [sortedSubscriptions],
  );

  // Selection can span pages and filters, so drop it whenever the visible set
  // changes — acting on rows the user can no longer see would be a surprise.
  useEffect(() => {
    clearSelection();
  }, [billingFilter, categoryFilter, search, statusFilter, clearSelection]);

  const runBulkAction = async (action: string, value?: unknown, confirmText?: string) => {
    if (sel.count === 0) return;
    if (confirmText && !confirm(confirmText)) return;
    setBulkBusy(true);
    try {
      const response = await api.post<Record<string, unknown>>("/subscriptions/bulk_action/", {
        ids: sel.ids,
        action,
        ...(value === undefined ? {} : { value }),
      });
      if (action === "delete") {
        const summary = summarizeBulkDelete(response.data as never);
        if (summary.kind === "success") toast.success(summary.message);
        else toast(summary.message);
        const blocked = (response.data.blocked as Array<{ name?: string; id: number; reason: string }>) || [];
        if (blocked.length) {
          toast(
            blocked.slice(0, 3).map((row) => `${row.name || row.id}: ${row.reason}`).join(" · "),
            { duration: 5000 },
          );
        }
      } else {
        toast.success(`Updated ${response.data.affected} subscription(s).`);
      }
      sel.clear();
      await loadData(true);
    } catch (error) {
      toast.error(errorMessage(error, "Bulk action failed."));
    } finally {
      setBulkBusy(false);
    }
  };

  const categoryChartData = useMemo(() => {
    return dashboard.spend_by_category
      .filter((item) => item.currency === dashboard.currency)
      .sort((left, right) => right.monthly_spend - left.monthly_spend)
      .slice(0, 8)
      .map((item) => ({ name: item.category_label, spend: item.monthly_spend }));
  }, [dashboard]);

  const saveSubscription = async (values: SubscriptionFormValues): Promise<boolean> => {
    try {
      const payload = subscriptionPayload(values);
      if (editing) await api.patch(`/subscriptions/${editing.id}/`, payload);
      else await api.post("/subscriptions/", payload);
      toast.success(editing ? "Subscription updated." : "Subscription added.");
      setEditing(null);
      await loadData(true);
      return true;
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Could not save the subscription."));
      return false;
    }
  };

  /** Re-fetch so the edit form opens with the full record, not just the row. */
  const openRecord = async (subscription: Subscription) => {
    let record = subscription;
    try {
      const response = await api.get<unknown>(`/subscriptions/${subscription.id}/`);
      record = normalizeSubscription(response.data) || subscription;
    } catch {
      /* fall back to the row we already have */
    }
    setEditing(record);
    setDialogOpen(true);
  };

  const deleteSubscription = async (subscription: Subscription) => {
    if (!confirm(`Delete “${subscription.name}”? This cannot be undone.`)) return;
    try {
      await api.delete(`/subscriptions/${subscription.id}/`);
      toast.success("Subscription deleted.");
      await loadData(true);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Could not delete the subscription."));
    }
  };

  const exportReport = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      const response = await api.get<Blob>(`/subscriptions/export/?format=${format}`, { responseType: "blob" });
      const contentDisposition = response.headers["content-disposition"];
      const filenameMatch = typeof contentDisposition === "string"
        ? contentDisposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)
        : null;
      const serverFilename = filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1]) : "";
      const safeFilename = serverFilename.replace(/[^a-zA-Z0-9._-]/g, "_") || `subscription-spend-report.${format}`;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = safeFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`${format === "pdf" ? "PDF" : "Excel"} report exported.`);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Could not export the report."));
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Loading subscriptions…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-1 sm:p-2">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-primary/10 p-2 text-primary"><CreditCard className="h-5 w-5" /></div>
            <h1 className="text-2xl font-bold tracking-tight">Software subscriptions</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Track cloud, AI, SaaS, and every other company service—cost, ownership, purpose, and renewals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void loadData(true)} disabled={refreshing} title="Refresh data">
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <BrowserAlertsButton />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={exporting !== null}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void exportReport("xlsx")}>
                <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" /> Excel spend report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportReport("pdf")}>
                <FileText className="mr-2 h-4 w-4 text-red-600" /> PDF spend report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canAdd && (
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Add subscription
            </Button>
          )}
        </div>
      </div>

      {dashboard.budget && <BudgetProgress budget={dashboard.budget} />}

      {dashboard.category_budgets.length > 0 && <CategoryBudgets rows={dashboard.category_budgets} />}

      {dashboard.converted && dashboard.spend_by_currency.length > 1 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Total across all currencies
              </p>
              <p className="mt-1 text-2xl font-bold">
                {formatMoney(dashboard.converted.yearly_spend, dashboard.converted.currency)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">/ year</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {formatMoney(dashboard.converted.monthly_spend, dashboard.converted.currency)} / month
                {dashboard.converted.rates_as_of
                  ? ` · converted at rates from ${formatDate(dashboard.converted.rates_as_of)}`
                  : " · converted"}
              </p>
            </div>
            {!dashboard.converted.is_complete && (
              <div className="max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-medium">Not included:</span>{" "}
                {dashboard.converted.unconvertible
                  .map((row) => `${row.currency} ${row.amount}`)
                  .join(", ")}
                {" — no exchange rate yet. Add one in Settings → Integrations."}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Monthly spend"
          value={formatMoney(dashboard.monthly_spend, dashboard.currency, true)}
          detail={`Active spend in ${dashboard.currency}`}
          icon={CircleDollarSign}
          tone="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        />
        <StatCard
          title="Yearly spend"
          value={formatMoney(dashboard.yearly_spend, dashboard.currency, true)}
          detail={`Annual equivalent in ${dashboard.currency}`}
          icon={WalletCards}
          tone="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        />
        <StatCard
          title="Active"
          value={String(dashboard.active_count)}
          detail="Currently usable services"
          icon={CheckCircle2}
          tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        />
        <StatCard
          title="Expired"
          value={String(dashboard.expired_count)}
          detail="Needs review or renewal"
          icon={XCircle}
          tone="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        />
        <StatCard
          title="Upcoming"
          value={String(dashboard.upcoming_count)}
          detail="Renewals in the next 60 days"
          icon={CalendarClock}
          tone="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        />
      </div>

      {dashboard.spend_by_currency.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/50 px-4 py-3 text-sm">
          <span className="font-medium">Spend by currency:</span>
          {dashboard.spend_by_currency.map((item) => (
            <Badge key={item.currency} variant="secondary">
              {formatMoney(item.monthly_spend, item.currency)} / month · {item.count} service{item.count === 1 ? "" : "s"}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Card className="hover:-translate-y-0">
          <CardHeader>
            <CardTitle>Spend by category</CardTitle>
            <CardDescription>Monthly equivalent for active subscriptions in {dashboard.currency}</CardDescription>
          </CardHeader>
          <CardContent>
            {categoryChartData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No active spend to chart yet.</div>
            ) : (
              <div className="h-64 w-full" aria-label="Monthly subscription spend by category">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryChartData} margin={{ top: 4, right: 8, left: -12, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <ChartTooltip cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
                    <Bar dataKey="spend" name={`Monthly spend (${dashboard.currency})`} fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="hover:-translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BellRing className="h-4 w-4 text-amber-500" /> Upcoming renewals</CardTitle>
            <CardDescription>The nearest renewal and expiry dates</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.upcoming_renewals.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Nothing renews in the next 60 days.</div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {dashboard.upcoming_renewals.slice(0, 12).map((subscription) => {
                  const urgency = renewalLabel(subscription);
                  return (
                    <button
                      type="button"
                      key={subscription.id}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                      onClick={() => router.push(`/subscriptions/${subscription.id}`)}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{subscription.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{subscription.platform} · {formatDate(subscription.expiry_date)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-xs font-medium ${urgency.className}`}>{urgency.text}</p>
                        {subscription.auto_renew && <p className="mt-1 text-[10px] text-muted-foreground">Auto-renew</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="hover:-translate-y-0">
        <CardHeader className="gap-4">
          <div>
            <CardTitle>All subscriptions</CardTitle>
            <CardDescription>{filteredSubscriptions.length} of {subscriptions.length} subscriptions shown</CardDescription>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_180px_190px_160px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, platform, purpose, owner…"
                className="pl-9"
                aria-label="Search subscriptions"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                <SelectItem value="PAUSED">Paused</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger aria-label="Filter by category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>{CATEGORY_LABELS[category] || category}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={billingFilter} onValueChange={setBillingFilter}>
              <SelectTrigger aria-label="Filter by billing cycle"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All billing</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="YEARLY">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        {canEdit && sel.count > 0 && (
          <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
            <div className="text-sm">
              <span className="font-medium">{sel.count}</span> selected
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value=""
                onValueChange={(value) => {
                  if (value.startsWith("category:")) {
                    void runBulkAction("set_category", value.slice("category:".length));
                  } else {
                    void runBulkAction(value);
                  }
                }}
              >
                <SelectTrigger className="h-8 w-[180px]" disabled={bulkBusy}>
                  <SelectValue placeholder="Change…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pause">Pause</SelectItem>
                  <SelectItem value="resume">Resume</SelectItem>
                  <SelectItem value="cancel">Cancel</SelectItem>
                  <SelectItem value="auto_renew_on">Auto-renew on</SelectItem>
                  <SelectItem value="auto_renew_off">Auto-renew off</SelectItem>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={`category:${value}`}>
                      Category → {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={sel.clear} disabled={bulkBusy}>
                Clear
              </Button>
              {canDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() =>
                    void runBulkAction(
                      "delete",
                      undefined,
                      `Delete ${sel.count} subscription(s)? Any with active seats will be skipped.`,
                    )
                  }
                >
                  {bulkBusy ? "Working…" : `Delete ${sel.count}`}
                </Button>
              )}
            </div>
          </div>
        )}
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        checked={sel.allSelected(visibleIds) || (sel.someSelected(visibleIds) ? "indeterminate" : false)}
                        onCheckedChange={() => sel.toggleAll(visibleIds)}
                        aria-label="Select all subscriptions"
                      />
                    </TableHead>
                  )}
                  <TableHead className="pl-4"><SortHeader label="Service" col="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead>Owner / admin</TableHead>
                  <TableHead><SortHeader label="Cost" col="cost" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></TableHead>
                  <TableHead><SortHeader label="Renewal" col="renewal" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></TableHead>
                  <TableHead><SortHeader label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></TableHead>
                  <TableHead className="w-12 pr-4 text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSubscriptions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 9 : 8} className="h-40 text-center">
                      <CreditCard className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
                      <p className="font-medium">No subscriptions found</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {subscriptions.length ? "Try changing the search or filters." : "Add your first service to start tracking spend and renewals."}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : sortedSubscriptions.map((subscription) => {
                  const status = normalizedStatus(subscription);
                  const urgency = renewalLabel(subscription);
                  return (
                    <TableRow
                      key={subscription.id}
                      className="cursor-pointer"
                      data-state={sel.isSelected(subscription.id) ? "selected" : undefined}
                      onClick={() => router.push(`/subscriptions/${subscription.id}`)}
                    >
                      {canEdit && (
                        <TableCell className="w-10 pl-4" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={sel.isSelected(subscription.id)}
                            onCheckedChange={() => sel.toggle(subscription.id)}
                            aria-label={`Select ${subscription.name}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="pl-4">
                        <div className="flex min-w-[180px] items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary">
                            {(subscription.platform || subscription.name).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="max-w-[220px] truncate font-medium">{subscription.name}</p>
                            <p className="max-w-[220px] truncate text-xs text-muted-foreground">{subscription.platform || "Platform not set"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[150px] truncate text-sm">{subscription.plan_type || "—"}</p>
                        <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[subscription.category] || subscription.category}</p>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[150px] truncate text-sm">{subscription.team || subscription.department_name || "Company-wide"}</p>
                        {subscription.team && subscription.department_name && (
                          <p className="max-w-[150px] truncate text-xs text-muted-foreground">{subscription.department_name}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[160px] truncate text-sm">{subscription.owner_name || "No owner"}</p>
                        <p className="max-w-[160px] truncate text-xs text-muted-foreground">
                          {subscription.admin_name ? `Admin: ${subscription.admin_name}` : "No platform admin"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="whitespace-nowrap font-medium tabular-nums">{formatMoney(subscription.cost, subscription.currency)}</p>
                        <p className="text-xs text-muted-foreground">{subscription.billing_cycle === "YEARLY" ? "per year" : "per month"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="whitespace-nowrap text-sm">{formatDate(subscription.expiry_date)}</p>
                        <p className={`whitespace-nowrap text-xs ${urgency.className}`}>{urgency.text}</p>
                        {subscription.cancellation_reminder_enabled && subscription.cancellation_deadline && (
                          <p className="mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground">
                            Cancel by {formatDate(subscription.cancellation_deadline)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={status} /></TableCell>
                      <TableCell className="pr-4 text-right" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${subscription.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/subscriptions/${subscription.id}`)}>
                              <Eye className="mr-2 h-4 w-4" /> Open
                            </DropdownMenuItem>
                            {canEdit && (
                              <DropdownMenuItem onClick={() => void openRecord(subscription)}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void deleteSubscription(subscription)}>
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <SubscriptionDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null); }}
        subscription={editing}
        users={userOptions}
        departments={departments}
        vendors={options.vendors}
        contracts={options.contracts}
        budgetCategories={options.budgetCategories}
        vaultCredentials={options.vaultCredentials}
        licenses={options.licenses}
        currencies={options.currencies}
        defaultReminderDays={settings?.default_renewal_reminder_days}
        defaultCancellationReminderDays={settings?.default_cancellation_reminder_days}
        defaultCurrency={settings?.budget_currency}
        onSubmit={saveSubscription}
      />

    </div>
  );
}
