import { useEffect, useMemo, useState } from 'react';

interface NewsItem {
  stock_symbol: string;
  stock_name: string;
  date: string;
  title: string;
  source: string;
  url: string;
}

interface StockGroup {
  symbol: string;
  name: string;
  latestDate: string;
  items: NewsItem[];
}

const TRUSTED_SOURCES = ['經濟日報', '工商時報', '鉅亨網', '財訊', 'MoneyDJ', '財報狗', 'Bloomberg', 'Reuters'];

function relativeDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return dateStr;
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays} 天前`;
    return dateStr;
  } catch {
    return dateStr;
  }
}

function formatMMDD(dateStr: string): { month: string; day: string } {
  if (!dateStr) return { month: '--', day: '--' };
  const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { month: m[2], day: m[3] };
  return { month: '--', day: '--' };
}

export function NewsFeed() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true);
    fetch('/api/news/feed?limit=500')
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const triggerRefreshAll = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/news/refresh-all?skip_fresh_hours=0', { method: 'POST' });
      load();
    } finally {
      setRefreshing(false);
    }
  };

  // Group by stock, sort groups by latest date desc, sort items within group by date desc
  const groups = useMemo<StockGroup[]>(() => {
    const map = new Map<string, StockGroup>();
    for (const n of items) {
      if (!map.has(n.stock_symbol)) {
        map.set(n.stock_symbol, {
          symbol: n.stock_symbol,
          name: n.stock_name,
          latestDate: n.date,
          items: [],
        });
      }
      const g = map.get(n.stock_symbol)!;
      g.items.push(n);
      if (n.date > g.latestDate) g.latestDate = n.date;
    }
    const arr = Array.from(map.values());
    for (const g of arr) g.items.sort((a, b) => b.date.localeCompare(a.date));
    // Sort groups by news count desc; tie-break by latest date
    arr.sort((a, b) => {
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      return b.latestDate.localeCompare(a.latestDate);
    });
    return arr;
  }, [items]);

  const toggle = (sym: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  };

  return (
    <aside className="w-80 flex-shrink-0 border-l border-border-c bg-card-bg flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-c flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-p">📰 即時新聞</span>
          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
            {groups.length} 檔 / {items.length} 則
          </span>
        </div>
        <button
          onClick={triggerRefreshAll}
          disabled={refreshing}
          className="text-xs text-accent hover:underline disabled:opacity-50 disabled:cursor-wait"
          title="強制重新抓取所有股票的新聞"
        >
          {refreshing ? '抓取中...' : '↻ 全部刷新'}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {loading && groups.length === 0 && (
          <div className="p-4 text-xs text-text-t animate-pulse">載入中...</div>
        )}
        {error && <div className="p-4 text-xs text-red-400">錯誤：{error}</div>}
        {!loading && groups.length === 0 && !error && (
          <div className="p-4 text-xs text-text-t">
            尚無新聞快取，請點右上角「全部刷新」（約需 2-3 分鐘）
          </div>
        )}

        {groups.map((g) => {
          const isOpen = expanded.has(g.symbol);
          const preview = isOpen ? g.items : g.items.slice(0, 1);
          return (
            <div key={g.symbol} className="border-b border-border-c/70">
              {/* Group header */}
              <button
                onClick={() => toggle(g.symbol)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-dash-bg/30 hover:bg-card-hover transition-colors"
              >
                <span className="font-mono font-bold text-accent text-sm">{g.symbol}</span>
                <span className="text-text-p text-sm font-semibold">{g.name}</span>
                <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-semibold">
                  {g.items.length}
                </span>
                <span className="text-[10px] text-text-t ml-auto">{relativeDate(g.latestDate)}</span>
                <span className="text-xs text-text-t">{isOpen ? '▾' : '▸'}</span>
              </button>

              {/* Items */}
              {preview.map((n, i) => {
                const trusted = TRUSTED_SOURCES.some((s) => n.source.includes(s));
                const { month, day } = formatMMDD(n.date);
                return (
                  <a
                    key={`${n.url}-${i}`}
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-3 px-3 py-2.5 hover:bg-card-hover transition-colors group border-t border-border-c/30"
                  >
                    {/* Date column - large white */}
                    <div className="flex-shrink-0 w-12 flex flex-col items-center justify-start pt-0.5 leading-none">
                      <span className="text-2xl font-bold text-white tabular-nums">{day}</span>
                      <span className="text-[10px] font-mono text-text-s mt-0.5">{month}月</span>
                    </div>
                    {/* Content column */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-text-p group-hover:text-accent transition-colors leading-snug line-clamp-3">
                        {n.title}
                      </div>
                      <div className="mt-1 text-[10px]">
                        <span className={trusted ? 'text-green-400 font-medium' : 'text-text-t'}>
                          {trusted && '✓ '}{n.source || '—'}
                        </span>
                      </div>
                    </div>
                  </a>
                );
              })}

              {/* Expand hint */}
              {!isOpen && g.items.length > 1 && (
                <button
                  onClick={() => toggle(g.symbol)}
                  className="w-full text-[10px] text-text-t hover:text-accent py-1.5 transition-colors"
                >
                  展開其餘 {g.items.length - 1} 則 ▾
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
