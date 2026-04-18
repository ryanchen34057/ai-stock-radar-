import { useMemo } from 'react';
import type { StockData, MAPeriod, AlertFilter, SortBy, MAProximityFilter } from '../types/stock';
import { StockCard } from './StockCard';
import { getSignal, getMaDistance } from '../utils/calcMA';
import { useDashboardStore } from '../store/dashboardStore';

interface Props {
  stocks: StockData[];
  selectedMA: MAPeriod;
  alertFilter: AlertFilter;
  maProximityFilter: MAProximityFilter;
  selectedLayers: number[];
  sortBy: SortBy;
}

export function StockGrid({ stocks, selectedMA, alertFilter, maProximityFilter, selectedLayers, sortBy }: Props) {
  const setSelectedStock = useDashboardStore((s) => s.setSelectedStock);

  const filtered = useMemo(() => {
    let result = stocks;

    // Layer filter
    if (selectedLayers.length > 0) {
      result = result.filter((s) => selectedLayers.includes(s.layer));
    }

    // Alert filter (quick toggle)
    if (alertFilter !== 'all') {
      result = result.filter((s) => {
        const ma = s.ma[String(selectedMA) as keyof typeof s.ma] ?? null;
        const sig = getSignal(s.current_price, ma);
        return alertFilter === 'below' ? sig === 'below' : sig === 'above';
      });
    }

    // MA proximity filter
    if (maProximityFilter.enabled) {
      result = result.filter((s) => {
        const ma = s.ma[String(maProximityFilter.ma) as keyof typeof s.ma] ?? null;
        const dist = getMaDistance(s.current_price, ma);
        if (dist === null) return false;
        switch (maProximityFilter.direction) {
          case 'above': return dist >= 0 && dist <= maProximityFilter.threshold;
          case 'below': return dist <= 0 && dist >= -maProximityFilter.threshold;
          case 'at':    return Math.abs(dist) <= maProximityFilter.threshold;
        }
      });
    }

    // Sort
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'change_percent':
          return (b.change_percent ?? -999) - (a.change_percent ?? -999);
        case 'volume':
          return (b.volume ?? 0) - (a.volume ?? 0);
        case 'ma_distance': {
          const maA = a.ma[String(selectedMA) as keyof typeof a.ma] ?? null;
          const maB = b.ma[String(selectedMA) as keyof typeof b.ma] ?? null;
          const distA = getMaDistance(a.current_price, maA) ?? 0;
          const distB = getMaDistance(b.current_price, maB) ?? 0;
          return distB - distA;
        }
        case 'symbol':
          return a.symbol.localeCompare(b.symbol);
        default:
          return 0;
      }
    });
  }, [stocks, selectedMA, alertFilter, maProximityFilter, selectedLayers, sortBy]);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-t">
        <div className="text-4xl mb-3">📭</div>
        <div className="text-lg">沒有符合條件的股票</div>
        <div className="text-sm mt-1">請調整篩選條件</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {filtered.map((stock) => (
        <StockCard
          key={stock.symbol}
          stock={stock}
          selectedMA={selectedMA}
          onClick={() => setSelectedStock(stock)}
        />
      ))}
    </div>
  );
}
