import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'newsRefreshInterval';
const EVENT_NAME = 'news-refresh-interval-changed';
const DEFAULT_MINUTES = 5;
const MIN_MINUTES = 1;
const MAX_MINUTES = 120;

/**
 * Shared control for how often the live news feed re-polls the backend.
 *
 * Persisted in localStorage so the setting survives reloads, and broadcast
 * via a synthetic event so Settings can change the value while NewsFeed is
 * mounted without requiring a page refresh.
 *
 * Setting the value to 0 disables auto-refresh entirely.
 */
export function useNewsRefreshInterval(): [number, (mins: number) => void] {
  const [minutes, setMinutes] = useState<number>(() => readStoredInterval());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === 'number') setMinutes(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    // Cross-tab: storage event fires in other tabs when the value changes.
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setMinutes(readStoredInterval());
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener('storage', storageHandler);
    };
  }, []);

  const update = useCallback((mins: number) => {
    const clamped = clamp(mins);
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch {/* ignore */}
    setMinutes(clamped);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: clamped }));
  }, []);

  return [minutes, update];
}

function readStoredInterval(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_MINUTES;
    const n = parseInt(raw, 10);
    if (isNaN(n)) return DEFAULT_MINUTES;
    return clamp(n);
  } catch {
    return DEFAULT_MINUTES;
  }
}

function clamp(n: number): number {
  if (n <= 0) return 0; // 0 = disabled
  if (n < MIN_MINUTES) return MIN_MINUTES;
  if (n > MAX_MINUTES) return MAX_MINUTES;
  return Math.floor(n);
}

export const NEWS_REFRESH_LIMITS = { min: MIN_MINUTES, max: MAX_MINUTES, default: DEFAULT_MINUTES };
