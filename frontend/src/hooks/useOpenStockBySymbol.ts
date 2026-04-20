import { useCallback } from 'react';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * Return a function that opens the stock detail modal for a given symbol.
 * If the symbol isn't in the current dashboard stock list, the function
 * returns false so callers can show a fallback message.
 */
export function useOpenStockBySymbol() {
  const stocks = useDashboardStore((s) => s.stocks);
  const setSelectedStock = useDashboardStore((s) => s.setSelectedStock);

  return useCallback((symbol: string): boolean => {
    if (!symbol) return false;
    const s = stocks.find((x) => x.symbol === symbol);
    if (!s) return false;
    setSelectedStock(s);
    return true;
  }, [stocks, setSelectedStock]);
}
