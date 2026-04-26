import { useEffect, useState } from 'react';

export type IntradayInterval = '1m' | '5m' | '15m' | '30m' | '60m';

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
  interval: IntradayInterval;
}

/** Fetch one trading day of intraday bars for a symbol at the given
 *  interval (1m / 5m / 15m / 30m / 60m). Pass `date` as YYYY-MM-DD;
 *  pass undefined to let the backend pick the latest available
 *  trading day. */
export function useIntradayBars(
  symbol: string,
  date?: string,
  interval: IntradayInterval = '1m',
) {
  const [data, setData] = useState<IntradayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    params.set('interval', interval);
    const url = `/api/stocks/${symbol}/intraday?${params.toString()}`;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: IntradayResponse) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, date, interval]);

  return { data, loading, error };
}

/** List up to ~14 recent trading dates that have intraday data
 *  available at the given interval. */
export function useIntradayDates(
  symbol: string,
  interval: IntradayInterval = '1m',
) {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/${symbol}/intraday/dates?interval=${interval}`)
      .then((r) => r.ok ? r.json() : { dates: [] })
      .then((j: { dates: string[] }) => { if (!cancelled) setDates(j.dates ?? []); })
      .catch(() => { if (!cancelled) setDates([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, interval]);

  return { dates, loading };
}
