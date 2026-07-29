"use client";

/**
 * The Estate dashboard.
 *
 * One request. `/api/estate/dashboard/` returns the KPIs, the 90-day timeline
 * and both breakdowns together, so nothing on this page can disagree with
 * anything else on it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarClock,
  CircleDollarSign,
  Globe,
  PlugZap,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDate } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useAddServiceDialog } from "../add-service-context";
import {
  EmptyState,
  KpiCard,
  KpiMoney,
  KpiRowSkeleton,
  TableSkeleton,
  UnconvertedNote,
  UrgencyDot,
} from "../estate-ui";
import {
  EMPTY_DASHBOARD,
  EstateDashboard,
  countSeverity,
  errorMessage,
  normalizeDashboard,
  packTimeline,
} from "../estate-types";

/** Evenly spaced ticks across the window: Today / +30 / +60 / +90. */
function ticksFor(windowDays: number) {
  const stops = [0, Math.round(windowDays / 3), Math.round((windowDays / 3) * 2), windowDays];
  const today = new Date();
  return stops.map((offset) => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + offset,
    );
    return {
      label: offset === 0 ? "Today" : `+${offset}d`,
      sub: formatDate(date, { withYear: false }),
      leftPct: (offset / windowDays) * 100,
    };
  });
}

