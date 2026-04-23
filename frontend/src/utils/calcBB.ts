/**
 * Bollinger Bands (20, 2) utilities.
 *
 * BBW (Bollinger Band Width) = (upper - lower) / middle
 *   A compressed / squeeze market has a low BBW (often < 10%);
 *   "band expansion" = BBW rising off that low.
 */

const DEFAULT_PERIOD = 20;
const DEFAULT_STDEV = 2;

/** Rolling mean + standard deviation over a window. */
function rollingStats(closes: number[], period: number): { ma: (number | null)[]; sd: (number | null)[] } {
  const ma: (number | null)[] = new Array(closes.length).fill(null);
  const sd: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return { ma, sd };

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - mean) ** 2;
    ma[i] = mean;
    sd[i] = Math.sqrt(sqSum / period);
  }
  return { ma, sd };
}

/** Compute full Bollinger Band series (upper / middle / lower). Nulls before window fills. */
export function calculateBollingerBands(
  closes: number[],
  period: number = DEFAULT_PERIOD,
  stdev: number = DEFAULT_STDEV,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const { ma, sd } = rollingStats(closes, period);
  const upper = ma.map((m, i) =>
    m === null || sd[i] === null ? null : m + stdev * sd[i]!);
  const lower = ma.map((m, i) =>
    m === null || sd[i] === null ? null : m - stdev * sd[i]!);
  return { upper, middle: ma, lower };
}

/** Compute BBW series (as percentage: 100 × (upper-lower)/middle). Nulls where window is incomplete. */
export function calculateBBW(
  closes: number[],
  period: number = DEFAULT_PERIOD,
  stdev: number = DEFAULT_STDEV,
): (number | null)[] {
  const { ma, sd } = rollingStats(closes, period);
  return ma.map((m, i) => {
    if (m === null || sd[i] === null || m === 0) return null;
    const s = sd[i]!;
    const upper = m + stdev * s;
    const lower = m - stdev * s;
    return ((upper - lower) / m) * 100;
  });
}

/**
 * "布林通道剛打開" signal -- specific bullish squeeze-breakout pattern:
 *   1. 通道原先被壓縮: BBW at the cross day is near its pre-cross minimum
 *      (squeeze was still in effect right up to the breakout bar)
 *   2. 最近收盤突破上軌: a close cross-up above upper band within N bars
 *   3. 空間開始打開: today's BBW is meaningfully above the squeeze low
 *
 * Returns null if not enough history.
 */
export interface BBExpansionResult {
  triggered: boolean;
  daysSinceCross: number;
  squeezeBBW: number;       // pre-cross BBW low
  crossBBW: number;         // BBW on the cross day
  todayBBW: number;         // current BBW
  expansionPct: number;     // (today - squeezeLow) / squeezeLow × 100
}

/**
 * "布林通道狹窄" detection — current BBW percentile over recent history.
 * Returns the percentile (0-100) where current BBW sits within the last N
 * trading days' BBW distribution. Low percentile = squeeze (通道狹窄).
 *
 *   history: number of bars to use as the reference distribution (default 120)
 */
export interface BBSqueezeResult {
  percentile: number;    // 0-100, lower = tighter
  currentBBW: number;
  minBBW: number;        // min BBW over the history window
  medianBBW: number;
}

export function analyzeBBSqueeze(
  closes: number[],
  opts: { history?: number; period?: number; stdev?: number } = {},
): BBSqueezeResult | null {
  const history = opts.history ?? 120;
  const period = opts.period ?? 20;
  const stdev = opts.stdev ?? 2;

  const bbw = calculateBBW(closes, period, stdev);
  const n = bbw.length;
  if (n < period + 5) return null;

  const current = bbw[n - 1];
  if (current === null) return null;

  // Build sample of recent BBW values
  const start = Math.max(period - 1, n - history);
  const sample: number[] = [];
  for (let i = start; i < n; i++) {
    const v = bbw[i];
    if (v !== null) sample.push(v);
  }
  if (sample.length < 10) return null;

  const sorted = [...sample].sort((a, b) => a - b);
  // Rank of current value within sorted sample
  const rank = sorted.filter((x) => x <= current).length;
  const percentile = (rank / sorted.length) * 100;

  return {
    percentile,
    currentBBW: current,
    minBBW: sorted[0],
    medianBBW: sorted[Math.floor(sorted.length / 2)],
  };
}


/**
 * "剛站上布林上軌" signal — detect the most recent close ≥ upper-band cross-up
 * (close was below yesterday, at/above today). Returns how many trading days
 * ago the cross happened so callers can gate by a window.
 *
 *   withinDays: cross must be within the last N trading days
 *   requireStillAbove: if true, today's close must ALSO still be >= upper
 *                      (i.e. sustained breakout); if false, we only care the
 *                      cross was recent, even if price has pulled back below.
 */
