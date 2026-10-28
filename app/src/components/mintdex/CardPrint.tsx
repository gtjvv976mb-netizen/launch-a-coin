import type { CSSProperties } from "react";
import { getCardDesign } from "../../lib/carddex/designs";

import { dexNo, usdCompact } from "../../lib/mintdex/format";
import type { Box, FrameLayout, Tier } from "../../lib/mintdex/tiers";
import type { CardData } from "./MintCard";

/** Shared original-card positioning; premium templates change decoration, never the print layout. */
export function boxStyle(box: Box, grow = 0): CSSProperties {
  return {
    left: `${(box.x - grow) * 100}%`,
    top: `${(box.y - grow * 0.66) * 100}%`,
    width: `${(box.w + grow * 2) * 100}%`,
    height: `${(box.h + grow * 1.32) * 100}%`,
  };
}

function MintAddress({ address }: { address: string }) {
  return <>
    {address.slice(0, 3)}
    <span className="mdx-card__long">{address.slice(3, 5)}</span>...
    <span className="mdx-card__suffix">{address.slice(-4)}</span>
  </>;
}

/** The original MintDex name, ticker, lore, token rows and footer, shared without layout variants. */
export function CardPrint({ card, layout, tier, preview = false }: { card: CardData; layout: FrameLayout; tier: Tier; preview?: boolean }) {
  const [footA, footB] = layout.footer;
  const stock = getCardDesign(card.cardTemplate).stock;
  // A local creator mock-up has no verified tier, holder count or token address. Real cards retain every value.
  const unquoted = preview && card.dexNo <= 0 && !card.mintAddress && card.dexLabel !== "Sample";
  const ownerHandle = unquoted ? undefined : card.ownerHandle;
  return <>
    <div className="mdx-card__name" data-card-slot="name" style={boxStyle(layout.name)}>
      <span className="mdx-card__title">{card.name}</span>
      <span className="mdx-card__numeral" aria-hidden>1/1</span>
    </div>
    <div className="mdx-card__type" data-card-slot="ticker" style={boxStyle(layout.type)}>
      <span className="mdx-card__ticker">${card.ticker}</span>
      <span>{stock?.pair ?? (unquoted ? "Preview" : "Trading card")}</span>
    </div>
    <div className="mdx-card__text" data-card-slot="details" style={boxStyle(layout.text)}>
      <p className="mdx-card__lore" data-card-slot="description">{card.lore || (unquoted ? "Your token's story will appear here." : "A fresh coin in the dex. Its story is still being written.")}</p>
      <div className="mdx-card__rows">
        <div className="mdx-card__row" data-card-slot="address">
          <span><span className="mdx-card__long">Token address</span><span className="mdx-card__short">Address</span></span>
          <i />
          <b>{card.mintAddress ? <MintAddress address={card.mintAddress} /> : card.dexLabel === "Sample" ? "Sample token" : card.dexNo > 0 ? "Demo token" : "—"}</b>
        </div>
        <div className="mdx-card__row" data-card-slot="market-cap">
          <span>Market cap</span><i /><b>{card.mcapLabel ?? usdCompact(card.mcapUsd)}</b>
        </div>
        <div className="mdx-card__row mdx-card__row--holders" data-card-slot="holders">
          <span>Holders</span><i /><b>{unquoted ? "—" : card.holders}</b>
        </div>
      </div>
    </div>
    {footA ? <div className="mdx-card__foot" data-card-slot="creator" style={boxStyle(footA)}>
      <span className="mdx-card__clip">{ownerHandle ? <><span className="mdx-card__long">Owner </span>@{ownerHandle}</> : "CardDex"}</span>
      {ownerHandle && card.ownerIsBot ? <span className="mdx-card__bot">bot</span> : null}
    </div> : null}
    {footB ? <div className="mdx-card__foot mdx-card__foot--end" data-card-slot="serial" style={boxStyle(footB)}>
      {card.dexLabel ?? (unquoted ? "Preview" : dexNo(card.dexNo))}
    </div> : null}
  </>;
}
