import { useEffect, useId, useRef, useState, type Ref } from "react";
import { CARD_DESIGNS, DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../../lib/carddex/designs";
import {
  PAIR_ASSETS, PAIR_ASSETS_SOURCE, allowedQuotesForDesign, boundQuoteForDesign,
  getPairAsset, getTradingPair, matchingDesignsForQuote, preferredDesignForQuote, type PairAsset, type PairAssetKey,
} from "../../lib/carddex/pairs";
import { Icon } from "../mintdex/ui";

export const pairKindLabel = (asset: Readonly<PairAsset>) => ({ native: "Native quote", stable: "Stablecoin quote", stock: "Tokenized stock quote", meme: "Memecoin quote", collector: "Collector token quote" })[asset.kind];

export function PairBadge({ quoteAssetKey, ticker = "TICKER", compact = false }: {
  quoteAssetKey: string; ticker?: string; compact?: boolean;
}) {
  const asset = getPairAsset(quoteAssetKey);
  return <div className={`cdx-pair-badge ${compact ? "cdx-pair-badge--compact" : ""}`}>
    <span className="cdx-pair-badge__label">Launch pair</span>
    <strong>{getTradingPair(ticker, asset.key)}</strong>
    <span>{pairKindLabel(asset)}</span>
  </div>;
}

/** Quote identity stays visible; exact mint and provider terms remain one tap away. */
export function QuoteAssetDetails({ quoteAssetKey, live = false }: { quoteAssetKey: string; live?: boolean }) {
  const asset = getPairAsset(quoteAssetKey);
  return <div className="cdx-pair-details">
    <AssetDisclosure asset={asset} live={live} />
  </div>;
}

/** The mint and every terms link behind one disclosure; external links say so with the external glyph. */
function AssetDisclosure({ asset, live }: { asset: Readonly<PairAsset>; live: boolean }) {
  const external = (href: string, label: string) => <a className="mdx-link mdx-hit" href={href} target="_blank" rel="noreferrer">{label}<Icon name="external" size={12} /></a>;
  return <details className="cdx-pair-disclosure">
    <summary>Asset details and terms<Icon name="chevron-down" /></summary>
    <div className="cdx-pair-details__body">
      <p>{asset.name}{asset.issuer ? ` · Issuer: ${asset.issuer}` : ""}</p>
      {asset.kind === "stock" ? <p>A tokenized-stock quote does not make your coin company shares.</p> : null}
      <p className="cdx-pair-details__label">{asset.kind === "native" ? "Wrapped SOL mint" : "Quote asset mint"}</p>
      <a className="cdx-pair-mint mdx-link" href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer"><span>{asset.mint}</span><Icon name="external" size={12} /></a>
      <div className="cdx-pair-details__links">
        {asset.issuerTerms ? external(asset.issuerTerms, "Issuer terms") : null}
        {asset.listingProviderTerms ? external(asset.listingProviderTerms, `${asset.listingProvider ?? "Listing"} terms`) : null}
        {external(PAIR_ASSETS_SOURCE, "pump.fun pairs")}
      </div>
      <p>Mint reviewed {asset.verifiedAt}.{asset.kind !== "native" ? " SOL also pays network and account costs." : ""}{live ? " The exact mint is checked again before wallet review." : ""}</p>
    </div>
  </details>;
}

/**
 * The quote's identity, exact mint and terms, all visible (Launch's Pair field; no disclosure): the asset and its
 * issuer, the full mint linked to Solscan (its name starts with the visible mint, WCAG 2.5.3), when the mint was
 * reviewed, each terms link, then what the quote does and does not do.
 */
export function QuoteAssetMeta({ quoteAssetKey, live = false, named = false }: {
  quoteAssetKey: string; live?: boolean;
  /** The picker already names the asset (its design-match line), so only the issuer is added here. */
  named?: boolean;
}) {
  const asset = getPairAsset(quoteAssetKey);
  const external = (href: string, label: string) => <a className="mdx-link mdx-hit" href={href} target="_blank" rel="noreferrer">{label}<Icon name="external" size={12} /></a>;
  const mintKind = asset.kind === "native" ? "Wrapped SOL" : "quote asset";
  return <div className="cdx-pair-meta">
    {!named || asset.issuer ? <p className="cdx-pair-meta__asset">
      {named ? null : <strong>{asset.name}</strong>}
      {asset.issuer ? `${named ? "" : " · "}Issuer: ${asset.issuer}` : null}
    </p> : null}
    <p className="cdx-pair-meta__mint">
      <span>{asset.kind === "native" ? "Wrapped SOL mint" : "Mint"}</span>{" "}
      <a className="cdx-pair-mint mdx-link" href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer" aria-label={`${asset.mint}, ${mintKind} mint on Solscan (opens in a new tab)`}><span>{asset.mint}</span><Icon name="external" size={12} /></a>
    </p>
    {/* A line of text between the mint and the terms row, so the terms links' 44px hit areas stay off the mint. */}
    <p>Mint reviewed {asset.verifiedAt}.{asset.kind !== "native" ? " SOL also pays network and account costs." : ""}</p>
    <p className="cdx-pair-meta__links">
      {asset.issuerTerms ? external(asset.issuerTerms, "Issuer terms") : null}
      {asset.listingProviderTerms ? external(asset.listingProviderTerms, `${asset.listingProvider ?? "Listing"} terms`) : null}
      {external(PAIR_ASSETS_SOURCE, "pump.fun pairs")}
    </p>
    {asset.kind === "stock" ? <p>A tokenized-stock quote does not make your coin company shares.</p> : null}
    {live ? <p>The exact mint is checked again before wallet review.</p> : null}
  </div>;
}

/** Changing a bound finish's quote requires an explicit compatible finish, never a hidden mismatch. */
export function QuoteAssetPicker({ value, designKey, ticker, onChange, onPendingChange, confirmationRef, balance, compact = false, live = false, disabled = false, viewport = false, variant = "default" }: {
  value: string; designKey: string; ticker?: string;
  onChange: (quote: PairAssetKey, design: string) => void;
  onPendingChange?: (pending: boolean) => void;
  confirmationRef?: Ref<HTMLDivElement>;
  balance?: string; compact?: boolean; live?: boolean; disabled?: boolean; viewport?: boolean;
  /** "inline" (Launch's Pair field): the select, its pair line and the mint and terms on one visible line; no
   * Matching designs toggle and no disclosure. A pending change asks under the select. */
  variant?: "default" | "inline";
}) {
  const id = useId();
  const asset = getPairAsset(value);
  const bound = boundQuoteForDesign(designKey);
  const recommendedDesigns = matchingDesignsForQuote(asset.key);
  const matchingDesigns = !bound && (asset.kind === "stock" || asset.kind === "meme" || asset.kind === "collector")
    ? recommendedDesigns.filter(design => design.key !== designKey)
    : [];
  const matchingFamily = asset.kind === "stock" ? "stock" : asset.kind === "collector" ? "collector" : "meme";
  const preferredMatchingDesign = preferredDesignForQuote(asset.key);
  const defaultMatchingDesign = matchingDesigns.find(design => design.key === preferredMatchingDesign)?.key
    ?? matchingDesigns[0]?.key ?? DEFAULT_CARD_DESIGN;
  const [matchingOpen, setMatchingOpen] = useState(false);
  const [matchingDesign, setMatchingDesign] = useState<string>(defaultMatchingDesign);
  const quoteSelectRef = useRef<HTMLSelectElement>(null);
  const restorePairFocus = useRef(false);
  const [pendingQuote, setPendingQuote] = useState<PairAssetKey | null>(null);
  const [pendingDesign, setPendingDesign] = useState<string>(DEFAULT_CARD_DESIGN);
  useEffect(() => {
    setPendingQuote(null);
    setMatchingOpen(false);
    setMatchingDesign(defaultMatchingDesign);
    onPendingChange?.(false);
  }, [value, designKey, defaultMatchingDesign, onPendingChange]);
  useEffect(() => {
    if (!matchingOpen && restorePairFocus.current) {
      restorePairFocus.current = false;
      quoteSelectRef.current?.focus();
    }
  }, [matchingOpen]);
  const clearPending = () => {
    setPendingQuote(null);
    onPendingChange?.(false);
  };
  const choose = (key: PairAssetKey) => {
    if (disabled) return;
    if (allowedQuotesForDesign(designKey).some(a => a.key === key)) {
      clearPending();
      onChange(key, designKey);
      return;
    }
    const preferred = preferredDesignForQuote(key);
    setPendingDesign(preferred && isCardDesignKey(preferred) ? preferred : DEFAULT_CARD_DESIGN);
    setPendingQuote(key);
    // Notify the form in this same input event so Enter cannot submit the old pair.
    onPendingChange?.(true);
  };
  const pending = pendingQuote ? getPairAsset(pendingQuote) : null;
  const selectedMatchesQuote = bound?.key === asset.key || recommendedDesigns.some(design => design.key === designKey);
  const designMatch = selectedMatchesQuote ? <p className="cdx-pair-design-match">
    <strong>{asset.kind === "stock" ? asset.name.replace(/ (?:xStock|tokenized equity)$/i, "") : asset.name}</strong>
    <span>{asset.kind === "stock" ? `${asset.referenceTicker} reference · ` : ""}{asset.symbol} quote</span>
  </p> : null;
  const matchingCardDesigns = matchingDesigns.length ? <div className="cdx-pair-matching">
    <button type="button" className="cdx-pair-matching__toggle" aria-expanded={matchingOpen} aria-controls={`${id}-matching`} disabled={disabled} onClick={() => setMatchingOpen(open => !open)}>
      Matching {matchingFamily} designs
      <Icon name="chevron-down" />
    </button>
    {matchingOpen ? <div id={`${id}-matching`} className="cdx-pair-matching__body">
      <label className="sr-only" htmlFor={`${id}-matching-finish`}>Matching card design</label>
      <select id={`${id}-matching-finish`} className="mdx-select mdx-select--field" value={matchingDesign} disabled={disabled} onChange={event => setMatchingDesign(event.target.value)}>
        {matchingDesigns.map(design => <option key={design.key} value={design.key}>{design.name}{design.category === "limited" ? " · Limited" : design.category === "classic" ? " · Classic" : " · Premium"}</option>)}
      </select>
      <button type="button" className="mdx-btn mdx-btn--outline mdx-btn--sm" disabled={disabled} onClick={() => {
        if (disabled || !matchingDesigns.some(design => design.key === matchingDesign)) return;
        restorePairFocus.current = true;
        setMatchingOpen(false);
        onChange(asset.key, matchingDesign);
      }}>Use {getCardDesign(matchingDesign).name}</button>
    </div> : null}
  </div> : null;
  // The pair line ("GLORB / SOL"): on Designs always; on Launch only beside a balance or on mainnet (the select and
  // the card already name the pair).
  const hint = variant !== "inline" || !!balance || live;
  const pairControls = <>
    <div className="cdx-pair-picker__head"><label htmlFor={id} className="mdx-label">{variant === "inline" ? "Pair" : "Pair asset"}</label></div>
    <select ref={quoteSelectRef} id={id} className="mdx-select mdx-select--field" value={asset.key} disabled={disabled} onChange={e => choose(e.target.value as PairAssetKey)} aria-describedby={hint ? `${id}-help` : undefined}>
      {([ ["native", "Native"], ["stable", "Stablecoin"], ["stock", "Tokenized stocks"], ["meme", "Memecoins"], ["collector", "Collector tokens"] ] as const).map(([kind,label]) =>
        <optgroup key={kind} label={label}>{PAIR_ASSETS.filter(a => a.kind === kind).map(a => <option key={a.key} value={a.key}>{a.symbol} · {a.name}</option>)}</optgroup>
      )}
    </select>
    {hint ? <div id={`${id}-help`} className="cdx-pair-picker__hint">
      <strong>{getTradingPair(ticker || "TICKER", asset.key)}</strong>
      {balance ? <span>Balance <span className="num">{balance}</span> {live ? "" : "test "}{asset.symbol}</span> : live ? <span>Real assets</span> : null}
    </div> : null}
    {designMatch ?? (bound ? <p className="cdx-pair-picker__binding">Paired with {bound.symbol}.</p> : null)}
  </>;
  const confirmChange = pending ? <div ref={confirmationRef} tabIndex={-1} className="cdx-pair-change" role="group" aria-label="Change quote and design">
      <p role="status"><strong>Switch to {pending.symbol}?</strong> {getCardDesign(designKey).name} uses {bound?.symbol}.</p>
      <label htmlFor={`${id}-finish`} className="mdx-label">Compatible design</label>
      <select id={`${id}-finish`} className="mdx-select mdx-select--field" value={pendingDesign} disabled={disabled} onChange={e=>setPendingDesign(e.target.value)}>
        {CARD_DESIGNS.filter(d=>allowedQuotesForDesign(d.key).some(a=>a.key===pending.key)).map(d=><option key={d.key} value={d.key}>{d.name}</option>)}
      </select>
      <div className="cdx-pair-change__actions">
        <button type="button" disabled={disabled} className="mdx-btn mdx-btn--outline mdx-btn--sm" onClick={()=>{onChange(pending.key,pendingDesign);clearPending();}}>Use pair and design</button>
        <button type="button" disabled={disabled} className="mdx-btn mdx-btn--ghost mdx-btn--sm" onClick={clearPending}>Keep {asset.symbol}</button>
      </div>
    </div> : null;
  // The inline picker (Launch's Pair field): everything on the page, nothing behind a toggle or a disclosure.
  if (variant === "inline") return <div className="cdx-pair-picker cdx-pair-picker--inline">
    {pairControls}
    {confirmChange}
    {/* The select already shows the asset's name ("BONK · Bonk"), so the meta adds its issuer, mint and review. */}
    <QuoteAssetMeta quoteAssetKey={asset.key} live={live} named />
  </div>;
  // The viewport picker (Launch's Pair step, the Designs pair tab): one panel, no sub-tabs. The quote, its pair line,
  // matching designs, then the mint and terms behind one disclosure (LAUNCH-04, browse-16).
  if (viewport) return <div className="cdx-pair-picker cdx-pair-picker--viewport">
    {pending ? confirmChange : <>
      {!matchingOpen ? pairControls : null}
      {matchingCardDesigns}
      <AssetDisclosure asset={asset} live={live} />
    </>}
  </div>;
  return <div className={`cdx-pair-picker ${compact ? "cdx-pair-picker--compact" : ""}`}>
    {pairControls}
    {!pending ? matchingCardDesigns : null}
    {confirmChange}
    <QuoteAssetDetails quoteAssetKey={asset.key} live={live} />
  </div>;
}
