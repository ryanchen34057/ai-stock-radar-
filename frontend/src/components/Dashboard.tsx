import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { useStockData } from '../hooks/useStockData';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ControlBar } from './ControlBar';
import { StatsSummary } from './StatsSummary';
import { StockGrid } from './StockGrid';
import { BusinessCycle } from './BusinessCycle';

export function Dashboard() {
  const {
    stocks, loading, error,
    selectedMA, alertFilter, maProximityFilter, breakoutPendingFilter, bbUpperCrossFilter, bbProximityFilter, bbSqueezeFilter, bowlPatternFilter, specialFilters, instiFilters,
    priceFilter, peFilter, kdFilters,
    themeFilter, tierFilter, searchQuery,
    selectedLayers, sortBy,
  } = useDashboardStore();
  const { fetchData, refresh } = useStockData();
  useKeyboardShortcuts();

  useEffect(() => {
    fetchData();
    // Auto-refresh every 60s so intraday MIS prices surface without a manual
    // reload. refresh() bypasses the 5-min TTL cache.
    const id = window.setInterval(() => refresh(), 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-dash-bg text-text-p">
      <ControlBar />
      <BusinessCycle />

      <div className="px-4 py-4">
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-tw-up/10 border border-tw-up/30 rounded-lg text-tw-up text-sm">
            ⚠ 連線錯誤：{error}
            <span className="ml-2 text-text-s">
              請確認後端伺服器已啟動（cd backend && uvicorn main:app --reload）
            </span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && stocks.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-card-bg border border-border-c rounded-lg p-3 h-48 animate-pulse">
                <div className="h-4 bg-border-c rounded w-3/4 mb-2" />
                <div className="h-8 bg-border-c rounded w-1/2 mb-4" />
                <div className="h-[88px] bg-border-c rounded mb-2" />
                <div className="h-3 bg-border-c rounded w-full" />
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {stocks.length > 0 && (
          <>
            <StatsSummary stocks={stocks} selectedMA={selectedMA} alertFilter={alertFilter} />
            <StockGrid
              stocks={stocks}
              selectedMA={selectedMA}
              alertFilter={alertFilter}
              maProximityFilter={maProximityFilter}
              breakoutPendingFilter={breakoutPendingFilter}
              bbUpperCrossFilter={bbUpperCrossFilter}
              bbProximityFilter={bbProximityFilter}
              bbSqueezeFilter={bbSqueezeFilter}
              bowlPatternFilter={bowlPatternFilter}
              specialFilters={specialFilters}
              instiFilters={instiFilters}
              priceFilter={priceFilter}
              peFilter={peFilter}
              kdFilters={kdFilters}
              themeFilter={themeFilter}
              tierFilter={tierFilter}
              searchQuery={searchQuery}
              selectedLayers={selectedLayers}
              sortBy={sortBy}
            />
          </>
        )}

        {/* Empty state */}
        {!loading && stocks.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-text-t">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-lg font-medium text-text-s mb-2">尚無資料</div>
            <div className="text-sm text-center max-w-md">
              請先執行初始化腳本建立資料庫：
              <br />
              <code className="text-accent font-mono text-xs mt-1 block">
                cd backend && python -m scripts.init_db
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
