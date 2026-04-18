import type { MAPeriod, MAValues, SignalType } from '../types/stock';

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

/** Find the MA closest to the current price — used to show which MA is actually being tested. */
export function findNearestMA(
  close: number | null,
  maValues: MAValues,
): { period: MAPeriod; signal: SignalType; distance: number } | null {
  if (close === null) return null;
  let best: { period: MAPeriod; signal: SignalType; distance: number } | null = null;
  for (const period of MA_PERIODS) {
    const ma = maValues[String(period) as keyof MAValues];
    if (ma === null || ma === undefined || ma === 0) continue;
    const dist = getMaDistance(close, ma);
    if (dist === null) continue;
    if (best === null || Math.abs(dist) < Math.abs(best.distance)) {
      best = { period, signal: getSignal(close, ma), distance: dist };
    }
  }
  return best;
}
