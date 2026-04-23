import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import { useMarketIndices, type IndexData } from '../hooks/useMarketIndices';

const RANGES: { label: string; days: number }[] = [
  { label: '1月', days: 22 },
  { label: '3月', days: 65 },
  { label: '6月', days: 130 },
  { label: '1年', days: 252 },
];

/**
 * Row of market-index cards shown above the ControlBar. Each card has a
 * compact candlestick chart + volume histogram (when available) using
 * lightweight-charts.
 */
export function MarketIndices() {
  const { data, loading } = useMarketIndices(260);
  const [rangeIndex, setRangeIndex] = useState(1); // default 3-month

  if (loading && data.length === 0) return null;
  if (data.length === 0) return null;

  return (
    <div className="bg-card-bg/60 border-b border-border-c px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-text-s tracking-wider">
          📊 全球大盤指數
        </span>
        <div className="flex items-center gap-1">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIndex(i)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
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
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        {data.map((idx) => (
          <IndexCard key={idx.symbol} idx={idx} days={RANGES[rangeIndex].days} />
        ))}
      </div>
    </div>
  );
}

function IndexCard({ idx, days }: { idx: IndexData; days: number }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const slice = useMemo(
    () => idx.klines.slice(-Math.min(days, idx.klines.length)),
    [idx.klines, days],
  );
  const isUp = idx.change_pct >= 0;
  const hasVolume = slice.some((k) => k.volume > 0);

  useEffect(() => {
    if (!chartRef.current || slice.length === 0) return;

    const chart = createChart(chartRef.current, {
      autoSize: true,
      height: 70,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6B7280',
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(200,200,200,0.08)', style: 1 },
      },
      rightPriceScale: { visible: false, borderVisible: false,
                         scaleMargins: { top: 0.05, bottom: hasVolume ? 0.28 : 0.05 } },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { mode: 0, horzLine: { visible: false }, vertLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });

    const candles = chart.addCandlestickSeries({
      upColor: '#FF3B3B',   downColor: '#00C851',
      borderUpColor: '#FF3B3B', borderDownColor: '#00C851',
      wickUpColor: '#FF3B3B',   wickDownColor: '#00C851',
      priceLineVisible: false, lastValueVisible: false,
    });
    candles.setData(slice.map((k) => ({
      time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
      open: k.open, high: k.high, low: k.low, close: k.close,
    })));

    if (hasVolume) {
      const vol = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'v',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('v').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
      vol.setData(slice.map((k) => ({
        time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
        value: k.volume,
        color: k.close >= k.open ? 'rgba(255,59,59,0.4)' : 'rgba(0,200,81,0.4)',
      })));
    }

    return () => chart.remove();
  }, [slice, hasVolume]);

  return (
    <div className="bg-dash-bg/70 border border-border-c rounded p-1.5 hover:border-accent/40 transition-colors">
      <div className="flex items-baseline justify-between gap-1 mb-0.5">
        <span className="text-[11px] font-bold text-text-p flex items-center gap-1 min-w-0">
          <span>{idx.emoji}</span>
          <span className="truncate">{idx.name_zh}</span>
        </span>
        <span className={`text-[10px] font-mono tabular-nums font-bold flex-shrink-0
          ${isUp ? 'text-tw-down' : 'text-tw-up'}`}>
          {isUp ? '+' : ''}{idx.change_pct.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-1 mb-0.5">
        <span className="text-[10px] font-mono text-text-s">{idx.display_code}</span>
        <span className="text-[11px] font-mono tabular-nums text-text-p">
          {idx.last_close.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </span>
      </div>
      <div ref={chartRef} className="w-full h-[70px]" />
    </div>
  );
}
