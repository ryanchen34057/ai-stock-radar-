/**
 * 覆盤 — Intraday-replay modal.
 *
 * Pull a single trading day of 1-minute bars from the backend, then play
 * them back at adjustable speed (1× / 5× / 10× / 30× / 60×). The candle
 * chart accumulates bar-by-bar as the playhead advances. A simulated
 * trading panel on the right lets the user buy/sell at the current bar's
 * close to practise 盤感 with no real money risk.
 *
 * Limitations vs full tick replay:
 *   - 1-minute granularity (no per-tick / no order book depth)
 *   - yfinance only keeps the last ~7 trading days online
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { StockData } from '../types/stock';
import { useIntradayBars, useIntradayDates, type IntradayBar } from '../hooks/useIntradayBars';

interface Props {
  stock: StockData;
  onClose: () => void;
}

const SPEEDS = [1, 5, 10, 30, 60] as const;
type Speed = typeof SPEEDS[number];

// Real-world ms per simulated 1-minute bar at 1× = 60 000.
const REAL_MS_PER_BAR = 60_000;

interface SimTrade {
  bar: number;
  time: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
}

export function ReplayModal({ stock, onClose }: Props) {
  // --- Date selection ----------------------------------------------------
  const { dates } = useIntradayDates(stock.symbol);
  const [date, setDate] = useState<string | undefined>(undefined);   // undefined = latest
  const { data, loading, error } = useIntradayBars(stock.symbol, date);
  const bars: IntradayBar[] = data?.bars ?? [];

  // --- Playback ----------------------------------------------------------
  const [playhead, setPlayhead] = useState(0);          // # of bars revealed (0..bars.length)
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(10);
  const tickRef = useRef<number | null>(null);

  // Reset playback when bars change (new day picked).
  // The most-recent bar animates toward its full OHLC over the slot's
  // duration to mimic real-time tick formation — split each minute into
  // SUBFRAMES sub-frames and interpolate.
  const SUBFRAMES = 12;
  const [formingProgress, setFormingProgress] = useState(0);

  useEffect(() => {
    setPlayhead(0);
    setFormingProgress(0);
    setPlaying(false);
    setTrades([]);
    setPosition({ qty: 0, avgCost: 0 });
  }, [data?.date]);

  // Drive the playhead forward at the chosen speed. Every sub-frame nudges
  // formingProgress; on the final sub-frame the bar is committed to playhead
  // and progress resets.
  useEffect(() => {
    if (!playing || bars.length === 0) return;
    const intervalMs = REAL_MS_PER_BAR / speed;     // ms of real time per bar
    const frameMs = Math.max(16, intervalMs / SUBFRAMES);

    const id = window.setInterval(() => {
      setFormingProgress((p) => {
        const next = p + 1 / SUBFRAMES;
        if (next >= 1) {
          // Commit current forming bar -> closed; advance playhead.
          setPlayhead((ph) => {
            const advance = ph + 1;
            if (advance >= bars.length) {
              setPlaying(false);
              return bars.length;
            }
            return advance;
          });
          return 0;
        }
        return next;
      });
    }, frameMs);
    tickRef.current = id;
    return () => { if (tickRef.current) window.clearInterval(tickRef.current); };
  }, [playing, speed, bars.length]);

  // Visible bars = first `playhead` bars (playhead=0 shows nothing yet).
  // These are the FULLY CLOSED bars; the active forming bar is bars[playhead].
  const visibleBars = useMemo(() => bars.slice(0, playhead), [bars, playhead]);

  // --- Chart -------------------------------------------------------------
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addCandlestickSeries']> | null>(null);
  const volumeSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addHistogramSeries']> | null>(null);

  /** Parse 'YYYY-MM-DDTHH:MM:SS' as if it were already UTC and return Unix
   *  seconds. lightweight-charts renders timestamps in UTC, so emitting the
   *  exchange-local time as UTC seconds makes the x-axis show 09:00 / 13:30
   *  exactly as users expect on a TW chart. */
  const toUtcSeconds = (timeStr: string): number => {
    const [d, t] = timeStr.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi, s] = (t || '0:0:0').split(':').map(Number);
    return Date.UTC(y, mo - 1, da, h, mi, s || 0) / 1000;
  };

  /** Synthetic / compressed timestamps. Thinly-traded stocks have minutes
   *  with no trades — yfinance simply omits those minutes, so a chart that
   *  positions bars by their real time ends up with ugly empty gaps (e.g.
   *  6531 愛普 trades at 09:00, then nothing until 09:30). We re-base each
   *  bar on a synthetic 1-minute grid so they sit edge-to-edge on the chart,
   *  while a tickMarkFormatter still shows the REAL time on the axis. */
  const baseSeconds = bars.length > 0 ? toUtcSeconds(bars[0].time) : 0;
  const synthSeconds = (i: number) => baseSeconds + i * 60;
  const realTimeForSynth = (synth: number): string | null => {
    const i = Math.round((synth - baseSeconds) / 60);
    return bars[i]?.time ?? null;
  };

  // Build the chart once per (stock, date) — colour scheme follows the
  // market convention used elsewhere (TW = red-up, US = green-up).
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      autoSize: true,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: '#0D1117' },
        textColor: '#8B949E',
      },
      grid: {
        vertLines: { color: '#21262D', style: 1 },
        horzLines: { color: '#21262D', style: 1 },
      },
      timeScale: { borderColor: '#30363D', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#30363D', scaleMargins: { top: 0.05, bottom: 0.30 } },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const up   = stock.market === 'US' ? '#00C851' : '#FF3B3B';
    const down = stock.market === 'US' ? '#FF3B3B' : '#00C851';
    const candle = chart.addCandlestickSeries({
      upColor: up, downColor: down,
      borderUpColor: up, borderDownColor: down,
      wickUpColor: up,  wickDownColor: down,
    });
    candleSeriesRef.current = candle;

    const vol = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
    volumeSeriesRef.current = vol;

    return () => chart.remove();
  }, [stock.symbol, stock.market, data?.date]);

  // When a new day's bars arrive: lock the time scale's visible range to
  // the full SYNTHETIC session and install a tickMarkFormatter that maps
  // synthetic seconds back to the bar's real time string for axis labels.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || bars.length === 0) return;
    // tickMarkFormatter is a TimeScaleOptions field but applyOptions is
    // typed against the narrower HorzScaleOptions; cast to satisfy TS.
    chart.timeScale().applyOptions({
      shiftVisibleRangeOnNewBar: false,
      tickMarkFormatter: (time: number) => {
        const real = realTimeForSynth(time);
        return real ? real.slice(11, 16) : '';
      },
    } as never);
    try {
      chart.timeScale().setVisibleRange({
        from: synthSeconds(0) as never,
        to: synthSeconds(bars.length - 1) as never,
      });
    } catch (err) {
      console.warn('replay: setVisibleRange failed', err);
    }
  }, [bars]);

  // The "current" bar visible to the user — the forming one when there is
  // one, else the most-recently-closed bar (when playhead reached the end).
  // Used by the quote header, the simulated-trade entry price, and live P&L.
  // Forming bar = bars[playhead] interpolated by formingProgress.
  // - Closed bars: bars[0 .. playhead-1] use their real OHLC.
  // - Forming bar: open is fixed, close/high/low expand from open toward
  //   their final values as progress 0->1 (mimics real-time tick formation).
  const formingBar: IntradayBar | null = useMemo(() => {
    if (playhead >= bars.length) return null;
    const b = bars[playhead];
    if (!b) return null;
    const p = Math.min(1, Math.max(0, formingProgress));
    const close = b.open + (b.close - b.open) * p;
    const high  = b.open + (b.high  - b.open) * p;
    const low   = b.open + (b.low   - b.open) * p;
    return {
      time: b.time,
      open: b.open,
      high: Math.max(b.open, close, high),
      low:  Math.min(b.open, close, low),
      close,
      volume: Math.round(b.volume * p),
    };
  }, [bars, playhead, formingProgress]);

  const currentBar: IntradayBar | null = formingBar
    ?? (playhead > 0 ? bars[playhead - 1] : null);

  // Push the WHOLE day's data array into both series on every render.
  //
  // Why setData instead of update(): lightweight-charts v4.2.3 only allows
  // update() on the latest time point. We need to mutate ANY past minute
  // (e.g. the forming bar grows over 12 sub-frames; backward scrubs need
  // to "un-play" past bars). Replacing the whole array sidesteps this
  // entirely — and because the array always covers all 261 minutes, the
  // time axis stays stable instead of auto-fitting around new data.
  //
  // For each minute:
  //   i <  playhead             → real OHLC (closed bar)
  //   i === playhead && forming → interpolated forming bar
  //   i >  playhead             → flat doji at open price (faint baseline)
  useEffect(() => {
    const candle = candleSeriesRef.current;
    const vol = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!candle || !vol || !chart || bars.length === 0) return;

    const upVol   = stock.market === 'US' ? 'rgba(0,200,81,0.5)'  : 'rgba(255,59,59,0.5)';
    const downVol = stock.market === 'US' ? 'rgba(255,59,59,0.5)' : 'rgba(0,200,81,0.5)';

    // Future bars are pure whitespace (just a time slot, nothing drawn) so
    // the user can't preview where price will go — but the time axis still
    // spans the full session because every minute is represented.
    // Time encoding is SYNTHETIC (1 minute per bar regardless of real-time
    // gaps) so bars sit edge-to-edge instead of stranding lone bars far
    // from the rest after illiquid stretches.
    const candleData = bars.map((b, i) => {
      const t = synthSeconds(i) as never;
      if (i < playhead) {
        return { time: t, open: b.open, high: b.high, low: b.low, close: b.close };
      }
      if (i === playhead && formingBar) {
        return {
          time: t,
          open: formingBar.open, high: formingBar.high,
          low:  formingBar.low,  close: formingBar.close,
        };
      }
      return { time: t };   // whitespace
    });

    const volData = bars.map((b, i) => {
      const t = synthSeconds(i) as never;
      if (i < playhead) {
        return { time: t, value: b.volume, color: b.close >= b.open ? upVol : downVol };
      }
      if (i === playhead && formingBar) {
        return {
          time: t,
          value: formingBar.volume,
          color: formingBar.close >= formingBar.open ? upVol : downVol,
        };
      }
      return { time: t };   // whitespace
    });

    candle.setData(candleData);
    vol.setData(volData);

    // setData can reset the visible range — re-apply the lock.
    try {
      chart.timeScale().setVisibleRange({
        from: synthSeconds(0) as never,
        to: synthSeconds(bars.length - 1) as never,
      });
    } catch { /* harmless if range can't be set this frame */ }
  }, [bars, playhead, formingBar, stock.market]);

  // --- Simulated trading -------------------------------------------------
  const [orderQty, setOrderQty] = useState(1);
  const [position, setPosition] = useState<{ qty: number; avgCost: number }>({ qty: 0, avgCost: 0 });
  const [trades, setTrades] = useState<SimTrade[]>([]);

  const submit = (side: 'buy' | 'sell') => {
    if (!currentBar || orderQty <= 0) return;
    const px = currentBar.close;
    const t: SimTrade = {
      bar: playhead, time: currentBar.time.slice(11, 16),
      side, qty: orderQty, price: px,
    };
    setTrades((arr) => [t, ...arr].slice(0, 50));

    setPosition((p) => {
      if (side === 'buy') {
        const totalCost = p.avgCost * p.qty + px * orderQty;
        const totalQty = p.qty + orderQty;
        return { qty: totalQty, avgCost: totalQty > 0 ? totalCost / totalQty : 0 };
      } else {
        const newQty = p.qty - orderQty;
        // Going flat or short: keep avgCost from the long basis for simple display.
        return { qty: newQty, avgCost: newQty <= 0 ? 0 : p.avgCost };
      }
    });
  };

  const flat = () => {
    if (!currentBar || position.qty === 0) return;
    submit(position.qty > 0 ? 'sell' : 'buy');
    // The above already updates position. After flatten, qty becomes 0.
  };

  const livePnl = (() => {
    if (!currentBar || position.qty === 0) return 0;
    return (currentBar.close - position.avgCost) * position.qty;
  })();

  // --- Header / controls -------------------------------------------------
  const isUp = currentBar
    ? (bars[0] && currentBar.close >= bars[0].open)
    : false;
  const tone = (val: number) => {
    const pos = stock.market === 'US' ? '#00C851' : '#FF3B3B';
    const neg = stock.market === 'US' ? '#FF3B3B' : '#00C851';
    return val >= 0 ? pos : neg;
  };

  const reset = () => { setPlayhead(0); setFormingProgress(0); setPlaying(false); };

  // ESC closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-2"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-dash-bg border border-border-c rounded-xl w-full max-w-7xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-c flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">📼</span>
            <span className="font-mono text-text-s text-sm">{stock.symbol}</span>
            <h2 className="text-xl font-bold text-text-p">{stock.name}</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold">
              覆盤 · 1分鐘
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={date ?? data?.date ?? ''}
              onChange={(e) => setDate(e.target.value || undefined)}
              className="text-xs bg-card-bg border border-border-c rounded px-2 py-1 text-text-p"
            >
              {dates.length === 0 && <option value="">最新交易日</option>}
              {dates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button
              onClick={onClose}
              title="關閉 (Esc)"
              className="text-text-s hover:text-text-p text-xl w-8 h-8 flex items-center justify-center
                         rounded hover:bg-card-bg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body — chart left, trade panel right */}
        <div className="flex-1 min-h-0 flex">
          {/* Left: chart + transport */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Quote header */}
            <div className="px-4 py-2 border-b border-border-c flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {currentBar ? (
                <>
                  <span className="text-3xl font-bold font-mono tabular-nums"
                        style={{ color: tone(currentBar.close - bars[0].open) }}>
                    {currentBar.close.toFixed(2)}
                  </span>
                  <span className="text-sm font-mono"
                        style={{ color: tone(currentBar.close - bars[0].open) }}>
                    {(currentBar.close - bars[0].open >= 0 ? '+' : '')}
                    {(currentBar.close - bars[0].open).toFixed(2)}{' '}
                    ({((currentBar.close - bars[0].open) / bars[0].open * 100).toFixed(2)}%)
                  </span>
                  <span className="text-xs text-text-s">
                    開 <span className="text-text-p font-mono">{bars[0].open.toFixed(2)}</span>
                  </span>
                  <span className="text-xs text-text-s">
                    高 <span className="font-mono" style={{ color: tone(1) }}>
                      {(visibleBars.length
                        ? Math.max(...visibleBars.map((b) => b.high))
                        : currentBar.high).toFixed(2)}
                    </span>
                  </span>
                  <span className="text-xs text-text-s">
                    低 <span className="font-mono" style={{ color: tone(-1) }}>
                      {(visibleBars.length
                        ? Math.min(...visibleBars.map((b) => b.low))
                        : currentBar.low).toFixed(2)}
                    </span>
                  </span>
                  <span className="text-xs text-text-s">
                    時 <span className="font-mono text-text-p">{currentBar.time.slice(11, 16)}</span>
                  </span>
                  <span className="text-xs text-text-s ml-auto">
                    {playhead} / {bars.length} bars
                  </span>
                </>
              ) : (
                <span className="text-text-t text-sm">
                  {loading ? '載入 1 分鐘 K 棒中…' :
                   error    ? `錯誤：${error}` :
                   bars.length === 0 ? `${data?.date ?? ''} 無 1 分鐘資料` :
                   '按 ▶ 開始覆盤'}
                </span>
              )}
            </div>

            {/* Chart */}
            <div className="flex-1 min-h-0 px-2">
              <div ref={chartContainerRef} className="w-full h-full" />
            </div>

            {/* Transport controls */}
            <div className="border-t border-border-c px-3 py-2 flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setPlaying((p) => !p)}
                disabled={bars.length === 0 || playhead >= bars.length}
                className="px-3 py-1 text-sm font-bold rounded bg-accent text-black hover:bg-blue-400
                           disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {playing ? '⏸ 暫停' : '▶ 播放'}
              </button>
              <button
                onClick={reset}
                disabled={bars.length === 0 || playhead === 0}
                className="px-2 py-1 text-xs rounded border border-border-c text-text-s
                           hover:text-text-p hover:border-accent disabled:opacity-40
                           disabled:cursor-not-allowed transition-colors"
              >
                ⟲ 重置
              </button>
              <div className="flex items-center gap-1">
                <span className="text-xs text-text-t mr-1">倍速</span>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`px-2 py-0.5 text-xs rounded font-mono transition-colors ${
                      speed === s
                        ? 'bg-amber-500/25 text-amber-300 border border-amber-400/60 font-bold'
                        : 'border border-border-c text-text-s hover:text-text-p'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={0}
                max={bars.length}
                value={playhead}
                onChange={(e) => {
                  setPlaying(false);
                  setPlayhead(Number(e.target.value));
                  setFormingProgress(0);
                }}
                disabled={bars.length === 0}
                className="flex-1 min-w-[120px] accent-accent"
              />
            </div>
          </div>

          {/* Right: simulated trading panel */}
          <div className="w-[260px] border-l border-border-c flex flex-col bg-card-bg/30">
            <div className="px-3 py-2 border-b border-border-c">
              <div className="text-xs text-text-t">模擬下單 / 練盤感</div>
            </div>

            {/* Position */}
            <div className="px-3 py-2 border-b border-border-c text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-text-t">持有部位</span>
                <span className="font-mono font-bold text-text-p">
                  {position.qty > 0 ? `+${position.qty}` : position.qty} 張
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-t">平均成本</span>
                <span className="font-mono text-text-p">
                  {position.qty !== 0 ? position.avgCost.toFixed(2) : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-t">未實現損益</span>
                <span className="font-mono font-bold"
                      style={{ color: tone(livePnl) }}>
                  {position.qty !== 0
                    ? (livePnl >= 0 ? '+' : '') + livePnl.toFixed(2)
                    : '—'}
                </span>
              </div>
            </div>

            {/* Order */}
            <div className="px-3 py-2 border-b border-border-c space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-t">數量</span>
                <input
                  type="number" min={1} step={1}
                  value={orderQty}
                  onChange={(e) => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 text-xs bg-dash-bg border border-border-c rounded px-2 py-1
                             text-text-p text-right font-mono focus:outline-none focus:border-accent"
                />
                <span className="text-xs text-text-t">張</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => submit('buy')}
                  disabled={!currentBar}
                  className="flex-1 py-1.5 text-sm font-bold rounded transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: stock.market === 'US' ? '#00C851' : '#FF3B3B',
                    color: '#fff',
                  }}
                >
                  買 BUY
                </button>
                <button
                  onClick={() => submit('sell')}
                  disabled={!currentBar}
                  className="flex-1 py-1.5 text-sm font-bold rounded transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: stock.market === 'US' ? '#FF3B3B' : '#00C851',
                    color: '#fff',
                  }}
                >
                  賣 SELL
                </button>
              </div>
              {position.qty !== 0 && (
                <button
                  onClick={flat}
                  className="w-full py-1 text-xs rounded border border-border-c text-text-s
                             hover:text-amber-300 hover:border-amber-400 transition-colors"
                >
                  平倉 ({position.qty > 0 ? '賣出' : '買回'} {Math.abs(position.qty)})
                </button>
              )}
            </div>

            {/* Trade log */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-3 py-2 text-xs text-text-t border-b border-border-c">
                成交紀錄
              </div>
              {trades.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-t">尚無成交</div>
              ) : (
                <table className="w-full text-[11px] font-mono">
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={i} className="border-b border-border-c/50 hover:bg-card-bg">
                        <td className="px-2 py-1 text-text-t">{t.time}</td>
                        <td className="px-1 py-1">
                          <span style={{
                            color: t.side === 'buy'
                              ? (stock.market === 'US' ? '#00C851' : '#FF3B3B')
                              : (stock.market === 'US' ? '#FF3B3B' : '#00C851'),
                            fontWeight: 'bold',
                          }}>
                            {t.side === 'buy' ? '買' : '賣'}
                          </span>
                        </td>
                        <td className="px-1 py-1 text-right text-text-p">{t.qty}</td>
                        <td className="px-2 py-1 text-right text-text-p">{t.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
