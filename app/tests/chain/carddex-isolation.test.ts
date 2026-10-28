import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { MODE, IS_SIM, IS_CHAIN } from "../../src/lib/mintdex/mode";
import { DEVNET_ANCHORS } from "../../src/lib/chain/anchors.devnet";
import { MAINNET_ANCHORS } from "../../src/lib/chain/anchors.mainnet";
import { CHAIN_API_ORIGIN, PUBLIC_RPC_URL } from "../../src/lib/chain/env";
import { manifestModeOf, webManifestText } from "../../src/lib/mintdex/manifest";

const APP = resolve(import.meta.dir, "../..");
describe("CardDex has no inherited live deployment", () => {
  test("runtime and manifest select simulation, with empty operational anchors", () => {
    expect(MODE).toBe("sim"); expect(IS_SIM).toBe(true); expect(IS_CHAIN).toBe(false);
    for (const requested of [undefined, "mainnet", "devnet", "sim", "other"]) expect(manifestModeOf(requested)).toBe("sim");
    expect(JSON.parse(webManifestText("sim")).name).toBe("CardDex");
    for (const anchors of [DEVNET_ANCHORS, MAINNET_ANCHORS]) {
      for (const key of ["programId", "configAddress", "altA", "altB", "altC", "altTreasury"] as const) expect(anchors[key]).toBe("");
      expect(anchors.chainApiOrigin).toBe("http://127.0.0.1:8788");
      expect(anchors.publicRpc).toBe("http://127.0.0.1:8899");
    }
    expect(CHAIN_API_ORIGIN).toBe("http://127.0.0.1:8788");
    expect(PUBLIC_RPC_URL).toBe("http://127.0.0.1:8899");
  });
  test("build configuration refuses either inherited or CardDex chain-mode activation", async () => {
    const script = `import { loadConfigFromFile } from 'vite'; await loadConfigFromFile({command:'build',mode:'production'});`;
    for (const variable of ["VITE_MINTDEX_MODE", "VITE_CARDDEX_MODE"]) {
      const child = Bun.spawn([process.execPath, "-e", script], { cwd: APP, env: { ...process.env, VITE_MINTDEX_MODE: "sim", VITE_CARDDEX_MODE: "sim", [variable]: "mainnet" }, stdout: "pipe", stderr: "pipe" });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code).not.toBe(0);
      expect(stderr).toContain("Only isolated simulation is enabled");
    }
  });
  test("local config has no remote resources or copied deployment configs", () => {
    const config = readFileSync(resolve(APP, "wrangler.jsonc"), "utf8");
    expect(config).not.toMatch(/mintdex-site|6a725cff|mintdex\.fun|service"\s*:/);
    expect(existsSync(resolve(APP, "wrangler.cloudflare.jsonc"))).toBe(false);
    expect(existsSync(resolve(APP, "wrangler.cloudflare.mainnet.jsonc"))).toBe(false);
    expect(readFileSync(resolve(APP, "src/lib/mintdex/server/auth.server.ts"), "utf8")).toContain('SESSION_COOKIE = "carddex_session"');
  });
});
