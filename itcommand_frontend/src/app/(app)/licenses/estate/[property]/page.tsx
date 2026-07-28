"use client";

/**
 * Property detail — the stack, layer by layer.
 *
 * Route: `/licenses/estate/<id>`. The brief says `/software/estate/[property]`,
 * but there is no `/software` route in this app: the "Software & Subscriptions"
 * sidebar entry points at `/licenses`, and the tabbed shell lives there. Nesting
 * under `/licenses` keeps the breadcrumb honest and lets the back link return to
 * `?tab=estate`. Flagged rather than silently renamed.
 *
 * The param is the numeric id. A missing layer is rendered as an explicit empty
 * slot with an attach action — never omitted, because a row that is not there is
 * a job nobody picks up.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CircleDollarSign,
  ExternalLink,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  ServerCog,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDate, formatRelativeDays } from "@/lib/date";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { ServiceDialog } from "../service-dialog";
import { PropertyDialog } from "../property-dialog";
import {
  DigitalProperty,
  EstateService,
  LayerDef,
  MoneyBlock,
  moneyLabel,
  normalizeAccount,
  normalizeLayer,
  normalizeMoney,
  normalizeProperty,
  normalizeProvider,
  normalizeStack,
  PropertyStack,
  Provider,
  ProviderAccount,
  resultsOf,
  SEVERITY_BADGE,
  Severity,
  unconvertedSummary,
} from "../estate-types";

const URGENCY_DOT: Record<Severity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  ok: "bg-emerald-500",
  muted: "bg-muted-foreground/40",
};

function errorMessage(reason: unknown, fallback: string): string {
  const detail = (reason as { response?: { data?: { detail?: unknown } } })?.response?.data
    ?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

function ServiceRow({ service }: { service: EstateService }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(`/subscriptions/${service.id}`)}
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{service.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {service.identifier || "No identifier"}
          {service.provider_name ? ` · ${service.provider_name}` : ""}
          {service.account_login ? ` · ${service.account_login}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">
          {formatMoney(service.cost, service.currency)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {service.billing_cycle === "MONTHLY" ? "per month" : "per year"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${URGENCY_DOT[service.urgency]}`} />
          {formatDate(service.expiry_date)}
          <span className="text-muted-foreground">
            ({formatRelativeDays(service.expiry_date)})
          </span>
        </span>
        {service.auto_renew ? (
          <Badge className={`text-[10px] ${SEVERITY_BADGE.ok}`}>auto</Badge>
        ) : (
          <Badge className={`text-[10px] ${SEVERITY_BADGE.critical}`}>
            <Unplug className="mr-1 h-3 w-3" /> manual
          </Badge>
        )}
      </div>
    </button>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-4">
      <Skeleton className="h-8 w-52" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "subscriptions", "add");
  const canEdit = can(user, "subscriptions", "edit");

  const propertyId = useMemo(() => {
    const raw = Array.isArray(params?.property) ? params.property[0] : params?.property;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [params]);

  const [stack, setStack] = useState<PropertyStack | null>(null);
  const [spend, setSpend] = useState<MoneyBlock | null>(null);
  const [layers, setLayers] = useState<LayerDef[]>([]);
  const [properties, setProperties] = useState<DigitalProperty[]>([]);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [users, setUsers] = useState<{ id: number; full_name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [serviceSeed, setServiceSeed] = useState<{ propertyId?: number; layer?: string; serviceId?: number } | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadData = useCallback(
    async (silent = false) => {
      if (!propertyId) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (silent) setRefreshing(true);
      else setLoading(true);

      const [stackResult, cardsResult, layersResult, propertiesResult, accountsResult, providersResult, usersResult, departmentsResult] =
        await Promise.allSettled([
          api.get<unknown>(`/estate/properties/${propertyId}/stack/`),
          api.get<unknown>("/estate/properties/stacks/"),
          api.get<unknown>("/estate/providers/layers/"),
          api.get<unknown>("/estate/properties/?page_size=200"),
          api.get<unknown>("/estate/accounts/?page_size=200"),
          api.get<unknown>("/estate/providers/?page_size=200"),
          api.get<unknown>("/users/?page_size=200"),
          api.get<unknown>("/departments/?page_size=200"),
        ]);

      if (stackResult.status === "fulfilled") {
        setStack(normalizeStack(stackResult.value.data));
        setNotFound(false);
      } else {
        setNotFound(true);
        toast.error(errorMessage(stackResult.reason, "That property could not be loaded."));
      }

      // The per-property converted spend lives on the cards endpoint, so it is
      // read from there rather than adding a second aggregation endpoint.
      if (cardsResult.status === "fulfilled") {
        const rows = resultsOf(cardsResult.value.data, (row) => row);
        const match = rows.find((row) => Number(row.id) === propertyId);
        setSpend(match ? normalizeMoney(match.spend) : null);
      }

      if (layersResult.status === "fulfilled") {
        setLayers(resultsOf(layersResult.value.data, normalizeLayer));
      }
      if (propertiesResult.status === "fulfilled") {
        setProperties(resultsOf(propertiesResult.value.data, normalizeProperty));
      }
      if (accountsResult.status === "fulfilled") {
        setAccounts(resultsOf(accountsResult.value.data, normalizeAccount));
      }
      if (providersResult.status === "fulfilled") {
        setProviders(resultsOf(providersResult.value.data, normalizeProvider));
      }
      if (usersResult.status === "fulfilled") {
        setUsers(
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
    },
    [propertyId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openAttach = (layer?: string) => {
    setServiceSeed({ propertyId: propertyId ?? undefined, layer });
    setServiceOpen(true);
  };

  if (loading) return <DetailSkeleton />;

  if (notFound || !stack?.property) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Layers className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
        <p className="font-medium">That property does not exist, or you cannot see it.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push("/licenses?tab=estate")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to the estate
        </Button>
      </div>
    );
  }

  const property = stack.property;
  const excluded = spend ? unconvertedSummary(spend) : null;
  const serviceTotal = stack.layers.reduce((sum, layer) => sum + layer.service_count, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 h-7 text-muted-foreground"
            onClick={() => router.push("/licenses?tab=estate")}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Estate
          </Button>
          <h1 className="truncate text-2xl font-bold tracking-tight">{property.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{property.kind_label}</Badge>
            <span className="text-sm text-muted-foreground">
              {property.owner_name || "No owner"}
              {property.department_name ? ` · ${property.department_name}` : ""}
            </span>
            {!property.is_active && <Badge variant="secondary">Retired</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
          {canAdd && (
            <Button size="sm" onClick={() => openAttach()}>
              <Plus className="mr-2 h-4 w-4" /> Attach service
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3 pt-1">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {spend ? moneyLabel(spend, "cost") : "Monthly cost"}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {spend ? formatMoney(spend.monthly, spend.currency) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">per month</p>
            </div>
            <div className="rounded-xl bg-violet-100 p-2.5 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              <CircleDollarSign className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 pt-1">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Services</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{serviceTotal}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                across {stack.layers.filter((layer) => layer.configured).length} layers
              </p>
            </div>
            <div className="rounded-xl bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <ServerCog className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 pt-1">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Stack gaps</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{stack.gap_count}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {stack.gap_count === 0 ? "nothing missing" : "required layers with nothing in them"}
              </p>
            </div>
            <div
              className={`rounded-xl p-2.5 ${
                stack.gap_count > 0
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              }`}
            >
              <Layers className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {excluded && (
        <Card className="border-amber-300 dark:border-amber-900">
          <CardContent className="flex items-start gap-2 pt-1 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {excluded}{" "}
              <span className="text-muted-foreground">
                The monthly figure above excludes it. Add a rate in Settings → Integrations.
              </span>
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> The stack
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            In request order — registrar first. Empty required layers are shown, not hidden.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {stack.layers.map((layer) => (
            <div key={layer.layer} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{layer.layer_label}</span>
                  {layer.is_gap && (
                    <Badge className={`text-[10px] ${SEVERITY_BADGE.warning}`}>missing</Badge>
                  )}
                  {!layer.is_required && !layer.configured && (
                    <span className="text-[11px] text-muted-foreground">optional</span>
                  )}
                  {layer.service_count > 1 && (
                    <Badge variant="outline" className="text-[10px]">
                      {layer.service_count} services
                    </Badge>
                  )}
                </div>
                {canAdd && !layer.configured && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => openAttach(layer.layer)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Attach service
                  </Button>
                )}
              </div>

              {layer.configured ? (
                <div className="space-y-2">
                  {layer.services.map((service) => (
                    <ServiceRow key={service.id} service={service} />
                  ))}
                </div>
              ) : (
                // An explicit empty slot. Omitting it would hide the job.
                <div
                  className={`rounded-lg border border-dashed px-3 py-3 text-center text-xs ${
                    layer.is_gap
                      ? "border-amber-400 text-amber-700 dark:text-amber-400"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {layer.is_gap
                    ? `Nothing provides ${layer.layer_label} for this property.`
                    : `No ${layer.layer_label} tracked. That is fine unless you expect one.`}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {stack.unassigned_count > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> Not placed in the stack
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              On this property but with no layer set, so they are missing from the strip above.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {stack.unassigned_services.map((service) => (
              <ServiceRow key={service.id} service={service} />
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Costs and renewals are the same records as the Subscriptions tab —{" "}
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => router.push("/licenses?tab=subscriptions")}
        >
          open it there <ExternalLink className="inline h-3 w-3" />
        </button>
      </p>

      <ServiceDialog
        open={serviceOpen}
        onOpenChange={setServiceOpen}
        seed={serviceSeed}
        layers={layers}
        properties={properties}
        accounts={accounts}
        providers={providers}
        onSaved={() => {
          setServiceOpen(false);
          void loadData(true);
        }}
      />
      <PropertyDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        property={property}
        users={users}
        departments={departments}
        onSaved={() => {
          setEditOpen(false);
          void loadData(true);
        }}
      />
    </div>
  );
}
