import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { useStockData } from './useStockData';
import type { MAPeriod } from '../types/stock';

const MA_CYCLE: MAPeriod[] = [5, 10, 20, 60, 120, 240];

export function useKeyboardShortcuts() {
  const {
    toggleLayer, clearLayers, toggleDarkMode,
    setAlertFilter, selectedMA, setSelectedMA,
    setSelectedStock,
  } = useDashboardStore();
  const { refresh } = useStockData();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();

      switch (key) {
        case 'r': refresh(); break;
        case 'd': toggleDarkMode(); break;
        case 'a': clearLayers(); setAlertFilter('all'); break;
        case 'escape': setSelectedStock(null); break;
        case '1': case '2': case '3': case '4': case '5':
        case '6': case '7': case '8': case '9':
          toggleLayer(parseInt(key)); break;
        case '0': toggleLayer(10); break;
        case 'm': {
          const idx = MA_CYCLE.indexOf(selectedMA);
          setSelectedMA(MA_CYCLE[(idx + 1) % MA_CYCLE.length]);
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [refresh, toggleLayer, clearLayers, toggleDarkMode, setAlertFilter,
      selectedMA, setSelectedMA, setSelectedStock]);
}
