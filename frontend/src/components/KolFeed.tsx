import { useMemo, useState } from 'react';
import { useKolFeed, type KolVideo, type KolStockMention } from '../hooks/useKolFeed';
import { useOpenStockBySymbol } from '../hooks/useOpenStockBySymbol';

interface StockMentionAggregate {
  symbol: string;
  name: string;
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
  mentions: Array<{
    video_id: string;
    published_at: string;
    channel_name: string;
    video_title: string;
    video_url: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    rationale: string;
  }>;
}

function aggregateStockMentions(videos: KolVideo[]): StockMentionAggregate[] {
  const map = new Map<string, StockMentionAggregate>();
  for (const v of videos) {
    for (const s of v.stocks ?? []) {
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
      // Prefer a non-empty name if we didn't have one yet
      if (!agg.name && s.name) agg.name = s.name;
      agg.total += 1;
      if (s.sentiment === 'bullish') agg.bullish += 1;
      else if (s.sentiment === 'bearish') agg.bearish += 1;
      else agg.neutral += 1;
      agg.mentions.push({
        video_id: v.video_id,
        published_at: v.published_at,
        channel_name: v.channel_name,
        video_title: v.title,
        video_url: v.url,
        sentiment: s.sentiment,
        rationale: s.rationale,
      });
    }
  }
  // Sort: total desc, then bullish-bearish (more bullish first) as tiebreaker
  return Array.from(map.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return (b.bullish - b.bearish) - (a.bullish - a.bearish);
  });
}

/**
 * Left sidebar: 理財 KOL Feed — recent YouTube videos from user-configured
 * channels, summarised (3 sentences + mentioned stocks + sentiment) by LLM.
 * Mirrors the NewsFeed sidebar on the right.
 */
