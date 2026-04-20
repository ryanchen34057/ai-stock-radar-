import { useEffect, useState } from 'react';
import { LAYER_NAMES, LAYER_THEME, layerShortCode } from '../types/stock';

interface ManagedStock {
  symbol: string;
  name: string;
  layer: number;
  layer_name: string;
  sub_category: string | null;
  note: string | null;
  theme: string;
  themes?: string[] | null;
  tier: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  onClose: () => void;
}

const TIER_LABEL = { 1: '⭐ 核心', 2: '⭐⭐ 衛星', 3: '⭐⭐⭐ 觀察' } as const;

export function StockManager({ onClose }: Props) {
  const [stocks, setStocks] = useState<ManagedStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [themeFilter, setThemeFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [tierFilter, setTierFilter] = useState<'all' | 1 | 2 | 3>('all');
  const [showDisabled, setShowDisabled] = useState(true);
  const [editing, setEditing] = useState<ManagedStock | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/stocks');
      setStocks(await r.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  // ESC closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const toggleEnabled = async (sym: string, next: boolean) => {
    await fetch(`/api/stocks/${sym}/enabled?enabled=${next}`, { method: 'PATCH' });
    load();
  };

  const deleteStock = async (sym: string) => {
    if (!confirm(`確定要刪除 ${sym} 嗎？會連同 K 線、新聞、EPS 快取一併移除。`)) return;
    await fetch(`/api/stocks/${sym}`, { method: 'DELETE' });
    load();
  };

  const filtered = stocks.filter((s) => {
    if (themeFilter !== 'all' && s.theme !== themeFilter) return false;
    if (tierFilter !== 'all' && s.tier !== tierFilter) return false;
    if (!showDisabled && !s.enabled) return false;
    if (search) {
      const q = search.trim().toLowerCase();
      if (!s.symbol.includes(q) && !s.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const counts = {
    all: stocks.length,
    enabled: stocks.filter((s) => s.enabled).length,
    t1: stocks.filter((s) => s.tier === 1).length,
    t2: stocks.filter((s) => s.tier === 2).length,
    t3: stocks.filter((s) => s.tier === 3).length,
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-dash-bg border border-border-c rounded-xl w-full max-w-5xl h-[86vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-c">
          <div>
            <h2 className="text-lg font-bold text-text-p">股票管理</h2>
            <p className="text-xs text-text-t mt-0.5">
              全部 {counts.all} 檔 · 啟用 {counts.enabled} · T1:{counts.t1} / T2:{counts.t2} / T3:{counts.t3}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-s hover:text-text-p text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-card-bg"
          >✕</button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border-c bg-card-bg/40">
          <input
            type="text" placeholder="搜尋代號 / 名稱..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[180px] bg-dash-bg border border-border-c rounded px-3 py-1.5 text-sm text-text-p
                       placeholder:text-text-t focus:outline-none focus:border-accent"
          />
          <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value as typeof themeFilter)}
            className="text-xs bg-dash-bg text-text-p border border-border-c rounded px-2 py-1.5 focus:outline-none focus:border-accent">
            <option value="all">全部主題</option>
            <option value="A">A · AI</option>
            <option value="B">B · 電動車</option>
            <option value="C">C · 機器人</option>
          </select>
          <select value={String(tierFilter)} onChange={(e) => setTierFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as 1 | 2 | 3))}
            className="text-xs bg-dash-bg text-text-p border border-border-c rounded px-2 py-1.5 focus:outline-none focus:border-accent">
            <option value="all">全部分級</option>
            <option value="1">Tier 1 核心</option>
            <option value="2">Tier 2 衛星</option>
            <option value="3">Tier 3 觀察</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-text-s cursor-pointer select-none">
            <input type="checkbox" checked={showDisabled}
              onChange={(e) => setShowDisabled(e.target.checked)}
              className="accent-accent w-3.5 h-3.5" />
            顯示已停用
          </label>
          <button onClick={() => setCreating(true)}
            className="ml-auto px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-blue-400 transition-colors">
            + 新增股票
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-text-t text-sm animate-pulse">載入中...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-text-t text-sm">沒有符合條件的股票</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-card-bg sticky top-0">
                <tr className="text-left text-text-s">
                  <th className="px-3 py-2 font-semibold">代號</th>
                  <th className="px-3 py-2 font-semibold">名稱</th>
                  <th className="px-3 py-2 font-semibold">主題 / 層</th>
                  <th className="px-3 py-2 font-semibold">子類別</th>
                  <th className="px-3 py-2 font-semibold">Tier</th>
                  <th className="px-3 py-2 font-semibold">啟用</th>
                  <th className="px-3 py-2 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.symbol} className={`border-t border-border-c/50 hover:bg-card-hover
                                                 ${!s.enabled ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 font-mono font-bold text-accent">{s.symbol}</td>
                    <td className="px-3 py-2 text-text-p">{s.name}</td>
                    <td className="px-3 py-2 text-text-s">
                      <span className="font-mono">{layerShortCode(s.layer)}</span>
                      <span className="ml-1.5">{s.layer_name}</span>
                    </td>
                    <td className="px-3 py-2 text-text-t">{s.sub_category || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono">{TIER_LABEL[s.tier as 1|2|3] ?? s.tier}</span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => toggleEnabled(s.symbol, !s.enabled)}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors
                          ${s.enabled
                            ? 'bg-green-500/20 text-green-400 border-green-500/40 hover:bg-green-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30'}`}
                      >
                        {s.enabled ? '啟用中' : '已停用'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditing(s)}
                        className="px-2 py-0.5 text-xs text-accent hover:underline">編輯</button>
                      <span className="text-text-t mx-1">·</span>
                      <button onClick={() => deleteStock(s.symbol)}
                        className="px-2 py-0.5 text-xs text-red-400 hover:underline">刪除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border-c text-[11px] text-text-t">
          Tip: 新增後會自動背景抓取 5 年 K 線；停用的股票不會出現在主儀表板但資料保留。
        </div>
      </div>

      {(editing || creating) && (
        <StockEditor
          stock={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Editor modal ──────────────────────────────────────────────────────────────

interface EditorProps {
  stock: ManagedStock | null; // null = creating
  onClose: () => void;
  onSaved: () => void;
}

function StockEditor({ stock, onClose, onSaved }: EditorProps) {
  const isNew = stock === null;
  const [form, setForm] = useState<ManagedStock>({
    symbol: stock?.symbol ?? '',
    name: stock?.name ?? '',
    layer: stock?.layer ?? 1,
    layer_name: stock?.layer_name ?? '',
    sub_category: stock?.sub_category ?? '',
    note: stock?.note ?? '',
    theme: stock?.theme ?? 'A',
    tier: stock?.tier ?? 2,
    enabled: stock?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When layer changes, auto-fill layer_name + theme from the canonical map
  const onLayerChange = (layerId: number) => {
    setForm((f) => ({
      ...f,
      layer: layerId,
      layer_name: LAYER_NAMES[layerId] ?? f.layer_name,
      theme: LAYER_THEME[layerId] ?? f.theme,
    }));
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const body = {
        symbol: form.symbol.trim(),
        name: form.name.trim(),
        layer: form.layer,
        layer_name: form.layer_name || null,
        sub_category: form.sub_category || null,
        note: form.note || null,
        theme: form.theme,
        tier: form.tier,
        enabled: form.enabled,
      };
      const url = isNew ? '/api/stocks' : `/api/stocks/${form.symbol}`;
      const method = isNew ? 'POST' : 'PUT';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-dash-bg border border-border-c rounded-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-text-p">
            {isNew ? '新增股票' : `編輯 ${stock?.symbol} ${stock?.name}`}
          </h3>
          <button onClick={onClose} className="text-text-s hover:text-text-p text-lg">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label="代號">
            <input type="text" value={form.symbol} disabled={!isNew}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
              placeholder="2330"
              className="w-full bg-card-bg border border-border-c rounded px-2 py-1.5 text-text-p font-mono
                         focus:outline-none focus:border-accent disabled:opacity-50" />
          </Field>
          <Field label="名稱">
            <input type="text" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full bg-card-bg border border-border-c rounded px-2 py-1.5 text-text-p
                         focus:outline-none focus:border-accent" />
          </Field>
          <Field label="產業層">
            <select value={form.layer} onChange={(e) => onLayerChange(Number(e.target.value))}
              className="w-full bg-card-bg border border-border-c rounded px-2 py-1.5 text-text-p
                         focus:outline-none focus:border-accent">
              {Object.entries(LAYER_NAMES)
                .map(([id, name]) => [Number(id), name] as [number, string])
                .sort((a, b) => {
                  const ta = LAYER_THEME[a[0]], tb = LAYER_THEME[b[0]];
                  if (ta !== tb) return ta.localeCompare(tb);
                  return layerShortCode(a[0]).localeCompare(layerShortCode(b[0]), 'en', { numeric: true });
                })
                .map(([id, name]) => (
                  <option key={id} value={id}>{layerShortCode(id)} · {name}</option>
                ))}
            </select>
          </Field>
          <Field label="分級 Tier">
            <select value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: Number(e.target.value) }))}
              className="w-full bg-card-bg border border-border-c rounded px-2 py-1.5 text-text-p
                         focus:outline-none focus:border-accent">
              <option value={1}>⭐ Tier 1 核心</option>
              <option value={2}>⭐⭐ Tier 2 衛星</option>
              <option value={3}>⭐⭐⭐ Tier 3 觀察</option>
            </select>
          </Field>
          <Field label="子類別" full>
            <input type="text" value={form.sub_category ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, sub_category: e.target.value }))}
              placeholder="例：晶圓代工"
              className="w-full bg-card-bg border border-border-c rounded px-2 py-1.5 text-text-p
                         focus:outline-none focus:border-accent" />
          </Field>
          <Field label="備註" full>
            <input type="text" value={form.note ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="例：AWS Trainium 3 主要夥伴"
              className="w-full bg-card-bg border border-border-c rounded px-2 py-1.5 text-text-p
                         focus:outline-none focus:border-accent" />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-xs text-text-s">
            <input type="checkbox" checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="accent-accent w-3.5 h-3.5" />
            啟用（加入監控儀表板）
          </label>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border-c text-text-s hover:text-text-p">
            取消
          </button>
          <button onClick={save} disabled={saving || !form.symbol || !form.name}
            className="px-4 py-1.5 text-xs rounded bg-accent text-white hover:bg-blue-400
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? '儲存中...' : (isNew ? '新增並抓取 K 線' : '儲存')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      <span className="text-text-t">{label}</span>
      {children}
    </label>
  );
}
