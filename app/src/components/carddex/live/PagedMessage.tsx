import { useEffect, useRef, useState } from "react";

/** Long provider messages remain readable in the viewport without hiding their contents. */
export function PagedMessage({ text, alert = false }: { text: string; alert?: boolean }) {
  const [page, setPage] = useState(0);
  const message = useRef<HTMLParagraphElement>(null);
  const go = (next: number) => { setPage(next); requestAnimationFrame(() => message.current?.focus({ preventScroll: true })); };
  const pages: string[] = [];
  let remaining = text;
  while (remaining.length > 180) {
    const space = remaining.lastIndexOf(" ", 180);
    const cut = space > 100 ? space + 1 : 180;
    pages.push(remaining.slice(0, cut)); remaining = remaining.slice(cut);
  }
  pages.push(remaining);
  useEffect(() => setPage(0), [text]);
  const current = Math.min(page, pages.length - 1);
  return <div className="cdx-paged-message">
    <p ref={message} tabIndex={-1} role={alert ? "alert" : "status"} className={alert ? "cdx-live-error" : undefined}>{pages[current]}</p>
    {pages.length > 1 ? <nav aria-label="Message pages"><button type="button" disabled={current === 0} onClick={() => go(current - 1)}>Previous</button><span>{current + 1} / {pages.length}</span><button type="button" disabled={current === pages.length - 1} onClick={() => go(current + 1)}>Next</button></nav> : null}
  </div>;
}
