import { useEffect, useId, useMemo, useState } from "react";
import { CARD_DESIGNS, getCardDesign, type CardDesign } from "../../lib/carddex/designs";
import { CREATION_MCAP_LABEL } from "../../lib/carddex/card-template";

import { PAIR_ASSETS, boundQuoteForDesign, defaultQuoteForDesign, getPairAsset, recommendedMemeQuoteForDesign, type PairAssetKey } from "../../lib/carddex/pairs";
import { DESIGN_GROUPS, inDesignGroup as inGroup, type DesignGroup } from "./design-groups";
import { MEME_PAIR_PRESETS } from "../../lib/carddex/design-pairings";
import { AutoGrid, Badge, Button, Chip, Icon, Modal } from "../mintdex/ui";
import type { CardData } from "../mintdex/MintCard";
import { CanonicalCardFace } from "./CanonicalCardFace";
import { PairBadge } from "./QuoteAssetPicker";
import { designRow, matchFamily, matchedDesignKeys, type DesignRow } from "./launch-form";
import { DesignMini } from "./GalleryTile";

const memePairKeys = new Set<string>(MEME_PAIR_PRESETS.map(preset => preset.quote));
const memePairAssets = PAIR_ASSETS.filter(asset => memePairKeys.has(asset.key));

/** The creator's live card in another design: the same details, that design's quote when it is bound to one. */
function cardIn(base: CardData, design: CardDesign, quoteKey: string, asset = boundQuoteForDesign(design.key) ?? getPairAsset(quoteKey)): CardData {
  return {
    ...base, cardTemplate: design.key, level: design.materialLevel,
    quoteAssetKey: asset.key, quoteMint: asset.mint,
    ...(asset.key !== quoteKey ? { mcapUsd: null, mcapQuote: undefined, mcapLabel: CREATION_MCAP_LABEL } : {}),
  };
}

