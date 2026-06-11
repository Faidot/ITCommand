import { create } from 'zustand';
import api from '@/lib/api';

interface User {
  id: number;
  email: string;
  full_name: string;
  role: string;
  role_label?: string;
  permissions?: Record<string, Record<string, boolean>>;
  department: number | null;
  avatar: string | null;
  designation?: string | null;
  bio?: string | null;
  manager?: number | null;
  manager_name?: string | null;
  team_lead?: number | null;
  team_lead_name?: string | null;
  is_active: boolean;
  created_at: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true, // starts loading until loadFromStorage executes

  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
    set({ user, accessToken, isAuthenticated: true, isLoading: false });
  },

  logout: async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (refreshToken) {
      try {
        await api.post('/auth/logout/', { refresh: refreshToken });
      } catch {
        console.error("Logout API failed, continuing local clear.");
      }
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
  },

  loadFromStorage: async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      // Validate token by fetching user data
      const res = await api.get('/auth/me/');
      set({ user: res.data, accessToken: token, isAuthenticated: true, isLoading: false });
    } catch {
      // If the interceptor couldn't refresh, it removed tokens already
      set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  }
}));
