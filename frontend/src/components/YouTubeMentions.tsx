import { useEffect, useMemo, useRef, useState } from 'react';
import { useYoutubeMentions } from '../hooks/useYoutubeMentions';
import type { YoutubeMention } from '../hooks/useYoutubeMentions';
import { useDashboardStore } from '../store/dashboardStore';

function fmtSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timestampUrl(videoUrl: string, sec: number): string {
  return `${videoUrl}&t=${sec}s`;
}

interface VideoGroup {
  video_id: string;
  video_title: string;
  video_url: string;
  video_date: string;
  mentions: YoutubeMention[];
}

const SENTIMENT_CONFIG = {
  bullish: { label: '看漲', arrow: '▲', textCls: 'text-tw-up', bgCls: 'bg-tw-up/10 border-tw-up/30', barCls: 'bg-tw-up' },
  bearish: { label: '看跌', arrow: '▼', textCls: 'text-tw-down', bgCls: 'bg-tw-down/10 border-tw-down/30', barCls: 'bg-tw-down' },
  neutral: { label: '', arrow: '', textCls: 'text-text-t', bgCls: 'bg-border-c/20 border-border-c/30', barCls: 'bg-border-c/40' },
} as const;

function MentionRow({ m, videoUrl, onStockClick }: {
  m: YoutubeMention;
  videoUrl: string;
  onStockClick: () => void;
}) {
  const sent = SENTIMENT_CONFIG[m.sentiment ?? 'neutral'];
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${sent.bgCls}`}>
      {/* Sentiment bar */}
      <div className={`w-0.5 flex-shrink-0 rounded-full self-stretch ${sent.barCls}`} />

      <div className="flex-1 min-w-0">
        {/* Symbol row */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <button
            onClick={onStockClick}
            className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-card-bg
                       border border-border-c text-text-p hover:border-accent hover:text-accent
                       transition-colors cursor-pointer"
          >
            {m.stock_symbol}
          </button>
          <span className="text-xs font-medium text-text-p">{m.stock_name}</span>
          {m.sentiment !== 'neutral' && (
            <span className={`text-[11px] font-semibold ${sent.textCls} flex items-center gap-0.5`}>
              {sent.arrow} {sent.label}
            </span>
          )}
          {m.timestamp_sec > 0 && (
            <a
              href={timestampUrl(videoUrl, m.timestamp_sec)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[10px] text-text-t hover:text-accent font-mono transition-colors
                         flex items-center gap-0.5 flex-shrink-0"
            >
              ▶ {fmtSec(m.timestamp_sec)}
            </a>
          )}
        </div>
        {/* Summary */}
        <p className="text-xs text-text-s leading-relaxed">{m.summary}</p>
      </div>
    </div>
  );
}

function VideoCard({ video, onStockClick }: {
  video: VideoGroup;
  onStockClick: (symbol: string) => void;
}) {
  const bullish = video.mentions.filter(m => m.sentiment === 'bullish').length;
  const bearish = video.mentions.filter(m => m.sentiment === 'bearish').length;

  return (
    <div className="bg-card-bg border border-border-c rounded-xl overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-c/60">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-mono font-semibold text-white bg-dash-bg border border-border-c
                           px-2 py-0.5 rounded-full">
            {video.video_date}
          </span>
          <span className="text-[10px] text-text-t">理財達人秀</span>
          <div className="ml-auto flex items-center gap-1.5">
            {bullish > 0 && (
              <span className="text-[10px] text-tw-up font-semibold">▲ {bullish}</span>
            )}
            {bearish > 0 && (
              <span className="text-[10px] text-tw-down font-semibold">▼ {bearish}</span>
            )}
            <span className="text-[10px] text-text-t">{video.mentions.length} 檔</span>
          </div>
        </div>
        <a
          href={video.video_url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block"
        >
          <h3 className="text-sm font-semibold text-text-p group-hover:text-accent
                         transition-colors leading-snug line-clamp-2">
            {video.video_title}
          </h3>
          <span className="text-[10px] text-accent/70 group-hover:text-accent transition-colors mt-0.5 block">
            前往影片 ↗
          </span>
        </a>
      </div>

      {/* Mentions list */}
      <div className="px-3 py-3 space-y-2 flex-1">
        {video.mentions.map((m) => (
          <MentionRow
            key={m.id}
            m={m}
            videoUrl={video.video_url}
            onStockClick={() => onStockClick(m.stock_symbol)}
          />
        ))}
      </div>
    </div>
  );
}

export function YouTubeMentions() {
  const { data, loading, error, refresh: refreshMentions } = useYoutubeMentions(7);
  const setSelectedStock = useDashboardStore((s) => s.setSelectedStock);
  const stocks = useDashboardStore((s) => s.stocks);

  const [pipelineRunning, setPipelineRunning] = useState(false);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/youtube/pipeline-status');
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        const running: boolean = json.running ?? false;
        setPipelineRunning(running);
        if (wasRunningRef.current && !running) {
          refreshMentions();
        }
        wasRunningRef.current = running;
      } catch {/* ignore */}
    };

    poll();
    const id = setInterval(poll, 4000);
    return () => { active = false; clearInterval(id); };
  }, [refreshMentions]);

  const grouped = useMemo<VideoGroup[]>(() => {
    const map = new Map<string, VideoGroup>();
    for (const m of data) {
      if (!map.has(m.video_id)) {
        map.set(m.video_id, {
          video_id: m.video_id,
          video_title: m.video_title,
          video_url: m.video_url,
          video_date: m.video_date,
          mentions: [],
        });
      }
      map.get(m.video_id)!.mentions.push(m);
    }
    return Array.from(map.values());
  }, [data]);

  const handleStockClick = (symbol: string) => {
    const stock = stocks.find((s) => s.symbol === symbol);
    if (stock) setSelectedStock(stock);
  };

  // ── Header (always rendered) ──────────────────────────────────────────────
  const header = (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-sm font-semibold text-text-p">📺 近 7 天 YouTube 提及股票</span>
      {data.length > 0 && (
        <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
          {data.length} 則
        </span>
      )}
      {pipelineRunning && (
        <span className="flex items-center gap-1 text-[10px] text-yellow-400">
          <span className="inline-block w-2.5 h-2.5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          影片解析中
        </span>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="mx-4 my-2">
        {header}
        <div className="text-xs text-text-t animate-pulse">載入中...</div>
      </div>
    );
  }

  if (error || data.length === 0) {
    return (
      <div className="mx-4 my-2">
        {header}
        <div className="px-4 py-3 bg-card-bg border border-border-c rounded-xl text-xs text-text-t">
          {error
            ? '⚠ 無法載入資料'
            : pipelineRunning
              ? '正在分析影片，完成後將自動顯示結果...'
              : '尚無資料 — 請至設定頁面設定 API Key 後手動執行分析'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2">
      {header}
      <div className="flex gap-4 overflow-x-auto pb-2
                      scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {grouped.map((video) => (
          <div key={video.video_id} className="flex-shrink-0 w-[340px]">
            <VideoCard video={video} onStockClick={handleStockClick} />
          </div>
        ))}
      </div>
    </div>
  );
}
