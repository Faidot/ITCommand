/**
 * Types and response normalisers for the Digital Estate.
 *
 * Same approach as `subscription-types.ts`: every field is coerced, so a missing
 * or renamed key degrades to a sensible default instead of rendering
 * `undefined` or throwing inside a map callback.
 *
 * Two things are deliberately *not* defined here, because the API serves them:
 * the service-layer order and the severity thresholds. Hardcoding either would
 * mean the backend and the UI could disagree about what "at risk" means.
 */

// ─────────────────────────────── coercion ───────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringValue = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const boolValue = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const arrayOf = <T,>(value: unknown, map: (row: Record<string, unknown>) => T): T[] =>
  Array.isArray(value) ? value.filter(isRecord).map(map) : [];

/**
 * Money arrives as a fixed-2dp *string* from the API, never a JSON float.
 * Parsed once here for arithmetic and comparison; formatting always goes
 * through `lib/currency.ts`.
 */
const money = (value: unknown): number => numberValue(value, 0);

// ─────────────────────────────── severity ───────────────────────────────

/** The tones the API returns. Mapped to classes, never re-derived from data. */
export type Severity = "critical" | "warning" | "ok" | "muted";

const SEVERITIES: Severity[] = ["critical", "warning", "ok", "muted"];

const severityValue = (value: unknown): Severity =>
  SEVERITIES.includes(value as Severity) ? (value as Severity) : "muted";

