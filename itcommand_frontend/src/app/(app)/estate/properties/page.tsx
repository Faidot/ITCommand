"use client";

/**
 * Properties — a card grid, one per thing we own.
 *
 * The layer strip is the centrepiece: eight domains in a row, and the one with
 * no TLS is obvious without reading a number.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Plus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { PropertyDialog } from "./property-dialog";
import { useAddServiceDialog } from "../add-service-context";
import { CardGridSkeleton, EmptyState } from "../estate-ui";
import {
  EstateProperty,
  ServiceTypeDef,
  errorMessage,
  normalizeProperty,
  normalizeServiceType,
  resultsOf,
} from "../estate-types";

interface PropertyCard extends EstateProperty {
  configured: Set<string>;
  monthly: number;
  currency: string;
}

/**
 * One chip per stack role, in order. Filled when a service is bound, dashed
 * outline when the slot is empty.
 */
function LayerStrip({
  types,
  configured,
}: {
  types: ServiceTypeDef[];
  configured: Set<string>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {types
        .filter((type) => type.is_tracked)
        .map((type) => {
          const present = configured.has(type.layer);
          return (
            <Tooltip key={type.layer}>
              <TooltipTrigger asChild>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                    present
                      ? "border-transparent bg-primary/10 text-primary"
                      : "border-dashed border-amber-400 bg-transparent text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {type.layer_label}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {present ? `${type.layer_label} is covered` : `No ${type.layer_label}`}
              </TooltipContent>
            </Tooltip>
          );
        })}
    </div>
  );
}

export default function EstatePropertiesPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "estate", "add");
  const { version } = useAddServiceDialog();

  const [cards, setCards] = useState<PropertyCard[]>([]);
  const [types, setTypes] = useState<ServiceTypeDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [propsRes, catRes, servicesRes] = await Promise.all([
        api.get<unknown>("/estate/properties/?page_size=200"),
        api.get<unknown>("/estate/providers/layers/"),
        api.get<unknown>("/estate/services/?page_size=200"),
      ]);

      const properties = resultsOf(propsRes.data, normalizeProperty);
      const catalog = resultsOf(catRes.data, normalizeServiceType);
      const services = resultsOf(servicesRes.data, (row) => ({
        property: row.property === null ? null : Number(row.property),
        service_type: String(row.service_type ?? ""),
        status: String(row.status ?? "ACTIVE"),
        monthly: Number(row.monthly_equivalent ?? 0),
        currency: String(row.currency ?? "PKR"),
      }));

      // One pass over services rather than a request per card.
      const byProperty = new Map<number, { configured: Set<string>; monthly: number; currency: string }>();
      for (const service of services) {
        if (service.property === null) continue;
        if (service.status === "CANCELLED" || service.status === "EXPIRED") continue;
        const entry =
          byProperty.get(service.property) ??
          { configured: new Set<string>(), monthly: 0, currency: service.currency };
        entry.configured.add(service.service_type);
        entry.monthly += Number.isFinite(service.monthly) ? service.monthly : 0;
        byProperty.set(service.property, entry);
      }

      setTypes(catalog);
      setCards(
        properties.map((property) => {
          const entry = byProperty.get(property.id);
          return {
            ...property,
            configured: entry?.configured ?? new Set<string>(),
            monthly: entry?.monthly ?? 0,
            currency: entry?.currency ?? "PKR",
          };
        }),
      );
    } catch (reason) {
      toast.error(errorMessage(reason, "Failed to load properties."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const trackedCount = types.filter((type) => type.is_tracked).length;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter(
      (card) =>
        card.name.toLowerCase().includes(needle) ||
        card.kind_label.toLowerCase().includes(needle) ||
        card.owner_name.toLowerCase().includes(needle),
    );
  }, [cards, search]);

  const dialog = (
    <PropertyDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      property={null}
      onSaved={() => {
        setDialogOpen(false);
        void load(true);
      }}
    />
  );

  if (loading) return <CardGridSkeleton />;

  if (cards.length === 0) {
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="pt-1">
            <EmptyState
              icon={Globe}
              title="No properties yet. Add a domain, app or site, then attach the services that keep it running."
              action={
                canAdd ? (
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Add property
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
        {dialog}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-1">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, kind or owner"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {canAdd && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add property
            </Button>
          )}
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="pt-1">
            <EmptyState
              icon={Search}
              title="No properties match that search."
              action={
                <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                  Clear the search
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((card) => {
            const gaps = trackedCount - card.configured.size;
            const gapCount = Math.max(0, gaps);
            return (
              <Card
                key={card.id}
                className="cursor-pointer transition-colors hover:border-primary/40"
                onClick={() => router.push(`/estate/properties/${card.id}`)}
              >
                <CardContent className="space-y-3 pt-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{card.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {card.owner_name || "No owner"}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {card.kind_label}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="tabular-nums">
                      {formatMoney(card.monthly, card.currency)}
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {card.service_count} service
                      {card.service_count === 1 ? "" : "s"}
                    </span>
                    {gapCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        {gapCount} gap{gapCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  <LayerStrip types={types} configured={card.configured} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {dialog}
    </div>
  );
}
