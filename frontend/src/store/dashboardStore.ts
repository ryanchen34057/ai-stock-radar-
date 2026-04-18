import { create } from 'zustand';
import type { StockData, MAPeriod, AlertFilter, SortBy, MAProximityFilter, SpecialFilters, InstiFilters } from '../types/stock';

interface DashboardState {
  // Data
  stocks: StockData[];
  lastUpdated: string | null;
  loading: boolean;
  error: string | null;
  lastFetchTime: number | null;

  // UI settings
  selectedMA: MAPeriod;
  alertFilter: AlertFilter;
  maProximityFilter: MAProximityFilter;
  specialFilters: SpecialFilters;
  instiFilters: InstiFilters;
  selectedLayers: number[];
  sortBy: SortBy;
  darkMode: boolean;
  selectedStock: StockData | null;

  // Actions
  setStocks: (stocks: StockData[], lastUpdated: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedMA: (ma: MAPeriod) => void;
  setAlertFilter: (filter: AlertFilter) => void;
  setMAProximityFilter: (f: MAProximityFilter) => void;
  setSpecialFilters: (f: SpecialFilters) => void;
  setInstiFilters: (f: InstiFilters) => void;
  toggleLayer: (layer: number) => void;
  clearLayers: () => void;
  setSortBy: (sort: SortBy) => void;
  toggleDarkMode: () => void;
  setSelectedStock: (stock: StockData | null) => void;
}

const DEFAULT_SPECIAL: SpecialFilters = {
  maBullishAlignment: false,
  price20DayHigh: false,
  aboveWeeklyMA: false,
  aboveMonthlyMA: false,
  aboveQuarterlyMA: false,
  allTimeHigh: false,
};

const DEFAULT_INSTI: InstiFilters = {
  foreignNetBuy: false,
  trustNetBuy: false,
  marginIncreasing: false,
  shortDecreasing: false,
};

export const useDashboardStore = create<DashboardState>((set) => ({
  stocks: [],
  lastUpdated: null,
  loading: false,
  error: null,
  lastFetchTime: null,

  selectedMA: 60,
  alertFilter: 'all',
  maProximityFilter: { enabled: false, ma: 20, direction: 'above', threshold: 3 },
  specialFilters: DEFAULT_SPECIAL,
  instiFilters: DEFAULT_INSTI,
  selectedLayers: [],
  sortBy: 'change_percent',
  darkMode: true,
  selectedStock: null,

  setStocks: (stocks, lastUpdated) =>
    set({ stocks, lastUpdated, lastFetchTime: Date.now(), error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSelectedMA: (selectedMA) => set({ selectedMA }),
  setAlertFilter: (alertFilter) => set({ alertFilter }),
  setMAProximityFilter: (maProximityFilter) => set({ maProximityFilter }),
  setSpecialFilters: (specialFilters) => set({ specialFilters }),
  setInstiFilters: (instiFilters) => set({ instiFilters }),
  toggleLayer: (layer) =>
    set((s) => ({
      selectedLayers: s.selectedLayers.includes(layer)
        ? s.selectedLayers.filter((l) => l !== layer)
        : [...s.selectedLayers, layer],
    })),
  clearLayers: () => set({ selectedLayers: [] }),
  setSortBy: (sortBy) => set({ sortBy }),
  toggleDarkMode: () =>
    set((s) => {
      const next = !s.darkMode;
      if (next) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { darkMode: next };
    }),
  setSelectedStock: (selectedStock) => set({ selectedStock }),
}));
