import { CARD_DESIGNS } from "../../app/src/lib/carddex/designs";
import { MEME_ICON_CATALOG } from "../../app/src/lib/mintdex/meme-icons";
import { DESIGN_QUOTE_KEYS, MEME_PAIR_PRESETS } from "../../app/src/lib/carddex/design-pairings";
import pairAssets from "../../app/src/lib/carddex/pair-assets.json";
import renderAssets from "../../app/src/lib/carddex/render-assets.json";
import backAssets from "../../app/src/lib/carddex/token-back-assets.json";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../../", import.meta.url));
const categoryOrder = ["classic", "premium", "limited", "stocks"];
const styles: Record<string, string> = {
  "pokemon-classic": "Warm yellow-gold enamel and polished collector metalwork.",
  "pokemon-full-art": "Sapphire, silver and opalescent prism detailing.",
  "yugioh-monster": "Copper marbling, antique gold and a sculpted vortex back.",
  "yugioh-spell": "Deep emerald lacquer, engraved silver and a fiery vortex.",
  "magic-etched": "Dark bronze, grimoire engraving and gem-set gold.",
  "duel-masters": "Sapphire enamel, satin gold and jewel-cut fittings.",
  "one-piece": "Scarlet enamel, gold ropework and nautical detailing.",
  "obsidian-archive": "Obsidian, electrum inlay and faceted vault metalwork.",
  spark: "Pearl stone, platinum lines and polished mineral fittings.",
  surge: "Cobalt enamel, brushed silver and bolt-cut metalwork.",
  nova: "Lilac pearl, silver stars and opalescent detailing.",
  tide: "Teal enamel, engraved waves and polished silver.",
  apex: "Champagne gold, crown engravings and sculpted rosettes.",
  ember: "Vermilion enamel, copper flames and burnished fittings.",
  bloom: "Rose enamel, pearl embossing and sculpted blossoms.",
  mythic: "Black crystal, chrome lines and diamond-cut metalwork.",
  aurora: "Amethyst lacquer, silver crescents and luminous opal.",
  relic: "Antique bronze, sunbursts and compass engraving.",
  frost: "Ice-blue enamel, crystalline platinum and faceted silver.",
  regal: "Crimson enamel, raised gold scrollwork and ruby fittings.",
  celestial: "Cosmic prism, silver constellations and sapphire settings.",
  legend: "Engraved gold leaf, emerald fittings and a laurel reverse.",
  doge: "Smoked obsidian, satin gold and sculpted Doge relief.",
  pepe: "Nephrite jade, malachite, palladium and a frog relief back.",
  shib: "Vermilion lacquer, ivory porcelain and a Shiba relief back.",
  bonk: "Orange enamel, navy composite, titanium and a BONK reverse.",
  wif: "Tobacco suede, cable knit and a pink-beanie portrait back.",
  popcat: "Cobalt porcelain, ivory ceramic and a sculpted Popcat back.",
  gamestop: "Scarlet enamel, forged titanium and gaming-hardware detail.",
  amc: "Burgundy, champagne gold and fan-shaped Art Deco detailing.",
  blackberry: "Black zirconia, plum enamel and keyboard-device relief.",
  nokia: "Ivory ceramic, cobalt enamel and classic mobile detailing.",
  coinbase: "Cobalt architecture, frosted acrylic and clean metalwork.",
  binance: "Black enamel, precise gold inlay and a geometric vault.",
  kraken: "Violet glass, engraved waterlines and polished silver.",
  strategy: "Machined graphite, architectural orange and metal fittings.",
  wildtype: "Emerald foil, creature-battler details and enamel accents.",
  ronin: "Ivory paper, woodblock linework and vermilion lacquer.",
  astral: "Midnight, lavender silver, star charts and opal foil.",
  "neon-circuit": "Graphite, cyan signal rails and coral circuit accents.",
  sovereign: "Obsidian lacquer, antique gold and archival engraving.",
  abyssal: "Blue-green specimen glass, silver and waterline engraving.",
  "stock-gme": "Crimson enamel, black console hardware and silver controls.",
  "stock-tsla": "Pearl ceramic, titanium and electric-red conductor rails.",
  "stock-nvda": "Obsidian silicon, emerald circuitry and precision fittings.",
  "stock-aapl": "Satin titanium, pearl ceramic and machined metalwork.",
  "stock-mstr": "Burnished copper, vault steel and stacked medallions.",
  "stock-coin": "Cobalt enamel, polished palladium and a cut-metal vault.",
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const data = [];
for (const category of categoryOrder) {
  for (const design of CARD_DESIGNS.filter(d => d.category === category)) {
    const front = (renderAssets as any)[design.key] ?? (renderAssets as any)[`${design.key}--stock`];
    const back = (backAssets as any)[design.key];
    if (!front || !back) throw new Error(`Missing images: ${design.key}`);
    const frontBytes = await readFile(project + "app/public" + front.path);
    const backBytes = await readFile(project + "app/public" + back.path);
    if (sha(frontBytes) !== front.sha256 || sha(backBytes) !== back.sha256) throw new Error(`Hash mismatch: ${design.key}`);
    const pairKeys = [...new Set([
      (DESIGN_QUOTE_KEYS as any)[design.key],
      ...MEME_PAIR_PRESETS.filter(p => p.design === design.key).map(p => p.quote),
    ].filter(Boolean))];
    const pairs = pairKeys.map(key => {
      const asset = pairAssets.find(a => a.key === key);
      if (!asset) throw new Error(`Unknown pair ${key}`);
      return {key: asset.key, symbol: asset.symbol, name: asset.name};
    });
    data.push({
      number: data.length + 1, key: design.key, name: design.name,
      category: design.category,
      theme: MEME_ICON_CATALOG.find(i => i.key === design.key)?.inspiration ?? null,
      look: styles[design.key] ?? design.description,
      description: design.description,
      pairs,
      front: {path: "app/public" + front.path, sha256: front.sha256},
      back: {path: "app/public" + back.path, sha256: back.sha256},
    });
  }
}
if (data.length !== 48 || new Set(data.map(d => d.key)).size !== 48) throw new Error("Catalogue must contain 48 unique designs");
await writeFile(project + "brand/card-design-catalogue-2026-10-30/catalogue.json", JSON.stringify({
  title: "Launch a Card - Design Catalogue", date: "2026-10-30", count: data.length,
  note: "Actual existing Higgsfield artwork. Front content fields are intentionally blank to show each reusable template. Pair labels describe configured catalogue presets, not newly verified live admission.",
  designs: data,
}, null, 2) + "\n");
console.log(JSON.stringify({count: data.length, verifiedImageHashes: data.length * 2, categories: Object.fromEntries(categoryOrder.map(c => [c, data.filter(d => d.category === c).length]))}));
