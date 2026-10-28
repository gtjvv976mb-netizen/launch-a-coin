import { useEffect, useId, useRef, useState, type Ref } from "react";
import { CARD_DESIGNS, DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../../lib/carddex/designs";
import {
  PAIR_ASSETS, PAIR_ASSETS_SOURCE, allowedQuotesForDesign, boundQuoteForDesign,
  getPairAsset, getTradingPair, matchingDesignsForQuote, preferredDesignForQuote, type PairAsset, type PairAssetKey,
} from "../../lib/carddex/pairs";
import "../../carddex-pairs.css";
import { ViewTabs, tabPanelProps } from "./ViewTabs";

export const pairKindLabel = (asset: Readonly<PairAsset>) => ({ native: "Native quote", stable: "Stablecoin quote", stock: "Tokenized stock quote", meme: "Memecoin quote", collector: "Collector token quote" })[asset.kind];

export function PairBadge({ quoteAssetKey, ticker = "YOUR COIN", compact = false }: {
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
    <p>{asset.name}{asset.issuer ? <> · <span>Issuer: {asset.issuer}</span></> : null}</p>
    {asset.kind === "stock" ? <p className="cdx-pair-details__qualification">The quote is a tokenized-stock asset with its own issuer terms; your creator token is not company shares.</p> : null}
    <details>
      <summary>Asset details &amp; terms <span aria-hidden>⌄</span></summary>
      <div className="cdx-pair-details__body">
        <p>{asset.name}{asset.issuer ? ` · Issuer: ${asset.issuer}` : ""}</p>
        <span>{asset.kind === "native" ? "Wrapped SOL mint" : "Quote asset mint"}</span>
        <a className="cdx-pair-mint" href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer">{asset.mint}</a>
        <div className="cdx-pair-details__links">
          {asset.issuerTerms ? <a href={asset.issuerTerms} target="_blank" rel="noreferrer">Issuer terms ↗</a> : null}
          {asset.listingProviderTerms ? <a href={asset.listingProviderTerms} target="_blank" rel="noreferrer">{asset.listingProvider ?? "Listing"} terms ↗</a> : null}
          <a href={PAIR_ASSETS_SOURCE} target="_blank" rel="noreferrer">Pump.fun pairs ↗</a>
        </div>
        <p>Mint reviewed {asset.verifiedAt}. {live ? "The exact mainnet mint is rechecked before wallet review." : "Demo; no on-chain launch."}</p>
      </div>
    </details>
  </div>;
}

/** Changing a bound finish's quote requires an explicit compatible finish, never a hidden mismatch. */
export function QuoteAssetPicker({ value, designKey, ticker, onChange, onPendingChange, confirmationRef, balance, compact = false, live = false, disabled = false, viewport = false }: {
  value: string; designKey: string; ticker?: string;
  onChange: (quote: PairAssetKey, design: string) => void;
  onPendingChange?: (pending: boolean) => void;
  confirmationRef?: Ref<HTMLDivElement>;
  balance?: string; compact?: boolean; live?: boolean; disabled?: boolean; viewport?: boolean;
}) {
  const id = useId();
  const [pane, setPane] = useState("pair");
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
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {matchingOpen ? <div id={`${id}-matching`} className="cdx-pair-matching__body">
      <p>{asset.symbol} quote · {getCardDesign(designKey).name} stays selected until you apply.</p>
      <label className="sr-only" htmlFor={`${id}-matching-finish`}>Matching card finish</label>
      <select id={`${id}-matching-finish`} className="mdx-input" value={matchingDesign} disabled={disabled} onChange={event => setMatchingDesign(event.target.value)}>
        {matchingDesigns.map(design => <option key={design.key} value={design.key}>{design.name}{design.category === "limited" ? " · Limited" : design.category === "classic" ? " · Classic" : " · Premium"}</option>)}
      </select>
      <button type="button" className="mdx-btn mdx-btn--primary mdx-btn--sm" disabled={disabled} onClick={() => {
        if (disabled || !matchingDesigns.some(design => design.key === matchingDesign)) return;
        restorePairFocus.current = true;
        setMatchingOpen(false);
        onChange(asset.key, matchingDesign);
      }}>Use {getCardDesign(matchingDesign).name}</button>
    </div> : null}
  </div> : null;
  const pairControls = <>
    <div className="cdx-pair-picker__head"><label htmlFor={id}>Quote asset</label><span>{pairKindLabel(asset)}</span></div>
    <select ref={quoteSelectRef} id={id} className="mdx-input" value={asset.key} disabled={disabled} onChange={e => choose(e.target.value as PairAssetKey)} aria-describedby={`${id}-help`}>
      {([ ["native", "Native"], ["stable", "Stablecoin"], ["stock", "Tokenized stocks"], ["meme", "Memecoins"], ["collector", "Collector tokens"] ] as const).map(([kind,label]) =>
        <optgroup key={kind} label={label}>{PAIR_ASSETS.filter(a => a.kind === kind).map(a => <option key={a.key} value={a.key}>{a.symbol} · {a.name}</option>)}</optgroup>
      )}
    </select>
    <div id={`${id}-help`} className="cdx-pair-picker__hint">
      <strong>{getTradingPair(ticker ?? "YOUR COIN", asset.key)}</strong>
      <span>{balance ? `${balance} ${asset.symbol} ${live ? "wallet balance" : "test balance"}` : live ? "Solana mainnet · real assets" : "Demo · no real assets"}</span>
    </div>
    {designMatch ?? (bound ? <p className="cdx-pair-picker__binding">This finish is paired with {bound.symbol}. Choosing another quote offers a compatible finish.</p> : null)}
  </>;
  if (viewport) return <div className="cdx-pair-picker cdx-pair-picker--viewport">
    {!pending ? <ViewTabs className="cdx-launch-subtabs" label="Quote information" idBase={id} tabs={[["pair", "Pair"], ["mint", "Mint"], ["terms", "Terms"]].map(([key,label]) => ({ id: key, label, selected: pane === key, onSelect: () => { setPane(key); setMatchingOpen(false); } }))} /> : null}
    {pending ? <div ref={confirmationRef} tabIndex={-1} className="cdx-pair-change" role="group" aria-label="Change quote and finish">
      <p role="status"><strong>Switch to {pending.symbol}?</strong> {getCardDesign(designKey).name} uses {bound?.symbol}. Choose a compatible finish.</p>
      <label htmlFor={`${id}-finish`}>Compatible card finish</label>
      <select id={`${id}-finish`} className="mdx-input" value={pendingDesign} disabled={disabled} onChange={e=>setPendingDesign(e.target.value)}>{CARD_DESIGNS.filter(d=>allowedQuotesForDesign(d.key).some(a=>a.key===pending.key)).map(d=><option key={d.key} value={d.key}>{d.name}</option>)}</select>
      <div className="cdx-pair-change__actions"><button type="button" disabled={disabled} className="mdx-btn mdx-btn--primary mdx-btn--sm" onClick={()=>{onChange(pending.key,pendingDesign);clearPending();}}>Use pair and finish</button><button type="button" disabled={disabled} className="mdx-btn mdx-btn--ghost mdx-btn--sm" onClick={clearPending}>Keep {asset.symbol}</button></div>
    </div> : pane === "pair" ? <div className="contents" {...tabPanelProps(id, pane)}>
      {!matchingOpen ? pairControls : null}
      {matchingCardDesigns}
    </div> : pane === "mint" ? <div className="cdx-pair-details__body" {...tabPanelProps(id, pane)}><p><strong>{asset.name}</strong>{asset.issuer ? ` · ${asset.issuer}` : ""}</p><span>{asset.kind === "native" ? "Wrapped SOL mint" : "Quote asset mint"}</span><a className="cdx-pair-mint" href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer">{asset.mint}</a><p>Reviewed {asset.verifiedAt}. {live ? "The exact mainnet mint is checked again before wallet review." : "Demo only; no on-chain launch."}</p></div> : <div className="cdx-pair-details__body" {...tabPanelProps(id, pane)}><p>{asset.kind === "stock" ? "This quote is a tokenized-stock asset with its own issuer terms. Your creator token is not company shares." : "This asset funds the optional initial buy. SOL is also needed for network and account costs."}</p><div className="cdx-pair-details__links">{asset.issuerTerms ? <a href={asset.issuerTerms} target="_blank" rel="noreferrer">Issuer terms</a> : null}{asset.listingProviderTerms ? <a href={asset.listingProviderTerms} target="_blank" rel="noreferrer">{asset.listingProvider ?? "Listing"} terms</a> : null}<a href={PAIR_ASSETS_SOURCE} target="_blank" rel="noreferrer">Pump.fun pairs</a></div></div>}
  </div>;
  return <div className={`cdx-pair-picker ${compact ? "cdx-pair-picker--compact" : ""}`}>
    {pairControls}
    {!pending ? matchingCardDesigns : null}
    {pending ? <div ref={confirmationRef} tabIndex={-1} className="cdx-pair-change" role="group" aria-label="Change quote and finish">
      <p role="status"><strong>Switch to {pending.symbol}?</strong> {getCardDesign(designKey).name} uses {bound?.symbol}. Choose a compatible finish.</p>
      <label htmlFor={`${id}-finish`}>Compatible card finish</label>
      <select id={`${id}-finish`} className="mdx-input" value={pendingDesign} disabled={disabled} onChange={e=>setPendingDesign(e.target.value)}>
        {CARD_DESIGNS.filter(d=>allowedQuotesForDesign(d.key).some(a=>a.key===pending.key)).map(d=><option key={d.key} value={d.key}>{d.name}</option>)}
      </select>
      <div className="cdx-pair-change__actions">
        <button type="button" disabled={disabled} className="mdx-btn mdx-btn--primary mdx-btn--sm" onClick={()=>{onChange(pending.key,pendingDesign);clearPending();}}>Use pair and finish</button>
        <button type="button" disabled={disabled} className="mdx-btn mdx-btn--ghost mdx-btn--sm" onClick={clearPending}>Keep {asset.symbol}</button>
      </div>
    </div> : null}
    <QuoteAssetDetails quoteAssetKey={asset.key} live={live} />
  </div>;
}
