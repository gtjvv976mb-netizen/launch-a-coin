// Old coin links on devnet (lib/chain/coin-slug.ts, lib/chain/data.ts chainCoinLoader): /coin/honk, /coin/$HONK and
// /coin/comet-corgi answer 301 to /coin/{mint} when exactly one visible coin goes by the ticker or name slug; none or
// several is a 404 (several listed); a failing chain API is "unavailable", never a guess. No network: fetch plays the
// chain API's coins search (a substring match on name and symbol over visible coins, like the Worker's).
// Run: cd app && ~/.bun/bin/bun test tests/chain

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { isNotFound, isRedirect } from "@tanstack/react-router";

import {
  coinMatches,
  coinTerm,
  nameSlug,
  resolveCoinSlug,
  searchQuery,
} from "../../src/lib/chain/coin-slug";
import { chainCoinLoader, findCoinSlug } from "../../src/lib/chain/data";
import { API } from "./helpers";

type Coin = { mint: string; name: string; symbol: string; hidden?: boolean };

const HONK: Coin = {
  mint: "4WdMXAGBiFaVxU57tV6ohGjZPP5heXzntzScBTnXmint",
  name: "Honk",
  symbol: "HONK",
};
const CORGI: Coin = {
  mint: "5wuLNZrWnE666YpzcQqLgskjiPLdaW6AgjU9qmDdmint",
  name: "Comet Corgi",
  symbol: "CORGI",
};
const HONKER: Coin = {
  mint: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  name: "Honker",
  symbol: "HNKR",
};
const DUP_A: Coin = {
  mint: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  name: "Twin Alpha",
  symbol: "TWIN",
};
const DUP_B: Coin = {
  mint: "BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k",
  name: "Twin Beta",
  symbol: "TWIN",
};
const SECRET: Coin = {
  mint: "CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq",
  name: "Secret",
  symbol: "SECRT",
  hidden: true,
};

let coins: Coin[] = [];
let pageSize = 100;
let fail: "none" | "network" | "500" = "none";
let requests: URL[] = [];
const realFetch = globalThis.fetch;

function summary(c: Coin) {
  return { ...c, hidden: false, dexNo: 1, image: null, description: "", level: 1 };
}

beforeEach(() => {
  coins = [HONK, CORGI, HONKER, DUP_A, DUP_B, SECRET];
  pageSize = 100;
  fail = "none";
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    if (fail === "network") throw new TypeError("fetch failed");
    if (fail === "500")
      return Response.json(
        { ok: false, error: { code: "INTERNAL", message: "x" } },
        { status: 500 },
      );
    if (url.origin + url.pathname !== `${API}/coins`)
      return Response.json(
        { ok: false, error: { code: "NOT_FOUND", message: "x" } },
        { status: 404 },
      );
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    // The Worker leaves hidden coins out of every list and search.
    const hits = coins.filter(
      (c) =>
        !c.hidden &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.symbol.toLowerCase().includes(q) ||
          c.mint === q),
    );
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), pageSize);
    const page = hits.slice(offset, offset + limit);
    const next = offset + limit < hits.length ? String(offset + limit) : null;
    return Response.json({ ok: true, coins: page.map(summary), nextCursor: next, rev: "1" });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("terms", () => {
  test("name slugs", () => {
    expect(nameSlug("Comet Corgi")).toBe("comet-corgi");
    expect(nameSlug("  Comet__Corgi!! ")).toBe("comet-corgi");
    expect(nameSlug("Crème Brûlée")).toBe("creme-brulee");
    expect(nameSlug("Honk")).toBe("honk");
    expect(nameSlug("!!")).toBe("");
  });
  test("a leading $ goes, empty and overlong terms name nothing", () => {
    expect(coinTerm("$HONK")).toBe("HONK");
    expect(coinTerm(" honk ")).toBe("honk");
    expect(coinTerm("$")).toBeNull();
    expect(coinTerm("")).toBeNull();
    expect(coinTerm("a".repeat(65))).toBeNull();
  });
  test("search query: the term, or the longest word of a multi-word slug", () => {
    expect(searchQuery("HONK")).toBe("HONK");
    expect(searchQuery("comet-corgi")).toBe("comet");
    expect(searchQuery("Comet Corgi")).toBe("comet");
    expect(searchQuery("a-corgis")).toBe("corgis");
    expect(searchQuery("--")).toBeNull();
  });
  test("exact matches only: ticker, name or name slug, any casing", () => {
    for (const t of ["HONK", "honk", "Honk", "hOnK"]) expect(coinMatches(HONK, t)).toBe(true);
    for (const t of ["comet-corgi", "Comet Corgi", "COMET-CORGI", "comet_corgi", "corgi", "CORGI"])
      expect(coinMatches(CORGI, t)).toBe(true);
    for (const t of ["hon", "honks", "honk-1"]) expect(coinMatches(HONK, t)).toBe(false);
    for (const t of ["comet", "corg", "comet-corgis"]) expect(coinMatches(CORGI, t)).toBe(false);
  });
});

