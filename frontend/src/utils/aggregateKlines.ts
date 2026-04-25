/**
 * Daily → weekly / monthly K-line aggregation.
 *
 * Each output bar:
 *   - date   = the LAST trading day inside the bucket (so the chart x-axis
 *              lines up with the close)
 *   - open   = first day's open
 *   - high   = max high in the bucket
 *   - low    = min low in the bucket
 *   - close  = last day's close
 *   - volume = sum of daily volumes
 *
 * Weekly buckets are ISO-week (Monday-start), so a US Mon-Fri week and a
 * Taiwanese Mon-Fri week both collapse to one weekly bar.
 */
import type { KLine } from '../types/stock';

export type KPeriod = 'D' | 'W' | 'M';

function weekStart(dateStr: string): string {
  // Treat YYYY-MM-DD as a UTC date and snap back to its Monday.
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;       // Sunday(0) -> 7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dow - 1));
  return monday.toISOString().slice(0, 10);
}

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7);            // YYYY-MM
}

export function aggregateKlines(klines: KLine[], period: KPeriod): KLine[] {
  if (period === 'D' || klines.length === 0) return klines;

  const keyOf = period === 'W' ? weekStart : monthStart;

  const buckets = new Map<string, KLine[]>();
  const order: string[] = [];
  for (const k of klines) {
    const key = keyOf(k.date);
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
      order.push(key);
    }
    arr.push(k);
  }

  const out: KLine[] = [];
  for (const key of order) {
    const g = buckets.get(key)!;
    out.push({
      date:   g[g.length - 1].date,
      open:   g[0].open,
      high:   Math.max(...g.map((x) => x.high)),
      low:    Math.min(...g.map((x) => x.low)),
      close:  g[g.length - 1].close,
      volume: g.reduce((s, x) => s + (x.volume || 0), 0),
    });
  }
  return out;
}

/**
 * Convert a daily-bar window (e.g. "65 daily bars ≈ 3 months") into the
 * equivalent bar count for a weekly or monthly chart, using rough trading-
 * day-per-period averages (5 and 21).
 */
export function rescaleBarsForPeriod(daysWindow: number, period: KPeriod): number {
  if (period === 'W') return Math.max(8,  Math.ceil(daysWindow / 5));
  if (period === 'M') return Math.max(6,  Math.ceil(daysWindow / 21));
  return daysWindow;
}
