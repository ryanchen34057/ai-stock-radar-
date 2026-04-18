import { useMemo } from 'react';
import type { StockData, MAPeriod, SignalType, BadgeType } from '../types/stock';
import { getSignal, getMaDistance, findNearestMA, findBestCrossSignal } from '../utils/calcMA';

const NEAR_THRESHOLD = 1; // ±1% counts as 貼線

export function useMASignal(stock: StockData, period: MAPeriod) {
  return useMemo(() => {
    // Border / dot color: static relationship with the user-selected MA
    const maValue = stock.ma[String(period) as keyof typeof stock.ma] ?? null;
    const signal: SignalType = getSignal(stock.current_price, maValue);
    const distance = getMaDistance(stock.current_price, maValue);

    // Badge: crossover takes priority → then 貼線 → then neutral
    const klines = stock.klines;
    const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : null;

    const cross = findBestCrossSignal(prevClose, stock.current_price, stock.ma);

    let badgeType: BadgeType;
    let badgePeriod: MAPeriod;

    if (cross) {
      // A MA was just crossed today
      badgeType = cross.type;
      badgePeriod = cross.period;
    } else {
      const nearest = findNearestMA(stock.current_price, stock.ma);
      if (nearest && Math.abs(nearest.distance) <= NEAR_THRESHOLD) {
        // Price is hugging some MA line
        badgeType = 'near';
        badgePeriod = nearest.period;
      } else {
        // Static state — just show distance from selected MA
        badgeType = 'neutral';
        badgePeriod = period;
      }
    }

    return { signal, badgeType, badgePeriod, maValue, distance };
  }, [stock, period]);
}
