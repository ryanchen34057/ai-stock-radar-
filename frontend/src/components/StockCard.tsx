import { useState } from 'react';
import type { StockData, MAPeriod } from '../types/stock';
import type { InstitutionalStock } from '../hooks/useInstitutional';
import type { BreakoutPending } from '../utils/breakoutPending';
import { patternLabel } from '../utils/breakoutPending';
import { useMASignal } from '../hooks/useMASignal';
import { MiniKlineChart } from './MiniKlineChart';
import { useDashboardStore } from '../store/dashboardStore';
import { formatPrice, formatChange, formatChangePct, formatVolume } from '../utils/formatters';
import { layerShortCode, LAYER_THEME, THEME_COLORS } from '../types/stock';
import PeTooltip from './PeTooltip';
import { getDisplayPe } from '../utils/formatPe';

interface Props {
  stock: StockData;
  selectedMA: MAPeriod;
  insti: InstitutionalStock | null;
  breakout?: BreakoutPending;       // present when 快破前高 filter is on and stock qualifies
  onClick: () => void;
}

const SIGNAL_BORDER: Record<string, string> = {
  above: 'border-l-tw-down',
  below: 'border-l-tw-up',
  at: 'border-l-tw-at',
};

const SIGNAL_DOT: Record<string, string> = {
  above: 'bg-tw-down',
  below: 'bg-tw-up',
  at: 'bg-tw-at',
};

const BADGE_COLOR: Record<string, string> = {
  crossAbove: 'bg-tw-down/10 text-tw-down',
  crossBelow: 'bg-tw-up/10 text-tw-up',
  near:       'bg-tw-at/10 text-tw-at',
  neutral:    'bg-border-c/40 text-text-t',
};

const BADGE_LABEL: Record<string, string> = {
  crossAbove: '站上',
  crossBelow: '跌破',
  near:       '貼線',
  neutral:    '',
};


function fmtNet(n: number): string {
  const abs = Math.abs(n);
  const str = abs >= 10000 ? `${(abs / 1000).toFixed(0)}K` : abs.toLocaleString('zh-TW');
  return (n > 0 ? '+' : '-') + str;
}

/**
 * 千張大戶 badge. Shows current count + % held. When we have two weeks of
 * TDCC data, also shows a red ↗ (increase) or green ↘ (decrease) arrow with
 * the WoW count change percentage.
 */
