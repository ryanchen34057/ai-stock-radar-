import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { StockData, KLine, MAPeriod } from '../types/stock';
import { calculateMAFull } from '../utils/calcMA';
import { calculateBollingerBands } from '../utils/calcBB';
import { calculateKD, getKDTrend, kdTrendLabel } from '../utils/calcKD';
import { formatPrice, formatChange, formatChangePct, formatVolume, formatMarketCap } from '../utils/formatters';
import { useDashboardStore } from '../store/dashboardStore';
import { useStockNews } from '../hooks/useStockNews';
import { useInstitutional, useInstitutionalHistory, type InstitutionalHistoryDay } from '../hooks/useInstitutional';
import type { MopsAnnouncement, NewsItem, ExternalLink } from '../hooks/useStockNews';
import PeTooltip from './PeTooltip';
import { getDisplayPe } from '../utils/formatPe';
import CapacitySection from './CapacitySection';

const MA_COLORS: Record<number, string> = {
  5: '#58A6FF',
  10: '#BC8CFF',
  20: '#FF7B72',
  60: '#FFB020',
  120: '#3FB950',
  240: '#FF6EB0',
};

// Range buttons for the chart
const RANGES = [
  { label: '3個月', days: 65 },
  { label: '6個月', days: 130 },
  { label: '1年', days: 250 },
  { label: '2年', days: 500 },
  { label: '5年', days: 1300 },
] as const;

interface Props {
  stock: StockData;
  selectedMA: MAPeriod;
  onClose: () => void;
}