describe("resolveCoinSlug", () => {
  test("ticker, any casing, with or without $", async () => {
    for (const p of ["honk", "HONK", "$honk", "$HONK", "Honk"]) {
      expect(await resolveCoinSlug(p)).toEqual({
        status: "one",
        match: { mint: HONK.mint, name: "Honk", symbol: "HONK" },
      });
    }
  });
  test("name slug and ticker of a two-word name", async () => {
    for (const p of ["comet-corgi", "Comet Corgi", "corgi", "$CORGI"]) {
      const r = await resolveCoinSlug(p);
      expect(r.status).toBe("one");
      if (r.status === "one") expect(r.match.mint).toBe(CORGI.mint);
    }
  });
  test("a substring is not a match (honk does not pick Honker; hon names nothing)", async () => {
    expect((await resolveCoinSlug("honker")).status).toBe("one");
    expect(await resolveCoinSlug("hon")).toEqual({ status: "none" });
    expect(await resolveCoinSlug("nothing")).toEqual({ status: "none" });
  });
  test("several coins with one ticker are listed, not picked", async () => {
    const r = await resolveCoinSlug("$twin");
    expect(r.status).toBe("several");
    if (r.status === "several")
      expect(r.matches.map((m) => m.mint).sort()).toEqual([DUP_A.mint, DUP_B.mint].sort());
  });
  test("a hidden coin never matches, even if a list carried it", async () => {
    expect(await resolveCoinSlug("secret")).toEqual({ status: "none" });
    // A Worker that forgot the filter: the client still drops it.
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        coins: [{ ...summary(SECRET), hidden: true }],
        nextCursor: null,
        rev: "1",
      })) as unknown as typeof fetch;
    expect(await resolveCoinSlug("secret")).toEqual({ status: "none" });
  });
  test("reads the visible coins search with the term as q, and follows pages", async () => {
    pageSize = 1;
    coins = [
      HONKER,
      { ...HONKER, mint: "8yKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsV", symbol: "HNK2" },
      HONK,
    ];
    const r = await resolveCoinSlug("honk");
    expect(r.status).toBe("one");
    expect(requests.length).toBe(3);
    expect(requests.every((u) => u.searchParams.get("q") === "honk")).toBe(true);
  });
  test("no request for a term that names nothing", async () => {
    expect(await resolveCoinSlug("$")).toEqual({ status: "none" });
    expect(requests.length).toBe(0);
  });
  test("a failing chain API throws (the caller decides)", async () => {
    fail = "500";
    await expect(resolveCoinSlug("honk")).rejects.toMatchObject({ code: "INTERNAL" });
    fail = "network";
    await expect(resolveCoinSlug("honk")).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("chainCoinLoader for old links", () => {
  async function thrown(p: Promise<unknown>): Promise<unknown> {
    try {
      await p;
    } catch (e) {
      return e;
    }
    throw new Error("expected the loader to throw");
  }

  test("one match: 301 to /coin/{mint}, query string kept", async () => {
    const e = (await thrown(chainCoinLoader("$HONK", { tab: "card" }))) as Response & {
      options: Record<string, unknown>;
    };
    expect(isRedirect(e)).toBe(true);
    expect(e.status).toBe(301);
    expect(e.options.to).toBe("/coin/$id");
    expect(e.options.params).toEqual({ id: HONK.mint });
    expect(e.options.search).toEqual({ tab: "card" });
  });
  test("no match: 404 with kind none", async () => {
    const e = (await thrown(chainCoinLoader("nothing"))) as { data?: unknown };
    expect(isNotFound(e)).toBe(true);
    expect(e.data).toEqual({ kind: "none" });
  });
  test("several: 404 that lists them", async () => {
    const e = (await thrown(chainCoinLoader("twin"))) as {
      data?: { kind: string; matches?: Array<{ mint: string }> };
    };
    expect(isNotFound(e)).toBe(true);
    expect(e.data?.kind).toBe("several");
    expect(e.data?.matches?.length).toBe(2);
  });
  test("chain API down: 404 marked unavailable (the page asks again in the browser), never a 500", async () => {
    fail = "network";
    const e = (await thrown(chainCoinLoader("honk"))) as { data?: unknown };
    expect(isNotFound(e)).toBe(true);
    expect(e.data).toEqual({ kind: "unavailable" });
    expect(await findCoinSlug("honk")).toEqual({ kind: "unavailable" });
  });
  test("a mint param never goes through the search", async () => {
    const e = await thrown(chainCoinLoader("1111111111111111111111111111111111111111"));
    expect(isNotFound(e)).toBe(true);
    expect(requests.some((u) => u.pathname.endsWith("/coins"))).toBe(false);
  });
});

describe("copy", () => {
  const APP = path.resolve(import.meta.dir, "../..");
  for (const f of [
    "src/lib/chain/coin-slug.ts",
    "src/components/chain/pages/ChainCoinNotFound.tsx",
  ]) {
    test(`${f}: no em dashes, en dashes or middle dots`, () => {
      expect(fs.readFileSync(path.join(APP, f), "utf8")).not.toMatch(/[—–·]/);
    });
  }
});
