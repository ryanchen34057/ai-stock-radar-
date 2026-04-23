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
 * "Band-expansion from squeeze" signal — true when:
 *   1. Current BBW is meaningfully above its recent minimum
 *      (expansionRatio, default 1.3x = 30% wider than squeeze bottom)
 *   2. The squeeze bottom was within the last `squeezeLookback` bars
 *      (recently squeezed, not just coming off a year-old tight)
 *   3. BBW is currently rising (today > some bars back)
 *
 * Returns { triggered, currentBBW, minBBW, minBBWIndex } for both filter + badge.
 */
export interface BBExpansionResult {
  triggered: boolean;
  currentBBW: number;
  minBBW: number;
  daysSinceSqueeze: number;
  expansionPct: number;   // (current - min) / min × 100
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
    squeezeLookback?: number;   // window in which the squeeze-low must lie
    expansionRatio?: number;    // current / min threshold
    risingLookback?: number;    // days back to confirm BBW is rising
  } = {},
): BBExpansionResult | null {
  const period = opts.period ?? 20;
  const stdev = opts.stdev ?? 2;
  const lookback = opts.squeezeLookback ?? 15;
  const expRatio = opts.expansionRatio ?? 1.3;
  const risingLB = opts.risingLookback ?? 3;

  const bbw = calculateBBW(closes, period, stdev);
  const n = bbw.length;
  if (n === 0) return null;

  const current = bbw[n - 1];
  if (current === null) return null;

  // Look back `lookback` bars (plus a small buffer so we capture the bottom tick)
  const start = Math.max(0, n - 1 - lookback);
  let minVal = Infinity;
  let minIdx = -1;
  for (let i = start; i < n; i++) {
    const v = bbw[i];
    if (v !== null && v < minVal) {
      minVal = v;
      minIdx = i;
    }
  }
  if (minIdx < 0 || minVal === 0) return null;

  const daysSince = n - 1 - minIdx;
  const expansionPct = ((current - minVal) / minVal) * 100;

  // Rising confirmation: today > N bars back (simple slope check)
  const pastIdx = Math.max(0, n - 1 - risingLB);
  const past = bbw[pastIdx];
  const rising = past !== null && current > past;

  const triggered =
    current >= minVal * expRatio      // expanded enough off the low
    && daysSince >= 1                 // low was yesterday or earlier
    && daysSince <= lookback          // low was recent
    && rising;                        // currently widening, not contracting

  return {
    triggered,
    currentBBW: current,
    minBBW: minVal,
    daysSinceSqueeze: daysSince,
    expansionPct,
  };
}