/** Badge classes per severity. One map, so red always means the same thing. */
export const SEVERITY_BADGE: Record<Severity, string> = {
  critical:
    "border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  warning:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  ok: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  muted:
    "border-transparent bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

/** Icon-tile classes for the KPI row, matching the existing StatCard `tone`. */
export const SEVERITY_TONE: Record<Severity, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  muted:
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

/**
 * Severity for a count, where zero is always good news.
 *
 * "Do not render a red zero": nought orphans is the target state, and colouring
 * it like a problem teaches people that red means nothing.
 */
export function countSeverity(count: number, whenNonZero: Severity): Severity {
  return count > 0 ? whenNonZero : "muted";
}

// ─────────────────────────────── money block ────────────────────────────

/**
 * A converted money figure *and* what it left out.
 *
 * There is no `total` field on purpose. `is_complete` and `unconvertible` sit
 * alongside the number so a caller cannot render an authoritative-looking total
 * that silently omits a currency — the bug this feature exists to stop.
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
  currency: "USD",
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
    currency: stringValue(row.currency, "?"),
    amount: money(row.amount),
    yearly_amount: money(row.yearly_amount),
  }));
  return {
    currency: stringValue(value.currency, "USD").toUpperCase(),
    monthly: money(value.monthly),
    yearly: money(value.yearly),
    unconvertible,
    is_complete: boolValue(value.is_complete, unconvertible.length === 0),
    coverage: {
      converted_currencies: numberValue(coverage.converted_currencies),
      total_currencies: numberValue(coverage.total_currencies),
      excluded_currencies: Array.isArray(coverage.excluded_currencies)
        ? coverage.excluded_currencies.filter((c): c is string => typeof c === "string")
        : [],
    },
    rates_as_of: nullableString(value.rates_as_of),
  };
}

/**
 * The honest label for a converted figure.
 *
 * A partial total must never be captioned "total across all currencies" — that
 * exact wording, over a number that excluded the larger of two currencies, is
 * the defect this feature was scoped to fix.
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

/** "USD 500.00 has no exchange rate yet" — the sentence next to a partial total. */
export function unconvertedSummary(block: MoneyBlock): string | null {
  if (block.is_complete || block.unconvertible.length === 0) return null;
  const parts = block.unconvertible.map((row) => `${row.currency} ${row.amount.toFixed(2)}`);
  return `${parts.join(" + ")} not included — no exchange rate yet.`;
}

// ─────────────────────────────── catalog ────────────────────────────────

export interface LayerDef {
  layer: string;
  layer_label: string;
  is_required: boolean;
}

export function normalizeLayer(value: Record<string, unknown>): LayerDef {
  return {
    layer: stringValue(value.layer),
    layer_label: stringValue(value.layer_label, stringValue(value.layer)),
    is_required: boolValue(value.is_required),
  };
}

export interface Thresholds {
  at_risk_window_days: number;
  urgent_window_days: number;
  timeline_window_days: number;
}

// ─────────────────────────────── providers ──────────────────────────────

export interface Provider {
  id: number;
  name: string;
  slug: string;
  brand_color: string;
  console_url: string;
  logo_initial: string;
  vendor: number | null;
  vendor_name: string;
  is_active: boolean;
  notes: string;
  account_count: number;
}

export function normalizeProvider(value: Record<string, unknown>): Provider {
  const name = stringValue(value.name);
  return {
    id: numberValue(value.id),
    name,
    slug: stringValue(value.slug),
    brand_color: stringValue(value.brand_color),
    console_url: stringValue(value.console_url),
    logo_initial: stringValue(value.logo_initial, name.slice(0, 1).toUpperCase()),
    vendor: nullableNumber(value.vendor),
    vendor_name: stringValue(value.vendor_name),
    is_active: boolValue(value.is_active, true),
    notes: stringValue(value.notes),
    account_count: numberValue(value.account_count),
  };
}

// ─────────────────────────────── accounts ───────────────────────────────

export interface ProviderAccount {
  id: number;
  provider: number | null;
  provider_name: string;
  provider_slug: string;
  brand_color: string;
  login_email: string;
  auth_method: string;
  auth_method_label: string;
  mfa_method: string;
  mfa_method_label: string;
  mfa_severity: Severity;
  has_mfa: boolean;
  owner: number | null;
  owner_name: string;
  owner_email: string;
  vault_credential: number | null;
  vault_credential_title: string | null;
  account_workspace: number | null;
  account_workspace_name: string;
  console_url: string;
  effective_console_url: string;
  notes: string;
  is_active: boolean;
  service_count: number;
}

export function normalizeAccount(value: Record<string, unknown>): ProviderAccount {
  return {
    id: numberValue(value.id),
    provider: nullableNumber(value.provider),
    provider_name: stringValue(value.provider_name),
    provider_slug: stringValue(value.provider_slug),
    brand_color: stringValue(value.brand_color),
    login_email: stringValue(value.login_email),
    auth_method: stringValue(value.auth_method),
    auth_method_label: stringValue(value.auth_method_label, stringValue(value.auth_method)),
    mfa_method: stringValue(value.mfa_method, "UNKNOWN"),
    mfa_method_label: stringValue(value.mfa_method_label, "Not recorded"),
    mfa_severity: severityValue(value.mfa_severity),
    has_mfa: boolValue(value.has_mfa),
    owner: nullableNumber(value.owner),
    owner_name: stringValue(value.owner_name),
    owner_email: stringValue(value.owner_email),
    vault_credential: nullableNumber(value.vault_credential),
    vault_credential_title: nullableString(value.vault_credential_title),
    account_workspace: nullableNumber(value.account_workspace),
    account_workspace_name: stringValue(value.account_workspace_name),
    console_url: stringValue(value.console_url),
    effective_console_url: stringValue(value.effective_console_url),
    notes: stringValue(value.notes),
    is_active: boolValue(value.is_active, true),
    service_count: numberValue(value.service_count),
  };
}

// ─────────────────────────────── properties ─────────────────────────────

export interface DigitalProperty {
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

export function normalizeProperty(value: Record<string, unknown>): DigitalProperty {
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    kind: stringValue(value.kind, "OTHER"),
    kind_label: stringValue(value.kind_label, "Other"),
    owner: nullableNumber(value.owner),
    owner_name: stringValue(value.owner_name),
    department: nullableNumber(value.department),
    department_name: stringValue(value.department_name),
    notes: stringValue(value.notes),
    is_active: boolValue(value.is_active, true),
    service_count: numberValue(value.service_count),
  };
}

// ─────────────────────────────── services ───────────────────────────────

export interface EstateService {
  id: number;
  name: string;
  identifier: string;
  cost: number;
  currency: string;
  billing_cycle: string;
  monthly_cost: number;
  expiry_date: string | null;
  days_until_expiry: number | null;
  urgency: Severity;
  auto_renew: boolean;
  is_at_risk: boolean;
  provider_account_id: number | null;
  provider_name: string;
  brand_color: string;
  account_login: string;
}

export function normalizeService(value: Record<string, unknown>): EstateService {
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    identifier: stringValue(value.identifier),
    cost: money(value.cost),
    currency: stringValue(value.currency, "USD").toUpperCase(),
    billing_cycle: stringValue(value.billing_cycle, "MONTHLY"),
    monthly_cost: money(value.monthly_cost),
    expiry_date: nullableString(value.expiry_date),
    days_until_expiry: nullableNumber(value.days_until_expiry),
    urgency: severityValue(value.urgency),
    auto_renew: boolValue(value.auto_renew),
    is_at_risk: boolValue(value.is_at_risk),
    provider_account_id: nullableNumber(value.provider_account_id),
    provider_name: stringValue(value.provider_name),
    brand_color: stringValue(value.brand_color),
    account_login: stringValue(value.account_login),
  };
}

