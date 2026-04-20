import { useEffect, useMemo, useRef, useState } from 'react';
import { useNewsRefreshInterval } from '../hooks/useNewsRefreshInterval';
import { useOpenStockBySymbol } from '../hooks/useOpenStockBySymbol';

interface NewsItem {
  stock_symbol: string;
  stock_name: string;
  sub_category?: string | null;
  layer_name?: string | null;
  note?: string | null;
  tier?: number | null;
  date: string;
  title: string;
  source: string;
  url: string;
}

interface StockGroup {
  symbol: string;
  name: string;
  subCategory: string | null;
  layerName: string | null;
  tier: number | null;
  latestDate: string;
  items: NewsItem[];
}

const TRUSTED_SOURCES = ['經濟日報', '工商時報', '鉅亨網', '財訊', 'MoneyDJ', '財報狗', 'Bloomberg', 'Reuters'];

// Scroll threshold within which new items flow in directly; beyond it the
// "new items" floating pill appears instead (matches Facebook's feed UX).
const NEAR_TOP_PX = 80;
// Highlight fade-in duration for newly arrived items
const HIGHLIGHT_MS = 4000;

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

function relativeTime(ts: number | null): string {
  if (ts === null) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return '剛剛';
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  return `${Math.floor(diff / 3600)} 小時前`;
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
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshIntervalMin] = useNewsRefreshInterval();
  const openStock = useOpenStockBySymbol();
  const [search, setSearch] = useState('');

  const [lastUpdateTs, setLastUpdateTs] = useState<number | null>(null);
  const [lastTrickled, setLastTrickled] = useState<{ symbol: string; name: string } | null>(null);
  const [, forceRerender] = useState(0);
  // Fresh arrivals: URLs that were newly added on the most recent poll
  const [newUrls, setNewUrls] = useState<Set<string>>(new Set());
  // Pending-new pill count (used only when user has scrolled away from the top)
  const [pendingNew, setPendingNew] = useState(0);

  const prevUrlsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearTopRef = useRef(true);

  // Trickle refresh: on each tick, tell the backend to scrape the single
  // stock with the oldest cache entry. Resolves with { symbol, name, ... }
  // so the UI can show *which* stock just arrived.
  const refreshOne = async (): Promise<{ symbol?: string; name?: string } | null> => {
    try {
      const r = await fetch('/api/news/refresh-one', { method: 'POST' });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  };

  const load = async (options?: { trickle?: boolean }) => {
    setUpdating(true);
    try {
      let justRefreshed: { symbol?: string; name?: string } | null = null;
      if (options?.trickle) {
        justRefreshed = await refreshOne();
        if (justRefreshed?.symbol) {
          setLastTrickled({ symbol: justRefreshed.symbol, name: justRefreshed.name ?? '' });
        }
      }

      const r = await fetch('/api/news/feed?limit=500');
      const d = await r.json();
      const next: NewsItem[] = d.items ?? [];

      // Diff against last snapshot to detect fresh arrivals
      const nextUrls = new Set(next.map((n) => n.url));
      const prevUrls = prevUrlsRef.current;
      const fresh: string[] = [];
      if (prevUrls.size > 0) {
        for (const u of nextUrls) if (!prevUrls.has(u)) fresh.push(u);
      }
      prevUrlsRef.current = nextUrls;

      setItems(next);
      setLastUpdateTs(Date.now());
      setError(null);

      if (fresh.length > 0) {
        setNewUrls(new Set(fresh));
        if (!isNearTopRef.current) {
          setPendingNew((p) => p + fresh.length);
        }
        window.setTimeout(() => setNewUrls(new Set()), HIGHLIGHT_MS);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  };


  // Polling — each tick trickles one stock's news onto the feed (the stock
  // with the stalest cache), matching the "one-at-a-time" refresh model.
  useEffect(() => {
    load({ trickle: true });
    if (refreshIntervalMin <= 0) return; // disabled
    const id = window.setInterval(() => load({ trickle: true }), refreshIntervalMin * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshIntervalMin]);

  // Keep "X 秒前 / X 分前" label ticking without a full reload
  useEffect(() => {
    const id = window.setInterval(() => forceRerender((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, []);

  // Track whether the user is near the top of the list
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearTop = el.scrollTop <= NEAR_TOP_PX;
    if (nearTop && !isNearTopRef.current) {
      // User just returned to top; clear pending count
      setPendingNew(0);
    }
    isNearTopRef.current = nearTop;
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setPendingNew(0);
  };

  // Group by stock. Sort order:
  //   1. Stock that the backend just trickle-refreshed (pinned to the very top)
  //   2. Stocks whose group contains newly arrived URLs (newUrls set)
  //   3. Latest news date DESC (news-date tie-breaker)
  //   4. More items wins (final tie-breaker)
  const groups = useMemo<StockGroup[]>(() => {
    const map = new Map<string, StockGroup>();
    for (const n of items) {
      if (!map.has(n.stock_symbol)) {
        map.set(n.stock_symbol, {
          symbol: n.stock_symbol,
          name: n.stock_name,
          subCategory: n.sub_category ?? null,
          layerName: n.layer_name ?? null,
          tier: n.tier ?? null,
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

    const trickledSym = lastTrickled?.symbol;
    const rank = (g: StockGroup): number => {
      if (g.symbol === trickledSym) return 0;
      if (g.items.some((n) => newUrls.has(n.url))) return 1;
      return 2;
    };
    arr.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (a.latestDate !== b.latestDate) return b.latestDate.localeCompare(a.latestDate);
      return b.items.length - a.items.length;
    });
    return arr;
  }, [items, lastTrickled, newUrls]);

  // Search-filtered groups (filters both group metadata and titles within)
  const visibleGroups = useMemo<StockGroup[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const groupMatch =
          g.symbol.toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q) ||
          (g.subCategory ?? '').toLowerCase().includes(q);
        if (groupMatch) return g;
        // Otherwise, keep only items whose title matches
        const matched = g.items.filter((n) => n.title.toLowerCase().includes(q));
        return matched.length > 0 ? { ...g, items: matched } : null;
      })
      .filter((x): x is StockGroup => x !== null);
  }, [groups, search]);

  const toggle = (sym: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  };

  const intervalLabel = refreshIntervalMin <= 0 ? '已停用' : `每 ${refreshIntervalMin} 分鐘`;

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Sub-header: count + status (drag handle is provided by FloatingPanel) */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-c/70 flex-shrink-0 bg-card-bg/40">
        <span className="text-[11px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-semibold">
          {visibleGroups.length}{search ? `/${groups.length}` : ''} 檔 / {items.length} 則
        </span>
        <div className="flex items-center gap-1.5 text-[10px] text-text-t min-w-0">
          {updating && (
            <span className="inline-block w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <span
            className="truncate"
            title={
              `刷新頻率：${intervalLabel}` +
              (lastTrickled ? `\n上次更新：${lastTrickled.symbol} ${lastTrickled.name}` : '')
            }
          >
            {updating
              ? '更新中'
              : lastTrickled
                ? `↑ ${lastTrickled.symbol} ${lastTrickled.name}`
                : relativeTime(lastUpdateTs)}
          </span>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative flex items-center px-3 py-1.5 border-b border-border-c/70 flex-shrink-0">
        <span className="absolute left-5 text-text-t text-xs pointer-events-none">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋代號、股名、新聞標題..."
          className="w-full bg-dash-bg border border-border-c rounded pl-7 pr-7 py-1.5 text-xs text-text-p
                     placeholder:text-text-t focus:outline-none focus:border-accent"
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-5 text-text-t hover:text-text-p text-xs" title="清除搜尋">
            ✕
          </button>
        )}
      </div>

      {/* Floating "new items" pill — shows only when user is scrolled away */}
      {pendingNew > 0 && (
        <button
          onClick={scrollToTop}
          className="absolute top-12 left-1/2 -translate-x-1/2 z-10
                     bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-full
                     shadow-lg shadow-black/40 hover:bg-blue-400 transition-colors
                     animate-[fadeIn_0.2s_ease-out]"
        >
          ↑ {pendingNew} 則新訊息
        </button>
      )}

      {/* List */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
      >
        {loading && groups.length === 0 && (
          <div className="p-4 text-xs text-text-t animate-pulse">載入中...</div>
        )}
        {error && <div className="p-4 text-xs text-red-400">錯誤：{error}</div>}
        {!loading && groups.length === 0 && !error && (
          <div className="p-4 text-xs text-text-t">
            尚無新聞快取 — 背景抓取中，稍後會自動出現
          </div>
        )}

        {search && visibleGroups.length === 0 && (
          <div className="p-4 text-xs text-text-t">沒有符合「{search}」的新聞或股票</div>
        )}
        {visibleGroups.map((g) => {
          const isOpen = expanded.has(g.symbol);
          const preview = isOpen ? g.items : g.items.slice(0, 1);
          const groupHasNew = g.items.some((n) => newUrls.has(n.url));
          const isTrickled = lastTrickled?.symbol === g.symbol;
          return (
            <div
              key={g.symbol}
              className={`border-b border-border-c/70 ${(groupHasNew || isTrickled) ? 'feed-new-item' : ''}`}
            >
              {/* Group header — mirrors StockCard: symbol + name + 子類別/業務 */}
              <div className="w-full text-left px-3 py-2 bg-dash-bg/30 hover:bg-card-hover transition-colors">
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); openStock(g.symbol); }}
                    className="font-mono font-bold text-accent text-sm shrink-0 hover:underline"
                    title={`開啟 ${g.symbol} ${g.name} 股票小卡`}
                  >
                    {g.symbol}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openStock(g.symbol); }}
                    className="text-text-p text-sm font-semibold truncate hover:text-accent transition-colors"
                    title={`開啟 ${g.name} 股票小卡`}
                  >
                    {g.name}
                  </button>
                  <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                    {g.items.length}
                  </span>
                  {g.tier && (
                    <span
                      className={`text-[10px] px-1 py-0.5 rounded font-semibold shrink-0 ${
                        g.tier === 1 ? 'bg-accent/20 text-accent'
                        : g.tier === 2 ? 'bg-white/10 text-text-s'
                        : 'bg-white/5 text-text-t'
                      }`}
                    >
                      T{g.tier}
                    </span>
                  )}
                  {groupHasNew && (
                    <span className="text-[10px] bg-tw-up/20 text-tw-up border border-tw-up/40 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                      NEW
                    </span>
                  )}
                  {isTrickled && !groupHasNew && (
                    <span className="text-[10px] bg-accent/20 text-accent border border-accent/40 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                      剛更新
                    </span>
                  )}
                  <span className="text-[10px] text-text-t ml-auto shrink-0">{relativeDate(g.latestDate)}</span>
                  <button
                    onClick={() => toggle(g.symbol)}
                    className="text-xs text-text-t shrink-0 hover:text-text-p"
                    title="展開/收合新聞列表"
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                </div>
                {/* Sub-row: 所屬產業層 · 子類別 */}
                {(g.layerName || g.subCategory) && (
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-text-t leading-tight">
                    {g.layerName && (
                      <span className="text-text-s font-medium">{g.layerName}</span>
                    )}
                    {g.layerName && g.subCategory && <span className="text-text-t">·</span>}
                    {g.subCategory && <span className="truncate">{g.subCategory}</span>}
                  </div>
                )}
              </div>

              {/* Items */}
              {preview.map((n, i) => {
                const trusted = TRUSTED_SOURCES.some((s) => n.source.includes(s));
                const { month, day } = formatMMDD(n.date);
                const isNew = newUrls.has(n.url);
                return (
                  <a
                    key={`${n.url}-${i}`}
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex gap-3 px-3 py-2.5 hover:bg-card-hover transition-colors group border-t border-border-c/30 ${
                      isNew ? 'feed-new-item' : ''
                    }`}
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
    </div>
  );
}
