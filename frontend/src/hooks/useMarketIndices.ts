import { useEffect, useState } from 'react';

export interface IndexKline {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndexData {
  symbol: string;          // yfinance ticker e.g. ^TWII
  display_code: string;    // short label e.g. "TAIEX"
  name_zh: string;
  emoji: string;
  last_close: number;
  prev_close: number;
  change_pct: number;
  last_date: string;
  klines: IndexKline[];
}

export function useMarketIndices(days = 90) {
  const [data, setData] = useState<IndexData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await fetch(`/api/indices?days=${days}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j.indices ?? []);
    } catch {
      /* silent — widget just won't render */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Re-fetch every 10 min (market indices move slowly + backend
    // auto-refreshes once a day anyway)
    const id = window.setInterval(load, 10 * 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return { data, loading, reload: load };
}
