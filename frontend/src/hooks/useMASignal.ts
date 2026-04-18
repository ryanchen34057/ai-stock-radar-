import { useMemo } from 'react';
import type { StockData, MAPeriod, SignalType } from '../types/stock';
import { getMaDistance, findNearestMA } from '../utils/calcMA';

export function useMASignal(stock: StockData, period: MAPeriod) {
  return useMemo(() => {
    // Badge shows the MA the price is currently nearest to (the one being "tested")
    const nearest = findNearestMA(stock.current_price, stock.ma);
    // Info row shows the user-selected MA value and distance
    const maValue = stock.ma[String(period) as keyof typeof stock.ma] ?? null;
    const distance = getMaDistance(stock.current_price, maValue);
    return {
      signal: (nearest?.signal ?? 'at') as SignalType,
      nearestPeriod: nearest?.period ?? period,
      maValue,
      distance,
    };
  }, [stock, period]);
}