function RenewalTimeline({ data }: { data: EstateDashboard }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(900);

  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setTrackWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const windowDays = data.thresholds.timeline_window_days || 90;
  const { entries, laneCount } = useMemo(
    () => packTimeline(data.timeline, { windowDays, trackWidth }),
    [data.timeline, windowDays, trackWidth],
  );
  const ticks = useMemo(() => ticksFor(windowDays), [windowDays]);

  if (data.timeline.length === 0) {
    return (
      <Card>
        <CardContent className="pt-1">
          <EmptyState
            icon={CalendarClock}
            title={`Nothing renews in the next ${windowDays} days. Renewal dates appear here once services carry them.`}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-1">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Renewals timeline</p>
            <p className="text-xs text-muted-foreground">
              Next {windowDays} days · {data.timeline.length} renewal
              {data.timeline.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <UrgencyDot severity="critical" /> &lt;
              {data.thresholds.urgent_window_days}d
            </span>
            <span className="flex items-center gap-1.5">
              <UrgencyDot severity="warning" /> &lt;
              {data.thresholds.at_risk_window_days}d
            </span>
            <span className="flex items-center gap-1.5">
              <UrgencyDot severity="muted" /> later
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div
            ref={trackRef}
            className="relative min-w-[560px]"
            style={{ height: `${Math.max(1, laneCount) * 30 + 46}px` }}
          >
            {/* The track itself */}
            <div className="absolute left-0 right-0 top-3 h-px bg-border" />
            {ticks.map((tick) => (
              <div
                key={tick.label}
                className="absolute top-0 flex flex-col items-center"
                style={{ left: `${tick.leftPct}%` }}
              >
                <div className="h-6 w-px bg-border" />
                <span className="mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground">
                  {tick.label}
                </span>
              </div>
            ))}

            {entries.map((entry) => (
              <Tooltip key={entry.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="absolute flex max-w-[220px] items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 text-left text-[11px] shadow-sm transition-colors hover:border-primary/50"
                    style={{
                      left: `${entry.leftPct}%`,
                      top: `${entry.lane * 30 + 40}px`,
                    }}
                  >
                    <UrgencyDot severity={entry.urgency} />
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: entry.brand_color || "#64748b" }}
                    />
                    <span className="truncate">{entry.identifier}</span>
                    {!entry.auto_renew && (
                      <PlugZap className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{entry.identifier}</p>
                  <p className="text-xs">
                    {entry.service_type_label} · {entry.provider_name}
                  </p>
                  <p className="text-xs">
                    Renews {formatDate(entry.renewal_date)} ({entry.days_until}d) ·{" "}
                    {formatMoney(entry.cost, entry.currency)}
                  </p>
                  {!entry.auto_renew && (
                    <p className="text-xs text-amber-500">
                      Auto-renew is off — this will lapse unless someone acts.
                    </p>
                  )}
                  {entry.property && <p className="text-xs">{entry.property}</p>}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SpendByProvider({ data }: { data: EstateDashboard }) {
  const rows = data.by_provider.filter((row) => row.monthly > 0);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-1">
          <EmptyState
            icon={CircleDollarSign}
            title="No priced spend to break down yet. Add a service with a cost and it appears here."
          />
        </CardContent>
      </Card>
    );
  }

  // A donut of one segment is a circle. Say the sentence instead.
  if (rows.length === 1) {
    return (
      <Card>
        <CardContent className="pt-1">
          <p className="text-sm font-medium">Spend by provider</p>
          <p className="mt-3 text-sm text-muted-foreground">
            All priced spend sits with{" "}
            <span className="font-medium text-foreground">{rows[0].name}</span> —{" "}
            {formatMoney(rows[0].monthly, data.currency)}/month. A chart of one
            segment would say less than this sentence.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-1">
        <p className="text-sm font-medium">Spend by provider</p>
        <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-[180px] w-full sm:w-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="monthly"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {rows.map((row) => (
                    <Cell key={row.slug} fill={row.brand_color || "#64748b"} />
                  ))}
                </Pie>
                <ChartTooltip
                  formatter={(value) => [
                    formatMoney(Number(value ?? 0), data.currency),
                    "Monthly",
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-1.5">
            {rows.map((row) => (
              <li key={row.slug} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: row.brand_color || "#64748b" }}
                />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="tabular-nums">
                  {formatMoney(row.monthly, data.currency, { compact: true })}
                </span>
                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                  {row.pct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function SpendByCategory({ data }: { data: EstateDashboard }) {
  const rows = data.by_category.filter((row) => row.monthly > 0);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-1">
          <EmptyState
            icon={Server}
            title="No priced spend by category yet. Costs appear here as services are added."
          />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 1) {
    return (
      <Card>
        <CardContent className="pt-1">
          <p className="text-sm font-medium">Spend by category</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Everything priced is{" "}
            <span className="font-medium text-foreground">{rows[0].label}</span> —{" "}
            {formatMoney(rows[0].monthly, data.currency)}/month. One bar is not a
            comparison.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-1">
        <p className="text-sm font-medium">Spend by category</p>
        <div className="mt-2 h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={54}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                width={54}
                tickFormatter={(value: number) =>
                  formatMoney(value, data.currency, { compact: true })
                }
              />
              <ChartTooltip
                formatter={(value) => [
                  formatMoney(Number(value ?? 0), data.currency),
                  "Monthly",
                ]}
              />
              <Bar dataKey="monthly" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EstateDashboardPage() {
  const router = useRouter();
  const { version } = useAddServiceDialog();
  const [data, setData] = useState<EstateDashboard>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await api.get<unknown>("/estate/dashboard/");
      setData(normalizeDashboard(response.data));
    } catch (reason) {
      toast.error(errorMessage(reason, "Failed to load the estate dashboard."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  if (loading) {
    return (
      <div className="space-y-3">
        <KpiRowSkeleton />
        <TableSkeleton rows={4} />
        <div className="grid gap-3 lg:grid-cols-2">
          <TableSkeleton rows={4} />
          <TableSkeleton rows={4} />
        </div>
      </div>
    );
  }

  const { kpis } = data;
  const mfaClean = kpis.accounts_missing_mfa === 0;

  return (
    <div className="space-y-3">
      {/* KPI row. Zero is always neutral or green — never a red nought. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="Total monthly spend"
          value={<KpiMoney amount={kpis.monthly_spend} currency={kpis.currency} />}
          detail={
            kpis.is_complete ? (
              `${kpis.currency} · all currencies converted`
            ) : (
              <UnconvertedNote rows={kpis.unconverted} />
            )
          }
          icon={CircleDollarSign}
          severity={kpis.is_complete ? "muted" : "warning"}
        />
        <KpiCard
          title="Active services"
          value={kpis.active_services}
          detail={`Across ${kpis.properties} propert${kpis.properties === 1 ? "y" : "ies"}`}
          icon={Server}
          severity="muted"
          onClick={() => router.push("/estate/services")}
        />
        <KpiCard
          title="Renewals in 30 days"
          value={kpis.renewals_30d}
          detail={kpis.renewals_30d === 0 ? "Nothing due" : "Due soon"}
          icon={CalendarClock}
          severity={countSeverity(kpis.renewals_30d, "warning")}
          onClick={() => router.push("/estate/services?expiring=1")}
        />
        <KpiCard
          title="Accounts missing MFA"
          value={mfaClean ? "All covered" : kpis.accounts_missing_mfa}
          detail={
            mfaClean
              ? "Every account has a second factor"
              : "No second factor, or never checked"
          }
          icon={mfaClean ? ShieldCheck : ShieldAlert}
          severity={mfaClean ? "ok" : "critical"}
          onClick={() => router.push("/estate/accounts?mfa=missing")}
        />
        <KpiCard
          title="Orphan services"
          value={kpis.orphan_services}
          detail={
            kpis.orphan_services === 0
              ? "Everything is attached"
              : "Paid for, attached to nothing"
          }
          icon={Unlink}
          severity={countSeverity(kpis.orphan_services, "warning")}
          onClick={() => router.push("/estate/services?orphans=1")}
        />
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {kpis.active_services === 0 ? (
        <Card>
          <CardContent className="pt-1">
            <EmptyState
              icon={Globe}
              title="No services yet. Add the first one — a domain, a DNS zone, a hosting plan — and this page fills in."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <RenewalTimeline data={data} />
          <div className="grid gap-3 lg:grid-cols-2">
            <SpendByProvider data={data} />
            <SpendByCategory data={data} />
          </div>
        </>
      )}
    </div>
  );
}