export function StockDetailModal({ stock, selectedMA, onClose }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const darkMode = useDashboardStore((s) => s.darkMode);
  const showBollinger = useDashboardStore((s) => s.showBollinger);
  const toggleBollinger = useDashboardStore((s) => s.toggleBollinger);

  const [fullKlines, setFullKlines] = useState<KLine[]>([]);
  const [loadingKlines, setLoadingKlines] = useState(true);
  const [rangeIndex, setRangeIndex] = useState(2); // default 1年
  // Which MA lines to draw; default all 6 on. Users can toggle individually.
  const [maVisible, setMaVisible] = useState<Record<MAPeriod, boolean>>({
    5: true, 10: true, 20: true, 60: true, 120: true, 240: true,
  });
  const toggleMa = (p: MAPeriod) =>
    setMaVisible((v) => ({ ...v, [p]: !v[p] }));
  const { data: news, loading: newsLoading } = useStockNews(stock.symbol);
  useInstitutional(); // keep the shared 1-day fetch warm for aggregates elsewhere

  // Fetch full 5-year klines when modal opens
  useEffect(() => {
    setLoadingKlines(true);
    fetch(`/api/stocks/${stock.symbol}/klines?days=1300`)
      .then((r) => r.json())
      .then((data: KLine[]) => {
        setFullKlines(data);
        setLoadingKlines(false);
      })
      .catch(() => {
        // Fall back to dashboard klines
        setFullKlines(stock.klines);
        setLoadingKlines(false);
      });
  }, [stock.symbol, stock.klines]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Build chart whenever klines or range changes
  useEffect(() => {
    if (!chartRef.current || fullKlines.length === 0 || loadingKlines) return;

    const days = RANGES[rangeIndex].days;
    const klines = fullKlines.slice(-days);

    const container = chartRef.current;
    const chart = createChart(container, {
      autoSize: true,
      height: 460,
      layout: {
        background: { type: ColorType.Solid, color: darkMode ? '#0D1117' : '#FFFFFF' },
        textColor: darkMode ? '#8B949E' : '#555',
      },
      grid: {
        vertLines: { color: darkMode ? '#21262D' : '#F0F0F0', style: 1 },
        horzLines: { color: darkMode ? '#21262D' : '#F0F0F0', style: 1 },
      },
      timeScale: { borderColor: '#30363D', timeVisible: true },
      // Price panel sits in the top ~55% of the chart; leaves room below for
      // volume (~20%) and KD (~22%) overlay scales.
      rightPriceScale: { borderColor: '#30363D', scaleMargins: { top: 0.05, bottom: 0.42 } },
      crosshair: { mode: 1 },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#FF3B3B',
      downColor: '#00C851',
      borderUpColor: '#FF3B3B',
      borderDownColor: '#00C851',
      wickUpColor: '#FF3B3B',
      wickDownColor: '#00C851',
    });

    candleSeries.setData(klines.map((k) => ({
      time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
      open: k.open, high: k.high, low: k.low, close: k.close,
    })));

    // Offset from full kline series into the visible slice — shared by all MA/VOL overlays
    const offset = fullKlines.length - klines.length;

    // Volume histogram — overlay series on the bottom 22% of the chart
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.6, bottom: 0.22 },
    });
    volumeSeries.setData(klines.map((k) => ({
      time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
      value: k.volume,
      color: k.close >= k.open ? 'rgba(255, 59, 59, 0.5)' : 'rgba(0, 200, 81, 0.5)',
    })));

    // Volume MA20 line on same overlay scale
    const VOL_MA_PERIOD = 20;
    const allVolumes = fullKlines.map((k) => k.volume);
    const volMaFull = calculateMAFull(allVolumes, VOL_MA_PERIOD);
    const volMaSlice = volMaFull.slice(offset);
    const volMaData = klines
      .map((k, i) => ({ time: k.date as unknown as import('lightweight-charts').UTCTimestamp, value: volMaSlice[i] }))
      .filter((d): d is { time: import('lightweight-charts').UTCTimestamp; value: number } => d.value !== null);
    if (volMaData.length > 0) {
      const volMaSeries = chart.addLineSeries({
        color: '#FFB020',
        lineWidth: 1,
        priceScaleId: 'volume',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        title: `VOL MA${VOL_MA_PERIOD}`,
      });
      volMaSeries.setData(volMaData);
    }

    // Compute all 6 MA lines from the full klines (so MA is accurate even when zoomed)
    const allCloses = fullKlines.map((k) => k.close);

    for (const period of [5, 10, 20, 60, 120, 240] as MAPeriod[]) {
      if (!maVisible[period]) continue;  // user hid this MA line

      const maFull = calculateMAFull(allCloses, period);
      const maSlice = maFull.slice(offset);
      const maData = klines
        .map((k, i) => ({ time: k.date as unknown as import('lightweight-charts').UTCTimestamp, value: maSlice[i] }))
        .filter((d): d is { time: import('lightweight-charts').UTCTimestamp; value: number } => d.value !== null);

      if (maData.length === 0) continue;

      const lineSeries = chart.addLineSeries({
        color: MA_COLORS[period],
        lineWidth: period === selectedMA ? 2 : 1,
        crosshairMarkerVisible: false,
        lastValueVisible: true,
        priceLineVisible: false,
        title: `MA${period}`,
      });
      lineSeries.setData(maData);
    }

    // Bollinger Bands (20, 2) overlay — purple dashed upper/lower, solid middle
    if (showBollinger) {
      const bb = calculateBollingerBands(allCloses, 20, 2);
      const toData = (vals: (number | null)[]) => {
        const slice = vals.slice(offset);
        return klines
          .map((k, i) => ({
            time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
            value: slice[i],
          }))
          .filter((d): d is { time: import('lightweight-charts').UTCTimestamp; value: number } =>
            d.value !== null);
      };

      // Upper + Lower: dashed lines with compact right-axis value tag (no title
      // prefix so the tag sits flush against the line terminus).
      const upperS = chart.addLineSeries({
        color: 'rgba(187,137,255,0.9)', lineWidth: 1, lineStyle: 2,
        crosshairMarkerVisible: false, lastValueVisible: true, priceLineVisible: false,
      });
      upperS.setData(toData(bb.upper));

      const lowerS = chart.addLineSeries({
        color: 'rgba(187,137,255,0.9)', lineWidth: 1, lineStyle: 2,
        crosshairMarkerVisible: false, lastValueVisible: true, priceLineVisible: false,
      });
      lowerS.setData(toData(bb.lower));

      // Mid line is essentially MA20 -- draw it but skip the right-axis tag to
      // avoid stacking on top of MA20's tag.
      const midS = chart.addLineSeries({
        color: 'rgba(187,137,255,0.45)', lineWidth: 1,
        crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      });
      midS.setData(toData(bb.middle));
    }

    // KD (5, 3, 3) — computed over full series for accuracy, drawn on the bottom panel
    const kdFull = calculateKD(fullKlines, 5, 3, 3);
    const kSlice = kdFull.k.slice(offset);
    const dSlice = kdFull.d.slice(offset);
    const kData = klines
      .map((bar, i) => ({ time: bar.date as unknown as import('lightweight-charts').UTCTimestamp, value: kSlice[i] }))
      .filter((p): p is { time: import('lightweight-charts').UTCTimestamp; value: number } => p.value !== null);
    const dData = klines
      .map((bar, i) => ({ time: bar.date as unknown as import('lightweight-charts').UTCTimestamp, value: dSlice[i] }))
      .filter((p): p is { time: import('lightweight-charts').UTCTimestamp; value: number } => p.value !== null);
    if (kData.length > 0) {
      const kSeries = chart.addLineSeries({
        color: '#58A6FF',
        lineWidth: 1,
        priceScaleId: 'kd',
        crosshairMarkerVisible: false,
        lastValueVisible: true,
        priceLineVisible: false,
        title: 'K(5)',
      });
      kSeries.setData(kData);
      const dSeries = chart.addLineSeries({
        color: '#FF7B72',
        lineWidth: 1,
        priceScaleId: 'kd',
        crosshairMarkerVisible: false,
        lastValueVisible: true,
        priceLineVisible: false,
        title: 'D(3)',
      });
      dSeries.setData(dData);
      chart.priceScale('kd').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
    }

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [fullKlines, loadingKlines, rangeIndex, selectedMA, darkMode, showBollinger, maVisible]);

  // KD trend status — derived from the full kline series so it's stable
  // across range toggles.
  const kdStatus = (() => {
    if (fullKlines.length < 6) return null;
    const { k, d } = calculateKD(fullKlines, 5, 3, 3);
    return getKDTrend(k, d);
  })();

  const isUp = (stock.change ?? 0) >= 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-dash-bg border border-border-c rounded-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-c">
          <div className="flex items-center gap-3">
            <span className="font-mono text-text-s text-sm">{stock.symbol}</span>
            <h2 className="text-xl font-bold text-text-p">{stock.name}</h2>
            <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded">
              L{stock.layer} {stock.layer_name}
            </span>
            {stock.disposal && (
              <span
                className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/50 font-bold"
                title={`處置期間 ${stock.disposal.start_date} ～ ${stock.disposal.end_date}\n原因：${stock.disposal.reason || '累計處置'}`}
              >
                ⚠ {stock.disposal.measure || '處置股'}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-s hover:text-text-p text-xl w-8 h-8 flex items-center justify-center
                       rounded hover:bg-card-bg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Price section */}
        <div className="p-4 border-b border-border-c">
          <div className="flex items-baseline gap-3">
            <span className={`text-4xl font-bold font-mono tabular-nums
              ${isUp ? 'text-tw-up' : 'text-tw-down'}`}>
              {formatPrice(stock.current_price)}
            </span>
            <span className={`text-lg font-mono ${isUp ? 'text-tw-up' : 'text-tw-down'}`}>
              {formatChange(stock.change)} ({formatChangePct(stock.change_percent)})
            </span>
          </div>
          <div className="flex flex-wrap gap-6 mt-2 text-sm text-text-s">
            <span>成交量 <span className="text-text-p font-mono">{formatVolume(stock.volume)}</span></span>
            <span>市值 <span className="text-text-p font-mono">{formatMarketCap(stock.market_cap)}</span></span>
            {(() => {
              const pe = getDisplayPe(stock);
              return pe !== null ? (
                <span className="inline-flex items-center">
                  本益比 <span className="text-text-p font-mono ml-1">{pe.toFixed(1)}x</span>
                  <PeTooltip stock={stock} />
                </span>
              ) : null;
            })()}
            <span className="text-text-t text-xs self-center">
              {loadingKlines ? '載入中...' : `共 ${fullKlines.length} 個交易日`}
            </span>
            {kdStatus && kdStatus.k !== null && kdStatus.d !== null && (() => {
              const { text, color } = kdTrendLabel(kdStatus.trend);
              return (
                <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border ${color} self-center`}>
                  <span className="font-semibold">KD(5,3,3)</span>
                  <span className="font-mono tabular-nums">
                    K {kdStatus.k.toFixed(1)} / D {kdStatus.d.toFixed(1)}
                  </span>
                  <span className="font-semibold">{text}</span>
                </span>
              );
            })()}
          </div>
        </div>

        {/* Institutional section — split cards (20d vs latest) + click to expand daily */}
        <InstitutionalSection symbol={stock.symbol} />


        {/* Chart */}
        <div className="p-4 border-b border-border-c">
          {/* Range selector */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            {/* MA visibility toggles — click to show/hide each line */}
            <div className="flex gap-1 flex-wrap">
              {([5, 10, 20, 60, 120, 240] as MAPeriod[]).map((p) => {
                const v = stock.ma[String(p) as keyof typeof stock.ma];
                const on = maVisible[p];
                return (
                  <button
                    key={p}
                    onClick={() => toggleMa(p)}
                    title={on ? '點擊隱藏' : '點擊顯示'}
                    className={`px-2 py-0.5 text-xs font-mono rounded border transition-all select-none ${
                      on ? 'bg-white/5' : 'bg-transparent opacity-40'
                    }`}
                    style={{
                      color: MA_COLORS[p],
                      borderColor: on ? `${MA_COLORS[p]}66` : '#30363D',
                    }}
                  >
                    <span className={on ? 'font-bold' : 'line-through'}>MA{p}</span>
                    {v !== null && <span className="ml-1">{formatPrice(v)}</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleBollinger}
                title="布林通道 (20, 2σ)"
                className={`px-2 py-0.5 text-xs rounded border transition-colors font-semibold mr-1 ${
                  showBollinger
                    ? 'bg-purple-500/25 text-purple-300 border-purple-500/60'
                    : 'text-text-s border-border-c hover:text-text-p'
                }`}
              >
                BB 通道
              </button>
              {RANGES.map((r, i) => (
                <button
                  key={r.label}
                  onClick={() => setRangeIndex(i)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    rangeIndex === i
                      ? 'bg-accent text-black font-bold'
                      : 'text-text-s hover:text-text-p border border-border-c'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {loadingKlines ? (
            <div className="h-[340px] flex items-center justify-center text-text-t">
              <span className="animate-pulse">載入 K 線資料中...</span>
            </div>
          ) : (
            <div ref={chartRef} className="w-full" />
          )}
        </div>

        {/* Info */}
        <div className="px-4 pt-4 pb-2">
          <div className="text-xs text-text-s">{stock.sub_category}</div>
          {stock.note && (
            <div className="text-sm text-text-p mt-1">{stock.note}</div>
          )}
        </div>

        {/* News */}
        <div className="px-4 pb-4 space-y-4">
          {newsLoading ? (
            <div className="text-xs text-text-t animate-pulse py-3">載入新聞中...</div>
          ) : (
            <>
              {/* A: MOPS announcements */}
              <NewsSection title="官方公告 (公開資訊觀測站)" count={news?.mops_announcements.length}>
                {news?.mops_announcements.length === 0 ? (
                  <EmptyHint>
                    近 7 天無公告資料 —{' '}
                    <a href={news?.external_links.find(l => l.name === '公開資訊觀測站')?.url ?? '#'}
                       target="_blank" rel="noopener noreferrer"
                       className="text-accent hover:underline">
                      前往 MOPS 查看 ↗
                    </a>
                  </EmptyHint>
                ) : news?.mops_announcements.map((a: MopsAnnouncement, i: number) => (
                  <NewsRow key={i} date={a.date} title={a.title} url={a.url} />
                ))}
              </NewsSection>

              {/* B: Google News RSS */}
              <NewsSection title="財經新聞" count={news?.news.length}>
                {news?.news.length === 0
                  ? <EmptyHint>近 7 天無相關新聞</EmptyHint>
                  : news?.news.map((n: NewsItem, i: number) => (
                    <NewsRow key={i} date={n.date} title={n.title} url={n.url} badge={n.source} />
                  ))}
              </NewsSection>

              {/* C: External links */}
              <div>
                <div className="text-xs font-semibold text-text-s uppercase tracking-wide mb-2">外部連結</div>
                <div className="flex flex-wrap gap-2">
                  {news?.external_links.map((l: ExternalLink) => (
                    <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded border border-border-c text-text-s
                                 hover:text-accent hover:border-accent transition-colors">
                      {l.name} ↗
                    </a>
                  ))}
                </div>
              </div>

              {/* D: Capacity analysis */}
              <CapacitySection symbol={stock.symbol} name={stock.name} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtInsti(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1000).toFixed(1)}K`;
  return abs.toLocaleString('zh-TW');
}

type InstiKey = 'foreign_net' | 'trust_net' | 'dealer_net' | 'total_net'
              | 'margin_balance' | 'margin_change' | 'short_balance' | 'short_change';

interface InstiMetricDef {
  key: InstiKey;
  label: string;
  unit: string;
  /** balance = snapshot metric (display latest value, 20d left side = latest-vs-20d change). */
  balance?: boolean;
  emphasize?: boolean;
  invertColor?: boolean;  // 融券: positive change = bearish
}

const INSTI_METRICS: InstiMetricDef[] = [
  { key: 'foreign_net',    label: '外資買賣超', unit: '股' },
  { key: 'trust_net',      label: '投信買賣超', unit: '股' },
  { key: 'dealer_net',     label: '自營買賣超', unit: '股' },
  { key: 'total_net',      label: '三大法人合計', unit: '股', emphasize: true },
  { key: 'margin_balance', label: '融資餘額',   unit: '張', balance: true },
  { key: 'margin_change',  label: '融資增減',   unit: '張' },
  { key: 'short_balance',  label: '融券餘額',   unit: '張', balance: true },
  { key: 'short_change',   label: '融券增減',   unit: '張', invertColor: true },
];

function fmtDate(yyyymmdd: string) {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd;
  return `${yyyymmdd.slice(4,6)}/${yyyymmdd.slice(6,8)}`;
}

function InstitutionalSection({ symbol }: { symbol: string }) {
  const { data: history, loading } = useInstitutionalHistory(symbol, 20);
  const [openKey, setOpenKey] = useState<InstiKey | null>(null);

  if (loading && history.length === 0) {
    return (
      <div className="p-4 border-b border-border-c">
        <h3 className="text-sm font-semibold text-text-p mb-2">三大法人 / 融資融券</h3>
        <div className="text-sm text-text-t">載入中...</div>
      </div>
    );
  }
  if (history.length === 0) {
    return (
      <div className="p-4 border-b border-border-c">
        <h3 className="text-sm font-semibold text-text-p mb-2">三大法人 / 融資融券</h3>
        <div className="text-sm text-text-t">尚無法人資料（cache 還沒回填）</div>
      </div>
    );
  }

  const latest = history[0];
  const dateRange = history.length > 1
    ? `${fmtDate(history[history.length-1].date)} ~ ${fmtDate(latest.date)}`
    : fmtDate(latest.date);

  return (
    <div className="p-4 border-b border-border-c">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-p">三大法人 / 融資融券</h3>
        <span className="text-xs text-text-t font-mono">
          近 {history.length} 日 · {dateRange}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {INSTI_METRICS.map((m) => (
          <InstiCard
            key={m.key}
            def={m}
            history={history}
            isOpen={openKey === m.key}
            onToggle={() => setOpenKey(openKey === m.key ? null : m.key)}
          />
        ))}
      </div>
      {openKey && (
        <InstiDailyTable def={INSTI_METRICS.find((m) => m.key === openKey)!} history={history} />
      )}
    </div>
  );
}

function InstiCard({ def, history, isOpen, onToggle }: {
  def: InstiMetricDef;
  history: InstitutionalHistoryDay[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const latest = history[0];
  const latestVal = latest ? (latest[def.key] as number) : 0;

  // Left side:
  //   - net flow: 20-day sum
  //   - balance: 20-day change (latest - oldest)
  let leftVal: number;
  if (def.balance) {
    const oldest = history[history.length - 1];
    leftVal = latestVal - (oldest ? (oldest[def.key] as number) : 0);
  } else {
    leftVal = history.reduce((s, d) => s + (d[def.key] as number), 0);
  }

  const colorFor = (v: number) => {
    if (v === 0) return 'text-text-t';
    const isUp = def.invertColor ? v < 0 : v > 0;
    return isUp ? 'text-tw-up' : 'text-tw-down';
  };

  const sign = (v: number) => v > 0 ? '+' : v < 0 ? '-' : '';
  const fmt = (v: number) => v === 0 ? '--' : `${sign(v)}${fmtInsti(v)}`;

  return (
    <button
      onClick={onToggle}
      className={`bg-dash-bg border rounded-lg p-2.5 text-left transition-colors
        ${isOpen ? 'border-accent ring-1 ring-accent/50' : 'border-border-c hover:border-accent/60'}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-text-s">{def.label}</span>
        <span className="text-[10px] text-text-t">{isOpen ? '▾' : '▸'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/* Left: 20-day aggregate */}
        <div className="border-r border-border-c/50 pr-2">
          <div className="text-[10px] text-text-t mb-0.5">
            {def.balance ? `近${history.length}日變化` : `近${history.length}日累計`}
          </div>
          <div className={`font-mono tabular-nums text-sm font-bold ${colorFor(leftVal)}`}>
            {fmt(leftVal)}
            <span className="text-[10px] text-text-t ml-0.5 font-normal">{def.unit}</span>
          </div>
        </div>
        {/* Right: latest day */}
        <div>
          <div className="text-[10px] text-text-t mb-0.5 font-mono">
            {latest ? fmtDate(latest.date) : '--'}
          </div>
          <div className={`font-mono tabular-nums ${def.emphasize ? 'text-base font-bold' : 'text-sm font-semibold'} ${def.balance ? 'text-text-p' : colorFor(latestVal)}`}>
            {def.balance ? fmtInsti(latestVal) : fmt(latestVal)}
            <span className="text-[10px] text-text-t ml-0.5 font-normal">{def.unit}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function InstiDailyTable({ def, history }: {
  def: InstiMetricDef;
  history: InstitutionalHistoryDay[];
}) {
  const isNet = !def.balance;
  const colorFor = (v: number) => {
    if (v === 0) return 'text-text-t';
    const isUp = def.invertColor ? v < 0 : v > 0;
    return isUp ? 'text-tw-up' : 'text-tw-down';
  };
  return (
    <div className="mt-3 bg-dash-bg border border-border-c rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-card-bg/50 text-xs font-semibold text-text-p border-b border-border-c">
        {def.label} · 近 {history.length} 日逐日明細
      </div>
      <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-dash-bg border-b border-border-c">
            <tr className="text-text-t">
              <th className="text-left px-3 py-1.5">日期</th>
              <th className="text-right px-3 py-1.5">{isNet ? '買賣超' : '餘額'}</th>
              <th className="text-right px-3 py-1.5">{isNet ? '累計' : '較前日'}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {history.map((d, i) => {
              const v = d[def.key] as number;
              // running sum (for net) or day-over-day diff (for balance)
              let secondary: number;
              if (isNet) {
                secondary = history.slice(i).reduce((s, r) => s + (r[def.key] as number), 0);
              } else {
                const prev = history[i + 1];
                secondary = prev ? (v - (prev[def.key] as number)) : 0;
              }
              const sign = (n: number) => n > 0 ? '+' : n < 0 ? '-' : '';
              return (
                <tr key={d.date} className="border-b border-border-c/40 hover:bg-card-bg/40">
                  <td className="px-3 py-1.5 text-text-s">
                    {d.date.slice(0,4)}/{d.date.slice(4,6)}/{d.date.slice(6,8)}
                  </td>
                  <td className={`text-right px-3 py-1.5 ${def.balance ? 'text-text-p' : colorFor(v)}`}>
                    {def.balance ? fmtInsti(v) : `${sign(v)}${fmtInsti(v)}`}
                  </td>
                  <td className={`text-right px-3 py-1.5 ${colorFor(secondary)}`}>
                    {sign(secondary)}{fmtInsti(secondary)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewsSection({ title, count, children }: {
  title: string; count?: number; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-text-s uppercase tracking-wide">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NewsRow({ date, title, url, badge }: {
  date: string; title: string; url: string; badge?: string;
}) {
  return (
    <a href={url || '#'} target={url ? '_blank' : undefined} rel="noopener noreferrer"
      className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-card-bg transition-colors group">
      <span className="text-xs text-accent/80 font-mono font-medium shrink-0 mt-0.5 w-20">{date}</span>
      <span className="text-xs text-text-p group-hover:text-accent transition-colors leading-relaxed flex-1">
        {title}
      </span>
      {badge && (
        <span className="text-[10px] text-text-t shrink-0 ml-1">{badge}</span>
      )}
    </a>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-t px-2 py-1">{children}</div>;
}
