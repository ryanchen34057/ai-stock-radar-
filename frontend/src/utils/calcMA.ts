import type { MAPeriod, MAValues, SignalType, BadgeType } from '../types/stock';

const MA_PERIODS: MAPeriod[] = [5, 10, 20, 60, 120, 240];

export function calculateMAFull(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
  });
}

export function getSignal(close: number | null, ma: number | null): SignalType {
  if (close === null || ma === null || ma === 0) return 'at';
  const ratio = (close - ma) / ma;
  if (ratio > 0.01) return 'above';
  if (ratio < -0.01) return 'below';
  return 'at';
}

export function getMaDistance(close: number | null, ma: number | null): number | null {
  if (close === null || ma === null || ma === 0) return null;
  return Math.round(((close - ma) / ma) * 10000) / 100;
}

export function getSelectedMA(
  maValues: Record<string, number | null>,
  period: MAPeriod
): number | null {
  return maValues[String(period)] ?? null;
}

/** Find the MA closest to the current price (for 貼線 detection). */
export function findNearestMA(
  close: number | null,
  maValues: MAValues,
): { period: MAPeriod; distance: number } | null {
  if (close === null) return null;
  let best: { period: MAPeriod; distance: number } | null = null;
  for (const period of MA_PERIODS) {
    const ma = maValues[String(period) as keyof MAValues];
    if (ma === null || ma === undefined || ma === 0) continue;
    const dist = getMaDistance(close, ma);
    if (dist === null) continue;
    if (best === null || Math.abs(dist) < Math.abs(best.distance)) {
      best = { period, distance: dist };
    }
  }
  return best;
}

/**
 * Detect which MA (if any) the price just crossed on the most recent candle.
 * Uses prevClose vs today's MA as reference — valid approximation for daily data.
 * Returns the HIGHEST-period MA that was crossed (most significant signal).
 */
export function findBestCrossSignal(
  prevClose: number | null,
  currentClose: number | null,
  maValues: MAValues,
): { period: MAPeriod; type: Exclude<BadgeType, 'near' | 'neutral'> } | null {
  if (prevClose === null || currentClose === null) return null;
  let best: { period: MAPeriod; type: 'crossAbove' | 'crossBelow' } | null = null;
  for (const period of MA_PERIODS) {
    const ma = maValues[String(period) as keyof MAValues];
    if (!ma || ma === 0) continue;
    let type: 'crossAbove' | 'crossBelow' | null = null;
    if (prevClose < ma && currentClose >= ma) type = 'crossAbove';
    else if (prevClose > ma && currentClose <= ma) type = 'crossBelow';
    if (type && (!best || period > best.period)) {
      best = { period, type };
    }
  }
  return best;
}
