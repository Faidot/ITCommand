"use client";

/**
 * The Services master table.
 *
 * Filtering happens on the server. The alternative — fetch everything and
 * filter in the browser — is fine at twenty rows and wrong at two thousand,
 * and the endpoint already has the indexes for it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Filter,
  RefreshCw,
  Search,
  Server,
  Unlink,
  X,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useAddServiceDialog } from "../add-service-context";
import { RowActions } from "../row-actions";
import { ServiceDialog } from "./service-dialog";
import {
  ConsoleLink,
  CredentialCopyButton,
  EmptyState,
  ProviderChip,
  TableSkeleton,
  UrgencyDot,
} from "../estate-ui";
import {
  EMPTY_SERVICE_FILTERS,
  EstateProperty,
  Provider,
  Service,
  ServiceFilters,
  ServiceTypeDef,
  activeFilterCount,
  errorMessage,
  filtersToParams,
  normalizeProperty,
  normalizeProvider,
  normalizeService,
  normalizeServiceType,
  resultsOf,
} from "../estate-types";

/** Tone for a renewal date, mirroring the server's timeline urgency. */
function renewalSeverity(days: number | null, warning: number, urgent: number) {
  if (days === null) return "muted" as const;
  if (days < 0 || days <= urgent) return "critical" as const;
  if (days <= warning) return "warning" as const;
  return "muted" as const;
}

