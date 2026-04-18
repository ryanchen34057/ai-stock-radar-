import { useMemo } from 'react';
import type { StockData, MAPeriod, AlertFilter } from '../types/stock';
import { getSignal } from '../utils/calcMA';

interface Props {
  stocks: StockData[];
  selectedMA: MAPeriod;
  alertFilter: AlertFilter;
}

export function StatsSummary({ stocks, selectedMA, alertFilter }: Props) {
  const stats = useMemo(() => {
    const withData = stocks.filter((s) => s.current_price !== null);
    const up = withData.filter((s) => (s.change ?? 0) > 0).length;
    const down = withData.filter((s) => (s.change ?? 0) < 0).length;
    const avgPct = withData.length > 0
      ? withData.reduce((sum, s) => sum + (s.change_percent ?? 0), 0) / withData.length
      : 0;

    const belowMA = withData.filter((s) => {
      const ma = s.ma[String(selectedMA) as keyof typeof s.ma] ?? null;
      return getSignal(s.current_price, ma) === 'below';
    }).length;

    const aboveMA = withData.filter((s) => {
      const ma = s.ma[String(selectedMA) as keyof typeof s.ma] ?? null;
      return getSignal(s.current_price, ma) === 'above';
    }).length;

    const matchAlert = alertFilter === 'all' ? withData.length
      : alertFilter === 'below' ? belowMA : aboveMA;

    return { total: stocks.length, withData: withData.length, up, down, avgPct, belowMA, aboveMA, matchAlert };
  }, [stocks, selectedMA, alertFilter]);

  const cards = [
    {
      label: '監控股數',
      value: `${stats.total}`,
      sub: alertFilter !== 'all' ? `符合警示 ${stats.matchAlert}` : `有資料 ${stats.withData}`,
      subColor: 'text-text-s',
    },
    {
      label: '漲跌家數',
      value: <span><span className="text-tw-up">{stats.up}↑</span><span className="text-text-t mx-1">/</span><span className="text-tw-down">{stats.down}↓</span></span>,
      sub: `平盤 ${stats.withData - stats.up - stats.down}`,
      subColor: 'text-text-t',
    },
    {
      label: '平均漲跌幅',
      value: <span className={stats.avgPct >= 0 ? 'text-tw-up' : 'text-tw-down'}>
        {stats.avgPct >= 0 ? '+' : ''}{stats.avgPct.toFixed(2)}%
      </span>,
      sub: `依 ${stats.withData} 檔計算`,
      subColor: 'text-text-t',
    },
    {
      label: `跌破 MA${selectedMA}`,
      value: <span className="text-tw-up">{stats.belowMA}</span>,
      sub: <span>站上 <span className="text-tw-down">{stats.aboveMA}</span></span>,
      subColor: '',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {cards.map((card, i) => (
        <div key={i} className="bg-card-bg border border-border-c rounded-lg p-3">
          <div className="text-xs text-text-s mb-1">{card.label}</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-text-p leading-none mb-1">
            {card.value}
          </div>
          <div className={`text-xs ${card.subColor}`}>{card.sub}</div>
        </div>
      ))}
    </div>
  );
}
