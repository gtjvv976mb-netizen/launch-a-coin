/**
 * Discover's coin tiles (styles/screens/browse.css) and the design miniature the Designs table, strip and Launch's
 * design chips share (styles/screens/designs.css). One tile = the card, unchanged, and a short caption under it in
 * the UI face with tabular figures.
 */
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { MintCard, type CardData } from "../mintdex/MintCard";
import { View3DHost, type View3DItem } from "../mintdex/card3d";
import { Change, CurveTrack } from "../mintdex/ui";
import { getCardDesign, type CardDesign } from "../../lib/carddex/designs";
import { marketCapText } from "../../lib/carddex/quote-display";
import type { CoinSummary } from "../../lib/mintdex/types";

/**
 * A Discover coin: one link around the card and its caption (one tab stop to open the coin, one for View in 3D,
 * which sits over the art window's lower right corner, shown at rest). Caption: name and market cap, ticker and the
 * 24h change, then the bonding-curve track.
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
  return (
    <article className="cdx-token-cell">
      <View3DHost item={{ id: coin.id, card: coin }} list={list} btnClassName="mdx-v3dbtn--stage">
        {/* The link is named by its caption as shown (label in name, WCAG 2.5.3), with the words a screen reader
            needs in sr-only text; the card above it is the same coin, so it stays out of the name. */}
        <Link
          to="/coin/$id"
          params={{ id: coin.id }}
          className="cdx-token-cell__link"
        >
          <div className="cdx-token-cell__card" aria-hidden>
            <MintCard
              card={coin}
              depth="table"
              idle="turntable"
              priority={priority}
              sizes={sizes}
            />
          </div>
          <div className="cdx-token-cell__caption">
            {/* A market cap in its quote ("38.84K DOGE") may take a line of its own under the name (browse.css). */}
            <div className="cdx-token-cell__row" data-wrap={coin.mcapUsd == null || undefined}>
              <h2 className="cdx-token-cell__name">{coin.name}</h2>
              <span className="cdx-token-cell__mc">
                <span className="cdx-token-cell__unit" aria-hidden>MC</span>
                <span className="sr-only">, market cap</span>{" "}
                {mc === "—" ? (
                  <><span className="mdx-dash" aria-hidden>—</span><span className="sr-only">not available</span></>
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
            <span className="sr-only">, {getCardDesign(coin.cardTemplate).name} design</span>
          </div>
        </Link>
      </View3DHost>
    </article>
  );
}

/** A design's collection, as the Designs table, its caption and Launch's library name it. */
export const COLLECTION: Record<CardDesign["category"], string> = {
  classic: "Classic",
  premium: "Premium",
  limited: "Limited",
  stocks: "Stock",
  memes: "Meme",
  crypto: "Crypto",
};

/**
 * A design's miniature: a 12 x 17 card shape in the design's own three colours (its palette), the way the MintDex
 * chrome names a design with a frame mini. Pale palettes keep an edge from the image outline. Decorative: the name
 * always sits beside it.
 */
export function DesignMini({ design, className = "" }: { design: CardDesign; className?: string }) {
  const [a, b, c] = design.palette;
  return (
    <span
      aria-hidden
      className={`cdx-design-mini ${className}`}
      style={{ "--d1": a, "--d2": b, "--d3": c } as CSSProperties}
    />
  );
}
