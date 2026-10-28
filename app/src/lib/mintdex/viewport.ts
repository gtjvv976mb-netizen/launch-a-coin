/**
 * The right card grid on first paint (backlog P1-20). The client keeps a small first-party cookie with its
 * viewport ("1440x900", no other data), and the root loader reads it on the server and on the client alike, so
 * a fitted view (Discover, Market) can lay out its server HTML for this screen instead of the 1280x720 fallback
 * and does not re-lay out after hydration. Without the cookie (a first visit) a phone is still recognized from
 * the request (the Sec-CH-UA-Mobile client hint Chromium sends by default, else the user agent) and gets a
 * typical phone size, so its first server HTML is the phone layout and every card frame and art copy is picked
 * once, for the phone (QA: a first phone visit used to fetch the desktop copies, then the phone ones after
 * hydration). Anything else keeps the fallback. The value travels with the dehydrated loader data, so the
 * hydrating client sees the same guess. Nothing is hidden while waiting on JS (decision C8): the measured size
 * still wins once it is known.
 */
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

export const VIEWPORT_COOKIE = "mdx_vp";

export type Viewport = { w: number; h: number };

/** "1440x900" to { w, h }; anything odd is ignored. */
export function parseViewport(raw: string | undefined | null): Viewport | null {
  const m = raw?.match(/^(\d{3,4})x(\d{3,4})$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w >= 240 && w <= 8000 && h >= 240 && h <= 8000 ? { w, h } : null;
}

/** What a first phone visit is laid out for until it is measured: a common phone viewport. */
export const PHONE_GUESS: Viewport = { w: 390, h: 844 };

const PHONE_UA = /iPhone|iPod|Android.+Mobile|Mobile.+Firefox|Windows Phone|Opera Mini|IEMobile/i;

/**
 * A first visit, no cookie yet: is this a phone? Chromium says so itself (Sec-CH-UA-Mobile, sent on every
 * request without opting in); Safari and Firefox say it in the user agent. Tablets and desktops: null.
 */
export function guessViewport(mobileHint: string | undefined, userAgent: string | undefined): Viewport | null {
  if (mobileHint === "?1") return PHONE_GUESS;
  if (mobileHint === "?0") return null;
  return userAgent && PHONE_UA.test(userAgent) ? PHONE_GUESS : null;
}

/**
 * The viewport cookie: request cookies on the server (or, on a first visit, the phone guess from the request
 * headers), document.cookie on the client.
 */
export const readViewport = createIsomorphicFn()
  .server((): Viewport | null => {
    try {
      return (
        parseViewport(getCookie(VIEWPORT_COOKIE)) ??
        guessViewport(getRequestHeader("sec-ch-ua-mobile"), getRequestHeader("user-agent"))
      );
    } catch {
      return null;
    }
  })
  .client((): Viewport | null => {
    const m = document.cookie.match(/(?:^|;\s*)mdx_vp=([^;]*)/);
    return parseViewport(m?.[1]);
  });

/** Write the cookie for the next server render (a year, this site only, no tracking value). */
export function writeViewport() {
  if (typeof window === "undefined") return;
  const value = `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`;
  if (!parseViewport(value)) return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  try {
    document.cookie = `${VIEWPORT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
  } catch {
    // Cookies blocked: the views keep their fallback size until measured.
  }
}

/*
 * The shell geometry the estimates mirror (AppShell and the routes): a 224px rail from 1024 up; main padding
 * 24px, 16px on short screens (820 tall or less) and phones; a 56px header row; the PageFrame gap 24px (short
 * 16px); asides 300px (1024 to 1279), 340px (1280 up), 360px (1440 up), less the main padding they bleed into,
 * with a 20px column gap.
 */
const RAIL = 224;
const HEADER = 56;

function desktopMain(vp: Viewport) {
  const short = vp.h <= 820;
  const pad = short ? 16 : 24;
  return { w: vp.w - RAIL - 2 * pad, h: vp.h - 2 * pad, gap: short ? 16 : 24, pad };
}

/** Discover's shelf body: the whole content width under the header row. Phones: the 16px gutters. */
export function discoverBody(vp: Viewport | null) {
  if (!vp) return null;
  if (vp.w < 1024) return { width: Math.max(200, vp.w - 32), height: 800 };
  const m = desktopMain(vp);
  return { width: Math.max(200, m.w), height: Math.max(200, m.h - HEADER - m.gap) };
}

/**
 * Discover's card grid (.cdx-token-grid) and Home's Trending list (.cdx-home-pulse-list) from 1024 up, measured
 * at 1024x768, 1280x720 and 1440x900. Smaller screens keep the one-card fallback until measured.
 */
export function discoverGrid(vp: Viewport | null) {
  return vp && vp.w >= 1024 ? { width: vp.w - 200, height: vp.h - 213 } : null;
}
export function homePulseList(vp: Viewport | null) {
  return vp && vp.w >= 1024 ? { width: 200, height: vp.h - 191 } : null;
}

/** Market's shelf body: the content width less the aside and the column gap, under the header row. */
export function marketBody(vp: Viewport | null) {
  if (!vp) return null;
  if (vp.w < 1024) return { width: Math.max(200, vp.w - 32), height: 616 };
  const m = desktopMain(vp);
  const aside = vp.w >= 1440 ? 360 : vp.w >= 1280 ? 340 : 300;
  return {
    width: Math.max(200, m.w - (aside - m.pad) - 20),
    height: Math.max(200, m.h - HEADER - m.gap),
  };
}
