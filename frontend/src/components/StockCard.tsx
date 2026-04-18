import type { StockData, MAPeriod } from '../types/stock';
import type { InstitutionalStock } from '../hooks/useInstitutional';
import { useMASignal } from '../hooks/useMASignal';
import { MiniKlineChart } from './MiniKlineChart';
import { formatPrice, formatChange, formatChangePct, formatVolume } from '../utils/formatters';
import { layerShortCode, LAYER_THEME, THEME_COLORS } from '../types/stock';

interface Props {
  stock: StockData;
  selectedMA: MAPeriod;
  insti: InstitutionalStock | null;
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

export function StockCard({ stock, selectedMA, insti, onClick }: Props) {
  const { signal, badgeType, badgePeriod, maValue, distance } = useMASignal(stock, selectedMA);
  const isUp = (stock.change ?? 0) >= 0;
  const hasData = stock.current_price !== null;

  return (
    <div
      onClick={onClick}
      className={`
        relative bg-card-bg border border-border-c border-l-4 ${SIGNAL_BORDER[signal]}
        rounded-lg p-3 cursor-pointer
        hover:bg-card-hover transition-colors duration-150
        select-none
      `}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
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
          <span className="font-mono text-sm font-semibold text-text-s">{stock.symbol}</span>
          <span className="text-base font-bold text-text-p truncate">{stock.name}</span>
          {(() => {
            const themeColor = THEME_COLORS[LAYER_THEME[stock.layer]] ?? '#58A6FF';
            return (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 whitespace-nowrap"
                style={{
                  backgroundColor: `${themeColor}26`,
                  color: themeColor,
                  border: `1px solid ${themeColor}55`,
                }}
              >
                {layerShortCode(stock.layer)} {stock.layer_name}
              </span>
            );
          })()}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-1">
          {stock.is_all_time_high && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-bold">ATH</span>
          )}
          {stock.is_20d_high && !stock.is_all_time_high && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-accent/20 text-accent">20日高</span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${BADGE_COLOR[badgeType]}`}>
            {BADGE_LABEL[badgeType]}MA{badgePeriod}
            {badgeType === 'neutral' && distance !== null && (
              <>{distance >= 0 ? '↑' : '↓'}{Math.abs(distance).toFixed(1)}%</>
            )}
          </span>
        </div>
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
      <div className="mb-2">
        {stock.klines.length > 0 ? (
          <MiniKlineChart
            klines={stock.klines}
            selectedMA={selectedMA}
            maValues={stock.ma}
            signal={signal}
          />
        ) : (
          <div className="h-[88px] flex items-center justify-center text-text-t text-xs">
            無歷史資料
          </div>
        )}
      </div>

      {/* MA info row */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-p font-mono">
          MA{selectedMA}: <span className="text-white">{maValue ? formatPrice(maValue) : '--'}</span>
          {distance !== null && (
            <span className={`ml-1 ${distance >= 0 ? 'text-tw-down' : 'text-tw-up'}`}>
              ({distance >= 0 ? '+' : ''}{distance.toFixed(1)}%)
            </span>
          )}
        </span>
        <span className="text-text-s">L{stock.layer}</span>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between text-xs text-text-s mt-1">
        <span className="font-mono">{formatVolume(stock.volume)}</span>
        <span>{stock.pe_ratio ? `本益比 ${stock.pe_ratio.toFixed(1)}x` : stock.sub_category ?? ''}</span>
      </div>

      {/* Institutional row */}
      {insti && <InstiRow insti={insti} />}
    </div>
  );
}
