import { create } from "zustand";

const TOKEN_KEY = "vault_unlock_token";
const EXPIRES_KEY = "vault_unlock_expires";

interface VaultState {
  token: string | null;
  expiresAt: Date | null;
  isUnlocked: () => boolean;
  setUnlock: (token: string, expiresAt: string | Date) => void;
  clear: () => void;
  loadFromStorage: () => void;
  setExpiry: (expiresAt: string | Date) => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  token: null,
  expiresAt: null,

  isUnlocked: () => {
    const { token, expiresAt } = get();
    return !!token && !!expiresAt && expiresAt.getTime() > Date.now();
  },

  setUnlock: (token, expiresAt) => {
    const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(EXPIRES_KEY, exp.toISOString());
    }
    set({ token, expiresAt: exp });
  },

  setExpiry: (expiresAt) => {
    const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(EXPIRES_KEY, exp.toISOString());
    }
    set({ expiresAt: exp });
  },

  clear: () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EXPIRES_KEY);
    }
    set({ token: null, expiresAt: null });
  },

  loadFromStorage: () => {
    if (typeof window === "undefined") return;
    const token = sessionStorage.getItem(TOKEN_KEY);
    const expStr = sessionStorage.getItem(EXPIRES_KEY);
    if (!token || !expStr) {
      set({ token: null, expiresAt: null });
      return;
    }
    const exp = new Date(expStr);
    if (exp.getTime() <= Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EXPIRES_KEY);
      set({ token: null, expiresAt: null });
      return;
    }
    set({ token, expiresAt: exp });
  },
}));

export const getVaultToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expStr = sessionStorage.getItem(EXPIRES_KEY);
  if (!token || !expStr) return null;
  if (new Date(expStr).getTime() <= Date.now()) return null;
  return token;
};
