import { useRef } from 'react';
import { Rnd } from 'react-rnd';
import { usePanelLayout, type PanelId, type PanelMode } from '../hooks/usePanelLayout';

interface Props {
  id: PanelId;
  title: string;
  icon?: string;
  children: React.ReactNode;
  minWidth?: number;
  minHeight?: number;
}

/**
 * Universal panel — renders in one of three modes based on its state:
 *   - 'floating': free drag + resize overlay (react-rnd)
 *   - 'left' / 'right': docked flex child with horizontal resize handle
 *
 * Header has:
 *   ⋮⋮ drag handle (for floating mode)
 *   ⇱ / ⇲ / ⊕ mode toggles (dock-left / dock-right / float)
 *   ✕ hide
 *
 * Position/size/mode/visibility all persisted via usePanelLayout.
 */
export function Panel({ id, title, icon, children, minWidth = 280, minHeight = 240 }: Props) {
  const { state, update, setVisible, setMode } = usePanelLayout(id);

  if (!state.visible) return null;

  // Docked modes — render as a plain flex child; width resizable from the inner edge
  if (state.mode === 'left' || state.mode === 'right') {
    return (
      <DockedPanel
        id={id}
        title={title}
        icon={icon}
        side={state.mode}
        width={state.width}
        minWidth={minWidth}
        onResize={(w) => update({ width: w })}
        onModeChange={setMode}
        onClose={() => setVisible(false)}
      >
        {children}
      </DockedPanel>
    );
  }

  // Floating mode — react-rnd
  return (
    <Rnd
      className="z-40"
      bounds="parent"
      size={{ width: state.width, height: state.height }}
      position={{ x: state.x, y: state.y }}
      minWidth={minWidth}
      minHeight={minHeight}
      dragHandleClassName="panel-drag-handle"
      cancel=".panel-no-drag"
      onDragStop={(_e, d) => update({ x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        update({ width: ref.offsetWidth, height: ref.offsetHeight, x: pos.x, y: pos.y })
      }
      style={{ position: 'absolute' }}
    >
      <div className="h-full w-full bg-card-bg border border-border-c rounded-lg shadow-2xl shadow-black/60
                      flex flex-col overflow-hidden">
        <PanelHeader
          title={title}
          icon={icon}
          mode="floating"
          onModeChange={setMode}
          onClose={() => setVisible(false)}
          draggable
        />
        <div className="panel-no-drag flex-1 min-h-0 overflow-hidden">
          {children}
        </div>
      </div>
    </Rnd>
  );
}

/* ── Docked flex-child panel ─────────────────────────────────────────────── */

interface DockedPanelProps {
  id: PanelId;
  title: string;
  icon?: string;
  side: 'left' | 'right';
  width: number;
  minWidth: number;
  onResize: (w: number) => void;
  onModeChange: (m: PanelMode) => void;
  onClose: () => void;
  children: React.ReactNode;
}

function DockedPanel({
  title, icon, side, width, minWidth, onResize, onModeChange, onClose, children,
}: DockedPanelProps) {
  // Width live preview during drag
  const liveRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const maxW = Math.min(900, window.innerWidth - 300);
    const move = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newW = side === 'left' ? startW + delta : startW - delta;
      const clamped = Math.max(minWidth, Math.min(maxW, newW));
      if (liveRef.current) liveRef.current.style.width = `${clamped}px`;
      widthRef.current = clamped;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onResize(widthRef.current);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      ref={liveRef}
      className={`flex-shrink-0 h-full bg-card-bg ${
        side === 'left' ? 'border-r' : 'border-l'
      } border-border-c flex flex-col overflow-hidden relative`}
      style={{ width }}
    >
      <PanelHeader
        title={title}
        icon={icon}
        mode={side}
        onModeChange={onModeChange}
        onClose={onClose}
        draggable={false}
      />
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      {/* Resize handle on the inner edge */}
      <div
        onMouseDown={startResize}
        className={`absolute top-0 ${side === 'left' ? 'right-0' : 'left-0'}
                    h-full w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors z-10`}
        title="拖曳調整寬度"
      />
    </div>
  );
}

/* ── Shared header with mode toggles ─────────────────────────────────────── */

function PanelHeader({
  title, icon, mode, onModeChange, onClose, draggable,
}: {
  title: string;
  icon?: string;
  mode: PanelMode;
  onModeChange: (m: PanelMode) => void;
  onClose: () => void;
  draggable: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 border-b border-border-c
                  bg-dash-bg/80 select-none flex-shrink-0
                  ${draggable ? 'panel-drag-handle cursor-move' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-sm text-text-p min-w-0">
        {draggable && <span className="text-text-t text-xs">⋮⋮</span>}
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="font-semibold truncate">{title}</span>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 panel-no-drag">
        <ModeBtn title="靠左停靠" active={mode === 'left'}  onClick={() => onModeChange('left')}>⇤</ModeBtn>
        <ModeBtn title="浮動"     active={mode === 'floating'} onClick={() => onModeChange('floating')}>◇</ModeBtn>
        <ModeBtn title="靠右停靠" active={mode === 'right'} onClick={() => onModeChange('right')}>⇥</ModeBtn>
        <button
          onClick={onClose}
          className="ml-1 text-text-s hover:text-text-p text-sm w-5 h-5 flex items-center justify-center
                     rounded hover:bg-white/10 transition-colors"
          title="隱藏（可從頂部重新開啟）"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, title, children }: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-5 h-5 text-xs rounded flex items-center justify-center transition-colors ${
        active ? 'bg-accent/25 text-accent' : 'text-text-s hover:text-text-p hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

// Back-compat alias
export const FloatingPanel = Panel;
