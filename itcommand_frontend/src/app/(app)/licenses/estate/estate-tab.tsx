"use client";

/**
 * The Estate tab.
 *
 * Reading order matters here: what it costs, what is broken, what renews next.
 * The property cards are the centrepiece — they are the only place the layer
 * strip appears at a glance, and the strip is the thing that makes a missing
 * registrar visible without anyone going looking for it.
 *
 * Every money figure renders through `moneyLabel`, which refuses to caption a
 * partial total as complete. That is the defect this feature was scoped to fix,
 * so it is enforced in a helper rather than left to each call site.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  ExternalLink,
  Globe,
  Layers,
  Link2Off,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  SlidersHorizontal,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDate } from "@/lib/date";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { PropertyDialog } from "./property-dialog";
import { ServiceDialog } from "./service-dialog";
import {
  applyFilters,
  countSeverity,
  EMPTY_FILTERS,
  EMPTY_GAPS,
  EMPTY_OVERVIEW,
  EstateFilters,
  EstateGaps,
  EstateOverview,
  EstateService,
  MoneyBlock,
  moneyLabel,
  normalizeAccount,
  normalizeGaps,
  normalizeOverview,
  normalizeProperty,
  normalizePropertyCard,
  normalizeProvider,
  packTimeline,
  PropertyCard as PropertyCardData,
  ProviderAccount,
  Provider,
  DigitalProperty,
  resultsOf,
  Severity,
  SEVERITY_BADGE,
  SEVERITY_TONE,
  filtersActive,
  timelineTicks,
  unconvertedSummary,
} from "./estate-types";

function errorMessage(reason: unknown, fallback: string): string {
  const detail = (reason as { response?: { data?: { detail?: unknown } } })?.response?.data
    ?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

/** One line of copy and an action. Never a bare zero. */
function EmptyState({
  icon: Icon,
  title,
  action,
  tone = "muted",
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
  tone?: Severity;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className={`rounded-xl p-2.5 ${SEVERITY_TONE[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {action}
    </div>
  );
}

/**
 * The caption that makes a partial total honest, plus what was left out.
 * Rendered wherever a MoneyBlock is shown as a headline number.
 */
function MoneyCaption({ block, subject }: { block: MoneyBlock; subject?: string }) {
  const excluded = unconvertedSummary(block);
  return (
    <>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {moneyLabel(block, subject)}
      </p>
      {excluded && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {excluded}{" "}
            <span className="text-muted-foreground">
              Add one in Settings → Integrations.
            </span>
          </span>
        </p>
      )}
    </>
  );
}

function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  severity,
  onClick,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  severity: Severity;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <Card
      className={interactive ? "cursor-pointer transition-colors hover:border-primary/40" : undefined}
      onClick={onClick}
    >
      <CardContent className="flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <p className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${SEVERITY_TONE[severity]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One chip per layer, in stack order. Filled when a service is bound, dashed
 * outline when a required layer is empty.
 *
 * This is the strip that makes the whole module worth having: eight domains in a
 * row, and the one with no TLS is obvious without reading a number.
 */
function LayerStrip({
  layers,
}: {
  layers: { layer: string; layer_label: string; is_required: boolean; configured: boolean; is_gap: boolean }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {layers.map((layer) => {
        const className = layer.configured
          ? "border-transparent bg-primary/10 text-primary"
          : layer.is_gap
            ? "border-dashed border-amber-400 bg-transparent text-amber-700 dark:text-amber-400"
            : "border-dashed border-border bg-transparent text-muted-foreground/70";
        const title = layer.configured
          ? `${layer.layer_label} — configured`
          : layer.is_gap
            ? `${layer.layer_label} — missing`
            : `${layer.layer_label} — not tracked (optional)`;
        return (
          <Tooltip key={layer.layer}>
            <TooltipTrigger asChild>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
              >
                {layer.layer_label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{title}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function PropertyCard({
  card,
  onOpen,
}: {
  card: PropertyCardData;
  onOpen: () => void;
}) {
  const gapSeverity = countSeverity(card.gap_count, "warning");
  return (
    <Card
      className="cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/40"
      onClick={onOpen}
    >
      <CardContent className="space-y-3 pt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{card.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[11px]">
                {card.kind_label}
              </Badge>
              <span className="truncate text-xs text-muted-foreground">
                {card.owner_name || "No owner"}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(card.spend.monthly, card.spend.currency, { compact: true })}
            </p>
            <p className="text-[11px] text-muted-foreground">
              /month · {card.service_count} service{card.service_count === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <LayerStrip layers={card.layers} />

        <div className="flex items-center justify-between gap-2 border-t pt-2.5">
          {card.gap_count > 0 ? (
            <Badge className={`text-[11px] ${SEVERITY_BADGE[gapSeverity]}`}>
              {card.gap_count} layer{card.gap_count === 1 ? "" : "s"} missing
            </Badge>
          ) : (
            <Badge className={`text-[11px] ${SEVERITY_BADGE.ok}`}>Stack complete</Badge>
          )}
          {!card.spend.is_complete && (
            <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" /> partial cost
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const URGENCY_BAR: Record<Severity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  ok: "bg-emerald-500",
  muted: "bg-muted-foreground/40",
};

const URGENCY_TEXT: Record<Severity, string> = {
  critical: "text-red-700 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
  ok: "text-emerald-700 dark:text-emerald-400",
  muted: "text-muted-foreground",
};

/**
 * Renewal timeline with greedy lane packing (see `packTimeline`).
 *
 * The track is measured rather than assumed, because the label-width estimate
 * that drives the packing is a percentage of the track — guessing 620px on a
 * wide screen packs far more loosely than it needs to.
 */
function RenewalTimeline({
  entries,
  windowDays,
  onSelect,
}: {
  entries: EstateOverview["renewal_timeline"];
  windowDays: number;
  onSelect: (id: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(620);

  useEffect(() => {
    const element = trackRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect?.width;
      if (width && width > 120) setTrackWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { entries: packed, laneCount } = useMemo(
    () => packTimeline(entries, { windowDays, trackWidth }),
    [entries, windowDays, trackWidth],
  );
  const ticks = useMemo(() => timelineTicks(windowDays), [windowDays]);
  const LANE_HEIGHT = 34;

  return (
    <div ref={trackRef} className="relative w-full">
      <div className="relative mb-2 h-4">
        {ticks.map((tick) => (
          <span
            key={tick.label}
            className="absolute -translate-x-1/2 text-[11px] text-muted-foreground"
            style={{ left: `${Math.min(97, tick.leftPct)}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <div className="relative border-t border-dashed" style={{ height: Math.max(1, laneCount) * LANE_HEIGHT }}>
        {packed.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.id)}
            className="absolute flex items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-left text-[11px] shadow-sm transition-colors hover:border-primary/50"
            style={{ left: `${entry.leftPct}%`, top: entry.lane * LANE_HEIGHT + 4 }}
            title={`${entry.identifier} · ${formatDate(entry.expiry_date)} · ${formatMoney(entry.cost, entry.currency)}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${URGENCY_BAR[entry.urgency]}`} />
            <span className="max-w-[16ch] truncate font-medium">{entry.identifier}</span>
            <span className={URGENCY_TEXT[entry.urgency]}>
              {entry.days_until === 0 ? "today" : `${entry.days_until}d`}
            </span>
            {!entry.auto_renew && (
              <Unplug className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function EstateFilterBar({
  filters,
  onChange,
  layers,
  providers,
  properties,
  resultLabel,
}: {
  filters: EstateFilters;
  onChange: (next: EstateFilters) => void;
  layers: { layer: string; layer_label: string }[];
  providers: string[];
  properties: { id: number; name: string }[];
  resultLabel: string;
}) {
  const active = filtersActive(filters);
  const set = <K extends keyof EstateFilters>(key: K, value: EstateFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <Card>
      <CardContent className="space-y-3 pt-1">
        <div className="flex flex-wrap items-center gap-3">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <Select value={filters.layer} onValueChange={(value) => set("layer", value)}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="All layers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All layers</SelectItem>
              {layers.map((layer) => (
                <SelectItem key={layer.layer} value={layer.layer}>
                  {layer.layer_label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.provider} onValueChange={(value) => set("provider", value)}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="All providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.property} onValueChange={(value) => set("property", value)}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder="All properties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              <SelectItem value="orphan">Orphaned (no property)</SelectItem>
              {properties.map((property) => (
                <SelectItem key={property.id} value={String(property.id)}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Switch
              id="estate-at-risk"
              checked={filters.atRiskOnly}
              onCheckedChange={(checked) => set("atRiskOnly", checked === true)}
            />
            <Label htmlFor="estate-at-risk" className="text-xs font-normal">
              At risk only
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="estate-no-auto"
              checked={filters.noAutoRenewOnly}
              onCheckedChange={(checked) => set("noAutoRenewOnly", checked === true)}
            />
            <Label htmlFor="estate-no-auto" className="text-xs font-normal">
              No auto-renew
            </Label>
          </div>

          {active > 0 && (
            <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
              Clear {active}
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{resultLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function GapsPanel({
  gaps,
  onOpenProperty,
  onAttachOrphan,
  canEdit,
}: {
  gaps: EstateGaps;
  onOpenProperty: (id: number) => void;
  onAttachOrphan: (service: EstateService) => void;
  canEdit: boolean;
}) {
  const nothingWrong = gaps.property_gap_count === 0 && gaps.orphan_count === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2Off className="h-4 w-4" /> Gaps &amp; orphans
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Properties missing a required layer, and services nobody has tied to a property.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        {nothingWrong ? (
          <EmptyState
            icon={Layers}
            tone="ok"
            title="Every property has a full stack, and every service belongs to one."
          />
        ) : (
          <div className="divide-y">
            {gaps.properties_with_gaps.map((row) => (
              <button
                key={`prop-${row.id}`}
                type="button"
                onClick={() => onOpenProperty(row.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Missing {row.missing_layer_labels.join(", ")}
                  </p>
                </div>
                <Badge className={`shrink-0 text-[11px] ${SEVERITY_BADGE.warning}`}>
                  {row.missing_count} missing
                </Badge>
              </button>
            ))}

            {gaps.orphaned_services.map((service) => (
              <div
                key={`orphan-${service.id}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{service.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {service.provider_name || "No provider"} ·{" "}
                    {formatMoney(service.cost, service.currency)} · renews{" "}
                    {formatDate(service.expiry_date)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge className={`text-[11px] ${SEVERITY_BADGE.warning}`}>Orphan</Badge>
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => onAttachOrphan(service)}>
                      Attach
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SpendBreakdown({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: React.ElementType;
  rows: EstateOverview["spend_by_provider"];
}) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.spend.monthly), 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing to break down yet.
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.brand_color || "var(--muted-foreground)" }}
                  />
                  <span className="truncate font-medium">{row.label}</span>
                  {!row.spend.is_complete && (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                  )}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatMoney(row.spend.monthly, row.spend.currency, { compact: true })}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: max > 0 ? `${Math.max(2, (row.spend.monthly / max) * 100)}%` : "2%",
                    backgroundColor: row.brand_color || "var(--primary)",
                  }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function EstateSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="pt-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-24" />
              <Skeleton className="mt-2 h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3 pt-1">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
              <div className="flex gap-1.5">
                {Array.from({ length: 7 }).map((__, chip) => (
                  <Skeleton key={chip} className="h-5 w-14 rounded-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function EstateTab() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "subscriptions", "add");
  const canEdit = can(user, "subscriptions", "edit");

  const [overview, setOverview] = useState<EstateOverview>(EMPTY_OVERVIEW);
  const [cards, setCards] = useState<PropertyCardData[]>([]);
  const [gaps, setGaps] = useState<EstateGaps>(EMPTY_GAPS);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [properties, setProperties] = useState<DigitalProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<EstateFilters>(EMPTY_FILTERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSeed, setDialogSeed] = useState<{
    serviceId?: number;
    propertyId?: number;
    layer?: string;
  } | null>(null);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [people, setPeople] = useState<{ id: number; full_name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

  const loadData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    const [
      overviewResult,
      cardsResult,
      gapsResult,
      providersResult,
      accountsResult,
      propertiesResult,
      usersResult,
      departmentsResult,
    ] = await Promise.allSettled([
      // No ?days= on purpose: the timeline window is configured in
      // Settings → Digital Estate, and passing one here would override it.
      api.get<unknown>("/estate/overview/"),
      api.get<unknown>("/estate/properties/stacks/"),
      api.get<unknown>("/estate/gaps/"),
      api.get<unknown>("/estate/providers/?page_size=200"),
      api.get<unknown>("/estate/accounts/?page_size=200"),
      api.get<unknown>("/estate/properties/?page_size=200"),
      api.get<unknown>("/users/?page_size=200"),
      api.get<unknown>("/departments/?page_size=200"),
    ]);

    if (overviewResult.status === "fulfilled") {
      setOverview(normalizeOverview(overviewResult.value.data));
    } else {
      toast.error(errorMessage(overviewResult.reason, "Failed to load the estate overview."));
    }

    if (cardsResult.status === "fulfilled") {
      setCards(resultsOf(cardsResult.value.data, normalizePropertyCard));
    } else {
      toast.error(errorMessage(cardsResult.reason, "Failed to load property stacks."));
    }

    if (gapsResult.status === "fulfilled") setGaps(normalizeGaps(gapsResult.value.data));
    if (providersResult.status === "fulfilled") {
      setProviders(resultsOf(providersResult.value.data, normalizeProvider));
    }
    if (accountsResult.status === "fulfilled") {
      setAccounts(resultsOf(accountsResult.value.data, normalizeAccount));
    }
    if (propertiesResult.status === "fulfilled") {
      setProperties(resultsOf(propertiesResult.value.data, normalizeProperty));
    }
    if (usersResult.status === "fulfilled") {
      setPeople(
        resultsOf(usersResult.value.data, (row) => ({
          id: Number(row.id ?? 0),
          full_name: String(row.full_name ?? ""),
        })).filter((row) => row.id > 0),
      );
    }
    if (departmentsResult.status === "fulfilled") {
      setDepartments(
        resultsOf(departmentsResult.value.data, (row) => ({
          id: Number(row.id ?? 0),
          name: String(row.name ?? ""),
        })).filter((row) => row.id > 0),
      );
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const providerNames = useMemo(
    () =>
      Array.from(
        new Set(overview.renewal_timeline.map((row) => row.provider_name).filter(Boolean)),
      ).sort() as string[],
    [overview.renewal_timeline],
  );

  const filteredTimeline = useMemo(
    () => applyFilters(overview.renewal_timeline, filters),
    [overview.renewal_timeline, filters],
  );

  const visibleCards = useMemo(() => {
    if (filters.property === "all" || filters.property === "orphan") return cards;
    return cards.filter((card) => String(card.id) === filters.property);
  }, [cards, filters.property]);

  const openProperty = (id: number) => router.push(`/licenses/estate/${id}`);

  const openDialog = (seed: typeof dialogSeed) => {
    setDialogSeed(seed);
    setDialogOpen(true);
  };

  if (loading) return <EstateSkeleton />;

  const { kpis, total_spend: spend, thresholds } = overview;
  const nothingTracked =
    kpis.property_count === 0 && kpis.service_count === 0 && kpis.account_count === 0;

  if (nothingTracked) {
    return (
      <>
        <Card>
          <CardContent className="pt-1">
            <EmptyState
              icon={Globe}
              title="No digital estate yet. Add a property — a domain, app or site — then attach the services that keep it running."
              action={
                canAdd ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => setPropertyOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Add property
                    </Button>
                    <Button variant="outline" onClick={() => openDialog(null)}>
                      Add service
                    </Button>
                  </div>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
        <PropertyDialog
          open={propertyOpen}
          onOpenChange={setPropertyOpen}
          property={null}
          users={people}
          departments={departments}
          onSaved={() => {
            setPropertyOpen(false);
            void loadData(true);
          }}
        />
        <ServiceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          seed={dialogSeed}
          layers={overview.layers}
          properties={properties}
          accounts={accounts}
          providers={providers}
          onSaved={() => {
            setDialogOpen(false);
            void loadData(true);
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1 — KPI row. Zero is always neutral: a red nought teaches people to ignore red. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          title="Monthly spend"
          value={formatMoney(spend.monthly, spend.currency, { compact: true })}
          detail={spend.is_complete ? `All currencies · ${spend.currency}` : "Partial — see below"}
          icon={CircleDollarSign}
          severity={spend.is_complete ? "muted" : "warning"}
        />
        <KpiCard
          title="Properties"
          value={String(kpis.property_count)}
          detail={`${kpis.service_count} service${kpis.service_count === 1 ? "" : "s"}`}
          icon={Globe}
          severity="muted"
        />
        <KpiCard
          title="Services"
          value={String(kpis.service_count)}
          detail={`across ${kpis.provider_count} provider${kpis.provider_count === 1 ? "" : "s"}`}
          icon={ServerCog}
          severity="muted"
        />
        <KpiCard
          title="Stack gaps"
          value={String(kpis.stack_gap_count)}
          detail={`on ${kpis.properties_with_gaps} propert${kpis.properties_with_gaps === 1 ? "y" : "ies"}`}
          icon={Layers}
          severity={countSeverity(kpis.stack_gap_count, "warning")}
        />
        <KpiCard
          title="Orphans"
          value={String(kpis.orphan_count)}
          detail="billed, not on a property"
          icon={Link2Off}
          severity={countSeverity(kpis.orphan_count, "warning")}
        />
        <KpiCard
          title="At risk"
          value={String(kpis.at_risk_count)}
          detail={`no auto-renew, ≤${thresholds.at_risk_window_days}d`}
          icon={ShieldAlert}
          severity={countSeverity(kpis.at_risk_count, "critical")}
          onClick={() => setFilters({ ...EMPTY_FILTERS, atRiskOnly: true })}
        />
      </div>

      {/* The honest headline. Never captions a partial total as complete. */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-wrap items-end justify-between gap-4 pt-1">
          <div className="min-w-0">
            <MoneyCaption block={spend} />
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatMoney(spend.yearly, spend.currency)}
              <span className="ml-2 text-sm font-normal text-muted-foreground">/ year</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {formatMoney(spend.monthly, spend.currency)} / month
              {spend.rates_as_of ? ` · rates as of ${formatDate(spend.rates_as_of)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadData(true)}
              disabled={refreshing}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {canAdd && (
              <Button size="sm" onClick={() => openDialog(null)}>
                <Plus className="mr-2 h-4 w-4" /> Add service
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4 — Filters */}
      <EstateFilterBar
        filters={filters}
        onChange={setFilters}
        layers={overview.layers}
        providers={providerNames}
        properties={properties.map((property) => ({ id: property.id, name: property.name }))}
        resultLabel={`${filteredTimeline.length} of ${overview.renewal_timeline.length} upcoming renewals`}
      />

      {/* 2 — Property cards. The centrepiece. */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Properties
          </h2>
          <div className="flex items-center gap-1">
            {filters.property !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => setFilters({ ...filters, property: "all" })}>
                Show all
              </Button>
            )}
            {canAdd && (
              <Button variant="outline" size="sm" onClick={() => setPropertyOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add property
              </Button>
            )}
          </div>
        </div>
        {visibleCards.length === 0 ? (
          <Card>
            <CardContent className="pt-1">
              <EmptyState
                icon={Globe}
                title="No properties match this filter."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleCards.map((card) => (
              <PropertyCard key={card.id} card={card} onOpen={() => openProperty(card.id)} />
            ))}
          </div>
        )}
      </div>

      {/* 3 — Renewal timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" /> Renewals — next{" "}
            {thresholds.timeline_window_days} days
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Red inside {thresholds.urgent_window_days} days, amber inside{" "}
            {thresholds.at_risk_window_days}. A plug icon means auto-renew is off.
          </p>
        </CardHeader>
        <CardContent>
          {filteredTimeline.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={
                overview.renewal_timeline.length === 0
                  ? `Nothing renews in the next ${thresholds.timeline_window_days} days.`
                  : "No renewals match this filter."
              }
              action={
                overview.renewal_timeline.length > 0 ? (
                  <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <RenewalTimeline
              entries={filteredTimeline}
              windowDays={thresholds.timeline_window_days}
              onSelect={(id) => router.push(`/subscriptions/${id}`)}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <SpendBreakdown title="Spend by provider" icon={ServerCog} rows={overview.spend_by_provider} />
        <SpendBreakdown title="Spend by layer" icon={Layers} rows={overview.spend_by_layer} />
      </div>

      {/* 5 — Gaps panel */}
      <GapsPanel
        gaps={gaps}
        canEdit={canEdit}
        onOpenProperty={openProperty}
        onAttachOrphan={(service) => openDialog({ serviceId: service.id })}
      />

      {overview.kpis.accounts_without_mfa > 0 && (
        <Card className="border-red-300 dark:border-red-900">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm font-medium">
                  {overview.kpis.accounts_without_mfa} provider account
                  {overview.kpis.accounts_without_mfa === 1 ? " has" : "s have"} no second factor
                </p>
                <p className="text-xs text-muted-foreground">
                  A login with no MFA can hand over every service bought through it.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/licenses?tab=accounts">
                Review accounts <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <ServiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        seed={dialogSeed}
        layers={overview.layers}
        properties={properties}
        accounts={accounts}
        providers={providers}
        onSaved={() => {
          setDialogOpen(false);
          void loadData(true);
        }}
      />
      <PropertyDialog
        open={propertyOpen}
        onOpenChange={setPropertyOpen}
        property={null}
        users={people}
        departments={departments}
        onSaved={() => {
          setPropertyOpen(false);
          void loadData(true);
        }}
      />
    </div>
  );
}

export default EstateTab;
