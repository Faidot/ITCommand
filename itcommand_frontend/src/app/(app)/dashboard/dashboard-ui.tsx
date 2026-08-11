"use client";

/**
 * Building blocks for a dashboard that fits the screen it is on.
 *
 * Everything sizes with `clamp(min, preferred + vw, max)` rather than
 * breakpoints. Breakpoints jump — a 1440px laptop and a 3840px wall display
 * land in the same bucket and render identical 12px labels, which is unreadable
 * across a room. A vw-based preferred value scales continuously instead, so the
 * same tile is legible on a phone, a desktop and a TV without a separate layout
 * for each.
 *
 * The min and max on every clamp are what stop that being silly: text cannot
 * shrink below readable, and cannot grow into a billboard on an ultrawide.
 */

import Link from "next/link";

/** Fluid type scale. One place, so tiles cannot drift apart. */
export const FLUID = {
  /** Section headings. */
  title: "text-[clamp(0.95rem,0.45vw+0.75rem,1.6rem)]",
  /** Tile name. */
  label: "text-[clamp(0.7rem,0.3vw+0.6rem,1.05rem)]",
  /** The number that matters. */
  figure: "text-[clamp(1.1rem,1.15vw+0.6rem,2.6rem)]",
  /** Secondary numbers inside a tile. */
  stat: "text-[clamp(0.8rem,0.5vw+0.55rem,1.5rem)]",
  /** Captions under numbers. */
  caption: "text-[clamp(0.55rem,0.18vw+0.48rem,0.8rem)]",
  /** Gaps and padding that grow with the viewport. */
  gap: "gap-[clamp(0.35rem,0.5vw,1rem)]",
  pad: "p-[clamp(0.5rem,0.65vw,1.25rem)]",
} as const;

export interface Stat {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "bad" | "muted";
}

const TONE: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

/**
 * One module's tile.
 *
 * `min-w-0` and `min-h-0` on every flex/grid child are load-bearing: without
 * them a long value refuses to shrink and pushes the tile past the viewport,
 * which is exactly the scrolling this layout exists to avoid.
 */
export function ModuleTile({
  icon: Icon,
  title,
  href,
  headline,
  headlineTone,
  stats,
  alert,
}: {
  icon: React.ElementType;
  title: string;
  href: string;
  headline: string | number;
  headlineTone?: Stat["tone"];
  stats: Stat[];
  alert?: string;
}) {
  return (
    <Link href={href} className="group min-h-0 min-w-0">
      <div
        className={`flex h-full min-h-0 min-w-0 flex-col justify-between overflow-hidden rounded-xl border bg-card ${FLUID.pad} transition-colors hover:border-primary/50`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-[clamp(0.75rem,0.6vw,1.5rem)] w-[clamp(0.75rem,0.6vw,1.5rem)] shrink-0 text-muted-foreground" />
          <span className={`truncate font-medium ${FLUID.label}`}>{title}</span>
          {alert && (
            <span
              className={`ml-auto shrink-0 rounded-full bg-amber-100 px-1.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300 ${FLUID.caption}`}
            >
              {alert}
            </span>
          )}
        </div>

        <div
          className={`truncate font-semibold leading-none tabular-nums ${FLUID.figure} ${
            headlineTone ? TONE[headlineTone] : ""
          }`}
        >
          {headline}
        </div>

        <div className="flex min-w-0 flex-wrap items-baseline gap-x-[clamp(0.5rem,0.8vw,1.5rem)] gap-y-0.5">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <div
                className={`truncate font-semibold tabular-nums leading-tight ${FLUID.stat} ${
                  s.tone ? TONE[s.tone] : ""
                }`}
              >
                {s.value}
              </div>
              <div
                className={`truncate uppercase tracking-wide text-muted-foreground ${FLUID.caption}`}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

/**
 * A six-month trend, drawn with CSS rather than a chart library.
 *
 * recharts' ResponsiveContainer measures its parent on mount and warns
 * (width -1, height -1) when that parent has not been laid out yet — which is
 * every time inside a grid that sizes itself from the viewport. Bars made of
 * divs have no measurement step, so they scale with the tile for free.
 */
export function TrendStrip({
  points,
  format,
}: {
  points: { month: string; income: number; expense: number }[];
  format: (n: number) => string;
}) {
  const peak = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]));
  return (
    <div className="flex min-h-0 flex-1 items-end gap-[clamp(0.15rem,0.35vw,0.6rem)]">
      {points.map((p) => (
        <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
          <div className="flex h-full w-full items-end justify-center gap-[2px]">
            <div
              className="w-1/2 rounded-sm bg-emerald-500/80"
              style={{ height: `${(p.income / peak) * 100}%` }}
              title={`Income ${format(p.income)}`}
            />
            <div
              className="w-1/2 rounded-sm bg-red-500/70"
              style={{ height: `${(p.expense / peak) * 100}%` }}
              title={`Expense ${format(p.expense)}`}
            />
          </div>
          <span className={`truncate text-muted-foreground ${FLUID.caption}`}>{p.month}</span>
        </div>
      ))}
    </div>
  );
}
