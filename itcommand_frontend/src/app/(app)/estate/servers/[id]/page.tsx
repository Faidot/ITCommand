"use client";

/**
 * One server, in full.
 *
 * The owner control sits at the top rather than buried in the edit dialog:
 * "who is responsible for this box" is the field that goes stale, and a
 * machine still assigned to somebody who left is the finding worth making
 * one click away from fixing.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Globe, HardDrive, Pencil, UserCheck, UserPlus, X,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatDate } from "@/lib/date";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { ServerDialog } from "../server-dialog";
import {
  EstateServer,
  errorMessage,
  normalizeServer,
} from "../../estate-types";
import { ConsoleLink } from "../../estate-ui";

interface AppUser {
  id: number;
  full_name?: string;
  email: string;
}

export default function ServerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const user = useAuthStore((state) => state.user);
  const canEdit = can(user, "estate", "add");

  const [server, setServer] = useState<EstateServer | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get<Record<string, unknown>>(`/estate/servers/${id}/`);
      setServer(normalizeServer(response.data));
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not load that server."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canEdit) return;
    api.get<unknown>("/users/", { params: { page_size: 500 } })
      .then((r) => {
        const raw = r.data as { results?: AppUser[] } | AppUser[];
        setUsers(Array.isArray(raw) ? raw : raw.results ?? []);
      })
      // Without the list you simply cannot reassign; the rest of the page is
      // still worth showing, so this must not fail it.
      .catch(() => setUsers([]));
  }, [canEdit]);

  const setOwner = async (ownerId: number | null) => {
    try {
      await api.patch(`/estate/servers/${id}/`, { owner: ownerId });
      toast.success(ownerId ? "Owner assigned." : "Owner cleared.");
      await load();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not change the owner."));
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!server) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          That server no longer exists.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/estate/servers")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold">{server.name}</h1>
              <Badge variant="outline" className="text-[10px]">
                {server.environment_label}
              </Badge>
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
            </div>
            {server.hostname && (
              <code className="text-sm text-muted-foreground">{server.hostname}</code>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConsoleLink url={server.effective_console_url} />
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Responsible</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {server.owner ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-sky-50 px-2 py-1 text-sm text-sky-800 dark:bg-sky-950 dark:text-sky-300">
              <UserCheck className="h-4 w-4" />
              <Link href={`/users/${server.owner}`} className="hover:underline">
                {server.owner_name}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  title="Remove the owner"
                  className="ml-1 opacity-60 hover:opacity-100"
                  onClick={() => void setOwner(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserPlus className="h-4 w-4" /> Nobody is recorded as responsible
            </span>
          )}

          {canEdit && (
            <Select value="none" onValueChange={(v) => void setOwner(Number(v))}>
              <SelectTrigger className="h-8 w-[220px] text-sm">
                <SelectValue placeholder={server.owner ? "Reassign to…" : "Assign to…"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" disabled>
                  {server.owner ? "Reassign to…" : "Assign to…"}
                </SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.full_name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Where it is</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Bought through">
              <Link
                href={`/estate/accounts/${server.provider_account}`}
                className="inline-flex items-center gap-1.5 hover:underline"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: server.brand_color || "#94a3b8" }}
                />
                {server.provider_name} · {server.provider_account_login}
              </Link>
            </Field>
            <Field label="Billed under">
              {server.service_identifier ?? (
                <span className="text-muted-foreground">no single service</span>
              )}
            </Field>
            <Field label="Keeps running">
              {server.property_name ? (
                <span className="inline-flex items-center gap-1">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  {server.property_name}
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  nothing claims it
                </span>
              )}
            </Field>
            <Field label="Region">{server.region || "—"}</Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What it is</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Role">{server.role_label}</Field>
            <Field label="Size">{server.size || "—"}</Field>
            <Field label="Operating system">{server.operating_system || "—"}</Field>
            <Field label="Public IP">
              {server.public_ip ? <code>{server.public_ip}</code> : "—"}
            </Field>
            <Field label="Private IP">
              {server.private_ip ? <code>{server.private_ip}</code> : "—"}
            </Field>
            <Field label="Provisioned">
              {server.provisioned_on ? formatDate(server.provisioned_on) : "—"}
            </Field>
            <Field label="Expires">
              {server.expires_on ? formatDate(server.expires_on) : "—"}
            </Field>
          </CardContent>
        </Card>
      </div>

      {server.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{server.notes}</p>
          </CardContent>
        </Card>
      )}

      <ServerDialog
        open={editing}
        onOpenChange={setEditing}
        server={server}
        onSaved={() => { setEditing(false); void load(); }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
