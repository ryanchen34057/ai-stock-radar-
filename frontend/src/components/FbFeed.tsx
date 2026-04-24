import { useMemo, useState } from 'react';
import { useFbFeed, type FbPost, type FbStockMention } from '../hooks/useFbFeed';
import { useOpenStockBySymbol } from '../hooks/useOpenStockBySymbol';
import { useDashboardStore } from '../store/dashboardStore';

interface StockMentionAggregate {
  symbol: string;
  name: string;
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
  mentions: Array<{
    post_id: string;
    posted_at: string;
    page_name: string;
    url: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    rationale: string;
  }>;
}

function aggregateStockMentions(posts: FbPost[]): StockMentionAggregate[] {
  const map = new Map<string, StockMentionAggregate>();
  for (const p of posts) {
    for (const s of p.stocks ?? []) {
      const symbol = (s.symbol || '').trim();
      if (!symbol) continue;
      let agg = map.get(symbol);
      if (!agg) {
        agg = {
          symbol,
          name: s.name || '',
          total: 0, bullish: 0, bearish: 0, neutral: 0,
          mentions: [],
        };
        map.set(symbol, agg);
      }
      if (!agg.name && s.name) agg.name = s.name;
      agg.total += 1;
      if (s.sentiment === 'bullish') agg.bullish += 1;
      else if (s.sentiment === 'bearish') agg.bearish += 1;
      else agg.neutral += 1;
      agg.mentions.push({
        post_id: p.post_id,
        posted_at: p.posted_at,
        page_name: p.page_name,
        url: p.url,
        sentiment: s.sentiment,
        rationale: s.rationale,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return (b.bullish - b.bearish) - (a.bullish - a.bearish);
  });
}

export function FbFeed() {
  const market = useDashboardStore((s) => s.market);
  const { items, loading, error, running, refresh } = useFbFeed(7, market);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const [statsOpen, setStatsOpen] = useState(true);
  const [search, setSearch] = useState('');

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSymbol = (sym: string) => {
    setExpandedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym); else next.add(sym);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => {
      if (p.page_name.toLowerCase().includes(q)) return true;
      if (p.content.toLowerCase().includes(q)) return true;
      if ((p.summary ?? '').toLowerCase().includes(q)) return true;
      return (p.stocks ?? []).some((s) =>
        s.symbol.toLowerCase().includes(q) ||
        (s.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  const aggregates = useMemo(() => aggregateStockMentions(filtered), [filtered]);
  const openStock = useOpenStockBySymbol();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-c/70 flex-shrink-0 bg-card-bg/40">
        <span className="text-[11px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-semibold">
          近 7 天 · {filtered.length}{search ? `/${items.length}` : ''} 則
        </span>
        <div className="flex items-center gap-1.5">
          {running && (
            <span className="inline-block w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin"
              title="抓取/分析中..." />
          )}
          <button
            onClick={refresh}
            disabled={running}
            className="text-[11px] text-accent hover:underline disabled:opacity-50"
            title="重新抓取所有 Facebook 專頁的近期貼文並用 Gemini 分析"
          >
            {running ? '分析中' : '↻ 刷新'}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative flex items-center px-3 py-1.5 border-b border-border-c/70 flex-shrink-0">
        <span className="absolute left-5 text-text-t text-xs pointer-events-none">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋專頁、貼文、股號或股名..."
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

      {/* Stats section */}
      {aggregates.length > 0 && (
        <div className={`flex-shrink-0 border-b-2 border-border-c ${
          statsOpen ? 'max-h-[45%] flex flex-col min-h-0' : ''
        }`}>
          <StatsSection
            aggregates={aggregates}
            postCount={filtered.length}
            open={statsOpen}
            onToggleOpen={() => setStatsOpen((v) => !v)}
            expandedSymbols={expandedSymbols}
            onToggleSymbol={toggleSymbol}
            onOpenStock={openStock}
          />
        </div>
      )}

      {/* Post list */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {loading && items.length === 0 && (
          <div className="p-4 text-xs text-text-t animate-pulse">載入中...</div>
        )}
        {error && <div className="p-4 text-xs text-red-400">錯誤：{error}</div>}
        {!loading && items.length === 0 && !error && (
          <div className="p-4 text-xs text-text-t leading-relaxed">
            尚未新增 Facebook 專頁，或還沒刷新。
            <br />
            前往右上角 <span className="text-accent">⚙ 設定</span> →
            <br />
            ① 點「開啟瀏覽器登入 Facebook」
            <br />
            ② 新增專頁 URL
            <br />
            ③ 點「▶ 立即抓取貼文」
          </div>
        )}
        {search && filtered.length === 0 && items.length > 0 && (
          <div className="p-4 text-xs text-text-t">沒有符合「{search}」的貼文</div>
        )}
        {filtered.map((p) => (
          <FbPostCard key={p.post_id} post={p}
            isOpen={expanded.has(p.post_id)}
            onToggle={() => toggle(p.post_id)}
            onOpenStock={openStock} />
        ))}
      </div>
    </div>
  );
}

function StatsSection({
  aggregates, postCount, open, onToggleOpen, expandedSymbols, onToggleSymbol, onOpenStock,
}: {
  aggregates: StockMentionAggregate[];
  postCount: number;
  open: boolean;
  onToggleOpen: () => void;
  expandedSymbols: Set<string>;
  onToggleSymbol: (sym: string) => void;
  onOpenStock: (symbol: string) => boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const TOP_N = 10;
  const visible = showAll ? aggregates : aggregates.slice(0, TOP_N);
  const totalMentions = aggregates.reduce((s, a) => s + a.total, 0);

  return (
    <div className="bg-dash-bg/30 flex flex-col min-h-0 flex-1">
      <button
        onClick={onToggleOpen}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-card-hover transition-colors flex-shrink-0"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-p">📊 提及統計</span>
          <span className="text-[11px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-semibold">
            {aggregates.length} 檔 · {totalMentions} 次 · {postCount} 則貼文
          </span>
        </div>
        <span className="text-xs text-text-t">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {visible.map((agg) => (
            <StatsRow
              key={agg.symbol}
              agg={agg}
              isOpen={expandedSymbols.has(agg.symbol)}
              onToggle={() => onToggleSymbol(agg.symbol)}
              onOpenStock={onOpenStock}
            />
          ))}
          {aggregates.length > TOP_N && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-[11px] text-accent hover:bg-accent/5 py-1.5 transition-colors"
            >
              {showAll ? `▴ 收合（只顯示前 ${TOP_N} 檔）` : `▾ 顯示其餘 ${aggregates.length - TOP_N} 檔`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatsRow({
  agg, isOpen, onToggle, onOpenStock,
}: {
  agg: StockMentionAggregate;
  isOpen: boolean;
  onToggle: () => void;
  onOpenStock: (symbol: string) => boolean;
}) {
  const dominant =
    agg.bullish > agg.bearish ? 'bullish' :
    agg.bearish > agg.bullish ? 'bearish' :
    'neutral';
  const chipCls = dominant === 'bullish'
    ? 'bg-tw-up/20 text-tw-up border-tw-up/40'
    : dominant === 'bearish'
      ? 'bg-tw-down/20 text-tw-down border-tw-down/40'
      : 'bg-white/10 text-text-s border-border-c';

  return (
    <div className="border-t border-border-c/50">
      <div className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card-hover transition-colors text-left">
        <button
          onClick={onToggle}
          className={`text-xs font-mono font-bold px-2 py-0.5 rounded border shrink-0 w-10 text-center cursor-pointer ${chipCls}`}
          title="展開/收合提及事件"
        >
          {agg.total}
        </button>
        <button
          onClick={() => { if (!onOpenStock(agg.symbol)) onToggle(); }}
          className="font-mono font-bold text-accent text-sm shrink-0 hover:underline"
          title={`開啟 ${agg.symbol} ${agg.name} 股票小卡`}
        >
          {agg.symbol}
        </button>
        <button
          onClick={() => { if (!onOpenStock(agg.symbol)) onToggle(); }}
          className="text-sm text-white font-semibold truncate flex-1 text-left hover:text-accent transition-colors"
          title={`開啟 ${agg.name} 股票小卡`}
        >
          {agg.name}
        </button>
        <span className="flex items-center gap-0.5 text-[10px] font-mono shrink-0">
          {agg.bullish > 0 && <span className="text-tw-up">↑{agg.bullish}</span>}
          {agg.bearish > 0 && <span className="text-tw-down">↓{agg.bearish}</span>}
          {agg.neutral > 0 && <span className="text-text-t">─{agg.neutral}</span>}
        </span>
        <button onClick={onToggle} className="text-xs text-text-t shrink-0 hover:text-text-p" title="展開/收合提及事件">
          {isOpen ? '▾' : '▸'}
        </button>
      </div>

      {isOpen && (
        <div className="bg-dash-bg/50 px-3 py-2 space-y-1.5 border-t border-border-c/30">
          {agg.mentions
            .slice()
            .sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1))
            .map((m, i) => (
              <StatsMentionRow key={`${m.post_id}-${i}`} m={m} />
            ))}
        </div>
      )}
    </div>
  );
}

function StatsMentionRow({ m }: { m: StockMentionAggregate['mentions'][number] }) {
  const sent = sentimentStyle(m.sentiment);
  const dateShort = m.posted_at ? m.posted_at.slice(5, 10) : '--/--';
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-2 text-[12px] leading-snug items-start group"
      title={m.page_name}
    >
      <span className="shrink-0 font-mono text-text-s w-10">{dateShort}</span>
      <span className={`shrink-0 text-[10px] px-1 py-0.5 rounded border font-bold self-start ${sent.cls}`}>
        {sent.text}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-white font-bold truncate">🅕 {m.page_name}</div>
        <div className="text-[11px] text-text-s leading-snug line-clamp-2 group-hover:text-accent transition-colors">
          {m.rationale}
        </div>
      </div>
    </a>
  );
}

function sentimentStyle(s: string) {
  switch (s) {
    case 'bullish': return { cls: 'bg-tw-up/15 text-tw-up border-tw-up/40', text: '看漲 ↑' };
    case 'bearish': return { cls: 'bg-tw-down/15 text-tw-down border-tw-down/40', text: '看跌 ↓' };
    default:        return { cls: 'bg-white/5 text-text-s border-border-c', text: '中立' };
  }
}

function relativeDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 16);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return '剛剛';
    if (diffMin < 60) return `${diffMin} 分前`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小時前`;
    const days = Math.floor(diffMin / 1440);
    if (days <= 7) return `${days} 天前`;
    return iso.slice(0, 10);
  } catch { return iso.slice(0, 16); }
}

function formatMMDD(iso: string): { month: string; day: string } {
  if (!iso) return { month: '--', day: '--' };
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { month: '--', day: '--' };
    return {
      month: String(d.getMonth() + 1).padStart(2, '0'),
      day: String(d.getDate()).padStart(2, '0'),
    };
  } catch { return { month: '--', day: '--' }; }
}

function FbPostCard({ post, isOpen, onToggle, onOpenStock }: {
  post: FbPost;
  isOpen: boolean;
  onToggle: () => void;
  onOpenStock: (symbol: string) => boolean;
}) {
  const { month, day } = formatMMDD(post.posted_at);
  const overall = sentimentStyle(post.overall_sentiment || 'neutral');
  const hasStocks = (post.stocks ?? []).length > 0;
  const [contentOpen, setContentOpen] = useState(false);
  const truncated = !contentOpen && post.content.length > 200;

  return (
    <div className="border-b border-border-c/70">
      <div className="px-3 py-2.5 hover:bg-card-hover transition-colors flex gap-3">
        {/* Date column */}
        <div className="flex-shrink-0 w-12 flex flex-col items-center justify-start pt-0.5 leading-none">
          <span className="text-2xl font-bold text-white tabular-nums">{day}</span>
          <span className="text-[10px] font-mono text-text-s mt-0.5">{month}月</span>
          <span className="text-[9px] text-text-t mt-0.5 text-center">{relativeDate(post.posted_at)}</span>
        </div>

        <div className="flex-1 min-w-0">
          {/* Page name + badges */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-accent truncate">🅕 {post.page_name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${overall.cls}`}>
              {overall.text}
            </span>
            {hasStocks && (
              <span
                onClick={onToggle}
                className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded border border-accent/40 cursor-pointer hover:bg-accent/25"
                title="展開/收合個股"
              >
                {post.stocks.length} 檔個股 {isOpen ? '▾' : '▸'}
              </span>
            )}
            {post.summariser && (
              <span className="text-[10px] text-text-t font-mono" title={`分析引擎：${post.summariser}`}>
                {post.summariser === 'gemini' ? '✨ Gemini'
                 : post.summariser === 'unconfigured' ? '⚠ 未設定'
                 : post.summariser === 'error' ? '⚠'
                 : post.summariser === 'none' ? '—' : ''}
              </span>
            )}
            <a href={post.url} target="_blank" rel="noopener noreferrer"
              className="ml-auto text-[10px] text-text-s hover:text-accent">
              原文 ↗
            </a>
          </div>

          {/* Summary (1-2 sentences from Gemini) */}
          {post.summary && (
            <p className="text-[13px] text-white leading-relaxed font-medium mb-1.5">
              {post.summary}
            </p>
          )}

          {/* Full content — click-to-expand */}
          {post.content ? (
            <p
              className={`text-[12px] text-text-s leading-relaxed whitespace-pre-wrap
                         ${truncated ? 'line-clamp-3' : ''}`}
              onClick={(e) => { e.stopPropagation(); setContentOpen((v) => !v); }}
            >
              {post.content}
            </p>
          ) : (
            <p className="text-[11px] text-text-t italic">（貼文內容未抓到，請直接查看原文）</p>
          )}

          {truncated && (
            <button onClick={() => setContentOpen(true)}
              className="text-[11px] text-accent hover:underline mt-1">
              ▾ 展開完整貼文
            </button>
          )}
          {contentOpen && post.content.length > 200 && (
            <button onClick={() => setContentOpen(false)}
              className="text-[11px] text-text-t hover:text-accent mt-1">
              ▴ 收合
            </button>
          )}

          {/* Engagement */}
          {(post.reactions_count > 0 || post.comments_count > 0) && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-t">
              {post.reactions_count > 0 && <span>👍 {post.reactions_count.toLocaleString()}</span>}
              {post.comments_count > 0 && <span>💬 {post.comments_count.toLocaleString()}</span>}
            </div>
          )}
        </div>
      </div>

      {isOpen && hasStocks && (
        <div className="bg-dash-bg/40 px-3 py-2 space-y-1.5">
          {post.stocks.map((s: FbStockMention, i: number) => (
            <StockRow key={`${s.symbol}-${i}`} s={s} onOpenStock={onOpenStock} />
          ))}
        </div>
      )}
    </div>
  );
}

function StockRow({ s, onOpenStock }: {
  s: FbStockMention;
  onOpenStock: (symbol: string) => boolean;
}) {
  const sent = sentimentStyle(s.sentiment);
  return (
    <div className="flex gap-2 text-[13px] leading-snug items-start py-1">
      <button
        onClick={() => onOpenStock(s.symbol)}
        className="flex items-center gap-1.5 shrink-0 w-[96px] hover:underline"
        title={`開啟 ${s.symbol} ${s.name} 股票小卡`}
      >
        <span className="font-mono font-bold text-accent text-sm">{s.symbol}</span>
        <span className="text-white text-sm font-semibold truncate">{s.name}</span>
      </button>
      <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded border font-bold ${sent.cls}`}>
        {sent.text}
      </span>
      <span className="flex-1 text-text-s leading-snug">{s.rationale}</span>
    </div>
  );
}
