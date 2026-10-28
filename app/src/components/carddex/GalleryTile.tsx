/**
 * The browse screens' gallery tiles (Discover's coins, the Designs library). One tile = the card, unchanged, and a
 * short caption under it in the UI face with tabular figures. The card is the picture and the only colour; the
 * caption is ink and slate, and gold appears only as the curve fill (CurveTrack). Styles: styles/screens/browse.css.
 */
import { Link } from "@tanstack/react-router";

import { MintCard, type CardData } from "../mintdex/MintCard";
import { View3DHost, type View3DItem } from "../mintdex/card3d";
import { ButtonLink, Change, CurveTrack, Icon } from "../mintdex/ui";
import { getCardDesign, type CardDesign } from "../../lib/carddex/designs";
import { marketCapText } from "../../lib/carddex/quote-display";
import type { CoinSummary } from "../../lib/mintdex/types";

/** "up 11.0%", "down 2.3%", "unchanged": the change in words for the tile's accessible name. */
function changeWords(v: number) {
  const pct = Number.isFinite(v) ? Math.abs(v * 100) : 0;
  const text = pct >= 100 ? pct.toFixed(0) : pct.toFixed(1);
  if (text === "0.0") return "unchanged in 24 hours";
  return `${v > 0 ? "up" : "down"} ${text}% in 24 hours`;
}

function curveWords(coin: CoinSummary) {
  if (coin.graduated) return "graduated";
  if (coin.curveProgress == null || !Number.isFinite(coin.curveProgress))
    return "curve not available";
  return `curve ${Math.round(Math.min(1, Math.max(0, coin.curveProgress)) * 100)}%`;
}

/**
 * A Discover coin: one link around the card and its caption (one tab stop to open the coin, one for View in 3D,
 * which sits on the card's top right corner outside the face, shown at rest). Caption: name and market cap, ticker
 * and the 24h change, then the bonding-curve track.
 */
export function CoinTile({
  coin,
  list,
  priority = false,
  sizes,
}: {
  coin: CoinSummary;
  /** Every coin on the page, so the 3D viewer can step through them. */
  list: View3DItem[];
  priority?: boolean;
  sizes: string;
}) {
  const mc = marketCapText(coin);
  const label = `${coin.name} $${coin.ticker}, market cap ${mc === "—" ? "not available" : mc}, ${changeWords(coin.change24h)}, ${curveWords(coin)}, ${getCardDesign(coin.cardTemplate).name} design`;
  return (
    <article className="cdx-token-cell">
      <View3DHost item={{ id: coin.id, card: coin }} list={list} btnClassName="mdx-v3dbtn--stage">
        <Link
          to="/coin/$id"
          params={{ id: coin.id }}
          className="cdx-token-cell__link"
          aria-label={label}
        >
          <div className="cdx-token-cell__card">
            <MintCard
              card={coin}
              depth="table"
              idle="turntable"
              priority={priority}
              sizes={sizes}
            />
          </div>
          <div className="cdx-token-cell__caption">
            <div className="cdx-token-cell__row">
              <h2 className="cdx-token-cell__name">{coin.name}</h2>
              <span className="cdx-token-cell__mc">
                <span className="cdx-token-cell__unit">MC</span>{" "}
                {mc === "—" ? (
                  <span className="mdx-dash">—</span>
                ) : (
                  <span className="num">{mc}</span>
                )}
              </span>
            </div>
            <div className="cdx-token-cell__row cdx-token-cell__row--meta">
              <span className="cdx-token-cell__ticker">${coin.ticker}</span>
              <Change v={coin.change24h} />
            </div>
            <CurveTrack
              size="sm"
              progress={coin.curveProgress}
              graduated={coin.graduated}
              className="cdx-token-cell__curve"
            />
          </div>
        </Link>
      </View3DHost>
    </article>
  );
}

const COLLECTION: Record<CardDesign["category"], string> = {
  classic: "Classic",
  premium: "Premium",
  limited: "Limited",
  stocks: "Stock",
};

/**
 * A Designs library tile: a button that previews the design (aria-pressed when it is the selected one), and its own
 * "Use" link that goes straight to /launch with this design and the pair the tile shows (one click, density R5). The
 * card is a flat print of the sample coin in this design; the caption names it, then its collection and the pair it
 * launches with ("Classic · SOL pair"). Selected: an inset ink ring and a check on the print's corner, never a gold
 * fill; the ring is an outline, so selecting never changes the tile's size.
 */
export function DesignTile({
  design,
  card,
  pairSymbol,
  pressed,
  onPick,
  launch,
  sizes,
}: {
  design: CardDesign;
  /** The sample coin dressed in this design (and this tile's quote). */
  card: CardData;
  pairSymbol: string;
  pressed: boolean;
  onPick: () => void;
  /** Where "Use" goes: /launch with this design and the quote the tile shows. */
  launch: { design: string; quote: string };
  sizes: string;
}) {
  return (
    <div className="cdx-design-tile" data-selected={pressed || undefined}>
      <button
        type="button"
        className="cdx-design-tile__pick"
        aria-pressed={pressed}
        onClick={onPick}
      >
        <span className="cdx-design-tile__art" aria-hidden>
          <MintCard card={card} depth="flat" sizes={sizes} />
        </span>
        <span className="cdx-design-tile__name">{design.name}</span>
        <span className="cdx-design-tile__meta">
          {COLLECTION[design.category]} · {pairSymbol} pair
        </span>
      </button>
      <ButtonLink
        to="/launch"
        search={launch}
        variant="outline"
        size="sm"
        className="cdx-design-tile__use"
      >
        Use<span className="sr-only"> {design.name}</span>
      </ButtonLink>
      {pressed ? (
        <span className="cdx-design-tile__check" aria-hidden>
          <Icon name="check" size={12} strokeWidth={2} />
        </span>
      ) : null}
    </div>
  );
}
