import { useState, useEffect, useCallback, useRef } from 'react';

export interface InstitutionalStock {
  foreign_net: number;     // 外資買賣超 (千股, 正=買超)
  trust_net: number;       // 投信買賣超
  dealer_net: number;      // 自營商買賣超
  total_net: number;       // 三大法人合計
  margin_balance: number;  // 融資餘額 (千股)
  margin_change: number;   // 融資增減
  short_balance: number;   // 融券餘額
  short_change: number;    // 融券增減
}

export interface InstitutionalData {
  date: string;
  stocks: Record<string, InstitutionalStock>;
}

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cache: { data: InstitutionalData; ts: number } | null = null;

export function useInstitutional() {
  const [data, setData] = useState<InstitutionalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchData = useCallback(async (force = false) => {
    if (!force && cache && Date.now() - cache.ts < CACHE_TTL) {
      setData(cache.data);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/institutional');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: InstitutionalData = await res.json();
      cache = { data: json, ts: Date.now() };
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法取得法人資料');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchData();
    }
  }, [fetchData]);

  return { data, loading, error, refresh: () => fetchData(true) };
}

export interface InstitutionalHistoryDay {
  date: string;  // YYYYMMDD
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
  margin_balance: number;
  margin_change: number;
  short_balance: number;
  short_change: number;
}

/** Fetch the last N days of institutional data for one symbol. */
export function useInstitutionalHistory(symbol: string, days = 20) {
  const [data, setData] = useState<InstitutionalHistoryDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/institutional/history/${symbol}?days=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: { history: InstitutionalHistoryDay[] }) => {
        if (!cancelled) setData(json.history || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '無法取得歷史資料');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, days]);

  return { data, loading, error };
}


/** Sum institutional data for a list of symbols. */
export function aggregateInstitutional(
  symbols: string[],
  stocks: Record<string, InstitutionalStock>,
): InstitutionalStock {
  return symbols.reduce(
    (acc, sym) => {
      const s = stocks[sym];
      if (!s) return acc;
      return {
        foreign_net:     acc.foreign_net     + s.foreign_net,
        trust_net:       acc.trust_net       + s.trust_net,
        dealer_net:      acc.dealer_net      + s.dealer_net,
        total_net:       acc.total_net       + s.total_net,
        margin_balance:  acc.margin_balance  + s.margin_balance,
        margin_change:   acc.margin_change   + s.margin_change,
        short_balance:   acc.short_balance   + s.short_balance,
        short_change:    acc.short_change    + s.short_change,
      };
    },
    { foreign_net: 0, trust_net: 0, dealer_net: 0, total_net: 0,
      margin_balance: 0, margin_change: 0, short_balance: 0, short_change: 0 },
  );
}