function BigHolderBadge({ bh }: { bh: NonNullable<StockData['big_holder']> }) {
  const chg = bh.count_change_pct;
  const hasChange = chg != null && Number.isFinite(chg);
  const up   = hasChange && chg! > 0;
  const down = hasChange && chg! < 0;
  const cls = up
    ? 'bg-tw-down/15 text-tw-down border border-tw-down/40'
    : down
      ? 'bg-tw-up/15 text-tw-up border border-tw-up/40'
      : 'bg-white/5 text-text-s border border-white/15';
  const arrow = up ? '↗' : down ? '↘' : '';
  const date = bh.date ? `${bh.date.slice(4,6)}/${bh.date.slice(6,8)}` : '';
  const tip = [
    `1,000 張以上大戶  (${date})`,
    `人數：${bh.count.toLocaleString()} 人  (${bh.pct.toFixed(2)}%)`,
    bh.prev_count != null
      ? `上週：${bh.prev_count.toLocaleString()} 人  →  本週${chg! >= 0 ? '增加' : '減少'} ${Math.abs(chg!).toFixed(2)}%`
      : '（本週為首筆資料，下週起顯示變化%）',
  ].join('\n');
  return (
    <span
      className={`ml-auto text-[11px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}
      title={tip}
    >
      大戶 {bh.count.toLocaleString()}
      {hasChange && (
        <span className="ml-1 font-bold">
          {arrow}{Math.abs(chg!).toFixed(1)}%
        </span>
      )}
    </span>
  );
}

// Taiwan-market conventional names for moving averages
function maLineName(period: number): string {
  switch (period) {
    case 5:   return '週線';
    case 10:  return '雙週線';
    case 20:  return '月線';
    case 60:  return '季線';
    case 120: return '半年線';
    case 240: return '年線';
    default:  return `MA${period}`;
  }
}

function sumTtmEps(stock: StockData): number | null {
  // Prefer FinMind's precomputed value (matches official TWSE).
  if (stock.ttm_eps != null) return stock.ttm_eps;
  const q = (stock.eps_quarterly ?? []).filter((r) => r.basic_eps != null).slice(0, 4);
  if (q.length !== 4) return null;
  return q.reduce((a, b) => a + (b.basic_eps ?? 0), 0);
}

function Metric({
  label, value, positive, negative, extra,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
  extra?: React.ReactNode;
}) {
  const colorCls =
    positive ? 'text-tw-up' :
    negative ? 'text-tw-down' :
    value === '—' ? 'text-text-t' :
    'text-accent';
  return (
    <div className="flex flex-col leading-tight min-w-0">
      <span className="text-[12px] text-white font-medium">{label}</span>
      <span className={`text-base font-mono tabular-nums font-bold ${colorCls} truncate flex items-center gap-0.5`}>
        {value}
        {extra}
      </span>
    </div>
  );
}

function InstiRow({ insti }: { insti: InstitutionalStock }) {
  const items = [
    { label: '外', value: insti.foreign_net },
    { label: '投', value: insti.trust_net },
    { label: '融', value: insti.margin_change },
    { label: '券', value: insti.short_change },
  ].filter((x) => x.value !== 0);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1 pt-1 border-t border-border-c/40">
      {items.map(({ label, value }) => (
        <span
          key={label}
          className={`inline-flex items-center gap-1 text-sm font-mono font-semibold px-1.5 py-0.5 rounded
            ${value > 0 ? 'bg-tw-up/10 text-tw-up' : 'bg-tw-down/10 text-tw-down'}`}
        >
          <span className="text-white text-sm font-bold">{label}</span>
          {value > 0 ? '▲' : '▼'}{fmtNet(value)}
        </span>
      ))}
    </div>
  );
}

export function StockCard({ stock, selectedMA, insti, breakout, onClick }: Props) {
  const { signal, badgeType, badgePeriod, maValue, distance } = useMASignal(stock, selectedMA);
  const isUp = (stock.change ?? 0) >= 0;
  const hasData = stock.current_price !== null;
  const showBollinger = useDashboardStore((s) => s.showBollinger);

  // K-line completeness overlay state.
  // Primary signal: backend's data_complete flag (set by real-earliest-date check).
  // Fallback (for outdated backends): <= 10 rows is a clear "only daily update ran"
  // signature. Row count alone is NOT generally reliable -- newly-IPO'd stocks can
  // legitimately have few rows -- so we only use it as a last resort.
  const klineCount = stock.kline_count ?? stock.klines.length;
  const incomplete = stock.data_complete === false
    || (stock.data_complete === undefined && klineCount <= 10);
  const [refetching, setRefetching] = useState(false);
  const handleRefetch = async (e: React.MouseEvent) => {
    e.stopPropagation();   // don't open modal
    e.preventDefault();
    if (refetching) return;
    setRefetching(true);
    try {
      await fetch(`/api/stocks/${stock.symbol}/refetch`, { method: 'POST' });
    } catch {/* ignore */}
    // Spinner shows until next dashboard refresh brings updated data
    setTimeout(() => setRefetching(false), 30_000);
  };

  // "Prime" breakout — within 2% of prior high AND ≥ 2 retests already done
  const breakoutPrime = breakout ? breakout.gapPct <= 2 && breakout.retests >= 2 : false;
  const cardBorderCls = breakoutPrime
    ? 'border-tw-up border-2 animate-pulse shadow-[0_0_18px_rgba(0,200,100,0.5)]'
    : `border border-border-c border-l-4 ${SIGNAL_BORDER[signal]}`;

  return (
    <div
      onClick={onClick}
      className={`
        relative bg-card-bg ${cardBorderCls}
        rounded-lg p-3 cursor-pointer
        hover:bg-card-hover transition-colors duration-150
        select-none
      `}
    >
      {/* Header: two rows so the name never gets squeezed by badges.
          relative+z-30 so it stays visible above the "incomplete" overlay. */}
      {/* Row A: logo + symbol + name (name takes all remaining width) */}
      <div className="flex items-center gap-2 mb-1 min-w-0 relative z-30">
        {stock.logo_id ? (
          <img
            src={`https://s3-symbol-logo.tradingview.com/${stock.logo_id}--big.svg`}
            alt=""
            className="w-9 h-9 rounded-full flex-shrink-0 bg-white p-0.5"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${SIGNAL_DOT[signal]}`} />
        )}
        <span className="font-mono text-sm font-semibold text-text-s shrink-0">{stock.symbol}</span>
        <span className="text-base font-bold text-text-p truncate flex-1 min-w-0">{stock.name}</span>
        {stock.sub_category && (
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded bg-accent/25 text-accent border border-accent/50 shrink-0 max-w-[45%] truncate"
            title={stock.sub_category}
          >
            {stock.sub_category}
          </span>
        )}
      </div>

      {/* Breakout-pending info — only when 快破前高 filter matches this stock */}
      {breakout && (
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap relative z-30">
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded font-bold border font-mono
              ${breakoutPrime
                ? 'bg-tw-up/30 text-tw-up border-tw-up'
                : 'bg-purple-500/20 text-purple-300 border-purple-500/50'}`}
            title="基底型態分類（依最低點分布判斷）"
          >
            {patternLabel(breakout.pattern)}
          </span>
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded font-mono border
              ${breakout.gapPct < 2
                ? 'bg-tw-up/20 text-tw-up border-tw-up/50'
                : 'bg-white/10 text-text-p border-white/20'}`}
            title={`前高 ${formatPrice(breakout.priorHigh)}`}
          >
            距前高 {breakout.gapPct.toFixed(1)}%
          </span>
          <span
            className="text-[11px] px-1.5 py-0.5 rounded font-mono bg-white/10 text-text-p border border-white/20"
            title="前高至今經歷多少交易日的盤整"
          >
            基底 {breakout.daysSinceHigh}d
          </span>
          {breakout.retests >= 2 && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded font-bold bg-accent/20 text-accent border border-accent/50"
              title="現價在前高 98% 以上的 bar 數（測壓次數）"
            >
              {breakout.retests}次測壓
            </span>
          )}
          <span
            className="text-[11px] px-1.5 py-0.5 rounded font-mono bg-white/5 text-text-t border border-white/10"
            title="基底最低點與前高的跌深（越淺越接近平底）"
          >
            深 {breakout.baseDepth.toFixed(0)}%
          </span>
          {breakoutPrime && (
            <span className="text-[11px] px-1.5 py-0.5 rounded font-bold bg-tw-up text-black border border-tw-up">
              ⚡ 即將突破
            </span>
          )}
        </div>
      )}

      {/* Row B: taxonomy + flags + MA signal — wraps if needed */}
      <div className="flex items-center gap-1 mb-1.5 flex-wrap">
        {(() => {
          const themeColor = THEME_COLORS[LAYER_THEME[stock.layer]] ?? '#58A6FF';
          return (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 font-mono"
              style={{
                backgroundColor: `${themeColor}26`,
                color: themeColor,
                border: `1px solid ${themeColor}55`,
              }}
              title={stock.layer_name}
            >
              {layerShortCode(stock.layer)}
            </span>
          );
        })()}
        {stock.themes && stock.themes.length > 1 && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-semibold flex-shrink-0"
            title={`跨主題：${stock.themes.join(' / ')}`}>
            ⭐跨
          </span>
        )}
        {stock.tier && (
          <span
            className={`text-[10px] px-1 py-0.5 rounded font-semibold flex-shrink-0 ${
              stock.tier === 1 ? 'bg-accent/20 text-accent'
              : stock.tier === 2 ? 'bg-white/10 text-text-s'
              : 'bg-white/5 text-text-t'
            }`}
            title={stock.tier === 1 ? 'Tier 1 核心' : stock.tier === 2 ? 'Tier 2 衛星' : 'Tier 3 觀察'}
          >
            T{stock.tier}
          </span>
        )}
        {stock.disposal && (
          <span
            className="text-[10px] px-1 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/50 font-bold flex-shrink-0"
            title={`${stock.disposal.measure}・${stock.disposal.start_date}～${stock.disposal.end_date}\n原因：${stock.disposal.reason || '累計處置'}`}
          >
            ⚠ 處置
          </span>
        )}
        {stock.is_all_time_high && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-bold flex-shrink-0">ATH</span>
        )}
        {stock.is_20d_high && !stock.is_all_time_high && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-accent/20 text-accent flex-shrink-0">20日高</span>
        )}
        <span className={`text-xs px-1.5 py-0.5 rounded ml-auto ${BADGE_COLOR[badgeType]}`}>
          {BADGE_LABEL[badgeType]}MA{badgePeriod}
          {badgeType === 'neutral' && distance !== null && (
            <>{distance >= 0 ? '↑' : '↓'}{Math.abs(distance).toFixed(1)}%</>
          )}
        </span>
      </div>

      {/* Price row */}
      <div className="flex items-baseline gap-2 mb-2">
        {hasData ? (
          <>
            <span className={`text-xl font-bold font-mono tabular-nums leading-none
              ${isUp ? 'text-tw-up' : 'text-tw-down'}`}>
              {formatPrice(stock.current_price)}
            </span>
            <span className={`text-xs font-mono tabular-nums ${isUp ? 'text-tw-up' : 'text-tw-down'}`}>
              {formatChange(stock.change)}
            </span>
            <span className={`text-xs font-mono tabular-nums ${isUp ? 'text-tw-up' : 'text-tw-down'}`}>
              {formatChangePct(stock.change_percent)}
            </span>
          </>
        ) : (
          <span className="text-text-t text-sm">尚無資料</span>
        )}
      </div>

      {/* Mini chart */}
      <div className="mb-2 relative">
        {stock.klines.length > 0 ? (
          <MiniKlineChart
            klines={stock.klines}
            selectedMA={selectedMA}
            maValues={stock.ma}
            signal={signal}
            showBollinger={showBollinger}
          />
        ) : (
          <div className="h-[88px] flex items-center justify-center text-text-t text-xs">
            無歷史資料
          </div>
        )}
      </div>

      {/* MA info row — Taiwan-style line name + separate deviation (乖離率) */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-p font-mono">
          {maLineName(selectedMA)}: <span className="text-white">{maValue ? formatPrice(maValue) : '--'}</span>
          {distance !== null && (
            <>
              <span className="text-text-t ml-2">乖離率:</span>{' '}
              <span className={distance >= 0 ? 'text-tw-down' : 'text-tw-up'}>
                {distance >= 0 ? '+' : ''}{distance.toFixed(1)}%
              </span>
            </>
          )}
        </span>
        <span className="text-text-s">L{stock.layer}</span>
      </div>

      {/* Volume row + 千張大戶 */}
      <div className="flex items-center gap-2 text-xs text-text-s mt-1">
        <span className="font-mono">{formatVolume(stock.volume)}</span>
        {stock.big_holder && <BigHolderBadge bh={stock.big_holder} />}
      </div>

      {/* Key financial metrics — 3×2 mini grid */}
      <div className="grid grid-cols-3 gap-x-2 gap-y-2 mt-2 pt-2 border-t border-border-c/40">
        {(() => {
          const pe = getDisplayPe(stock);
          return (
            <Metric
              label="本益比"
              value={pe !== null ? `${pe.toFixed(1)}x` : '—'}
              extra={pe !== null ? <PeTooltip stock={stock} /> : null}
            />
          );
        })()}
        <Metric
          label="殖利率"
          value={
            stock.ttm_dividend_yield != null
              ? `${stock.ttm_dividend_yield.toFixed(2)}%`
              : stock.dividend_yield != null
                ? `${stock.dividend_yield.toFixed(2)}%`
                : '—'
          }
        />
        <Metric
          label="股價淨值"
          value={stock.pb_ratio != null ? `${stock.pb_ratio.toFixed(2)}x` : '—'}
        />
        {(() => {
          const eps = sumTtmEps(stock);
          return (
            <Metric
              label="近4季EPS"
              value={eps != null ? eps.toFixed(2) : '—'}
            />
          );
        })()}
        <Metric
          label="ROE"
          value={stock.roe != null ? `${(stock.roe * 100).toFixed(1)}%` : '—'}
        />
        {(() => {
          // Prefer FinMind's single-month YoY (matches 財報狗 "3月營收YOY"),
          // fall back to yfinance quarterly revenueGrowth (decimal form).
          const monthlyYoy = stock.monthly_revenue_yoy;
          const quarterlyYoy = stock.revenue_growth;
          const pct =
            monthlyYoy != null ? monthlyYoy :
            quarterlyYoy != null ? quarterlyYoy * 100 :
            null;
          const label = monthlyYoy != null ? '月營收YOY' : '營收YOY';
          return (
            <Metric
              label={label}
              value={pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
              positive={pct != null && pct > 0}
              negative={pct != null && pct < 0}
            />
          );
        })()}
      </div>

      {/* Institutional row */}
      {insti && <InstiRow insti={insti} />}

      {/* Incomplete data overlay — starts below the header so symbol & name
          stay visible, making it easy to see which stocks are incomplete. */}
      {incomplete && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 right-0 bottom-0 top-[58px] bg-dash-bg/92 backdrop-blur-sm rounded-b-lg
                     flex flex-col items-center justify-center gap-3 z-20 cursor-default px-3"
        >
          {refetching ? (
            <>
              <span className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-bold text-accent">抓取中...</span>
              <span className="text-xs text-text-s">約需 10-30 秒，請稍候</span>
            </>
          ) : (
            <>
              <div className="text-3xl">⚠️</div>
              <div className="text-sm font-bold text-yellow-400 text-center">
                K 線資料不完整
                <div className="text-xs text-text-s font-normal mt-1">
                  僅 {klineCount} 筆（正常應 ≥ 500）
                </div>
              </div>
              <button
                onClick={handleRefetch}
                className="px-4 py-2 text-sm font-bold rounded-lg
                           bg-accent hover:bg-accent/80 text-black
                           transition-colors shadow-lg"
              >
                ↻ 重新抓取 5 年歷史
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
