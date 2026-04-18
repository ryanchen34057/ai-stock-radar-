import { useState, useEffect, useCallback } from 'react';

export interface YoutubeMention {
  id: number;
  video_id: string;
  video_title: string;
  video_url: string;
  video_date: string;
  stock_symbol: string;
  stock_name: string;
  summary: string;
  timestamp_sec: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export function useYoutubeMentions(days = 7) {
  const [data, setData] = useState<YoutubeMention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/youtube/mentions?days=${days}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setData(d.mentions ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, refresh };
}
