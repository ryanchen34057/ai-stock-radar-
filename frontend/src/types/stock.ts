export interface KLine {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MAValues {
  "5": number | null;
  "10": number | null;
  "20": number | null;
  "60": number | null;
  "120": number | null;
  "240": number | null;
}

export interface StockData {
  symbol: string;
  name: string;
  layer: number;
  layer_name: string;
  sub_category: string | null;
  note: string | null;
  current_price: number | null;
  change: number | null;
  change_percent: number | null;
  volume: number | null;
  pe_ratio: number | null;
  market_cap: number | null;
  ma: MAValues;
  klines: KLine[];
}

export interface DashboardData {
  last_updated: string;
  stocks: StockData[];
}

export type MAPeriod = 5 | 10 | 20 | 60 | 120 | 240;
export type AlertFilter = 'all' | 'below' | 'above';
export type SortBy = 'change_percent' | 'volume' | 'ma_distance' | 'symbol';
export type SignalType = 'above' | 'below' | 'at';

export interface MAProximityFilter {
  enabled: boolean;
  ma: MAPeriod;
  direction: 'above' | 'at' | 'below';
  threshold: number; // percentage, e.g. 3 means within 3%
}

export const LAYER_NAMES: Record<number, string> = {
  1: '晶片設計與製造',
  2: '化合物半導體',
  3: '記憶體',
  4: 'PCB 載板',
  5: 'PCB 主機板',
  6: '散熱電源',
  7: '光通訊 CPO',
  8: '被動元件',
  9: 'ODM 組裝',
  10: '電力基礎建設',
};
