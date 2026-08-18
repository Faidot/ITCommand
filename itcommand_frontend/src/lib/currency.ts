import { useCallback } from 'react';

import { DEFAULT_CURRENCY, activeCurrency, useSettingsStore } from '@/store/settingsStore';

/**
 * Format an amount as money.
 *
 * Pass `currency` only when the record carries its own currency (subscriptions
 * and vendor contracts do). Omit it and the company-wide setting is used, so
 * changing the currency in Settings updates the whole app.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
  options: { compact?: boolean; decimals?: number } = {},
): string {
  const value = typeof amount === 'number' ? amount : Number(amount ?? 0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const code = (currency || activeCurrency() || DEFAULT_CURRENCY).toUpperCase();
  const decimals = options.decimals;

  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      notation: options.compact ? 'compact' : 'standard',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals ?? (options.compact ? 1 : 2),
    }).format(safeValue);
  } catch {
    // Unknown/invalid ISO code — show the code rather than throwing.
    return `${code} ${safeValue.toLocaleString(undefined, {
      maximumFractionDigits: decimals ?? 2,
    })}`;
  }
}

/** Money formatter bound to the current settings; re-renders when they change. */
/**
 * Formatter bound to the company currency.
 *
 * Memoised on the currency rather than rebuilt each render. The identity of
 * this function ends up in dependency arrays all over the app, and returning
 * a fresh closure every time makes any `useMemo`/`useEffect` that depends on
 * it re-run constantly — which is an infinite loop as soon as one of them
 * sets state.
 */
export function useMoney() {
  const currency = useSettingsStore((state) => state.default_currency);
  return useCallback(
    (
      amount: number | string | null | undefined,
      options?: { compact?: boolean; decimals?: number },
    ) => formatMoney(amount, currency, options),
    [currency],
  );
}

/** The active currency code, for labels like "Amount (USD)". */
export function useCurrencyCode(): string {
  return useSettingsStore((state) => state.default_currency);
}
