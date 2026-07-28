"use client";

/**
 * Settings → Integrations → Exchange rates.
 *
 * This closes a loop that was previously open: the Subscriptions and Estate
 * pages both tell a user that a currency has no rate and to "add one in
 * Settings → Integrations", and until now there was nothing there to add it
 * with. Every currency actually in use is listed with what it is costing, so
 * the size of the gap is visible next to the fix for it.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Coins, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDate, todayInputValue } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CurrencyStatus {
  currency: string;
  has_rate: boolean;
  rate: string | null;
  is_base: boolean;
  subscription_count: number;
  contract_count: number;
  monthly_spend: string;
}

interface StatusPayload {
  base_currency: string;
  rates_as_of: string | null;
  currencies: CurrencyStatus[];
  missing_count: number;
  missing_currencies: string[];
  is_complete: boolean;
}

interface StoredRate {
  id: number;
  base_currency: string;
  currency: string;
  rate: string;
  as_of: string;
  source: string;
}

function errorMessage(reason: unknown, fallback: string): string {
  const data = (reason as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object") {
    for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") {
        return field === "detail" || field === "non_field_errors" ? first : `${field}: ${first}`;
      }
    }
  }
  return fallback;
}

export function ExchangeRatesPanel() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [rates, setRates] = useState<StoredRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ currency: "", rate: "", as_of: todayInputValue() });

  const load = useCallback(async () => {
    const [statusResult, ratesResult] = await Promise.allSettled([
      api.get<StatusPayload>("/exchange-rates/status/"),
      api.get<{ results?: StoredRate[] }>("/exchange-rates/?page_size=100"),
    ]);
    if (statusResult.status === "fulfilled") setStatus(statusResult.value.data);
    else toast.error("Could not load the currency status.");
    if (ratesResult.status === "fulfilled") {
      const data = ratesResult.value.data;
      setRates(Array.isArray(data) ? data : data?.results ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRate = async (currency: string, rate: string, asOf: string) => {
    if (!currency.trim()) {
      toast.error("Choose a currency.");
      return;
    }
    const numeric = Number(rate);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error("A rate must be a number greater than zero.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/exchange-rates/", {
        base_currency: status?.base_currency,
        currency: currency.trim().toUpperCase(),
        rate: rate.trim(),
        as_of: asOf || todayInputValue(),
      });
      toast.success(`Rate saved for ${currency.toUpperCase()}`);
      setDraft({ currency: "", rate: "", as_of: todayInputValue() });
      await load();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save the rate."));
    } finally {
      setBusy(false);
    }
  };

  const removeRate = async (rate: StoredRate) => {
    if (!window.confirm(`Delete the ${rate.currency} rate from ${rate.as_of}?`)) return;
    setBusy(true);
    try {
      await api.delete(`/exchange-rates/${rate.id}/`);
      toast.success("Rate deleted");
      await load();
    } catch {
      toast.error("Could not delete the rate.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton className="h-72 w-full" />;
  if (!status) return null;

  const missing = status.currencies.filter((row) => !row.has_rate);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Coins className="h-4 w-4" /> Exchange rates
          {status.is_complete ? (
            <Badge variant="outline" className="border-emerald-300 text-emerald-700">
              Every currency converts
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              {status.missing_count} missing
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Totals are reported in <strong>{status.base_currency}</strong>. A currency with
          no rate is never guessed at 1:1 — it is excluded from totals and reported
          separately, which is why a missing rate makes spend figures read as partial.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {missing.length > 0 && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              {missing.length} currenc{missing.length === 1 ? "y is" : "ies are"} in use with
              no rate
            </p>
            {missing.map((row) => (
              <MissingRateRow
                key={row.currency}
                row={row}
                base={status.base_currency}
                busy={busy}
                onSave={(rate) => void saveRate(row.currency, rate, todayInputValue())}
              />
            ))}
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Currencies in use
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead>Converts</TableHead>
                  <TableHead className="text-right">Monthly spend</TableHead>
                  <TableHead className="text-right">Used by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.currencies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                      No currencies in use yet. They appear here once a subscription or
                      vendor contract uses one.
                    </TableCell>
                  </TableRow>
                ) : (
                  status.currencies.map((row) => (
                    <TableRow key={row.currency}>
                      <TableCell className="font-medium">
                        {row.currency}
                        {row.is_base && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            base
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.has_rate ? (
                          <span className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                            <Check className="h-3.5 w-3.5" />
                            {row.is_base ? "1:1" : row.rate}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> no rate
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(Number(row.monthly_spend), row.currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {row.subscription_count} sub
                        {row.subscription_count === 1 ? "" : "s"}
                        {row.contract_count > 0 && `, ${row.contract_count} contract`}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add or correct a rate
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="fx-currency" className="text-xs">
                Currency
              </Label>
              <Input
                id="fx-currency"
                maxLength={3}
                value={draft.currency}
                onChange={(event) =>
                  setDraft({ ...draft, currency: event.target.value.toUpperCase() })
                }
                placeholder="USD"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fx-rate" className="text-xs">
                1 unit = ? {status.base_currency}
              </Label>
              <Input
                id="fx-rate"
                inputMode="decimal"
                value={draft.rate}
                onChange={(event) => setDraft({ ...draft, rate: event.target.value })}
                placeholder="280.00"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fx-date" className="text-xs">
                As of
              </Label>
              <Input
                id="fx-date"
                type="date"
                value={draft.as_of}
                onChange={(event) => setDraft({ ...draft, as_of: event.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button
                disabled={busy}
                onClick={() => void saveRate(draft.currency, draft.rate, draft.as_of)}
              >
                <Plus className="mr-2 h-4 w-4" /> Save
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Rates are stored per day, so a historic report keeps the rate it was run with.
            Saving twice for the same day corrects it rather than adding a second.
          </p>
        </div>

        {rates.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Stored rates
              </p>
              <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pair</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>As of</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((rate) => (
                    <TableRow key={rate.id}>
                      <TableCell className="font-medium">
                        1 {rate.currency} → {rate.base_currency}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(rate.rate).toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(rate.as_of)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {rate.source === "MANUAL" ? "manual" : "fetched"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-600"
                          disabled={busy}
                          onClick={() => void removeRate(rate)}
                          aria-label={`Delete the ${rate.currency} rate`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Inline fix for one missing currency, right where the problem is reported. */
function MissingRateRow({
  row,
  base,
  busy,
  onSave,
}: {
  row: CurrencyStatus;
  base: string;
  busy: boolean;
  onSave: (rate: string) => void;
}) {
  const [rate, setRate] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md bg-background/60 p-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{row.currency}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatMoney(Number(row.monthly_spend), row.currency)} / month excluded from
          totals
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`fx-inline-${row.currency}`} className="text-[11px]">
          1 {row.currency} = ? {base}
        </Label>
        <Input
          id={`fx-inline-${row.currency}`}
          inputMode="decimal"
          className="h-8 w-32"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          placeholder="280.00"
        />
      </div>
      <Button size="sm" disabled={busy || !rate} onClick={() => onSave(rate)}>
        Save
      </Button>
    </div>
  );
}

export default ExchangeRatesPanel;
