/**
 * "View in 3D" (owner 2026-10-17: "make each card 3d viewable turntable"). Every card on the site carries a small
 * rotate button (on hover or focus; always shown on touch screens); a mouse hold on the card, or a double click on
 * a card that is not a link, opens it too. The viewer itself (TurntableStage.tsx) is a lazy chunk: the card on a
 * neon turntable, spinning all the way round.
 *
 * This file is the tiny part in the main chunk: the provider (one viewer per page), the button, the host wrapper
 * and the deep link. Opening sets ?view3d=<id> on the URL with history.replaceState (outside the router, so no
 * route's search validation or loader runs and the /coin/<ticker> redirects stay as they are); a page loaded with
 * it opens that card once the page has drawn it. Neighbours: the other cards in the same list ([data-v3d-group],
 * the shelf), or the list the host passes.
 */
import { useRouterState } from "@tanstack/react-router";
import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import type { CardData } from "../MintCard";

/** One card the viewer can show. `coinId` links "View coin" (absent for a design preview with no coin). */
export type View3DItem = {
  id: string;
  card: CardData;
  coinId?: string | null;
  /** Use the coin page's collector case in the full-screen viewer. */
  cased?: boolean;
};

type Entry = { item: View3DItem; el: HTMLElement; list?: View3DItem[] };

export const VIEW3D_PARAM = "view3d";

/** A viewer deep link changes its card, while the surrounding route and collection stay the same. */
function viewerRouteKey(pathname: string, search: string): string {
  const query = new URLSearchParams(search);
  query.delete(VIEW3D_PARAM);
  query.sort();
  const remaining = query.toString();
  return pathname + (remaining ? `?${remaining}` : "");
}

const loadStage = () => import("./TurntableStage");
const TurntableStage = lazy(loadStage);
let prefetched = false;
/** Fetch the viewer's chunk ahead of the first open (hover, focus or touch of a 3D button). */
export function prefetchView3D() {
  if (prefetched) return;
  prefetched = true;
  void loadStage();
}

/** The id a page was loaded with, read before the router can normalize the URL. */
const initialParam =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get(VIEW3D_PARAM)
    : null;

function writeParam(id: string | null) {
  try {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set(VIEW3D_PARAM, id);
    else u.searchParams.delete(VIEW3D_PARAM);
    const next = u.pathname + u.search + u.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, "", next);
    }
  } catch {
    // A sandboxed frame: the viewer still works, only the link is not shareable.
  }
}

type Ctx = {
  open: (id: string, from?: HTMLElement | null) => void;
  register: (e: Entry) => () => void;
};
const View3DCtx = createContext<Ctx | null>(null);

function domOrder(a: Entry, b: Entry) {
  if (a.el === b.el) return 0;
  return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function View3DProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Set<Entry>());
  const [view, setView] = useState<{ items: View3DItem[]; index: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Collection and template changes invalidate the originating card list. Native history replacements can
  // also update the router, so exclude only the viewer's own parameter from this navigation identity.
  const routeLocation = useRouterState({ select: (s) => viewerRouteKey(s.location.pathname, s.location.searchStr) });
  const initialRoute = useRef(routeLocation);
  const initialViewPending = useRef(!!initialParam);

  const listFor = useCallback((id: string, from?: HTMLElement | null) => {
    const all = [...entries.current].filter((e) => e.el.isConnected);
    // The entry this open came from (the button or host), else any entry of this id, else one whose list has it.
    const own =
      (from &&
        all.find(
          (e) => e.item.id === id && (e.el === from || e.el.contains(from) || from.contains(e.el)),
        )) ||
      all.find((e) => e.item.id === id) ||
      all.find((e) => e.list?.some((x) => x.id === id));
    if (!own) return null;
    if (own.list?.length) {
      const index = Math.max(
        0,
        own.list.findIndex((x) => x.id === id),
      );
      return { items: own.list, index };
    }
    const group = own.el.closest("[data-v3d-group]");
    const peers = group ? all.filter((e) => !e.list && group.contains(e.el)).sort(domOrder) : [own];
    const items: View3DItem[] = [];
    const seen = new Set<string>();
    for (const e of peers) {
      if (seen.has(e.item.id)) continue;
      seen.add(e.item.id);
      items.push(e.item);
    }
    const index = Math.max(
      0,
      items.findIndex((x) => x.id === id),
    );
    return { items, index };
  }, []);

  const open = useCallback(
    (id: string, from?: HTMLElement | null) => {
      const v = listFor(id, from);
      if (!v) return;
      const a =
        from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      opener.current = a && a !== document.body ? a : null;
      setView(v);
      writeParam(v.items[v.index].id);
    },
    [listFor],
  );

  const close = useCallback(() => {
    setView(null);
    writeParam(null);
  }, []);

  const register = useCallback((e: Entry) => {
    entries.current.add(e);
    return () => {
      entries.current.delete(e);
    };
  }, []);

  // A page loaded with ?view3d=<id>: open that card once the page has drawn it (at most 8 s), then never again.
  useEffect(() => {
    if (!initialParam || !initialViewPending.current || routeLocation !== initialRoute.current) return;
    let tries = 0;
    const t = window.setInterval(() => {
      tries++;
      const v = listFor(initialParam);
      if (v) {
        window.clearInterval(t);
        initialViewPending.current = false;
        opener.current = null;
        setView(v);
      } else if (tries > 32) {
        window.clearInterval(t);
        initialViewPending.current = false;
        writeParam(null);
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [listFor, routeLocation]);

  // A navigation closes the viewer (its "View coin" link included).
  const previousRoute = useRef(routeLocation);
  useEffect(() => {
    if (routeLocation === previousRoute.current) return;
    previousRoute.current = routeLocation;
    initialViewPending.current = false;
    setView(null);
  }, [routeLocation]);

  const value = useMemo(() => ({ open, register }), [open, register]);
  const step = (index: number) => {
    setView((v) => {
      if (!v || !v.items.length) return v;
      const i = (index + v.items.length) % v.items.length;
      writeParam(v.items[i].id);
      return { ...v, index: i };
    });
  };
  const returnFocus = () => {
    const el = opener.current;
    opener.current = null;
    // The card's own 3D button (or the card) gets focus back; if the list redrew, its new button of the same id.
    const id = view?.items[view.index]?.id;
    const target = el?.isConnected
      ? el
      : ([...entries.current].find((e) => e.item.id === id && e.el.isConnected)?.el ?? null);
    if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  };

  return (
    <View3DCtx.Provider value={value}>
      {children}
      {view ? (
        <Suspense fallback={null}>
          <TurntableStage
            items={view.items}
            index={view.index}
            onStep={step}
            onClose={close}
            onCloseFocus={returnFocus}
          />
        </Suspense>
      ) : null}
    </View3DCtx.Provider>
  );
}

export function useView3D() {
  return useContext(View3DCtx);
}

/** The rotate-360 glyph. */
export function Rotate3DIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5.2c4.8 0 8.6 1.9 8.6 4.3 0 1.6-1.7 3-4.3 3.7" />
      <path d="M12 13.8c-4.8 0-8.6-1.9-8.6-4.3 0-1.4 1.3-2.6 3.3-3.4" />
      <path d="M9.6 11.6l2.4 2.2-2.4 2.2" />
      <rect x="9.3" y="2.6" width="5.4" height="7.6" rx="1" />
    </svg>
  );
}

/** The small "View in 3D" button. It registers its card, so the viewer can find it, its list and the deep link. */
export function View3DButton({
  item,
  list,
  className = "",
}: {
  item: View3DItem;
  list?: View3DItem[];
  className?: string;
}) {
  const ctx = useView3D();
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef({ item, list });
  latest.current = { item, list };
  const id = item.id;
  useEffect(() => {
    const el = ref.current;
    if (!ctx || !el) return;
    const e: Entry = {
      get item() {
        return latest.current.item;
      },
      get list() {
        return latest.current.list;
      },
      el,
    };
    return ctx.register(e);
  }, [ctx, id]);
  if (!ctx) return null;
  return (
    <button
      ref={ref}
      type="button"
      className={`mdx-v3dbtn ${className}`}
      aria-label={`View ${item.card.name} in 3D`}
      aria-haspopup="dialog"
      title="View in 3D"
      data-v3d-btn={id}
      onPointerEnter={prefetchView3D}
      onFocus={prefetchView3D}
      onTouchStart={prefetchView3D}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.open(id, e.currentTarget);
      }}
    >
      <Rotate3DIcon />
    </button>
  );
}

