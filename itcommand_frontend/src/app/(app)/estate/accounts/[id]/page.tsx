"use client";

/**
 * One provider account, in full.
 *
 * The account is the bill and the console; everything on this page hangs off
 * it. The order is deliberate — people first, because "who can get into this"
 * is the question the estate exists to answer and the one that goes stale
 * fastest, then what it pays for, then the machines it runs.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, HardDrive, KeyRound, Pencil, ShieldAlert, ShieldCheck, Users,
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
import { Skeleton } from "@/components/ui/skeleton";

import { AccountDialog } from "../account-dialog";
import { PeopleManager } from "../people-sheet";
import {
  EstateServer,
  ProviderAccount,
  Service,
  errorMessage,
  normalizeAccount,
  normalizeServer,
  normalizeService,
  resultsOf,
} from "../../estate-types";
import { ConsoleLink, MfaBadge } from "../../estate-ui";

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const user = useAuthStore((state) => state.user);
  const canEdit = can(user, "estate", "add");

  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [servers, setServers] = useState<EstateServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, s, v] = await Promise.all([
        api.get<Record<string, unknown>>(`/estate/accounts/${id}/`),
        api.get<unknown>("/estate/services/", { params: { provider_account: id, page_size: 200 } }),
        api.get<unknown>("/estate/servers/", { params: { account: id, page_size: 200 } }),
      ]);
      setAccount(normalizeAccount(a.data));
      setServices(resultsOf(s.data, normalizeService));
      setServers(resultsOf(v.data, normalizeServer));
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not load that account."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!account) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          That account no longer exists.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/estate/accounts")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: account.brand_color || "#94a3b8" }}
              />
              <h1 className="text-xl font-semibold">{account.provider_name}</h1>
              <Badge variant="outline" className="text-[10px]">
                {account.login_kind_label}
              </Badge>
              {!account.is_active && (
                <Badge variant="outline" className="text-[10px]">inactive</Badge>
              )}
            </div>
            <code className="text-sm text-muted-foreground">{account.account_email}</code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConsoleLink url={account.effective_console_url} />
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit account
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Second factor"
          value={<MfaBadge label={account.mfa_type_label} severity={account.mfa_severity} />}
          hint={
            account.people_count > 0
              ? "the weakest login on this account"
              : "recorded on the account"
          }
        />
        <Stat label="People with access" value={String(account.people_count)}
              hint={`${account.privileged_count} can change things`} />
        <Stat label="Services" value={String(services.length)} hint="billed through this account" />
        <Stat label="Servers" value={String(servers.length)} hint="paid for by this account" />
      </div>

      {account.people_without_mfa > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p>
            <strong>{account.people_without_mfa}</strong> of the{" "}
            {account.people_count} people on this account{" "}
            {account.people_without_mfa === 1 ? "has" : "have"} no second factor.
            The account is only as protected as its softest way in.
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Who can sign in
            {account.people_count > 0 && account.people_without_mfa === 0 && (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PeopleManager
            account={account}
            active
            canEdit={canEdit}
            onChanged={() => void load()}
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> What it pays for
            </CardTitle>
          </CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is bought through this account yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {services.map((service) => (
                  <div key={service.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <Badge variant="outline" className="text-[10px]">
                      {service.service_type_label}
                    </Badge>
                    <span className="font-medium">{service.identifier}</span>
                    <span className="text-muted-foreground">
                      {service.property_name ?? "unattached"}
                    </span>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {formatMoney(service.cost, service.currency)}
                    </span>
                    {service.renewal_date && (
                      <span className="w-full text-xs text-muted-foreground">
                        renews {formatDate(service.renewal_date)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4" /> Servers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {servers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No servers are recorded under this account.
              </p>
            ) : (
              <div className="space-y-1.5">
                {servers.map((server) => (
                  <Link
                    key={server.id}
                    href={`/estate/servers/${server.id}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-1 py-0.5 text-sm hover:bg-muted"
                  >
                    <span className="font-medium">{server.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {server.environment_label}
                    </Badge>
                    {server.public_ip && (
                      <code className="text-xs text-muted-foreground">{server.public_ip}</code>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {server.property_name ?? "unattached"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {account.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{account.notes}</p>
          </CardContent>
        </Card>
      )}

      <AccountDialog
        open={editing}
        onOpenChange={setEditing}
        account={account}
        onSaved={() => { setEditing(false); void load(); }}
      />
    </div>
  );
}

function Stat({
  label, value, hint,
}: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-1 text-lg font-semibold">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
