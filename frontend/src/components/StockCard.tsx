import { useState } from 'react';
import type { StockData, MAPeriod } from '../types/stock';
import { useMASignal } from '../hooks/useMASignal';
import { MiniKlineChart } from './MiniKlineChart';
import { formatPrice, formatChange, formatChangePct, formatVolume } from '../utils/formatters';

interface Props {
  stock: StockData;
  selectedMA: MAPeriod;
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

const SIGNAL_LABEL: Record<string, string> = {
  above: '站上',
  below: '跌破',
  at: '貼線',
};

export function StockCard({ stock, selectedMA, onClick }: Props) {
  const { signal, nearestPeriod, maValue, distance } = useMASignal(stock, selectedMA);
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
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SIGNAL_DOT[signal]}`} />
          <span className="font-mono text-xs text-text-s">{stock.symbol}</span>
          <span className="text-sm font-medium text-text-p truncate">{stock.name}</span>
        </div>
        <span className={`
          text-xs px-1.5 py-0.5 rounded flex-shrink-0 ml-1
          ${signal === 'below' ? 'bg-tw-up/10 text-tw-up' :
            signal === 'above' ? 'bg-tw-down/10 text-tw-down' :
            'bg-tw-at/10 text-tw-at'}
        `}>
          {SIGNAL_LABEL[signal]}MA{nearestPeriod}
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
            <span className={`text-xs font-mono tabular-nums
              ${isUp ? 'text-tw-up' : 'text-tw-down'}`}>
              {formatChange(stock.change)}
            </span>
            <span className={`text-xs font-mono tabular-nums
              ${isUp ? 'text-tw-up' : 'text-tw-down'}`}>
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
        <span className="text-text-s font-mono">
          MA{selectedMA}: <span className="text-text-p">{maValue ? formatPrice(maValue) : '--'}</span>
          {distance !== null && (
            <span className={`ml-1 ${distance >= 0 ? 'text-tw-down' : 'text-tw-up'}`}>
              ({distance >= 0 ? '+' : ''}{distance.toFixed(1)}%)
            </span>
          )}
        </span>
        <span className="text-text-t">
          L{stock.layer}
        </span>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between text-xs text-text-t mt-1">
        <span className="font-mono">{formatVolume(stock.volume)}</span>
        <span>{stock.pe_ratio ? `本益比 ${stock.pe_ratio.toFixed(1)}x` : stock.sub_category ?? ''}</span>
      </div>
    </div>
  );
}
