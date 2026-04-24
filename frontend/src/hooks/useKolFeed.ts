import { useEffect, useState } from 'react';

export interface KolStockMention {
  symbol: string;
  name: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  rationale: string;
}

export interface KolVideo {
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  url: string;
  thumbnail: string;
  published_at: string;
  summary: string;
  stocks: KolStockMention[];
  overall_sentiment: 'bullish' | 'bearish' | 'neutral';
  summariser?: string;   // 'notebooklm' | 'gemini' | 'none' | 'error'
  processed_at: string;
}

export interface KolChannel {
  channel_id: string;
  name: string;
  description: string;
  enabled: boolean;
  created_at: string;
}

export function useKolFeed(days = 7, market?: 'TW' | 'US') {
  const [items, setItems] = useState<KolVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const marketParam = market ? `&market=${market}` : '';

  const load = async () => {
    try {
      const r = await fetch(`/api/kol/feed?days=${days}${marketParam}`);
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
      const r = await fetch('/api/kol/refresh-status');
      if (!r.ok) return;
      const j = await r.json();
      setRunning(Boolean(j.running));
    } catch {/* ignore */}
  };

  const triggerRefresh = async () => {
    await fetch(`/api/kol/refresh?days=${days}${marketParam}`, { method: 'POST' });
    setRunning(true);
  };

  useEffect(() => {
    setLoading(true);
    load();
    checkStatus();
    const id = window.setInterval(() => { load(); checkStatus(); }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, market]);

  return { items, loading, error, running, reload: load, refresh: triggerRefresh };
}

export function useKolChannels(market?: 'TW' | 'US') {
  const [channels, setChannels] = useState<KolChannel[]>([]);
  const [loading, setLoading] = useState(true);

  const marketParam = market ? `?market=${market}` : '';

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/kol/channels${marketParam}`);
      setChannels(await r.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [market]);

  const add = async (url_or_id: string, name?: string) => {
    const r = await fetch('/api/kol/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url_or_id, name, market: market ?? 'TW' }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.detail || `HTTP ${r.status}`);
    }
    await load();
  };

  const remove = async (channel_id: string) => {
    await fetch(`/api/kol/channels/${channel_id}`, { method: 'DELETE' });
    await load();
  };

  const toggle = async (channel_id: string, enabled: boolean) => {
    await fetch(`/api/kol/channels/${channel_id}/enabled?enabled=${enabled}`, { method: 'PATCH' });
    await load();
  };

  return { channels, loading, reload: load, add, remove, toggle };
}