// ─────────────────────────────── stack ──────────────────────────────────

export interface StackLayer extends LayerDef {
  configured: boolean;
  is_gap: boolean;
  service_count: number;
  services: EstateService[];
}

export function normalizeStackLayer(value: Record<string, unknown>): StackLayer {
  return {
    ...normalizeLayer(value),
    configured: boolValue(value.configured),
    is_gap: boolValue(value.is_gap),
    service_count: numberValue(value.service_count),
    services: arrayOf(value.services, normalizeService),
  };
}

export interface PropertyStack {
  property: DigitalProperty | null;
  layers: StackLayer[];
  gap_count: number;
  missing_layers: string[];
  unassigned_services: EstateService[];
  unassigned_count: number;
}

export function normalizeStack(value: unknown): PropertyStack {
  if (!isRecord(value)) {
    return {
      property: null,
      layers: [],
      gap_count: 0,
      missing_layers: [],
      unassigned_services: [],
      unassigned_count: 0,
    };
  }
  return {
    property: isRecord(value.property) ? normalizeProperty(value.property) : null,
    layers: arrayOf(value.layers, normalizeStackLayer),
    gap_count: numberValue(value.gap_count),
    missing_layers: Array.isArray(value.missing_layers)
      ? value.missing_layers.filter((l): l is string => typeof l === "string")
      : [],
    unassigned_services: arrayOf(value.unassigned_services, normalizeService),
    unassigned_count: numberValue(value.unassigned_count),
  };
}

/** One property card: identity, spend, and the resolved layer strip. */
export interface PropertyCard {
  id: number;
  name: string;
  kind: string;
  kind_label: string;
  owner_id: number | null;
  owner_name: string;
  service_count: number;
  spend: MoneyBlock;
  layers: { layer: string; layer_label: string; is_required: boolean; configured: boolean; is_gap: boolean }[];
  gap_count: number;
}

export function normalizePropertyCard(value: Record<string, unknown>): PropertyCard {
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    kind: stringValue(value.kind, "OTHER"),
    kind_label: stringValue(value.kind_label, "Other"),
    owner_id: nullableNumber(value.owner_id),
    owner_name: stringValue(value.owner_name),
    service_count: numberValue(value.service_count),
    spend: normalizeMoney(value.spend),
    layers: arrayOf(value.layers, (row) => ({
      ...normalizeLayer(row),
      configured: boolValue(row.configured),
      is_gap: boolValue(row.is_gap),
    })),
    gap_count: numberValue(value.gap_count),
  };
}

