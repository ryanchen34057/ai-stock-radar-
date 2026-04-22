import { useState, useMemo, useRef, useEffect } from 'react';
import type { MAPeriod, AlertFilter, SortBy, SpecialFilters, InstiFilters, RangeFilter, KDFilters, ThemeFilter, StockData } from '../types/stock';
import { StockManager } from './StockManager';
import { useDashboardStore } from '../store/dashboardStore';
import { useStockData } from '../hooks/useStockData';
import { formatDate } from '../utils/formatters';
import { LayerCards } from './LayerCards';
import { layerShortCode } from '../types/stock';

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

function RangeRow({
  label, unit, step, filter, onChange,
}: {
  label: string;
  unit: string;
  step: number;
  filter: RangeFilter;
  onChange: (f: RangeFilter) => void;
}) {
  const parse = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  };
  const active = filter.enabled && (filter.min !== null || filter.max !== null);
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filter.enabled}
          onChange={(e) => onChange({ ...filter, enabled: e.target.checked })}
          className="accent-accent w-3.5 h-3.5"
        />
        <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-white'}`}>{label}</span>
      </label>
      <input
        type="number" step={step} min={0}
        placeholder="最小"
        disabled={!filter.enabled}
        value={filter.min ?? ''}
        onChange={(e) => onChange({ ...filter, min: parse(e.target.value) })}
        className="w-20 text-xs bg-card-bg text-text-p border border-border-c rounded px-2 py-1
                   text-center focus:outline-none focus:border-accent
                   disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <span className="text-xs text-text-t">~</span>
      <input
        type="number" step={step} min={0}
        placeholder="最大"
        disabled={!filter.enabled}
        value={filter.max ?? ''}
        onChange={(e) => onChange({ ...filter, max: parse(e.target.value) })}
        className="w-20 text-xs bg-card-bg text-text-p border border-border-c rounded px-2 py-1
                   text-center focus:outline-none focus:border-accent
                   disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <span className="text-xs text-text-t">{unit}</span>
    </div>
  );
}

