import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  higgsfieldDesignInspectorVitePlugin,
  higgsfieldDesignSourceBabelPlugin,
} from "./src/module/design-inspector/vite";
import svgr from "vite-plugin-svgr";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { mainnetBuildProblems } from "./src/lib/chain/build-guard";
import { MAINNET_ANCHORS } from "./src/lib/chain/anchors.mainnet";
import { manifestFileName, manifestModeOf, webManifestText, type ManifestMode } from "./src/lib/mintdex/manifest";
import { clientRegistryCopy } from "./src/lib/carddex/client-registry-fields";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Keep WebAssembly a static Worker module; runtime compilation is unavailable on Cloudflare. */
function creatorRendererWasm(): Plugin {
  const wasmPath=fileURLToPath(new URL("./node_modules/@resvg/resvg-wasm/index_bg.wasm",import.meta.url));
  return {
    name:"launchacard-renderer-wasm",
    resolveId(id) { if(id==="virtual:launchacard-resvg-wasm")return {id:"launchacard-resvg.wasm",external:true}; },
    generateBundle(_options,bundle) {
      if(this.environment?.name==="client")return;
      const emitted=new Set<string>();
      for(const chunk of Object.values(bundle)) {
        if(chunk.type!=="chunk"||!chunk.code.includes("launchacard-resvg.wasm"))continue;
        chunk.code=chunk.code.replace(/(["'])launchacard-resvg\.wasm\1/g,'"./launchacard-resvg.wasm"');
        const fileName=path.posix.join(path.posix.dirname(chunk.fileName),"launchacard-resvg.wasm");
        if(!emitted.has(fileName)){this.emitFile({type:"asset",fileName,source:readFileSync(wasmPath)});emitted.add(fileName);}
      }
    },
  };
}

/**
 * The client copies of render-assets.json, pair-assets.json and pair-logos.json keep only the fields the browser reads
 * (readiness audit PERF-1; src/lib/carddex/client-registry-fields.ts names them). The server bundle and the tests keep
 * all three files whole.
 */
function clientRegistryFields(): Plugin {
  const dir = path.join(fileURLToPath(new URL("./src/lib/carddex/", import.meta.url)));
  return {
    name: "launchacard-client-registry-fields",
    enforce: "pre",
    transform(code, id) {
      if (this.environment?.name !== "client") return;
      const file = id.split("?")[0]!;
      const copy = path.dirname(file) + path.sep === dir ? clientRegistryCopy(path.basename(file), code) : undefined;
      if (copy === undefined) return;
      return { code: copy, map: null };
    },
  };
}

// The vendored @higgsfield/quanta components import their glyphs from the private
// Nexus-only `@higgsfield-ai/icons`. Generated sites build on the PUBLIC npm
// registry, so we redirect every `@higgsfield-ai/icons/*` import to a Material
// Symbols shim instead (see src/lib/quanta-material-icons.ts). tsconfig.json has
// the matching `paths` entry so type-checking resolves it too.
const QUANTA_ICONS_SHIM = fileURLToPath(
  new URL("./src/lib/quanta-material-icons.ts", import.meta.url),
);

// M3 (refs/chain/m3-contract.md §7.4): @mintdex/chain-sdk is source in ../chain/sdk (no package install).
// "/api" and "/quote" import nothing heavy; the full entry (verifier, builders) is only for lazy chunks.
// The platform build installs app/ only, so @noble/* must resolve from app/node_modules (dedupe below).
const CHAIN_SDK = (p: string) => fileURLToPath(new URL(`../chain/sdk/src/${p}`, import.meta.url));

/**
 * The build's own web manifest (src/lib/mintdex/manifest.ts): emitted into the client output under a mode-specific
 * name and served by the dev server, so a mainnet build never carries the devnet or test-mode manifest.
 */
function modeManifest(mode: ManifestMode): Plugin {
  const fileName = manifestFileName(mode);
  const text = webManifestText(mode);
  return {
    name: "mintdex-mode-manifest",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== `/${fileName}`) return next();
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(text);
      });
    },
    generateBundle() {
      if (this.environment?.name !== "client") return;
      this.emitFile({ type: "asset", fileName, source: text });
    },
  };
}

