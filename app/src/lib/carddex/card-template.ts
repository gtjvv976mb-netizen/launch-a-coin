import type { FrameLayout } from "../mintdex/tiers";

/** The original MintDex/Spark print grid, shared by every creator-selected CardDex skin. */
const layout: FrameLayout = {
  aspect: 63 / 88,
  radius: .0504,
  window: { x: .0889, y: .1374, w: .8254, h: .3957 },
  name: { x: .077, y: .0553, w: .8471, h: .0529 },
  type: { x: .0911, y: .5553, w: .82, h: .03 },
  text: { x: .09, y: .6043, w: .8221, h: .2251 },
  footer: [
    { x: .0857, y: .8949, w: .3254, h: .0229 },
    { x: .5879, y: .8949, w: .3286, h: .0229 },
  ],
};
for (const box of [layout.window, layout.name, layout.type, layout.text, ...layout.footer]) Object.freeze(box);
Object.freeze(layout.footer);
export const CANONICAL_CARD_LAYOUT = Object.freeze(layout);
export const CANONICAL_CARD_TEMPLATE = "mintdex-v1";
