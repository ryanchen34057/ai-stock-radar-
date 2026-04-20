import { useEffect, useMemo } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { useInstitutional, aggregateInstitutional, type InstitutionalStock } from '../hooks/useInstitutional';
import { LAYER_NAMES, LAYER_ICONS, LAYER_THEME, THEME_COLORS, layerShortCode, stockInLayer } from '../types/stock';

function fmtNet(n: number): string {
  const abs = Math.abs(n);
  let str: string;
  if (abs >= 1_000_000) str = `${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 10_000) str = `${(abs / 1000).toFixed(0)}K`;
  else str = abs.toLocaleString('zh-TW');
  return (n > 0 ? '+' : '-') + str;
}

/**
 * Bloomberg-style institutional panel: dense monospace rows with label,
 * coloured value and a proportional intensity bar. Gives each card a
 * consistent "trading terminal" feel instead of loose inline badges.
 */
function InstiGrid({ insti }: { insti: InstitutionalStock }) {
  const rows = [
    { key: 'foreign',  label: '外資', value: insti.foreign_net,    short: '外' },
    { key: 'trust',    label: '投信', value: insti.trust_net,      short: '投' },
    { key: 'dealer',   label: '自營', value: insti.dealer_net,     short: '自' },
    { key: 'margin',   label: '融資', value: insti.margin_change,  short: '資' },
    { key: 'short',    label: '融券', value: insti.short_change,   short: '券' },
  ];
  const nonZero = rows.filter((r) => r.value !== 0);
  if (nonZero.length === 0) return null;

  // Scale bar width relative to the largest magnitude among visible rows
  const maxAbs = Math.max(...nonZero.map((r) => Math.abs(r.value)), 1);
  const total = insti.total_net || (insti.foreign_net + insti.trust_net + insti.dealer_net);

  return (
    <div className="mt-2 pt-1.5 border-t border-white/15 font-mono">
      {/* Aggregate header: 三大 total with large number */}
      {total !== 0 && (
        <div className="flex items-baseline justify-between mb-1 text-[10px]">
          <span className="tracking-[0.15em] text-text-t uppercase">三大</span>
          <span className={`text-[12px] font-bold tabular-nums leading-none
            ${total > 0 ? 'text-tw-up' : 'text-tw-down'}`}>
            {total > 0 ? '+' : '-'}{fmtNet(total).replace(/^[+-]/, '')}
          </span>
        </div>
      )}

      {/* Per-entity rows */}
      <div className="space-y-[3px]">
        {nonZero.map((r) => {
          const isBuy = r.value > 0;
          const barColor = isBuy ? 'bg-tw-up/70' : 'bg-tw-down/70';
          const textColor = isBuy ? 'text-tw-up' : 'text-tw-down';
          const bgTrack = isBuy ? 'bg-tw-up/10' : 'bg-tw-down/10';
          const widthPct = Math.max(6, (Math.abs(r.value) / maxAbs) * 100);
          return (
            <div key={r.key} className="flex items-center gap-1.5 min-w-0">
              {/* Fixed-width 1-char label chip */}
              <span className="shrink-0 text-[10px] text-text-s font-semibold w-3 text-center">
                {r.short}
              </span>

              {/* Intensity bar + value overlay — value stays white on the
                  coloured bar for maximum contrast */}
              <div className={`relative flex-1 h-[14px] rounded-sm overflow-hidden ${bgTrack}`}>
                <div
                  className={`absolute inset-y-0 left-0 ${barColor} transition-all`}
                  style={{ width: `${widthPct}%` }}
                />
                <div className="relative z-10 flex items-center justify-between h-full px-1.5">
                  <span className="text-[9px] font-bold text-white">
                    {isBuy ? '▲' : '▼'}
                  </span>
                  <span className="text-[10px] font-bold tabular-nums text-white leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                    {fmtNet(r.value).replace(/^[+-]/, '')}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
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
      className={`text-left rounded-xl border p-4 transition-all duration-150
        ${selected
          ? 'border-accent bg-accent/15 shadow-lg shadow-accent/20 scale-[1.02]'
          : 'border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/35'
        }`}
    >
      {/* Top row: icon + layer code + avg change */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
            style={{ backgroundColor: `${themeColor}33` }}
          >
            {icon}
          </span>
          <span
            className="text-xs font-mono font-bold"
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
      <div className="text-[15px] font-semibold text-white leading-tight mb-1.5 line-clamp-2 min-h-[2.4em]">
        {name}
      </div>

      {/* Stock count + up/down */}
      <div className="flex items-center gap-2.5 text-xs text-text-s font-medium">
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
  const {
    stocks, selectedLayers, toggleLayer, clearLayers,
    themeFilter, tierFilter,
  } = useDashboardStore();
  const { data: insti } = useInstitutional();

  // Pre-filter stocks so the cards match what the grid will actually show
  // (theme + tier). Cross-theme view keeps stocks tagged with >1 theme.
  const activeStocks = useMemo(() => {
    return stocks.filter((s) => {
      // Theme gate
      if (themeFilter === 'cross') {
        if ((s.themes?.length ?? 0) <= 1) return false;
      } else if (themeFilter !== 'all') {
        if (s.theme !== themeFilter && !(s.themes ?? []).includes(themeFilter)) return false;
      }
      // Tier gate
      if ((s.tier ?? 2) > tierFilter) return false;
      return true;
    });
  }, [stocks, themeFilter, tierFilter]);

  // Clear any layer selections that no longer match the current theme so
  // the grid doesn't silently render empty after a theme switch.
  useEffect(() => {
    if (selectedLayers.length === 0) return;
    if (themeFilter === 'all' || themeFilter === 'cross') return;
    const stillValid = selectedLayers.filter((id) => LAYER_THEME[id] === themeFilter);
    if (stillValid.length !== selectedLayers.length) {
      clearLayers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeFilter]);

  const allCard = useMemo<CardData>(() => {
    const withChange = activeStocks.filter((s) => s.change_percent !== null);
    const avgChange = withChange.length > 0
      ? withChange.reduce((s, x) => s + (x.change_percent ?? 0), 0) / withChange.length
      : null;
    const instiAgg = insti
      ? aggregateInstitutional(activeStocks.map((s) => s.symbol), insti.stocks)
      : null;
    const label =
      themeFilter === 'A' ? '全部 AI' :
      themeFilter === 'B' ? '全部電動車' :
      themeFilter === 'C' ? '全部機器人' :
      themeFilter === 'cross' ? '跨主題全部' :
      '全部產業';
    return {
      layerId: null, name: label,
      count: activeStocks.length,
      upCount: activeStocks.filter((s) => (s.change_percent ?? 0) > 0).length,
      downCount: activeStocks.filter((s) => (s.change_percent ?? 0) < 0).length,
      avgChange,
      insti: instiAgg,
    };
  }, [activeStocks, insti, themeFilter]);

  const layerCards = useMemo<CardData[]>(() => {
    // Only include layers that belong to the currently-selected theme.
    // For 'all' / 'cross', include every layer.
    const layerInScope = (id: number): boolean => {
      if (themeFilter === 'all' || themeFilter === 'cross') return true;
      return LAYER_THEME[id] === themeFilter;
    };

    const themeOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
    const entries = Object.entries(LAYER_NAMES)
      .map(([num, name]) => ({ layerId: parseInt(num), name }))
      .filter((e) => layerInScope(e.layerId))
      .sort((a, b) => {
        const ta = themeOrder[LAYER_THEME[a.layerId]] ?? 99;
        const tb = themeOrder[LAYER_THEME[b.layerId]] ?? 99;
        if (ta !== tb) return ta - tb;
        return layerShortCode(a.layerId).localeCompare(layerShortCode(b.layerId), 'en', { numeric: true });
      });

    return entries
      .map(({ layerId, name }) => {
        const ls = activeStocks.filter((s) => stockInLayer(s, layerId));
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
      .filter(Boolean) as CardData[];
  }, [activeStocks, insti, themeFilter]);

  if (stocks.length === 0) return null;

  const allCardsList = [allCard, ...layerCards];

  return (
    <div className="grid gap-2.5 py-1 px-0.5
                    grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
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
