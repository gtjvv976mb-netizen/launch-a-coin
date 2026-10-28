import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pager } from "../mintdex/ui";

/** Page capacity follows the available pane, including text zoom and keyboard resizing. */
export function usePageCapacity({ rowHeight = 300, minWidth = 190, maxColumns = 4, maxRows = 3 } = {}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const ref = setElement;
  const [capacity, setCapacity] = useState({ count: 1, columns: 1, rows: 1 });
  useEffect(() => {
    const el = element;
    if (!el) return;
    const update = () => {
      const scale = Math.max(1, parseFloat(getComputedStyle(el).fontSize) / 16);
      const columns = Math.max(1, Math.min(maxColumns, Math.floor((el.clientWidth + 12) / (minWidth * scale + 12))));
      const rows = Math.max(1, Math.min(maxRows, Math.floor((el.clientHeight + 12) / (rowHeight * scale + 12))));
      const count = columns * rows;
      setCapacity(old => old.count === count && old.columns === columns ? old : { count, columns, rows });
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [element, rowHeight, minWidth, maxColumns, maxRows]);
  return { ref, ...capacity };
}

export function PageControls({ page, pages, onPage, label }: { page: number; pages: number; onPage: (page: number) => void; label?: ReactNode }) {
  return <div className="cdx-page-controls"><span className="cdx-page-controls__label">{label}</span><Pager page={page} pages={pages} onPage={onPage} /></div>;
}

/** Long prose is split into readable, measured pages; no hidden remainder or tiny type. */
export function PagedText({ text, label = "Description" }: { text: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [chunks, setChunks] = useState([text]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      const style = getComputedStyle(el);
      const probe = document.createElement("p");
      Object.assign(probe.style, {
        position:"absolute", visibility:"hidden", pointerEvents:"none", margin:"0", padding:"0",
        width:`${el.clientWidth}px`, font:style.font, lineHeight:style.lineHeight,
        letterSpacing:style.letterSpacing, overflowWrap:"anywhere", whiteSpace:"normal",
      });
      el.appendChild(probe);
      const next: string[] = [];
      let rest = text.trim();
      while (rest.length) {
        let low = 1, high = rest.length, fit = 1;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          probe.textContent = rest.slice(0,mid);
          if (probe.getBoundingClientRect().height <= el.clientHeight - 2) { fit=mid; low=mid+1; }
          else high=mid-1;
        }
        if (fit < rest.length) {
          const boundary = rest.lastIndexOf(" ",fit);
          if (boundary > fit * .6) fit=boundary;
        }
        next.push(rest.slice(0,fit).trim());
        rest=rest.slice(fit).trimStart();
      }
      probe.remove();
      setChunks(next.length ? next : [""]);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [text]);
  const pages = chunks.length;
  const page = Math.min(index,pages-1);
  useEffect(() => setIndex(0), [text]);
  return <div className="cdx-paged-copy"><div ref={ref} className="cdx-paged-copy__text" aria-label={label}><p>{chunks[page]}</p></div><PageControls page={page} pages={pages} onPage={setIndex} label={label} /></div>;
}