// ─────────────────────────────── timeline ───────────────────────────────

export interface TimelineEntry {
  id: number;
  name: string;
  identifier: string;
  service_layer: string | null;
  service_layer_label: string;
  expiry_date: string | null;
  days_until: number;
  urgency: Severity;
  auto_renew: boolean;
  is_at_risk: boolean;
  cost: number;
  currency: string;
  provider_name: string;
  brand_color: string;
  digital_property_id: number | null;
  digital_property_name: string | null;
  window_days: number;
}

export function normalizeTimelineEntry(value: Record<string, unknown>): TimelineEntry {
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    identifier: stringValue(value.identifier, stringValue(value.name)),
    service_layer: nullableString(value.service_layer),
    service_layer_label: stringValue(value.service_layer_label),
    expiry_date: nullableString(value.expiry_date),
    days_until: numberValue(value.days_until),
    urgency: severityValue(value.urgency),
    auto_renew: boolValue(value.auto_renew),
    is_at_risk: boolValue(value.is_at_risk),
    cost: money(value.cost),
    currency: stringValue(value.currency, "USD").toUpperCase(),
    provider_name: stringValue(value.provider_name),
    brand_color: stringValue(value.brand_color),
    digital_property_id: nullableNumber(value.digital_property_id),
    digital_property_name: nullableString(value.digital_property_name),
    window_days: numberValue(value.window_days, 90),
  };
}

// ─────────────────────────────── overview ───────────────────────────────

export interface EstateKpis {
  service_count: number;
  property_count: number;
  account_count: number;
  provider_count: number;
  orphan_count: number;
  at_risk_count: number;
  stack_gap_count: number;
  properties_with_gaps: number;
  accounts_without_mfa: number;
  accounts_with_weak_mfa: number;
  accounts_with_unknown_mfa: number;
}

export interface GroupSpend {
  key: string;
  label: string;
  brand_color: string;
  spend: MoneyBlock;
  count: number;
}

export interface EstateOverview {
  as_of: string | null;
  total_spend: MoneyBlock;
  spend_by_currency: { currency: string; monthly: number; yearly: number; count: number }[];
  spend_by_provider: GroupSpend[];
  spend_by_layer: GroupSpend[];
  renewal_timeline: TimelineEntry[];
  kpis: EstateKpis;
  at_risk_services: EstateService[];
  orphaned_services: EstateService[];
  layers: LayerDef[];
  thresholds: Thresholds;
}

const EMPTY_KPIS: EstateKpis = {
  service_count: 0,
  property_count: 0,
  account_count: 0,
  provider_count: 0,
  orphan_count: 0,
  at_risk_count: 0,
  stack_gap_count: 0,
  properties_with_gaps: 0,
  accounts_without_mfa: 0,
  accounts_with_weak_mfa: 0,
  accounts_with_unknown_mfa: 0,
};

export const EMPTY_OVERVIEW: EstateOverview = {
  as_of: null,
  total_spend: EMPTY_MONEY,
  spend_by_currency: [],
  spend_by_provider: [],
  spend_by_layer: [],
  renewal_timeline: [],
  kpis: EMPTY_KPIS,
  at_risk_services: [],
  orphaned_services: [],
  layers: [],
  thresholds: {
    at_risk_window_days: 30,
    urgent_window_days: 7,
    timeline_window_days: 90,
  },
};

