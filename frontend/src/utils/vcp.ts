/**
 * VCP (Volatility Contraction Pattern) — Mark Minervini's classic setup
 * detector. A stock must pass the Trend Template first (strong uptrend
 * prerequisite), then be in a volatility-contracting base with volume
 * drying up, approaching a fresh breakout above its pivot point.
 *
 * All metrics computed client-side from the daily klines already loaded
 * into the Dashboard — no extra API calls.
 */
import type { KLine, StockData } from '../types/stock';

export interface VcpAnalysis {
  /** Contraction magnitudes in chronological order, each 0-1 (e.g. 0.12 = 12% drop). */
  contractions: number[];
  /** Same as contractions.length. 2T / 3T / 4T badge. */
  contractionCount: number;
  /** Last (most recent) contraction magnitude, 0-1. */
  lastContraction: number;
  /** Pivot = max close in the base + 0.1 (Minervini rule). Breakout target. */
  pivotPoint: number;
  /** (pivot - current_price) / pivot × 100. Positive = below pivot. */
  distanceToPivotPct: number;
  /** Last 10d avg volume < prior 50d avg volume × 0.8. */
  volumeDryUp: boolean;
  /** All Trend Template conditions satisfied. */
  passesTrendTemplate: boolean;
  /** Ready-to-buy: close to pivot AND volume dry-up. */
  isPrime: boolean;
}

const BASE_LOOKBACK = 65;
const PIVOT_WINDOW = 5;

// ── Trend Template (Minervini) ──────────────────────────────────────────────
function passesTrendTemplate(stock: StockData): boolean {
  const closes = stock.klines.map((k) => k.close);
  if (closes.length < 200) return false;

  const price = stock.current_price ?? closes[closes.length - 1];
  if (price === null || price <= 0) return false;

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const ma50  = mean(closes.slice(-50));
  const ma150 = mean(closes.slice(-150));
  const ma200 = mean(closes.slice(-200));
  const ma200_20ago = closes.length >= 220 ? mean(closes.slice(-220, -20)) : ma200;

  const last252 = closes.slice(-Math.min(252, closes.length));
  const low52w  = Math.min(...last252);
  const high52w = Math.max(...last252);

  return (
    price > ma150 &&
    price > ma200 &&
    ma150 > ma200 &&
    ma200 > ma200_20ago &&             // MA200 trending up
    ma50 > ma150 &&
    price > ma50 &&
    price >= low52w * 1.30 &&          // at least 30% above 52-week low
    price >= high52w * 0.75            // within 25% of 52-week high
  );
}

// ── Pivot detection ─────────────────────────────────────────────────────────
/**
 * A close at index i is a pivot high if it's strictly greater than the
 * `window` closes on each side (and a pivot low if strictly less than).
 */
function findPivots(closes: number[], window = PIVOT_WINDOW) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = window; i < closes.length - window; i++) {
    const c = closes[i];
    let isH = true, isL = true;
    for (let j = 1; j <= window; j++) {
      if (closes[i - j] >= c) isH = false;
      if (closes[i + j] >= c) isH = false;
      if (closes[i - j] <= c) isL = false;
      if (closes[i + j] <= c) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) highs.push(i);
    if (isL) lows.push(i);
  }
  return { highs, lows };
}

/**
 * Walk through pivots chronologically; pair each High with the first
 * subsequent Low to produce one contraction percentage per pair.
 */
function computeContractions(base: KLine[], highs: number[], lows: number[]): number[] {
  const events: { idx: number; type: 'H' | 'L'; price: number }[] = [
    ...highs.map((i) => ({ idx: i, type: 'H' as const, price: base[i].close })),
    ...lows.map((i)  => ({ idx: i, type: 'L' as const, price: base[i].close })),
  ].sort((a, b) => a.idx - b.idx);

  const contractions: number[] = [];
  let pendingHigh: number | null = null;
  for (const e of events) {
    if (e.type === 'H') {
      // Always update to latest high (we want the most recent H before each L)
      pendingHigh = e.price;
    } else if (e.type === 'L' && pendingHigh !== null && pendingHigh > 0) {
      contractions.push((pendingHigh - e.price) / pendingHigh);
      pendingHigh = null;
    }
  }
  return contractions;
}

function isVcpValid(contractions: number[]): boolean {
  if (contractions.length < 2) return false;
  for (let i = 1; i < contractions.length; i++) {
    if (contractions[i] >= contractions[i - 1]) return false;
  }
  return contractions[contractions.length - 1] < 0.10;
}

// ── Volume dry-up ───────────────────────────────────────────────────────────
function isVolumeDryUp(klines: KLine[]): boolean {
  if (klines.length < 60) return false;
  const last10 = klines.slice(-10);
  const prior50 = klines.slice(-60, -10);
  const avg10 = last10.reduce((s, k) => s + k.volume, 0) / 10;
  const avg50 = prior50.reduce((s, k) => s + k.volume, 0) / 50;
  return avg50 > 0 && avg10 < avg50 * 0.8;
}

// ── Public entry ────────────────────────────────────────────────────────────
export function analyzeVCP(stock: StockData): VcpAnalysis | null {
  if (!passesTrendTemplate(stock)) return null;
  const klines = stock.klines;
  if (klines.length < BASE_LOOKBACK) return null;

  const base = klines.slice(-BASE_LOOKBACK);
  const closes = base.map((k) => k.close);
  const { highs, lows } = findPivots(closes);
  const contractions = computeContractions(base, highs, lows);
  if (!isVcpValid(contractions)) return null;

  const maxBaseClose = Math.max(...closes);
  const pivotPoint = maxBaseClose + 0.1;
  const price = stock.current_price ?? closes[closes.length - 1];
  const distanceToPivotPct = ((pivotPoint - (price ?? 0)) / pivotPoint) * 100;
  const volumeDryUp = isVolumeDryUp(klines);

  return {
    contractions,
    contractionCount: contractions.length,
    lastContraction: contractions[contractions.length - 1],
    pivotPoint,
    distanceToPivotPct,
    volumeDryUp,
    passesTrendTemplate: true,
    isPrime: distanceToPivotPct >= 0 && distanceToPivotPct < 5 && volumeDryUp,
  };
}
