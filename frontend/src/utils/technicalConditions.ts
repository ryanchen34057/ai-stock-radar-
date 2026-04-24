/**
 * Detect every technical-analysis condition currently triggered for a stock,
 * so the detail modal can show the complete set of signals as a badge strip.
 *
 * Mirrors the logic the ControlBar filters use (StockGrid.tsx) — any new
 * filter added there should be mirrored here too.
 */

import type { StockData } from '../types/stock';
import { calculateMAFull } from './calcMA';
import {
  analyzeBBExpansion,
  analyzeBBSqueeze,
  analyzeBBUpperCross,
  calculateBollingerBands,
} from './calcBB';
import { analyzeBowlPattern } from './bowlPattern';
import { analyzeBreakoutPending, patternLabel } from './breakoutPending';
import { calculateKD, getKDTrend } from './calcKD';

export type ConditionTone =
  | 'ma'       // MA trend / alignment (yellow)
  | 'bull'     // bullish / up-move flag (red, TW up convention)
  | 'bear'     // bearish / down-move flag (green, TW down convention)
  | 'bb'       // Bollinger Band signals (purple)
  | 'pattern'  // chart pattern (amber)
  | 'kd';      // stochastic (blue)

export interface TriggeredCondition {
  key: string;
  label: string;
  tone: ConditionTone;
  detail?: string;
}

