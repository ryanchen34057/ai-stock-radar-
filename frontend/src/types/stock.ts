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
  market?: 'TW' | 'US';
  exchange?: string | null;
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
  eps_current_year: number | null;
  eps_forward: number | null;
  forward_pe: number | null;
  dividend_yield: number | null;      // yfinance %, (fallback)
  pb_ratio: number | null;            // decimal multiple, e.g. 8.9 = 8.9x
  roe: number | null;                 // decimal, e.g. 0.3621 = 36.21%
  revenue_growth: number | null;      // yfinance quarterly YoY (fallback)
  // FinMind (preferred when present)
  ttm_eps: number | null;             // sum of latest 4 quarterly basic EPS
  monthly_revenue_yoy: number | null; // latest month revenue YoY, already percentage
  ttm_dividend: number | null;        // NTD per share, trailing 12m cash
  ttm_dividend_yield: number | null;  // percentage (ttm_dividend / current price)
  ma: MAValues;
  klines: KLine[];
  is_20d_high: boolean;
  is_all_time_high: boolean;
  theme: string;
  themes: string[] | null;
  tier?: number;       // 1=核心, 2=衛星, 3=觀察
  enabled?: boolean;
  eps_annual?: EpsAnnualRow[];
  eps_quarterly?: EpsQuarterlyRow[];
  disposal?: {
    symbol: string;
    name: string;
    reason: string;
    measure: string;
    start_date: string;
    end_date: string;
    source: string;
  } | null;
  data_complete?: boolean;
  kline_count?: number;
  /** TDCC 集保週報 — 千張大戶（level 15, 1,000,001 股以上）*/
  big_holder?: {
    date: string;                   // YYYYMMDD latest snapshot
    count: number;                  // 人數 (latest week)
    pct: number;                    // 佔集保庫存數比例% (latest week)
    prev_date: string | null;
    prev_count: number | null;
    prev_pct: number | null;
    count_change_pct: number | null; // (latest - prev) / prev × 100, signed
    pct_change: number | null;       // absolute percentage-point change
  } | null;
}

export type ThemeFilter =
  // Taiwan themes
  | 'A' | 'B' | 'C'
  // US GICS 11 sectors
  | 'IT' | 'HC' | 'FN' | 'CD' | 'CS' | 'CM' | 'IN' | 'EN' | 'MT' | 'UT' | 'RE'
  // Cross-cutting
  | 'all' | 'cross';
export type TierFilter = 1 | 2 | 3; // 1=僅 T1, 2=T1+T2, 3=全部

export interface EpsAnnualRow {
  year: number;
  basic_eps: number | null;
  diluted_eps: number | null;
}

