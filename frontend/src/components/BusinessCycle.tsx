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

        {/* LED traffic-light face */}
        <LedLight color={data.color ?? '#484F58'} score={data.total_score ?? 0} />

        {/* Big label + state */}
        <div className="flex flex-col items-center gap-1 mt-1">
          <div className="flex items-baseline gap-3">
            <span
              className="text-4xl font-extrabold tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
              style={{ color: data.color }}
            >
              {data.label}
            </span>
            <span className="text-xl font-bold text-text-p">{data.state}</span>
          </div>
          <div className="text-base text-white font-medium">{data.action}</div>
        </div>

        {/* Indicator chips — compact summary, centered */}
        <div className="flex items-center gap-1.5 flex-wrap justify-center mt-2 max-w-3xl">
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
 * Traffic-light style LED face — dark bezel + many small LED dots in concentric
 * rings (like a real semaphore/signal head). Surrounded by a pulsing halo.
 */
function LedLight({ color, score }: { color: string; score: number }) {
  const dots: { x: number; y: number }[] = [];
  // Center LED
  dots.push({ x: 0, y: 0 });
  // Concentric rings — dot count scales with circumference
  const rings = [
    { r: 13, count: 8 },
    { r: 24, count: 14 },
    { r: 35, count: 20 },
    { r: 46, count: 26 },
    { r: 57, count: 32 },
  ];
  for (const { r, count } of rings) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      dots.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: 200, height: 200, color }}>
      {/* Outward radiating rings ("ping") — expanding then fading, infinite */}
      <div
        className="absolute rounded-full bulb-ping pointer-events-none"
        style={{
          inset: '10px',
          border: `3px solid ${color}`,
          boxShadow: `0 0 20px ${color}88`,
        }}
      />
      <div
        className="absolute rounded-full bulb-ping pointer-events-none"
        style={{
          inset: '10px',
          border: `2px solid ${color}`,
          animationDelay: '1.3s',
        }}
      />

      {/* Outer pulsing halo */}
      <div
        className="absolute inset-0 rounded-full bulb-halo pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${color}CC 0%, ${color}55 40%, transparent 72%)`,
          filter: 'blur(16px)',
        }}
      />
      {/* Wider softer halo */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '-20px',
          background: `radial-gradient(circle, ${color}55 0%, ${color}22 40%, transparent 70%)`,
          filter: 'blur(28px)',
        }}
      />

      <svg viewBox="-80 -80 160 160" width="160" height="160" className="relative bulb-body">
        <defs>
          <radialGradient id="led-dot" cx="35%" cy="30%" r="65%">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="35%"  stopColor={color}    stopOpacity="1" />
            <stop offset="100%" stopColor={color}    stopOpacity="0.85" />
          </radialGradient>
          <radialGradient id="lens-bg" cx="50%" cy="50%" r="55%">
            <stop offset="0%"   stopColor={color}  stopOpacity="0.28" />
            <stop offset="100%" stopColor="#000"   stopOpacity="0.85" />
          </radialGradient>
          <filter id="led-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
        </defs>

        {/* Outer bezel (dark plastic frame) */}
        <circle cx="0" cy="0" r="78" fill="#0a0a0a" />
        <circle cx="0" cy="0" r="75" fill="#2a2a2a" />
        <circle cx="0" cy="0" r="72" fill="#111" />

        {/* Lens background (tinted + dark center to enhance LED contrast) */}
        <circle cx="0" cy="0" r="70" fill="url(#lens-bg)" />

        {/* LED dots */}
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r="3.8"
            fill="url(#led-dot)"
            filter="url(#led-blur)"
          />
        ))}

        {/* Subtle top glass reflection */}
        <ellipse cx="-18" cy="-32" rx="30" ry="12"
                 fill="white" opacity="0.08" filter="url(#led-blur)" />

        {/* Large score number */}
        <text
          x="0" y="4"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffff"
          fontSize="42"
          fontWeight="900"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.85))' }}
        >
          {Math.round(score)}
        </text>
      </svg>
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
