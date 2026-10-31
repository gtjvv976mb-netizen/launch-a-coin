import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { getCardDesign } from "../../lib/carddex/designs";
import { designsForPair, getPairAsset } from "../../lib/carddex/pairs";
import { Icon } from "../mintdex/ui";
import { gridStep } from "./pair-groups";

/** A layout effect in the browser (measured before paint), a plain one on the server (where neither runs). */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A design's small card-front picture (tools/carddex/make_design_thumbs.py writes one for each of SOL's options). */
export const designThumb = (key: string) => `/assets/carddex/thumbs/${key}-front-128.webp`;

/**
 * Launch's card design chooser, under the pair HUD while the picked pair offers more than one design (SOL alone: its
 * own card, its main design, first, then the designs no other pair uses). One radio group of small card fronts, each
 * with its name: arrow keys, Home and End move and select, and the preview card shows the choice at once. From 1024px
 * a grid that scrolls down past two rows, below it one sideways strip. Every other pair has one design, so the form
 * shows no chooser for it. Styles: styles/screens/launch.css (.cdx-design-pick).
 */
export function DesignChooser({ pair, value, onChange, disabled = false }: {
  pair: string;
  value: string;
  onChange: (design: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const keys = designsForPair(pair);
  const gridRef = useRef<HTMLDivElement>(null);
  // A saved launch's own design may be none of these (it was saved before): then no tile is checked.
  const checked = keys.indexOf(value as never);
  const tabStop = Math.max(0, checked);
  const chosen = getCardDesign(value);

  // The chosen design is brought into view at once (no travel), on mount and on a pick: centred in the phone strip, its
  // row shown whole in the desktop grid.
  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    const tile = grid?.querySelector<HTMLElement>(`[data-design="${keys[tabStop]}"]`);
    if (!grid || !tile) return;
    const box = grid.getBoundingClientRect(), at = tile.getBoundingClientRect();
    if (grid.scrollWidth > grid.clientWidth) grid.scrollLeft = at.left - box.left + grid.scrollLeft - (grid.clientWidth - tile.offsetWidth) / 2;
    if (grid.scrollHeight > grid.clientHeight) {
      const top = at.top - box.top + grid.scrollTop;
      if (top < grid.scrollTop || top + tile.offsetHeight > grid.scrollTop + grid.clientHeight) grid.scrollTop = top - (grid.clientHeight - tile.offsetHeight) / 2;
    }
  }, [tabStop, pair]);

  if (keys.length < 2) return null;

  /** How many tiles share the first row (one row in the phone strip: every tile). */
  const columns = () => {
    const tiles = gridRef.current?.querySelectorAll<HTMLElement>("[role='radio']");
    if (!tiles?.length) return 1;
    const top = tiles[0]!.offsetTop;
    let n = 0;
    for (const tile of tiles) { if (tile.offsetTop !== top) break; n++; }
    return Math.max(1, n);
  };
  const choose = (key: string, focus = false) => {
    if (disabled) return;
    onChange(key);
    if (focus) gridRef.current?.querySelector<HTMLElement>(`[data-design="${key}"]`)?.focus();
  };
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const index = keys.indexOf((e.target as HTMLElement).dataset.design as never);
    if (index < 0) return;
    const next = gridStep(e.key, index, keys.length, columns());
    if (next === null) return;
    e.preventDefault();
    choose(keys[next]!, true);
  }

  return (
    <div className="cdx-design-pick" data-disabled={disabled || undefined}>
      <div className="cdx-pair-hud__head">
        <span id={`${id}-label`} className="mdx-label">Card design</span>
        <span className="cdx-pair-hud__sub">{getPairAsset(pair).symbol}'s own card is its main design, plus {keys.length - 1} more no other pair uses</span>
      </div>
      <div className="cdx-pair-hud__console">
      <div ref={gridRef} role="radiogroup" aria-labelledby={`${id}-label`} aria-disabled={disabled || undefined} className="cdx-design-pick__grid" onKeyDown={onKeyDown}>
        {keys.map((key, index) => {
          const design = getCardDesign(key);
          const on = index === checked;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={index === tabStop ? 0 : -1}
              data-design={key}
              disabled={disabled}
              className="cdx-design-pick__tile"
              onClick={() => choose(key)}
            >
              <img className="cdx-design-pick__img" src={designThumb(key)} width={128} height={193} alt="" loading="lazy" decoding="async" />
              <span className="cdx-design-pick__name">{design.name}</span>
              {index === 0 ? <><span aria-hidden className="cdx-design-pick__main">Main</span><span className="sr-only">, main design</span></> : null}
              {on ? <span aria-hidden className="cdx-pair-tile__check"><Icon name="check" size={12} strokeWidth={2.5} /></span> : null}
            </button>
          );
        })}
      </div>
      </div>
      <p className="cdx-design-pick__line">
        <strong>{chosen.name}</strong>
        <span>{checked === 0 ? "Main design" : checked > 0 ? `${checked + 1} of ${keys.length}` : "Saved launch"}</span>
      </p>
    </div>
  );
}
