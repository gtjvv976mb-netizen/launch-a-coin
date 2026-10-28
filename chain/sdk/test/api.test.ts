// The mintdex-chain API contract module (refs/chain/m3-contract.md §3): route table, SIWS message format,
// import-free api entry, and the scaffolded stubs that worker:core fills in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../src/api/index.ts";
import * as sdk from "../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("api entry and api/types.ts import nothing (safe for the app's main chunk)", () => {
  for (const f of ["src/api/index.ts", "src/api/types.ts", "src/api/siws.ts"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    const imports = [...src.matchAll(/^\s*import\s.+from\s+"([^"]+)"/gm)].map((m) => m[1]);
    if (f === "src/api/index.ts") assert.deepEqual(imports, []);
    else assert.deepEqual(imports, [], `${f} imports ${imports.join(", ")}`);
  }
  const quote = readFileSync(join(ROOT, "src/quote.ts"), "utf8");
  const qi = [...quote.matchAll(/^\s*import\s.+from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(qi.every((m) => m === "./bytes.ts"), `quote.ts may import only ./bytes.ts, found ${qi.join(", ")}`);
});

test("the SDK index re-exports the api contract", () => {
  assert.equal(sdk.API_ROUTES, api.API_ROUTES);
  assert.equal(typeof sdk.buildSiwsMessage, "function");
  assert.equal(typeof sdk.compileV0Message, "function");
  assert.equal(typeof sdk.quoteCurveBuyExactSol, "function");
});

test("route table: unique ids and paths, /api/chain prefix, fixed tx paths listed before tx/:kind", () => {
  const entries = Object.entries(api.API_ROUTES);
  const keys = entries.map(([, r]) => `${r.method} ${r.path}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const [, r] of entries) assert.ok(r.path.startsWith(api.CHAIN_API_PREFIX + "/"), r.path);
  const order = entries.map(([id]) => id);
  assert.ok(order.indexOf("txSubmit") < order.indexOf("txBuild"));
  assert.ok(order.indexOf("txStatus") < order.indexOf("txBuild"));
  assert.ok(!api.API_TX_KINDS.includes("submit" as never) && !api.API_TX_KINDS.includes("status" as never));
});

test("error codes are unique upper snake case", () => {
  assert.equal(new Set(api.API_ERROR_CODES).size, api.API_ERROR_CODES.length);
  for (const c of api.API_ERROR_CODES) assert.match(c, /^[A-Z][A-Z0-9_]+$/);
});

test("SIWS message builds and parses back exactly, and rejects edits", () => {
  const fields = {
    domain: "mintdex.fun",
    address: "BiHs2Ds6u3tHrmD5CzoHAyR79uC5VhdPH51ii4Y7dFtQ",
    uri: "https://mintdex.fun",
    nonce: "Q2xhdWRlTWludERleE5vbmNlMDE",
    issuedAt: "2026-10-04T08:00:00.000Z",
    expirationTime: "2026-10-04T08:10:00.000Z",
  };
  const msg = api.buildSiwsMessage(fields);
  assert.equal(msg.split("\n")[0], "mintdex.fun wants you to sign in with your Solana account:");
  assert.ok(msg.includes(api.SIWS_STATEMENT));
  assert.ok(!/[\u2013\u2014\u00b7]/.test(msg), "no en dashes, em dashes or middle dots");
  assert.deepEqual(api.parseSiwsMessage(msg), fields);
  assert.equal(api.parseSiwsMessage(msg + "\n"), null);
  assert.equal(api.parseSiwsMessage(msg.replace("Version: 1", "Version: 2")), null);
  assert.equal(api.parseSiwsMessage(msg.replace(fields.nonce, "short")), null);
  assert.throws(() => api.buildSiwsMessage({ ...fields, domain: "evil.example\nURI: x" }));
  const dev = api.buildSiwsMessage({ ...fields, domain: "127.0.0.1:8787", uri: "http://127.0.0.1:8787" });
  assert.equal(api.parseSiwsMessage(dev)?.domain, "127.0.0.1:8787");
});

test("quote helpers that are already real: slippage bounds and curve progress", () => {
  assert.equal(sdk.slippageFloor(1_000_000n, 500), 950_000n);
  assert.equal(sdk.slippageCeil(1_000_000n, 100), 1_010_000n);
  assert.equal(sdk.slippageCeil(1n, 1), 2n);
  const r = sdk.INITIAL_REAL_TOKEN_RESERVES;
  assert.equal(sdk.curveProgressBps({ realTokenReserves: r, complete: false }), 0);
  assert.equal(sdk.curveProgressBps({ realTokenReserves: r / 2n, complete: false }), 5_000);
  assert.equal(sdk.curveProgressBps({ realTokenReserves: 5n, complete: true }), 10_000);
});
