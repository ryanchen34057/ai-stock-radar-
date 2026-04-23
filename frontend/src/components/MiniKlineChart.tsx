import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { KLine, MAPeriod, MAValues } from '../types/stock';
import { calculateMAFull } from '../utils/calcMA';
import { calculateBollingerBands } from '../utils/calcBB';

interface Props {
  klines: KLine[];
  selectedMA: MAPeriod;
  maValues: MAValues;
  signal: 'above' | 'below' | 'at';
  showBollinger?: boolean;
}

export function MiniKlineChart({ klines, selectedMA, showBollinger }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // IntersectionObserver for lazy rendering
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.1, rootMargin: '200px' }
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

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#FF3B3B',
      downColor: '#00C851',
      borderUpColor: '#FF3B3B',
      borderDownColor: '#00C851',
      wickUpColor: '#FF3B3B',
      wickDownColor: '#00C851',
    });

    const maSeries = chart.addLineSeries({
      color: '#FFB020',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const candleData = klines.map((k) => ({
      time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));
    candleSeries.setData(candleData);

    // Compute full MA line
    const closes = klines.map((k) => k.close);
    const maFull = calculateMAFull(closes, selectedMA);
    const maData = klines
      .map((k, i) => ({ time: k.date as unknown as import('lightweight-charts').UTCTimestamp, value: maFull[i] }))
      .filter((d): d is { time: import('lightweight-charts').UTCTimestamp; value: number } => d.value !== null);
    maSeries.setData(maData);

    // Bollinger Bands overlay (20, 2). Three thin light-purple lines; upper
    // and lower are dashed to distinguish them from the MA line.
    if (showBollinger) {
      const bb = calculateBollingerBands(closes, 20, 2);
      const toData = (vals: (number | null)[]) =>
        klines
          .map((k, i) => ({
            time: k.date as unknown as import('lightweight-charts').UTCTimestamp,
            value: vals[i],
          }))
          .filter((d): d is { time: import('lightweight-charts').UTCTimestamp; value: number } =>
            d.value !== null);

      const upperSeries = chart.addLineSeries({
        color: 'rgba(187,137,255,0.85)',  // purple
        lineWidth: 1,
        lineStyle: 2,                      // dashed
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      upperSeries.setData(toData(bb.upper));

      const lowerSeries = chart.addLineSeries({
        color: 'rgba(187,137,255,0.85)',
        lineWidth: 1,
        lineStyle: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      lowerSeries.setData(toData(bb.lower));

      const midSeries = chart.addLineSeries({
        color: 'rgba(187,137,255,0.5)',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      midSeries.setData(toData(bb.middle));
    }

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [isVisible, klines, selectedMA, showBollinger]);

  return <div ref={containerRef} className="w-full" style={{ height: 88 }} />;
}
