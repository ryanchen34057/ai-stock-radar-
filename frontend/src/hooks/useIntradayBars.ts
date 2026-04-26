import { useEffect, useState } from 'react';

export interface IntradayBar {
  time: string;            // 'YYYY-MM-DDTHH:MM:SS' (exchange tz)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IntradayResponse {
  date: string | null;
  bars: IntradayBar[];
  source: 'cache' | 'yfinance' | 'empty';
}

/** Fetch one trading day of 1-minute bars for a symbol. Pass `date` as
 *  YYYY-MM-DD; pass undefined to let the backend pick the latest available
 *  trading day. */
export function useIntradayBars(symbol: string, date?: string) {
  const [data, setData] = useState<IntradayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = date
      ? `/api/stocks/${symbol}/intraday?date=${date}`
      : `/api/stocks/${symbol}/intraday`;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: IntradayResponse) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, date]);

  return { data, loading, error };
}

/** List up to ~14 recent trading dates that have intraday data available. */
export function useIntradayDates(symbol: string) {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/${symbol}/intraday/dates`)
      .then((r) => r.ok ? r.json() : { dates: [] })
      .then((j: { dates: string[] }) => { if (!cancelled) setDates(j.dates ?? []); })
      .catch(() => { if (!cancelled) setDates([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  return { dates, loading };
}
