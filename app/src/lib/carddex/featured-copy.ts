import { getCardDesign } from "./designs";

type FeaturedCoin = { name: string; cardTemplate?: string };

/** A coin's one creator-chosen design, as Home's design chip prints it. */
export function designChipText(coin: { cardTemplate?: string }): string {
  return `${getCardDesign(coin.cardTemplate).name} design`;
}

/**
 * What Home's featured stepper announces after a manual step (INTEGRITY-1): the same design the chip shows, never
 * the inherited market-cap tier name. The site reads no market data, so no figure is said.
 */
export function featuredStepText(coin: FeaturedCoin, position: number, count: number): string {
  return `${coin.name}, ${designChipText(coin)}, ${position} of ${count}`;
}
