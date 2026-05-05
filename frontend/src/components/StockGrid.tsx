import { useEffect, useMemo } from 'react';
import type { StockData, MAPeriod, AlertFilter, SortBy, MAProximityFilter, BreakoutPendingFilter, BreakoutVolumeFilter, BBUpperCrossFilter, BBProximityFilter, BBSqueezeFilter, BowlPatternFilter, CandleFilter, SpecialFilters, InstiFilters, RangeFilter, KDFilters, ThemeFilter, TierFilter } from '../types/stock';
import { layerShortCode, LAYER_THEME, THEME_LABELS } from '../types/stock';
import { StockCard } from './StockCard';
import { getSignal, getMaDistance, calculateMAFull } from '../utils/calcMA';
import { analyzeBBExpansion, analyzeBBUpperCross, analyzeBBSqueeze, calculateBollingerBands } from '../utils/calcBB';
import { analyzeBreakoutPending, type BreakoutPending } from '../utils/breakoutPending';
import { analyzeBreakoutWithVolume } from '../utils/breakoutVolume';
import { analyzeBowlPattern } from '../utils/bowlPattern';
import { getDisplayPe } from '../utils/formatPe';
import { calculateKD, getKDTrend } from '../utils/calcKD';
import { useDashboardStore } from '../store/dashboardStore';
import { useInstitutional } from '../hooks/useInstitutional';

interface Props {
  stocks: StockData[];
  selectedMA: MAPeriod;
  alertFilter: AlertFilter;
  maProximityFilter: MAProximityFilter;
  breakoutPendingFilter: BreakoutPendingFilter;
  breakoutVolumeFilter: BreakoutVolumeFilter;
  bbUpperCrossFilter: BBUpperCrossFilter;
  bbProximityFilter: BBProximityFilter;
  bbSqueezeFilter: BBSqueezeFilter;
  bowlPatternFilter: BowlPatternFilter;
  candleFilter: CandleFilter;
  specialFilters: SpecialFilters;
  instiFilters: InstiFilters;
  priceFilter: RangeFilter;
  peFilter: RangeFilter;
  kdFilters: KDFilters;
  themeFilter: ThemeFilter;
  tierFilter: TierFilter;
  searchQuery: string;
  selectedLayers: number[];
  sortBy: SortBy;
}

