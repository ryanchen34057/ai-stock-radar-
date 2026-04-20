export interface OHLC {
  high: number;
  low: number;
  close: number;
}

export type KDTrend = 'golden' | 'death' | 'up' | 'down' | 'flat' | 'unknown';

/**
 * Taiwan-style KD (Stochastic): period=5, K-smooth=3, D-smooth=3.
 *   RSV = (close - lowestLow_n) / (highestHigh_n - lowestLow_n) * 100
 *   K_t = (2 * K_{t-1} + RSV_t) / 3      (seed K=50)
 *   D_t = (2 * D_{t-1} + K_t) / 3        (seed D=50)
 */
export function calculateKD(
  klines: OHLC[],
  period = 5,
  kSmooth = 3,
  dSmooth = 3,
): { k: (number | null)[]; d: (number | null)[] } {
  const k: (number | null)[] = [];
  const d: (number | null)[] = [];
  let prevK = 50;
  let prevD = 50;

  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) {
      k.push(null);
      d.push(null);
      continue;
    }
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (klines[j].high > hh) hh = klines[j].high;
      if (klines[j].low < ll) ll = klines[j].low;
    }
    const close = klines[i].close;
    const rsv = hh === ll ? 50 : ((close - ll) / (hh - ll)) * 100;
    const currK = ((kSmooth - 1) * prevK + rsv) / kSmooth;
    const currD = ((dSmooth - 1) * prevD + currK) / dSmooth;
    k.push(Math.round(currK * 100) / 100);
    d.push(Math.round(currD * 100) / 100);
    prevK = currK;
    prevD = currD;
  }
  return { k, d };
}

/**
 * Classify the most recent KD state:
 *   golden — K crossed above D today
 *   death  — K crossed below D today
 *   up     — K rising from yesterday (no cross)
 *   down   — K falling
 *   flat   — K unchanged
 */
export function getKDTrend(
  k: (number | null)[],
  d: (number | null)[],
): { trend: KDTrend; k: number | null; d: number | null } {
  const n = k.length;
  if (n < 2) return { trend: 'unknown', k: null, d: null };
  const k0 = k[n - 1];
  const k1 = k[n - 2];
  const d0 = d[n - 1];
  const d1 = d[n - 2];
  if (k0 === null || k1 === null || d0 === null || d1 === null) {
    return { trend: 'unknown', k: k0, d: d0 };
  }
  if (k1 <= d1 && k0 > d0) return { trend: 'golden', k: k0, d: d0 };
  if (k1 >= d1 && k0 < d0) return { trend: 'death', k: k0, d: d0 };
  if (k0 > k1) return { trend: 'up', k: k0, d: d0 };
  if (k0 < k1) return { trend: 'down', k: k0, d: d0 };
  return { trend: 'flat', k: k0, d: d0 };
}

export function kdTrendLabel(trend: KDTrend): { text: string; color: string } {
  switch (trend) {
    case 'golden': return { text: '黃金交叉 ↑', color: 'bg-tw-down/20 text-tw-down border-tw-down/40' };
    case 'death':  return { text: '死亡交叉 ↓', color: 'bg-tw-up/20 text-tw-up border-tw-up/40' };
    case 'up':     return { text: 'K 向上 ↑',   color: 'bg-tw-down/10 text-tw-down border-tw-down/30' };
    case 'down':   return { text: 'K 向下 ↓',   color: 'bg-tw-up/10 text-tw-up border-tw-up/30' };
    case 'flat':   return { text: 'K 持平',     color: 'bg-white/5 text-text-s border-border-c' };
    default:       return { text: 'KD 尚未就緒', color: 'bg-white/5 text-text-t border-border-c' };
  }
}
