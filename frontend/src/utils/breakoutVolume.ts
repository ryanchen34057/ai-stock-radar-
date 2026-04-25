/**
 * 突破前高放量 — Breakout-with-volume detection.
 *
 * Identifies stocks that just cleared a multi-month resistance level on
 * volume expansion. Classic O'Neil cup / flat-base breakout signal.
 *
 * The "prior high" is the highest CLOSE inside `[lookback, excludeRecent]` —
 * we deliberately exclude the most recent bars so a stock making a brand-
 * new high *today* still measures itself against the older base, not its
 * own breakout candle.
 *
 *   today_close >= prior_high * (1 + minAbovePct/100)   // breakout cleared
 *   today_close <= prior_high * (1 + maxAbovePct/100)   // still fresh
 *   today_volume >= MV20 * volumeMultiplier             // volume confirmed
 */

export interface BreakoutVolumeResult {
  triggered: boolean;
  priorHigh: number;
  priorHighIndex: number;        // position within the full closes array
  todayClose: number;
  abovePct: number;              // (today - priorHigh) / priorHigh * 100
  todayVolume: number;
  mv20: number;
  volumeRatio: number;           // todayVolume / MV20
}

export interface BreakoutVolumeOpts {
  lookback: number;              // days to scan for the prior high
  excludeRecent: number;         // ignore the last N bars when picking the high
  minAbovePct: number;           // today close must be >= priorHigh * (1+min)
  maxAbovePct: number;           // and <= priorHigh * (1+max) — keeps it fresh
  volumeMultiplier: number;      // today volume / MV20 threshold
  volumeMaPeriod: number;        // typically 20
}

export const DEFAULT_BREAKOUT_VOLUME_OPTS: BreakoutVolumeOpts = {
  lookback: 120,
  excludeRecent: 8,
  minAbovePct: 0,
  maxAbovePct: 8,
  volumeMultiplier: 1.5,
  volumeMaPeriod: 20,
};

export function analyzeBreakoutWithVolume(
  closes: number[],
  volumes: number[],
  opts: BreakoutVolumeOpts = DEFAULT_BREAKOUT_VOLUME_OPTS,
): BreakoutVolumeResult | null {
  const n = closes.length;
  if (n < opts.lookback + 1 || closes.length !== volumes.length) return null;

  const last = n - 1;
  const todayClose = closes[last];
  const todayVolume = volumes[last];

  const start = Math.max(0, n - opts.lookback);
  const end   = n - opts.excludeRecent;       // exclusive upper bound
  if (end <= start) return null;

  // Prior high CLOSE inside [start, end)
  let priorHigh = -Infinity;
  let priorHighIdx = start;
  for (let i = start; i < end; i++) {
    if (closes[i] > priorHigh) {
      priorHigh = closes[i];
      priorHighIdx = i;
    }
  }
  if (!Number.isFinite(priorHigh) || priorHigh <= 0) return null;

  const abovePct = ((todayClose - priorHigh) / priorHigh) * 100;

  // 20-day volume MA at "today" position
  const volStart = Math.max(0, last - opts.volumeMaPeriod + 1);
  let volSum = 0;
  let volCount = 0;
  for (let i = volStart; i <= last; i++) {
    if (volumes[i] != null) { volSum += volumes[i]; volCount++; }
  }
  const mv20 = volCount ? volSum / volCount : 0;
  const volumeRatio = mv20 > 0 ? todayVolume / mv20 : 0;

  const breakoutOk =
    abovePct >= opts.minAbovePct &&
    abovePct <= opts.maxAbovePct;
  const volumeOk = volumeRatio >= opts.volumeMultiplier;

  return {
    triggered: breakoutOk && volumeOk,
    priorHigh,
    priorHighIndex: priorHighIdx,
    todayClose,
    abovePct,
    todayVolume,
    mv20,
    volumeRatio,
  };
}
