/**
 * Types and response normalisers for the Digital Estate.
 *
 * Every field is coerced, so a missing or renamed key degrades to a sensible
 * default instead of rendering `undefined` or throwing inside a map callback.
 *
 * Three things are deliberately *not* defined here, because the API serves them:
 * the stack order, the severity thresholds, and provider brand colours.
 * Hardcoding any of them would let the frontend and the backend disagree about
 * what "at risk" means or what colour Cloudflare is.
 */

// ─────────────────────────────── coercion ───────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const nullableStr = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nullableNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const bool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const arrayOf = <T,>(value: unknown, map: (row: Record<string, unknown>) => T): T[] =>
  Array.isArray(value) ? value.filter(isRecord).map(map) : [];

/**
 * Money arrives as a fixed-2dp *string* from the API, never a JSON float.
 * Parsed once here for arithmetic and comparison; formatting always goes
 * through `lib/currency.ts`.
 */
const money = (value: unknown): number => num(value, 0);

/** DRF pages results; a bare array is accepted too so pagination can change. */
export function resultsOf<T>(
  payload: unknown,
  map: (row: Record<string, unknown>) => T,
): T[] {
  if (Array.isArray(payload)) return arrayOf(payload, map);
  if (isRecord(payload) && Array.isArray(payload.results)) {
    return arrayOf(payload.results, map);
  }
  return [];
}

// ─────────────────────────────── severity ───────────────────────────────

/** The tones the API returns. Mapped to classes, never re-derived from data. */
export type Severity = "critical" | "warning" | "ok" | "muted";

const SEVERITIES: Severity[] = ["critical", "warning", "ok", "muted"];

const severityValue = (value: unknown): Severity =>
  SEVERITIES.includes(value as Severity) ? (value as Severity) : "muted";

