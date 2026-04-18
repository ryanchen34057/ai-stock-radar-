import { useEffect, useState } from 'react';
import { useDashboardStore } from './store/dashboardStore';
import { Dashboard } from './components/Dashboard';
import { SupplyChainMap } from './components/SupplyChainMap';

type Tab = 'dashboard' | 'chain';

export default function App() {
  const darkMode = useDashboardStore((s) => s.darkMode);
  const [tab, setTab] = useState<Tab>('dashboard');

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-dash-bg flex flex-col">
      {/* Global tab bar */}
      <nav className="flex items-center gap-0 border-b border-border-c bg-card-bg px-4 flex-shrink-0">
        <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
          📊 儀表板
        </TabButton>
        <TabButton active={tab === 'chain'} onClick={() => setTab('chain')}>
          🔗 供應鏈地圖
        </TabButton>
        <span className="ml-auto text-xs text-text-t py-2 pr-1 hidden sm:block">
          AI 產業鏈股票雷達
        </span>
      </nav>

      <div className="flex-1 overflow-hidden">
        {tab === 'dashboard' ? <Dashboard /> : <SupplyChainMap />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
        ${active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-s hover:text-text-p hover:border-border-c'
        }`}
    >
      {children}
    </button>
  );
}
