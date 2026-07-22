import { create } from 'zustand';
import api from '@/lib/api';

/**
 * Company-wide display settings, fetched once after sign-in.
 *
 * These drive how money, headers and financial years render across every
 * module, so they live in a store rather than being fetched per page.
 */
interface AppSettings {
  company_name: string;
  default_currency: string;
  fiscal_year_start_month: number;
}

interface SettingsState extends AppSettings {
  isLoaded: boolean;
  load: (force?: boolean) => Promise<void>;
  apply: (settings: Partial<AppSettings>) => void;
}

export const DEFAULT_CURRENCY = 'USD';

let inFlight: Promise<void> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  company_name: '',
  default_currency: DEFAULT_CURRENCY,
  fiscal_year_start_month: 1,
  isLoaded: false,

  load: async (force = false) => {
    if (!force && get().isLoaded) return;
    // Many components mount at once on first paint; collapse them into one call.
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const response = await api.get<Record<string, unknown>>('/settings/');
        const data = response.data || {};
        const month = Number(data.fiscal_year_start_month);
        set({
          company_name: typeof data.company_name === 'string' ? data.company_name : '',
          default_currency:
            typeof data.default_currency === 'string' && data.default_currency.trim()
              ? data.default_currency.trim().toUpperCase()
              : DEFAULT_CURRENCY,
          fiscal_year_start_month:
            Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1,
          isLoaded: true,
        });
      } catch {
        // Never block the UI on settings; fall back to the defaults above.
        set({ isLoaded: true });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  /** Apply values locally after a save, so the UI updates without a refetch. */
  apply: (settings) =>
    set((current) => ({
      ...current,
      ...settings,
      default_currency: settings.default_currency
        ? settings.default_currency.trim().toUpperCase()
        : current.default_currency,
    })),
}));

/** Read the active currency outside React (formatters, non-component code). */
export function activeCurrency(): string {
  return useSettingsStore.getState().default_currency || DEFAULT_CURRENCY;
}
