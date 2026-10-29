import type { FrameLayout } from "../mintdex/tiers";

/** One front print for all designs. Original source coordinates select decoration only. */
const layout: FrameLayout & { radius: number } = {
  aspect: 63 / 88,
  radius: .0504,
  window: { x: .10, y: .15, w: .80, h: .44 },
  name: { x: .10, y: .055, w: .80, h: .06 },
  type: { x: .10, y: .615, w: .80, h: .034 },
  text: { x: .10, y: .67, w: .80, h: .255 },
  footer: [],
};
for (const box of [layout.window, layout.name, layout.type, layout.text, ...layout.footer]) Object.freeze(box);
Object.freeze(layout.footer);
export const CANONICAL_CARD_LAYOUT = Object.freeze(layout);
export const CANONICAL_CARD_TEMPLATE = "launchacard-v2";
export const CARD_RENDERER_VERSION = "launchacard-canonical-v2.1";

/** Width-relative print metrics shared by browser CSS and trusted SVG export. */
export const CANONICAL_CARD_PRINT = Object.freeze({
  title: 6, numeral: 3.7, type: 2.9, lore: 3.75, loreLine: 1.3,
  row: 3.05, rowLine: 1.15, rowGap: .7,
  nameInset: 3.8, typeInset: 3, detailsInset: 5,
  detailsTop: 3, detailsBottom: 4.4, rowsTop: 1.4, artRadius: 1.1,
});