export function ControlBar() {
  const {
    selectedMA, setSelectedMA,
    alertFilter, setAlertFilter,
    maProximityFilter, setMAProximityFilter,
    specialFilters, setSpecialFilters,
    instiFilters, setInstiFilters,
    priceFilter, setPriceFilter,
    peFilter, setPeFilter,
    kdFilters, setKDFilters,
    themeFilter, setThemeFilter,
    searchQuery, setSearchQuery,
    sortBy, setSortBy,
    darkMode, toggleDarkMode,
    lastUpdated, loading,
  } = useDashboardStore();
  const stocks = useDashboardStore((s) => s.stocks);
  const setSelectedStock = useDashboardStore((s) => s.setSelectedStock);
  const { refresh } = useStockData();

  // ── Search autocomplete ──
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(0);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const searchSuggestions: StockData[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return stocks
      .filter((s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.sub_category ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => {
        // exact symbol match first, then symbol-startsWith, then name-startsWith
        const as = a.symbol.toLowerCase(), an = a.name.toLowerCase();
        const bs = b.symbol.toLowerCase(), bn = b.name.toLowerCase();
        const rank = (sym: string, nm: string) =>
          sym === q ? 0 : sym.startsWith(q) ? 1 : nm.startsWith(q) ? 2 : 3;
        return rank(as, an) - rank(bs, bn);
      })
      .slice(0, 8);
  }, [searchQuery, stocks]);

  // Reset highlight when suggestions change
  useEffect(() => { setSearchHighlight(0); }, [searchQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pickSuggestion = (s: StockData) => {
    setSelectedStock(s);           // open stock detail modal
    setSearchQuery('');
    setSearchFocused(false);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchSuggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchHighlight((i) => Math.min(i + 1, searchSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickSuggestion(searchSuggestions[searchHighlight] ?? searchSuggestions[0]);
    } else if (e.key === 'Escape') {
      setSearchFocused(false);
    }
  };

  const toggleSF = (key: keyof SpecialFilters) =>
    setSpecialFilters({ ...specialFilters, [key]: !specialFilters[key] });

  const toggleIF = (key: keyof InstiFilters) =>
    setInstiFilters({ ...instiFilters, [key]: !instiFilters[key] });

  const toggleKD = (key: keyof KDFilters) =>
    setKDFilters({ ...kdFilters, [key]: !kdFilters[key] });

  const anySpecial = Object.values(specialFilters).some(Boolean);
  const anyInsti = Object.values(instiFilters).some(Boolean);
  const anyKD = Object.values(kdFilters).some(Boolean);

  const [managerOpen, setManagerOpen] = useState(false);

  const THEME_BTNS: { val: ThemeFilter; label: string; icon: string }[] = [
    { val: 'all',   label: '全部',          icon: '🔀' },
    { val: 'A',     label: 'AI 產業鏈',     icon: '🎯' },
    { val: 'B',     label: '電動車',        icon: '🚗' },
    { val: 'C',     label: '機器人',        icon: '🤖' },
    { val: 'cross', label: '跨主題精選',    icon: '⭐' },
  ];

  return (
    <div className="bg-card-bg border-b border-border-c px-4 py-3 space-y-2.5">

      {/* ── Row 0: search + theme + stock manager ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center" ref={searchBoxRef}>
          <span className="absolute left-2 text-text-t text-xs pointer-events-none">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={onSearchKeyDown}
            placeholder="搜尋代號、名稱、題材..."
            autoComplete="off"
            className="w-56 bg-dash-bg border border-border-c rounded pl-7 pr-7 py-1.5 text-xs text-text-p
                       placeholder:text-text-t focus:outline-none focus:border-accent font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchFocused(false); }}
              className="absolute right-2 text-text-t hover:text-text-p text-xs"
              title="清除搜尋"
            >
              ✕
            </button>
          )}

          {/* Autocomplete dropdown */}
          {searchFocused && searchSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-80 max-h-80 overflow-y-auto
                            bg-card-bg border border-accent/50 rounded-lg shadow-2xl z-50
                            scrollbar-thin scrollbar-thumb-white/20">
              {searchSuggestions.map((s, i) => (
                <button
                  key={s.symbol}
                  onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                  onMouseEnter={() => setSearchHighlight(i)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs
                              border-b border-border-c/40 last:border-b-0 transition-colors
                              ${i === searchHighlight ? 'bg-accent/15' : 'hover:bg-card-hover'}`}
                >
                  <span className="font-mono font-bold text-accent shrink-0 w-10">{s.symbol}</span>
                  <span className="text-white font-semibold truncate flex-1">{s.name}</span>
                  <span className="font-mono text-[10px] text-text-t shrink-0">
                    {layerShortCode(s.layer)}
                  </span>
                  {s.sub_category && (
                    <span className="text-[10px] text-text-s truncate max-w-[110px]"
                          title={s.sub_category}>
                      {s.sub_category}
                    </span>
                  )}
                </button>
              ))}
              <div className="px-2.5 py-1 text-[10px] text-text-t bg-dash-bg/70 border-t border-border-c/40">
                ↑↓ 選擇 · Enter 開啟 · Esc 關閉
              </div>
            </div>
          )}
        </div>
        <span className="text-sm font-semibold text-white ml-2">主題:</span>
        {THEME_BTNS.map((b) => (
          <button
            key={b.val}
            onClick={() => setThemeFilter(b.val)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              themeFilter === b.val
                ? 'bg-accent text-white border-accent font-semibold'
                : 'border-border-c bg-card-bg text-text-s hover:text-text-p'
            }`}
            title={b.label}
          >
            {b.icon} {b.label}
          </button>
        ))}

        <button
          onClick={() => setManagerOpen(true)}
          className="ml-auto px-3 py-1 text-xs rounded border border-border-c text-text-s
                     hover:text-accent hover:border-accent transition-colors"
          title="新增 / 編輯 / 停用股票"
        >
          ⚙ 股票管理
        </button>
      </div>

      {managerOpen && <StockManager onClose={() => setManagerOpen(false)} />}

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
        <FilterPill active={specialFilters.gapUp} onClick={() => toggleSF('gapUp')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          跳空向上 ↑
        </FilterPill>
        <FilterPill active={specialFilters.gapDown} onClick={() => toggleSF('gapDown')}
          activeClass="bg-tw-up/20 text-tw-up border-tw-up/50">
          跳空向下 ↓
        </FilterPill>
        <FilterPill active={specialFilters.pullbackReclaim5} onClick={() => toggleSF('pullbackReclaim5')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          回測5MA反彈
        </FilterPill>
        <FilterPill active={specialFilters.pullbackReclaim10} onClick={() => toggleSF('pullbackReclaim10')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          回測10MA反彈
        </FilterPill>
        <FilterPill active={specialFilters.pullbackReclaim20} onClick={() => toggleSF('pullbackReclaim20')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          回測20MA反彈
        </FilterPill>
      </div>

      {/* ── Row 3b: price & PE range filters ── */}
      <div className="flex flex-wrap items-center gap-4">
        <RangeRow
          label="股價"
          unit="NT$"
          step={0.5}
          filter={priceFilter}
          onChange={setPriceFilter}
        />
        <RangeRow
          label="本益比"
          unit="x"
          step={0.5}
          filter={peFilter}
          onChange={setPeFilter}
        />
      </div>

      {/* ── Row 3c: KD (5,3,3) trend filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-semibold ${anyKD ? 'text-accent' : 'text-white'}`}>KD(5,3,3):</span>
        <FilterPill active={kdFilters.golden} onClick={() => toggleKD('golden')}
          activeClass="bg-tw-down/20 text-tw-down border-tw-down/50">
          黃金交叉
        </FilterPill>
        <FilterPill active={kdFilters.death} onClick={() => toggleKD('death')}
          activeClass="bg-tw-up/20 text-tw-up border-tw-up/50">
          死亡交叉
        </FilterPill>
        <FilterPill active={kdFilters.up} onClick={() => toggleKD('up')}
          activeClass="bg-tw-down/10 text-tw-down border-tw-down/30">
          K 向上
        </FilterPill>
        <FilterPill active={kdFilters.down} onClick={() => toggleKD('down')}
          activeClass="bg-tw-up/10 text-tw-up border-tw-up/30">
          K 向下
        </FilterPill>
        <FilterPill active={kdFilters.oversold} onClick={() => toggleKD('oversold')}
          activeClass="bg-accent/20 text-accent border-accent/50">
          超賣 K&lt;20
        </FilterPill>
        <FilterPill active={kdFilters.overbought} onClick={() => toggleKD('overbought')}
          activeClass="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
          超買 K&gt;80
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