const LONG_PRESS_MS = 520;

/**
 * A card with its 3D button over the card's top right corner. A mouse hold on the card opens the viewer
 * (the click that follows is swallowed, so a card inside a link does not navigate); so does a double click on a
 * card that is not a link (a link's first click already opened the coin). Touch belongs to inline rotation.
 */
export function View3DHost({
  item,
  list,
  className = "",
  btnClassName = "",
  style,
  children,
}: {
  item: View3DItem;
  list?: View3DItem[];
  className?: string;
  btnClassName?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  useView3DGestures(host, item.id);
  return (
    <div ref={host} className={`mdx-v3d-host ${className}`} style={style}>
      {children}
      <View3DButton item={item} list={list} className={btnClassName} />
    </div>
  );
}

/**
 * The gestures that open the viewer on a card: a long press (mouse or touch; the click or context menu that
 * follows is swallowed) and a double click outside links. `host` holds the card and its View3DButton.
 */
export function useView3DGestures(host: RefObject<HTMLElement | null>, id: string) {
  const ctx = useView3D();
  useEffect(() => {
    const el = host.current;
    if (!el || !ctx) return;
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let firedAt = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
      start = null;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0 || (e.target as Element).closest?.(".mdx-v3dbtn")) return;
      start = { x: e.clientX, y: e.clientY };
      clearTimeout(timer);
      timer = window.setTimeout(fire, LONG_PRESS_MS);
    };
    const fire = () => {
      clearTimeout(timer);
      timer = 0;
      start = null;
      firedAt = performance.now();
      prefetchView3D();
      const btn = el.querySelector<HTMLElement>(".mdx-v3dbtn");
      ctx.open(id, btn ?? el);
    };
    // A mouse context menu during a hold can open the optional viewer; touch remains an inline gesture.
    const menu = (e: Event) => {
      if (timer) fire();
      swallow(e);
    };
    const move = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    };
    const swallow = (e: Event) => {
      if (firedAt > 0 && performance.now() - firedAt < 900) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const dbl = (e: MouseEvent) => {
      if ((e.target as Element).closest?.("a, .mdx-v3dbtn")) return;
      const btn = el.querySelector<HTMLElement>(".mdx-v3dbtn");
      ctx.open(id, btn ?? el);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("click", swallow, { capture: true });
    el.addEventListener("contextmenu", menu, { capture: true });
    el.addEventListener("dblclick", dbl);
    return () => {
      cancel();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", cancel);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("pointerleave", cancel);
      el.removeEventListener("click", swallow, { capture: true });
      el.removeEventListener("contextmenu", menu, { capture: true });
      el.removeEventListener("dblclick", dbl);
    };
  }, [ctx, id, host]);
}
