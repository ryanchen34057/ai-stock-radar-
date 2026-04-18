import { useMemo } from 'react';
import type { StockData, MAPeriod, AlertFilter, SortBy, MAProximityFilter, SpecialFilters, InstiFilters } from '../types/stock';
import { StockCard } from './StockCard';
import { getSignal, getMaDistance } from '../utils/calcMA';
import { useDashboardStore } from '../store/dashboardStore';
import { useInstitutional } from '../hooks/useInstitutional';

interface Props {
  stocks: StockData[];
  selectedMA: MAPeriod;
  alertFilter: AlertFilter;
  maProximityFilter: MAProximityFilter;
  specialFilters: SpecialFilters;
  instiFilters: InstiFilters;
  selectedLayers: number[];
  sortBy: SortBy;
}

export function StockGrid({
  stocks, selectedMA, alertFilter, maProximityFilter,
  specialFilters, instiFilters, selectedLayers, sortBy,
}: Props) {
  const setSelectedStock = useDashboardStore((s) => s.setSelectedStock);
  const { data: insti } = useInstitutional();

  const filtered = useMemo(() => {
    let result = stocks;

    // Layer filter
    if (selectedLayers.length > 0) {
      result = result.filter((s) =>
        selectedLayers.some((id) =>
          s.layer === id || (s.secondary_layers?.includes(id) ?? false)
        )
      );
    }

    // Alert filter (quick toggle — static above/below selectedMA)
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

    // Special filters
    const sf = specialFilters;
    if (sf.maBullishAlignment) {
      result = result.filter((s) => {
        const { ma } = s;
        const v5 = ma['5'], v10 = ma['10'], v20 = ma['20'], v60 = ma['60'];
        return v5 !== null && v10 !== null && v20 !== null && v60 !== null
          && v5 > v10 && v10 > v20 && v20 > v60;
      });
    }
    if (sf.price20DayHigh) {
      result = result.filter((s) => s.is_20d_high);
    }
    if (sf.aboveWeeklyMA) {
      result = result.filter((s) =>
        s.current_price !== null && s.ma['5'] !== null && s.current_price > (s.ma['5'] ?? 0)
      );
    }
    if (sf.aboveMonthlyMA) {
      result = result.filter((s) =>
        s.current_price !== null && s.ma['20'] !== null && s.current_price > (s.ma['20'] ?? 0)
      );
    }
    if (sf.aboveQuarterlyMA) {
      result = result.filter((s) =>
        s.current_price !== null && s.ma['60'] !== null && s.current_price > (s.ma['60'] ?? 0)
      );
    }
    if (sf.allTimeHigh) {
      result = result.filter((s) => s.is_all_time_high);
    }

    // Institutional filters (skip if data not loaded)
    if (insti) {
      const inf = instiFilters;
      if (inf.foreignNetBuy) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.foreign_net ?? 0) > 0);
      }
      if (inf.trustNetBuy) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.trust_net ?? 0) > 0);
      }
      if (inf.marginIncreasing) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.margin_change ?? 0) > 0);
      }
      if (inf.shortDecreasing) {
        result = result.filter((s) => (insti.stocks[s.symbol]?.short_change ?? 0) < 0);
      }
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
  }, [stocks, selectedMA, alertFilter, maProximityFilter, specialFilters, instiFilters, selectedLayers, sortBy, insti]);

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
          insti={insti?.stocks[stock.symbol] ?? null}
          onClick={() => setSelectedStock(stock)}
        />
      ))}
    </div>
  );
}
