import { useEffect, useId, useState, type Ref } from "react";
import { CARD_DESIGNS, DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../../lib/carddex/designs";
import {
  PAIR_ASSETS, PAIR_ASSETS_SOURCE, allowedQuotesForDesign, boundQuoteForDesign,
  getPairAsset, getTradingPair, preferredDesignForQuote, type PairAsset, type PairAssetKey,
} from "../../lib/carddex/pairs";
import "../../carddex-pairs.css";
import { ViewTabs } from "./ViewTabs";

export const pairKindLabel = (asset: Readonly<PairAsset>) => ({ native: "Native quote", stable: "Stablecoin quote", stock: "Tokenized stock quote", meme: "Memecoin quote" })[asset.kind];

export function PairBadge({ quoteAssetKey, ticker = "YOUR TOKEN", compact = false }: {
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
  const [pendingQuote, setPendingQuote] = useState<PairAssetKey | null>(null);
  const [pendingDesign, setPendingDesign] = useState<string>(DEFAULT_CARD_DESIGN);
  useEffect(() => {
    setPendingQuote(null);
    onPendingChange?.(false);
  }, [value, designKey, onPendingChange]);
  const clearPending = () => {
    setPendingQuote(null);
    onPendingChange?.(false);
  };
  const choose = (key: PairAssetKey) => {
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
  if (viewport) return <div className="cdx-pair-picker cdx-pair-picker--viewport">
    {!pending ? <ViewTabs className="cdx-launch-subtabs" label="Quote information" tabs={[["pair", "Pair"], ["mint", "Mint"], ["terms", "Terms"]].map(([key,label]) => ({ id: key, label, selected: pane === key, onSelect: () => setPane(key) }))} /> : null}
    {pending ? <div ref={confirmationRef} tabIndex={-1} className="cdx-pair-change" role="group" aria-label="Change quote and finish">
      <p role="status"><strong>Switch to {pending.symbol}?</strong> {getCardDesign(designKey).name} uses {bound?.symbol}. Choose a compatible finish.</p>
      <label htmlFor={`${id}-finish`}>Compatible card finish</label>
      <select id={`${id}-finish`} className="mdx-input" value={pendingDesign} disabled={disabled} onChange={e=>setPendingDesign(e.target.value)}>{CARD_DESIGNS.filter(d=>allowedQuotesForDesign(d.key).some(a=>a.key===pending.key)).map(d=><option key={d.key} value={d.key}>{d.name}</option>)}</select>
      <div className="cdx-pair-change__actions"><button type="button" disabled={disabled} className="mdx-btn mdx-btn--primary mdx-btn--sm" onClick={()=>{onChange(pending.key,pendingDesign);clearPending();}}>Use pair and finish</button><button type="button" disabled={disabled} className="mdx-btn mdx-btn--ghost mdx-btn--sm" onClick={clearPending}>Keep {asset.symbol}</button></div>
    </div> : pane === "pair" ? <>
      <div className="cdx-pair-picker__head"><label htmlFor={id}>Quote asset</label><span>{pairKindLabel(asset)}</span></div>
      <select id={id} className="mdx-input" value={asset.key} disabled={disabled} onChange={e => choose(e.target.value as PairAssetKey)} aria-describedby={`${id}-help`}>{([ ["native", "Native"], ["stable", "Stablecoin"], ["stock", "Tokenized stocks"], ["meme", "Memecoins"] ] as const).map(([kind,label]) => <optgroup key={kind} label={label}>{PAIR_ASSETS.filter(a => a.kind === kind).map(a => <option key={a.key} value={a.key}>{a.symbol} · {a.name}</option>)}</optgroup>)}</select>
      <div id={`${id}-help`} className="cdx-pair-picker__hint"><strong>{getTradingPair(ticker ?? "YOUR TOKEN", asset.key)}</strong><span>{balance ? `${balance} ${asset.symbol} ${live ? "wallet balance" : "test balance"}` : live ? "Solana mainnet · real assets" : "Demo · no real assets"}</span></div>
      {bound ? <p className="cdx-pair-picker__binding">Paired with {bound.symbol}. A different quote requires a compatible finish.</p> : null}
    </> : pane === "mint" ? <div className="cdx-pair-details__body"><p><strong>{asset.name}</strong>{asset.issuer ? ` · ${asset.issuer}` : ""}</p><span>{asset.kind === "native" ? "Wrapped SOL mint" : "Quote asset mint"}</span><a className="cdx-pair-mint" href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer">{asset.mint}</a><p>Reviewed {asset.verifiedAt}. {live ? "The exact mainnet mint is checked again before wallet review." : "Demo only; no on-chain launch."}</p></div> : <div className="cdx-pair-details__body"><p>{asset.kind === "stock" ? "This quote is a tokenized-stock asset with its own issuer terms. Your creator token is not company shares." : "This asset funds the optional initial buy. SOL is also needed for network and account costs."}</p><div className="cdx-pair-details__links">{asset.issuerTerms ? <a href={asset.issuerTerms} target="_blank" rel="noreferrer">Issuer terms</a> : null}{asset.listingProviderTerms ? <a href={asset.listingProviderTerms} target="_blank" rel="noreferrer">{asset.listingProvider ?? "Listing"} terms</a> : null}<a href={PAIR_ASSETS_SOURCE} target="_blank" rel="noreferrer">Pump.fun pairs</a></div></div>}
  </div>;
  return <div className={`cdx-pair-picker ${compact ? "cdx-pair-picker--compact" : ""}`}>
    <div className="cdx-pair-picker__head">
      <label htmlFor={id}>Quote asset</label>
      <span>{pairKindLabel(asset)}</span>
    </div>
    <select id={id} className="mdx-input" value={asset.key} disabled={disabled} onChange={e => choose(e.target.value as PairAssetKey)} aria-describedby={`${id}-help`}>
      {([ ["native", "Native"], ["stable", "Stablecoin"], ["stock", "Tokenized stocks"], ["meme", "Memecoins"] ] as const).map(([kind,label]) =>
        <optgroup key={kind} label={label}>{PAIR_ASSETS.filter(a => a.kind === kind).map(a => <option key={a.key} value={a.key}>{a.symbol} · {a.name}</option>)}</optgroup>
      )}
    </select>
    <div id={`${id}-help`} className="cdx-pair-picker__hint">
      <strong>{getTradingPair(ticker ?? "YOUR TOKEN", asset.key)}</strong>
      <span>{balance ? `${balance} ${asset.symbol} ${live ? "wallet balance" : "test balance"}` : live ? "Solana mainnet · real assets" : "Demo · no real assets"}</span>
    </div>
    {bound ? <p className="cdx-pair-picker__binding">This finish is paired with {bound.symbol}. Choosing another quote offers a compatible finish.</p> : null}
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