export function normalizeOverview(value: unknown): EstateOverview {
  if (!isRecord(value)) return EMPTY_OVERVIEW;
  const kpis = isRecord(value.kpis) ? value.kpis : {};
  const thresholds = isRecord(value.thresholds) ? value.thresholds : {};

  return {
    as_of: nullableString(value.as_of),
    total_spend: normalizeMoney(value.total_spend),
    spend_by_currency: arrayOf(value.spend_by_currency, (row) => ({
      currency: stringValue(row.currency, "?").toUpperCase(),
      monthly: money(row.monthly),
      yearly: money(row.yearly),
      count: numberValue(row.count),
    })),
    spend_by_provider: arrayOf(value.spend_by_provider, (row) => ({
      key: String(row.provider_id ?? "unassigned"),
      label: stringValue(row.provider_name, "Unassigned"),
      brand_color: stringValue(row.brand_color),
      spend: normalizeMoney(row.spend),
      count: numberValue(row.count),
    })),
    spend_by_layer: arrayOf(value.spend_by_layer, (row) => ({
      key: stringValue(row.layer, "unassigned"),
      label: stringValue(row.layer_label, "Unassigned"),
      brand_color: "",
      spend: normalizeMoney(row.spend),
      count: numberValue(row.count),
    })),
    renewal_timeline: arrayOf(value.renewal_timeline, normalizeTimelineEntry),
    kpis: {
      service_count: numberValue(kpis.service_count),
      property_count: numberValue(kpis.property_count),
      account_count: numberValue(kpis.account_count),
      provider_count: numberValue(kpis.provider_count),
      orphan_count: numberValue(kpis.orphan_count),
      at_risk_count: numberValue(kpis.at_risk_count),
      stack_gap_count: numberValue(kpis.stack_gap_count),
      properties_with_gaps: numberValue(kpis.properties_with_gaps),
      accounts_without_mfa: numberValue(kpis.accounts_without_mfa),
      accounts_with_weak_mfa: numberValue(kpis.accounts_with_weak_mfa),
      accounts_with_unknown_mfa: numberValue(kpis.accounts_with_unknown_mfa),
    },
    at_risk_services: arrayOf(value.at_risk_services, normalizeService),
    orphaned_services: arrayOf(value.orphaned_services, normalizeService),
    layers: arrayOf(value.layers, normalizeLayer),
    thresholds: {
      at_risk_window_days: numberValue(thresholds.at_risk_window_days, 30),
      urgent_window_days: numberValue(thresholds.urgent_window_days, 7),
      timeline_window_days: numberValue(thresholds.timeline_window_days, 90),
    },
  };
}

// ─────────────────────────────── gaps ───────────────────────────────────

export interface PropertyGap {
  id: number;
  name: string;
  kind: string;
  kind_label: string;
  owner_id: number | null;
  owner_name: string;
  service_count: number;
  missing_layers: string[];
  missing_layer_labels: string[];
  missing_count: number;
}

export interface EstateGaps {
  properties_with_gaps: PropertyGap[];
  property_gap_count: number;
  total_missing_layers: number;
  orphaned_services: EstateService[];
  orphan_count: number;
  required_layers: LayerDef[];
}

export const EMPTY_GAPS: EstateGaps = {
  properties_with_gaps: [],
  property_gap_count: 0,
  total_missing_layers: 0,
  orphaned_services: [],
  orphan_count: 0,
  required_layers: [],
};

export function normalizeGaps(value: unknown): EstateGaps {
  if (!isRecord(value)) return EMPTY_GAPS;
  return {
    properties_with_gaps: arrayOf(value.properties_with_gaps, (row) => ({
      id: numberValue(row.id),
      name: stringValue(row.name),
      kind: stringValue(row.kind, "OTHER"),
      kind_label: stringValue(row.kind_label, "Other"),
      owner_id: nullableNumber(row.owner_id),
      owner_name: stringValue(row.owner_name),
      service_count: numberValue(row.service_count),
      missing_layers: Array.isArray(row.missing_layers)
        ? row.missing_layers.filter((l): l is string => typeof l === "string")
        : [],
      missing_layer_labels: Array.isArray(row.missing_layer_labels)
        ? row.missing_layer_labels.filter((l): l is string => typeof l === "string")
        : [],
      missing_count: numberValue(row.missing_count),
    })),
    property_gap_count: numberValue(value.property_gap_count),
    total_missing_layers: numberValue(value.total_missing_layers),
    orphaned_services: arrayOf(value.orphaned_services, normalizeService),
    orphan_count: numberValue(value.orphan_count),
    required_layers: arrayOf(value.required_layers, normalizeLayer),
  };
}

