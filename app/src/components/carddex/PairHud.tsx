import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getPairAsset, getTradingPair, type PairAssetKey } from "../../lib/carddex/pairs";
import { Icon, IconButton, Tabs, TextLink } from "../mintdex/ui";
import { QuoteAssetMeta } from "./QuoteAssetMeta";
import { PAIR_GROUPS, filterPairs, gridStep, pairMonogram, shortPairName, type PairGroup } from "./pair-groups";

/**
 * Launch's pair HUD: the pair picks the card. A filter (All, Memes, Stocks, Collector, Base), a search for a symbol or
 * name, and every pair as a tile in one radio group (arrow keys move and select, as radio groups do). Choosing a pair
 * is choosing its card: the live card preview shows that pair's design at once, so the HUD never shows a design name,
 * thumbnail or swatch. Under it, the chosen pair's safety facts: its name and issuer, the full mint, when it was
 * reviewed and the terms links. Explanations live at /how#pairs. Styles: styles/screens/launch.css.
 */
export function PairHud({ value, onChange, ticker, live = false, disabled = false, balance, notice }: {
  value: string;
  onChange: (pair: PairAssetKey) => void;
  ticker: string;
  live?: boolean;
  disabled?: boolean;
  /** The demo's balance in this pair (a signed-in test account). */
  balance?: string;
  /** One line from the form about the last change (an initial buy cleared, a link's pair unavailable). */
  notice?: string;
}) {
  const id = useId();
  const [group, setGroup] = useState<PairGroup>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterPairs(group, query), [group, query]);
  const asset = getPairAsset(value);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // The radio group's one Tab stop: the chosen pair, or the first tile when the filter hides it.
  const checked = shown.findIndex((pair) => pair.key === asset.key);
  const tabStop = checked >= 0 ? checked : 0;

  /** How many tiles share the first row (the grid's track count at this width). */
  const columns = () => {
    const tiles = gridRef.current?.querySelectorAll<HTMLElement>("[role='radio']");
    if (!tiles?.length) return 1;
    const top = tiles[0]!.offsetTop;
    let n = 0;
    for (const tile of tiles) { if (tile.offsetTop !== top) break; n++; }
    return Math.max(1, n);
  };
  const choose = (key: PairAssetKey, focus = false) => {
    if (disabled) return;
    if (key !== asset.key) onChange(key);
    if (focus) gridRef.current?.querySelector<HTMLElement>(`[data-pair="${key}"]`)?.focus();
  };
  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const index = shown.findIndex((pair) => pair.key === (e.target as HTMLElement).dataset.pair);
    if (index < 0) return;
    const next = gridStep(e.key, index, shown.length, columns());
    if (next === null) return;
    e.preventDefault();
    choose(shown[next]!.key, true);
  }
  /** Enter in the search picks the first match (and stays in the HUD: the form's own Enter handling is skipped). */
  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); return; }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (shown[0]) choose(shown[0].key, true);
  }
  const groupName = PAIR_GROUPS.find((g) => g.key === group)!.name;

  return (
    <div className="cdx-pair-hud" data-disabled={disabled || undefined}>
      <div className="cdx-pair-hud__head">
        <span id={`${id}-label`} className="mdx-label">Pair</span>
        <span className="cdx-pair-hud__sub">Picks your card</span>
        <TextLink to="/how" hash="pairs">Details</TextLink>
      </div>
      <div className="cdx-pair-hud__console">
        <div className="cdx-pair-hud__controls">
          <Tabs
            label="Pair groups"
            size="sm"
            value={group}
            onChange={(next) => setGroup(next)}
            className="cdx-pair-hud__groups mdx-tabs--fill"
            options={PAIR_GROUPS.map((g) => ({ value: g.key, label: g.name }))}
          />
          <div className="cdx-pair-hud__search">
            <label className="sr-only" htmlFor={`${id}-search`}>Search pairs</label>
            <Icon name="search" size={16} className="cdx-pair-hud__glyph" />
            <input
              ref={searchRef}
              id={`${id}-search`}
              className="mdx-input"
              type="search"
              value={query}
              maxLength={24}
              placeholder="Symbol or name"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            {query ? <IconButton icon="close" label="Clear search" size="sm" className="cdx-pair-hud__clear" onClick={() => { setQuery(""); searchRef.current?.focus(); }} /> : null}
          </div>
        </div>
        <div ref={gridRef} role="radiogroup" aria-labelledby={`${id}-label`} aria-disabled={disabled || undefined} className="cdx-pair-hud__grid" onKeyDown={onGridKeyDown}>
          {shown.map((pair, index) => {
            const on = pair.key === asset.key;
            return (
              <button
                key={pair.key}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={index === tabStop ? 0 : -1}
                data-pair={pair.key}
                disabled={disabled}
                className="cdx-pair-tile"
                onClick={() => choose(pair.key)}
              >
                <span aria-hidden className="cdx-pair-tile__mono">{pairMonogram(pair)}</span>
                <span className="cdx-pair-tile__text">
                  <span className="cdx-pair-tile__sym">{pair.symbol}</span>
                  <span className="cdx-pair-tile__name">{shortPairName(pair)}</span>
                </span>
                {on ? <span aria-hidden className="cdx-pair-tile__check"><Icon name="check" size={12} strokeWidth={2.5} /></span> : null}
              </button>
            );
          })}
          {shown.length ? null : (
            <p className="cdx-pair-hud__empty" role="status">
              No match{group === "all" ? "" : ` in ${groupName}`}.{" "}
              <button type="button" className="mdx-link mdx-hit" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>Clear search</button>
            </p>
          )}
        </div>
      </div>
      <div className="cdx-pair-hud__picked">
        <p className="cdx-pair-hud__line">
          <strong>{getTradingPair(ticker || "TICKER", asset.key)}</strong>
          {balance ? <span>Balance <span className="num">{balance}</span> test {asset.symbol}</span> : live ? <span>Real assets</span> : null}
        </p>
        <QuoteAssetMeta quoteAssetKey={asset.key} live={live} />
        {/* Always in the page, so a change is announced when its words arrive. */}
        <p className="cdx-pair-notice" role="status">{notice ?? ""}</p>
      </div>
    </div>
  );
}
