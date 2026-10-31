import { expect, test } from "bun:test";
import { z } from "zod";

import { key, num, oneOf, searchSchema, text } from "../../src/lib/mintdex/search";

// The route search validators replaced zod schemas of the form z.x().optional().catch(undefined). Same answers,
// ignoring keys zod keeps as undefined (the router drops those).
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const pairs = [
  [
    searchSchema({ q: text(40), sort: oneOf(["trending", "mcap"]), focus: num(), page: num() }),
    z.object({
      q: z.string().max(40).optional().catch(undefined),
      sort: z.enum(["trending", "mcap"]).optional().catch(undefined),
      focus: z.number().optional().catch(undefined),
      page: z.number().optional().catch(undefined),
    }),
  ],
  [
    searchSchema({ minted: num(true), tab: oneOf(["trade", "card"]) }),
    z.object({
      minted: z.number().int().optional().catch(undefined),
      tab: z.enum(["trade", "card"]).optional().catch(undefined),
    }),
  ],
] as const;

const inputs: Array<Record<string, unknown>> = [
  {},
  { q: "honk", sort: "mcap", focus: 3, page: 2, minted: 1, tab: "card" },
  { q: "x".repeat(41), sort: "bogus", focus: "3", page: Number.NaN, minted: 1.5, tab: 7 },
  { q: 12, focus: Infinity, page: -0, minted: -2, extra: "kept out" },
  { q: "", sort: null, focus: undefined, minted: "1" },
];

test("searchSchema answers like the zod schemas it replaced", () => {
  for (const [ours, zods] of pairs) {
    for (const input of inputs) expect(ours(input)).toEqual(defined(zods.parse(input)));
  }
});

test("a pair key that looks like a number survives the router's number parsing (?quote=67)", () => {
  const schema = searchSchema({ quote: key() });
  expect(schema({ quote: 67 })).toEqual({ quote: "67" });
  expect(schema({ quote: "67" })).toEqual({ quote: "67" });
  expect(schema({ quote: "sol" })).toEqual({ quote: "sol" });
  for (const quote of [6.7, -1, Number.NaN, Infinity, null, true]) expect(schema({ quote })).toEqual({});
});
