import { useEffect, useState } from 'react';

export interface CapacityItem {
  date: string;
  title: string;
  url: string;
  source?: string;
  matched_keyword: string;
}

export interface CapacitySource {
  category: string;
  name: string;
  desc: string;
  url: string;
}

export interface CapacityAnalysis {
  capacity_mops: CapacityItem[];
  capacity_news: CapacityItem[];
  primary_sources: CapacitySource[];
}

export function useStockCapacity(symbol: string) {
  const [data, setData] = useState<CapacityAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    fetch(`/api/stocks/${symbol}/capacity`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: CapacityAnalysis) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  return { data, loading, error };
}
