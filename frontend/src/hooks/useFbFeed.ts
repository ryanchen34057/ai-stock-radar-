import { useEffect, useState } from 'react';

export type FbSentiment = 'bullish' | 'bearish' | 'neutral';

export interface FbStockMention {
  symbol: string;
  name: string;
  sentiment: FbSentiment;
  rationale: string;
}

export interface FbPost {
  post_id: string;
  page_id: string;
  page_name: string;
  content: string;
  posted_at: string;
  url: string;
  images: string[];
  reactions_count: number;
  comments_count: number;
  processed_at: string;
  summary: string;
  stocks: FbStockMention[];
  overall_sentiment: FbSentiment;
  summariser: string;
}

export interface FbPage {
  id: string;
  url: string;
  name: string;
  kind: string;
  enabled: boolean;
  created_at: string;
}

export function useFbFeed(days = 7, market?: 'TW' | 'US') {
  const [items, setItems] = useState<FbPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const marketParam = market ? `&market=${market}` : '';

  const load = async () => {
    try {
      const r = await fetch(`/api/fb/feed?days=${days}${marketParam}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setItems(d.items ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async () => {
    try {
      const r = await fetch('/api/fb/refresh-status');
      if (!r.ok) return;
      const j = await r.json();
      setRunning(Boolean(j.running));
    } catch { /* ignore */ }
  };

  const refresh = async () => {
    await fetch(`/api/fb/refresh?days=${days}${marketParam}`, { method: 'POST' });
    setRunning(true);
  };

  useEffect(() => {
    setLoading(true);
    load(); checkStatus();
    const id = window.setInterval(() => { load(); checkStatus(); }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, market]);

  return { items, loading, error, running, reload: load, refresh };
}

export function useFbPages(market?: 'TW' | 'US') {
  const [pages, setPages] = useState<FbPage[]>([]);
  const [loading, setLoading] = useState(true);

  const marketParam = market ? `?market=${market}` : '';

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/fb/pages${marketParam}`);
      setPages(await r.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [market]);

  const add = async (url_or_handle: string, name?: string) => {
    const r = await fetch('/api/fb/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url_or_handle, name, market: market ?? 'TW' }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.detail || `HTTP ${r.status}`);
    }
    await load();
  };

  const remove = async (page_id: string) => {
    await fetch(`/api/fb/pages/${page_id}`, { method: 'DELETE' });
    await load();
  };

  const toggle = async (page_id: string, enabled: boolean) => {
    await fetch(`/api/fb/pages/${page_id}/enabled?enabled=${enabled}`, { method: 'PATCH' });
    await load();
  };

  return { pages, loading, reload: load, add, remove, toggle };
}
