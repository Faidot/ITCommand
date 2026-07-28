/**
 * Date formatting, in one place.
 *
 * Deliberately mirrors `lib/currency.ts`: plain formatters that never throw, a
 * single fallback string, and no `new Date(x).toLocaleDateString()` scattered
 * across feature files. Before this module there were 28 files formatting dates
 * inline, which is why the same date rendered three different ways depending on
 * which page you were on.
 *
 * All inputs are the API's shapes: `YYYY-MM-DD` for dates and ISO-8601 for
 * timestamps. Date-only values are parsed at local midnight on purpose —
 * `new Date("2026-07-28")` is parsed as UTC, which renders as the 27th for
 * anyone west of Greenwich.
 */

export const NOT_SET = "Not set";

type DateInput = string | number | Date | null | undefined;

/** Parse an API value without ever throwing. Returns null when unusable. */
export function parseDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isFinite(fromNumber.getTime()) ? fromNumber : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  // A bare YYYY-MM-DD must be local midnight, not UTC midnight.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00`)
    : new Date(text);
  return Number.isFinite(dateOnly.getTime()) ? dateOnly : null;
}

/**
 * Format a date. `28 Jul 2026` by default.
 *
 * Pass `fallback` when "Not set" is the wrong word for an empty value — an
 * empty table cell usually wants "—".
 */
export function formatDate(
  value: DateInput,
  options: { fallback?: string; withYear?: boolean; long?: boolean } = {},
): string {
  const { fallback = NOT_SET, withYear = true, long = false } = options;
  const date = parseDate(value);
  if (!date) return fallback;

  try {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: long ? "long" : "short",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Format a timestamp: `28 Jul 2026, 14:30`. */
export function formatDateTime(
  value: DateInput,
  options: { fallback?: string } = {},
): string {
  const { fallback = NOT_SET } = options;
  const date = parseDate(value);
  if (!date) return fallback;

  try {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * Whole days from today to `value`. Negative means the past, null when unusable.
 *
 * Both sides are floored to local midnight, so "tomorrow" is 1 regardless of
 * the time of day the page happens to be open.
 */
export function daysUntil(value: DateInput, from: DateInput = new Date()): number | null {
  const target = parseDate(value);
  const origin = parseDate(from);
  if (!target || !origin) return null;

  const targetMidnight = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();
  const originMidnight = new Date(
    origin.getFullYear(),
    origin.getMonth(),
    origin.getDate(),
  ).getTime();

  return Math.round((targetMidnight - originMidnight) / 86_400_000);
}

/**
 * Human gap: `today`, `in 5 days`, `3 days ago`, `in 2 months`.
 *
 * Reads as a caption next to a date, not as a replacement for it — a renewal
 * row should show both, because "in 2 months" is not something you can diary.
 */
export function formatRelativeDays(
  value: DateInput,
  options: { fallback?: string } = {},
): string {
  const { fallback = NOT_SET } = options;
  const days = daysUntil(value);
  if (days === null) return fallback;

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  const magnitude = Math.abs(days);
  const future = days > 0;
  let amount = magnitude;
  let unit: Intl.RelativeTimeFormatUnit = "day";

  if (magnitude >= 365) {
    amount = Math.round(magnitude / 365);
    unit = "year";
  } else if (magnitude >= 60) {
    amount = Math.round(magnitude / 30);
    unit = "month";
  }

  try {
    return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(
      future ? amount : -amount,
      unit,
    );
  } catch {
    return future ? `in ${amount} ${unit}s` : `${amount} ${unit}s ago`;
  }
}

/** `1 Jul – 28 Jul 2026`, collapsing a repeated month or year. */
export function formatDateRange(
  start: DateInput,
  end: DateInput,
  options: { fallback?: string } = {},
): string {
  const { fallback = NOT_SET } = options;
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from && !to) return fallback;
  if (!from) return formatDate(to, { fallback });
  if (!to) return formatDate(from, { fallback });

  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();

  if (sameMonth) {
    return `${from.getDate()}–${formatDate(to)}`;
  }
  return `${formatDate(from, { withYear: !sameYear })} – ${formatDate(to)}`;
}

/** `YYYY-MM-DD` for an `<input type="date">` value. */
export function toDateInputValue(value: DateInput): string {
  const date = parseDate(value);
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today as `YYYY-MM-DD`, for date-input defaults. */
export function todayInputValue(): string {
  return toDateInputValue(new Date());
}
