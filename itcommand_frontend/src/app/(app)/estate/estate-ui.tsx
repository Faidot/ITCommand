"use client";

/**
 * Shared presentation for the Digital Estate.
 *
 * Everything here exists because it is used on more than one screen. Anything
 * used once lives with its screen.
 */

import * as React from "react";
import { AlertTriangle, ExternalLink, KeyRound, Lock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { SEVERITY_BADGE, SEVERITY_TONE, Severity, errorMessage } from "./estate-types";

// ─────────────────────────────── money ──────────────────────────────────

/**
 * A KPI-sized money string that cannot be cut off mid-number.
 *
 * The previous build rendered `PKR 13,520.94` into a fixed-width card with
 * `truncate`, producing the literal string "PKR 13…" — a number that reads as
 * thirteen rupees. Compact notation is not a nicety here: it is what keeps the
 * value inside the card at 1280px, where the KPI row is at its narrowest.
 *
 * Full precision is not lost, it moves to the tooltip.
 */
export function KpiMoney({
  amount,
  currency,
}: {
  amount: number;
  currency: string;
}) {
  const compact = formatMoney(amount, currency, { compact: true });
  const exact = formatMoney(amount, currency);
  // Below ~5 digits the exact figure fits, and "PKR 950" reads better than
  // "PKR 950.00" compacted to the same thing.
  const useCompact = Math.abs(amount) >= 10000;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tabular-nums">{useCompact ? compact : exact}</span>
      </TooltipTrigger>
      <TooltipContent>{exact}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The sentence that makes a partial total honest.
 *
 * Rendered wherever a converted figure is shown as a headline number. A total
 * that omitted the larger of two currencies while captioned "total across all
 * currencies" is the specific defect this module exists to stop repeating.
 */
export function UnconvertedNote({
  rows,
}: {
  rows: { currency: string; monthly: number }[];
}) {
  if (rows.length === 0) return null;
  const parts = rows.map((row) => `${row.currency} ${row.monthly.toFixed(2)}`);
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {parts.join(" + ")} not included — no exchange rate yet.{" "}
        <span className="text-muted-foreground">
          Add one in Settings → Integrations.
        </span>
      </span>
    </p>
  );
}

// ─────────────────────────────── cards ──────────────────────────────────

export function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  severity,
  onClick,
}: {
  title: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ElementType;
  severity: Severity;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <Card
      className={
        interactive
          ? "cursor-pointer transition-colors hover:border-primary/40"
          : undefined
      }
      onClick={onClick}
    >
      <CardContent className="flex items-start justify-between gap-2 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          {/* No `truncate`. The value shrinks a step at narrow widths instead of
              being cut, because half a number is worse than a small one. */}
          <p className="mt-2 text-xl font-semibold leading-tight tabular-nums xl:text-2xl">
            {value}
          </p>
          {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
        </div>
        <div className={`shrink-0 rounded-xl p-2.5 ${SEVERITY_TONE[severity]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

/** One line of copy and the action that resolves it. Never a bare zero. */
export function EmptyState({
  icon: Icon,
  title,
  action,
  tone = "muted",
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
  tone?: Severity;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className={`rounded-xl p-2.5 ${SEVERITY_TONE[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="max-w-md text-sm font-medium">{title}</p>
      {action}
    </div>
  );
}

// ─────────────────────────────── chips ──────────────────────────────────

/**
 * A provider's square, coloured from `brand_color` as served by the API.
 *
 * Never a hardcoded slug->colour map in the frontend: the catalog is
 * admin-editable, so a map here would go stale the first time someone adds a
 * provider in Settings.
 */
export function ProviderChip({
  name,
  color,
  slug,
  size = "sm",
}: {
  name: string;
  color?: string;
  slug?: string;
  size?: "sm" | "md";
}) {
  const initial = (name || slug || "?").slice(0, 1).toUpperCase();
  const box = size === "md" ? "h-7 w-7 text-xs" : "h-6 w-6 text-[11px]";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className={`flex shrink-0 items-center justify-center rounded-md font-bold text-white ${box}`}
        style={{ backgroundColor: color || "#64748b" }}
      >
        {initial}
      </span>
      <span className="truncate font-medium">{name || "Unassigned"}</span>
    </span>
  );
}

/**
 * MFA state, coloured from the severity the API returns.
 *
 * An account with no second factor holding production infrastructure is the
 * single most useful thing the Accounts table surfaces, so the colour is never
 * a client-side guess about what "SMS" means.
 */
export function MfaBadge({
  label,
  severity,
}: {
  label: string;
  severity: Severity;
}) {
  return (
    <Badge className={`text-[11px] ${SEVERITY_BADGE[severity]}`}>
      {severity === "critical" && <ShieldAlert className="mr-1 h-3 w-3" />}
      {label}
    </Badge>
  );
}

export function UrgencyDot({ severity }: { severity: Severity }) {
  const colour =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warning"
        ? "bg-amber-500"
        : "bg-neutral-400";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${colour}`} />;
}

// ─────────────────────────── credential copy ────────────────────────────

/**
 * A masked credential with a copy button.
 *
 * The secret is never in the page's data — the service payload carries an id
 * and a title and nothing else. Clicking calls the vault's own reveal endpoint,
 * which enforces the master-password unlock gate and writes an AuditLog row.
 * There is deliberately no second reveal path: adding one here would put a
 * secret behind `estate.view`, a far wider grant than `vault`.
 *
 * `serviceId` is passed through so the audit row records which service the
 * password was read for.
 */
export function CredentialCopyButton({
  credentialId,
  title,
  serviceId,
}: {
  credentialId: number | null;
  title: string | null;
  serviceId?: number;
}) {
  const [busy, setBusy] = React.useState(false);

  if (!credentialId) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const copy = async () => {
    setBusy(true);
    try {
      const response = await api.get<{ password?: string }>(
        `/vault/credentials/${credentialId}/reveal/`,
        { params: serviceId ? { service: serviceId } : undefined },
      );
      const password = response.data?.password;
      if (!password) throw new Error("empty");
      await navigator.clipboard.writeText(password);
      // The value is never rendered, logged, or put in a URL — only handed to
      // the clipboard.
      toast.success("Password copied. This reveal was logged.");
    } catch (reason) {
      const status = (reason as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        toast.error("Vault is locked. Unlock it from the Vault to reveal this.");
      } else {
        toast.error(errorMessage(reason, "Could not reveal that credential."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 font-mono text-[11px]"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            void copy();
          }}
        >
          <Lock className="h-3 w-3" />
          {busy ? "…" : "••••••••"}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {title === "Restricted"
          ? "Linked to a vault entry you cannot see."
          : `Copy "${title ?? "credential"}" from the vault. Revealed from vault, and logged.`}
      </TooltipContent>
    </Tooltip>
  );
}

export function ConsoleLink({ url }: { url: string }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
    >
      Open <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

export function VaultLink({ title }: { title: string | null }) {
  if (!title) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">{title}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {title === "Restricted"
          ? "Linked to a vault entry you cannot see. Reveal it from the Vault."
          : "Reveal the password from the Vault, not here."}
      </TooltipContent>
    </Tooltip>
  );
}

// ─────────────────────────────── skeletons ──────────────────────────────

export function KpiRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index}>
          <CardContent className="pt-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: cards }).map((_, index) => (
        <Card key={index}>
          <CardContent className="space-y-3 pt-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-1.5">
              {Array.from({ length: 7 }).map((__, chip) => (
                <Skeleton key={chip} className="h-6 w-14" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
