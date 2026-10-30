import quotes from "./pair-assets.json";
import { CARD_GENERATED_ASSETS } from "./generated-assets";
import layouts from "./generated-layouts.json";
import atlases from "./render-assets.json";
import reverses from "./token-back-assets.json";
import reviewed from "../../../../integrations/pumpfun/src/design-assets.json";
import { STAGED_PAIR_DESIGNS, isPairDesignInstalled, type PairDesignInstallation } from "./pair-designs";

type Install = Required<PairDesignInstallation>;

/**
 * Test-only (keeps the manifests out of the browser bundle): the staged pair designs whose front, back, measured
 * layout, reviewed sources, atlas and token back are all installed with matching hashes, by Codex's exact rule.
 * A test holds ACTIVE_PAIR_DESIGNS equal to this, so a missing or mismatched asset fails the gates, not the page.
 */
export function installedPairDesignKeys(): string[] {
  return STAGED_PAIR_DESIGNS.filter(design => {
    const quote = quotes.find(asset => asset.key === design.quoteKey);
    const atlasKey = design.key + (design.category === "stocks" ? "--stock" : "");
    return isPairDesignInstalled(design, {
      assets: (CARD_GENERATED_ASSETS as Record<string, Install["assets"]>)[design.key],
      layout: (layouts as Record<string, unknown>)[design.key],
      source: (reviewed as Record<string, Install["source"]>)[design.key],
      atlas: (atlases as Record<string, Install["atlas"]>)[atlasKey],
      reverse: (reverses as Record<string, Install["reverse"]>)[design.key],
      quoteMint: quote?.mint,
    });
  }).map(design => design.key);
}
