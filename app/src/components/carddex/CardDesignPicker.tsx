import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { CARD_DESIGNS, type CardDesign } from "../../lib/carddex/designs";

import { PAIR_ASSETS, boundQuoteForDesign, defaultQuoteForDesign, getPairAsset, recommendedMemeQuoteForDesign, type PairAssetKey } from "../../lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../../lib/carddex/design-pairings";
import { cardMatchesCollection } from "../../lib/carddex/design-collections";
import { Modal } from "../mintdex/ui";
import type { CardData } from "../mintdex/MintCard";
import { CanonicalCardFace } from "./CanonicalCardFace";
import { PairBadge } from "./QuoteAssetPicker";
import { PageControls, usePageCapacity } from "./Viewport";
import "../../carddex-design-picker.css";

const DESIGN_GROUPS = [
  ["all", "All designs"],
  ["stocks", "Stock pairs"],
  ["memes", "Meme & collector pairs"],
  ["crypto", "Crypto pairs"],
  ["classic", "Trading card classics"],
  ["premium", "Premium collection"],
  ["limited", "Limited editions"],
] as const;
type DesignGroup = typeof DESIGN_GROUPS[number][0];
const memePairKeys = new Set<string>(MEME_PAIR_PRESETS.map(preset => preset.quote));
const memePairAssets = PAIR_ASSETS.filter(asset => memePairKeys.has(asset.key));