export function CardDesignPicker({
  value,
  onChange,
  onPairChange,
  className = "",
  quoteAssetKey,
  ticker,
  previewCard,
  disabled = false,
  compact = false,
  variant = "default",
  seedReady = true,
}: {
  value: string;
  onChange: (key: string) => void;
  onPairChange?: (quote: PairAssetKey, design: string) => void;
  className?: string;
  quoteAssetKey?: string;
  ticker?: string;
  previewCard?: CardData;
  disabled?: boolean;
  compact?: boolean;
  /** "inline" (Launch): the chosen design and a short row of suggestions, one tap each, then "All designs" (the
   * library dialog). "default": the select and the Browse button. */
  variant?: "default" | "inline";
  /** Inline only: the row is seeded once the page knows its starting design (the URL, then a saved draft). */
  seedReady?: boolean;
}) {
  const id = useId();
  const quoteKey = quoteAssetKey ?? defaultQuoteForDesign(value).key;
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<DesignGroup>("all");
  const [memePairFilter, setMemePairFilter] = useState("all");
  const filterPair = group === "memes" ? memePairAssets.find(asset => asset.key === memePairFilter) : null;
  const designs = useMemo(() => CARD_DESIGNS.filter(design => inGroup(design, group) && (!filterPair || MEME_PAIR_PRESETS.some(preset => preset.design === design.key && preset.quote === filterPair.key))), [group, filterPair?.key]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  // The suggestion row holds still while the creator picks inside it (launch-form.ts designRow).
  const [row, setRow] = useState<DesignRow | null>(null);
  useEffect(() => {
    if (variant !== "inline" || !seedReady) return;
    setRow(prev => designRow(prev, value, quoteKey));
  }, [variant, seedReady, value, quoteKey]);
  const browse = () => {
    if (disabled) return;
    setGroup(boundQuoteForDesign(value)?.kind === "stock" ? "stocks" : recommendedMemeQuoteForDesign(value, quoteKey)?.key === quoteKey ? "memes" : "all");
    setMemePairFilter("all");
    setOpen(true);
  };
  const choose = (key: string, quote?: PairAssetKey) => {
    if (disabled) return;
    if (quote && onPairChange) onPairChange(quote, key);
    else onChange(key);
    setOpen(false);
  };
  const pickGroup = (key: DesignGroup) => { if (disabled) return; setGroup(key); setMemePairFilter("all"); };
  const baseCard: CardData = previewCard ?? {
    name: "Your coin", ticker: ticker || "TICKER", image: "", level: 1,
    mcapUsd: null, mcapLabel: CREATION_MCAP_LABEL, holders: 0, dexNo: 0, ownerHandle: "you",
  };

  // The library: your coin previewed in every design, in a dialog, so the draft never leaves the page. Every design
  // in the chosen collection is laid out (the dialog body scrolls); the collection filter stays at its top. The
  // dialog takes the page column's width (overlays.css), so a wide screen gets more tracks and less scrolling.
  const library = (
    <Modal open={open && !disabled} onOpenChange={setOpen} title="Choose your card design" description="Your details and art stay as they are." width={1600}>
      <div className="cdx-design-browser" data-vaul-no-drag>
        <div className="cdx-design-browser__filters">
          {/* Collections: wrapping chips from 768px, one select on phones (chips would run past two lines). */}
          <div className="mdx-chiprow cdx-design-browser__chips" role="group" aria-label="Collection">
            {DESIGN_GROUPS.map(({ key, name }) => <Chip key={key} pressed={group === key} count={CARD_DESIGNS.filter(design => inGroup(design, key)).length} onClick={() => pickGroup(key)}>{name}</Chip>)}
          </div>
          <div className="cdx-design-browser__collection">
            <label htmlFor={`${id}-group`} className="mdx-label">Collection</label>
            <select id={`${id}-group`} className="mdx-select mdx-select--field" value={group} disabled={disabled} onChange={event => pickGroup(event.target.value as DesignGroup)}>
              {DESIGN_GROUPS.map(({ key, name }) => <option key={key} value={key}>{name} ({CARD_DESIGNS.filter(design => inGroup(design, key)).length})</option>)}
            </select>
          </div>
          {group === "memes" ? <div className="cdx-design-browser__filter">
            <label htmlFor={`${id}-pair`} className="mdx-label">Pair asset</label>
            <select id={`${id}-pair`} className="mdx-select mdx-select--field" value={memePairFilter} disabled={disabled} onChange={event => setMemePairFilter(event.target.value)}>
              <option value="all">All pairs</option>
              {memePairAssets.map(asset => <option key={asset.key} value={asset.key}>{asset.symbol} · {asset.name}</option>)}
            </select>
          </div> : null}
        </div>
        <AutoGrid min="var(--tile-min-design)" className="cdx-design-browser__grid" label={`Choose a permanent card design, ${designs.length} ${designs.length === 1 ? "design" : "designs"}`}>
          {designs.map(design => {
            const bound = boundQuoteForDesign(design.key);
            const preset = group === "memes" ? recommendedMemeQuoteForDesign(design.key, filterPair?.key ?? (design.key === value ? quoteKey : undefined)) : null;
            const asset = bound ?? preset ?? getPairAsset(quoteKey);
            const paired = bound ?? preset;
            const current = value === design.key && (!paired || asset.key === quoteKey);
            return <li key={design.key}>
              <button type="button" className="cdx-design-browser__choice" disabled={disabled} aria-pressed={current} aria-label={`Choose ${design.name}${paired ? `, ${asset.symbol} pair` : ""}`} onClick={() => choose(design.key, preset?.key)}>
                <div className="cdx-design-browser__art" aria-hidden><CanonicalCardFace card={cardIn(baseCard, design, quoteKey, asset)} design={design} compact lite sizes="160px" /></div>
                <strong>{design.name}</strong>
                <span className="cdx-design-browser__meta">
                  <span className="cdx-design-browser__quote" data-bound={!!paired}>{paired ? `${asset.symbol} pair` : "Any quote"}</span>
                  {current ? <Badge tone="ink">Current</Badge> : null}
                </span>
              </button>
            </li>;
          })}
        </AutoGrid>
      </div>
    </Modal>
  );

  if (variant === "inline") {
    const keys = (row ?? designRow(null, value, quoteKey)).keys;
    // A stock, meme or collector quote names its matched designs (design-pairings.ts) above the chips, and each matched
    // chip carries "Match", so the suggestion reads as the match it is. Picking one keeps the quote.
    const family = matchFamily(quoteKey);
    const matched = matchedDesignKeys(quoteKey);
    const symbol = getPairAsset(quoteKey).symbol;
    // MintDex's design chips under the live card (a pill per design: its miniature, its name), then the library link.
    return (
      <div className={`cdx-design-picker cdx-design-picker--inline ${className}`}>
        <div className="cdx-design-picker__head">
          <span id={`${id}-label`} className="mdx-label">Card design</span>
          <span className="cdx-design-picker__kept">Kept for good</span>
        </div>
        {family && matched.length ? (
          <p className="cdx-design-picker__matched">
            Matching {family} {matched.length === 1 ? "design" : "designs"} for {symbol}:{" "}
            <strong>{matched.map(key => getCardDesign(key).name).join(", ")}</strong>
          </p>
        ) : null}
        <ul className="cdx-design-picker__chips" aria-labelledby={`${id}-label`}>
          {keys.map(key => {
            const design = getCardDesign(key);
            const bound = boundQuoteForDesign(key);
            const isMatch = !!family && matched.includes(key);
            return <li key={key}>
              {/* Named by its visible name (label in name, WCAG 2.5.3); the pair it launches with is sr-only text. */}
              <button type="button" className="cdx-design-chip" aria-pressed={value === key} disabled={disabled} onClick={() => { if (!disabled && value !== key) onChange(key); }}>
                <DesignMini design={design} />
                <span className="cdx-design-chip__name">{design.name}</span>
                {/* "Match" (the line above names the quote): a symbol such as CHILLHOUSE is wider than a chip. */}
                {isMatch ? <span className="cdx-design-chip__match" aria-hidden>Match</span> : null}
                <span className="sr-only">, {isMatch ? `matched to ${symbol}` : bound ? `${bound.symbol} pair` : "any pair"}</span>
              </button>
            </li>;
          })}
        </ul>
        <button type="button" className="mdx-link mdx-hit cdx-design-picker__all" disabled={disabled} aria-haspopup="dialog" onClick={browse}>
          See all {CARD_DESIGNS.length} designs
        </button>
        {library}
      </div>
    );
  }

  return (
    <div className={`cdx-design-picker ${compact ? "cdx-design-picker--compact" : ""} ${className}`}>
      <label htmlFor={id} className="mdx-label">
        Card design
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-help`}
        className="mdx-select mdx-select--field"
      >
        {(
          [
            ["classic", "Trading card classics"],
            ["premium", "Premium collection"],
            ["stocks", "Tokenized-stock paired designs"],
            ["limited", "Limited editions"],
          ] as const
        ).map(([key, label]) => (
          <optgroup key={key} label={label}>
            {CARD_DESIGNS.filter((d) => d.category === key).map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}{boundQuoteForDesign(d.key) ? ` · ${boundQuoteForDesign(d.key)!.symbol} pair` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p id={`${id}-help`} className="cdx-design-picker__help">
        Your coin keeps this design for good. Every design uses the same card layout{boundQuoteForDesign(value) ? `; this one is paired with ${boundQuoteForDesign(value)!.symbol}` : ""}.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={browse}
        aria-haspopup="dialog"
        className="cdx-design-picker__browse"
      >
        Browse all {CARD_DESIGNS.length} designs
      </Button>
      {!compact ? <PairBadge quoteAssetKey={quoteKey} ticker={ticker || "TICKER"} compact /> : null}
      {library}
    </div>
  );
}
