import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { StockData, KLine, MAPeriod } from '../types/stock';
import { calculateMAFull } from '../utils/calcMA';
import { formatPrice, formatChange, formatChangePct, formatVolume, formatMarketCap } from '../utils/formatters';
import { useDashboardStore } from '../store/dashboardStore';
import { useStockNews } from '../hooks/useStockNews';
import { useInstitutional } from '../hooks/useInstitutional';
import type { MopsAnnouncement, NewsItem, ExternalLink } from '../hooks/useStockNews';

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
  const { data: news, loading: newsLoading } = useStockNews(stock.symbol);
  const { data: instiData } = useInstitutional();
  const insti = instiData?.stocks[stock.symbol];

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

        {/* Institutional section */}
        <div className="p-4 border-b border-border-c">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-text-p">三大法人 / 融資融券</h3>
            {instiData && (
              <span className="text-xs text-text-t font-mono">
                {instiData.date.slice(0, 4)}/{instiData.date.slice(4, 6)}/{instiData.date.slice(6, 8)}
              </span>
            )}
          </div>
          {!insti ? (
            <div className="text-sm text-text-t">尚無法人資料</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InstiStat label="外資買賣超" value={insti.foreign_net} unit="股" />
              <InstiStat label="投信買賣超" value={insti.trust_net} unit="股" />
              <InstiStat label="自營買賣超" value={insti.dealer_net} unit="股" />
              <InstiStat label="三大法人合計" value={insti.total_net} unit="股" emphasize />
              <InstiStat label="融資餘額" value={insti.margin_balance} unit="張" neutral />
              <InstiStat label="融資增減" value={insti.margin_change} unit="張" />
              <InstiStat label="融券餘額" value={insti.short_balance} unit="張" neutral />
              <InstiStat label="融券增減" value={insti.short_change} unit="張" invertColor />
            </div>
          )}
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

function InstiStat({ label, value, unit, emphasize, neutral, invertColor }: {
  label: string;
  value: number;
  unit: string;
  emphasize?: boolean;
  neutral?: boolean;   // for balance (no color)
  invertColor?: boolean; // for 融券 (positive = bearish)
}) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const colorClass = neutral
    ? 'text-text-p'
    : value === 0
      ? 'text-text-t'
      : (invertColor ? value < 0 : value > 0)
        ? 'text-tw-up'
        : 'text-tw-down';

  return (
    <div className="bg-dash-bg border border-border-c rounded-lg p-2.5">
      <div className="text-xs text-text-s mb-1">{label}</div>
      <div className={`font-mono tabular-nums ${emphasize ? 'text-lg font-bold' : 'text-base font-semibold'} ${colorClass}`}>
        {value === 0 ? '--' : `${sign}${fmtInsti(value)}`}
        <span className="text-xs text-text-t ml-1 font-normal">{unit}</span>
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
