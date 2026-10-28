/** The shuffle's gather and riffle (M9), a lazy chunk loaded by gather() in context.tsx. */
import { markGather } from "./context";
import { motionLevel } from "./motion3d";


/**
 * Shuffle phases 1 and 2 (M9) for the table cards inside `container`: gather to the deck face down (220 ms,
 * stagger 8 ms), then a quick riffle (alternate cards 28px out and back, rotZ 8 deg, 140 ms). Resolves when done;
 * the caller then swaps the items and the new cards deal in (quick timings), so a sort or filter change reads
 * again in about a second (QA: 1.3 s of empty slabs). Calm and lite resolve at once (the swap fades or rises).
 */
export async function gatherCards(container: HTMLElement, deck: HTMLElement | null): Promise<void> {
  if (typeof window === "undefined" || motionLevel() !== "full") return;
  const scenes = [...container.querySelectorAll<HTMLElement>('.mdx-card3d[data-depth="table"]')].filter((s) => s.isConnected);
  if (!scenes.length) return;
  markGather();
  // Face down shows the flight back (a CSS back on each card while it is "dealing", card3d.css): no React work.
  const d = deck?.getBoundingClientRect() ?? container.getBoundingClientRect();
  const dx0 = d.left + d.width / 2;
  const dy0 = deck ? d.top + d.height / 2 : d.top;
  deck?.setAttribute("data-active", "");
  const items = scenes.slice(0, 24).map((s, i) => {
    const r = s.getBoundingClientRect();
    const enter = s.querySelector<HTMLElement>(":scope > .mdx-card3d__enter");
    const scale = Math.min(1, 44 / Math.max(1, r.width)) * 1.25;
    return {
      s,
      enter,
      i,
      dx: dx0 - (r.left + r.width / 2),
      dy: dy0 - (r.top + r.height / 2),
      rz: (Math.random() - 0.5) * 16,
      scale: Math.max(0.25, Math.min(0.8, scale)),
    };
  });
  const gatherAnims: Animation[] = [];
  for (const it of items) {
    if (!it.enter) continue;
    it.s.dataset.state = `${it.s.dataset.state ?? ""} dealing`.trim();
    const to = `translate3d(${it.dx.toFixed(1)}px, ${it.dy.toFixed(1)}px, ${it.i * 2}px) rotateZ(${it.rz.toFixed(1)}deg) rotateY(180deg) scale(${it.scale.toFixed(3)})`;
    gatherAnims.push(
      it.enter.animate([{ transform: "none" }, { transform: to }], {
        duration: 220,
        delay: Math.min(it.i, 16) * 8,
        easing: "cubic-bezier(.5, 0, .75, 0)",
        fill: "forwards",
      }),
    );
    const g = it.s.querySelector<HTMLElement>(":scope > .mdx-card3d__ground");
    g?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, delay: Math.min(it.i, 16) * 8, fill: "forwards" });
  }
  await Promise.all(gatherAnims.map((a) => a.finished.catch(() => undefined)));
  const riffle = items.map((it) => {
    if (!it.enter) return Promise.resolve();
    const side = it.i % 2 ? 1 : -1;
    const base = `translate3d(${it.dx.toFixed(1)}px, ${it.dy.toFixed(1)}px, ${it.i * 2}px) rotateZ(${it.rz.toFixed(1)}deg) rotateY(180deg) scale(${it.scale.toFixed(3)})`;
    return it.enter
      .animate(
        [
          { transform: base },
          { transform: `translate3d(${(it.dx + side * 28).toFixed(1)}px, ${it.dy.toFixed(1)}px, ${it.i * 2}px) rotateZ(${(it.rz + side * 8).toFixed(1)}deg) rotateY(180deg) scale(${it.scale.toFixed(3)})` },
          { transform: base },
        ],
        { duration: 140, easing: "cubic-bezier(.45, 0, .25, 1)", fill: "forwards" },
      )
      .finished.catch(() => undefined);
  });
  await Promise.all(riffle);
  // The caller swaps the items now (the grid remounts and deals from the deck). If nothing took the cards' place,
  // hand them back and put the deck away.
  window.setTimeout(() => {
    if (deck && !deck.hasAttribute("data-flying")) deck.removeAttribute("data-active");
    for (const it of items) {
      if (!it.s.isConnected) continue;
      for (const a of it.s.getAnimations({ subtree: true })) a.cancel();
      it.s.dataset.state = (it.s.dataset.state ?? "").replace(/\bdealing\b/, "").replace(/\s+/g, " ").trim();
      if (!it.s.dataset.state) delete it.s.dataset.state;
    }
  }, 2500);
}
