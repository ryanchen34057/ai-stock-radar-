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
  scoring?: 'absolute' | 'percentile';
}

interface CycleSnapshot {
  as_of?: string;
  total_score?: number;
  weighted_avg?: number;
  indicators_used?: number;
  indicators_total?: number;
  has_percentile_calibration?: boolean;
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
      {/* Main row — clickable to expand. Centered vertical stack:
          traffic-light LED face → big score+label → action */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex flex-col items-center gap-3 px-4 py-5 hover:bg-card-hover transition-colors"
      >
        {/* Section header */}
        <div className="text-xs text-text-t font-mono uppercase tracking-[0.3em]">
          景氣燈號
        </div>

        {/* Fear & Greed-style gauge */}
        <CycleGauge score={data.total_score ?? 0} color={data.color ?? '#484F58'} label={data.label ?? '—'} />

        {/* Action line */}
        {data.action && (
          <div className="text-sm text-white font-medium mt-1">{data.action}</div>
        )}

        {/* Indicator chips — compact summary, centered */}
        <div className="flex items-center gap-1.5 flex-wrap justify-center mt-1 max-w-3xl">
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

        <span className="text-text-s text-xs mt-1">
          {expanded ? '▲ 收合' : '▼ 展開指標明細'}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border-c px-4 py-3">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-xs text-text-s flex items-center gap-2">
              <span>加權總分 <span className="font-mono font-bold text-text-p">{data.total_score?.toFixed(1)}</span>
                <span className="text-text-t"> / 50</span></span>
              <span className="text-text-t">({used}/{total} 指標可用)</span>
              {data.has_percentile_calibration && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent border border-accent/30">
                  ✓ 10 年分位數校準
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <PmiSetter onUpdated={() => load(true)} />
              <button
                onClick={doRefresh}
                disabled={refreshing}
                className="text-xs text-accent hover:underline disabled:opacity-50"
              >
                {refreshing ? '重算中...' : '↻ 強制重算'}
              </button>
            </div>
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-p">{i.name}</span>
                    <span className="text-[10px] text-text-t">
                      權重 {(i.weight * 100).toFixed(0)}%
                    </span>
                    {i.scoring === 'percentile' && (
                      <span className="text-[10px] px-1 rounded bg-accent/15 text-accent"
                            title="依 10 年歷史 P20/P40/P60/P80 評分">
                        分位數
                      </span>
                    )}
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

function PmiSetter({ onUpdated }: { onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [month, setMonth] = useState('');
  const [current, setCurrent] = useState<{ value: number | null; month: string | null } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/business-cycle/pmi').then(r => r.json()).then((d) => {
      setCurrent(d);
      if (d?.value != null) setValue(String(d.value));
      if (d?.month) setMonth(d.month);
      else {
        const now = new Date();
        setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      }
    });
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v < 0 || v > 100) return;
    setSaving(true);
    try {
      await fetch('/api/business-cycle/pmi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: v, month }),
      });
      setOpen(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-text-s hover:text-accent"
        title={current?.value != null ? `目前 PMI: ${current.value} (${current.month})` : '設定 PMI'}
      >
        ⚙ PMI
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="absolute right-0 top-6 z-30 bg-card-bg border border-border-c rounded-lg p-3 shadow-lg w-64 space-y-2"
        >
          <div className="text-xs text-text-s">
            中經院每月 1 日發布<br />
            目前: {current?.value ?? '—'} {current?.month ? `(${current.month})` : ''}
          </div>
          <input
            type="number" step="0.1" min="0" max="100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="55.2"
            className="w-full bg-dash-bg border border-border-c rounded px-2 py-1 text-xs font-mono text-text-p focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="2026-04"
            className="w-full bg-dash-bg border border-border-c rounded px-2 py-1 text-xs font-mono text-text-p focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)}
                    className="text-[11px] text-text-s hover:text-accent px-2 py-1">取消</button>
            <button type="submit" disabled={saving}
                    className="text-[11px] bg-accent text-white rounded px-3 py-1 disabled:opacity-50">
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Fear & Greed-style horizontal gauge. 5 zones across the Taiwan 景氣燈號 scale:
 * 藍燈(0-10) · 黃藍(10-20) · 綠燈(20-30) · 黃紅(30-40) · 紅燈(40-50).
 * Pointer sits at score/50 of the bar width.
 */
function CycleGauge({ score, color, label }: { score: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (score / 50) * 100));
  const zones = [
    { name: '藍燈', c: '#1976D2' },
    { name: '黃藍', c: '#58A6FF' },
    { name: '綠燈', c: '#00C851' },
    { name: '黃紅', c: '#FF9800' },
    { name: '紅燈', c: '#FF3B3B' },
  ];
  return (
    <div className="w-full max-w-lg flex flex-col items-center gap-2 mt-1">
      {/* Zone labels */}
      <div className="w-full grid grid-cols-5 text-[10px] text-text-t font-medium">
        {zones.map(z => (
          <div key={z.name} className="text-center" style={{ color: z.c }}>{z.name}</div>
        ))}
      </div>

      {/* Gradient bar + pointer */}
      <div className="relative w-full h-3 rounded-full overflow-visible"
           style={{
             background: 'linear-gradient(to right, #1976D2 0%, #58A6FF 25%, #00C851 50%, #FF9800 75%, #FF3B3B 100%)',
             boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
           }}>
        {/* Tick marks at zone boundaries */}
        {[20, 40, 60, 80].map(p => (
          <div key={p} className="absolute top-0 bottom-0 w-px bg-black/30" style={{ left: `${p}%` }} />
        ))}
        {/* Pointer */}
        <div
          className="absolute -top-1 -translate-x-1/2"
          style={{ left: `${pct}%` }}
        >
          <svg width="18" height="14" viewBox="0 0 18 14" style={{ filter: `drop-shadow(0 2px 4px ${color}aa)` }}>
            <polygon points="9,14 0,0 18,0" fill="#ffffff" stroke={color} strokeWidth="2" />
          </svg>
        </div>
      </div>

      {/* Big number + label below the pointer */}
      <div
        className="relative w-full"
      >
        <div
          className="absolute -translate-x-1/2 flex flex-col items-center"
          style={{ left: `${pct}%`, top: 0 }}
        >
          <div className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span
              className="text-3xl font-extrabold font-mono tracking-tight"
              style={{ color, textShadow: `0 2px 8px ${color}66` }}
            >
              {Math.round(score)}
            </span>
            <span className="text-sm text-text-t">·</span>
            <span
              className="text-xl font-bold"
              style={{ color }}
            >
              {label}
            </span>
          </div>
        </div>
        {/* Spacer so parent gets height */}
        <div className="h-10" />
      </div>
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
