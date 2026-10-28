/** Product terms for an unpurchased preview, never proof of an entitlement or creator identity. */
export function LimitedEditionOwnership({
  templateName,
  tokenName,
  tokenTicker,
  tokenMint,
  isCustomPreview,
}: {
  templateName: string;
  tokenName: string;
  tokenTicker: string;
  tokenMint: string | null;
  isCustomPreview: boolean;
}) {
  return (
    <section className="mdx-limited-ownership" aria-labelledby="limited-ownership-title" data-testid="limited-ownership">
      <h3 id="limited-ownership-title">What a purchase will include</h3>
      <dl className="mdx-limited-ownership__outcomes">
        <div>
          <dt>Permanent token design</dt>
          <dd>Your token keeps its styling, even if you sell the collectible.</dd>
        </div>
        <div>
          <dt>A separate collectible NFT</dt>
          <dd>Delivered to the verified creator’s wallet. Keep it, transfer it or sell it to any collector.</dd>
        </div>
      </dl>
      <details className="mdx-limited-ownership__details" data-testid="limited-ownership-details">
        <summary>Ownership & resale</summary>
        <div className="mdx-limited-ownership__body">
          <dl className="mdx-limited-ownership__selection" aria-label="Current preview">
            <div><dt>Design</dt><dd data-testid="limited-ownership-design">{templateName}</dd></div>
            <div><dt>Token</dt><dd data-testid="limited-ownership-token">{tokenName} <span>(${tokenTicker})</span></dd></div>
            {tokenMint ? <div className="mdx-limited-ownership__mint"><dt>Mint</dt><dd>{tokenMint}</dd></div> : null}
          </dl>
          <p className="mdx-limited-ownership__preview" data-testid="limited-ownership-preview-notice">
            {isCustomPreview ? "Custom artwork preview. No token has been verified." : "Public token preview. Selecting a token does not verify that you are its creator."}
          </p>
          <p>At release, only the verified original creator can commission the initial edition. The NFT stays linked to that token; a future owner cannot replace it with another coin.</p>
          <p>One collectible per token and design, within a lifetime release cap announced before purchase. Selling or burning an NFT will not reopen its mint slot.</p>
          <p>Resale transfers the collectible only. The token keeps its design. The buyer receives no creator fees, token control or reusable template license.</p>
          <p className="mdx-limited-ownership__preview">Nothing is reserved, applied or minted by this preview.</p>
        </div>
      </details>
    </section>
  );
}
