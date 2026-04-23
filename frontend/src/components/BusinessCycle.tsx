import { useEffect, useState } from 'react';

interface Indicator {
  key: string;
  name: string;
  value: number | null;
  unit: string;
  score: number | null;
  weight: number;
  source: string;
  note: string;
}

interface CycleSnapshot {
  as_of?: string;
  total_score?: number;
  weighted_avg?: number;
  indicators_used?: number;
  indicators_total?: number;
  label?: string;
  key?: string;
  color?: string;
  state?: string;
  action?: string;
  indicators?: Indicator[];
  history?: { date: string; total_score: number | null; key: string | null }[];
  error?: string;
}

function scoreColor(s: number | null): string {
  if (s === null) return 'text-text-t';
  if (s >= 5) return 'text-[#B71C1C]';
  if (s >= 4) return 'text-tw-up';
  if (s >= 3) return 'text-tw-at';
  if (s >= 2) return 'text-[#58A6FF]';
  return 'text-[#1976D2]';
}

function scoreBar(s: number | null): string {
  // Returns width percentage for score 1-5 bar
  if (s === null) return '0';
  return `${(s / 5) * 100}%`;
}

export function BusinessCycle() {
  const [data, setData] = useState<CycleSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    const url = `/api/business-cycle${force ? '?force=true' : ''}`;
    fetch(url).then(r => r.json()).then(setData).catch(() => {}).finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(), 30 * 60 * 1000);  // 30 min auto-refresh
    return () => clearInterval(id);
  }, []);

  const doRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    load(true);
  };

  if (loading && !data) {
    return <div className="px-4 py-2 text-xs text-text-t animate-pulse">載入景氣燈號...</div>;
  }
  if (!data || data.error) {
    return null;
  }

  const used = data.indicators_used ?? 0;
  const total = data.indicators_total ?? 0;

  return (
    <div className="mx-4 my-2 bg-card-bg border border-border-c rounded-xl overflow-hidden">
      {/* Main row — clickable to expand */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-card-hover transition-colors"
      >
        {/* Big colored dot */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-lg"
          style={{ backgroundColor: data.color, boxShadow: `0 0 20px ${data.color}55` }}
        >
          {data.total_score?.toFixed(0)}
        </div>

        {/* Label + state */}
        <div className="text-left flex-shrink-0">
          <div className="text-[10px] text-text-t font-mono uppercase tracking-wider mb-0.5">
            景氣燈號
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold" style={{ color: data.color }}>
              {data.label}
            </span>
            <span className="text-sm text-text-p">{data.state}</span>
          </div>
          <div className="text-xs text-text-s mt-0.5">{data.action}</div>
        </div>

        {/* Indicator chips — compact summary */}
        <div className="flex items-center gap-1.5 flex-wrap ml-auto">
          {data.indicators?.filter(i => i.score !== null).map(i => (
            <div
              key={i.key}
              title={`${i.name}: ${i.value}${i.unit} (${i.score}/5)\n${i.note}`}
              className="px-2 py-0.5 rounded bg-dash-bg border border-border-c text-[10px]"
            >
              <span className="text-text-s">{i.name.slice(0, 6)}</span>
              <span className={`ml-1 font-bold font-mono ${scoreColor(i.score)}`}>{i.score}</span>
            </div>
          ))}
        </div>

        <span className="text-text-t text-sm ml-2">{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border-c px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-text-s">
              加權總分 <span className="font-mono font-bold text-text-p">{data.total_score?.toFixed(1)}</span>
              <span className="text-text-t"> / 50</span>
              <span className="text-text-t ml-2">({used}/{total} 指標可用)</span>
            </div>
            <button
              onClick={doRefresh}
              disabled={refreshing}
              className="text-xs text-accent hover:underline disabled:opacity-50"
            >
              {refreshing ? '重算中...' : '↻ 強制重算'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.indicators?.map(i => (
              <div
                key={i.key}
                className={`border rounded-lg p-2.5 ${
                  i.score === null ? 'border-border-c/40 opacity-50' : 'border-border-c'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-p">{i.name}</span>
                    <span className="text-[10px] text-text-t">
                      權重 {(i.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                  {i.score !== null ? (
                    <span className={`text-lg font-bold font-mono ${scoreColor(i.score)}`}>
                      {i.score}
                    </span>
                  ) : (
                    <span className="text-[10px] text-text-t">—</span>
                  )}
                </div>

                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-mono text-text-p">
                    {i.value !== null ? `${i.value > 0 ? '+' : ''}${i.value}${i.unit}` : '—'}
                  </span>
                  <span className="text-text-t">{i.source}</span>
                </div>

                {/* 1-5 bar */}
                {i.score !== null && (
                  <div className="mt-1.5 h-1 bg-border-c/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: scoreBar(i.score),
                        backgroundColor: lightColorByScore(i.score),
                      }}
                    />
                  </div>
                )}

                {i.note && (
                  <div className="mt-1 text-[10px] text-text-t truncate" title={i.note}>
                    {i.note}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sparkline history */}
          {data.history && data.history.length > 1 && (
            <div className="mt-3 pt-3 border-t border-border-c/50">
              <div className="text-[10px] text-text-t mb-1.5">近 60 日分數走勢</div>
              <div className="flex items-end gap-0.5 h-10">
                {data.history.map((h, idx) => {
                  const pct = h.total_score !== null ? (h.total_score / 50) * 100 : 0;
                  return (
                    <div
                      key={idx}
                      title={`${h.date}: ${h.total_score}`}
                      className="flex-1 rounded-sm min-w-0"
                      style={{
                        height: `${Math.max(pct, 4)}%`,
                        backgroundColor: lightColorByKey(h.key),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function lightColorByScore(s: number): string {
  if (s >= 5) return '#B71C1C';
  if (s >= 4) return '#FF3B3B';
  if (s >= 3) return '#00C851';
  if (s >= 2) return '#58A6FF';
  return '#1976D2';
}

function lightColorByKey(key: string | null): string {
  switch (key) {
    case 'extreme_hot': return '#B71C1C';
    case 'hot':         return '#FF3B3B';
    case 'warm':        return '#FF9800';
    case 'neutral':     return '#00C851';
    case 'cool':        return '#58A6FF';
    case 'cold':        return '#1976D2';
    default:            return '#484F58';
  }
}