export function StockGrid({
  stocks, selectedMA, alertFilter, maProximityFilter, breakoutPendingFilter, breakoutVolumeFilter, bbUpperCrossFilter, bbProximityFilter, bbSqueezeFilter, bowlPatternFilter, candleFilter,
  specialFilters, instiFilters, priceFilter, peFilter, kdFilters,
  themeFilter, tierFilter, searchQuery, selectedLayers, sortBy,
}: Props) {
  const setSelectedStock = useDashboardStore((s) => s.setSelectedStock);
  const setVisibleSymbols = useDashboardStore((s) => s.setVisibleSymbols);
  const market = useDashboardStore((s) => s.market);
  const { data: insti } = useInstitutional();

  const filtered = useMemo(() => {
    let result = stocks;

    // Theme filter (A/B/C/all/cross) — 'cross' = stocks tagged with >1 theme
    if (themeFilter === 'cross') {
      result = result.filter((s) => (s.themes?.length ?? 0) > 1);
    } else if (themeFilter !== 'all') {
      result = result.filter((s) =>
        s.theme === themeFilter || (s.themes ?? []).includes(themeFilter)
      );
    }

    // Tier filter — 1 = only T1, 2 = T1+T2, 3 = all
    result = result.filter((s) => {
      const t = s.tier ?? 2;
      return t <= tierFilter;
    });

    // Search (symbol or name, case-insensitive). Applied AFTER tier/theme so
    // typing overrides theme selection lets the user jump to any stock.
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.sub_category ?? '').toLowerCase().includes(q)
      );
    }

    // Layer filter
    if (selectedLayers.length > 0) {
      result = result.filter((s) =>
        selectedLayers.some((id) =>
          s.layer === id || (s.secondary_layers?.includes(id) ?? false)
        )
      );
    }

    // Alert filter (quick toggle — static above/below selectedMA)
    if (alertFilter !== 'all') {
      result = result.filter((s) => {
        const ma = s.ma[String(selectedMA) as keyof typeof s.ma] ?? null;
        const sig = getSignal(s.current_price, ma);
        return alertFilter === 'below' ? sig === 'below' : sig === 'above';
      });
    }

    // MA proximity filter
    if (maProximityFilter.enabled) {
      result = result.filter((s) => {
        const ma = s.ma[String(maProximityFilter.ma) as keyof typeof s.ma] ?? null;
        const dist = getMaDistance(s.current_price, ma);
        if (dist === null) return false;
        switch (maProximityFilter.direction) {
          case 'above': return dist >= 0 && dist <= maProximityFilter.threshold;
          case 'below': return dist <= 0 && dist >= -maProximityFilter.threshold;
          case 'at':    return Math.abs(dist) <= maProximityFilter.threshold;
        }
      });
    }

    // Special filters
    const sf = specialFilters;
    if (sf.maBullishAlignment) {
      result = result.filter((s) => {
        const { ma } = s;
        const v5 = ma['5'], v10 = ma['10'], v20 = ma['20'], v60 = ma['60'];
        return v5 !== null && v10 !== null && v20 !== null && v60 !== null
          && v5 > v10 && v10 > v20 && v20 > v60;
      });
    }
    if (sf.price20DayHigh) {
      result = result.filter((s) => s.is_20d_high);
    }
    if (sf.aboveWeeklyMA) {
      result = result.filter((s) =>
        s.current_price !== null && s.ma['5'] !== null && s.current_price > (s.ma['5'] ?? 0)
      );
    }
    if (sf.aboveMonthlyMA) {
      result = result.filter((s) =>
        s.current_price !== null && s.ma['20'] !== null && s.current_price > (s.ma['20'] ?? 0)
      );
    }
    if (sf.aboveQuarterlyMA) {
      result = result.filter((s) =>
        s.current_price !== null && s.ma['60'] !== null && s.current_price > (s.ma['60'] ?? 0)
      );
    }
    if (sf.allTimeHigh) {
      result = result.filter((s) => s.is_all_time_high);
    }
    if (sf.gapUp || sf.gapDown) {
      result = result.filter((s) => {
        const k = s.klines;
        if (k.length < 2) return false;
        const today = k[k.length - 1];
        const prev  = k[k.length - 2];
        if (sf.gapUp   && today.low  > prev.high) return true;
        if (sf.gapDown && today.high < prev.low)  return true;
        return false;
      });
    }
    // "Pullback to MA, reclaimed today" — classic buy signal:
    //   1) today close > today MA
    //   2) at least once in the last LOOKBACK_DAYS trading days the close
    //      was <= the MA value AT THAT DAY (used full kline history to
    //      compute the per-day MA, not today's snapshot MA).
    if (sf.pullbackReclaim5 || sf.pullbackReclaim10 || sf.pullbackReclaim20) {
      const LOOKBACK_DAYS = 5;
      const testReclaim = (s: StockData, period: 5 | 10 | 20): boolean => {
        const k = s.klines;
        if (k.length < period + LOOKBACK_DAYS) return false;
        const closes = k.map((x) => x.close);
        const mas = calculateMAFull(closes, period);
        const last = k.length - 1;
        const todayClose = closes[last];
        const todayMA    = mas[last];
        if (todayMA === null || todayClose <= todayMA) return false;
        // Scan the preceding LOOKBACK_DAYS bars for a pullback touch
        for (let i = last - 1; i >= Math.max(0, last - LOOKBACK_DAYS); i--) {
          const ma = mas[i]; const c = closes[i];
          if (ma !== null && c <= ma) return true;
        }
        return false;
      };
      result = result.filter((s) =>
        (sf.pullbackReclaim5  && testReclaim(s, 5))  ||
        (sf.pullbackReclaim10 && testReclaim(s, 10)) ||
        (sf.pullbackReclaim20 && testReclaim(s, 20))
      );
    }

    // Price range filter
    if (priceFilter.enabled && (priceFilter.min !== null || priceFilter.max !== null)) {
      result = result.filter((s) => {
        if (s.current_price === null) return false;
        if (priceFilter.min !== null && s.current_price < priceFilter.min) return false;
        if (priceFilter.max !== null && s.current_price > priceFilter.max) return false;
        return true;
      });
    }

    // PE range filter — uses the same displayed PE (computed TTM) as card/tooltip
    if (peFilter.enabled && (peFilter.min !== null || peFilter.max !== null)) {
      result = result.filter((s) => {
        const pe = getDisplayPe(s);
        if (pe === null) return false;
        if (peFilter.min !== null && pe < peFilter.min) return false;
        if (peFilter.max !== null && pe > peFilter.max) return false;
        return true;
      });
    }

    // KD (5,3,3) state filter — OR semantics across enabled pills
    const anyKd = Object.values(kdFilters).some(Boolean);
    if (anyKd) {
      result = result.filter((s) => {
        if (s.klines.length < 6) return false;
        const { k, d } = calculateKD(s.klines, 5, 3, 3);
        const { trend, k: kVal } = getKDTrend(k, d);
        if (kVal === null) return false;
        if (kdFilters.golden && trend === 'golden') return true;
        if (kdFilters.death && trend === 'death') return true;
        if (kdFilters.up && trend === 'up') return true;
        if (kdFilters.down && trend === 'down') return true;
        if (kdFilters.oversold && kVal < 20) return true;
        if (kdFilters.overbought && kVal > 80) return true;
        return false;
      });
    }

    // Institutional filters (skip if data not loaded)
    if (insti) {
      const inf = instiFilters;
      if (inf.foreignNetBuy) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.foreign_net ?? 0) > 0);
      }
      if (inf.trustNetBuy) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.trust_net ?? 0) > 0);
      }
      if (inf.marginIncreasing) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.margin_change ?? 0) > 0);
      }
      if (inf.shortDecreasing) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.short_change ?? 0) < 0);
      }
    }

    // TDCC 千張大戶 增加 — count_change_pct > 0 week-over-week.
    // Stocks that have accumulated > 1M-share holders are getting "absorbed"
    // by large investors / insiders, a classic bullish accumulation signal.
    if (sf.bigHolderIncrease) {
      result = result.filter((s) => {
        const bh = s.big_holder;
        return bh != null && bh.count_change_pct != null && bh.count_change_pct > 0;
      });
    }

    // 底部爆大量 — accumulation signal at the bottom:
    //   1. 在底部: today's close 距離過去 20 日低點 ≤ 5%
    //   2. 量增: today's volume ≥ 2× MV20 (20-day average volume)
    //   3. 過去 20 日內有跌勢: max close 至少比 today's close 高 8%
    //      (排除盤整中量爆 — 那不算「底部爆量」)
    if (sf.bottomVolumeSurge) {
      result = result.filter((s) => {
        const k = s.klines;
        if (k.length < 21) return false;
        const t = k[k.length - 1];
        const past20 = k.slice(-21, -1); // 20 prior bars (exclude today)
        const lows = past20.map((b) => b.low);
        const closes = past20.map((b) => b.close);
        const vols = past20.map((b) => b.volume || 0);
        const min20 = Math.min(...lows);
        const maxClose20 = Math.max(...closes);
        const mv20 = vols.reduce((a, b) => a + b, 0) / 20;
        if (mv20 <= 0 || min20 <= 0) return false;
        // Near the 20-day low (within +5%)
        if ((t.close - min20) / min20 > 0.05) return false;
        // Volume surge ≥ 2× MV20
        if ((t.volume || 0) < 2 * mv20) return false;
        // Real prior decline — at least one bar 8%+ above today
        if ((maxClose20 - t.close) / t.close < 0.08) return false;
        return true;
      });
    }

    // 低檔槌子 — hammer at the bottom of a pullback. Classic reversal:
    //   1. Hammer shape: lower-shadow ≥ 2× body, upper-shadow ≤ 0.3× body
    //   2. Body非極小: |close-open| ≥ 0.1% of close (filter doji/near-flat)
    //   3. 在低檔: today's low ≤ min(low) of past 10 trading days
    //      (今天創 10 日新低再強力反彈才算「低檔槌子」)
    if (sf.lowHammer) {
      result = result.filter((s) => {
        const k = s.klines;
        if (k.length < 11) return false;
        const t = k[k.length - 1];
        const body  = Math.abs(t.close - t.open);
        const range = t.high - t.low;
        if (range <= 0 || t.close <= 0) return false;
        // Skip near-doji bars where the "hammer" shape is mostly noise
        if (body / t.close < 0.001) return false;
        const lower = Math.min(t.open, t.close) - t.low;
        const upper = t.high - Math.max(t.open, t.close);
        // Hammer geometry — long lower wick, tiny upper wick
        if (lower < 2 * body) return false;
        if (upper > 0.3 * body) return false;
        // Low position — today's low is the lowest of the past 10 bars
        const lows10 = k.slice(-11, -1).map((b) => b.low);
        const min10  = Math.min(...lows10);
        return t.low <= min10;
      });
    }

    // 長紅 — 今日收盤為長紅 K 棒:
    //   1. close > open (紅 K)
    //   2. 漲幅 > 4% vs 昨日收盤
    //   3. 實體 (|close - open|) > 2/3 當日全長 (high - low)
    if (sf.longBullish) {
      result = result.filter((s) => {
        const k = s.klines;
        if (k.length < 2) return false;
        const t = k[k.length - 1];
        const y = k[k.length - 2];
        if (t.close <= t.open) return false;
        const range = t.high - t.low;
        if (range <= 0) return false;
        const body = t.close - t.open;
        if (body <= (2 / 3) * range) return false;
        const changePct = y.close > 0 ? ((t.close - y.close) / y.close) * 100 : 0;
        return changePct > 4;
      });
    }

    // 布林通道剛打開 — BB squeeze → expansion. Volatility breakout signal.
    //   squeeze-low within last 15 bars, today BBW >= 1.3x that low, and
    //   currently rising (BBW today > BBW 3 bars back).
    if (sf.bbExpansion) {
      result = result.filter((s) => {
        if (s.klines.length < 30) return false;
        const closes = s.klines.map((k) => k.close);
        const r = analyzeBBExpansion(closes);
        return r !== null && r.triggered;
      });
    }

    // 站上布林上軌 — most recent close crossed above upper BB within the
    // user-specified window. Default 3 days; the pill group lets user pick
    // 1/3/5/7/10. requireStillAbove gates whether today's close must still
    // be above the upper band too.
    if (bbUpperCrossFilter.enabled) {
      result = result.filter((s) => {
        if (s.klines.length < 25) return false;
        const closes = s.klines.map((k) => k.close);
        const r = analyzeBBUpperCross(closes, {
          withinDays: bbUpperCrossFilter.withinDays,
          requireStillAbove: bbUpperCrossFilter.requireStillAbove,
        });
        return r !== null && r.triggered;
      });
    }

    // BB proximity — today's close relative to chosen band (upper / middle /
    // lower) within threshold%. direction: 'above'/'at'/'below'.
    if (bbProximityFilter.enabled) {
      result = result.filter((s) => {
        if (s.klines.length < 25) return false;
        const closes = s.klines.map((k) => k.close);
        const bb = calculateBollingerBands(closes, 20, 2);
        const last = closes.length - 1;
        const u = bb.upper[last];
        const m = bb.middle[last];
        const l = bb.lower[last];
        if (u === null || m === null || l === null) return false;
        const band =
          bbProximityFilter.band === 'upper'  ? u :
          bbProximityFilter.band === 'middle' ? m : l;
        if (band === 0) return false;
        // Signed % distance: positive = above band, negative = below band
        const pct = ((closes[last] - band) / band) * 100;
        const th = bbProximityFilter.threshold;
        switch (bbProximityFilter.direction) {
          case 'above': return pct >= 0  && pct <= th;
          case 'below': return pct <= 0  && pct >= -th;
          case 'at':    return Math.abs(pct) <= th;
        }
      });
    }

    // Latest trading-day candle filter: red/black K with daily change_percent
    // in [minPct, maxPct] (abs). Red K → positive daily change, black → negative.
    if (candleFilter.enabled) {
      result = result.filter((s) => {
        const k = s.klines;
        if (k.length === 0) return false;
        const today = k[k.length - 1];
        const isRed = today.close > today.open;
        const isBlack = today.close < today.open;
        if (candleFilter.color === 'red' && !isRed) return false;
        if (candleFilter.color === 'black' && !isBlack) return false;
        const chg = s.change_percent;
        if (chg === null) return false;
        // Red: positive change in [min, max]; Black: negative in [-max, -min]
        if (candleFilter.color === 'red'
            && (chg < candleFilter.minPct || chg > candleFilter.maxPct)) return false;
        if (candleFilter.color === 'black'
            && (chg > -candleFilter.minPct || chg < -candleFilter.maxPct)) return false;
        return true;
      });
    }

    // 碗型態 — William O'Neil cup / rounded-bottom. Rim high in the first
    // 40% of window, rounded bottom in the middle, recovery toward rim now.
    if (bowlPatternFilter.enabled) {
      result = result.filter((s) => {
        if (s.klines.length < 90) return false;
        const closes = s.klines.map((k) => k.close);
        const r = analyzeBowlPattern(closes, bowlPatternFilter.strictness);
        return r !== null && r.triggered;
      });
    }

    // BB squeeze — current BBW percentile over last 120 bars
    //   mild ≤ 40p, moderate ≤ 25p, extreme ≤ 10p
    if (bbSqueezeFilter.enabled) {
      const pctThreshold =
        bbSqueezeFilter.level === 'extreme'  ? 10 :
        bbSqueezeFilter.level === 'moderate' ? 25 : 40;
      result = result.filter((s) => {
        if (s.klines.length < 30) return false;
        const closes = s.klines.map((k) => k.close);
        const r = analyzeBBSqueeze(closes);
        return r !== null && r.percentile <= pctThreshold;
      });
    }

    // Breakout-pending scan — stocks sitting in a base (W / U / cup / flat)
    // near their prior high, about to attempt a breakout.
    if (breakoutPendingFilter.enabled) {
      result = result.filter((s) => analyzeBreakoutPending(
        s,
        breakoutPendingFilter.lookback,
        breakoutPendingFilter.threshold,
        breakoutPendingFilter.minBaseDays,
      ) !== null);
    }

    // 突破前高放量 — stock just cleared a multi-month resistance close on
    // expanded volume. Classic flat-base breakout.
    if (breakoutVolumeFilter.enabled) {
      result = result.filter((s) => {
        if (s.klines.length < breakoutVolumeFilter.lookback + 1) return false;
        const closes = s.klines.map((k) => k.close);
        const volumes = s.klines.map((k) => k.volume ?? 0);
        const r = analyzeBreakoutWithVolume(closes, volumes, {
          lookback: breakoutVolumeFilter.lookback,
          excludeRecent: breakoutVolumeFilter.excludeRecent,
          minAbovePct: 0,
          maxAbovePct: breakoutVolumeFilter.maxAbovePct,
          volumeMultiplier: breakoutVolumeFilter.volumeMultiplier,
          volumeMaPeriod: 20,
        });
        return r !== null && r.triggered;
      });
    }

    // Sort
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'change_percent':
          return (b.change_percent ?? -999) - (a.change_percent ?? -999);
        case 'volume':
          return (b.volume ?? 0) - (a.volume ?? 0);
        case 'ma_distance': {
          const maA = a.ma[String(selectedMA) as keyof typeof a.ma] ?? null;
          const maB = b.ma[String(selectedMA) as keyof typeof b.ma] ?? null;
          const distA = getMaDistance(a.current_price, maA) ?? 0;
          const distB = getMaDistance(b.current_price, maB) ?? 0;
          return distB - distA;
        }
        case 'symbol':
          return a.symbol.localeCompare(b.symbol);
        default:
          return 0;
      }
    });
  }, [stocks, selectedMA, alertFilter, maProximityFilter, breakoutPendingFilter, breakoutVolumeFilter, bbUpperCrossFilter, bbProximityFilter, bbSqueezeFilter, bowlPatternFilter, candleFilter, specialFilters, instiFilters, priceFilter, peFilter, kdFilters, themeFilter, tierFilter, searchQuery, selectedLayers, sortBy, insti]);

  // Pre-compute breakout analyses so cards don't re-run the logic twice.
  const breakoutBySymbol = useMemo<Map<string, BreakoutPending>>(() => {
    const m = new Map<string, BreakoutPending>();
    if (!breakoutPendingFilter.enabled) return m;
    for (const s of filtered) {
      const a = analyzeBreakoutPending(
        s,
        breakoutPendingFilter.lookback,
        breakoutPendingFilter.threshold,
        breakoutPendingFilter.minBaseDays,
      );
      if (a) m.set(s.symbol, a);
    }
    return m;
  }, [filtered, breakoutPendingFilter]);

  // ── Group by layer → sub_category ──────────────────────────────────────
  // Tier 1 (龍頭) sorts first within each sub-group so it appears leftmost.
  // Secondary order falls back to the user's sort criterion because
  // Array.sort is stable and `filtered` is already pre-sorted.
  interface SubGroup { sub: string; stocks: StockData[] }
  interface LayerGroup { layer: number; layer_name: string; theme: string; subs: SubGroup[] }

  const grouped: LayerGroup[] = useMemo(() => {
    const byLayer = new Map<number, { name: string; theme: string; bySub: Map<string, StockData[]> }>();
    for (const s of filtered) {
      const lid = s.layer;
      if (!byLayer.has(lid)) {
        byLayer.set(lid, {
          name: s.layer_name,
          theme: LAYER_THEME[lid] || s.theme || 'A',
          bySub: new Map(),
        });
      }
      const sub = (s.sub_category ?? '').trim() || '未分類';
      const layerRec = byLayer.get(lid)!;
      if (!layerRec.bySub.has(sub)) layerRec.bySub.set(sub, []);
      layerRec.bySub.get(sub)!.push(s);
    }
    // Sort inside each sub-group by market cap desc (biggest company leftmost).
    // Stocks with no market_cap drop to the end.
    for (const layerRec of byLayer.values()) {
      for (const arr of layerRec.bySub.values()) {
        arr.sort((a, b) => {
          const mA = a.market_cap ?? -1;
          const mB = b.market_cap ?? -1;
          return mB - mA;
        });
      }
    }
    // Layer ordering: A first, then B, C, then D (全市場 dump goes last).
    const themeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    return Array.from(byLayer.entries())
      .map(([layer, r]) => ({
        layer, layer_name: r.name, theme: r.theme,
        // Sub-groups alphabetical within layer — simple & predictable
        subs: Array.from(r.bySub.entries())
          .sort((a, b) => a[0].localeCompare(b[0], 'zh-TW'))
          .map(([sub, stocks]) => ({ sub, stocks })),
      }))
      .sort((a, b) => {
        const to = (themeOrder[a.theme] ?? 9) - (themeOrder[b.theme] ?? 9);
        return to !== 0 ? to : a.layer - b.layer;
      });
  }, [filtered]);

  // Publish the visible-symbol order so the detail modal's ←/→ arrow keys
  // can walk the same list the user is seeing on screen. Order = theme ->
  // layer -> sub_category alpha -> market_cap desc (matches `grouped`).
  useEffect(() => {
    const ordered: string[] = [];
    for (const g of grouped) {
      for (const sub of g.subs) {
        for (const s of sub.stocks) ordered.push(s.symbol);
      }
    }
    setVisibleSymbols(ordered);
  }, [grouped, setVisibleSymbols]);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-t">
        <div className="text-4xl mb-3">📭</div>
        <div className="text-lg">沒有符合條件的股票</div>
        <div className="text-sm mt-1">請調整篩選條件</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(({ layer, layer_name, theme, subs }) => {
        // Flatten sub-groups into one continuous list so cards pack across
        // rows; sub-categories stay adjacent because `subs` is sorted and
        // each sub-group's array is tier-sorted (龍頭 first).
        const flat = subs.flatMap(({ stocks }) => stocks);
        const leaders = flat.filter((s) => (s.tier ?? 2) === 1);
        return (
          <section key={layer}>
            {/* Layer header */}
            <header className="flex items-baseline gap-2 flex-wrap mb-2 pb-1.5 border-b border-border-c">
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold">
                {layerShortCode(layer)}
              </span>
              <h2 className="text-base font-bold text-text-p">{layer_name}</h2>
              <span className="text-[11px] text-text-t">
                {THEME_LABELS[theme] ?? theme} · {flat.length} 檔 · {subs.length} 題材
              </span>
              {leaders.length > 0 && market !== 'US' && (
                <span className="text-[11px] text-accent font-semibold ml-auto">
                  ◆ 龍頭：{leaders.map((s) => `${s.symbol} ${s.name}`).join('・')}
                </span>
              )}
            </header>

            {/* Single horizontal grid per layer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {flat.map((stock) => (
                <StockCard
                  key={stock.symbol}
                  stock={stock}
                  selectedMA={selectedMA}
                  insti={insti?.stocks[stock.symbol] ?? null}
                  breakout={breakoutBySymbol.get(stock.symbol)}
                  onClick={() => setSelectedStock(stock)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
