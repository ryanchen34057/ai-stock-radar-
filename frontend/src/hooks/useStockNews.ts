import { useState, useEffect } from 'react';

export interface MopsAnnouncement {
  date: string;
  title: string;
  url: string;
}

export interface NewsItem {
  date: string;
  title: string;
  source: string;
  url: string;
}

export interface ExternalLink {
  name: string;
  url: string;
}

export interface StockNews {
  mops_announcements: MopsAnnouncement[];
  news: NewsItem[];
  external_links: ExternalLink[];
}

export function useStockNews(symbol: string) {
  const [data, setData] = useState<StockNews | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    fetch(`/api/stocks/${symbol}/news`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: StockNews) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  return { data, loading, error };
}
