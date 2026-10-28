import type { CardDesignKey } from "./designs";

export type GeneratedCardAssets = { front?: string; back?: string; front320?: string; back320?: string };

/**
 * Add a path only after the generated local file exists and has passed visual/identity review.
 * An empty entry keeps the complete native design. No speculative or provider job URLs belong here.
 */
export const CARD_GENERATED_ASSETS: Partial<Record<CardDesignKey, GeneratedCardAssets>> = {
  "pokemon-classic": {"front": "/assets/carddex/higgsfield/pokemon-classic-front.webp", "back": "/assets/carddex/higgsfield/pokemon-classic-back.webp", "front320": "/assets/carddex/higgsfield/pokemon-classic-front-320.webp", "back320": "/assets/carddex/higgsfield/pokemon-classic-back-320.webp"},
  "pokemon-full-art": {"front": "/assets/carddex/higgsfield/pokemon-full-art-front.webp", "back": "/assets/carddex/higgsfield/pokemon-full-art-back.webp", "front320": "/assets/carddex/higgsfield/pokemon-full-art-front-320.webp", "back320": "/assets/carddex/higgsfield/pokemon-full-art-back-320.webp"},
  "yugioh-monster": {"front": "/assets/carddex/higgsfield/yugioh-monster-front.webp", "back": "/assets/carddex/higgsfield/yugioh-monster-back.webp", "front320": "/assets/carddex/higgsfield/yugioh-monster-front-320.webp", "back320": "/assets/carddex/higgsfield/yugioh-monster-back-320.webp"},
  "yugioh-spell": {"front": "/assets/carddex/higgsfield/yugioh-spell-front.webp", "back": "/assets/carddex/higgsfield/yugioh-spell-back.webp", "front320": "/assets/carddex/higgsfield/yugioh-spell-front-320.webp", "back320": "/assets/carddex/higgsfield/yugioh-spell-back-320.webp"},
  "magic-etched": {"front": "/assets/carddex/higgsfield/magic-etched-front.webp", "back": "/assets/carddex/higgsfield/magic-etched-back.webp", "front320": "/assets/carddex/higgsfield/magic-etched-front-320.webp", "back320": "/assets/carddex/higgsfield/magic-etched-back-320.webp"},
  "duel-masters": {"front": "/assets/carddex/higgsfield/duel-masters-front.webp", "back": "/assets/carddex/higgsfield/duel-masters-back.webp", "front320": "/assets/carddex/higgsfield/duel-masters-front-320.webp", "back320": "/assets/carddex/higgsfield/duel-masters-back-320.webp"},
  "one-piece": {"front": "/assets/carddex/higgsfield/one-piece-front.webp", "back": "/assets/carddex/higgsfield/one-piece-back.webp", "front320": "/assets/carddex/higgsfield/one-piece-front-320.webp", "back320": "/assets/carddex/higgsfield/one-piece-back-320.webp"},
  "obsidian-archive": {"front": "/assets/carddex/higgsfield/obsidian-archive-front.webp", "back": "/assets/carddex/higgsfield/obsidian-archive-back.webp", "front320": "/assets/carddex/higgsfield/obsidian-archive-front-320.webp", "back320": "/assets/carddex/higgsfield/obsidian-archive-back-320.webp"},
  "stock-gme": {"front": "/assets/carddex/higgsfield/stock-gme-front.webp", "back": "/assets/carddex/higgsfield/stock-gme-back.webp", "front320": "/assets/carddex/higgsfield/stock-gme-front-320.webp", "back320": "/assets/carddex/higgsfield/stock-gme-back-320.webp"},
  "stock-tsla": {"front": "/assets/carddex/higgsfield/stock-tsla-front.webp", "back": "/assets/carddex/higgsfield/stock-tsla-back.webp", "front320": "/assets/carddex/higgsfield/stock-tsla-front-320.webp", "back320": "/assets/carddex/higgsfield/stock-tsla-back-320.webp"},
  "stock-nvda": {"front": "/assets/carddex/higgsfield/stock-nvda-front.webp", "back": "/assets/carddex/higgsfield/stock-nvda-back.webp", "front320": "/assets/carddex/higgsfield/stock-nvda-front-320.webp", "back320": "/assets/carddex/higgsfield/stock-nvda-back-320.webp"},
  "stock-aapl": {"front": "/assets/carddex/higgsfield/stock-aapl-front.webp", "back": "/assets/carddex/higgsfield/stock-aapl-back.webp", "front320": "/assets/carddex/higgsfield/stock-aapl-front-320.webp", "back320": "/assets/carddex/higgsfield/stock-aapl-back-320.webp"},
  "stock-mstr": {"front": "/assets/carddex/higgsfield/stock-mstr-front.webp", "back": "/assets/carddex/higgsfield/stock-mstr-back.webp", "front320": "/assets/carddex/higgsfield/stock-mstr-front-320.webp", "back320": "/assets/carddex/higgsfield/stock-mstr-back-320.webp"},
  "stock-coin": {"front": "/assets/carddex/higgsfield/stock-coin-front.webp", "back": "/assets/carddex/higgsfield/stock-coin-back.webp", "front320": "/assets/carddex/higgsfield/stock-coin-front-320.webp", "back320": "/assets/carddex/higgsfield/stock-coin-back-320.webp"},
  "spark": {"front": "/assets/carddex/higgsfield/spark-front.webp", "back": "/assets/carddex/higgsfield/spark-back.webp", "front320": "/assets/carddex/higgsfield/spark-front-320.webp", "back320": "/assets/carddex/higgsfield/spark-back-320.webp"},
  "surge": {"front": "/assets/carddex/higgsfield/surge-front.webp", "back": "/assets/carddex/higgsfield/surge-back.webp", "front320": "/assets/carddex/higgsfield/surge-front-320.webp", "back320": "/assets/carddex/higgsfield/surge-back-320.webp"},
  "nova": {"front": "/assets/carddex/higgsfield/nova-front.webp", "back": "/assets/carddex/higgsfield/nova-back.webp", "front320": "/assets/carddex/higgsfield/nova-front-320.webp", "back320": "/assets/carddex/higgsfield/nova-back-320.webp"},
  "tide": {"front": "/assets/carddex/higgsfield/tide-front.webp", "back": "/assets/carddex/higgsfield/tide-back.webp", "front320": "/assets/carddex/higgsfield/tide-front-320.webp", "back320": "/assets/carddex/higgsfield/tide-back-320.webp"},
  "apex": {"front": "/assets/carddex/higgsfield/apex-front.webp", "back": "/assets/carddex/higgsfield/apex-back.webp", "front320": "/assets/carddex/higgsfield/apex-front-320.webp", "back320": "/assets/carddex/higgsfield/apex-back-320.webp"},
  "ember": {"front": "/assets/carddex/higgsfield/ember-front.webp", "back": "/assets/carddex/higgsfield/ember-back.webp", "front320": "/assets/carddex/higgsfield/ember-front-320.webp", "back320": "/assets/carddex/higgsfield/ember-back-320.webp"},
  "bloom": {"front": "/assets/carddex/higgsfield/bloom-front.webp", "back": "/assets/carddex/higgsfield/bloom-back.webp", "front320": "/assets/carddex/higgsfield/bloom-front-320.webp", "back320": "/assets/carddex/higgsfield/bloom-back-320.webp"},
  "mythic": {"front": "/assets/carddex/higgsfield/mythic-front.webp", "back": "/assets/carddex/higgsfield/mythic-back.webp", "front320": "/assets/carddex/higgsfield/mythic-front-320.webp", "back320": "/assets/carddex/higgsfield/mythic-back-320.webp"},
  "aurora": {"front": "/assets/carddex/higgsfield/aurora-front.webp", "back": "/assets/carddex/higgsfield/aurora-back.webp", "front320": "/assets/carddex/higgsfield/aurora-front-320.webp", "back320": "/assets/carddex/higgsfield/aurora-back-320.webp"},
  "relic": {"front": "/assets/carddex/higgsfield/relic-front.webp", "back": "/assets/carddex/higgsfield/relic-back.webp", "front320": "/assets/carddex/higgsfield/relic-front-320.webp", "back320": "/assets/carddex/higgsfield/relic-back-320.webp"},
  "frost": {"front": "/assets/carddex/higgsfield/frost-front.webp", "back": "/assets/carddex/higgsfield/frost-back.webp", "front320": "/assets/carddex/higgsfield/frost-front-320.webp", "back320": "/assets/carddex/higgsfield/frost-back-320.webp"},
  "regal": {"front": "/assets/carddex/higgsfield/regal-front.webp", "back": "/assets/carddex/higgsfield/regal-back.webp", "front320": "/assets/carddex/higgsfield/regal-front-320.webp", "back320": "/assets/carddex/higgsfield/regal-back-320.webp"},
  "celestial": {"front": "/assets/carddex/higgsfield/celestial-front.webp", "back": "/assets/carddex/higgsfield/celestial-back.webp", "front320": "/assets/carddex/higgsfield/celestial-front-320.webp", "back320": "/assets/carddex/higgsfield/celestial-back-320.webp"},
  "legend": {"front": "/assets/carddex/higgsfield/legend-front.webp", "back": "/assets/carddex/higgsfield/legend-back.webp", "front320": "/assets/carddex/higgsfield/legend-front-320.webp", "back320": "/assets/carddex/higgsfield/legend-back-320.webp"},
  "doge": {"front": "/assets/carddex/higgsfield/doge-front.webp", "back": "/assets/carddex/higgsfield/doge-back.webp", "front320": "/assets/carddex/higgsfield/doge-front-320.webp", "back320": "/assets/carddex/higgsfield/doge-back-320.webp"},
  "pepe": {"front": "/assets/carddex/higgsfield/pepe-front.webp", "back": "/assets/carddex/higgsfield/pepe-back.webp", "front320": "/assets/carddex/higgsfield/pepe-front-320.webp", "back320": "/assets/carddex/higgsfield/pepe-back-320.webp"},
  "shib": {"front": "/assets/carddex/higgsfield/shib-front.webp", "back": "/assets/carddex/higgsfield/shib-back.webp", "front320": "/assets/carddex/higgsfield/shib-front-320.webp", "back320": "/assets/carddex/higgsfield/shib-back-320.webp"},
  "bonk": {"front": "/assets/carddex/higgsfield/bonk-front.webp", "back": "/assets/carddex/higgsfield/bonk-back.webp", "front320": "/assets/carddex/higgsfield/bonk-front-320.webp", "back320": "/assets/carddex/higgsfield/bonk-back-320.webp"},
  "wif": {"front": "/assets/carddex/higgsfield/wif-front.webp", "back": "/assets/carddex/higgsfield/wif-back.webp", "front320": "/assets/carddex/higgsfield/wif-front-320.webp", "back320": "/assets/carddex/higgsfield/wif-back-320.webp"},
  "popcat": {"front": "/assets/carddex/higgsfield/popcat-front.webp", "back": "/assets/carddex/higgsfield/popcat-back.webp", "front320": "/assets/carddex/higgsfield/popcat-front-320.webp", "back320": "/assets/carddex/higgsfield/popcat-back-320.webp"},
  "gamestop": {"front": "/assets/carddex/higgsfield/gamestop-front.webp", "back": "/assets/carddex/higgsfield/gamestop-back.webp", "front320": "/assets/carddex/higgsfield/gamestop-front-320.webp", "back320": "/assets/carddex/higgsfield/gamestop-back-320.webp"},
  "amc": {"front": "/assets/carddex/higgsfield/amc-front.webp", "back": "/assets/carddex/higgsfield/amc-back.webp", "front320": "/assets/carddex/higgsfield/amc-front-320.webp", "back320": "/assets/carddex/higgsfield/amc-back-320.webp"},
  "blackberry": {"front": "/assets/carddex/higgsfield/blackberry-front.webp", "back": "/assets/carddex/higgsfield/blackberry-back.webp", "front320": "/assets/carddex/higgsfield/blackberry-front-320.webp", "back320": "/assets/carddex/higgsfield/blackberry-back-320.webp"},
  "nokia": {"front": "/assets/carddex/higgsfield/nokia-front.webp", "back": "/assets/carddex/higgsfield/nokia-back.webp", "front320": "/assets/carddex/higgsfield/nokia-front-320.webp", "back320": "/assets/carddex/higgsfield/nokia-back-320.webp"},
  "coinbase": {"front": "/assets/carddex/higgsfield/coinbase-front.webp", "back": "/assets/carddex/higgsfield/coinbase-back.webp", "front320": "/assets/carddex/higgsfield/coinbase-front-320.webp", "back320": "/assets/carddex/higgsfield/coinbase-back-320.webp"},
  "binance": {"front": "/assets/carddex/higgsfield/binance-front.webp", "back": "/assets/carddex/higgsfield/binance-back.webp", "front320": "/assets/carddex/higgsfield/binance-front-320.webp", "back320": "/assets/carddex/higgsfield/binance-back-320.webp"},
  "kraken": {"front": "/assets/carddex/higgsfield/kraken-front.webp", "back": "/assets/carddex/higgsfield/kraken-back.webp", "front320": "/assets/carddex/higgsfield/kraken-front-320.webp", "back320": "/assets/carddex/higgsfield/kraken-back-320.webp"},
  "strategy": {"front": "/assets/carddex/higgsfield/strategy-front.webp", "back": "/assets/carddex/higgsfield/strategy-back.webp", "front320": "/assets/carddex/higgsfield/strategy-front-320.webp", "back320": "/assets/carddex/higgsfield/strategy-back-320.webp"},
  "wildtype": {"front": "/assets/carddex/higgsfield/wildtype-front.webp", "back": "/assets/carddex/higgsfield/wildtype-back.webp", "front320": "/assets/carddex/higgsfield/wildtype-front-320.webp", "back320": "/assets/carddex/higgsfield/wildtype-back-320.webp"},
  "ronin": {"front": "/assets/carddex/higgsfield/ronin-front.webp", "back": "/assets/carddex/higgsfield/ronin-back.webp", "front320": "/assets/carddex/higgsfield/ronin-front-320.webp", "back320": "/assets/carddex/higgsfield/ronin-back-320.webp"},
  "astral": {"front": "/assets/carddex/higgsfield/astral-front.webp", "back": "/assets/carddex/higgsfield/astral-back.webp", "front320": "/assets/carddex/higgsfield/astral-front-320.webp", "back320": "/assets/carddex/higgsfield/astral-back-320.webp"},
  "neon-circuit": {"front": "/assets/carddex/higgsfield/neon-circuit-front.webp", "back": "/assets/carddex/higgsfield/neon-circuit-back.webp", "front320": "/assets/carddex/higgsfield/neon-circuit-front-320.webp", "back320": "/assets/carddex/higgsfield/neon-circuit-back-320.webp"},
  "sovereign": {"front": "/assets/carddex/higgsfield/sovereign-front.webp", "back": "/assets/carddex/higgsfield/sovereign-back.webp", "front320": "/assets/carddex/higgsfield/sovereign-front-320.webp", "back320": "/assets/carddex/higgsfield/sovereign-back-320.webp"},
  "abyssal": {"front": "/assets/carddex/higgsfield/abyssal-front.webp", "back": "/assets/carddex/higgsfield/abyssal-back.webp", "front320": "/assets/carddex/higgsfield/abyssal-front-320.webp", "back320": "/assets/carddex/higgsfield/abyssal-back-320.webp"}
};

export function generatedCardAssets(key?: string): GeneratedCardAssets {
  return key && Object.prototype.hasOwnProperty.call(CARD_GENERATED_ASSETS, key)
    ? CARD_GENERATED_ASSETS[key as CardDesignKey] ?? {}
    : {};
}

/**
 * A generated face's srcset: the 320 px copy, the 640 px copy written beside it (<base>-640.webp, so 2x phones stop
 * at about 640 px) and the 1260 px original.
 */
export function generatedSrcSet(small: string, full: string) {
  const mid = /-320\.webp$/.test(small) ? `${small.replace(/-320\.webp$/, "-640.webp")} 640w, ` : "";
  return `${small} 320w, ${mid}${full} 1260w`;
}
