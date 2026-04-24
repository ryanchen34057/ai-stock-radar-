import { useCallback } from 'react';
import { useDashboardStore } from '../store/dashboardStore';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useStockData() {
  const { setStocks, setLoading, setError, lastFetchTime, market } = useDashboardStore();

  const fetchData = useCallback(async (force = false) => {
    // Use cache if recent enough
    if (!force && lastFetchTime && Date.now() - lastFetchTime < CACHE_TTL) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/dashboard?market=${market}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStocks(data.stocks, data.last_updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法連線到後端伺服器');
    } finally {
      setLoading(false);
    }
  }, [setStocks, setLoading, setError, lastFetchTime, market]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return { fetchData, refresh };
}
