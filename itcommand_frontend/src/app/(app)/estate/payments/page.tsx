"use client";

/**
 * Cards & charges — the reader for what the Brex sync writes.
 *
 * Until this page existed the sync wrote rows nobody could see: `PaymentCard`
 * and `ServicePayment` had no route, so a synced charge was visible only in
 * the Django admin.
 *
 * The unmatched list leads, because an unmatched charge is the finding. It is
 * money leaving the company for something nobody recorded as a service, and a
 * page that only listed the tidy matched rows would hide exactly the thing
 * worth looking at.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Link2, Link2Off, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDate } from "@/lib/date";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  EmptyState,
  KpiCard,
  KpiMoney,
  KpiRowSkeleton,
  TableSkeleton,
  UnconvertedNote,
} from "../estate-ui";
import { errorMessage, normalizeService, resultsOf } from "../estate-types";

interface Charge {
  id: number;
  merchant: string;
  description: string;
  amount: number;
  currency: string;
  posted_at: string | null;
  card_display: string;
  service: number | null;
  service_name: string | null;
  provider_name: string | null;
  match_source: string;
  match_score: number;
  base_amount: number | null;
  base_currency: string;
  is_converted: boolean;
}

interface CardRow {
  id: number;
  display: string;
  last_four: string;
  nickname: string;
  holder_name: string;
  status: string;
  status_label: string;
  form_label: string;
  limit_amount: number | null;
  limit_currency: string;
  limit_interval: string;
  service_count: number;
  last_synced_at: string | null;
}

interface CurrencyTotal {
  currency: string;
  total: number;
  count: number;
}

/** A single figure in the reporting currency, and what it had to leave out. */
interface Converted {
  currency: string;
  total: number;
  converted_count: number;
  unconvertible: CurrencyTotal[];
  is_complete: boolean;
}

interface Summary {
  days: number;
  charge_count: number;
  matched_count: number;
  unmatched_count: number;
  totals: CurrencyTotal[];
  unmatched_totals: CurrencyTotal[];
  converted: Converted;
  unmatched_converted: Converted;
  card_count: number;
}

function normalizeConverted(value: unknown): Converted {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    currency: str(record.currency, "USD"),
    total: numeric(record.total),
    converted_count: numeric(record.converted_count),
    unconvertible: normalizeTotals(record.unconvertible),
    is_complete: record.is_complete !== false,
  };
}

const str = (value: unknown, fallback = ""): string =>
  value === null || value === undefined ? fallback : String(value);

const numeric = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function normalizeCharge(row: Record<string, unknown>): Charge {
  return {
    id: numeric(row.id),
    merchant: str(row.merchant),
    description: str(row.description),
    amount: numeric(row.amount),
    currency: str(row.currency, "USD"),
    posted_at: row.posted_at ? str(row.posted_at) : null,
    card_display: str(row.card_display),
    service: row.service === null || row.service === undefined ? null : numeric(row.service),
    service_name: row.service_name ? str(row.service_name) : null,
    provider_name: row.provider_name ? str(row.provider_name) : null,
    match_source: str(row.match_source, "NONE"),
    match_score: numeric(row.match_score),
    base_amount:
      row.base_amount === null || row.base_amount === undefined
        ? null
        : numeric(row.base_amount),
    base_currency: str(row.base_currency),
    is_converted: row.is_converted === true,
  };
}

function normalizeCard(row: Record<string, unknown>): CardRow {
  return {
    id: numeric(row.id),
    display: str(row.display),
    last_four: str(row.last_four),
    nickname: str(row.nickname),
    holder_name: str(row.holder_name),
    status: str(row.status),
    status_label: str(row.status_label),
    form_label: str(row.form_label),
    limit_amount:
      row.limit_amount === null || row.limit_amount === undefined
        ? null
        : numeric(row.limit_amount),
    limit_currency: str(row.limit_currency),
    limit_interval: str(row.limit_interval),
    service_count: numeric(row.service_count),
    last_synced_at: row.last_synced_at ? str(row.last_synced_at) : null,
  };
}

function normalizeTotals(value: unknown): CurrencyTotal[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const record = (row ?? {}) as Record<string, unknown>;
    return {
      currency: str(record.currency, "USD"),
      total: numeric(record.total),
      count: numeric(record.count),
    };
  });
}

/**
 * Totals are shown one line per currency and never added together — there is
 * no FX conversion on charges yet, and a single headline built at 1:1 would be
 * a wrong number presented as a right one.
 */