export interface BBUpperCrossResult {
  triggered: boolean;
  daysSinceCross: number | null;   // null if no cross found in window
  currentPctB: number | null;      // 0=on lower, 0.5=mid, 1=on upper
}

export function analyzeBBUpperCross(
  closes: number[],
  opts: {
    withinDays?: number;
    period?: number;
    stdev?: number;
    requireStillAbove?: boolean;
  } = {},
): BBUpperCrossResult | null {
  const withinDays = opts.withinDays ?? 3;
  const period = opts.period ?? 20;
  const stdev = opts.stdev ?? 2;
  const requireStill = opts.requireStillAbove ?? false;

  const { upper, lower } = calculateBollingerBands(closes, period, stdev);
  const n = closes.length;
  if (n < period + 2) return null;

  const todayUp = upper[n - 1];
  const todayLo = lower[n - 1];
  const todayClose = closes[n - 1];
  const currentPctB = (todayUp !== null && todayLo !== null && todayUp !== todayLo)
    ? (todayClose - todayLo) / (todayUp - todayLo)
    : null;

  // Search backwards for the most recent cross-up bar
  let crossDay = -1;
  const searchStart = Math.max(1, n - withinDays - 1);
  for (let i = n - 1; i >= searchStart; i--) {
    const u = upper[i];
    const uPrev = upper[i - 1];
    if (u === null || uPrev === null) continue;
    if (closes[i] >= u && closes[i - 1] < uPrev) {
      crossDay = i;
      break;
    }
  }

  if (crossDay < 0) {
    return { triggered: false, daysSinceCross: null, currentPctB };
  }

  const daysSince = n - 1 - crossDay;
  let triggered = daysSince <= withinDays;
  if (requireStill && todayUp !== null) {
    triggered = triggered && todayClose >= todayUp;
  }
  return { triggered, daysSinceCross: daysSince, currentPctB };
}


export function analyzeBBExpansion(
  closes: number[],
  opts: {
    period?: number;
    stdev?: number;
    crossWindowDays?: number;    // cross-up must be within this many bars
    squeezePreRange?: number;    // bars BEFORE cross to scan for squeeze low
    squeezeTolerance?: number;   // cross-day BBW <= preMin × this (1.2 = within 20%)
    expansionRatio?: number;     // today BBW >= preMin × this      (1.2 = 20% wider)
  } = {},
): BBExpansionResult | null {
  const period = opts.period ?? 20;
  const stdev = opts.stdev ?? 2;
  const crossWindow = opts.crossWindowDays ?? 10;     // catch breakouts up to 2 weeks old
  const preRange = opts.squeezePreRange ?? 20;
  const squeezeTol = opts.squeezeTolerance ?? 1.5;    // cross-day BBW within 50% of pre-min
  const expRatio = opts.expansionRatio ?? 1.15;        // only need 15% expansion to trigger

  const bbw = calculateBBW(closes, period, stdev);
  const { upper } = calculateBollingerBands(closes, period, stdev);
  const n = closes.length;
  if (n < period + preRange + 1) return null;

  // 1. Find the most recent cross-up bar (close crosses above upper band)
  let crossDay = -1;
  const searchFrom = Math.max(1, n - crossWindow - 1);
  for (let i = n - 1; i >= searchFrom; i--) {
    const u = upper[i];
    const uPrev = upper[i - 1];
    if (u === null || uPrev === null) continue;
    if (closes[i] >= u && closes[i - 1] < uPrev) {
      crossDay = i;
      break;
    }
  }
  if (crossDay < 0) return null;

  // 2. Was BBW compressed right up to the breakout? Scan `preRange` bars
  //    before the cross for the minimum BBW.
  const preStart = Math.max(0, crossDay - preRange);
  let preMin = Infinity;
  for (let i = preStart; i < crossDay; i++) {
    const v = bbw[i];
    if (v !== null && v < preMin) preMin = v;
  }
  if (!Number.isFinite(preMin) || preMin === 0) return null;

  const crossBBW = bbw[crossDay];
  const todayBBW = bbw[n - 1];
  if (crossBBW === null || todayBBW === null) return null;

  const squeezeTight = crossBBW <= preMin * squeezeTol;  // bands still tight at breakout
  const hasExpanded  = todayBBW >= preMin * expRatio;    // bands have widened since
  const daysSinceCross = n - 1 - crossDay;

  return {
    triggered: squeezeTight && hasExpanded,
    daysSinceCross,
    squeezeBBW: preMin,
    crossBBW,
    todayBBW,
    expansionPct: ((todayBBW - preMin) / preMin) * 100,
  };
}
