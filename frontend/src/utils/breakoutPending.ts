/**
 * "Breakout-pending" pattern detector.
 *
 * Captures W-bottom / U-bottom / cup-with-handle / flat-base patterns via
 * their common signature: a prior high was made some time ago, price has
 * been consolidating since, and is now back near that high — about to
 * attempt a breakout.
 *
 * All metrics from daily klines the Dashboard already has loaded.
 */
import type { KLine, StockData } from '../types/stock';

export type PatternHint = 'double-bottom' | 'cup' | 'flat' | 'rounded' | 'other';

export interface BreakoutPending {
  /** Highest `high` price in the lookback window. This is the resistance. */
  priorHigh: number;
  /** How many trading days ago the prior high was made. */
  daysSinceHigh: number;
  /** (priorHigh − current_price) / priorHigh × 100, always ≥ 0 when pending. */
  gapPct: number;
  /** Number of swings that came within 2% of the prior high (retest count). */
  retests: number;
  /** Base depth: (priorHigh − lowest low since priorHigh) / priorHigh × 100. */
  baseDepth: number;
  /** Loose pattern classification — purely for card labelling. */
  pattern: PatternHint;
}

/**
 * Classify the base shape. Heuristic only — used as a label hint, not a gate.
 *   - double-bottom / W: the base has TWO distinct lows with similar prices
 *   - cup (咖啡杯): a smooth U followed by small pullback near the high
 *   - flat (一字型): range-bound, shallow base
 *   - rounded (U): gradual curve down then up, no clear double-low
 */
function classifyPattern(
  baseKlines: KLine[],
  priorHigh: number,
  baseDepth: number,
): PatternHint {
  if (baseKlines.length < 5) return 'other';
  const closes = baseKlines.map((k) => k.close);

  // Flat base — shallow (<12% depth) + range-bound
  if (baseDepth < 12) return 'flat';

  // Find the single lowest close in the base
  let minIdx = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] < closes[minIdx]) minIdx = i;
  }

  // Look for a second low in the OTHER half of the base that's within 5% of
  // the global min — that's a double-bottom signature.
  const globalMin = closes[minIdx];
  const firstHalf  = closes.slice(0, Math.floor(closes.length / 2));
  const secondHalf = closes.slice(Math.floor(closes.length / 2));
  const minFirst  = Math.min(...firstHalf);
  const minSecond = Math.min(...secondHalf);
  const bothLowsClose =
    Math.abs(minFirst - minSecond) / globalMin < 0.05 &&
    Math.min(minFirst, minSecond) < priorHigh * 0.95;
  if (bothLowsClose) return 'double-bottom';

  // Cup-with-handle: the main dip is in the FIRST 75% of the base, and the
  // last 25% is a shallow pullback from a local high.
  const handleStart = Math.floor(closes.length * 0.75);
  const bodyMax = Math.max(...closes.slice(0, handleStart));
  const handleMin = Math.min(...closes.slice(handleStart));
  const handleDepth = (bodyMax - handleMin) / bodyMax;
  const mainMinInBody = minIdx < handleStart;
  if (mainMinInBody && handleDepth > 0 && handleDepth < 0.10) return 'cup';

  // Default — rounded U
  return 'rounded';
}

export function analyzeBreakoutPending(
  stock: StockData,
  lookback: number,      // e.g. 60
  thresholdPct: number,  // e.g. 5 (%)
  minBaseDays: number,   // e.g. 15
): BreakoutPending | null {
  const k = stock.klines;
  const price = stock.current_price;
  if (price === null || price <= 0 || k.length < Math.max(lookback, minBaseDays + 5)) {
    return null;
  }
  const window = k.slice(-Math.min(lookback, k.length));

  // Find the single highest 'high' in the window
  let maxIdx = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].high > window[maxIdx].high) maxIdx = i;
  }
  const priorHigh = window[maxIdx].high;
  const daysSinceHigh = window.length - 1 - maxIdx;

  // Gate 1 — high must be far enough back to count as a base
  if (daysSinceHigh < minBaseDays) return null;

  // Gate 2 — current price must be below but close to the high
  if (priorHigh <= 0) return null;
  const gapPct = ((priorHigh - price) / priorHigh) * 100;
  if (gapPct < 0 || gapPct > thresholdPct) return null;

  // Base metrics — only look at bars AFTER the prior high
  const basePart = window.slice(maxIdx);
  const lowest = Math.min(...basePart.map((x) => x.low));
  const baseDepth = ((priorHigh - lowest) / priorHigh) * 100;

  // Retest count — bars whose high came within 2% of priorHigh
  const retestThreshold = priorHigh * 0.98;
  const retests = basePart.filter((x) => x.high >= retestThreshold).length;

  const pattern = classifyPattern(basePart, priorHigh, baseDepth);

  return { priorHigh, daysSinceHigh, gapPct, retests, baseDepth, pattern };
}

export function patternLabel(p: PatternHint): string {
  switch (p) {
    case 'double-bottom': return 'W 底';
    case 'cup':           return '咖啡杯';
    case 'flat':          return '平底 / 一字';
    case 'rounded':       return 'U 型';
    default:              return '基底';
  }
}
