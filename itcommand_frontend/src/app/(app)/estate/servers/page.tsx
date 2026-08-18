"use client";

/**
 * Servers.
 *
 * In the estate rather than in Assets because a server is bought through a
 * provider account and usually keeps a property running — the same two facts
 * that make a service findable. Assets is built around a purchase, a warranty
 * and handing a thing to a person, none of which describe a VM created by an
 * API call.
 *
 * The two columns that earn their place are Environment and Property.
 * A production box nothing claims is the finding worth surfacing, so it is
 * filterable in one click rather than something you have to notice.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Globe, HardDrive, Plus, RefreshCw, Search, ServerCog, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import { ServerDialog } from "./server-dialog";
import {
  EstateServer,
  SERVER_ENVIRONMENT_CHOICES,
  SERVER_HOSTING_CHOICES,
  SERVER_STATUS_CHOICES,
  errorMessage,
  normalizeServer,
  resultsOf,
} from "../estate-types";
import { ConsoleLink, EmptyState, TableSkeleton } from "../estate-ui";

const ENV_TONE: Record<string, string> = {
  PRODUCTION: "border-red-300 text-red-700 dark:text-red-400",
  STAGING: "border-amber-300 text-amber-700 dark:text-amber-400",
  DEVELOPMENT: "border-sky-300 text-sky-700 dark:text-sky-400",
  TEST: "border-violet-300 text-violet-700 dark:text-violet-400",
  DR: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
};

export default function ServersPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const canAdd = can(user, "estate", "add");

  const [servers, setServers] = useState<EstateServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState("all");
  const [status, setStatus] = useState("all");
  const [hosting, setHosting] = useState("all");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EstateServer | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await api.get<unknown>("/estate/servers/?page_size=300");
      setServers(resultsOf(response.data, normalizeServer));
    } catch (reason) {
      toast.error(errorMessage(reason, "Failed to load servers."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return servers.filter((server) => {
      if (environment !== "all" && server.environment !== environment) return false;
      if (status !== "all" && server.status !== status) return false;
      if (hosting !== "all" && server.hosting !== hosting) return false;
      if (orphansOnly && server.property !== null) return false;
      if (!needle) return true;
      return [
        server.name, server.hostname, server.public_ip ?? "", server.private_ip ?? "",
        server.region, server.provider_name, server.property_name ?? "",
      ].some((field) => field.toLowerCase().includes(needle));
    });
  }, [servers, search, environment, status, hosting, orphansOnly]);

  //: Counted from every server, not the filtered view — a banner that changed
  //: with the search box would be describing the search, not the estate.
  const live = servers.filter((s) => s.is_live).length;
  const orphans = servers.filter((s) => s.property === null).length;
  const productionOrphans = servers.filter(
    (s) => s.property === null && s.environment === "PRODUCTION" && s.is_live,
  ).length;

  const dialog = (
    <ServerDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      server={editing}
      onSaved={() => {
        setDialogOpen(false);
        setEditing(null);
        void load(true);
      }}
    />
  );

  if (loading) return <TableSkeleton rows={6} />;

  if (servers.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={ServerCog}
          title="No servers yet. Add the machines you run — a VM, a dedicated box, a game server — each under the account that pays for it."
          action={
            canAdd ? (
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Add server
              </Button>
            ) : undefined
          }
        />
        {dialog}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {productionOrphans > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            <strong>{productionOrphans}</strong> running production{" "}
            {productionOrphans === 1 ? "server is" : "servers are"} not attached to
            any property — nobody is recorded as needing{" "}
            {productionOrphans === 1 ? "it" : "them"}.{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => { setOrphansOnly(true); setEnvironment("PRODUCTION"); }}
            >
              Show them
            </button>
          </p>
        </div>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, hostname, IP, region…"
              className="pl-8"
            />
          </div>

          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every environment</SelectItem>
              {SERVER_ENVIRONMENT_CHOICES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={hosting} onValueChange={setHosting}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anywhere</SelectItem>
              {SERVER_HOSTING_CHOICES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every status</SelectItem>
              {SERVER_STATUS_CHOICES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={orphansOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setOrphansOnly((v) => !v)}
          >
            Unattached ({orphans})
          </Button>

          <Badge variant="outline" className="ml-auto">{live} live</Badge>
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {canAdd && (
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Add server
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
                  <TableHead className="pl-4">Server</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Hosting &amp; role</TableHead>
                  <TableHead>Addresses</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Console</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                      Nothing matches those filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((server) => (
                    <TableRow
                      key={server.id}
                      className="cursor-pointer"
                      // The detail page, not the edit dialog: reading a server
                      // is the common act and editing it the rare one, and the
                      // page is where the owner can be reassigned.
                      onClick={() => router.push(`/estate/servers/${server.id}`)}
                    >
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{server.name}</p>
                            {server.hostname && (
                              <p className="text-xs text-muted-foreground">{server.hostname}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${ENV_TONE[server.environment] ?? ""}`}
                        >
                          {server.environment_label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {server.hosting_label} · {server.role_label}
                        {server.size && <span className="ml-1 text-xs">· {server.size}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="space-y-0.5">
                          {server.public_ip && (
                            <code className="block text-xs">{server.public_ip}</code>
                          )}
                          {server.private_ip && (
                            <code className="block text-xs text-muted-foreground">
                              {server.private_ip}
                            </code>
                          )}
                          {server.region && (
                            <span className="text-xs text-muted-foreground">{server.region}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span
                          className="inline-flex items-center gap-1.5"
                          title={server.provider_account_login}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: server.brand_color || "#94a3b8" }}
                          />
                          {server.provider_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {server.property_name ? (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                            {server.property_name}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-700 dark:text-amber-400">
                            unattached
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            server.is_live
                              ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          {server.status_label}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="pr-4 text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ConsoleLink url={server.effective_console_url} />
                      </TableCell>
                    </TableRow>
                  ))
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
