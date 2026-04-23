import { create } from 'zustand';
import type { StockData, MAPeriod, AlertFilter, SortBy, MAProximityFilter, BreakoutPendingFilter, BBUpperCrossFilter, BBProximityFilter, BBSqueezeFilter, BowlPatternFilter, CandleFilter, SpecialFilters, InstiFilters, RangeFilter, KDFilters, ThemeFilter, TierFilter } from '../types/stock';

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
  breakoutPendingFilter: BreakoutPendingFilter;
  bbUpperCrossFilter: BBUpperCrossFilter;
  bbProximityFilter: BBProximityFilter;
  bbSqueezeFilter: BBSqueezeFilter;
  bowlPatternFilter: BowlPatternFilter;
  candleFilter: CandleFilter;
  specialFilters: SpecialFilters;
  instiFilters: InstiFilters;
  priceFilter: RangeFilter;
  peFilter: RangeFilter;
  kdFilters: KDFilters;
  themeFilter: ThemeFilter;   // A / B / C / all / cross
  tierFilter: TierFilter;     // 1=僅 T1, 2=T1+T2, 3=全部
  searchQuery: string;        // free-text filter by symbol or name
  selectedLayers: number[];
  sortBy: SortBy;
  darkMode: boolean;
  // Which MA lines are visible on ALL charts (cards + detail modal). Multi-
  // select. Default: all on. `selectedMA` is still used as the "primary" MA
  // for things like MA-proximity / alignment filters.
  maVisible: Record<number, boolean>;
  // Which Bollinger Band lines are visible on ALL charts. If all three are
  // off, BB overlay is hidden entirely. Default all on.
  bbVisible: { upper: boolean; middle: boolean; lower: boolean };
  selectedStock: StockData | null;

  // Actions
  setStocks: (stocks: StockData[], lastUpdated: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedMA: (ma: MAPeriod) => void;
  setAlertFilter: (filter: AlertFilter) => void;
  setMAProximityFilter: (f: MAProximityFilter) => void;
  setBreakoutPendingFilter: (f: BreakoutPendingFilter) => void;
  setBBUpperCrossFilter: (f: BBUpperCrossFilter) => void;
  setBBProximityFilter: (f: BBProximityFilter) => void;
  setBBSqueezeFilter: (f: BBSqueezeFilter) => void;
  setBowlPatternFilter: (f: BowlPatternFilter) => void;
  setCandleFilter: (f: CandleFilter) => void;
  setSpecialFilters: (f: SpecialFilters) => void;
  setInstiFilters: (f: InstiFilters) => void;
  setPriceFilter: (f: RangeFilter) => void;
  setPeFilter: (f: RangeFilter) => void;
  setKDFilters: (f: KDFilters) => void;
  setThemeFilter: (t: ThemeFilter) => void;
  setTierFilter: (t: TierFilter) => void;
  setSearchQuery: (q: string) => void;
  toggleLayer: (layer: number) => void;
  clearLayers: () => void;
  setSortBy: (sort: SortBy) => void;
  toggleDarkMode: () => void;
  toggleMAVisible: (p: MAPeriod) => void;
  setAllMAVisible: (on: boolean) => void;
  toggleBBVisible: (k: 'upper' | 'middle' | 'lower') => void;
  setSelectedStock: (stock: StockData | null) => void;
}

const DEFAULT_SPECIAL: SpecialFilters = {
  maBullishAlignment: false,
  price20DayHigh: false,
  aboveWeeklyMA: false,
  aboveMonthlyMA: false,
  aboveQuarterlyMA: false,
  allTimeHigh: false,
  gapUp: false,
  gapDown: false,
  pullbackReclaim5:  false,
  pullbackReclaim10: false,
  pullbackReclaim20: false,
  bigHolderIncrease: false,
  bbExpansion:       false,
  longBullish:       false,
};

const DEFAULT_INSTI: InstiFilters = {
  foreignNetBuy: false,
  trustNetBuy: false,
  marginIncreasing: false,
  shortDecreasing: false,
};

const DEFAULT_KD: KDFilters = {
  golden: false,
  death: false,
  up: false,
  down: false,
  oversold: false,
  overbought: false,
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
  breakoutPendingFilter: { enabled: false, lookback: 60, threshold: 5, minBaseDays: 15 },
  bbUpperCrossFilter: { enabled: false, withinDays: 3, requireStillAbove: false },
  bbProximityFilter: { enabled: false, band: 'upper', direction: 'at', threshold: 2 },
  bbSqueezeFilter: { enabled: false, level: 'moderate' },
  bowlPatternFilter: { enabled: false, strictness: 'moderate' },
  candleFilter: { enabled: false, color: 'red', minPct: 3, maxPct: 30 },
  specialFilters: DEFAULT_SPECIAL,
  instiFilters: DEFAULT_INSTI,
  priceFilter: { enabled: false, min: null, max: null },
  peFilter: { enabled: false, min: null, max: null },
  kdFilters: DEFAULT_KD,
  themeFilter: 'A',
  tierFilter: 3, // no tier-based filtering in the grid; the star badge on each card conveys tier visually
  searchQuery: '',
  selectedLayers: [],
  sortBy: 'change_percent',
  darkMode: true,
  maVisible: { 5: true, 10: true, 20: true, 60: true, 120: true, 240: true },
  bbVisible: { upper: true, middle: true, lower: true },
  selectedStock: null,

  setStocks: (stocks, lastUpdated) =>
    set({ stocks, lastUpdated, lastFetchTime: Date.now(), error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSelectedMA: (selectedMA) => set({ selectedMA }),
  setAlertFilter: (alertFilter) => set({ alertFilter }),
  setMAProximityFilter: (maProximityFilter) => set({ maProximityFilter }),
  setBreakoutPendingFilter: (breakoutPendingFilter) => set({ breakoutPendingFilter }),
  setBBUpperCrossFilter: (bbUpperCrossFilter) => set({ bbUpperCrossFilter }),
  setBBProximityFilter: (bbProximityFilter) => set({ bbProximityFilter }),
  setBBSqueezeFilter: (bbSqueezeFilter) => set({ bbSqueezeFilter }),
  setBowlPatternFilter: (bowlPatternFilter) => set({ bowlPatternFilter }),
  setCandleFilter: (candleFilter) => set({ candleFilter }),
  setSpecialFilters: (specialFilters) => set({ specialFilters }),
  setInstiFilters: (instiFilters) => set({ instiFilters }),
  setPriceFilter: (priceFilter) => set({ priceFilter }),
  setPeFilter: (peFilter) => set({ peFilter }),
  setKDFilters: (kdFilters) => set({ kdFilters }),
  setThemeFilter: (themeFilter) => set({ themeFilter }),
  setTierFilter: (tierFilter) => set({ tierFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleLayer: (layer) =>
    set((s) => ({
      selectedLayers: s.selectedLayers.includes(layer)
        ? s.selectedLayers.filter((l) => l !== layer)
        : [...s.selectedLayers, layer],
    })),
  clearLayers: () => set({ selectedLayers: [] }),
  setSortBy: (sortBy) => set({ sortBy }),
  toggleMAVisible: (p) => set((s) => ({ maVisible: { ...s.maVisible, [p]: !s.maVisible[p] } })),
  setAllMAVisible: (on) => set({
    maVisible: { 5: on, 10: on, 20: on, 60: on, 120: on, 240: on },
  }),
  toggleBBVisible: (k) => set((s) => ({ bbVisible: { ...s.bbVisible, [k]: !s.bbVisible[k] } })),
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
