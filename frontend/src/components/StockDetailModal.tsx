import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { StockData, KLine, MAPeriod } from '../types/stock';
import { calculateMAFull } from '../utils/calcMA';
import { formatPrice, formatChange, formatChangePct, formatVolume, formatMarketCap } from '../utils/formatters';
import { useDashboardStore } from '../store/dashboardStore';

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

  const [fullKlines, setFullKlines] = useState<KLine[]>([]);
  const [loadingKlines, setLoadingKlines] = useState(true);
  const [rangeIndex, setRangeIndex] = useState(2); // default 1年

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
      height: 340,
      layout: {
        background: { type: ColorType.Solid, color: darkMode ? '#0D1117' : '#FFFFFF' },
        textColor: darkMode ? '#8B949E' : '#555',
      },
      grid: {
        vertLines: { color: darkMode ? '#21262D' : '#F0F0F0', style: 1 },
        horzLines: { color: darkMode ? '#21262D' : '#F0F0F0', style: 1 },
      },
      timeScale: { borderColor: '#30363D', timeVisible: true },
      rightPriceScale: { borderColor: '#30363D' },
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

    // Compute all 6 MA lines from the full klines (so MA is accurate even when zoomed)
    const allCloses = fullKlines.map((k) => k.close);
    const offset = fullKlines.length - klines.length;

    for (const period of [5, 10, 20, 60, 120, 240] as MAPeriod[]) {
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

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [fullKlines, loadingKlines, rangeIndex, selectedMA, darkMode]);

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
            {stock.pe_ratio && (
              <span>本益比 <span className="text-text-p font-mono">{stock.pe_ratio.toFixed(1)}x</span></span>
            )}
            <span className="text-text-t text-xs self-center">
              {loadingKlines ? '載入中...' : `共 ${fullKlines.length} 個交易日`}
            </span>
          </div>
        </div>

        {/* Chart */}
        <div className="p-4 border-b border-border-c">
          {/* Range selector */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-1.5 flex-wrap">
              {([5, 10, 20, 60, 120, 240] as MAPeriod[]).map((p) => (
                stock.ma[String(p) as keyof typeof stock.ma] !== null && (
                  <span key={p} className="text-xs font-mono" style={{ color: MA_COLORS[p] }}>
                    MA{p}: {formatPrice(stock.ma[String(p) as keyof typeof stock.ma])}
                  </span>
                )
              ))}
            </div>
            <div className="flex gap-1">
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
        <div className="p-4">
          <div className="text-xs text-text-s">{stock.sub_category}</div>
          {stock.note && (
            <div className="text-sm text-text-p mt-1">{stock.note}</div>
          )}
        </div>
      </div>
    </div>
  );
}
