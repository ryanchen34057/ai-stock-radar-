import { useEffect, useState } from 'react';
import { useDashboardStore } from './store/dashboardStore';
import { Dashboard } from './components/Dashboard';
import { NewsFeed } from './components/NewsFeed';
import { KolFeed } from './components/KolFeed';
import { FbFeed } from './components/FbFeed';
import { Settings } from './components/Settings';
import { Panel } from './components/FloatingPanel';
import { StockDetailModal } from './components/StockDetailModal';
import { SetupOverlay } from './components/SetupOverlay';
import { OnboardingGuide } from './components/OnboardingGuide';
import { usePanelLayout, usePanelVisibility, type PanelId } from './hooks/usePanelLayout';

type Tab = 'dashboard' | 'settings';

interface PanelDescriptor {
  id: PanelId;
  title: string;
  icon: string;
  content: React.ReactNode;
}

export default function App() {
  const darkMode = useDashboardStore((s) => s.darkMode);
  const selectedStock = useDashboardStore((s) => s.selectedStock);
  const setSelectedStock = useDashboardStore((s) => s.setSelectedStock);
  const selectedMA = useDashboardStore((s) => s.selectedMA);
  const [tab, setTab] = useState<Tab>('dashboard');
  const kol = usePanelLayout('kol');
  const news = usePanelLayout('news');
  const fb = usePanelLayout('fb');

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else           document.documentElement.classList.remove('dark');
  }, [darkMode]);

  const panels: PanelDescriptor[] = [
    { id: 'kol',  title: '理財頻道',     icon: '🎙️', content: <KolFeed /> },
    { id: 'fb',   title: '理財粉專',     icon: '🅕',  content: <FbFeed /> },
    { id: 'news', title: '即時新聞',     icon: '📰', content: <NewsFeed /> },
  ];

  const stateOf = (id: PanelId) => (id === 'kol' ? kol : id === 'fb' ? fb : news);
  const isVisible = (id: PanelId) => stateOf(id).state.visible;
  const modeOf   = (id: PanelId) => stateOf(id).state.mode;

  const leftDocked  = panels.filter((p) => isVisible(p.id) && modeOf(p.id) === 'left');
  const rightDocked = panels.filter((p) => isVisible(p.id) && modeOf(p.id) === 'right');
  const floating    = panels.filter((p) => isVisible(p.id) && modeOf(p.id) === 'floating');

  return (
    <div className="h-screen bg-dash-bg flex flex-col overflow-hidden">
      {/* Global tab bar */}
      <nav className="flex items-center gap-0 border-b border-border-c bg-card-bg px-4 flex-shrink-0">
        <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>📊 儀表板</TabButton>
        <TabButton active={tab === 'settings'}  onClick={() => setTab('settings')}>⚙ 設定</TabButton>
        <div className="ml-auto flex items-center gap-1.5">
          <RefetchAllButton />
          <PanelToggles />
          <span className="text-xs text-text-t pl-2 pr-1 hidden sm:inline">
            AI 產業鏈股票雷達
          </span>
        </div>
      </nav>

      {/* Content area: [leftDocked] | [center (with floating overlays)] | [rightDocked] */}
      <div className="flex-1 min-h-0 flex">
        {leftDocked.map((p) => (
          <Panel key={p.id} id={p.id} title={p.title} icon={p.icon}>{p.content}</Panel>
        ))}

        {/* Center flex-1 — responsively resizes when dock widths change */}
        <div className="flex-1 min-w-0 min-h-0 relative">
          <div className="absolute inset-0 overflow-y-auto">
            {tab === 'dashboard' && <Dashboard />}
            {tab === 'settings'  && <Settings />}
          </div>

          {/* Floating panels live inside center so they only overlay the main content area */}
          {floating.map((p) => (
            <Panel key={p.id} id={p.id} title={p.title} icon={p.icon}>{p.content}</Panel>
          ))}
        </div>

        {rightDocked.map((p) => (
          <Panel key={p.id} id={p.id} title={p.title} icon={p.icon}>{p.content}</Panel>
        ))}
      </div>

      {/* Global stock detail modal — rendered above everything regardless of tab */}
      {selectedStock && (
        <StockDetailModal
          stock={selectedStock}
          selectedMA={selectedMA}
          onClose={() => setSelectedStock(null)}
        />
      )}

      {/* First-run: startup progress + usage guide */}
      <SetupOverlay />
      <OnboardingGuide />
    </div>
  );
}

/** Top-right batch refetch button — appears only when some stocks are incomplete. */
function RefetchAllButton() {
  const stocks = useDashboardStore((s) => s.stocks);
  const [running, setRunning] = useState(false);

  const incomplete = stocks.filter((s) => {
    const n = s.kline_count ?? s.klines.length;
    return s.data_complete === false || (s.data_complete === undefined && n < 100);
  });

  if (incomplete.length === 0) return null;

  const doRefetchAll = async () => {
    if (running) return;
    setRunning(true);
    for (const s of incomplete) {
      fetch(`/api/stocks/${s.symbol}/refetch`, { method: 'POST' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));
    }
    // Keep the button in "running" state for a while so user sees feedback
    setTimeout(() => setRunning(false), 60_000);
  };

  return (
    <button
      onClick={doRefetchAll}
      disabled={running}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors
        ${running
          ? 'bg-accent/10 text-accent border-accent/40 cursor-wait'
          : 'bg-yellow-500/15 text-yellow-300 border-yellow-500/50 hover:bg-yellow-500/25'
        }`}
      title={incomplete.map((s) => `${s.symbol} ${s.name} (${s.kline_count ?? s.klines.length} 筆)`).join('\n')}
    >
      {running ? (
        <>
          <span className="inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          抓取中...
        </>
      ) : (
        <>⚠ 一鍵重抓 {incomplete.length} 檔</>
      )}
    </button>
  );
}

function PanelToggles() {
  const { kol, news, fb } = usePanelVisibility();
  const cls = (visible: boolean) =>
    `px-2 py-1 text-xs rounded border transition-colors ${
      visible
        ? 'border-accent/50 bg-accent/15 text-accent'
        : 'border-border-c bg-card-bg text-text-s hover:text-text-p'
    }`;
  return (
    <>
      <button className={cls(kol.visible)}
        onClick={() => kol.setVisible(!kol.visible)}
        onDoubleClick={() => kol.reset()}
        title={`${kol.visible ? '隱藏' : '顯示'}理財頻道面板（雙擊重置）`}>
        🎙️ 理財
      </button>
      <button className={cls(fb.visible)}
        onClick={() => fb.setVisible(!fb.visible)}
        onDoubleClick={() => fb.reset()}
        title={`${fb.visible ? '隱藏' : '顯示'}理財粉專面板（雙擊重置）`}>
        🅕 粉專
      </button>
      <button className={cls(news.visible)}
        onClick={() => news.setVisible(!news.visible)}
        onDoubleClick={() => news.reset()}
        title={`${news.visible ? '隱藏' : '顯示'}新聞面板（雙擊重置）`}>
        📰 新聞
      </button>
    </>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
        ${active ? 'border-accent text-accent' : 'border-transparent text-text-s hover:text-text-p hover:border-border-c'}`}>
      {children}
    </button>
  );
}
