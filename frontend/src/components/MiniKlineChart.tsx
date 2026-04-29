import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { KLine, MAPeriod, MAValues } from '../types/stock';
import { calculateMAFull } from '../utils/calcMA';
import { calculateBollingerBands } from '../utils/calcBB';
import { useDashboardStore } from '../store/dashboardStore';

const MA_COLORS: Record<number, string> = {
  5: '#58A6FF', 10: '#BC8CFF', 20: '#FF7B72',
  60: '#FFB020', 120: '#3FB950', 240: '#FF6EB0',
};

interface Props {
  klines: KLine[];
  selectedMA: MAPeriod;
  maValues: MAValues;
  signal: 'above' | 'below' | 'at';
  /** Market — flips candle colours (TW / Asia: red-up; US / EU: green-up). */
  market?: 'TW' | 'US';
  /** Deprecated -- visibility now comes from global store. Kept for backwards-compat. */
  showBollinger?: boolean;
}

// TW & other Asian markets: red = up, green = down.
// US & EU markets: green = up, red = down.
const UP_RED = '#FF3B3B';
const UP_GREEN = '#00C851';
function candleColors(market?: 'TW' | 'US') {
  const up = market === 'US' ? UP_GREEN : UP_RED;
  const down = market === 'US' ? UP_RED : UP_GREEN;
  return { up, down };
}

export function MiniKlineChart({ klines, selectedMA, market }: Props) {
  const maVisible = useDashboardStore((s) => s.maVisible);
  const bbVisible = useDashboardStore((s) => s.bbVisible);
  const showAnyBB = bbVisible.upper || bbVisible.middle || bbVisible.lower;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // IntersectionObserver — mount AND unmount the chart based on viewport
  // visibility. With 1000+ cards on the page, leaving every chart mounted
  // (the previous one-shot behavior) burns hundreds of MB of GPU/canvas
  // state and freezes the browser. The 300px rootMargin gives enough
  // hysteresis that a normal scroll doesn't thrash mount/unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || !containerRef.current || klines.length === 0) return;

    const container = containerRef.current;
    const chart = createChart(container, {
      autoSize: true,
      height: 88,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#484F58',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#21262D', style: 1 },
      },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        visible: false,
        borderVisible: false,
      },
      leftPriceScale: { visible: false },
      crosshair: {
        vertLine: { visible: false },
        horzLine: { color: '#8B949E', width: 1, style: 2 },
      },
      handleScroll: false,
      handleScale: false,
    });

    const { up, down } = candleColors(market);
    const candleSeries = chart.addCandlestickSeries({
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
    });

    const candleData = klines.map((k) => ({
      time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));
    candleSeries.setData(candleData);

    const closes = klines.map((k) => k.close);

    const toLineData = (vals: (number | null)[]) =>
      klines
        .map((k, i) => ({
          time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
          value: vals[i],
        }))
        .filter((d): d is { time: import('lightweight-charts').UTCTimestamp; value: number } =>
          d.value !== null);

    // Draw each enabled MA
    for (const period of [5, 10, 20, 60, 120, 240] as MAPeriod[]) {
      if (!maVisible[period]) continue;
      const maFull = calculateMAFull(closes, period);
      const series = chart.addLineSeries({
        color: MA_COLORS[period],
        lineWidth: period === selectedMA ? 2 : 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(toLineData(maFull));
    }

    // Bollinger Bands overlay — render only the enabled lines
    if (showAnyBB) {
      const bb = calculateBollingerBands(closes, 20, 2);
      if (bbVisible.upper) {
        const up = chart.addLineSeries({
          color: 'rgba(187,137,255,0.85)', lineWidth: 1, lineStyle: 2,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        up.setData(toLineData(bb.upper));
      }
      if (bbVisible.lower) {
        const lo = chart.addLineSeries({
          color: 'rgba(187,137,255,0.85)', lineWidth: 1, lineStyle: 2,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        lo.setData(toLineData(bb.lower));
      }
      if (bbVisible.middle) {
        const mid = chart.addLineSeries({
          color: 'rgba(187,137,255,0.5)', lineWidth: 1,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        mid.setData(toLineData(bb.middle));
      }
    }

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [isVisible, klines, selectedMA, maVisible, bbVisible, showAnyBB]);

  return <div ref={containerRef} className="w-full" style={{ height: 88 }} />;
}
