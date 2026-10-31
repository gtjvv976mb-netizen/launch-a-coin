import type { CardData } from "../../../components/mintdex/MintCard";
import renderAssets from "../render-assets.json";
import tokenBackAssets from "../token-back-assets.json";
import { archivedDesignVersion } from "../design-versions";
import { getPairAsset } from "../pairs";

type ComposedCard = Pick<CardData, "cardTemplate" | "quoteAssetKey" | "designVersion">;
const own = <T,>(record: Record<string, T>, key: string) => (Object.hasOwn(record, key) ? record[key] : undefined);

/**
 * The flattened atlas a creator print is composed on: the card's pinned version when it carries an archived one
 * (design-versions.ts), else the current atlas. A stock pair takes the design's --stock finish.
 */
export function creatorAtlas(card: ComposedCard): { path: string } | undefined {
  const key = (card.cardTemplate || "") + (getPairAsset(card.quoteAssetKey || "sol").kind === "stock" ? "--stock" : "");
  const archived = archivedDesignVersion(card.cardTemplate, card.designVersion);
  return archived ? own(archived.atlases, key) : own(renderAssets as Record<string, { path: string }>, key);
}

/** The token-image reverse of the card's pinned version, else the current one. */
export function creatorTokenBack(card: ComposedCard): { path: string } | undefined {
  const archived = archivedDesignVersion(card.cardTemplate, card.designVersion);
  return archived ? archived.tokenBack : own(tokenBackAssets as Record<string, { path: string }>, card.cardTemplate || "");
}
