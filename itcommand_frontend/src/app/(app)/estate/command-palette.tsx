"use client";

/**
 * ⌘K for the Digital Estate.
 *
 * Jump to a property, account or service; run "Add service"; filter to
 * expiring soon. Data is fetched once when the palette first opens and cached
 * for the session — opening a palette should never be the slow part.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, KeyRound, Plus, Search, Server, Timer } from "lucide-react";

import api from "@/lib/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

import {
  EstateProperty,
  ProviderAccount,
  Service,
  normalizeAccount,
  normalizeProperty,
  normalizeService,
  resultsOf,
} from "./estate-types";

export function EstateCommandPalette({
  onAddService,
}: {
  onAddService?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState<EstateProperty[]>([]);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
      // cmdk closes on Escape itself, but only while its input has focus.
      // Binding it here means Escape works wherever the focus happens to be.
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void (async () => {
      const [props, accts, svcs] = await Promise.allSettled([
        api.get<unknown>("/estate/properties/?page_size=200"),
        api.get<unknown>("/estate/accounts/?page_size=200"),
        api.get<unknown>("/estate/services/?page_size=200"),
      ]);
      if (props.status === "fulfilled") {
        setProperties(resultsOf(props.value.data, normalizeProperty));
      }
      if (accts.status === "fulfilled") {
        setAccounts(resultsOf(accts.value.data, normalizeAccount));
      }
      if (svcs.status === "fulfilled") {
        setServices(resultsOf(svcs.value.data, normalizeService));
      }
    })();
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a property, account or service…" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>

        <CommandGroup heading="Actions">
          {onAddService && (
            <CommandItem
              onSelect={() => {
                setOpen(false);
                onAddService();
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add service
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/estate/services?expiring=1")}>
            <Timer className="mr-2 h-4 w-4" /> Show services expiring soon
          </CommandItem>
          <CommandItem onSelect={() => go("/estate/services?orphans=1")}>
            <Search className="mr-2 h-4 w-4" /> Show orphaned services
          </CommandItem>
          <CommandItem onSelect={() => go("/estate/accounts?mfa=missing")}>
            <KeyRound className="mr-2 h-4 w-4" /> Show accounts missing MFA
          </CommandItem>
        </CommandGroup>

        {properties.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Properties">
              {properties.map((property) => (
                <CommandItem
                  key={`property-${property.id}`}
                  value={`property ${property.name} ${property.kind_label}`}
                  onSelect={() => go(`/estate/properties/${property.id}`)}
                >
                  <Globe className="mr-2 h-4 w-4" />
                  <span className="truncate">{property.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {property.kind_label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {accounts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Accounts">
              {accounts.map((account) => (
                <CommandItem
                  key={`account-${account.id}`}
                  value={`account ${account.account_email} ${account.provider_name}`}
                  onSelect={() =>
                    go(`/estate/accounts?q=${encodeURIComponent(account.account_email)}`)
                  }
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  <span className="truncate">{account.account_email}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {account.provider_name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {services.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Services">
              {services.map((service) => (
                <CommandItem
                  key={`service-${service.id}`}
                  value={`service ${service.identifier} ${service.provider_name} ${service.service_type_label}`}
                  onSelect={() =>
                    go(`/estate/services?q=${encodeURIComponent(service.identifier)}`)
                  }
                >
                  <Server className="mr-2 h-4 w-4" />
                  <span className="truncate">{service.identifier}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {service.service_type_label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export default EstateCommandPalette;
