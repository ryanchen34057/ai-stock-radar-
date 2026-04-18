import type { MAPeriod, AlertFilter, SortBy, SpecialFilters, InstiFilters } from '../types/stock';
import { useDashboardStore } from '../store/dashboardStore';
import { useStockData } from '../hooks/useStockData';
import { formatDate } from '../utils/formatters';
import { LayerCards } from './LayerCards';

const MA_OPTIONS: MAPeriod[] = [5, 10, 20, 60, 120, 240];

function FilterPill({
  active, onClick, children, activeClass = 'bg-accent/20 text-accent border-accent',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  activeClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-xs rounded border transition-colors select-none
        ${active ? activeClass : 'border-white/20 bg-white/10 text-white hover:bg-white/20 hover:border-white/40'}`}
    >
      {children}
    </button>
  );
}

export function ControlBar() {
  const {
    selectedMA, setSelectedMA,
    alertFilter, setAlertFilter,
    maProximityFilter, setMAProximityFilter,
    specialFilters, setSpecialFilters,
    instiFilters, setInstiFilters,
    sortBy, setSortBy,
    darkMode, toggleDarkMode,
    lastUpdated, loading,
  } = useDashboardStore();
  const { refresh } = useStockData();

  const toggleSF = (key: keyof SpecialFilters) =>
    setSpecialFilters({ ...specialFilters, [key]: !specialFilters[key] });

  const toggleIF = (key: keyof InstiFilters) =>
    setInstiFilters({ ...instiFilters, [key]: !instiFilters[key] });

  const anySpecial = Object.values(specialFilters).some(Boolean);
  const anyInsti = Object.values(instiFilters).some(Boolean);

  return (
    <div className="bg-card-bg border-b border-border-c px-4 py-3 space-y-2.5">

      {/* ── Row 1: core controls ── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20
                     text-accent text-sm rounded border border-accent/20 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className={loading ? 'animate-spin' : ''}>↻</span>
          刷新資料
          <kbd className="ml-1 text-xs text-text-t">[R]</kbd>
        </button>

        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-white mr-1">均線:</span>
          {MA_OPTIONS.map((ma) => (
            <button
              key={ma}
              onClick={() => setSelectedMA(ma)}
              className={`px-2 py-1 text-xs rounded font-mono transition-colors ${
                selectedMA === ma
                  ? 'bg-tw-at text-black font-bold'
                  : 'bg-card-bg text-text-s hover:text-text-p border border-border-c'
              }`}
            >
              {ma}日
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-white mr-1">警示:</span>
          {([['all', '全部'], ['below', '跌破均線'], ['above', '站上均線']] as [AlertFilter, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setAlertFilter(val)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                alertFilter === val
                  ? val === 'below' ? 'bg-tw-up text-white'
                    : val === 'above' ? 'bg-tw-down text-white'
                    : 'bg-text-s text-black'
                  : 'bg-card-bg text-text-s hover:text-text-p border border-border-c'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-white mr-1">排序:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="text-xs bg-card-bg text-text-p border border-border-c rounded px-2 py-1
                       focus:outline-none focus:border-accent"
          >
            <option value="change_percent">漲跌幅</option>
            <option value="volume">成交量</option>
            <option value="ma_distance">離均線距離</option>
            <option value="symbol">代號</option>
          </select>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {lastUpdated && (
            <span className="text-xs text-text-t hidden sm:block">更新: {formatDate(lastUpdated)}</span>
          )}
          <button
            onClick={toggleDarkMode}
            className="px-2 py-1 text-xs text-text-s hover:text-text-p border border-border-c rounded transition-colors"
          >
            {darkMode ? '☀ 亮色' : '☾ 深色'}
            <kbd className="ml-1 text-xs text-text-t">[D]</kbd>
          </button>
        </div>
      </div>

      {/* ── Row 2: MA proximity filter ── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={maProximityFilter.enabled}
            onChange={(e) => setMAProximityFilter({ ...maProximityFilter, enabled: e.target.checked })}
            className="accent-accent w-3.5 h-3.5"
          />
          <span className="text-sm font-semibold text-white">均線距離</span>
        </label>
        <select
          value={maProximityFilter.ma}
          disabled={!maProximityFilter.enabled}
          onChange={(e) => setMAProximityFilter({ ...maProximityFilter, ma: Number(e.target.value) as MAPeriod })}
          className="text-xs bg-card-bg text-text-p border border-border-c rounded px-2 py-1
                     focus:outline-none focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {MA_OPTIONS.map((ma) => <option key={ma} value={ma}>MA{ma}</option>)}
        </select>
        {(['above', 'at', 'below'] as const).map((dir) => (
          <button
            key={dir}
            disabled={!maProximityFilter.enabled}
            onClick={() => setMAProximityFilter({ ...maProximityFilter, direction: dir })}
            className={`px-2 py-1 text-xs rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              maProximityFilter.direction === dir && maProximityFilter.enabled
                ? dir === 'above' ? 'bg-tw-down text-white'
                  : dir === 'below' ? 'bg-tw-up text-white'
                  : 'bg-tw-at text-black'
                : 'bg-card-bg text-text-s border border-border-c hover:text-text-p'
            }`}
          >
            {dir === 'above' ? '上方' : dir === 'below' ? '下方' : '貼線'}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="number" min={0.1} max={30} step={0.5}
            value={maProximityFilter.threshold}
            disabled={!maProximityFilter.enabled}
            onChange={(e) => setMAProximityFilter({
              ...maProximityFilter, threshold: Math.max(0.1, parseFloat(e.target.value) || 1),
            })}
            className="w-14 text-xs bg-card-bg text-text-p border border-border-c rounded px-2 py-1
                       text-center focus:outline-none focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <span className="text-xs text-text-t">% 以內</span>
        </div>
        {maProximityFilter.enabled && (
          <span className="text-xs text-accent font-mono">
            ▸ 在 MA{maProximityFilter.ma}{' '}
            {maProximityFilter.direction === 'above' ? '上方' :
             maProximityFilter.direction === 'below' ? '下方' : '±'}
            {maProximityFilter.threshold}%
          </span>
        )}
      </div>

      {/* ── Row 3: special condition filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-semibold ${anySpecial ? 'text-accent' : 'text-white'}`}>技術條件:</span>
        <FilterPill active={specialFilters.maBullishAlignment} onClick={() => toggleSF('maBullishAlignment')}>
          均線多頭排列
        </FilterPill>
        <FilterPill active={specialFilters.aboveWeeklyMA} onClick={() => toggleSF('aboveWeeklyMA')}>
          站上周線 MA5
        </FilterPill>
        <FilterPill active={specialFilters.aboveMonthlyMA} onClick={() => toggleSF('aboveMonthlyMA')}>
          站上月線 MA20
        </FilterPill>
        <FilterPill active={specialFilters.aboveQuarterlyMA} onClick={() => toggleSF('aboveQuarterlyMA')}>
          站上季線 MA60
        </FilterPill>
        <FilterPill active={specialFilters.price20DayHigh} onClick={() => toggleSF('price20DayHigh')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          創20日新高
        </FilterPill>
        <FilterPill active={specialFilters.allTimeHigh} onClick={() => toggleSF('allTimeHigh')}
          activeClass="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
          收盤創歷史新高 ATH
        </FilterPill>
      </div>

      {/* ── Row 4: institutional filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-semibold ${anyInsti ? 'text-accent' : 'text-white'}`}>籌碼面:</span>
        <FilterPill active={instiFilters.foreignNetBuy} onClick={() => toggleIF('foreignNetBuy')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          外資買超
        </FilterPill>
        <FilterPill active={instiFilters.trustNetBuy} onClick={() => toggleIF('trustNetBuy')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          投信買超
        </FilterPill>
        <FilterPill active={instiFilters.marginIncreasing} onClick={() => toggleIF('marginIncreasing')}
          activeClass="bg-accent/20 text-accent border-accent/50">
          融資增加
        </FilterPill>
        <FilterPill active={instiFilters.shortDecreasing} onClick={() => toggleIF('shortDecreasing')}
          activeClass="bg-tw-up/20 text-tw-up border-tw-up/50">
          融券減少
        </FilterPill>
        {anyInsti && (
          <span className="text-xs text-text-t">（需先載入法人資料）</span>
        )}
      </div>

      {/* ── Row 5: layer cards ── */}
      <div>
        <div className="text-sm font-semibold text-white mb-1.5">產業層:</div>
        <LayerCards />
      </div>
    </div>
  );
}