function CurrencyTotals({ totals }: { totals: CurrencyTotal[] }) {
  if (totals.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums">
      {totals.map((row, index) => (
        <span key={row.currency}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          {formatMoney(row.total, row.currency)}
        </span>
      ))}
    </span>
  );
}

export default function EstatePaymentsPage() {
  const user = useAuthStore((state) => state.user);
  const canEdit = can(user, "estate", "edit");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [services, setServices] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyCharge, setBusyCharge] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(true);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [summaryRes, chargesRes, cardsRes, servicesRes] = await Promise.all([
          api.get<unknown>("/estate/payments/summary/?days=90"),
          api.get<unknown>("/estate/payments/?days=90&page_size=200"),
          api.get<unknown>("/estate/cards/?page_size=200"),
          api.get<unknown>("/estate/services/?page_size=200"),
        ]);

        const raw = (summaryRes.data ?? {}) as Record<string, unknown>;
        setSummary({
          days: numeric(raw.days, 90),
          charge_count: numeric(raw.charge_count),
          matched_count: numeric(raw.matched_count),
          unmatched_count: numeric(raw.unmatched_count),
          totals: normalizeTotals(raw.totals),
          unmatched_totals: normalizeTotals(raw.unmatched_totals),
          converted: normalizeConverted(raw.converted),
          unmatched_converted: normalizeConverted(raw.unmatched_converted),
          card_count: numeric(raw.card_count),
        });
        setCharges(resultsOf(chargesRes.data, normalizeCharge));
        setCards(resultsOf(cardsRes.data, normalizeCard));
        setServices(
          resultsOf(servicesRes.data, normalizeService).map((service) => ({
            id: service.id,
            label: service.provider_name
              ? `${service.identifier} · ${service.provider_name}`
              : service.identifier,
          })),
        );
      } catch (reason) {
        toast.error(errorMessage(reason, "Failed to load cards and charges."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Correct a match the descriptor matcher got wrong.
   *
   * The backend also copies this charge's merchant onto the service as its
   * billing descriptor when the service has none, so the same correction is
   * not needed again next month.
   */
  const linkCharge = async (charge: Charge, serviceId: string) => {
    setBusyCharge(charge.id);
    try {
      await api.post(`/estate/payments/${charge.id}/link/`, {
        service: Number(serviceId),
      });
      toast.success("Charge linked. Future charges from this merchant will match on their own.");
      await load(true);
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not link that charge."));
    } finally {
      setBusyCharge(null);
    }
  };

  const unlinkCharge = async (charge: Charge) => {
    setBusyCharge(charge.id);
    try {
      await api.post(`/estate/payments/${charge.id}/unlink/`, {});
      toast.success("Charge unlinked. The sync will leave it alone.");
      await load(true);
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not unlink that charge."));
    } finally {
      setBusyCharge(null);
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return charges.filter((charge) => {
      if (onlyUnmatched && charge.service !== null) return false;
      if (!needle) return true;
      return (
        charge.merchant.toLowerCase().includes(needle) ||
        charge.description.toLowerCase().includes(needle) ||
        (charge.service_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [charges, search, onlyUnmatched]);

  if (loading) {
    return (
      <div className="space-y-3">
        <KpiRowSkeleton count={4} />
        <Card>
          <CardContent className="pt-1">
            <TableSkeleton />
          </CardContent>
        </Card>
      </div>
    );
  }

  const matchRate =
    summary && summary.charge_count > 0
      ? Math.round((summary.matched_count / summary.charge_count) * 100)
      : 0;

  if (summary && summary.charge_count === 0 && cards.length === 0) {
    return (
      <Card>
        <CardContent className="pt-1">
          <EmptyState
            icon={CreditCard}
            title="No cards or charges synced yet. Connect Brex under Settings → Integrations, then run a sync."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`Spend · ${summary?.days ?? 90}d`}
          value={
            summary ? (
              <KpiMoney
                amount={summary.converted.total}
                currency={summary.converted.currency}
              />
            ) : (
              "—"
            )
          }
          detail={
            <>
              <CurrencyTotals totals={summary?.totals ?? []} />
              {/* The sentence that keeps a partial total honest. */}
              <UnconvertedNote
                rows={(summary?.converted.unconvertible ?? []).map((row) => ({
                  currency: row.currency,
                  monthly: row.total,
                }))}
              />
            </>
          }
          icon={CreditCard}
          severity={summary?.converted.is_complete === false ? "warning" : "muted"}
        />
        <KpiCard
          title="Unmatched"
          value={summary?.unmatched_count ?? 0}
          detail={
            <>
              <CurrencyTotals totals={summary?.unmatched_totals ?? []} />
              <UnconvertedNote
                rows={(summary?.unmatched_converted.unconvertible ?? []).map((row) => ({
                  currency: row.currency,
                  monthly: row.total,
                }))}
              />
            </>
          }
          icon={Link2Off}
          severity={(summary?.unmatched_count ?? 0) > 0 ? "warning" : "ok"}
        />
        <KpiCard
          title="Match rate"
          value={`${matchRate}%`}
          detail={`${summary?.matched_count ?? 0} of ${summary?.charge_count ?? 0} tied to a service`}
          icon={TriangleAlert}
          severity={matchRate >= 80 ? "ok" : "warning"}
        />
        <KpiCard
          title="Cards"
          value={summary?.card_count ?? 0}
          detail={`${cards.filter((card) => card.status === "ACTIVE").length} active`}
          icon={CreditCard}
          severity="muted"
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-1">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search merchant, description or service"
              className="pl-8"
            />
          </div>
          <Button
            variant={onlyUnmatched ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyUnmatched((current) => !current)}
          >
            <Link2Off className="mr-2 h-4 w-4" />
            {onlyUnmatched ? "Showing unmatched" : "Showing all"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-1">
          <p className="mb-1 text-sm font-medium">
            {onlyUnmatched ? "Unmatched charges" : "All charges"}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            A charge nobody matched may be a service nobody recorded. Set the
            billing descriptor on a service to make the next sync attach it.
          </p>
          {visible.length === 0 ? (
            <EmptyState
              icon={Link2Off}
              title={
                onlyUnmatched
                  ? "Every charge in this window is tied to a service."
                  : "No charges match that search."
              }
              action={
                onlyUnmatched ? undefined : (
                  <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                    Clear the search
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Posted</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Card</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((charge) => (
                    <TableRow key={charge.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {charge.posted_at ? formatDate(charge.posted_at) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <p className="truncate text-sm">{charge.merchant || "—"}</p>
                        {charge.description && charge.description !== charge.merchant && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {charge.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {charge.card_display || "—"}
                      </TableCell>
                      <TableCell>
                        {charge.service_name ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              {charge.service_name}
                              {charge.provider_name && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {charge.provider_name}
                                </span>
                              )}
                            </span>
                            {charge.match_source === "MANUAL" && (
                              <Badge variant="outline" className="text-[10px]">
                                by hand
                              </Badge>
                            )}
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-[11px]"
                                disabled={busyCharge === charge.id}
                                onClick={() => void unlinkCharge(charge)}
                              >
                                <Link2Off className="mr-1 h-3 w-3" /> Unlink
                              </Button>
                            )}
                          </div>
                        ) : canEdit ? (
                          <Select
                            disabled={busyCharge === charge.id}
                            onValueChange={(value) => void linkCharge(charge, value)}
                          >
                            <SelectTrigger className="h-7 w-[220px] text-xs">
                              <Link2 className="mr-1 h-3 w-3 shrink-0" />
                              <SelectValue placeholder="Link to a service" />
                            </SelectTrigger>
                            <SelectContent>
                              {services.map((service) => (
                                <SelectItem key={service.id} value={String(service.id)}>
                                  {service.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className="border-transparent bg-amber-100 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                            unmatched
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                        {formatMoney(charge.amount, charge.currency)}
                        {/* The converted figure sits under the original, never
                            replacing it — the charge really was in its own
                            currency, and that is the auditable fact. */}
                        {charge.is_converted && charge.base_amount !== null ? (
                          charge.base_currency !== charge.currency && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatMoney(charge.base_amount, charge.base_currency)}
                            </span>
                          )
                        ) : (
                          <span className="block text-[11px] text-amber-700 dark:text-amber-400">
                            no rate
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-1">
          <p className="mb-1 text-sm font-medium">Cards</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Last four only — no card number is ever requested or stored.
          </p>
          {cards.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No cards synced.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <div key={card.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium tabular-nums">
                        {card.display}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {card.holder_name || "No holder recorded"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        card.status === "ACTIVE"
                          ? "border-emerald-300 text-[10px] text-emerald-700"
                          : "text-[10px]"
                      }
                    >
                      {card.status_label}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{card.form_label}</span>
                    {card.limit_amount !== null && (
                      <span className="tabular-nums">
                        {formatMoney(card.limit_amount, card.limit_currency || "USD")}
                        {card.limit_interval ? ` / ${card.limit_interval.toLowerCase()}` : ""}
                      </span>
                    )}
                    <span>
                      {card.service_count} service{card.service_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
