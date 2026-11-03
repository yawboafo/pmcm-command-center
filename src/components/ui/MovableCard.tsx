"use client";

import { GripHorizontal, LayoutGrid, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent } from "react";
import { CARDS, cardKey, clampPlacement, useCardLayout, type CardAreaId } from "./cardLayout";
import { cx } from "./primitives";

const AREA_SELECTOR = "[data-card-area]";
const NUDGE = 16;

/** Phones keep their fixed layout: there is no room to arrange cards and fingers need the map. */
function useWide() {
  return useSyncExternalStore(
    (on) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

function measure(el: HTMLElement) {
  const area = el.closest<HTMLElement>(AREA_SELECTOR);
  if (!area) return null;
  const a = area.getBoundingClientRect();
  const c = el.getBoundingClientRect();
  return { area: a, card: c, x: c.left - a.left, y: c.top - a.top };
}

type Props = HTMLAttributes<HTMLDivElement> & {
  area: CardAreaId;
  id: string;
  title: string;
  /** False for a card that has its own close control. */
  hideable?: boolean;
  /** True for a card that starts in the page flow and floats once it is moved. */
  flow?: boolean;
};

/**
 * A card that can be dragged by its handle, moved with the arrow keys and hidden. It must sit inside
 * a positioned `data-card-area` with no positioned element in between. Double-click the handle to
 * put it back.
 */
export function MovableCard({ area, id, title, hideable = true, flow = false, className, style, children, ...rest }: Props) {
  const key = cardKey(area, id);
  const state = useCardLayout((s) => s.cards[key]);
  const wide = useWide();
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; w: number; moved: boolean } | null>(null);
  const place = wide ? state?.place : undefined;
  const placed = !!place;

  // Windows shrink and saved layouts come from bigger screens: keep placed cards reachable.
  useEffect(() => {
    const node = el.current;
    const parent = node?.closest(AREA_SELECTOR);
    if (!placed || !node || !parent) return;
    const fit = () => {
      const m = measure(node);
      const current = useCardLayout.getState().cards[key]?.place;
      if (!m || !current || !m.area.width) return;
      const next = clampPlacement(current, m.card, m.area);
      if (next.x !== current.x || next.y !== current.y) useCardLayout.getState().place(key, { ...current, ...next });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [placed, key]);

  if (!wide) {
    return (
      <div className={className} style={style} {...rest}>
        {children}
      </div>
    );
  }
  if (state?.hidden) return null;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const m = el.current && measure(el.current);
    if (!m) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    useCardLayout.getState().raise(key);
    drag.current = { px: e.clientX, py: e.clientY, x: m.x, y: m.y, w: m.card.width, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const m = el.current && measure(el.current);
    if (!d || !m) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    useCardLayout.getState().place(key, { ...clampPlacement({ x: d.x + dx, y: d.y + dy }, m.card, m.area), w: d.w });
  };
  const onPointerUp = () => {
    if (drag.current?.moved) useCardLayout.getState().save();
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const m = el.current && measure(el.current);
    if (!step || !m) return;
    e.preventDefault();
    const by = e.shiftKey ? NUDGE * 3 : NUDGE;
    const store = useCardLayout.getState();
    store.place(key, { ...clampPlacement({ x: m.x + step[0] * by, y: m.y + step[1] * by }, m.card, m.area), w: m.card.width });
    store.save();
  };

  const placedStyle: CSSProperties = place
    ? { position: "absolute", left: place.x, top: place.y, right: "auto", bottom: "auto", width: place.w, maxWidth: "none", zIndex: 20 + (state?.z ?? 0), ...(flow ? { maxHeight: "calc(100% - 24px)", overflowY: "auto" } : {}) }
    : {};

  return (
    <div ref={el} className={cx("group/card", flow && !place && "relative", flow && place && "cam-panel p-3 shadow-2xl", className)} style={{ ...style, ...placedStyle }} {...rest}>
      <div
        className={cx(
          "absolute z-10 flex items-center overflow-hidden rounded-full border border-white/15 bg-[var(--surface)] text-white/60 shadow-md transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100",
          flow ? "right-1 top-1 opacity-0" : "left-1/2 -top-2.5 -translate-x-1/2 opacity-60",
        )}
      >
        <button
          type="button"
          aria-label={`Move ${title}. Use the arrow keys, or double-click to put it back.`}
          title="Drag to move · double-click to put back"
          className="flex h-5 w-8 cursor-grab touch-none items-center justify-center hover:text-white active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => useCardLayout.getState().resetCard(key)}
          onKeyDown={onKeyDown}
        >
          <GripHorizontal size={13} />
        </button>
        {hideable && (
          <button type="button" aria-label={`Hide ${title}`} title="Hide card" className="flex h-5 w-5 items-center justify-center border-l border-white/10 hover:text-white" onClick={() => useCardLayout.getState().setHidden(key, true)}>
            <X size={11} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Show or hide each card in an area, and put them all back. */
export function CardsMenu({ area, className }: { area: CardAreaId; className?: string }) {
  const cards = useCardLayout((s) => s.cards);
  const wide = useWide();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const open = !!anchor;

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setAnchor(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!wide) return null;
  const list = CARDS[area];
  const hiddenCount = list.filter((c) => cards[cardKey(area, c.id)]?.hidden).length;
  const changed = list.some((c) => cards[cardKey(area, c.id)]?.hidden || cards[cardKey(area, c.id)]?.place);
  const store = useCardLayout.getState();
  const WIDTH = 224;

  return (
    <div ref={root} className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => setAnchor(open ? null : e.currentTarget.getBoundingClientRect())}
        className="glass flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-medium text-white/75 hover:text-white"
      >
        <LayoutGrid size={13} /> Cards
        {hiddenCount > 0 && <span className="text-white/45">· {hiddenCount} hidden</span>}
      </button>
      {anchor && (
        <div
          role="group"
          aria-label="Cards"
          className="glass animate-fade-in fixed z-50 rounded-xl !bg-[var(--surface)] p-1.5 text-white"
          style={{
            width: WIDTH,
            left: Math.max(8, Math.min(anchor.left + anchor.width / 2 - WIDTH / 2, window.innerWidth - WIDTH - 8)),
            ...(anchor.top > window.innerHeight / 2 ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }),
          }}
        >
          {list.map((c) => {
            const key = cardKey(area, c.id);
            return (
              <label key={c.id} className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[12px] hover:bg-white/5">
                <input type="checkbox" checked={!cards[key]?.hidden} onChange={(e) => store.setHidden(key, !e.target.checked)} />
                {c.title}
              </label>
            );
          })}
          <button type="button" disabled={!changed} onClick={() => store.resetArea(area)} className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg border-t border-white/5 px-2 text-[12px] text-white/70 hover:bg-white/5 disabled:opacity-40">
            <RotateCcw size={12} /> Reset layout
          </button>
          <p className="px-2 pb-1 pt-1 text-[10.5px] leading-snug text-white/40">Drag a card by its handle to move it.</p>
        </div>
      )}
    </div>
  );
}
