import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StockData } from '../types/stock';
import { computePeBreakdown } from '../utils/formatPe';

interface Props {
  stock: StockData;
}

/**
 * Small "?" next to 本益比. On hover, a tooltip reveals the calculation.
 *
 * Rendered via a portal to document.body so clipping containers like the
 * detail modal (overflow-y-auto) and stock card (overflow hidden) can't
 * chop the tooltip off at their edges. Position is computed from the "?"
 * icon's bounding rect and flipped to avoid the viewport edges.
 */
export default function PeTooltip({ stock }: Props) {
  const bd = computePeBreakdown(stock);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;
    const r = trigger.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer below the icon, aligned so the tooltip's right edge is near the icon
    let top = r.bottom + 6;
    let left = r.right - tw;

    // If it would overflow right, clamp to viewport (with margin)
    if (left + tw > vw - 8) left = vw - tw - 8;
    // If it would overflow left, shift right
    if (left < 8) left = 8;
    // If it would overflow bottom, place above the icon instead
    if (top + th > vh - 8) top = r.top - th - 6;
    // If still overflows top (very small viewport), pin to top
    if (top < 8) top = 8;

    setPos({ top, left });
  }, [open]);

  const text = formatTooltip(stock, bd);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => e.stopPropagation()}
        className="cursor-help select-none text-[10px] leading-none w-[14px] h-[14px]
                   inline-flex items-center justify-center rounded-full
                   border border-border-c text-text-t align-top ml-0.5
                   hover:text-accent hover:border-accent transition-colors"
        aria-label="本益比算式"
      >
        ?
      </span>
      {open && createPortal(
        <div
          ref={tooltipRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-[9999] min-w-[260px] max-w-[360px] p-2.5
                     rounded-md border border-border-c bg-dash-bg shadow-xl shadow-black/60
                     text-[11px] leading-snug text-text-p font-mono whitespace-pre
                     pointer-events-none"
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}

function formatTooltip(
  stock: StockData,
  bd: ReturnType<typeof computePeBreakdown>,
): string {
  const livePrice = stock.current_price;
  if (!bd) {
    if (livePrice == null) return '無現價資料';
    const lines: string[] = [];
    const yr = new Date().getFullYear();
    if (stock.eps_current_year != null) {
      lines.push(
        `${yr} 預估 EPS: ${stock.eps_current_year.toFixed(2)}`,
        `${yr} 預估 PE: ${(livePrice / stock.eps_current_year).toFixed(2)}x`,
      );
    }
    if (stock.eps_forward != null) {
      lines.push(
        `${yr + 1} 預估 EPS: ${stock.eps_forward.toFixed(2)}`,
        `${yr + 1} 預估 PE: ${(livePrice / stock.eps_forward).toFixed(2)}x`,
      );
    }
    return lines.length ? lines.join('\n') : 'EPS 資料尚未取得';
  }

  const { price, eps, pe, source, parts, partLabels } = bd;
  const srcLabel = source === 'ttm' ? '近四季 EPS (TTM)' : '最新年度 EPS';
  const partsLine =
    source === 'ttm'
      ? `  = ${parts.map((v) => v.toFixed(2)).join(' + ')}\n  = ${eps.toFixed(2)}`
      : `  = ${eps.toFixed(2)}`;
  const quartersNote =
    source === 'ttm'
      ? `\n季別: ${partLabels.join(', ')}`
      : `\n資料來源: ${partLabels[0]}`;

  const currentYear = new Date().getFullYear();
  const forecastLines: string[] = [];
  if (stock.eps_current_year != null && price > 0) {
    const fwdPe = price / stock.eps_current_year;
    forecastLines.push(
      `\n── 分析師預估 ──`,
      `${currentYear} 預估 EPS: ${stock.eps_current_year.toFixed(2)}`,
      `${currentYear} 預估 PE: ${price.toFixed(2)} / ${stock.eps_current_year.toFixed(2)} ≈ ${fwdPe.toFixed(2)}x`,
    );
  }
  if (stock.eps_forward != null && price > 0) {
    const nextPe = price / stock.eps_forward;
    forecastLines.push(
      `${currentYear + 1} 預估 EPS: ${stock.eps_forward.toFixed(2)}`,
      `${currentYear + 1} 預估 PE: ${price.toFixed(2)} / ${stock.eps_forward.toFixed(2)} ≈ ${nextPe.toFixed(2)}x`,
    );
  }

  return (
    `本益比 = 現價 / ${srcLabel}\n` +
    `${srcLabel}:\n` +
    `${partsLine}\n` +
    `= ${price.toFixed(2)} / ${eps.toFixed(2)}\n` +
    `≈ ${pe.toFixed(2)}x` +
    quartersNote +
    forecastLines.join('\n')
  );
}
