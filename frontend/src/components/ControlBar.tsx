import type { MAPeriod, AlertFilter, SortBy } from '../types/stock';
import { LAYER_NAMES } from '../types/stock';
import { useDashboardStore } from '../store/dashboardStore';
import { useStockData } from '../hooks/useStockData';
import { formatDate } from '../utils/formatters';

const MA_OPTIONS: MAPeriod[] = [5, 10, 20, 60, 120, 240];

export function ControlBar() {
  const {
    selectedMA, setSelectedMA,
    alertFilter, setAlertFilter,
    maProximityFilter, setMAProximityFilter,
    selectedLayers, toggleLayer, clearLayers,
    sortBy, setSortBy,
    darkMode, toggleDarkMode,
    lastUpdated, loading,
  } = useDashboardStore();
  const { refresh } = useStockData();

  return (
    <div className="bg-card-bg border-b border-border-c px-4 py-3 space-y-3">
      {/* Top row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Refresh */}
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

        {/* MA Selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-s mr-1">均線:</span>
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

        {/* Alert filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-s mr-1">警示:</span>
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

        {/* Sort */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-s mr-1">排序:</span>
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

        {/* Dark mode & last updated */}
        <div className="flex items-center gap-3 ml-auto">
          {lastUpdated && (
            <span className="text-xs text-text-t hidden sm:block">
              更新: {formatDate(lastUpdated)}
            </span>
          )}
          <button
            onClick={toggleDarkMode}
            className="px-2 py-1 text-xs text-text-s hover:text-text-p border border-border-c
                       rounded transition-colors"
          >
            {darkMode ? '☀ 亮色' : '☾ 深色'}
            <kbd className="ml-1 text-xs text-text-t">[D]</kbd>
          </button>
        </div>
      </div>

      {/* MA Proximity Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={maProximityFilter.enabled}
            onChange={(e) => setMAProximityFilter({ ...maProximityFilter, enabled: e.target.checked })}
            className="accent-accent w-3.5 h-3.5"
          />
          <span className="text-xs text-text-s">均線距離篩選</span>
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
          <span className="text-xs text-text-t">在</span>
          <input
            type="number"
            min={0.1}
            max={30}
            step={0.5}
            value={maProximityFilter.threshold}
            disabled={!maProximityFilter.enabled}
            onChange={(e) => setMAProximityFilter({
              ...maProximityFilter,
              threshold: Math.max(0.1, parseFloat(e.target.value) || 1),
            })}
            className="w-14 text-xs bg-card-bg text-text-p border border-border-c rounded px-2 py-1
                       text-center focus:outline-none focus:border-accent
                       disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <span className="text-xs text-text-t">% 以內</span>
        </div>

        {maProximityFilter.enabled && (
          <span className="text-xs text-accent font-mono">
            ▸ 股價在 MA{maProximityFilter.ma}{' '}
            {maProximityFilter.direction === 'above' ? '上方' :
             maProximityFilter.direction === 'below' ? '下方' : '±'}
            {maProximityFilter.threshold}% 以內
          </span>
        )}
      </div>

      {/* Layer filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-s">產業層:</span>
        <button
          onClick={clearLayers}
          className={`px-2 py-0.5 text-xs rounded border transition-colors ${
            selectedLayers.length === 0
              ? 'border-accent text-accent bg-accent/10'
              : 'border-border-c text-text-t hover:text-text-p'
          }`}
        >
          全部 [A]
        </button>
        {Object.entries(LAYER_NAMES).map(([num, name]) => {
          const layer = parseInt(num);
          const active = selectedLayers.includes(layer);
          return (
            <button
              key={layer}
              onClick={() => toggleLayer(layer)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                active
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border-c text-text-t hover:text-text-s'
              }`}
            >
              L{layer} {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