export function analyzeAllConditions(stock: StockData): TriggeredCondition[] {
  const out: TriggeredCondition[] = [];
  const k = stock.klines ?? [];
  const closes = k.map((b) => b.close);
  const price = stock.current_price;

  // ── MA alignment & position ───────────────────────────────────────────────
  const m5 = stock.ma['5'];
  const m10 = stock.ma['10'];
  const m20 = stock.ma['20'];
  const m60 = stock.ma['60'];
  if (m5 != null && m10 != null && m20 != null && m60 != null &&
      m5 > m10 && m10 > m20 && m20 > m60) {
    out.push({ key: 'maBullishAlignment', label: '均線多頭排列',
               tone: 'ma', detail: 'MA5 > MA10 > MA20 > MA60' });
  }
  if (price != null && m5 != null && price > m5) {
    out.push({ key: 'aboveMA5', label: '站上週線 MA5', tone: 'ma' });
  }
  if (price != null && m20 != null && price > m20) {
    out.push({ key: 'aboveMA20', label: '站上月線 MA20', tone: 'ma' });
  }
  if (price != null && m60 != null && price > m60) {
    out.push({ key: 'aboveMA60', label: '站上季線 MA60', tone: 'ma' });
  }

  // ── Highs ─────────────────────────────────────────────────────────────────
  if (stock.is_20d_high) {
    out.push({ key: 'high20d', label: '創 20 日新高', tone: 'bull' });
  }
  if (stock.is_all_time_high) {
    out.push({ key: 'allTimeHigh', label: '收盤創 ATH', tone: 'bull' });
  }

  // ── Gap / long-body candle ────────────────────────────────────────────────
  if (k.length >= 2) {
    const t = k[k.length - 1];
    const y = k[k.length - 2];
    if (t.low > y.high) {
      out.push({ key: 'gapUp', label: '跳空向上 ↑', tone: 'bull' });
    }
    if (t.high < y.low) {
      out.push({ key: 'gapDown', label: '跳空向下 ↓', tone: 'bear' });
    }
    const range = t.high - t.low;
    const body = t.close - t.open;
    const changePct = y.close > 0 ? ((t.close - y.close) / y.close) * 100 : 0;
    if (t.close > t.open && range > 0 && body > (2 / 3) * range && changePct > 4) {
      out.push({ key: 'longBullish', label: `長紅 K ${changePct.toFixed(1)}%`,
                 tone: 'bull', detail: '漲幅>4%, 實體>⅔ K 棒' });
    }
  }

  // ── Pullback-to-MA reclaim (last 5 bars touched/below MA, today close > MA) ─
  if (closes.length >= 25) {
    const testReclaim = (period: 5 | 10 | 20): boolean => {
      if (closes.length < period + 5) return false;
      const mas = calculateMAFull(closes, period);
      const last = closes.length - 1;
      const todayClose = closes[last];
      const todayMA = mas[last];
      if (todayMA === null || todayClose <= todayMA) return false;
      for (let i = last - 1; i >= Math.max(0, last - 5); i--) {
        const ma = mas[i];
        const c = closes[i];
        if (ma !== null && c <= ma) return true;
      }
      return false;
    };
    if (testReclaim(5))  out.push({ key: 'pb5',  label: '回測 MA5 反彈',  tone: 'bull' });
    if (testReclaim(10)) out.push({ key: 'pb10', label: '回測 MA10 反彈', tone: 'bull' });
    if (testReclaim(20)) out.push({ key: 'pb20', label: '回測 MA20 反彈', tone: 'bull' });
  }

  // ── Bollinger Band signals ────────────────────────────────────────────────
  if (closes.length >= 25) {
    const bb = calculateBollingerBands(closes, 20, 2);
    const last = closes.length - 1;
    const u = bb.upper[last];
    const m = bb.middle[last];
    const l = bb.lower[last];
    const c = closes[last];

    // Position vs upper / lower bands
    if (u !== null && c >= u) {
      const pct = ((c - u) / u) * 100;
      out.push({ key: 'aboveUpper', label: '站上布林上軌',
                 tone: 'bb', detail: `+${pct.toFixed(1)}% vs upper` });
    }
    if (l !== null && c <= l) {
      const pct = ((l - c) / l) * 100;
      out.push({ key: 'belowLower', label: '跌破布林下軌',
                 tone: 'bear', detail: `-${pct.toFixed(1)}% vs lower` });
    }
    // "貼近上軌" / "貼近下軌" — within ±2% but not crossed
    if (u !== null && c < u && ((u - c) / u) * 100 <= 2) {
      out.push({ key: 'nearUpper', label: '貼近布林上軌', tone: 'bb' });
    }
    if (l !== null && c > l && ((c - l) / l) * 100 <= 2) {
      out.push({ key: 'nearLower', label: '貼近布林下軌', tone: 'bb' });
    }
    if (u !== null && l !== null && m !== null && c > m && c < u) {
      // bonus: walking mid-to-upper zone
      // (only show if not already tagged nearUpper / aboveUpper)
    }

    // Squeeze percentile
    const sq = analyzeBBSqueeze(closes);
    if (sq !== null) {
      if (sq.percentile <= 10) {
        out.push({ key: 'sqExtreme', label: '通道極度狹窄',
                   tone: 'bb', detail: `BBW 位於過去 120 日最低 ${sq.percentile.toFixed(0)}%` });
      } else if (sq.percentile <= 25) {
        out.push({ key: 'sqModerate', label: '通道明顯狹窄',
                   tone: 'bb', detail: `BBW 位於過去 120 日最低 ${sq.percentile.toFixed(0)}%` });
      } else if (sq.percentile <= 40) {
        out.push({ key: 'sqMild', label: '通道輕度狹窄',
                   tone: 'bb', detail: `BBW 位於過去 120 日最低 ${sq.percentile.toFixed(0)}%` });
      }
    }

    // Expansion (squeeze → breakout)
    const exp = analyzeBBExpansion(closes);
    if (exp !== null && exp.triggered) {
      out.push({ key: 'bbExpansion', label: '布林通道剛打開',
                 tone: 'bb', detail: '壓縮後帶寬放大' });
    }

    // Upper-band cross-up within last 3 / 5 / 10 days
    for (const d of [3, 5, 10] as const) {
      const cross = analyzeBBUpperCross(closes, { withinDays: d, requireStillAbove: false });
      if (cross !== null && cross.triggered) {
        out.push({ key: `upCross${d}`, label: `${d} 日內站上上軌`, tone: 'bb' });
        break; // only report tightest window
      }
    }
  }

  // ── Chart patterns ────────────────────────────────────────────────────────
  if (closes.length >= 90) {
    for (const level of ['strict', 'moderate', 'loose'] as const) {
      const bowl = analyzeBowlPattern(closes, level);
      if (bowl !== null && bowl.triggered) {
        const levelLabel = level === 'strict' ? '嚴格' : level === 'moderate' ? '中度' : '寬鬆';
        out.push({ key: 'bowl', label: `碗型態 (${levelLabel})`,
                   tone: 'pattern',
                   detail: `回檔 ${bowl.drawdownPct.toFixed(0)}% → 回升 ${bowl.recoveryPct.toFixed(0)}%` });
        break; // strictest match wins
      }
    }
  }
  const bp = analyzeBreakoutPending(stock, 60, 5, 15);
  if (bp !== null) {
    out.push({ key: 'breakoutPending', label: `快破前高 (${patternLabel(bp.pattern)})`,
               tone: 'pattern',
               detail: `距高點 ${bp.gapPct.toFixed(1)}%, 基底 ${bp.daysSinceHigh} bar` });
  }

  // ── KD (5,3,3) ────────────────────────────────────────────────────────────
  if (k.length >= 6) {
    const { k: kArr, d: dArr } = calculateKD(k, 5, 3, 3);
    const { trend, k: kv } = getKDTrend(kArr, dArr);
    if (kv !== null) {
      if (trend === 'golden') {
        out.push({ key: 'kdGolden', label: 'KD 黃金交叉', tone: 'kd' });
      } else if (trend === 'death') {
        out.push({ key: 'kdDeath', label: 'KD 死亡交叉', tone: 'kd' });
      }
      if (kv < 20) {
        out.push({ key: 'kdOversold', label: `KD 超賣 K=${kv.toFixed(0)}`, tone: 'kd' });
      } else if (kv > 80) {
        out.push({ key: 'kdOverbought', label: `KD 超買 K=${kv.toFixed(0)}`, tone: 'kd' });
      }
    }
  }

  // ── 千張大戶週增加 ─────────────────────────────────────────────────────────
  const bh = stock.big_holder;
  if (bh && bh.count_change_pct != null && bh.count_change_pct > 0) {
    out.push({ key: 'bigHolderInc',
               label: `千張大戶增加 +${bh.count_change_pct.toFixed(1)}%`,
               tone: 'bull' });
  }

  return out;
}

export const TONE_CLASS: Record<ConditionTone, string> = {
  ma:      'bg-tw-at/20 text-tw-at border-tw-at/50',
  bull:    'bg-tw-down/20 text-tw-down border-tw-down/50',
  bear:    'bg-tw-up/20 text-tw-up border-tw-up/50',
  bb:      'bg-purple-500/20 text-purple-300 border-purple-500/60',
  pattern: 'bg-amber-500/20 text-amber-300 border-amber-400/60',
  kd:      'bg-accent/15 text-accent border-accent/50',
};
