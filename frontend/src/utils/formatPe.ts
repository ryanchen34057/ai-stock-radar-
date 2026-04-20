import type { StockData } from '../types/stock';

export interface PeBreakdown {
  price: number;
  eps: number;
  pe: number;
  source: 'ttm' | 'annual';
  parts: number[];      // the quarterly EPS values summed for TTM, or [annual_eps]
  partLabels: string[]; // matching labels for `parts`, e.g. ["2026-Q1", ...]
}

/**
 * Build a PE-ratio calculation from the stock's EPS data.
 * Prefers TTM (sum of last 4 quarterly basic EPS). Falls back to latest
 * non-null annual basic EPS. Returns null when price or EPS is unavailable.
 */
export function computePeBreakdown(stock: StockData): PeBreakdown | null {
  const price = stock.current_price;
  if (price == null || price <= 0) return null;

  // Prefer FinMind's precomputed TTM EPS (authoritative official source)
  // combined with the 4 most recent quarterly rows for the formula display.
  if (stock.ttm_eps != null && stock.ttm_eps !== 0) {
    const qrows = (stock.eps_quarterly ?? [])
      .filter((r) => r.basic_eps != null)
      .slice(0, 4);
    return {
      price,
      eps: stock.ttm_eps,
      pe: price / stock.ttm_eps,
      source: 'ttm',
      parts: qrows.map((r) => r.basic_eps as number),
      partLabels: qrows.map((r) => quarterLabel(r.period_end)),
    };
  }

  // Fallback: sum of available quarterly EPS (only if we have 4 full quarters)
  const qrows = (stock.eps_quarterly ?? [])
    .filter((r) => r.basic_eps != null)
    .slice(0, 4);
  if (qrows.length === 4) {
    const parts = qrows.map((r) => r.basic_eps as number);
    const eps = parts.reduce((a, b) => a + b, 0);
    if (eps > 0) {
      return {
        price,
        eps,
        pe: price / eps,
        source: 'ttm',
        parts,
        partLabels: qrows.map((r) => quarterLabel(r.period_end)),
      };
    }
  }

  const annual = (stock.eps_annual ?? []).find((r) => r.basic_eps != null);
  if (annual && annual.basic_eps && annual.basic_eps > 0) {
    return {
      price,
      eps: annual.basic_eps,
      pe: price / annual.basic_eps,
      source: 'annual',
      parts: [annual.basic_eps],
      partLabels: [`${annual.year} 全年`],
    };
  }

  return null;
}

/**
 * PE value used for display and filtering. Prefers the self-computed TTM PE
 * (price / sum of last 4 quarterly basic EPS) so card, tooltip, and filter
 * stay consistent. Falls back to yfinance's trailingPE only when we cannot
 * compute one.
 */
export function getDisplayPe(stock: StockData): number | null {
  const bd = computePeBreakdown(stock);
  if (bd && Number.isFinite(bd.pe)) return bd.pe;
  // Guard against backend serialising NaN/±Infinity as strings ("Infinity"
  // / "NaN"), which would crash .toFixed on the caller side.
  const raw = stock.pe_ratio;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

function quarterLabel(periodEnd: string): string {
  // periodEnd is "YYYY-MM-DD"
  const [y, m] = periodEnd.split('-');
  const q = { '03': 'Q1', '06': 'Q2', '09': 'Q3', '12': 'Q4' }[m] ?? m;
  return `${y} ${q}`;
}
