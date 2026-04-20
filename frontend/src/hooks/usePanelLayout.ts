import { useEffect, useState, useCallback } from 'react';

export type PanelId = 'kol' | 'news' | 'fb';
export type PanelMode = 'floating' | 'left' | 'right';

export interface PanelState {
  visible: boolean;
  mode: PanelMode;
  // Floating-mode geometry (also used for dock width when docked)
  x: number;
  y: number;
  width: number;
  height: number;
}

const STORAGE_KEY = 'panelLayout.v2';
const EVENT = 'panel-layout-changed';

function defaultFor(id: PanelId): PanelState {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const h = typeof window !== 'undefined' ? window.innerHeight : 900;
  const panelW = 360;
  const panelH = Math.max(520, h - 120);
  if (id === 'kol') {
    return { visible: true,  mode: 'left',     x: 0,                        y: 48, width: panelW, height: panelH };
  }
  if (id === 'fb') {
    // Hidden by default so users who don't use FB aren't distracted
    return { visible: false, mode: 'floating', x: panelW + 20,               y: 100, width: panelW, height: panelH - 80 };
  }
  return         { visible: true,  mode: 'right',    x: Math.max(0, w - panelW), y: 48, width: panelW, height: panelH };
}

function readAll(): Record<string, PanelState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function writeAll(all: Record<string, PanelState>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch {/* ignore */}
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function usePanelLayout(id: PanelId) {
  const [state, setStateRaw] = useState<PanelState>(() => {
    const all = readAll();
    return { ...defaultFor(id), ...(all[id] ?? {}) };
  });

  useEffect(() => {
    const handler = () => {
      const all = readAll();
      setStateRaw({ ...defaultFor(id), ...(all[id] ?? {}) });
    };
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, [id]);

  const update = useCallback((patch: Partial<PanelState>) => {
    setStateRaw((prev) => {
      const next = { ...prev, ...patch };
      const all = readAll();
      all[id] = next;
      writeAll(all);
      return next;
    });
  }, [id]);

  const setVisible = useCallback((visible: boolean) => update({ visible }), [update]);
  const setMode = useCallback((mode: PanelMode) => update({ mode }), [update]);
  const setWidth = useCallback((width: number) => update({ width }), [update]);

  const reset = useCallback(() => {
    const all = readAll();
    const d = defaultFor(id);
    all[id] = d;
    writeAll(all);
    setStateRaw(d);
  }, [id]);

  return { state, update, setVisible, setMode, setWidth, reset };
}

/** Returns [state for each panel, toggle fn] for the top bar nav. */
export function usePanelVisibility() {
  const kol = usePanelLayout('kol');
  const news = usePanelLayout('news');
  const fb = usePanelLayout('fb');
  return {
    kol:  { visible: kol.state.visible,  setVisible: kol.setVisible,  reset: kol.reset },
    news: { visible: news.state.visible, setVisible: news.setVisible, reset: news.reset },
    fb:   { visible: fb.state.visible,   setVisible: fb.setVisible,   reset: fb.reset },
  };
}
