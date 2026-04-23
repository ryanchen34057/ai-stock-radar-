/**
 * 碗型態 (Cup / Rounded Bottom) pattern detection.
 *
 * Classic William O'Neil cup-and-handle / rounded bottom:
 *   1. Prior uptrend makes a high (左沿 "rim")
 *   2. Price pulls back into a rounded consolidation (not V-shaped)
 *   3. Price recovers toward the prior high (right rim)
 *
 * Detection heuristic over the last `window` bars:
 *   - Rim high lives in the first 40% of window
 *   - Bottom low lives between the rim and the last 15% of window
 *   - Drawdown from rim to bottom is at least minDrawdownPct
 *   - Current close has recovered >= recoveryPct of the rim-to-bottom range
 *   - Bottom is "wide" — at least minBottomBars closes sit within 5% of the
 *     absolute low (rules out sharp V-bottoms; a true rounded bowl spends
 *     many bars near the trough)
 */

export interface BowlPatternResult {
  triggered: boolean;
  rimHigh: number;
  rimIndexInWindow: number;
  bottomLow: number;
  bottomIndexInWindow: number;
  drawdownPct: number;
  recoveryPct: number;
  bottomWidth: number;   // # of bars within 5% of the absolute low
}

export type BowlStrictness = 'loose' | 'moderate' | 'strict';

const PRESETS: Record<BowlStrictness, {
  window: number;
  minDrawdownPct: number;
  maxDrawdownPct: number;
  recoveryPct: number;
  minBottomBars: number;
}> = {
  loose:    { window: 90,  minDrawdownPct: 10, maxDrawdownPct: 50, recoveryPct: 60, minBottomBars: 4  },
  moderate: { window: 90,  minDrawdownPct: 15, maxDrawdownPct: 50, recoveryPct: 75, minBottomBars: 6  },
  strict:   { window: 120, minDrawdownPct: 20, maxDrawdownPct: 50, recoveryPct: 85, minBottomBars: 10 },
};

export function analyzeBowlPattern(
  closes: number[],
  strictness: BowlStrictness = 'moderate',
): BowlPatternResult | null {
  const cfg = PRESETS[strictness];
  const { window, minDrawdownPct, maxDrawdownPct, recoveryPct, minBottomBars } = cfg;

  if (closes.length < window) return null;
  const slice = closes.slice(-window);
  const n = slice.length;

  // 1. Rim: highest close in the first 40% of the window
  const rimRegionEnd = Math.floor(n * 0.40);
  let rimHigh = -Infinity;
  let rimIdx = 0;
  for (let i = 0; i < rimRegionEnd; i++) {
    if (slice[i] > rimHigh) { rimHigh = slice[i]; rimIdx = i; }
  }
  if (!Number.isFinite(rimHigh)) return null;

  // 2. Bottom: lowest close between rim and last 15% of window
  const bottomStart = rimIdx + 1;
  const bottomEnd = Math.floor(n * 0.85);
  if (bottomEnd <= bottomStart) return null;
  let bottomLow = Infinity;
  let bottomIdx = bottomStart;
  for (let i = bottomStart; i < bottomEnd; i++) {
    if (slice[i] < bottomLow) { bottomLow = slice[i]; bottomIdx = i; }
  }
  if (!Number.isFinite(bottomLow) || bottomLow <= 0) return null;

  // 3. Metrics
  const current = slice[n - 1];
  const drawdownPct = ((rimHigh - bottomLow) / rimHigh) * 100;
  const range = rimHigh - bottomLow;
  const recoveryPctActual = range === 0 ? 0 : ((current - bottomLow) / range) * 100;

  // 4. Bottom width = bars within 5% of the absolute low
  const bottomBand = bottomLow * 1.05;
  let bottomWidth = 0;
  for (const c of slice) {
    if (c <= bottomBand) bottomWidth++;
  }

  // 5. Rounded-ness guard: bottom index must lie in the middle portion of
  //    the window (rules out patterns where the low is near the start or end)
  const bottomPosition = bottomIdx / n;
  const bottomInMiddle = bottomPosition >= 0.20 && bottomPosition <= 0.75;

  const triggered =
    drawdownPct >= minDrawdownPct &&
    drawdownPct <= maxDrawdownPct &&
    recoveryPctActual >= recoveryPct &&
    bottomWidth >= minBottomBars &&
    bottomInMiddle;

  return {
    triggered,
    rimHigh,
    rimIndexInWindow: rimIdx,
    bottomLow,
    bottomIndexInWindow: bottomIdx,
    drawdownPct,
    recoveryPct: recoveryPctActual,
    bottomWidth,
  };
}