export default defineConfig(({ mode }) => {
  const designInspectorEnabled = process.env.HF_DESIGN_INSPECTOR === "1" || mode === "design";
  // fix-plan §4.4, launch-plan §3.3: a mainnet build needs the ACK and a filled anchors.mainnet.ts (API origin, browser
  // RPC, ALTs, treasury from deployed.mainnet.json through app/scripts/mainnet-anchors.mjs); else it fails here.
  const viteEnv = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env } as Record<string, string | undefined>;
  if (viteEnv.VITE_MINTDEX_MODE && viteEnv.VITE_MINTDEX_MODE !== "sim" || viteEnv.VITE_CARDDEX_MODE && viteEnv.VITE_CARDDEX_MODE !== "sim") {
    throw new Error("CardDex chain deployment is not configured. Only isolated simulation is enabled.");
  }
  const appMode = manifestModeOf("sim");
  if (appMode === "mainnet") {
    const problems = mainnetBuildProblems(viteEnv, MAINNET_ANCHORS);
    if (problems.length) throw new Error(`refusing the mainnet build:\n  - ${problems.join("\n  - ")}`);
  }

  return {
    resolve: {
      alias: [
        // The Worker has no filesystem wallet or Anchor workspace. Use Anchor's official browser build.
        { find: /^@coral-xyz\/anchor$/, replacement: fileURLToPath(new URL("../integrations/pumpfun/node_modules/@coral-xyz/anchor/dist/browser/index.js",import.meta.url)) },
        { find: /^@higgsfield-ai\/icons(\/.*)?$/, replacement: QUANTA_ICONS_SHIM },
        { find: /^@mintdex\/chain-sdk\/api$/, replacement: CHAIN_SDK("api/index.ts") },
        { find: /^@mintdex\/chain-sdk\/quote$/, replacement: CHAIN_SDK("quote.ts") },
        { find: /^@mintdex\/chain-sdk$/, replacement: CHAIN_SDK("index.ts") },
      ],
      dedupe: ["@noble/curves", "@noble/hashes"],
    },
    // The server bundle runs as a Cloudflare Worker — there is no node_modules
    // at runtime. Vite's default SSR build leaves npm deps as bare external
    // imports (h3, react, @tanstack/*, seroval, …), which resolve on a Node
    // server but throw "No such module" in a Worker. Bundle them all in.
    // (node: builtins stay external — nodejs_compat provides them.)
    ssr: {
      noExternal: true,
      // `cloudflare:workers` is a workerd runtime built-in that exposes the Worker
      // env / bindings (D1 `DB`, R2 `STORAGE`). Like node: builtins it must NOT be
      // bundled; the runtime provides it. (`ssr.external` is typed string[].)
      external: ["cloudflare:workers"],
    },
    build: {
      // Keep `cloudflare:*` external in the SSR rollup pass too — `noExternal`
      // above would otherwise try to resolve+bundle it and fail.
      rollupOptions: { external: [/^cloudflare:/] },
    },
    // workerd treats every named export of dist/server/server.js as an entrypoint and refuses non-function ones
    // ("Incorrect type for map entry"). Rollup may hoist shared constants (devnet env.ts values) into the entry's
    // exports, so the server entry keeps exactly its own signature (default only). Server build only: the client
    // chunks are unchanged.
    environments: {
      ssr: { build: { rollupOptions: { preserveEntrySignatures: "strict" } } },
    },
    plugins: [
      clientRegistryFields(),
      creatorRendererWasm(),
      // Material Symbols SVGs (the app icon set) import as React components via
      // `?react`. `icon: true` sizes them 1em; fill is forced to currentColor so
      // they color like text (the raw SVGs have no fill attribute). Keep the
      // viewBox so CSS sizing scales the glyph.
      svgr({
        svgrOptions: {
          icon: true,
          svgProps: { fill: "currentColor" },
          svgoConfig: {
            plugins: [
              { name: "preset-default", params: { overrides: { removeViewBox: false } } },
            ],
          },
        },
      }),
      // TanStack Start plugin must run before React's plugin.
      //
      // SSR build: `vite build` emits a Workers-shaped server bundle
      // (dist/server/server.js — `export default { fetch }`) plus dist/client
      // (hashed static assets). The platform publishes that as a per-tenant
      // Worker on Workers for Platforms, served at <sub>.higgsfield.app/ (host
      // root, so Vite's default base "/" — no base-path juggling).
      //
      // Rendering happens on the server per request, so site code must be
      // SSR-safe: never touch browser-only globals (window, document,
      // localStorage, navigator) during render or at module top level — only
      // inside effects/handlers, or guarded with `typeof window !== "undefined"`.
      tanstackStart({
        server: { entry: "server" },
      }),
      higgsfieldDesignInspectorVitePlugin(designInspectorEnabled),
      react({
        babel: {
          plugins: designInspectorEnabled ? [higgsfieldDesignSourceBabelPlugin] : [],
        },
      }),
      tailwindcss(),
      tsconfigPaths(),
      modeManifest(appMode),
    ],
  };
});
