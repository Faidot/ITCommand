"use client";

/**
 * Provider accounts.
 *
 * The MFA column is why this screen exists. An account with no second factor
 * holding production infrastructure is the single most useful thing here, so it
 * sorts to the top, is counted in a banner, and is coloured from the severity
 * the API returns — never from a client-side guess about what "SMS" means.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  UserX,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { AccountDialog } from "./account-dialog";
import { PeopleSheet } from "./people-sheet";
import { RowActions } from "../row-actions";
import { useAddServiceDialog } from "../add-service-context";
import {
  ConsoleLink,
  EmptyState,
  MfaBadge,
  ProviderChip,
  TableSkeleton,
  VaultLink,
} from "../estate-ui";
import {
  ProviderAccount,
  Service,
  errorMessage,
  normalizeAccount,
  normalizeService,
  resultsOf,
} from "../estate-types";

/** Worst first: the table should open on the thing that needs doing. */
const MFA_RANK: Record<string, number> = {
  NONE: 0,
  UNKNOWN: 1,
  SMS: 2,
  APP: 3,
  SECURITY_KEY: 4,
};

export default function EstateAccountsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "estate", "add");
  const canEdit = can(user, "estate", "edit");
  const canDelete = can(user, "estate", "delete");
  const { version } = useAddServiceDialog();

  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [mfaFilter, setMfaFilter] = useState(
    searchParams.get("mfa") === "missing" ? "missing" : "all",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderAccount | null>(null);
  //: Which account's people panel is open. Null closes it.
  const [peopleFor, setPeopleFor] = useState<ProviderAccount | null>(null);

  // Services per account, fetched only when a row is expanded.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [servicesByAccount, setServicesByAccount] = useState<
    Record<number, Service[] | "loading">
  >({});

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await api.get<unknown>("/estate/accounts/?page_size=200");
      setAccounts(resultsOf(response.data, normalizeAccount));
    } catch (reason) {
      toast.error(errorMessage(reason, "Failed to load provider accounts."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const toggleRow = async (account: ProviderAccount) => {
    const next = new Set(expanded);
    if (next.has(account.id)) {
      next.delete(account.id);
      setExpanded(next);
      return;
    }
    next.add(account.id);
    setExpanded(next);

    if (servicesByAccount[account.id] !== undefined) return;
    setServicesByAccount((current) => ({ ...current, [account.id]: "loading" }));
    try {
      const response = await api.get<unknown>("/estate/services/", {
        params: { provider_account: account.id, page_size: 200 },
      });
      setServicesByAccount((current) => ({
        ...current,
        [account.id]: resultsOf(response.data, normalizeService),
      }));
    } catch {
      setServicesByAccount((current) => ({ ...current, [account.id]: [] }));
      toast.error("Could not load the services on that account.");
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return accounts
      .filter((account) => {
        if (mfaFilter === "missing" && account.has_mfa) return false;
        if (mfaFilter === "weak" && account.mfa_type !== "SMS") return false;
        if (mfaFilter === "unowned" && account.owner !== null) return false;
        if (!needle) return true;
        return (
          account.account_email.toLowerCase().includes(needle) ||
          account.provider_name.toLowerCase().includes(needle) ||
          account.owner_name.toLowerCase().includes(needle)
        );
      })
      .sort(
        (left, right) =>
          (MFA_RANK[left.mfa_type] ?? 9) - (MFA_RANK[right.mfa_type] ?? 9) ||
          left.provider_name.localeCompare(right.provider_name),
      );
  }, [accounts, search, mfaFilter]);

  const unprotected = accounts.filter((a) => a.mfa_type === "NONE").length;
  const unverified = accounts.filter((a) => a.mfa_type === "UNKNOWN").length;

  const dialog = (
    <>
      <AccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editing}
        onSaved={() => {
          setDialogOpen(false);
          setEditing(null);
          void load(true);
        }}
      />
      <PeopleSheet
        account={peopleFor}
        open={peopleFor !== null}
        onOpenChange={(next) => { if (!next) setPeopleFor(null); }}
        canEdit={canAdd}
        // The account's MFA badge is rolled up from its people, so a change
        // here changes the row behind the dialog too.
        onChanged={() => void load(true)}
      />
    </>
  );

  if (loading) return <TableSkeleton rows={6} />;

  if (accounts.length === 0) {
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="pt-1">
            <EmptyState
              icon={KeyRound}
              title="No provider accounts yet. Add the logins you hold at AWS, Cloudflare and the rest so services can be traced back to a person."
              action={
                canAdd ? (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add account
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
      {unprotected > 0 && (
        <Card className="border-red-300 dark:border-red-900">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm font-medium">
                  {unprotected} account{unprotected === 1 ? "" : "s"} with no second
                  factor
                  {unverified > 0 && `, ${unverified} never checked`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Anyone with the password owns every service bought through it.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setMfaFilter("missing")}>
              Show them
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-1">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search login, provider or owner"
              className="pl-8"
            />
          </div>
          <Select value={mfaFilter} onValueChange={setMfaFilter}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              <SelectItem value="missing">Missing MFA</SelectItem>
              <SelectItem value="weak">SMS only</SelectItem>
              <SelectItem value="unowned">No owner</SelectItem>
            </SelectContent>
          </Select>
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
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add account
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pl-4" />
                  <TableHead>Provider</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Sign-in</TableHead>
                  <TableHead>MFA</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Services</TableHead>
                  <TableHead>Vault</TableHead>
                  <TableHead className="pr-4 text-right">Console</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-32 text-center">
                      <ShieldCheck className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
                      <p className="font-medium">No accounts match</p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          setSearch("");
                          setMfaFilter("all");
                        }}
                      >
                        Clear the search and filter
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((account) => {
                    const isOpen = expanded.has(account.id);
                    const rows = servicesByAccount[account.id];
                    return (
                      <Fragment key={account.id}>
                        <TableRow className="cursor-pointer">
                          <TableCell
                            className="pl-4"
                            onClick={() => void toggleRow(account)}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell
                            onClick={(event) => {
                              // The chevron still expands services in place;
                              // the name goes to the account's own page.
                              event.stopPropagation();
                              router.push(`/estate/accounts/${account.id}`);
                            }}
                            className="cursor-pointer hover:underline"
                          >
                            <span className="flex items-center gap-2">
                              <ProviderChip
                                name={account.provider_name}
                                color={account.brand_color}
                                slug={account.provider_slug}
                              />
                              {!account.is_active && (
                                <Badge variant="outline" className="text-[10px]">
                                  inactive
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell
                            className="max-w-[220px] truncate text-sm"
                            onClick={() => void toggleRow(account)}
                          >
                            {account.account_email}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {account.auth_type_label}
                          </TableCell>
                          <TableCell>
                            <MfaBadge
                              label={account.mfa_type_label}
                              severity={account.mfa_severity}
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={(event) => {
                                // The row's own click expands services; this
                                // opens a dialog, so it must not do both.
                                event.stopPropagation();
                                setPeopleFor(account);
                              }}
                              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm hover:bg-muted"
                              title="Who can sign in to this account"
                            >
                              <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="tabular-nums">{account.people_count}</span>
                              {account.people_without_mfa > 0 && (
                                <Badge className="border-transparent bg-red-100 px-1.5 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">
                                  {account.people_without_mfa} no MFA
                                </Badge>
                              )}
                            </button>
                          </TableCell>
                          <TableCell className="text-sm">
                            {account.owner_name || (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <UserX className="h-3.5 w-3.5" /> Unassigned
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {account.service_count}
                          </TableCell>
                          <TableCell className="text-sm">
                            <VaultLink title={account.vault_credential_title} />
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            <span className="flex items-center justify-end gap-2">
                              <ConsoleLink url={account.effective_console_url} />
                              <RowActions
                                canEdit={canEdit}
                                canDelete={canDelete}
                                onEdit={() => {
                                  setEditing(account);
                                  setDialogOpen(true);
                                }}
                                deleteUrl={`/estate/accounts/${account.id}/`}
                                deleteTitle={account.account_email}
                                deleteBody={
                                  account.service_count > 0
                                    ? `${account.service_count} service${account.service_count === 1 ? " is" : "s are"} bought through this login, so the server will refuse. Move them to another account first, or mark this one inactive.`
                                    : "Nothing is bought through this login, so nothing else changes."
                                }
                                onDeleted={() => void load(true)}
                              />
                            </span>
                          </TableCell>
                        </TableRow>

                        {isOpen && (
                          <TableRow className="bg-muted/40">
                            <TableCell colSpan={10} className="px-4 py-3">
                              {rows === "loading" ? (
                                <p className="text-sm text-muted-foreground">
                                  Loading services…
                                </p>
                              ) : !rows || rows.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Nothing is bought through this account yet.
                                </p>
                              ) : (
                                <div className="space-y-1.5">
                                  {rows.map((service) => (
                                    <div
                                      key={service.id}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                                    >
                                      <Badge
                                        variant="outline"
                                        className="text-[10px]"
                                      >
                                        {service.service_type_label}
                                      </Badge>
                                      <span className="font-medium">
                                        {service.identifier}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {service.property_name ?? "Unattached"}
                                      </span>
                                      <span className="tabular-nums text-muted-foreground">
                                        {formatMoney(service.cost, service.currency)}
                                      </span>
                                      {service.renewal_date && (
                                        <span className="text-xs text-muted-foreground">
                                          renews {formatDate(service.renewal_date)}
                                        </span>
                                      )}
                                      {service.is_at_risk && (
                                        <Badge className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">
                                          at risk
                                        </Badge>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {dialog}
    </div>
  );
}
