"use client";

/**
 * Dashboard building blocks.
 *
 * The visual language: a bento grid of unequal cards, one oversized figure per
 * card with the unit set small beside it, tick-mark arcs instead of pie charts,
 * and colour spent only where it means something.
 *
 * Everything draws from the theme tokens (`bg-card`, `border`, `text-primary`)
 * rather than fixed hex values, so light and dark both work and the accent
 * follows whatever the app is themed to — the inspiration boards each commit
 * to a single palette, which is not something a themed app can hardcode.
 */

import Link from "next/link";

/* ────────────────────────────── shell ────────────────────────────── */

export function Bento({
  span = "col-span-12 md:col-span-6 xl:col-span-3",
  className = "",
  href,
  children,
}: {
  span?: string;
  className?: string;
  href?: string;
  children: React.ReactNode;
}) {
  const card = (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-[clamp(0.85rem,0.9vw,1.5rem)] transition-all ${
        href ? "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
  return href ? (
    <Link href={href} className={`${span} block min-w-0`}>{card}</Link>
  ) : (
    <div className={`${span} min-w-0`}>{card}</div>
  );
}

export function CardLabel({
  icon: Icon,
  children,
  action,
}: {
  icon?: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate text-xs font-medium text-muted-foreground">{children}</span>
      </div>
      {action}
    </div>
  );
}

/* ───────────────────────────── figures ───────────────────────────── */

/**
 * The oversized number, with its unit set small alongside.
 *
 * Both reference designs do this — "4.2 GWh" with the 4 huge and the rest
 * quiet. It reads as one value rather than a string of same-sized glyphs, and
 * it lets a long figure stay legible without shrinking the whole card.
 */
export function Figure({
  value,
  unit,
  tone,
  size = "lg",
}: {
  value: string | number;
  unit?: string;
  tone?: string;
  size?: "lg" | "md";
}) {
  const scale =
    size === "lg"
      ? "text-[clamp(1.9rem,2.1vw+1rem,3.4rem)]"
      : "text-[clamp(1.3rem,1vw+0.8rem,2rem)]";
  return (
    <div className="flex min-w-0 items-baseline gap-1">
      <span className={`truncate font-semibold leading-none tracking-tight tabular-nums ${scale} ${tone || ""}`}>
        {value}
      </span>
      {unit && (
        <span className="shrink-0 text-[clamp(0.65rem,0.3vw+0.55rem,0.95rem)] font-medium text-muted-foreground">
          {unit}
        </span>
      )}
    </div>
  );
}

/* ────────────────────────────── gauges ───────────────────────────── */

/**
 * A semicircular gauge drawn as discrete ticks.
 *
 * Ticks rather than a solid arc for the reason the reference designs use them:
 * a filled sweep reads as approximate, while countable marks read as measured.
 * Pure SVG with no measurement step, so unlike recharts it cannot render at
 * width -1 inside a grid that sizes itself from the viewport.
 */
export function TickArc({
  pct,
  label,
  value,
  unit,
  tone = "text-primary",
  ticks = 44,
}: {
  pct: number;
  label?: string;
  value: string | number;
  unit?: string;
  tone?: string;
  ticks?: number;
}) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const lit = Math.round((safe / 100) * ticks);
  const cx = 100;
  const cy = 92;
  const rOuter = 84;
  const rInner = 66;

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center">
      <svg viewBox="0 0 200 104" className="h-full max-h-[8.5rem] w-full" role="img" aria-label={`${label ?? ""} ${safe}%`}>
        {Array.from({ length: ticks }).map((_, i) => {
          // −180°..0°: a half circle opening upward.
          const angle = Math.PI + (i / (ticks - 1)) * Math.PI;
          const x1 = cx + Math.cos(angle) * rInner;
          const y1 = cy + Math.sin(angle) * rInner;
          const x2 = cx + Math.cos(angle) * rOuter;
          const y2 = cy + Math.sin(angle) * rOuter;
          const on = i < lit;
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              strokeWidth={on ? 3 : 2}
              strokeLinecap="round"
              className={on ? `${tone} stroke-current` : "stroke-current text-border"}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
        <Figure value={value} unit={unit} />
        {label && <span className="mt-0.5 text-xs text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

/* ──────────────────────────── meters ─────────────────────────────── */

/** A labelled progress row — the "Design 72%" pattern from the reference. */
export function Meter({
  label,
  value,
  max,
  display,
  tone = "bg-primary",
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
  tone?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{display ?? value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─────────────────────────── mini charts ─────────────────────────── */

/**
 * Six-month paired bars, drawn with divs.
 *
 * Kept out of recharts on purpose: ResponsiveContainer measures its parent on
 * mount and logs `width(-1) height(-1)` whenever that parent has not been laid
 * out yet, which is every card in a viewport-sized grid.
 */
export function PairedBars({
  points,
  format,
}: {
  points: { month: string; income: number; expense: number }[];
  format: (n: number) => string;
}) {
  const peak = Math.max(...points.flatMap((p) => [p.income, p.expense]), 0);

  // Nothing to plot is worth saying out loud. An axis with no bars reads as a
  // broken chart, and the reason — no *approved* expense in the window — is
  // not something a reader can infer from an empty card.
  if (peak <= 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
        <p className="text-xs text-muted-foreground">
          No approved income or expense in the last 6 months.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-[clamp(0.3rem,0.7vw,1.1rem)] pt-2">
      {points.map((p) => (
        <div key={p.month} className="flex min-w-0 flex-1 flex-col">
          {/*
            Bars are absolutely positioned against this box.
            A percentage height needs a parent whose height is definite; an
            earlier version put `items-end` on the row, which stopped the
            columns stretching, left their height as auto, and collapsed every
            bar to nothing. Anchoring to a relative box sidesteps that entirely.
          */}
          <div className="relative min-h-0 flex-1">
            <div
              className="absolute bottom-0 left-[8%] w-[36%] rounded-t-md bg-primary transition-all"
              style={{ height: `${Math.max(3, (p.income / peak) * 100)}%` }}
              title={`Income ${format(p.income)}`}
            />
            <div
              className="absolute bottom-0 right-[8%] w-[36%] rounded-t-md bg-primary/30 transition-all"
              style={{ height: `${Math.max(3, (p.expense / peak) * 100)}%` }}
              title={`Expense ${format(p.expense)}`}
            />
          </div>
          <span className="mt-1.5 truncate text-center text-[10px] text-muted-foreground">
            {p.month}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Legend dot + label, used under the paired bars. */
export function Key({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${tone}`} />
      {children}
    </span>
  );
}
