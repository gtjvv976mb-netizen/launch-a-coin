import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { motionLevel, useMotionLevel } from "../mintdex/card3d/motion3d";

const PANELS = [
  "#content .mdx-plinth",
  "#content .cdx-coin-market",
  "#content .cdx-coin-actions",
  "#content .rounded-panel.bg-plinth",
  "#content .cdx-archive__vitrine",
  "#content .cdx-create-preview",
  "#content .cdx-create-form",
  "#content .cdx-design-row",
  "#content .cdx-token-cell",
  "#content [data-reveal]",
].join(",");
const PRIMARY = ".mdx-btn--primary:not([aria-disabled='true']):not(:disabled)";

/** Silver finishing and viewport entrances; content is fully visible before enhancement. */
export function RoyalMotion() {
  const path = useRouterState({ select: state => state.location.pathname });
  const level = useMotionLevel();
  const router = useRouter();
  const seen = useRef(new WeakSet<Element>());
  const lastPath = useRef(path);
  if (path !== lastPath.current) {
    lastPath.current = path;
    seen.current = new WeakSet();
  }
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const main = document.getElementById("content");
    const running = new Set<Animation>();
    const decorated = new Set<HTMLElement>();
    let reveals: IntersectionObserver | undefined;
    let lights: IntersectionObserver | undefined;
    const enabled = () => !document.hidden && !media.matches && motionLevel() === "full";
    const stop = () => {
      reveals?.disconnect(); reveals = undefined;
      lights?.disconnect(); lights = undefined;
      for (const animation of running) animation.cancel();
      running.clear();
      for (const target of decorated) delete target.dataset.royalLit;
      root.dataset.royalMotion = "off";
    };
    const scan = () => {
      const panels = Array.from(document.querySelectorAll<HTMLElement>(PANELS));
      for (const target of panels) {
        target.dataset.royalPanel = "";
        decorated.add(target);
      }
      if (!enabled() || !("IntersectionObserver" in window)) { stop(); return; }
      root.dataset.royalMotion = "on";
      if (!reveals) reveals = new IntersectionObserver(entries => {
        if (!enabled()) { stop(); return; }
        const visible = entries.filter(entry => entry.isIntersecting && !seen.current.has(entry.target));
        visible.forEach((entry, index) => {
          const target = entry.target as HTMLElement;
          seen.current.add(target);
          reveals?.unobserve(target);
          if (!("animate" in target)) return;
          const animation = target.animate([
            { opacity: 0.65, transform: "translate3d(0,10px,0) scale(.99)" },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
          ], { duration: 450, delay: Math.min(index * 25, 100), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
          running.add(animation);
          void animation.finished.then(() => running.delete(animation), () => running.delete(animation));
        });
      }, { threshold: 0.06, rootMargin: "0px 0px -12px 0px" });
      if (!lights) lights = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          if (entry.isIntersecting && enabled()) target.dataset.royalLit = "";
          else delete target.dataset.royalLit;
        }
      }, { threshold: 0.4 });
      // Nested surfaces share their outer panel's entrance instead of multiplying opacity.
      for (const target of panels) {
        const nested = panels.some(parent => parent !== target && parent.contains(target));
        if (!nested && !seen.current.has(target)) reveals.observe(target);
      }
      document.querySelectorAll<HTMLElement>(PRIMARY).forEach((target, index) => {
        target.style.setProperty("--royal-glint-delay", `${-7 - index % 4 * 0.35}s`);
        decorated.add(target);
        lights?.observe(target);
      });
    };
    scan();
    const offRendered = router.subscribe("onRendered", scan);
    const changes = new MutationObserver(scan);
    if (main) changes.observe(main, { childList: true, subtree: true });
    media.addEventListener("change", scan);
    document.addEventListener("visibilitychange", scan);
    return () => {
      stop(); changes.disconnect(); offRendered();
      media.removeEventListener("change", scan);
      document.removeEventListener("visibilitychange", scan);
      for (const target of decorated) {
        delete target.dataset.royalPanel;
        target.style.removeProperty("--royal-glint-delay");
      }
      delete root.dataset.royalMotion;
    };
  }, [path, level, router]);
  return null;
}