export const SEVERITY_BADGE: Record<Severity, string> = {
  critical:
    "border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  warning:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  ok: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  muted:
    "border-transparent bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export const SEVERITY_TONE: Record<Severity, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  muted: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

/**
 * Severity for a count, where zero is always good news.
 *
 * "Never a red zero": nought orphans is the target state, and colouring it like
 * a problem teaches people that red means nothing.
 */
export function countSeverity(count: number, whenNonZero: Severity): Severity {
  return count > 0 ? whenNonZero : "muted";
}

// ─────────────────────────────── money block ────────────────────────────

/**
 * A converted money figure *and* what it left out.
 *
 * There is no bare `total` field on purpose. `is_complete` and `unconvertible`
 * sit alongside the number so a caller cannot render an authoritative-looking
 * total that silently omits a currency — the bug this feature exists to stop.
 */
export interface MoneyBlock {
  currency: string;
  monthly: number;
  yearly: number;
  unconvertible: { currency: string; amount: number; yearly_amount: number }[];
  is_complete: boolean;
  coverage: {
    converted_currencies: number;
    total_currencies: number;
    excluded_currencies: string[];
  };
  rates_as_of: string | null;
}

export const EMPTY_MONEY: MoneyBlock = {
  currency: "PKR",
  monthly: 0,
  yearly: 0,
  unconvertible: [],
  is_complete: true,
  coverage: { converted_currencies: 0, total_currencies: 0, excluded_currencies: [] },
  rates_as_of: null,
};

export function normalizeMoney(value: unknown): MoneyBlock {
  if (!isRecord(value)) return EMPTY_MONEY;
  const coverage = isRecord(value.coverage) ? value.coverage : {};
  const unconvertible = arrayOf(value.unconvertible, (row) => ({
    currency: str(row.currency, "?"),
    amount: money(row.amount),
    yearly_amount: money(row.yearly_amount),
  }));
  return {
    currency: str(value.currency, "PKR").toUpperCase(),
    monthly: money(value.monthly),
    yearly: money(value.yearly),
    unconvertible,
    is_complete: bool(value.is_complete, unconvertible.length === 0),
    coverage: {
      converted_currencies: num(coverage.converted_currencies),
      total_currencies: num(coverage.total_currencies),
      excluded_currencies: Array.isArray(coverage.excluded_currencies)
        ? coverage.excluded_currencies.filter((c): c is string => typeof c === "string")
        : [],
    },
    rates_as_of: nullableStr(value.rates_as_of),
  };
}

/**
 * The honest label for a converted figure.
 *
 * A partial total must never be captioned "total across all currencies" — that
 * exact wording, over a number that excluded the larger of two currencies, is
 * the defect this module was scoped to fix.
 */
export function moneyLabel(block: MoneyBlock, subject = "spend"): string {
  if (block.is_complete) {
    return block.coverage.total_currencies > 1
      ? `Total ${subject}, all currencies converted`
      : `Total ${subject}`;
  }
  const { converted_currencies: converted, total_currencies: total } = block.coverage;
  return `Partial ${subject} — ${converted} of ${total} currencies converted`;
}

/** "USD 500.00 not included" — the sentence next to a partial total. */
export function unconvertedSummary(
  rows: { currency: string; amount: number }[],
): string | null {
  if (rows.length === 0) return null;
  const parts = rows.map((row) => `${row.currency} ${row.amount.toFixed(2)}`);
  return `${parts.join(" + ")} not included — no exchange rate yet.`;
}

// ─────────────────────────────── catalog ────────────────────────────────

export interface ServiceTypeDef {
  layer: string;
  layer_label: string;
  is_required: boolean;
  is_tracked: boolean;
}

export function normalizeServiceType(value: Record<string, unknown>): ServiceTypeDef {
  return {
    layer: str(value.layer),
    layer_label: str(value.layer_label, str(value.layer)),
    is_required: bool(value.is_required),
    is_tracked: bool(value.is_tracked, bool(value.is_required)),
  };
}

// ─────────────────────────────── providers ──────────────────────────────

export interface Provider {
  id: number;
  name: string;
  slug: string;
  brand_color: string;
  console_url: string;
  logo_initial: string;
  is_active: boolean;
  account_count: number;
}

export function normalizeProvider(value: Record<string, unknown>): Provider {
  const name = str(value.name);
  return {
    id: num(value.id),
    name,
    slug: str(value.slug),
    brand_color: str(value.brand_color),
    console_url: str(value.console_url),
    logo_initial: str(value.logo_initial, name.slice(0, 1).toUpperCase()),
    is_active: bool(value.is_active, true),
    account_count: num(value.account_count),
  };
}

// ─────────────────────────────── accounts ───────────────────────────────

/**
 * The API still emits `login_email` / `auth_method` / `mfa_method`; the columns
 * behind them were renamed in Phase 1. This is the one place that knows, so the
 * rest of the UI reads the model's vocabulary.
 */
export interface ProviderAccount {
  id: number;
  provider: number | null;
  provider_name: string;
  provider_slug: string;
  brand_color: string;
  account_email: string;
  auth_type: string;
  auth_type_label: string;
  mfa_type: string;
  mfa_type_label: string;
  mfa_severity: Severity;
  has_mfa: boolean;
  owner: number | null;
  owner_name: string;
  vault_credential: number | null;
  vault_credential_title: string | null;
  console_url: string;
  effective_console_url: string;
  notes: string;
  is_active: boolean;
  service_count: number;
  /** What the login string actually is — plenty of providers issue usernames. */
  login_kind: string;
  login_kind_label: string;
  /** Active logins on this account. `AccountLogin` below is the list itself. */
  people_count: number;
  people_without_mfa: number;
  privileged_count: number;
}

export function normalizeAccount(value: Record<string, unknown>): ProviderAccount {
  return {
    id: num(value.id),
    provider: nullableNum(value.provider),
    provider_name: str(value.provider_name),
    provider_slug: str(value.provider_slug),
    brand_color: str(value.brand_color),
    account_email: str(value.login_email, str(value.account_email)),
    auth_type: str(value.auth_method, str(value.auth_type)),
    auth_type_label: str(value.auth_method_label, str(value.auth_method)),
    mfa_type: str(value.mfa_method, str(value.mfa_type, "UNKNOWN")),
    mfa_type_label: str(value.mfa_method_label, "Not recorded"),
    mfa_severity: severityValue(value.mfa_severity),
    has_mfa: bool(value.has_mfa),
    owner: nullableNum(value.owner),
    owner_name: str(value.owner_name),
    vault_credential: nullableNum(value.vault_credential),
    vault_credential_title: nullableStr(value.vault_credential_title),
    console_url: str(value.console_url),
    effective_console_url: str(value.effective_console_url),
    notes: str(value.notes),
    is_active: bool(value.is_active, true),
    service_count: num(value.service_count),
    login_kind: str(value.login_kind, "EMAIL"),
    login_kind_label: str(value.login_kind_label, "Email address"),
    people_count: num(value.people_count),
    people_without_mfa: num(value.people_without_mfa),
    privileged_count: num(value.privileged_count),
  };
}

// ─────────────────────────────── properties ─────────────────────────────

export interface EstateProperty {
  id: number;
  name: string;
  kind: string;
  kind_label: string;
  owner: number | null;
  owner_name: string;
  department: number | null;
  department_name: string;
  notes: string;
  is_active: boolean;
  service_count: number;
}

export function normalizeProperty(value: Record<string, unknown>): EstateProperty {
  return {
    id: num(value.id),
    name: str(value.name),
    kind: str(value.kind, "OTHER"),
    kind_label: str(value.kind_label, "Other"),
    owner: nullableNum(value.owner),
    owner_name: str(value.owner_name),
    department: nullableNum(value.department),
    department_name: str(value.department_name),
    notes: str(value.notes),
    is_active: bool(value.is_active, true),
    service_count: num(value.service_count),
  };
}

// ─────────────────────────────── services ───────────────────────────────

export interface Service {
  id: number;
  service_type: string;
  service_type_label: string;
  identifier: string;
  provider: number | null;
  provider_name: string;
  provider_slug: string;
  brand_color: string;
  provider_account: number | null;
  account_email: string;
  property: number | null;
  property_name: string | null;
  status: string;
  status_label: string;
  renewal_date: string | null;
  days_until_renewal: number | null;
  auto_renew: boolean;
  cost: number;
  currency: string;
  billing_cycle: string;
  billing_cycle_label: string;
  monthly_equivalent: number;
  yearly_equivalent: number;
  console_url: string;
  vault_credential: number | null;
  vault_credential_title: string | null;
  notes: string;
  is_orphan: boolean;
  is_at_risk: boolean;
  occupies_stack_slot: boolean;
}

export function normalizeService(value: Record<string, unknown>): Service {
  const identifier = str(value.identifier, str(value.name));
  return {
    id: num(value.id),
    service_type: str(value.service_type),
    service_type_label: str(value.service_type_label, str(value.service_type)),
    identifier,
    provider: nullableNum(value.provider),
    provider_name: str(value.provider_name),
    provider_slug: str(value.provider_slug),
    brand_color: str(value.brand_color),
    provider_account: nullableNum(value.provider_account),
    account_email: str(value.account_email, str(value.account_login)),
    property: nullableNum(value.property),
    property_name: nullableStr(value.property_name),
    status: str(value.status, "ACTIVE"),
    status_label: str(value.status_label, str(value.status, "Active")),
    renewal_date: nullableStr(value.renewal_date),
    days_until_renewal: nullableNum(
      value.days_until_renewal ?? value.days_until_expiry ?? value.days_until,
    ),
    auto_renew: bool(value.auto_renew, true),
    cost: money(value.cost),
    currency: str(value.currency, "PKR").toUpperCase(),
    billing_cycle: str(value.billing_cycle, "MONTHLY"),
    billing_cycle_label: str(value.billing_cycle_label, str(value.billing_cycle)),
    monthly_equivalent: money(value.monthly_equivalent ?? value.monthly_cost),
    yearly_equivalent: money(value.yearly_equivalent),
    console_url: str(value.console_url),
    vault_credential: nullableNum(value.vault_credential ?? value.vault_credential_id),
    vault_credential_title: nullableStr(value.vault_credential_title),
    notes: str(value.notes),
    is_orphan: bool(value.is_orphan, nullableNum(value.property) === null),
    is_at_risk: bool(value.is_at_risk),
    occupies_stack_slot: bool(value.occupies_stack_slot),
  };
}

// ─────────────────────────────── timeline ───────────────────────────────

export interface TimelineEntry {
  id: number;
  name: string;
  identifier: string;
  service_type: string;
  service_type_label: string;
  provider_slug: string;
  provider_name: string;
  brand_color: string;
  renewal_date: string | null;
  days_until: number;
  urgency: Severity;
  auto_renew: boolean;
  is_at_risk: boolean;
  cost: number;
  currency: string;
  property: string | null;
  property_id: number | null;
  window_days: number;
}

export function normalizeTimelineEntry(value: Record<string, unknown>): TimelineEntry {
  const identifier = str(value.identifier, str(value.name));
  return {
    id: num(value.id),
    name: str(value.name, identifier),
    identifier,
    service_type: str(value.service_type),
    service_type_label: str(value.service_type_label, str(value.service_type)),
    provider_slug: str(value.provider_slug),
    provider_name: str(value.provider_name),
    brand_color: str(value.brand_color),
    renewal_date: nullableStr(value.renewal_date),
    days_until: num(value.days_until),
    urgency: severityValue(value.urgency),
    auto_renew: bool(value.auto_renew, true),
    is_at_risk: bool(value.is_at_risk),
    cost: money(value.cost),
    currency: str(value.currency, "PKR").toUpperCase(),
    property: nullableStr(value.property ?? value.property_name),
    property_id: nullableNum(value.property_id),
    window_days: num(value.window_days, 90),
  };
}

// ─────────────────────────────── dashboard ──────────────────────────────

export interface EstateKpis {
  monthly_spend: number;
  yearly_spend: number;
  currency: string;
  active_services: number;
  renewals_30d: number;
  accounts_missing_mfa: number;
  accounts_without_mfa: number;
  orphan_services: number;
  properties: number;
  unconverted: { currency: string; monthly: number }[];
  is_complete: boolean;
}

export interface ProviderSpend {
  slug: string;
  name: string;
  brand_color: string;
  monthly: number;
  pct: number;
  count: number;
  spend: MoneyBlock;
}

export interface CategorySpend {
  service_type: string;
  label: string;
  monthly: number;
  count: number;
  spend: MoneyBlock;
}

export interface EstateDashboard {
  as_of: string | null;
  currency: string;
  kpis: EstateKpis;
  total_spend: MoneyBlock;
  timeline: TimelineEntry[];
  by_provider: ProviderSpend[];
  by_category: CategorySpend[];
  thresholds: {
    at_risk_window_days: number;
    urgent_window_days: number;
    timeline_window_days: number;
  };
  service_types: ServiceTypeDef[];
}

const EMPTY_KPIS: EstateKpis = {
  monthly_spend: 0,
  yearly_spend: 0,
  currency: "PKR",
  active_services: 0,
  renewals_30d: 0,
  accounts_missing_mfa: 0,
  accounts_without_mfa: 0,
  orphan_services: 0,
  properties: 0,
  unconverted: [],
  is_complete: true,
};

export const EMPTY_DASHBOARD: EstateDashboard = {
  as_of: null,
  currency: "PKR",
  kpis: EMPTY_KPIS,
  total_spend: EMPTY_MONEY,
  timeline: [],
  by_provider: [],
  by_category: [],
  thresholds: {
    at_risk_window_days: 30,
    urgent_window_days: 7,
    timeline_window_days: 90,
  },
  service_types: [],
};

export function normalizeDashboard(value: unknown): EstateDashboard {
  if (!isRecord(value)) return EMPTY_DASHBOARD;
  const kpis = isRecord(value.kpis) ? value.kpis : {};
  const thresholds = isRecord(value.thresholds) ? value.thresholds : {};

  return {
    as_of: nullableStr(value.as_of),
    currency: str(value.currency, "PKR").toUpperCase(),
    kpis: {
      monthly_spend: money(kpis.monthly_spend),
      yearly_spend: money(kpis.yearly_spend),
      currency: str(kpis.currency, "PKR").toUpperCase(),
      active_services: num(kpis.active_services),
      renewals_30d: num(kpis.renewals_30d),
      accounts_missing_mfa: num(kpis.accounts_missing_mfa),
      accounts_without_mfa: num(kpis.accounts_without_mfa),
      orphan_services: num(kpis.orphan_services),
      properties: num(kpis.properties),
      unconverted: arrayOf(kpis.unconverted, (row) => ({
        currency: str(row.currency, "?").toUpperCase(),
        monthly: money(row.monthly),
      })),
      is_complete: bool(kpis.is_complete, true),
    },
    total_spend: normalizeMoney(value.total_spend),
    timeline: arrayOf(value.timeline, normalizeTimelineEntry),
    by_provider: arrayOf(value.by_provider, (row) => ({
      slug: str(row.slug, str(row.provider_slug)),
      name: str(row.name, str(row.provider_name, "Unassigned")),
      brand_color: str(row.brand_color),
      monthly: money(row.monthly),
      pct: money(row.pct),
      count: num(row.count),
      spend: normalizeMoney(row.spend),
    })),
    by_category: arrayOf(value.by_category, (row) => ({
      service_type: str(row.service_type, "OTHER"),
      label: str(row.label, str(row.service_type)),
      monthly: money(row.monthly),
      count: num(row.count),
      spend: normalizeMoney(row.spend),
    })),
    thresholds: {
      at_risk_window_days: num(thresholds.at_risk_window_days, 30),
      urgent_window_days: num(thresholds.urgent_window_days, 7),
      timeline_window_days: num(thresholds.timeline_window_days, 90),
    },
    service_types: arrayOf(value.service_types, normalizeServiceType),
  };
}

// ─────────────────────────────── stack ──────────────────────────────────

export interface StackLayer extends ServiceTypeDef {
  configured: boolean;
  is_gap: boolean;
  service_count: number;
  services: Service[];
}

export interface PropertyStack {
  property: EstateProperty | null;
  layers: StackLayer[];
  gap_count: number;
  missing_layers: string[];
  off_stack_services: Service[];
}

export function normalizeStack(value: unknown): PropertyStack {
  if (!isRecord(value)) {
    return {
      property: null,
      layers: [],
      gap_count: 0,
      missing_layers: [],
      off_stack_services: [],
    };
  }
  return {
    property: isRecord(value.property) ? normalizeProperty(value.property) : null,
    layers: arrayOf(value.layers, (row) => ({
      ...normalizeServiceType(row),
      configured: bool(row.configured),
      is_gap: bool(row.is_gap),
      service_count: num(row.service_count),
      services: arrayOf(row.services, normalizeService),
    })),
    gap_count: num(value.gap_count),
    missing_layers: Array.isArray(value.missing_layers)
      ? value.missing_layers.filter((l): l is string => typeof l === "string")
      : [],
    off_stack_services: arrayOf(
      value.off_stack_services ?? value.unassigned_services,
      normalizeService,
    ),
  };
}

// ─────────────────────────── timeline lane packing ──────────────────────

export interface PackedTimelineEntry extends TimelineEntry {
  /** Horizontal offset as a percentage of the window. */
  leftPct: number;
  /** Which row this label sits on, to stop overlapping labels. */
  lane: number;
}

/**
 * Greedy first-fit lane packing.
 *
 * Entries arrive in date order. Each is placed at `days / window` across the
 * track; its label needs an estimated slice of width, so it drops into the
 * first lane whose previous label has already ended (plus a small gutter).
 * Because the input is sorted ascending, a lane's occupied extent only ever
 * moves right, which is why overwriting `laneEnds[lane]` is safe rather than
 * taking a max.
 *
 * The label-width estimate is in percent of track width, so it depends on the
 * container. Pass the measured width for a denser, more accurate pack.
 */
export function packTimeline(
  rows: TimelineEntry[],
  options: { windowDays?: number; trackWidth?: number; maxLeftPct?: number } = {},
): { entries: PackedTimelineEntry[]; laneCount: number } {
  const { windowDays = 90, trackWidth = 900, maxLeftPct = 88 } = options;
  const laneEnds: number[] = [];
  const GUTTER_PCT = 1.5;
  const LABEL_CHAR_PX = 6.8;
  const LABEL_CHROME_PX = 76;

  const entries = rows.map((row) => {
    const ratio = windowDays > 0 ? row.days_until / windowDays : 0;
    const leftPct = Math.max(0, Math.min(maxLeftPct, ratio * 100));
    const estimatedPct =
      ((row.identifier.length * LABEL_CHAR_PX + LABEL_CHROME_PX) / trackWidth) * 100;

    let lane = 0;
    while (laneEnds[lane] !== undefined && leftPct < laneEnds[lane] + GUTTER_PCT) {
      lane += 1;
    }
    laneEnds[lane] = leftPct + estimatedPct;

    return { ...row, leftPct, lane };
  });

  return { entries, laneCount: Math.max(1, laneEnds.length) };
}

// ─────────────────────────────── filters ────────────────────────────────

export interface ServiceFilters {
  type: string;
  provider: string;
  property: string;
  expiringSoon: boolean;
  autoRenewOff: boolean;
  orphansOnly: boolean;
  search: string;
}

export const EMPTY_SERVICE_FILTERS: ServiceFilters = {
  type: "all",
  provider: "all",
  property: "all",
  expiringSoon: false,
  autoRenewOff: false,
  orphansOnly: false,
  search: "",
};

export function activeFilterCount(filters: ServiceFilters): number {
  let count = 0;
  if (filters.type !== "all") count += 1;
  if (filters.provider !== "all") count += 1;
  if (filters.property !== "all") count += 1;
  if (filters.expiringSoon) count += 1;
  if (filters.autoRenewOff) count += 1;
  if (filters.orphansOnly) count += 1;
  return count;
}

/** Filters as API query params, so the server does the work, not the client. */
export function filtersToParams(filters: ServiceFilters): Record<string, string> {
  const params: Record<string, string> = { page_size: "200" };
  if (filters.type !== "all") params.service_type = filters.type;
  if (filters.provider !== "all") params.provider = filters.provider;
  if (filters.property !== "all") params.property = filters.property;
  if (filters.expiringSoon) params.expiring_soon = "true";
  if (filters.autoRenewOff) params.auto_renew = "false";
  if (filters.orphansOnly) params.orphans = "true";
  if (filters.search.trim()) params.search = filters.search.trim();
  return params;
}

// ─────────────────────────────── errors ─────────────────────────────────

/** Pull a usable message out of a DRF error body. */
export function errorMessage(reason: unknown, fallback: string): string {
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

// ───────────────────────── logins on an account ─────────────────────────
//
// One provider account is one bill and one console; the people who can sign
// in to it are these. Kept separate because they do not share a second
// factor — an account could otherwise read "has MFA" while somebody on it
// has none, which is exactly the case worth surfacing.

export interface AccountLogin {
  id: number;
  provider_account: number;
  account_login: string;
  provider: number | null;
  provider_name: string;
  brand_color: string;
  login: string;
  login_kind: string;
  login_kind_label: string;
  user: number | null;
  user_name: string | null;
  user_email: string | null;
  display_name: string;
  /** Who this is: the linked person, else the typed name, else the login. */
  name: string;
  role: string;
  role_label: string;
  mfa_type: string;
  mfa_label: string;
  mfa_severity: Severity;
  is_privileged: boolean;
  last_reviewed: string | null;
  notes: string;
  is_active: boolean;
}

export function normalizeAccountLogin(value: Record<string, unknown>): AccountLogin {
  return {
    id: num(value.id),
    provider_account: num(value.provider_account),
    account_login: str(value.account_login),
    provider: nullableNum(value.provider),
    provider_name: str(value.provider_name),
    brand_color: str(value.brand_color),
    login: str(value.login),
    login_kind: str(value.login_kind, "EMAIL"),
    login_kind_label: str(value.login_kind_label),
    user: nullableNum(value.user),
    user_name: nullableStr(value.user_name),
    user_email: nullableStr(value.user_email),
    display_name: str(value.display_name),
    name: str(value.name, str(value.login)),
    role: str(value.role, "MEMBER"),
    role_label: str(value.role_label, "Member"),
    mfa_type: str(value.mfa_type, "UNKNOWN"),
    mfa_label: str(value.mfa_label, "Not recorded"),
    mfa_severity: severityValue(value.mfa_severity),
    is_privileged: bool(value.is_privileged),
    last_reviewed: nullableStr(value.last_reviewed),
    notes: str(value.notes),
    is_active: bool(value.is_active, true),
  };
}

// ──────────────────────────────── servers ────────────────────────────────

export interface EstateServer {
  id: number;
  provider_account: number;
  provider_account_login: string;
  provider: number | null;
  provider_name: string;
  brand_color: string;
  service: number | null;
  service_identifier: string | null;
  property: number | null;
  property_name: string | null;
  name: string;
  server_role: string;
  role_label: string;
  environment: string;
  environment_label: string;
  status: string;
  status_label: string;
  is_live: boolean;
  public_ip: string | null;
  private_ip: string | null;
  hostname: string;
  region: string;
  size: string;
  operating_system: string;
  provisioned_on: string | null;
  expires_on: string | null;
  owner: number | null;
  owner_name: string | null;
  console_url: string;
  effective_console_url: string;
  notes: string;
}

export function normalizeServer(value: Record<string, unknown>): EstateServer {
  return {
    id: num(value.id),
    provider_account: num(value.provider_account),
    provider_account_login: str(value.provider_account_login),
    provider: nullableNum(value.provider),
    provider_name: str(value.provider_name),
    brand_color: str(value.brand_color),
    service: nullableNum(value.service),
    service_identifier: nullableStr(value.service_identifier),
    property: nullableNum(value.property),
    property_name: nullableStr(value.property_name),
    name: str(value.name),
    server_role: str(value.server_role, "OTHER"),
    role_label: str(value.role_label, "Other"),
    environment: str(value.environment, "PRODUCTION"),
    environment_label: str(value.environment_label, "Production"),
    status: str(value.status, "RUNNING"),
    status_label: str(value.status_label, "Running"),
    is_live: bool(value.is_live),
    public_ip: nullableStr(value.public_ip),
    private_ip: nullableStr(value.private_ip),
    hostname: str(value.hostname),
    region: str(value.region),
    size: str(value.size),
    operating_system: str(value.operating_system),
    provisioned_on: nullableStr(value.provisioned_on),
    expires_on: nullableStr(value.expires_on),
    owner: nullableNum(value.owner),
    owner_name: nullableStr(value.owner_name),
    console_url: str(value.console_url),
    effective_console_url: str(value.effective_console_url),
    notes: str(value.notes),
  };
}

/** Choice lists mirroring core/estate.py. Row labels still come from the API. */
export const ACCOUNT_ROLE_CHOICES = [
  { value: "OWNER", label: "Owner / root" },
  { value: "ADMIN", label: "Administrator" },
  { value: "BILLING", label: "Billing only" },
  { value: "MEMBER", label: "Member" },
  { value: "READONLY", label: "Read only" },
];

export const LOGIN_KIND_CHOICES = [
  { value: "EMAIL", label: "Email address" },
  { value: "USERNAME", label: "Username" },
  { value: "ACCOUNT_ID", label: "Account ID / number" },
  { value: "PHONE", label: "Phone number" },
];

export const MFA_TYPE_CHOICES = [
  { value: "SECURITY_KEY", label: "Security key" },
  { value: "APP", label: "Authenticator app" },
  { value: "SMS", label: "SMS" },
  { value: "NONE", label: "None" },
  { value: "UNKNOWN", label: "Not recorded" },
];

export const SERVER_ROLE_CHOICES = [
  { value: "WEB", label: "Web server" },
  { value: "APP", label: "Application server" },
  { value: "DATABASE", label: "Database" },
  { value: "CACHE", label: "Cache" },
  { value: "WORKER", label: "Worker / queue" },
  { value: "BUILD", label: "Build / CI" },
  { value: "STORAGE", label: "Storage" },
  { value: "VPN", label: "VPN / gateway" },
  { value: "GAME", label: "Game server" },
  { value: "OTHER", label: "Other" },
];

export const SERVER_ENVIRONMENT_CHOICES = [
  { value: "PRODUCTION", label: "Production" },
  { value: "STAGING", label: "Staging" },
  { value: "DEVELOPMENT", label: "Development" },
  { value: "TEST", label: "Test" },
  { value: "DR", label: "Disaster recovery" },
];

export const SERVER_STATUS_CHOICES = [
  { value: "RUNNING", label: "Running" },
  { value: "STOPPED", label: "Stopped" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "DECOMMISSIONED", label: "Decommissioned" },
];
