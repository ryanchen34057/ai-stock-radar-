import { useEffect, useState } from 'react';

interface Phase {
  key: string;
  label: string;
}

interface Progress {
  running: boolean;
  phase: string | null;
  phase_label: string;
  phase_index: number;
  phase_total: number;
  current: number;
  total: number;
  symbol: string;
  name: string;
  phases_done: string[];
  phases: Phase[];
  error: string | null;
}

/**
 * Full-screen "first-run installer" overlay. Polls /api/setup/progress and
 * auto-dismisses when the startup sweep completes (all phases done + not
 * running). Shows per-stock progress like a desktop installer.
 */
export function SetupOverlay() {
  const [prog, setProg] = useState<Progress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/setup/progress');
        if (!r.ok) return;
        const j: Progress = await r.json();
        if (!cancelled) setProg(j);
      } catch { /* ignore */ }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Hide when: never started (running=false + no phases_done → fresh start may not have begun),
  // OR all phases completed, OR user dismissed.
  if (dismissed) return null;
  if (!prog) return null;

  const anyWork = prog.running || (prog.phases_done && prog.phases_done.length > 0);
  if (!anyWork) return null;                   // nothing happening — don't overlay
  if (!prog.running && prog.phases_done.length >= 2) return null;  // finished, auto-hide

  const pct = prog.total > 0 ? Math.round((prog.current / prog.total) * 100) : 0;
  const overallPct = prog.phase_total > 0
    ? Math.min(100, Math.round(((prog.phase_index - 1) / prog.phase_total + (pct / 100) / prog.phase_total) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="max-w-lg w-[92%] bg-card-bg border border-border-c rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="text-3xl">🛰️</div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-text-p">
              股票儀表板 · 首次啟動
            </h2>
            <p className="text-xs text-text-s mt-0.5">
              正在抓取所有股票的歷史資料 — 只會在第一次跑，之後打開就直接可用
            </p>
          </div>
        </div>

        {/* Overall progress */}
        <div className="mb-4">
          <div className="flex items-baseline justify-between text-xs text-text-s mb-1">
            <span>
              總進度（{prog.phase_index}/{prog.phase_total} 階段）
            </span>
            <span className="font-mono text-accent font-bold">{overallPct}%</span>
          </div>
          <div className="h-2 bg-dash-bg rounded-full overflow-hidden border border-border-c">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </div>

        {/* Current phase */}
        <div className="bg-dash-bg border border-border-c rounded-lg p-3 mb-4">
          <div className="flex items-baseline justify-between text-sm font-semibold mb-1.5">
            <span className="text-accent">▸ {prog.phase_label || '準備中...'}</span>
            {prog.total > 0 && (
              <span className="font-mono text-text-p">
                {prog.current}<span className="text-text-t"> / {prog.total}</span>
              </span>
            )}
          </div>
          {prog.total > 0 && (
            <div className="h-1.5 bg-border-c rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-accent/80 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {prog.symbol && (
            <div className="text-xs font-mono text-text-s">
              <span className="text-text-t">抓取中：</span>
              <span className="text-accent font-bold">{prog.symbol}</span>
              <span className="text-text-p ml-2">{prog.name}</span>
            </div>
          )}
          {!prog.symbol && prog.phase && (
            <div className="text-xs text-text-t">進行中，請稍候...</div>
          )}
        </div>

        {/* Phase checklist */}
        <div className="space-y-1 mb-4">
          {prog.phases.map((p) => {
            const done = prog.phases_done.includes(p.key);
            const active = prog.phase === p.key;
            return (
              <div key={p.key} className="flex items-center gap-2 text-xs">
                <span className={`w-4 text-center font-bold ${
                  done ? 'text-tw-up' : active ? 'text-accent animate-pulse' : 'text-text-t'
                }`}>
                  {done ? '✓' : active ? '●' : '○'}
                </span>
                <span className={
                  done ? 'text-text-s line-through'
                  : active ? 'text-text-p font-semibold'
                  : 'text-text-t'
                }>
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>

        {prog.error && (
          <div className="text-xs bg-red-500/10 text-red-400 border border-red-500/30 rounded p-2 mb-3">
            ⚠ {prog.error}
          </div>
        )}

        <div className="flex justify-between items-center text-[11px] text-text-t">
          <span>整個過程通常 5-15 分鐘 · 取決於網路速度</span>
          <button
            onClick={() => setDismissed(true)}
            className="text-text-s hover:text-accent underline"
            title="關閉後仍會在背景繼續抓取"
          >
            背景執行
          </button>
        </div>
      </div>
    </div>
  );
}
