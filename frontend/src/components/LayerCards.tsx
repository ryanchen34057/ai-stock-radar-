import { useMemo } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { useInstitutional, aggregateInstitutional, type InstitutionalStock } from '../hooks/useInstitutional';
import { LAYER_NAMES, LAYER_ICONS, LAYER_THEME, THEME_COLORS, layerShortCode, stockInLayer } from '../types/stock';

function fmtNet(n: number): string {
  const abs = Math.abs(n);
  let str: string;
  if (abs >= 1_000_000) str = `${(abs / 1_000_000).toFixed(1)}M`;  // e.g. 21626000 → 21.6M
  else if (abs >= 10_000) str = `${(abs / 1000).toFixed(0)}K`;      // e.g. 21626 → 22K
  else str = abs.toLocaleString('zh-TW');
  return (n > 0 ? '+' : '-') + str;
}

function InstiGrid({ insti }: { insti: InstitutionalStock }) {
  const rows = [
    { label: '外資', value: insti.foreign_net },
    { label: '投信', value: insti.trust_net },
    { label: '融資', value: insti.margin_change },
    { label: '融券', value: insti.short_change },
  ];
  const nonZero = rows.filter((r) => r.value !== 0);
  if (nonZero.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5 mt-2 pt-1.5 border-t border-white/15">
      {nonZero.map(({ label, value }) => (
        <div key={label} className="flex items-center gap-0.5 min-w-0">
          <span className="text-[11px] text-text-s font-medium shrink-0">{label}</span>
          <span className={`text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap
            ${value > 0 ? 'text-tw-up' : 'text-tw-down'}`}>
            {value > 0 ? '▲' : '▼'}{fmtNet(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface CardData {
  layerId: number | null;
  name: string;
  count: number;
  avgChange: number | null;
  upCount: number;
  downCount: number;
  insti: InstitutionalStock | null;
}

function LayerCard({
  data, selected, onClick,
}: {
  data: CardData;
  selected: boolean;
  onClick: () => void;
}) {
  const { layerId, name, count, avgChange, upCount, downCount, insti } = data;
  const isUp = (avgChange ?? 0) > 0;
  const isDown = (avgChange ?? 0) < 0;

  const icon = layerId !== null ? (LAYER_ICONS[layerId] ?? '📊') : '🌐';
  const theme = layerId !== null ? LAYER_THEME[layerId] : null;
  const themeColor = theme ? THEME_COLORS[theme] : '#8B949E';

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all duration-150
        ${selected
          ? 'border-accent bg-accent/15 shadow-lg shadow-accent/20 scale-[1.02]'
          : 'border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/35'
        }`}
    >
      {/* Top row: icon + layer code + avg change */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-base flex-shrink-0"
            style={{ backgroundColor: `${themeColor}33` }}
          >
            {icon}
          </span>
          <span
            className="text-[10px] font-mono font-semibold"
            style={{ color: themeColor }}
          >
            {layerId !== null ? layerShortCode(layerId) : '全部'}
          </span>
        </div>
        <span className={`text-sm font-bold font-mono tabular-nums
          ${isUp ? 'text-tw-up' : isDown ? 'text-tw-down' : 'text-text-t'}`}>
          {avgChange !== null
            ? `${avgChange > 0 ? '+' : ''}${avgChange.toFixed(2)}%`
            : '--'}
        </span>
      </div>

      {/* Layer name */}
      <div className="text-sm font-semibold text-white leading-tight mb-1 line-clamp-1">
        {name}
      </div>

      {/* Stock count + up/down */}
      <div className="flex items-center gap-2 text-[11px] text-text-s font-medium">
        <span>{count} 支</span>
        {count > 0 && (
          <>
            <span className="text-tw-up">↑{upCount}</span>
            <span className="text-tw-down">↓{downCount}</span>
          </>
        )}
      </div>

      {/* Institutional data */}
      {insti && <InstiGrid insti={insti} />}
    </button>
  );
}

export function LayerCards() {
  const { stocks, selectedLayers, toggleLayer, clearLayers } = useDashboardStore();
  const { data: insti } = useInstitutional();

  const allCard = useMemo<CardData>(() => {
    const withChange = stocks.filter((s) => s.change_percent !== null);
    const avgChange = withChange.length > 0
      ? withChange.reduce((s, x) => s + (x.change_percent ?? 0), 0) / withChange.length
      : null;
    const instiAgg = insti
      ? aggregateInstitutional(stocks.map((s) => s.symbol), insti.stocks)
      : null;
    return {
      layerId: null, name: '全部產業',
      count: stocks.length,
      upCount: stocks.filter((s) => (s.change_percent ?? 0) > 0).length,
      downCount: stocks.filter((s) => (s.change_percent ?? 0) < 0).length,
      avgChange,
      insti: instiAgg,
    };
  }, [stocks, insti]);

  const layerCards = useMemo<CardData[]>(() =>
    Object.entries(LAYER_NAMES)
      .map(([num, name]) => {
        const layerId = parseInt(num);
        const ls = stocks.filter((s) => stockInLayer(s, layerId));
        if (ls.length === 0) return null;
        const withChange = ls.filter((s) => s.change_percent !== null);
        const avgChange = withChange.length > 0
          ? withChange.reduce((s, x) => s + (x.change_percent ?? 0), 0) / withChange.length
          : null;
        const instiAgg = insti
          ? aggregateInstitutional(ls.map((s) => s.symbol), insti.stocks)
          : null;
        return {
          layerId, name, count: ls.length,
          upCount: ls.filter((s) => (s.change_percent ?? 0) > 0).length,
          downCount: ls.filter((s) => (s.change_percent ?? 0) < 0).length,
          avgChange,
          insti: instiAgg,
        };
      })
      .filter(Boolean) as CardData[],
  [stocks, insti]);

  if (stocks.length === 0) return null;

  const allCardsList = [allCard, ...layerCards];

  return (
    <div className="grid gap-2 py-1 px-0.5
                    grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-10">
      {allCardsList.map((data, idx) => (
        <LayerCard
          key={data.layerId ?? `all-${idx}`}
          data={data}
          selected={data.layerId === null
            ? selectedLayers.length === 0
            : selectedLayers.includes(data.layerId)}
          onClick={() => data.layerId === null ? clearLayers() : toggleLayer(data.layerId)}
        />
      ))}
    </div>
  );
}
