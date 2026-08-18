"use client";

/**
 * What this person can sign in to, and what runs under their name.
 *
 * The offboarding question. Before provider logins were their own records
 * there was no way to ask it at all — an account had one owner, so a person
 * with an IAM login inside somebody else's AWS account was invisible.
 *
 * Logins and servers are shown together on purpose: answering half of "what
 * does this person hold" is how a machine gets left running under a leaver's
 * name months after they go.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { HardDrive, KeyRound, ShieldAlert } from "lucide-react";

import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AccountLogin,
  EstateServer,
  normalizeAccountLogin,
  normalizeServer,
} from "@/app/(app)/estate/estate-types";

interface AccessPayload {
  logins: AccountLogin[];
  servers: EstateServer[];
  login_count: number;
  privileged_count: number;
  without_mfa: number;
  server_count: number;
}

export function AccessPanel({ userId }: { userId: number | string }) {
  const [data, setData] = useState<AccessPayload | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<Record<string, unknown>>(`/estate/account-users/for-user/${userId}/`)
      .then((response) => {
        if (cancelled) return;
        const raw = response.data;
        setData({
          logins: ((raw.logins as Record<string, unknown>[]) ?? []).map(normalizeAccountLogin),
          servers: ((raw.servers as Record<string, unknown>[]) ?? []).map(normalizeServer),
          login_count: Number(raw.login_count ?? 0),
          privileged_count: Number(raw.privileged_count ?? 0),
          without_mfa: Number(raw.without_mfa ?? 0),
          server_count: Number(raw.server_count ?? 0),
        });
      })
      // Estate access is its own permission. Somebody who can see a user but
      // not the estate should get no panel, not an error banner.
      .catch(() => { if (!cancelled) setDenied(true); });
    return () => { cancelled = true; };
  }, [userId]);

  if (denied || !data) return null;
  if (data.login_count === 0 && data.server_count === 0) return null;

  return (
    <Card className="relative overflow-hidden border-sky-200 shadow-sm">
      <div className="absolute left-0 top-0 h-full w-1 bg-sky-500" />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <KeyRound className="h-4 w-4 text-sky-500" /> Access &amp; servers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {data.login_count} login{data.login_count === 1 ? "" : "s"}
          </Badge>
          {data.privileged_count > 0 && (
            <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700 dark:text-amber-400">
              {data.privileged_count} privileged
            </Badge>
          )}
          {data.without_mfa > 0 && (
            <Badge className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">
              <ShieldAlert className="mr-1 h-3 w-3" />
              {data.without_mfa} no MFA
            </Badge>
          )}
          {data.server_count > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {data.server_count} server{data.server_count === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {data.logins.length > 0 && (
          <div className="space-y-1">
            {data.logins.map((login) => (
              <div key={login.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: login.brand_color || "#94a3b8" }}
                />
                <span className="font-medium">{login.provider_name}</span>
                <code className="rounded bg-muted px-1 py-0.5">{login.login}</code>
                <span className="text-muted-foreground">{login.role_label}</span>
                {login.mfa_type === "NONE" && (
                  <span className="text-red-600 dark:text-red-400">no MFA</span>
                )}
              </div>
            ))}
          </div>
        )}

        {data.servers.length > 0 && (
          <div className="space-y-1 border-t pt-2">
            {data.servers.map((server) => (
              <div key={server.id} className="flex items-center gap-2 text-xs">
                <HardDrive className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="font-medium">{server.name}</span>
                <span className="text-muted-foreground">{server.environment_label}</span>
              </div>
            ))}
          </div>
        )}

        <Link
          href={`/estate/accounts`}
          className="block text-xs text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
        >
          Manage in Digital Estate →
        </Link>
      </CardContent>
    </Card>
  );
}