export interface EpsQuarterlyRow {
  period_end: string;
  basic_eps: number | null;
  diluted_eps: number | null;
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

/**
 * Latest trading-day K-line pattern filter.
 *   color='red'   — close > open (bullish candle, 紅K)
 *   color='black' — close < open (bearish candle, 黑K)
 *   minPct/maxPct — absolute daily change_percent range vs previous close.
 *     Red K uses positive range [minPct, maxPct].
 *     Black K uses negative range [-maxPct, -minPct].
 */
export interface CandleFilter {
  enabled: boolean;
  color: 'red' | 'black';
  minPct: number;   // 0-30
  maxPct: number;   // 0-30
}

/**
 * "Breakout-pending" filter — find stocks that built a base after a prior
 * high and are now re-approaching that high. Catches W-bottoms, U-bottoms,
 * cup-with-handle and flat-base patterns all at once.
 *
 *   lookback         — window to find the prior high
 *   threshold        — how close (%) current price must be below the high
 *   minBaseDays      — how many bars ago the high must be (rules out 1-2d
 *                      pullbacks that haven't actually formed a base)
 */
export interface BreakoutPendingFilter {
  enabled: boolean;
  lookback: number;     // e.g. 60 days — window to find the resistance high
  threshold: number;    // e.g. 5 (%) — within this much below the high
  minBaseDays: number;  // e.g. 15 — high must be at least this many bars ago
}

/**
 * "站上布林上軌" filter — stocks whose most recent close crossed above the
 * upper Bollinger Band within the last N trading days. Strong-momentum
 * breakout signal per the Bollinger trend-following interpretation.
 *
 *   withinDays       — cross must have happened within this many bars
 *   requireStillAbove — if true, today's close must ALSO still be at/above
 *                       the upper band (filters out pullbacks that have since
 *                       re-entered the band)
 */
export interface BBUpperCrossFilter {
  enabled: boolean;
  withinDays: number;     // 1 / 3 / 5 / 7 / 10
  requireStillAbove: boolean;
}

/**
 * BB 相對位置 filter — where today's close sits relative to a chosen band.
 *
 *   band       — upper / middle / lower
 *   direction  — close is `above` / `below` / `at` (within ±threshold of) the band
 *   threshold  — percentage distance
 *
 * Example: { band: 'upper', direction: 'at', threshold: 2 }
 *          → close is within ±2% of upper band (贴近上軌)
 * Example: { band: 'lower', direction: 'below', threshold: 3 }
 *          → close is 0–3% below lower band (穿破下軌的程度)
 */
export interface BBProximityFilter {
  enabled: boolean;
  band: 'upper' | 'middle' | 'lower';
  direction: 'above' | 'at' | 'below';
  threshold: number;
}

/**
 * "布林通道狹窄" filter — catch stocks currently in a squeeze (precursor to
 * breakout). Level is a percentile threshold over last 120 bars' BBW:
 *   mild     — current BBW ≤ 40th percentile (slightly compressed)
 *   moderate — current BBW ≤ 25th percentile (quite compressed)
 *   extreme  — current BBW ≤ 10th percentile (very compressed, imminent breakout)
 */
export type BBSqueezeLevel = 'mild' | 'moderate' | 'extreme';
export interface BBSqueezeFilter {
  enabled: boolean;
  level: BBSqueezeLevel;
}

/**
 * "突破前高放量" filter — stocks that just cleared a multi-month resistance
 * close on volume expansion. Classic flat-base / cup-with-handle breakout.
 *
 *   lookback         — window to scan for the prior high (e.g. 120 days)
 *   excludeRecent    — ignore the last N bars when picking the high so a
 *                      stock making a brand-new high TODAY measures itself
 *                      against the older base, not the breakout candle
 *   maxAbovePct      — today's close must be no more than this % above the
 *                      prior high (keeps the signal "fresh")
 *   volumeMultiplier — today's volume / MV20 threshold (e.g. 1.5x = 量增)
 */
export interface BreakoutVolumeFilter {
  enabled: boolean;
  lookback: number;
  excludeRecent: number;
  maxAbovePct: number;
  volumeMultiplier: number;
}

/**
 * "碗型態" filter — classic William O'Neil cup/rounded-bottom pattern.
 *   loose    — 寬鬆：drawdown ≥ 10%、回升 ≥ 60%、鍋底 ≥ 4 bar
 *   moderate — 中度：drawdown ≥ 15%、回升 ≥ 75%、鍋底 ≥ 6 bar
 *   strict   — 嚴格：drawdown ≥ 20%、回升 ≥ 85%、鍋底 ≥ 10 bar
 */
export type BowlStrictness = 'loose' | 'moderate' | 'strict';
export interface BowlPatternFilter {
  enabled: boolean;
  strictness: BowlStrictness;
}

export interface SpecialFilters {
  maBullishAlignment: boolean; // MA5 > MA10 > MA20 > MA60
  price20DayHigh: boolean;     // today close = 20-day high
  aboveWeeklyMA: boolean;      // price > MA5
  aboveMonthlyMA: boolean;     // price > MA20
  aboveQuarterlyMA: boolean;   // price > MA60
  allTimeHigh: boolean;        // today close = all-time high
  gapUp: boolean;              // 跳空向上: today low > yesterday high
  gapDown: boolean;            // 跳空向下: today high < yesterday low
  pullbackReclaim5:  boolean;  // last 5d pulled back to / below MA5,  today close > MA5
  pullbackReclaim10: boolean;  // last 5d pulled back to / below MA10, today close > MA10
  pullbackReclaim20: boolean;  // last 5d pulled back to / below MA20, today close > MA20
  bigHolderIncrease: boolean;  // TDCC 千張大戶 count_change_pct > 0 week-over-week
  bbExpansion: boolean;        // 布林通道剛打開: squeeze-low 在最近 15 日內, 現 BBW ≥ squeeze × 1.3 且正在擴張
  longBullish: boolean;        // 長紅: close>open, 漲幅>4%, 實體 > 2/3 當日 K 棒
  lowHammer: boolean;          // 低檔槌子: hammer K 棒 (下影 ≥ 2× 實體, 上影極小) 出現在 10 日新低附近, 暗示反轉
}

export interface RangeFilter {
  enabled: boolean;
  min: number | null;
  max: number | null;
}

export interface InstiFilters {
  foreignNetBuy: boolean;    // 外資買超 > 0
  trustNetBuy: boolean;      // 投信買超 > 0
  marginIncreasing: boolean; // 融資增加 > 0
  shortDecreasing: boolean;  // 融券減少 < 0
}

export interface KDFilters {
  golden: boolean;      // 今日黃金交叉
  death: boolean;       // 今日死亡交叉
  up: boolean;          // K 向上 (無交叉)
  down: boolean;        // K 向下 (無交叉)
  oversold: boolean;    // K < 20 (超賣)
  overbought: boolean;  // K > 80 (超買)
}

export const LAYER_NAMES: Record<number, string> = {
  // ── Taiwan market (layers 1-26) ────────────────────────────────────────
  // Theme A (ids 1-10, plus 16-19 and 25-26 for later layers that would
  // otherwise collide with Theme B/C ids)
  1: '晶片設計與製造', 2: '化合物半導體', 3: '記憶體',
  4: 'PCB 載板', 5: 'PCB 主機板', 6: '散熱電源',
  7: '光通訊 CPO', 8: '被動元件', 9: 'ODM 組裝', 10: '電力基礎建設',
  16: '半導體設備與精密零組件', // Theme A L11
  17: '特用化學材料',            // Theme A L12
  18: '機殼滑軌結構件',          // Theme A L13
  19: '測試封測介面',            // Theme A L14
  25: '連接器與線材',            // Theme A L15
  26: '工業電腦邊緣 AI',         // Theme A L16
  // Theme B
  11: '電池材料', 12: '三電傳動', 13: '車用線束', 14: '車燈光學', 15: '充電基建',
  // Theme C
  21: '減速機傳動', 22: '伺服馬達', 23: '機電整合', 24: '感測末端',

  // ── US market (layers 101-111, GICS 11 sectors) ────────────────────────
  101: '資訊科技',    102: '醫療保健',    103: '金融',
  104: '非必需消費',  105: '必需消費',    106: '通訊服務',
  107: '工業',        108: '能源',        109: '原物料',
  110: '公用事業',    111: '房地產',
};

export const THEME_LABELS: Record<string, string> = {
  // Taiwan
  A: 'AI 伺服器',
  B: '電動車',
  C: '機器人',
  // US (GICS 11 sectors — 2-letter codes to avoid collision with A/B/C)
  IT: '資訊科技',
  HC: '醫療保健',
  FN: '金融',
  CD: '非必需消費',
  CS: '必需消費',
  CM: '通訊服務',
  IN: '工業',
  EN: '能源',
  MT: '原物料',
  UT: '公用事業',
  RE: '房地產',
};

export const LAYER_THEME: Record<number, string> = {
  // Taiwan
  1:'A',2:'A',3:'A',4:'A',5:'A',6:'A',7:'A',8:'A',9:'A',10:'A',
  16:'A',17:'A',18:'A',19:'A',25:'A',26:'A',
  11:'B',12:'B',13:'B',14:'B',15:'B',
  21:'C',22:'C',23:'C',24:'C',
  // US — one layer per GICS sector (for phase 1; sub_category = yfinance industry)
  101:'IT', 102:'HC', 103:'FN', 104:'CD', 105:'CS', 106:'CM',
  107:'IN', 108:'EN', 109:'MT', 110:'UT', 111:'RE',
};

// Display number within theme — for Theme A these are ids 16-19/25-26 that
// would collide with Theme B/C ids (11-15, 21-24) if we used them directly.
const LAYER_DISPLAY_NUM: Record<number, number> = {
  16: 11, 17: 12, 18: 13, 19: 14, 25: 15, 26: 16,
};

export function layerShortCode(layerId: number): string {
  const theme = LAYER_THEME[layerId];
  if (theme === 'B') return `B-${layerId - 10}`;
  if (theme === 'C') return `C-${layerId - 20}`;
  return `L${LAYER_DISPLAY_NUM[layerId] ?? layerId}`;
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
  16: '🛠️',  // 半導體設備與精密零組件 (Theme A L11)
  17: '🧪',  // 特用化學材料 (L12)
  18: '📦',  // 機殼滑軌結構件 (L13)
  19: '🔬',  // 測試封測介面 (L14)
  25: '🧲',  // 連接器與線材 (L15)
  26: '💻',  // 工業電腦邊緣 AI (L16)
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