export function KolFeed() {
  const { items, loading, error, running, refresh } = useKolFeed(7);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const [statsOpen, setStatsOpen] = useState(true);

  const toggle = (vid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(vid)) next.delete(vid); else next.add(vid);
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

  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((v) => {
      if (v.title.toLowerCase().includes(q)) return true;
      if (v.channel_name.toLowerCase().includes(q)) return true;
      if (v.summary.toLowerCase().includes(q)) return true;
      return (v.stocks ?? []).some((s) =>
        s.symbol.toLowerCase().includes(q) ||
        (s.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  const aggregates = useMemo(() => aggregateStockMentions(filteredItems), [filteredItems]);
  const openStock = useOpenStockBySymbol();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header: count + refresh (drag handle is provided by FloatingPanel) */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-c/70 flex-shrink-0 bg-card-bg/40">
        <span className="text-[11px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-semibold">
          近 7 天 · {filteredItems.length}{search ? `/${items.length}` : ''} 支
        </span>
        <div className="flex items-center gap-1.5">
          {running && (
            <span className="inline-block w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin"
              title="摘要分析中..." />
          )}
          <button
            onClick={refresh}
            disabled={running}
            className="text-[11px] text-accent hover:underline disabled:opacity-50"
            title="重新抓取所有理財頻道的近期影片並用 NotebookLM 摘要"
          >
            {running ? '分析中' : '↻ 刷新'}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative flex items-center px-3 py-1.5 border-b border-border-c/70 flex-shrink-0">
        <span className="absolute left-5 text-text-t text-xs pointer-events-none">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋影片標題、股號、股名或摘要..."
          className="w-full bg-dash-bg border border-border-c rounded pl-7 pr-7 py-1.5 text-xs text-text-p
                     placeholder:text-text-t focus:outline-none focus:border-accent"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-5 text-text-t hover:text-text-p text-xs"
            title="清除搜尋"
          >
            ✕
          </button>
        )}
      </div>

      {/* Stock-mention statistics — frozen at top with its own scroll,
          independent from the video list below. */}
      {aggregates.length > 0 && (
        <div className={`flex-shrink-0 border-b-2 border-border-c ${
          statsOpen ? 'max-h-[45%] flex flex-col min-h-0' : ''
        }`}>
          <StatsSection
            aggregates={aggregates}
            videoCount={filteredItems.length}
            open={statsOpen}
            onToggleOpen={() => setStatsOpen((v) => !v)}
            expandedSymbols={expandedSymbols}
            onToggleSymbol={toggleSymbol}
            onOpenStock={openStock}
          />
        </div>
      )}

      {/* Video list — independent scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {loading && items.length === 0 && (
          <div className="p-4 text-xs text-text-t animate-pulse">載入中...</div>
        )}
        {error && <div className="p-4 text-xs text-red-400">錯誤：{error}</div>}
        {!loading && items.length === 0 && !error && (
          <div className="p-4 text-xs text-text-t leading-relaxed">
            尚未設定理財頻道，或尚未刷新。
            <br />
            前往右上角 <span className="text-accent">⚙ 設定</span> → 新增理財頻道後，
            再點上方 <span className="text-accent">↻ 刷新</span>。
          </div>
        )}
        {!loading && filteredItems.length === 0 && search && (
          <div className="p-4 text-xs text-text-t">沒有符合「{search}」的影片</div>
        )}
        {filteredItems.map((v) => (
          <KolCard key={v.video_id} v={v}
            isOpen={expanded.has(v.video_id)}
            onToggle={() => toggle(v.video_id)}
            onOpenStock={openStock} />
        ))}
      </div>
    </div>
  );
}

function StatsSection({
  aggregates, videoCount, open, onToggleOpen, expandedSymbols, onToggleSymbol, onOpenStock,
}: {
  aggregates: StockMentionAggregate[];
  videoCount: number;
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
            {aggregates.length} 檔 · {totalMentions} 次 · {videoCount} 支影片
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
  // Color-coded count chip: majority-bullish red / majority-bearish green / neutral gray
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
          onClick={() => onToggle()}
          className={`text-xs font-mono font-bold px-2 py-0.5 rounded border shrink-0 w-10 text-center cursor-pointer ${chipCls}`}
          title="展開/收合提及事件"
        >
          {agg.total}
        </button>
        <button
          onClick={() => {
            if (!onOpenStock(agg.symbol)) onToggle();
          }}
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
        {/* Sentiment mini-bars */}
        <span className="flex items-center gap-0.5 text-[10px] font-mono shrink-0">
          {agg.bullish > 0 && <span className="text-tw-up">↑{agg.bullish}</span>}
          {agg.bearish > 0 && <span className="text-tw-down">↓{agg.bearish}</span>}
          {agg.neutral > 0 && <span className="text-text-t">─{agg.neutral}</span>}
        </span>
        <button
          onClick={onToggle}
          className="text-xs text-text-t shrink-0 hover:text-text-p"
          title="展開/收合提及事件"
        >
          {isOpen ? '▾' : '▸'}
        </button>
      </div>

      {isOpen && (
        <div className="bg-dash-bg/50 px-3 py-2 space-y-1.5 border-t border-border-c/30">
          {agg.mentions
            .slice()
            .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
            .map((m, i) => (
              <StatsMentionRow key={`${m.video_id}-${i}`} m={m} />
            ))}
        </div>
      )}
    </div>
  );
}

function StatsMentionRow({ m }: { m: StockMentionAggregate['mentions'][number] }) {
  const sent = sentimentStyle(m.sentiment);
  const dateShort = m.published_at ? m.published_at.slice(5, 10) : '--/--';
  return (
    <a
      href={m.video_url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-2 text-[12px] leading-snug items-start group"
      title={m.video_title}
    >
      <span className="shrink-0 font-mono text-text-s w-10">{dateShort}</span>
      <span className={`shrink-0 text-[10px] px-1 py-0.5 rounded border font-bold self-start ${sent.cls}`}>
        {sent.text}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-text-t truncate">{m.channel_name}</div>
        <div className="text-white font-medium leading-snug line-clamp-2 group-hover:text-accent transition-colors">
          {m.rationale || m.video_title}
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
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 60) return `${diffMin}分前`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小時前`;
    const days = Math.floor(diffMin / 1440);
    if (days <= 7) return `${days} 天前`;
    return iso.slice(0, 10);
  } catch { return iso.slice(0, 10); }
}

function formatPubMMDD(iso: string): { month: string; day: string } {
  if (!iso) return { month: '--', day: '--' };
  try {
    const d = new Date(iso);
    return {
      month: String(d.getMonth() + 1).padStart(2, '0'),
      day: String(d.getDate()).padStart(2, '0'),
    };
  } catch { return { month: '--', day: '--' }; }
}

function KolCard({ v, isOpen, onToggle, onOpenStock }: {
  v: KolVideo;
  isOpen: boolean;
  onToggle: () => void;
  onOpenStock: (symbol: string) => boolean;
}) {
  const overall = sentimentStyle(v.overall_sentiment);
  const hasStocks = v.stocks && v.stocks.length > 0;

  const { month, day } = formatPubMMDD(v.published_at);

  return (
    <div className="border-b border-border-c/70">
      <div className="px-3 py-3 hover:bg-card-hover cursor-pointer transition-colors flex gap-3"
        onClick={onToggle}>
        {/* Big date column (matches NewsFeed style) */}
        <div className="flex-shrink-0 w-12 flex flex-col items-center justify-start pt-0.5 leading-none">
          <span className="text-2xl font-bold text-white tabular-nums">{day}</span>
          <span className="text-[10px] font-mono text-text-s mt-0.5">{month}月</span>
          <span className="text-[9px] text-text-t mt-0.5">{relativeDate(v.published_at)}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 mb-1.5">
            {v.thumbnail && (
              <img src={v.thumbnail} alt="" className="w-16 h-9 rounded object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-text-t truncate">{v.channel_name}</div>
              <div className="text-xs text-text-p font-semibold leading-snug line-clamp-2">
                {v.title}
              </div>
            </div>
          </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${overall.cls}`}>
            {overall.text}
          </span>
          {hasStocks && (
            <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded border border-accent/40">
              {v.stocks.length} 檔個股
            </span>
          )}
          {v.summariser && (
            <span className="text-[10px] text-text-t font-mono" title={`摘要引擎：${v.summariser}`}>
              {v.summariser === 'notebooklm' ? '🧠 NLM'
               : v.summariser === 'gemini' ? '✨ Gemini'
               : v.summariser === 'none' ? '—'
               : v.summariser === 'error' ? '⚠' : ''}
            </span>
          )}
          <a href={v.url} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-text-s hover:text-accent ml-auto">
            ▶ 看影片 ↗
          </a>
        </div>

        {/* 3-sentence summary — primary readable content, prominent */}
        {v.summary && (
          <p className="text-[13px] text-white leading-relaxed mt-2.5 line-clamp-4 font-medium">
            {v.summary}
          </p>
        )}

        {/* Expand arrow */}
        {hasStocks && (
          <div className="text-right text-[10px] text-text-t mt-1">
            {isOpen ? '▾ 收起個股' : '▸ 展開個股'}
          </div>
        )}
        </div>
      </div>

      {isOpen && hasStocks && (
        <div className="bg-dash-bg/40 px-3 py-2 space-y-1.5">
          {v.stocks.map((s: KolStockMention, i: number) => (
            <StockRow key={`${s.symbol}-${i}`} s={s} onOpenStock={onOpenStock} />
          ))}
        </div>
      )}
    </div>
  );
}

function StockRow({ s, onOpenStock }: {
  s: KolStockMention;
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
