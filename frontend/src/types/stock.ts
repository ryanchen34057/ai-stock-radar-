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
  industry_role?: string | null;
  secondary_layers?: number[] | null;
  logo_id?: string | null;
  current_price: number | null;
  change: number | null;
  change_percent: number | null;
  volume: number | null;
  pe_ratio: number | null;
  market_cap: number | null;
  ma: MAValues;
  klines: KLine[];
  is_20d_high: boolean;
  is_all_time_high: boolean;
  theme: string;
  themes: string[] | null;
}

export interface DashboardData {
  last_updated: string;
  stocks: StockData[];
}

export type MAPeriod = 5 | 10 | 20 | 60 | 120 | 240;
export type AlertFilter = 'all' | 'below' | 'above';
export type SortBy = 'change_percent' | 'volume' | 'ma_distance' | 'symbol';
export type SignalType = 'above' | 'below' | 'at';
// Badge-specific: crossover = just crossed today; near = within ±1%; neutral = static state
export type BadgeType = 'crossAbove' | 'crossBelow' | 'near' | 'neutral';

export interface MAProximityFilter {
  enabled: boolean;
  ma: MAPeriod;
  direction: 'above' | 'at' | 'below';
  threshold: number; // percentage, e.g. 3 means within 3%
}

export interface SpecialFilters {
  maBullishAlignment: boolean; // MA5 > MA10 > MA20 > MA60
  price20DayHigh: boolean;     // today close = 20-day high
  aboveWeeklyMA: boolean;      // price > MA5
  aboveMonthlyMA: boolean;     // price > MA20
  aboveQuarterlyMA: boolean;   // price > MA60
  allTimeHigh: boolean;        // today close = all-time high
}

export interface InstiFilters {
  foreignNetBuy: boolean;    // 外資買超 > 0
  trustNetBuy: boolean;      // 投信買超 > 0
  marginIncreasing: boolean; // 融資增加 > 0
  shortDecreasing: boolean;  // 融券減少 < 0
}

export const LAYER_NAMES: Record<number, string> = {
  // Theme A
  1: '晶片設計與製造', 2: '化合物半導體', 3: '記憶體',
  4: 'PCB 載板', 5: 'PCB 主機板', 6: '散熱電源',
  7: '光通訊 CPO', 8: '被動元件', 9: 'ODM 組裝', 10: '電力基礎建設',
  // Theme B
  11: '電池材料', 12: '三電傳動', 13: '車用線束', 14: '車燈光學', 15: '充電基建',
  // Theme C
  21: '減速機傳動', 22: '伺服馬達', 23: '機電整合', 24: '感測末端',
};

export const THEME_LABELS: Record<string, string> = {
  A: 'AI 伺服器',
  B: '電動車',
  C: '機器人',
};

export const LAYER_THEME: Record<number, string> = {
  1:'A',2:'A',3:'A',4:'A',5:'A',6:'A',7:'A',8:'A',9:'A',10:'A',
  11:'B',12:'B',13:'B',14:'B',15:'B',
  21:'C',22:'C',23:'C',24:'C',
};

export function layerShortCode(layerId: number): string {
  const theme = LAYER_THEME[layerId];
  if (theme === 'B') return `B-${layerId - 10}`;
  if (theme === 'C') return `C-${layerId - 20}`;
  return `L${layerId}`;
}

export const LAYER_ICONS: Record<number, string> = {
  // Theme A
  1: '🧠',   // 晶片設計與製造
  2: '⚛️',   // 化合物半導體
  3: '💾',   // 記憶體
  4: '🔌',   // PCB 載板
  5: '🔧',   // PCB 主機板
  6: '❄️',   // 散熱電源
  7: '💡',   // 光通訊 CPO
  8: '🔩',   // 被動元件
  9: '🖥️',   // ODM 組裝
  10: '⚡',  // 電力基礎建設
  // Theme B
  11: '🔋',  // 電池材料
  12: '⚙️',  // 三電傳動
  13: '🔗',  // 車用線束
  14: '🚗',  // 車燈光學
  15: '🔌',  // 充電基建
  // Theme C
  21: '🦾',  // 減速機傳動
  22: '🔄',  // 伺服馬達
  23: '🤖',  // 機電整合
  24: '👁️',  // 感測末端
};

export const THEME_COLORS: Record<string, string> = {
  A: '#58A6FF', // blue
  B: '#8BC34A', // green
  C: '#E91E63', // pink
};

/** Returns true if the stock belongs to this layer (primary OR secondary cross-theme layer). */
export function stockInLayer(stock: StockData, layerId: number): boolean {
  if (stock.layer === layerId) return true;
  if (stock.secondary_layers && stock.secondary_layers.includes(layerId)) return true;
  return false;
}