export default function EstateServicesPage() {
  const searchParams = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const canEdit = can(user, "estate", "edit");
  const canAdd = can(user, "estate", "add");
  const canDelete = can(user, "estate", "delete");
  const { open: openAddService, version } = useAddServiceDialog();

  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [properties, setProperties] = useState<EstateProperty[]>([]);
  const [types, setTypes] = useState<ServiceTypeDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Service | null>(null);

  // Seeded from the URL so the dashboard KPIs and the ⌘K palette can deep-link
  // into a filtered view.
  const [filters, setFilters] = useState<ServiceFilters>(() => ({
    ...EMPTY_SERVICE_FILTERS,
    search: searchParams.get("q") ?? "",
    expiringSoon: searchParams.get("expiring") === "1",
    orphansOnly: searchParams.get("orphans") === "1",
    autoRenewOff: searchParams.get("autorenew") === "off",
    type: searchParams.get("type") ?? "all",
  }));
  const [searchDraft, setSearchDraft] = useState(searchParams.get("q") ?? "");

  // Debounced, so typing does not fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(
      () => setFilters((current) => ({ ...current, search: searchDraft })),
      300,
    );
    return () => clearTimeout(handle);
  }, [searchDraft]);

  const loadReference = useCallback(async () => {
    const [prov, prop, cat] = await Promise.allSettled([
      api.get<unknown>("/estate/providers/?page_size=200"),
      api.get<unknown>("/estate/properties/?page_size=200"),
      api.get<unknown>("/estate/providers/layers/"),
    ]);
    if (prov.status === "fulfilled") {
      setProviders(resultsOf(prov.value.data, normalizeProvider));
    }
    if (prop.status === "fulfilled") {
      setProperties(resultsOf(prop.value.data, normalizeProperty));
    }
    if (cat.status === "fulfilled") {
      setTypes(resultsOf(cat.value.data, normalizeServiceType));
    }
  }, []);

  const loadServices = useCallback(
    async (current: ServiceFilters, silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const response = await api.get<unknown>("/estate/services/", {
          params: filtersToParams(current),
        });
        setServices(resultsOf(response.data, normalizeService));
      } catch (reason) {
        toast.error(errorMessage(reason, "Failed to load services."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadReference();
  }, [loadReference, version]);

  useEffect(() => {
    void loadServices(filters);
  }, [loadServices, filters, version]);

  const setFilter = <K extends keyof ServiceFilters>(key: K, value: ServiceFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  /**
   * Optimistic write with revert.
   *
   * The switch has to move under the finger; waiting for a round trip makes it
   * feel broken. If the PATCH fails the row goes back to what the server still
   * believes, so the UI never keeps a value the database rejected.
   */
  const patchService = async (service: Service, changes: Partial<Service>, body: object) => {
    const previous = services;
    setServices((current) =>
      current.map((row) => (row.id === service.id ? { ...row, ...changes } : row)),
    );
    setSavingIds((current) => new Set(current).add(service.id));
    try {
      const response = await api.patch<unknown>(`/estate/services/${service.id}/`, body);
      const fresh = normalizeService(
        (response.data ?? {}) as Record<string, unknown>,
      );
      setServices((current) =>
        current.map((row) => (row.id === service.id ? fresh : row)),
      );
    } catch (reason) {
      setServices(previous);
      toast.error(errorMessage(reason, "Could not save that change."));
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(service.id);
        return next;
      });
    }
  };

  const filterCount = activeFilterCount(filters);
  const warning = 30;
  const urgent = 7;

  const totalMonthly = useMemo(
    () => services.reduce((sum, service) => sum + service.monthly_equivalent, 0),
    [services],
  );
  const currencies = useMemo(
    () => new Set(services.map((service) => service.currency)),
    [services],
  );

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-1">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search identifier, provider or account"
              className="pl-8"
            />
          </div>

          <Select value={filters.type} onValueChange={(value) => setFilter("type", value)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((type) => (
                <SelectItem key={type.layer} value={type.layer}>
                  {type.layer_label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.provider}
            onValueChange={(value) => setFilter("provider", value)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={String(provider.id)}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.property}
            onValueChange={(value) => setFilter("property", value)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties.map((property) => (
                <SelectItem key={property.id} value={String(property.id)}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={filters.expiringSoon ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("expiringSoon", !filters.expiringSoon)}
          >
            Expiring soon
          </Button>
          <Button
            variant={filters.autoRenewOff ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("autoRenewOff", !filters.autoRenewOff)}
          >
            Auto-renew off
          </Button>
          <Button
            variant={filters.orphansOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("orphansOnly", !filters.orphansOnly)}
          >
            Orphans only
          </Button>

          {filterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchDraft("");
                setFilters(EMPTY_SERVICE_FILTERS);
              }}
            >
              <X className="mr-1 h-4 w-4" /> Clear {filterCount}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadServices(filters, true)}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : services.length === 0 ? (
        <Card>
          <CardContent className="pt-1">
            <EmptyState
              icon={filterCount > 0 ? Filter : Server}
              title={
                filterCount > 0
                  ? "No services match those filters."
                  : "No services yet. Add the first one and the dashboard, properties and spend charts all start working."
              }
              action={
                filterCount > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearchDraft("");
                      setFilters(EMPTY_SERVICE_FILTERS);
                    }}
                  >
                    Clear the filters
                  </Button>
                ) : canAdd ? (
                  <Button size="sm" onClick={() => openAddService()}>
                    Add a service
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Type</TableHead>
                    <TableHead>Identifier</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Renewal</TableHead>
                    <TableHead className="text-center">Auto</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Secret</TableHead>
                    <TableHead className="text-right">Console</TableHead>
                    <TableHead className="w-10 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => {
                    const severity = renewalSeverity(
                      service.days_until_renewal,
                      warning,
                      urgent,
                    );
                    const saving = savingIds.has(service.id);
                    return (
                      <TableRow key={service.id}>
                        <TableCell className="pl-4">
                          <Badge variant="outline" className="text-[10px]">
                            {service.service_type_label}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="block truncate font-medium">
                            {service.identifier}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[150px]">
                          <ProviderChip
                            name={service.provider_name}
                            color={service.brand_color}
                            slug={service.provider_slug}
                          />
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                          {service.account_email}
                        </TableCell>
                        <TableCell>
                          {/* Inline, so an orphan is cleared without leaving the
                              table — which is where you notice it. */}
                          {canEdit ? (
                            <Select
                              value={service.property ? String(service.property) : "none"}
                              onValueChange={(value) =>
                                void patchService(
                                  service,
                                  {
                                    property: value === "none" ? null : Number(value),
                                    is_orphan: value === "none",
                                  },
                                  { property: value === "none" ? null : Number(value) },
                                )
                              }
                              disabled={saving}
                            >
                              <SelectTrigger className="h-8 w-[150px] text-xs">
                                <SelectValue placeholder="Unattached" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Unattached</SelectItem>
                                {properties.map((property) => (
                                  <SelectItem key={property.id} value={String(property.id)}>
                                    {property.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : service.property_name ? (
                            <span className="text-sm">{service.property_name}</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                              <Unlink className="h-3.5 w-3.5" /> Orphan
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              service.is_at_risk
                                ? "border-red-300 text-red-700 dark:text-red-400"
                                : ""
                            }`}
                          >
                            {service.is_at_risk ? "At risk" : service.status_label}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {service.renewal_date ? (
                            <span className="flex items-center gap-1.5">
                              <UrgencyDot severity={severity} />
                              {formatDate(service.renewal_date)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Switch
                                  checked={service.auto_renew}
                                  disabled={!canEdit || saving}
                                  onCheckedChange={(checked) =>
                                    void patchService(
                                      service,
                                      { auto_renew: checked === true },
                                      { auto_renew: checked === true },
                                    )
                                  }
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {service.auto_renew
                                ? "Renews itself"
                                : "Will lapse unless someone acts"}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {formatMoney(service.cost, service.currency)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            /{service.billing_cycle.slice(0, 2).toLowerCase()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <CredentialCopyButton
                            credentialId={service.vault_credential}
                            title={service.vault_credential_title}
                            serviceId={service.id}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <ConsoleLink url={service.console_url} />
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <RowActions
                            canEdit={canEdit}
                            canDelete={canDelete}
                            onEdit={() => setEditing(service)}
                            deleteUrl={`/estate/services/${service.id}/`}
                            deleteTitle={service.identifier}
                            deleteBody={
                              service.property_name
                                ? `This removes it from ${service.property_name}'s stack and from every spend total. Its cost stops being counted.`
                                : "This removes it from every spend total. Its cost stops being counted."
                            }
                            onDeleted={() => void loadServices(filters, true)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <ServiceDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        service={editing}
        onSaved={() => {
          setEditing(null);
          void loadServices(filters, true);
        }}
      />

      {services.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {services.length} service{services.length === 1 ? "" : "s"}
          {currencies.size === 1 && (
            <>
              {" · "}
              {formatMoney(totalMonthly, services[0].currency)}/month
            </>
          )}
          {currencies.size > 1 && (
            <>
              {" · "}
              mixed currencies — see the dashboard for a converted total
            </>
          )}
        </p>
      )}
    </div>
  );
}
