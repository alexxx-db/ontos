import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ViewMode = 'consumer' | 'management';
export type DomainBrowserStyle = 'pills' | 'graph';

interface ViewModeState {
  viewMode: ViewMode;
  domainBrowserStyle: DomainBrowserStyle;
  setViewMode: (mode: ViewMode) => void;
  setDomainBrowserStyle: (style: DomainBrowserStyle) => void;
  toggleViewMode: () => void;
}

export const useViewModeStore = create<ViewModeState>()(
  persist(
    (set, get) => ({
      viewMode: 'consumer', // Default to consumer/marketplace view
      domainBrowserStyle: 'pills', // Default to pills view
      
      setViewMode: (mode: ViewMode) => {
        set({ viewMode: mode });
      },
      
      setDomainBrowserStyle: (style: DomainBrowserStyle) => {
        set({ domainBrowserStyle: style });
      },
      
      toggleViewMode: () => {
        const current = get().viewMode;
        set({ viewMode: current === 'consumer' ? 'management' : 'consumer' });
      },
    }),
    {
      name: 'view-mode-storage', // localStorage key
    }
  )
);

