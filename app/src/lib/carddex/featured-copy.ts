import { getCardDesign } from "./designs";
import { marketCapText } from "./quote-display";

type FeaturedCoin = { name: string; cardTemplate?: string; mcapUsd?: number | null; mcapQuote?: number; quoteAssetKey?: string | null };

/** A coin's one creator-chosen design, as Home's design chip prints it. */
export function designChipText(coin: { cardTemplate?: string }): string {
  return `${getCardDesign(coin.cardTemplate).name} design`;
}

/**
 * What Home's featured stepper announces after a manual step (INTEGRITY-1): the same design the chip shows, never
 * the inherited market-cap tier name.
 */
export function featuredStepText(coin: FeaturedCoin, position: number, count: number): string {
  return `${coin.name}, ${designChipText(coin)}, market cap ${marketCapText(coin)}, ${position} of ${count}`;
}
