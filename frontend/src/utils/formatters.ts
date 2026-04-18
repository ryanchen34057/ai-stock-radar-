export function formatPrice(price: number | null): string {
  if (price === null) return '--';
  return price.toLocaleString('zh-TW', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

export function formatChange(change: number | null): string {
  if (change === null) return '--';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}`;
}

export function formatChangePct(pct: number | null): string {
  if (pct === null) return '--';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatVolume(vol: number | null): string {
  if (vol === null) return '--';
  if (vol >= 10000) return `${(vol / 1000).toFixed(0)}K張`;
  return `${vol.toLocaleString('zh-TW')}張`;
}

export function formatMarketCap(cap: number | null): string {
  if (cap === null) return '--';
  const yi = cap / 1e8;
  if (yi >= 10000) return `${(yi / 10000).toFixed(0)}兆`;
  return `${yi.toFixed(0)}億`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}
