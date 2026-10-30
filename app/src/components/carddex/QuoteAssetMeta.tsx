import { PAIR_ASSETS_SOURCE, chargesTransferFee, getPairAsset, isDirectPair } from "../../lib/carddex/pairs";
import { Icon } from "../mintdex/ui";

/**
 * The pair's safety facts, all visible (under Launch's pair HUD; no disclosure): the asset and its
 * issuer, the full mint linked to Solscan (its name starts with the visible mint, WCAG 2.5.3), when the mint was
 * reviewed (and, for a pair pump.fun's program admits that its public list leaves out, that fact), each terms link,
 * then what the quote does and does not do.
 */
export function QuoteAssetMeta({ quoteAssetKey, live = false, named = false }: {
  quoteAssetKey: string; live?: boolean;
  /** Something beside it already names the asset, so only the issuer is added here. */
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
    {isDirectPair(asset) ? <p className="cdx-pair-meta__direct">Not on pump.fun's public pairs list; admitted on-chain (checked {asset.verifiedAt}).</p> : null}
    <p className="cdx-pair-meta__links">
      {asset.issuerTerms ? external(asset.issuerTerms, "Issuer terms") : null}
      {asset.listingProviderTerms ? external(asset.listingProviderTerms, `${asset.listingProvider ?? "Listing"} terms`) : null}
      {external(PAIR_ASSETS_SOURCE, "pump.fun pairs")}
    </p>
    {asset.kind === "stock" ? <p>A tokenized-stock quote does not make your coin company shares.</p> : null}
    {live ? <p>The exact mint is checked again before wallet review.</p> : null}
    {live && chargesTransferFee(asset.key) ? <p className="cdx-pair-meta__direct">Mainnet launches can't use this pair yet: its mint charges a transfer fee.</p> : null}
  </div>;
}