function inGroup(design: CardDesign, group: DesignGroup) {
  return cardMatchesCollection(design,group);
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
}) {
  const id = useId();
  const quoteKey = quoteAssetKey ?? defaultQuoteForDesign(value).key;
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<DesignGroup>("all");
  const [memePairFilter, setMemePairFilter] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [compactLandscape, setCompactLandscape] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width:560px) and (max-height:440px)");
    const update = () => setCompactLandscape(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const capacity = usePageCapacity({ rowHeight: compactLandscape ? 100 : 210, minWidth: compactLandscape ? 200 : 116, maxColumns: 4, maxRows: 2 });
  const filterPair = group === "memes" ? memePairAssets.find(asset => asset.key === memePairFilter) : null;
  const designs = useMemo(() => CARD_DESIGNS.filter(design => inGroup(design, group) && (!filterPair || MEME_PAIR_PRESETS.some(preset => preset.design === design.key && preset.quote === filterPair.key))), [group, filterPair?.key]);
  const pages = Math.max(1, Math.ceil(designs.length / capacity.count));
  const page = Math.min(pageIndex, pages - 1);
  const visibleDesigns = designs.slice(page * capacity.count, (page + 1) * capacity.count);
  const visibleColumns = Math.min(capacity.columns, Math.max(1, visibleDesigns.length));
  const visibleRows = Math.min(capacity.rows, Math.max(1, Math.ceil(visibleDesigns.length / visibleColumns)));
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open) setPageIndex(Math.floor(Math.max(0, designs.findIndex(design => design.key === value)) / capacity.count));
  }, [open, value, designs, capacity.count]);
  const browse = () => {
    if (disabled) return;
    setGroup(boundQuoteForDesign(value)?.kind === "stock" ? "stocks" : recommendedMemeQuoteForDesign(value, quoteKey)?.key === quoteKey ? "memes" : CARD_DESIGNS.find(design=>design.key===value)?.category==="crypto" ? "crypto" : "all");
    setMemePairFilter("all");
    setOpen(true);
  };
  const choose = (key: string, quote?: PairAssetKey) => {
    if (disabled) return;
    if (quote && onPairChange) onPairChange(quote, key);
    else onChange(key);
    setOpen(false);
  };
  const baseCard: CardData = previewCard ?? {
    name: "Your coin", ticker: ticker || "TICKER", image: "", level: 1,
    mcapUsd: null, mcapLabel: "At launch", holders: 0, dexNo: 0, ownerHandle: "you",
  };
  return (
    <div className={`cdx-design-picker ${compact ? "cdx-design-picker--compact" : ""} ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-[13px] font-semibold text-ink">
          Card design
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={browse}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="mdx-link cdx-design-picker__browse inline-flex min-h-11 items-center text-[12px]"
        >
          See all {CARD_DESIGNS.length}
        </button>
      </div>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mdx-input min-h-11 w-full text-[16px]"
      >
        {(
          [
            ["classic", "Trading card classics"],
            ["premium", "Premium collection"],
            ["stocks", "Tokenized-stock paired finishes"],
            ["memes", "Meme & collector pairs"],
            ["crypto", "Crypto pairs"],
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
      {!compact ? <><p className="mt-2 text-[13px] leading-relaxed text-slate">
        One permanent finish. Paired editions select their matching quote asset.
      </p>
      <PairBadge quoteAssetKey={quoteKey} ticker={ticker || "YOUR TOKEN"} compact /></> : null}
      <Modal open={open && !disabled} onOpenChange={setOpen} title="Choose your card design" description="Preview your token in each permanent finish. Choosing a design keeps your token details and artwork." width={860}>
        <div className="cdx-design-browser" data-vaul-no-drag>
          <p className="cdx-design-browser__intro">Your artwork, name and ticker in every finish.</p>
          <div className="cdx-design-browser__filter" data-paired={group === "memes"}>
            <div className="cdx-design-browser__field">
              <label htmlFor={`${id}-group`}>Collection</label>
              <select id={`${id}-group`} className="mdx-input" value={group} disabled={disabled} onChange={event => { setGroup(event.target.value as DesignGroup); setMemePairFilter("all"); setPageIndex(0); }}>
                {DESIGN_GROUPS.map(([key, label]) => <option key={key} value={key}>{label} · {CARD_DESIGNS.filter(design => inGroup(design, key)).length}</option>)}
              </select>
            </div>
            {group === "memes" ? <div className="cdx-design-browser__field">
              <label htmlFor={`${id}-pair`}>Pair asset</label>
              <select id={`${id}-pair`} className="mdx-input" value={memePairFilter} disabled={disabled} onChange={event => { setMemePairFilter(event.target.value); setPageIndex(0); }}>
                <option value="all">All pairs</option>
                {memePairAssets.map(asset => <option key={asset.key} value={asset.key}>{asset.symbol} · {asset.name}</option>)}
              </select>
            </div> : null}
          </div>
          <div ref={capacity.ref} className="cdx-design-browser__grid" aria-label="Choose a permanent card finish" style={{ "--design-columns": visibleColumns, "--design-rows": visibleRows } as CSSProperties}>
            {visibleDesigns.map(design => {
              const bound = boundQuoteForDesign(design.key);
              const preset = group === "memes" ? recommendedMemeQuoteForDesign(design.key, filterPair?.key ?? (design.key === value ? quoteKey : undefined)) : null;
              const asset = bound ?? preset ?? getPairAsset(quoteKey);
              const paired = bound ?? preset;
              const card: CardData = {
                ...baseCard, cardTemplate: design.key, level: design.materialLevel,
                quoteAssetKey: asset.key, quoteMint: asset.mint,
                ...(asset.key !== quoteKey ? { mcapUsd: null, mcapQuote: undefined, mcapLabel: "At launch" } : {}),
              };
              return <button key={design.key} type="button" className="cdx-design-browser__choice" disabled={disabled} aria-pressed={value === design.key && (!paired || asset.key === quoteKey)} aria-label={`Choose ${design.name}${paired ? `, ${asset.symbol} pair` : ""}`} onClick={() => choose(design.key, preset?.key)}>
                <div className="cdx-design-browser__art" aria-hidden><CanonicalCardFace card={card} design={design} compact lite sizes="160px" /></div>
                <strong>{design.name}</strong>
                <span className="cdx-design-browser__quote" data-bound={!!paired}>{paired ? `${asset.symbol} pair` : "Any quote"}</span>
              </button>;
            })}
          </div>
          <PageControls page={page} pages={pages} onPage={setPageIndex} label={`${designs.length} ${designs.length === 1 ? "design" : "designs"}`} />
        </div>
      </Modal>
    </div>
  );
}
