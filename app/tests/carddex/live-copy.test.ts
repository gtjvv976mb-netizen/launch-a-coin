import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The live mainnet flow states the actual platform fee: none. The audit found no Launch a Card transfer in the coin
// or card transaction (no System instruction; the program allowlists exclude it).
const APP = resolve(import.meta.dir, "../..");
const LIVE = resolve(APP, "src/components/carddex/live");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");

describe("live launch fee disclosure", () => {
  test("no fill-in placeholder remains in the live launch flow", () => {
    for (const file of [...readdirSync(LIVE).map(name => `src/components/carddex/live/${name}`), "src/routes/launch.tsx"]) expect(read(file)).not.toContain("[TO FILL");
  });
  test("the transaction terms say there is no platform fee and name what the creator pays", () => {
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    expect(panel).toContain("Launch a Card charges no platform fee.");
    expect(panel).toContain("Solana network and priority fees, account rent for the new coin and card, and pump.fun's protocol and creator fees inside any initial buy");
  });
  test("legal changes only the platform-fee row and keeps every other fill slot", () => {
    const legal = read("src/routes/legal.tsx");
    expect(legal).toContain("Launch a Card currently adds no fee to launch or card transactions.");
    expect(legal).not.toContain("<Fill>platform fee per launch</Fill>");
    for (const slot of ["operator legal name", "contact email", "governing law", "minimum age", "platform share of trading fees, or none", "typical total in SOL", "link to pump.fun fee schedule"]) expect(legal).toContain(`<Fill>${slot}</Fill>`);
  });
});
