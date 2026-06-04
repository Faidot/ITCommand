import { create } from 'zustand'

interface SplitScreenState {
  isSplit: boolean;
  rightPageUrl: string;
  toggleSplit: () => void;
  setRightPage: (url: string) => void;
}

export const useSplitScreenStore = create<SplitScreenState>((set) => ({
  isSplit: false,
  rightPageUrl: '/dashboard', // Default right pane page
  toggleSplit: () => set((state) => ({ isSplit: !state.isSplit })),
  setRightPage: (url) => set({ rightPageUrl: url }),
}))