// ─────────────────────────────── paged lists ────────────────────────────

/** DRF pages results; a bare array is also accepted so pagination can change. */
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

// ─────────────────────────────── filters ────────────────────────────────

export interface EstateFilters {
  layer: string;
  provider: string;
  property: string;
  atRiskOnly: boolean;
  noAutoRenewOnly: boolean;
}

export const EMPTY_FILTERS: EstateFilters = {
  layer: "all",
  provider: "all",
  property: "all",
  atRiskOnly: false,
  noAutoRenewOnly: false,
};

export function filtersActive(filters: EstateFilters): number {
  let count = 0;
  if (filters.layer !== "all") count += 1;
  if (filters.provider !== "all") count += 1;
  if (filters.property !== "all") count += 1;
  if (filters.atRiskOnly) count += 1;
  if (filters.noAutoRenewOnly) count += 1;
  return count;
}

/** Apply the filter bar to timeline rows. Provider matches on name, which is
 *  what the timeline carries; the picker is built from the same values. */
export function applyFilters(
  rows: TimelineEntry[],
  filters: EstateFilters,
): TimelineEntry[] {
  return rows.filter((row) => {
    if (filters.layer !== "all" && row.service_layer !== filters.layer) return false;
    if (filters.provider !== "all" && row.provider_name !== filters.provider) return false;
    if (
      filters.property !== "all" &&
      String(row.digital_property_id ?? "orphan") !== filters.property
    ) {
      return false;
    }
    if (filters.atRiskOnly && !row.is_at_risk) return false;
    if (filters.noAutoRenewOnly && row.auto_renew) return false;
    return true;
  });
}

// ─────────────────────────── timeline lane packing ──────────────────────

export interface PackedTimelineEntry extends TimelineEntry {
  /** Horizontal offset as a percentage of the window. */
  leftPct: number;
  /** Which row this label sits on, to stop overlapping labels. */
  lane: number;
}

/**
 * Greedy first-fit lane packing, reimplemented from the reference mockup's
 * `timeline` computation.
 *
 * Entries arrive in date order. Each is placed at `days / window` across the
 * track; its label needs an estimated slice of width, so it drops into the first
 * lane whose previous label has already ended (plus a small gutter). Because the
 * input is sorted ascending, a lane's occupied extent only ever moves right,
 * which is why overwriting `laneEnds[lane]` is safe rather than taking a max.
 *
 * The label-width estimate is in percent of track width, so it depends on the
 * container. `trackWidth` defaults to the reference's 620px assumption; pass the
 * measured width for a denser, more accurate pack.
 */
export function packTimeline(
  rows: TimelineEntry[],
  options: { windowDays?: number; trackWidth?: number; maxLeftPct?: number } = {},
): { entries: PackedTimelineEntry[]; laneCount: number } {
  const { windowDays = 90, trackWidth = 620, maxLeftPct = 84 } = options;
  const laneEnds: number[] = [];
  const GUTTER_PCT = 1.5;
  const LABEL_CHAR_PX = 6.8;
  const LABEL_CHROME_PX = 104;

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

/** Evenly spaced month-ish ticks across the window. */
export function timelineTicks(windowDays: number, count = 4): { label: string; leftPct: number }[] {
  const ticks: { label: string; leftPct: number }[] = [];
  const today = new Date();
  for (let index = 0; index < count; index += 1) {
    const offset = Math.round((windowDays / (count - 1)) * index);
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    ticks.push({
      label: new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(date),
      leftPct: (offset / windowDays) * 100,
    });
  }
  return ticks;
}
