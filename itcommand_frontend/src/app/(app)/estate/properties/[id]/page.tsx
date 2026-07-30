"use client";

/**
 * Property detail — the stack diagram.
 *
 * The whole point of this screen is that a gap is *drawn*, not omitted. A
 * property with no TLS shows an empty TLS node with an "attach service" action;
 * a list that simply left it out would make the missing thing invisible, which
 * is how it stayed missing.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Globe,
  Plus,
  RefreshCw,
  TriangleAlert,
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
import { Skeleton } from "@/components/ui/skeleton";

import { useAddServiceDialog } from "../../add-service-context";
import { RowActions } from "../../row-actions";
import { PropertyDialog } from "../property-dialog";
import { ServiceDialog } from "../../services/service-dialog";
import {
  ConsoleLink,
  CredentialCopyButton,
  EmptyState,
  ProviderChip,
  UrgencyDot,
} from "../../estate-ui";
import {
  PropertyStack,
  Service,
  StackLayer,
  errorMessage,
  normalizeStack,
} from "../../estate-types";

function urgencyOf(days: number | null) {
  if (days === null) return "muted" as const;
  if (days < 0 || days <= 7) return "critical" as const;
  if (days <= 30) return "warning" as const;
  return "muted" as const;
}

/** One service inside a stack node. */
function ServiceBody({
  service,
  canEdit,
  canDelete,
  onEdit,
  onChanged,
}: {
  service: Service;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (service: Service) => void;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-1">
        <p className="truncate text-sm font-medium">{service.identifier}</p>
        <RowActions
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => onEdit(service)}
          deleteUrl={`/estate/services/${service.id}/`}
          deleteTitle={service.identifier}
          deleteBody="This removes it from the stack and from every spend total. Its cost stops being counted."
          onDeleted={onChanged}
        />
      </div>
      <ProviderChip
        name={service.provider_name}
        color={service.brand_color}
        slug={service.provider_slug}
      />
      <p className="truncate text-[11px] text-muted-foreground">
        {service.account_email}
      </p>
      <p className="flex items-center gap-1.5 text-[11px]">
        {service.renewal_date ? (
          <>
            <UrgencyDot severity={urgencyOf(service.days_until_renewal)} />
            <span>renews {formatDate(service.renewal_date)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">no renewal date</span>
        )}
      </p>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {formatMoney(service.cost, service.currency)} /{" "}
        {service.billing_cycle.toLowerCase()}
      </p>
      {!service.auto_renew && (
        <Badge className="border-transparent bg-amber-100 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-300">
          auto-renew off
        </Badge>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <ConsoleLink url={service.console_url} />
        <CredentialCopyButton
          credentialId={service.vault_credential}
          title={service.vault_credential_title}
          serviceId={service.id}
        />
      </div>
    </div>
  );
}

function StackNode({
  layer,
  canAdd,
  canEdit,
  canDelete,
  onAttach,
  onEditService,
  onChanged,
}: {
  layer: StackLayer;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onAttach: (serviceType: string) => void;
  onEditService: (service: Service) => void;
  onChanged: () => void;
}) {
  const filled = layer.services.length > 0;
  return (
    <div className="flex items-stretch">
      <div
        className={`w-[210px] shrink-0 rounded-lg border p-3 ${
          filled
            ? "bg-card"
            : "border-dashed border-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
        }`}
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {layer.layer_label}
        </p>
        {filled ? (
          <div className="space-y-3">
            {layer.services.map((service) => (
              <ServiceBody
                key={service.id}
                service={service}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={onEditService}
                onChanged={onChanged}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="h-3.5 w-3.5" /> Nothing here
            </p>
            {canAdd && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-xs"
                onClick={() => onAttach(layer.layer)}
              >
                <Plus className="mr-1 h-3 w-3" /> Attach service
              </Button>
            )}
          </div>
        )}
      </div>
      {/* The connector. Decorative, so hidden from assistive tech. */}
      <div className="flex w-6 items-center justify-center" aria-hidden="true">
        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
      </div>
    </div>
  );
}

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "estate", "add");
  const canEdit = can(user, "estate", "edit");
  const canDelete = can(user, "estate", "delete");
  const { open: openAddService, version } = useAddServiceDialog();

  const propertyId = Number(params?.id);
  const [stack, setStack] = useState<PropertyStack | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingProperty, setEditingProperty] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!Number.isFinite(propertyId)) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const response = await api.get<unknown>(
          `/estate/properties/${propertyId}/stack/`,
        );
        setStack(normalizeStack(response.data));
      } catch (reason) {
        toast.error(errorMessage(reason, "Failed to load that property."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [propertyId],
  );

  useEffect(() => {
    void load();
  }, [load, version]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Card>
          <CardContent className="flex gap-3 overflow-hidden pt-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-40 w-[210px] shrink-0" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stack?.property) {
    return (
      <Card>
        <CardContent className="pt-1">
          <EmptyState
            icon={Globe}
            title="That property does not exist, or you cannot see it."
            action={
              <Button variant="outline" onClick={() => router.push("/estate/properties")}>
                Back to properties
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const property = stack.property;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5"
            onClick={() => router.push("/estate/properties")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{property.name}</h2>
              <Badge variant="outline" className="text-[10px]">
                {property.kind_label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {property.owner_name || "No owner"}
              {property.department_name ? ` · ${property.department_name}` : ""}
              {" · "}
              {stack.gap_count === 0
                ? "Stack complete"
                : `${stack.gap_count} gap${stack.gap_count === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <RowActions
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={() => setEditingProperty(true)}
            deleteUrl={`/estate/properties/${property.id}/`}
            deleteTitle={property.name}
            deleteBody={
              property.service_count > 0
                ? `Its ${property.service_count} service${property.service_count === 1 ? "" : "s"} are not deleted — they become orphans and will need reassigning.`
                : "It has no services attached, so nothing else changes."
            }
            onDeleted={() => router.push("/estate/properties")}
          />
        </div>
      </div>

      <PropertyDialog
        open={editingProperty}
        onOpenChange={setEditingProperty}
        property={property}
        onSaved={() => {
          setEditingProperty(false);
          void load(true);
        }}
      />

      <ServiceDialog
        open={editingService !== null}
        onOpenChange={(next) => !next && setEditingService(null)}
        service={editingService}
        onSaved={() => {
          setEditingService(null);
          void load(true);
        }}
      />

      <Card>
        <CardContent className="pt-1">
          <p className="mb-3 text-sm font-medium">Infrastructure stack</p>
          <div className="overflow-x-auto pb-2">
            <div className="flex items-stretch">
              {stack.layers.map((layer) => (
                <StackNode
                  key={layer.layer}
                  layer={layer}
                  canAdd={canAdd}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onAttach={(serviceType) =>
                    openAddService({ property: property.id, service_type: serviceType })
                  }
                  onEditService={setEditingService}
                  onChanged={() => void load(true)}
                />
              ))}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            The order a request travels through: registrar owns the name, DNS
            answers for it, the host serves it.
          </p>
        </CardContent>
      </Card>

      {/* SaaS and anything else outside the stack, listed separately. */}
      <Card>
        <CardContent className="pt-1">
          <p className="mb-1 text-sm font-medium">Other services</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Attached to this property but holding no stack position — they are
            never counted as gaps.
          </p>
          {stack.off_stack_services.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              Nothing outside the stack.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {stack.off_stack_services.map((service) => (
                <div key={service.id} className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {service.service_type_label}
                    </Badge>
                    {service.is_at_risk && (
                      <Badge className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">
                        at risk
                      </Badge>
                    )}
                  </div>
                  <ServiceBody
                    service={service}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={setEditingService}
                    onChanged={() => void load(true)}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
