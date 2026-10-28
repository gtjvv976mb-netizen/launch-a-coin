import { describe, expect, test } from "bun:test";
import { MAINNET_GENESIS_HASH } from "../../src/lib/chain/build-guard";
import { createLiveHealthHandler } from "../../src/lib/carddex/live/health.server";
import type { LiveReadiness } from "../../src/lib/carddex/live/types";

const SECRET = "provider-secret-must-never-appear", ENDPOINT = `https://provider.example/rpc/${SECRET}?key=${SECRET}`;
const readiness = (configured = true): LiveReadiness => ({ implemented: true, configured, enabled: false, ready: false,
  recoveryEnabled: true, recoveryReady: configured, network: "solana-mainnet-beta", publicOrigin: "https://launchacard.fun", blockers: [SECRET] });
function fixture() {
  let time = 1_798_000_000_000, endpoint: string | undefined = ENDPOINT;
  const calls: { url: string; init: RequestInit; payload: any }[] = [];
  let respond = async (payload: any) => Response.json({ jsonrpc: "2.0", id: payload.id, result: payload.method === "getGenesisHash" ? MAINNET_GENESIS_HASH : { absoluteSlot: 462_400_000, blockHeight: 440_000_000 } });
  const handler = createLiveHealthHandler({ readiness, rpcUrl: () => endpoint, now: () => time, timeoutMs: 20,
    fetch: async (url, init) => { const payload = JSON.parse(init.body as string); calls.push({ url, init, payload }); return respond(payload); } });
  return { handler, calls, advance: (ms: number) => time += ms, endpoint: (value: string | undefined) => endpoint = value,
    respond: (fn: typeof respond) => respond = fn };
}

