import { useState, useMemo } from 'react';
import { CHAIN_LAYERS, type ChainLayer } from '../config/chainLayers';
import { useDashboardStore } from '../store/dashboardStore';
import { useInstitutional, aggregateInstitutional, type InstitutionalStock } from '../hooks/useInstitutional';
import { StockCard } from './StockCard';
import { StockDetailModal } from './StockDetailModal';
import type { StockData } from '../types/stock';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtNet(n: number): string {
  if (n === 0) return '--';
  const abs = Math.abs(n);
  const str = abs >= 10000
    ? `${(abs / 1000).toFixed(0)}K`
    : abs.toLocaleString('zh-TW');
  return (n > 0 ? '+' : '-') + str;
}

function NetBadge({ value, label }: { value: number; label: string }) {
  if (value === 0) return null;
  const positive = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-mono px-1.5 py-0.5 rounded
      ${positive ? 'bg-tw-up/10 text-tw-up' : 'bg-tw-down/10 text-tw-down'}`}>
      <span className="text-text-t">{label}</span>
      {positive ? '▲' : '▼'} {fmtNet(value)}
    </span>
  );
}

// ── Left panel: one layer card ────────────────────────────────────────────────

function LayerCard({
  layer,
  selected,
  agg,
  loading,
  onClick,
  isLast,
}: {
  layer: ChainLayer;
  selected: boolean;
  agg: InstitutionalStock | null;
  loading: boolean;
  onClick: () => void;
  isLast: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        onClick={onClick}
        className={`w-full text-left rounded-xl border-2 p-3 transition-all duration-150
          ${selected
            ? 'border-current shadow-lg scale-[1.02]'
            : 'border-transparent hover:border-current/40'
          }`}
        style={{
          borderColor: selected ? layer.color : undefined,
          backgroundColor: selected ? layer.bgColor : 'rgba(22,27,34,0.6)',
          color: layer.color,
        }}
      >
        {/* Icon + name */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-base flex-shrink-0"
            style={{ backgroundColor: layer.color }}
          >
            {layer.icon}
          </span>
          <span className="font-semibold text-sm text-text-p leading-tight">{layer.name}</span>
        </div>

        {/* Tech description */}
        <p className="text-xs text-text-t leading-relaxed pl-8 mb-2">{layer.technologies}</p>

        {/* Institutional badges */}
        {loading ? (
          <div className="pl-8 text-xs text-text-t animate-pulse">載入法人資料…</div>
        ) : agg ? (
          <div className="pl-8 flex flex-wrap gap-1">
            <NetBadge value={agg.foreign_net} label="外資" />
            <NetBadge value={agg.trust_net}   label="投信" />
            <NetBadge value={agg.margin_change} label="融資" />
            <NetBadge value={agg.short_change}  label="融券" />
          </div>
        ) : null}
      </button>

      {/* Connector arrow (except after last) */}
      {!isLast && (
        <div className="flex flex-col items-center my-0.5 text-text-t">
          <div className="w-px h-3 bg-border-c" />
          <span className="text-xs">↓</span>
          <div className="w-px h-3 bg-border-c" />
        </div>
      )}
    </div>
  );
}

// ── Aggregate stats bar ───────────────────────────────────────────────────────

function LayerStats({ agg, date }: { agg: InstitutionalStock; date: string }) {
  const stats = [
    { label: '外資買賣超', value: agg.foreign_net, unit: '千股' },
    { label: '投信買賣超', value: agg.trust_net,   unit: '千股' },
    { label: '自營買賣超', value: agg.dealer_net,  unit: '千股' },
    { label: '融資增減',   value: agg.margin_change, unit: '千股' },
    { label: '融券增減',   value: agg.short_change,  unit: '千股' },
  ];

  return (
    <div className="flex flex-wrap gap-3 mb-4 p-3 bg-card-bg rounded-lg border border-border-c">
      {stats.map((s) => (
        <div key={s.label} className="min-w-[90px]">
          <div className="text-xs text-text-s mb-0.5">{s.label}</div>
          <div className={`text-sm font-mono font-bold tabular-nums
            ${s.value > 0 ? 'text-tw-up' : s.value < 0 ? 'text-tw-down' : 'text-text-t'}`}>
            {s.value === 0 ? '--' : `${s.value > 0 ? '+' : ''}${s.value.toLocaleString('zh-TW')} ${s.unit}`}
          </div>
        </div>
      ))}
      <div className="ml-auto self-center text-xs text-text-t">資料日期：{
        date ? `${date.slice(0,4)}/${date.slice(4,6)}/${date.slice(6,8)}` : '--'
      }</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SupplyChainMap() {
  const [selectedTheme, setSelectedTheme] = useState<'A'|'B'|'C'>('A');
  const [selectedLayerId, setSelectedLayerId] = useState<number>(1);
  const [modalStock, setModalStock] = useState<StockData | null>(null);
  const { stocks, selectedMA } = useDashboardStore();
  const { data: insti, loading: instiLoading } = useInstitutional();

  const themeLayers = CHAIN_LAYERS.filter(l => l.theme === selectedTheme);
  const selectedLayer = CHAIN_LAYERS.find((l) => l.id === selectedLayerId)!;

  // Map symbols → StockData
  const stockMap = useMemo(() => {
    const m: Record<string, StockData> = {};
    for (const s of stocks) m[s.symbol] = s;
    return m;
  }, [stocks]);

  // Filter stocks for selected layer
  const layerStocks = useMemo(
    () => selectedLayer.symbols.map((sym) => stockMap[sym]).filter(Boolean) as StockData[],
    [selectedLayer, stockMap],
  );

  // Aggregate institutional data per layer
  const layerAgg = useMemo(
    () =>
      insti
        ? aggregateInstitutional(selectedLayer.symbols, insti.stocks)
        : null,
    [selectedLayer, insti],
  );

  return (
    <div className="flex h-full bg-dash-bg overflow-hidden">
      {/* ── Left panel: hierarchy ── */}
      <div className="w-72 flex-shrink-0 border-r border-border-c overflow-y-auto p-3">
        <h2 className="text-xs font-semibold text-text-s uppercase tracking-widest mb-3 px-1">
          {selectedTheme==='A'?'AI 伺服器供應鏈':selectedTheme==='B'?'電動車供應鏈':'機器人供應鏈'}
        </h2>
        <div className="flex gap-1 mb-3">
          {(['A','B','C'] as const).map((t) => (
            <button key={t}
              onClick={() => { setSelectedTheme(t); setSelectedLayerId(CHAIN_LAYERS.find(l=>l.theme===t)!.id); }}
              className={`flex-1 text-xs py-1 rounded font-semibold transition-colors
                ${selectedTheme===t ? 'bg-accent text-black' : 'bg-card-bg border border-border-c text-text-s hover:text-text-p'}`}
            >
              {t==='A'?'🤖 AI':t==='B'?'🚗 EV':'🦾 機器人'}
            </button>
          ))}
        </div>
        {themeLayers.map((layer, idx) => (
          <LayerCard
            key={layer.id}
            layer={layer}
            selected={selectedLayerId === layer.id}
            agg={
              insti
                ? aggregateInstitutional(layer.symbols, insti.stocks)
                : null
            }
            loading={instiLoading}
            onClick={() => setSelectedLayerId(layer.id)}
            isLast={idx === themeLayers.length - 1}
          />
        ))}
      </div>

      {/* ── Right panel: stocks ── */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Layer header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
              style={{ backgroundColor: selectedLayer.color }}
            >
              {selectedLayer.icon}
            </span>
            <h2 className="text-lg font-bold text-text-p">{selectedLayer.name}</h2>
            <span className="text-sm text-text-t">
              {layerStocks.length} 檔
            </span>
          </div>
          <p className="text-sm text-text-s pl-9">{selectedLayer.technologies}</p>
        </div>

        {/* Institutional aggregate */}
        {instiLoading && (
          <div className="mb-4 p-3 bg-card-bg rounded-lg border border-border-c text-text-t text-sm animate-pulse">
            正在抓取外資/投信/融資/融券資料…
          </div>
        )}
        {layerAgg && insti && (
          <LayerStats agg={layerAgg} date={insti.date} />
        )}

        {/* Stock grid */}
        {stocks.length === 0 ? (
          <div className="text-text-t text-center py-12">
            請先啟動後端並載入資料
          </div>
        ) : layerStocks.length === 0 ? (
          <div className="text-text-t text-center py-12">
            此層股票尚無 K 線資料，請執行初始化
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {layerStocks.map((stock) => (
              <div key={stock.symbol}>
                {/* Institutional mini-bar above each card */}
                {insti?.stocks[stock.symbol] && (
                  <div className="flex gap-1 mb-1 px-0.5">
                    <NetBadge value={insti.stocks[stock.symbol].foreign_net} label="外" />
                    <NetBadge value={insti.stocks[stock.symbol].trust_net}   label="投" />
                    <NetBadge value={insti.stocks[stock.symbol].margin_change} label="融" />
                  </div>
                )}
                <StockCard
                  stock={stock}
                  selectedMA={selectedMA}
                  insti={null}
                  onClick={() => setModalStock(stock)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {modalStock && (
        <StockDetailModal
          stock={modalStock}
          selectedMA={selectedMA}
          onClose={() => setModalStock(null)}
        />
      )}
    </div>
  );
}
