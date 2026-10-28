import { useRef, useState, type ReactNode } from "react";

/** Explicit document/flow pages keep every item reachable without a scroll container. */
export function ViewportPages({ pages, label = "Pages", onPageChange }: { pages: ReactNode[]; label?: string; onPageChange?: (page: number) => void }) {
  const [page, setPage] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const current = Math.min(page, Math.max(0,pages.length - 1));
  const go = (next: number) => { setPage(next); onPageChange?.(next); requestAnimationFrame(() => bodyRef.current?.focus({ preventScroll: true })); };
  return <div className="cdx-viewport-pages">
    <div ref={bodyRef} tabIndex={-1} role="region" aria-label={`${label}, page ${current + 1}`} className="cdx-viewport-pages__body" key={current}>{pages[current]}</div>
    {pages.length > 1 ? <nav className="cdx-live-review-nav" aria-label={label}><button type="button" className="mdx-btn mdx-btn--outline" disabled={current === 0} onClick={() => go(current - 1)}>Previous</button><span aria-live="polite">{current + 1} / {pages.length}</span><button type="button" className="mdx-btn mdx-btn--primary" disabled={current === pages.length - 1} onClick={() => go(current + 1)}>Next</button></nav> : null}
  </div>;
}