describe("sanitized read-only mainnet release health", () => {
  test("works while launches are disabled and makes only the two fixed finalized reads", async () => {
    const rpc = fixture(), response = await rpc.handler(), body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ ok: true, readiness: { configured: true, enabled: false, ready: false, recoveryEnabled: true, recoveryReady: true, network: "solana-mainnet-beta", publicOrigin: "https://launchacard.fun" },
      rpc: { status: "healthy", checkedAt: new Date(1_798_000_000_000).toISOString(), finalizedSlot: 462_400_000, finalizedBlockHeight: 440_000_000 } });
    expect(rpc.calls.map(call => call.payload)).toEqual([
      { jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] },
      { jsonrpc: "2.0", id: 2, method: "getEpochInfo", params: [{ commitment: "finalized" }] },
    ]);
    for (const call of rpc.calls) { expect(call.init.method).toBe("POST"); expect(call.init.redirect).toBe("manual"); }
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
  test("reports the new-launch and recovery switches separately", async () => {
    for (const [enabled, recoveryEnabled] of [[false, true], [true, true], [false, false]]) {
      const handler = createLiveHealthHandler({ readiness: () => ({ ...readiness(), enabled, ready: enabled && recoveryEnabled, recoveryEnabled, recoveryReady: recoveryEnabled }), rpcUrl: () => ENDPOINT,
        fetch: async (_url, init) => { const payload = JSON.parse(init.body as string); return Response.json({ jsonrpc: "2.0", id: payload.id, result: payload.method === "getGenesisHash" ? MAINNET_GENESIS_HASH : { absoluteSlot: 20, blockHeight: 10 } }); } });
      const body = await (await handler()).json();
      expect(body.readiness).toMatchObject({ enabled, ready: enabled && recoveryEnabled, recoveryEnabled, recoveryReady: recoveryEnabled });
    }
  });
  test("the default transport invokes global fetch with its global receiver", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = (async function (this: unknown, _url: unknown, init?: RequestInit) {
        expect(this).toBe(globalThis); calls++;
        const payload = JSON.parse(init!.body as string);
        return Response.json({ jsonrpc: "2.0", id: payload.id, result: payload.method === "getGenesisHash" ? MAINNET_GENESIS_HASH : { absoluteSlot: 20, blockHeight: 10 } });
      }) as typeof fetch;
      const handler = createLiveHealthHandler({ readiness, rpcUrl: () => ENDPOINT });
      const response = await handler(); expect(response.status).toBe(200); expect((await response.json()).rpc.status).toBe("healthy");
      expect(calls).toBe(2);
    } finally { globalThis.fetch = original; }
  });
  test("shares in-flight and settled results for15seconds and refreshes after expiry or provider change", async () => {
    const rpc = fixture(); await Promise.all(Array.from({ length: 20 }, () => rpc.handler()));
    expect(rpc.calls).toHaveLength(2); rpc.advance(14_999); await rpc.handler(); expect(rpc.calls).toHaveLength(2);
    rpc.advance(1); await rpc.handler(); expect(rpc.calls).toHaveLength(4);
    rpc.endpoint("https://second-provider.example/new-secret"); await rpc.handler(); expect(rpc.calls).toHaveLength(6);
  });
  test("missing or invalid secret is unconfigured without making any network request", async () => {
    const rpc = fixture();
    for (const value of [undefined, "", "http://provider.example/key", "https://user:secret@provider.example", "https://mintdex.fun/rpc"]) {
      rpc.endpoint(value); const response = await rpc.handler(); expect(response.status).toBe(503);
      const body = await response.json(); expect(body.rpc.status).toBe("unconfigured"); expect(body.readiness.configured).toBe(false);
    }
    expect(rpc.calls).toHaveLength(0);
  });
  test("wrong cluster never passes the release check or echoes its upstream response", async () => {
    const rpc = fixture(); rpc.respond(async payload => Response.json({ jsonrpc: "2.0", id: payload.id, result: payload.method === "getGenesisHash" ? SECRET : { absoluteSlot: 20, blockHeight: 10 } }));
    const response = await rpc.handler(), text = await response.text(); expect(response.status).toBe(503);
    expect(JSON.parse(text).rpc.status).toBe("wrong_network"); expect(text).not.toContain(SECRET); expect(text).not.toContain(ENDPOINT);
  });
  test("an enabled configured deployment stays not ready when the RPC network or reachability check fails", async () => {
    for (const failure of ["wrong_network", "unavailable"]) {
      const handler = createLiveHealthHandler({ readiness: () => ({ ...readiness(), enabled: true, ready: true }), rpcUrl: () => ENDPOINT,
        fetch: async (_url, init) => {
          if (failure === "unavailable") return new Response(SECRET, { status: 403 });
          const payload = JSON.parse(init.body as string);
          return Response.json({ jsonrpc: "2.0", id: payload.id, result: payload.method === "getGenesisHash" ? "different-cluster" : { absoluteSlot: 20, blockHeight: 10 } });
        } });
      const response = await handler(), body = await response.json();
      expect(response.status).toBe(503); expect(body.ok).toBe(false); expect(body.rpc.status).toBe(failure);
      expect(body.readiness).toMatchObject({ configured: true, enabled: true, ready: false, recoveryEnabled: true, recoveryReady: false });
    }
  });
  test("redirects, upstream403, malformed bank data, JSON-RPC errors and thrown secrets are sanitized and cached", async () => {
    for (const { respond, reason, upstreamStatus } of [
      { reason: "http_error", upstreamStatus: 403, respond: async () => new Response(SECRET, { status: 403, headers: { "x-provider-secret": SECRET } }) },
      { reason: "http_error", upstreamStatus: 302, respond: async () => new Response(null, { status: 302, headers: { location: `https://elsewhere.example/${SECRET}` } }) },
      { reason: "invalid_response", upstreamStatus: undefined, respond: async (payload: any) => Response.json({ jsonrpc: "2.0", id: payload.id, result: payload.method === "getGenesisHash" ? MAINNET_GENESIS_HASH : { absoluteSlot: 0, blockHeight: 1 } }) },
      { reason: "invalid_response", upstreamStatus: undefined, respond: async (payload: any) => Response.json({ jsonrpc: "2.0", id: payload.id, error: { message: ENDPOINT } }) },
      { reason: "invalid_response", upstreamStatus: undefined, respond: async () => new Response(SECRET) },
      { reason: "network_error", upstreamStatus: undefined, respond: async () => { throw new Error(ENDPOINT); } },
    ]) {
      const rpc = fixture(); rpc.respond(respond); const response = await rpc.handler(), text = await response.text();
      expect(response.status).toBe(503); expect(JSON.parse(text).rpc.status).toBe("unavailable");
      expect(JSON.parse(text).rpc.reason).toBe(reason); expect(JSON.parse(text).rpc.upstreamStatus).toBe(upstreamStatus);
      expect(text).not.toContain(SECRET); expect(text).not.toContain(ENDPOINT); expect(response.headers.get("x-provider-secret")).toBeNull();
      await rpc.handler(); expect(rpc.calls).toHaveLength(2);
    }
  });
  test("a stalled provider is bounded even when its fetch ignores abort", async () => {
    const rpc = fixture(); rpc.respond(async () => new Promise<Response>(() => {}));
    const started = Date.now(), response = await rpc.handler();
    expect(Date.now() - started).toBeLessThan(500); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.rpc.status).toBe("unavailable"); expect(body.rpc.reason).toBe("timeout");
    expect(body.rpc.upstreamStatus).toBeUndefined(); expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(rpc.calls.every(call => call.init.signal?.aborted)).toBe(true);
  });
});
