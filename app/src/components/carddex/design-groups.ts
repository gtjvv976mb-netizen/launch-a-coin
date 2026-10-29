import type { CardDesign } from "../../lib/carddex/designs";
import { boundQuoteForDesign, recommendedMemeQuoteForDesign } from "../../lib/carddex/pairs";

/**
 * The design collections, in one order with one set of short names, shared by the Designs page and Launch's
 * "All designs" dialog (so the chips read the same on both screens and fit one line).
 */
export const DESIGN_GROUPS = [
  { key: "all", name: "All" },
  { key: "classic", name: "Classics" },
  { key: "premium", name: "Premium" },
  { key: "stocks", name: "Stock pairs" },
  { key: "memes", name: "Meme pairs" },
  { key: "limited", name: "Limited" },
] as const;
export type DesignGroup = (typeof DESIGN_GROUPS)[number]["key"];

/** Whether a design belongs to a collection: stock pairs by their bound quote, meme pairs by a suggested meme quote. */
export function inDesignGroup(design: CardDesign, group: string): boolean {
  return group === "all" ||
    (group === "stocks"
      ? boundQuoteForDesign(design.key)?.kind === "stock"
      : group === "memes"
        ? !!recommendedMemeQuoteForDesign(design.key)
        : design.category === group);
}
