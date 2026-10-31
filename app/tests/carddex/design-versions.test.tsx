import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import reviewed from "../../../integrations/pumpfun/src/design-assets.json";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import tokenBackAssets from "../../src/lib/carddex/token-back-assets.json";
import measuredLayouts from "../../src/lib/carddex/generated-layouts.json";
import { CARD_RENDERER_VERSION } from "../../src/lib/carddex/card-template";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { defaultQuoteForDesign } from "../../src/lib/carddex/pairs";
import { CARD_GENERATED_ASSETS, generatedCardAssets } from "../../src/lib/carddex/generated-assets";
import { DESIGN_ARCHIVE_ROOT, archivedDesignFile, archivedDesignForHashes, archivedDesignVersion, archivedDesignVersions, designVersionId, recordedDesignVersion } from "../../src/lib/carddex/design-versions";
import { canonicalSkinAsset } from "../../src/components/carddex/CanonicalCardSkin";
import { generatedSkinSource } from "../../src/components/carddex/GeneratedCardArt";
import { BackFace } from "../../src/components/mintdex/card3d/backface";
import { cardBackTheme, MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";
import { launchCard, type PublicLiveLaunch } from "../../src/lib/carddex/live/launches";
import { creatorAtlas, creatorTokenBack } from "../../src/lib/carddex/live/compose-assets";
import { checkLaunchedArt, launchRows } from "../../../tools/carddex/check-launched-art";
import { archiveDesignVersions, archivePath, collectDesignVersion, generatedEntry, gitReader } from "../../../tools/carddex/archive-design-version";
import { clientRegistryCopy } from "../../src/lib/carddex/client-registry-fields";
import archiveRegistry from "../../src/lib/carddex/design-archive.json";
import productionLaunches from "./fixtures/production-launched-art-2026-10-31.json";

// The Worker runtime module is not available under bun test; the row mapping under test never touches a binding.
mock.module("cloudflare:workers", () => ({ env: {} }));
const { publicLaunchFromRow } = await import("../../src/lib/carddex/live/launches.server");

const PUBLIC = resolve(import.meta.dir, "../../public");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fileSha = (path: string) => sha(readFileSync(join(PUBLIC, path)));
type Reviewed = Record<string, { front: { path: string; sha256: string }; back: { path: string; sha256: string } }>;
const current = reviewed as Reviewed;

/**
 * The art production launches recorded before the 31 October redesign (dc57e17, "Premium redesign of 53 plain pair
 * cards") replaced it, and the registry hashes of that art at dc57e17^ (387fb951).
 */
const TESTCARD = { designKey: "pair-cards", front: "0fab1e5bae070412f65fcf0ddc5c935fdf4e1c06db0f23b1e40cd23b09b5190d", back: "b901b5f8852cb0936ae7a7d81438a8cd30817b142e3ba727adb0db8761aeae63",
  atlasKey: "pair-cards", atlas: "36cae41d86530adacce13ba8aa0174a5ee0815d50abec7cc7b4d78c1e8a3b841", tokenBack: "264f2dadd94eaf407d6313f9a9fae6b7936c2f01bc6212cb6a6e7cd817a2da1a" };
const AAPLX = { designKey: "pair-aaplx", front: "2f04d84650281392d62d139375d4639fae20b4df34d0b1e263a402d4c8dfa0fd", back: "ead0438f2c47f85680630157b89bf3b57b1493cb941535f352e76626d4dcbca9",
  atlasKey: "pair-aaplx--stock", atlas: "8bbded74c0062e9f5f51173096e14df060a61d3cdada7178f86a290820943cdc", tokenBack: "07b0622f53df3e8db4d054bf859dfc26d10482a0652cfad2485603bc5010ab92" };
const testcardVersion = designVersionId(TESTCARD.front, TESTCARD.back), aaplxVersion = designVersionId(AAPLX.front, AAPLX.back);
/** dc57e17^, the commit both production versions were archived from. */
const TESTCARD_REF = "387fb951e0fe498ea94b77f502e786da3ca0989d";

const TOKEN = (designKey: string, designVersion?: string): CardData => ({
  name: "Testcard", ticker: "TEST", image: "/api/live/assets/" + "a".repeat(64) + ".png", cardTemplate: designKey,
  quoteAssetKey: defaultQuoteForDesign(designKey).key, level: 1, mcapUsd: null, holders: 0, dexNo: 0, lore: "A coin.",
  ...(designVersion ? { designVersion } : {}),
});

describe("the design archive", () => {
  test("holds the art the production launches recorded, byte for byte as it was before the redesign", () => {
    for (const recorded of [TESTCARD, AAPLX]) {
      const entry = archivedDesignForHashes(recorded.designKey, recorded.front, recorded.back)!;
      expect(entry).toBeTruthy();
      expect(entry.version).toBe(designVersionId(recorded.front, recorded.back));
      expect(fileSha(entry.source.front.path)).toBe(recorded.front);
      expect(fileSha(entry.source.back.path)).toBe(recorded.back);
      expect(fileSha(entry.atlases[recorded.atlasKey]!.path)).toBe(recorded.atlas);
      expect(fileSha(entry.tokenBack.path)).toBe(recorded.tokenBack);
      // The redesign replaced both faces; the current art is untouched by the archive.
      expect(current[recorded.designKey]!.front.sha256).not.toBe(recorded.front);
      expect(current[recorded.designKey]!.back.sha256).not.toBe(recorded.back);
    }
  });

  test("every archived file exists with its pinned hash, inside its own version's folder, and nothing else is there", () => {
    const listed = new Set<string>();
    expect(archivedDesignVersions().length).toBeGreaterThanOrEqual(2);
    for (const entry of archivedDesignVersions()) {
      const folder = `${DESIGN_ARCHIVE_ROOT}${entry.designKey}/${entry.version}/`;
      expect(entry).toBe(archivedDesignVersion(entry.designKey, entry.version)!);
      expect(entry.version).toBe(designVersionId(entry.source.front.sha256, entry.source.back.sha256));
      expect(/^[a-f0-9]{40}$/.test(entry.ref)).toBe(true);
      for (const [path, pinned] of Object.entries(entry.files)) {
        expect(path.startsWith(folder)).toBe(true);
        expect(fileSha(path)).toBe(pinned);
        expect(archivedDesignFile(path)).toEqual({ entry, sha256: pinned });
        listed.add(path);
      }
      // Every path the entry names is one of its pinned files, with the hash its registry entry pins.
      const pinnedAs = (path: string, hash?: string) => { expect(Object.hasOwn(entry.files, path)).toBe(true); if (hash) expect(entry.files[path]).toBe(hash); };
      pinnedAs(entry.source.front.path, entry.source.front.sha256); pinnedAs(entry.source.back.path, entry.source.back.sha256);
      expect(entry.generated.front).toBe(entry.source.front.path); expect(entry.generated.back).toBe(entry.source.back.path);
      for (const small of [entry.generated.front320, entry.generated.back320]) {
        pinnedAs(small);
        for (const width of [480, 640]) pinnedAs(small.replace(/-320\.webp$/, `-${width}.webp`));
      }
      expect(Object.keys(entry.atlases).sort()).toEqual(Object.keys(entry.variants).sort());
      for (const [atlasKey, atlas] of Object.entries(entry.atlases)) {
        expect(atlasKey).toBe(entry.designKey + (atlas.kind === "stock" ? "--stock" : ""));
        expect(atlas.sourceSha256).toBe(entry.source.front.sha256);
        expect(atlas.rendererVersion).toBe(CARD_RENDERER_VERSION);
        pinnedAs(atlas.path, atlas.sha256); pinnedAs(atlas.previewPath, atlas.previewSha256);
        const variant = entry.variants[atlasKey]!;
        expect(variant.atlasSha256).toBe(atlas.sha256);
        // canonicalSkinSrcSet derives the copies from the preview path: they sit beside it.
        expect(variant.w480.path).toBe(atlas.previewPath.replace(/\.png$/, "-480.webp"));
        expect(variant.w640.path).toBe(atlas.previewPath.replace(/\.png$/, "-640.webp"));
        pinnedAs(variant.w480.path, variant.w480.sha256); pinnedAs(variant.w640.path, variant.w640.sha256);
      }
      expect(entry.tokenBack.sourceSha256).toBe(entry.source.back.sha256);
      pinnedAs(entry.tokenBack.path, entry.tokenBack.sha256);
    }
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);
    const onDisk = walk(join(PUBLIC, DESIGN_ARCHIVE_ROOT)).map(file => file.slice(PUBLIC.length));
    expect(onDisk.sort()).toEqual([...listed].sort());
  });

  test("an archived version is never a design's current art, and the current art is never archived", () => {
    for (const entry of archivedDesignVersions()) {
      const art = current[entry.designKey];
      expect(art).toBeDefined();
      expect(entry.version).not.toBe(designVersionId(art!.front.sha256, art!.back.sha256));
    }
    for (const [designKey, art] of Object.entries(current)) {
      expect(archivedDesignForHashes(designKey, art.front.sha256, art.back.sha256)).toBeNull();
      expect(recordedDesignVersion(designKey, art.front.sha256, art.back.sha256)).toBeNull();
    }
  });

  test("a version resolves only for its own design key and exact hashes", () => {
    expect(recordedDesignVersion("pair-cards", TESTCARD.front, TESTCARD.back)).toBe(testcardVersion);
    expect(recordedDesignVersion("pair-aaplx", TESTCARD.front, TESTCARD.back)).toBeNull();
    expect(recordedDesignVersion("pair-cards", TESTCARD.front, AAPLX.back)).toBeNull();
    expect(recordedDesignVersion("pair-cards", "a".repeat(64), "b".repeat(64))).toBeNull();
    expect(recordedDesignVersion("pair-cards", TESTCARD.front.toUpperCase(), TESTCARD.back)).toBeNull();
    expect(recordedDesignVersion("pair-cards", undefined, null)).toBeNull();
    expect(archivedDesignVersion("pair-aaplx", testcardVersion)).toBeNull();
    expect(archivedDesignVersion("__proto__", testcardVersion)).toBeNull();
    expect(archivedDesignVersion("pair-cards", "constructor")).toBeNull();
    expect(archivedDesignFile(`${DESIGN_ARCHIVE_ROOT}pair-cards/${testcardVersion}/render/unlisted.png`)).toBeNull();
    expect(archivedDesignFile("/assets/carddex/render/pair-cards.png")).toBeNull();
  });

  test("the archive tool reproduces each entry from its commit, when this checkout has that history", () => {
    const git = gitReader();
    for (const entry of archivedDesignVersions()) {
      if (!git.read(entry.ref, "integrations/pumpfun/src/design-assets.json")) continue; // a shallow checkout
      const { entry: again, files } = collectDesignVersion(git, entry.ref, entry.designKey);
      expect(again).toEqual(entry);
      for (const [path, file] of files) expect(sha(readFileSync(join(PUBLIC, path)))).toBe(file.sha256);
    }
    expect(archivePath("pair-cards", testcardVersion, "/assets/carddex/token-backs/pair-cards.png")).toBe(`${DESIGN_ARCHIVE_ROOT}pair-cards/${testcardVersion}/token-backs/pair-cards.png`);
    expect(() => archivePath("pair-cards", testcardVersion, `${DESIGN_ARCHIVE_ROOT}x.png`)).toThrow();
    expect(() => archivePath("pair-cards", testcardVersion, "/fonts/x.woff2")).toThrow();
    expect(generatedEntry(`  "pair-cards": {"front":"/a.webp","back":"/b.webp"},\n`, "pair-cards")).toEqual({ front: "/a.webp", back: "/b.webp" });
    expect(generatedEntry("", "pair-cards")).toBeNull();
  });

  test("the archive tool writes nothing when a later key conflicts with a file already in the archive", () => {
    const git = gitReader();
    const ref = TESTCARD_REF;
    if (!git.read(ref, "integrations/pumpfun/src/design-assets.json")) return; // a shallow checkout
    const root = mkdtempSync(join(tmpdir(), "lac-archive-"));
    try {
      const { files } = collectDesignVersion(git, ref, AAPLX.designKey);
      const [clash] = [...files.keys()];
      const clashPath = join(root, "app/public", clash!);
      mkdirSync(dirname(clashPath), { recursive: true });
      writeFileSync(clashPath, "other bytes");
      expect(() => archiveDesignVersions([TESTCARD.designKey, AAPLX.designKey], ref, root, git)).toThrow("already exists with other bytes");
      expect(existsSync(join(root, "app/public", DESIGN_ARCHIVE_ROOT, TESTCARD.designKey))).toBe(false);
      expect(existsSync(join(root, "app/src/lib/carddex/design-archive.json"))).toBe(false);
      expect(readFileSync(clashPath, "utf8")).toBe("other bytes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("launched art check", () => {
  test("the three production launches all resolve: two archived versions and Charizard's current art", () => {
    // Exported from production D1 (README.md, "Release checklist"); Charizard's pokemon-full-art was never redesigned.
    const results = checkLaunchedArt(launchRows(productionLaunches));
    expect(results.map(r => [r.id, r.resolved, r.version, r.problem])).toEqual([
      ["a965ba32", "archived", testcardVersion, null],
      ["24a2b526", "current", null, null],
      ["ca9a389f", "archived", aaplxVersion, null],
    ]);
  });

  test("a launch whose art was replaced without an archive fails, as do unknown keys and missing hashes", () => {
    const rows = launchRows([{ results: [
      { id: "x", design_key: "pair-cards", front_sha256: "c".repeat(64), back_sha256: "d".repeat(64) },
      { id: "y", design_key: "not-a-design", front_sha256: TESTCARD.front, back_sha256: TESTCARD.back },
      { id: "z", design_key: "pair-cards", front_sha256: null, back_sha256: null },
    ] }]);
    const results = checkLaunchedArt(rows);
    expect(results.every(r => r.resolved === null && !!r.problem)).toBe(true);
    expect(results[0]!.problem).toContain("archive-design-version.ts");
    // The other accepted shapes: a {launches} body and a plain array, with camelCase fields.
    expect(launchRows({ launches: [{ designKey: "pair-cards", frontSha256: TESTCARD.front, backSha256: TESTCARD.back }] })[0]).toMatchObject({ designKey: "pair-cards", frontSha256: TESTCARD.front });
    expect(() => launchRows([{ results: [] }])).toThrow("No launch rows");
  });

  test("a missing or changed archived file fails the check", () => {
    const missing = resolve(import.meta.dir, "fixtures"); // a root without app/public
    const results = checkLaunchedArt(launchRows(productionLaunches), missing);
    expect(results.every(r => r.resolved === null && /is missing/.test(r.problem ?? ""))).toBe(true);
  });
});

describe("the public launch list carries the recorded version", () => {
  const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const row = (designKey: string, front?: string, back?: string) => ({
    token_mint: MINT, creator_wallet: WALLET, design_key: designKey, created_at: 1,
    payload_json: JSON.stringify({ fields: { name: "Testcard", symbol: "TEST", description: "" }, input: { card: { designKey, frontSha256: front, backSha256: back } } }),
  });
  test("an archived version for a launch recorded before a redesign, null for the current art and unknown hashes", () => {
    expect(publicLaunchFromRow(row("pair-cards", TESTCARD.front, TESTCARD.back))?.designVersion).toBe(testcardVersion);
    expect(publicLaunchFromRow(row("pair-aaplx", AAPLX.front, AAPLX.back))?.designVersion).toBe(aaplxVersion);
    expect(publicLaunchFromRow(row("pair-cards", current["pair-cards"]!.front.sha256, current["pair-cards"]!.back.sha256))?.designVersion).toBeNull();
    expect(publicLaunchFromRow(row("pair-cards", "a".repeat(64), "b".repeat(64)))?.designVersion).toBeNull();
    expect(publicLaunchFromRow(row("pair-cards"))?.designVersion).toBeNull();
  });
  test("launchCard gives the card the version, and leaves a current launch's card exactly as before", () => {
    const launch = (designVersion: string | null): PublicLiveLaunch => ({ name: "Testcard", ticker: "TEST", lore: "", tokenMint: MINT, nftMint: null, designKey: "pair-cards", designName: null,
      designVersion, quoteAssetKey: "cards", quoteMint: "x", image: null, cardImage: null, creator: null, createdAt: 1 });
    expect(launchCard(launch(testcardVersion)).designVersion).toBe(testcardVersion);
    const plain = launchCard(launch(null));
    expect("designVersion" in plain).toBe(false);
    expect(Object.keys(plain)).toEqual(["name", "ticker", "lore", "image", "cardTemplate", "quoteAssetKey", "quoteMint", "tradingPair", "level", "mcapUsd", "mcapLabel", "holders", "dexNo", "dexLabel", "ownerHandle", "mintAddress"]);
  });
});

describe("the card renderer reads a pinned version from the archive only", () => {
  test("faces, atlases, layouts and token backs: archive paths for the version, the usual registries otherwise", () => {
    for (const recorded of [TESTCARD, AAPLX]) {
      const version = designVersionId(recorded.front, recorded.back), entry = archivedDesignVersion(recorded.designKey, version)!;
      const quote = defaultQuoteForDesign(recorded.designKey).key;
      expect(generatedCardAssets(recorded.designKey, version)).toEqual(entry.generated);
      expect(canonicalSkinAsset(recorded.designKey, quote, version)).toEqual(entry.atlases[recorded.atlasKey]!);
      expect(generatedSkinSource(recorded.designKey, version)!.art).toEqual(entry.layout.art);
      expect(creatorAtlas({ cardTemplate: recorded.designKey, quoteAssetKey: quote, designVersion: version })).toEqual(entry.atlases[recorded.atlasKey]!);
      expect(creatorTokenBack({ cardTemplate: recorded.designKey, quoteAssetKey: quote, designVersion: version })).toEqual(entry.tokenBack);
      for (const none of [undefined, "", "0".repeat(12) + "-" + "0".repeat(12)]) {
        expect(generatedCardAssets(recorded.designKey, none)).toBe(CARD_GENERATED_ASSETS[recorded.designKey as keyof typeof CARD_GENERATED_ASSETS]!);
        expect(canonicalSkinAsset(recorded.designKey, quote, none)).toBe(renderAssets[recorded.atlasKey as keyof typeof renderAssets] as never);
        expect(generatedSkinSource(recorded.designKey, none)!.art).toEqual((measuredLayouts as Record<string, { art: unknown }>)[recorded.designKey]!.art);
        expect(creatorAtlas({ cardTemplate: recorded.designKey, quoteAssetKey: quote, designVersion: none })).toBe(renderAssets[recorded.atlasKey as keyof typeof renderAssets] as never);
        expect(creatorTokenBack({ cardTemplate: recorded.designKey, quoteAssetKey: quote, designVersion: none })).toBe(tokenBackAssets[recorded.designKey as keyof typeof tokenBackAssets] as never);
      }
    }
    // Another design's version never reaches this design.
    expect(generatedCardAssets("pair-aaplx", testcardVersion)).toBe(CARD_GENERATED_ASSETS["pair-aaplx" as keyof typeof CARD_GENERATED_ASSETS]!);
  });

  test("Testcard's face and back render its archived art; every current card's markup is unchanged", () => {
    const front = renderToStaticMarkup(<MintCardFace card={TOKEN("pair-cards", testcardVersion)} priority />);
    const back = renderToStaticMarkup(<BackFace sizes="300px" eager theme={cardBackTheme(TOKEN("pair-cards", testcardVersion))} />);
    const entry = archivedDesignVersion("pair-cards", testcardVersion)!;
    expect(front).toContain(`src="${entry.atlases["pair-cards"]!.path}"`);
    expect(front).not.toContain("/assets/carddex/render/");
    expect(back).toContain(entry.generated.back320.replace(/-320\.webp$/, "-480.webp"));
    expect(back).not.toContain("/assets/carddex/higgsfield/");
    expect(cardBackTheme(TOKEN("pair-cards", testcardVersion)).designVersion).toBe(testcardVersion);
    // Current cards: no version, no archive path, and the same markup whatever version another design carries.
    for (const design of CARD_DESIGNS) {
      const plain = renderToStaticMarkup(<MintCardFace card={TOKEN(design.key)} priority />);
      expect(plain).not.toContain(DESIGN_ARCHIVE_ROOT);
      expect(renderToStaticMarkup(<MintCardFace card={TOKEN(design.key, design.key === "pair-cards" ? aaplxVersion : testcardVersion)} priority />)).toBe(plain);
      const theme = cardBackTheme(TOKEN(design.key));
      expect("designVersion" in theme).toBe(false);
      expect(renderToStaticMarkup(<BackFace sizes="300px" eager theme={theme} />)).not.toContain(DESIGN_ARCHIVE_ROOT);
    }
  });

  test("the archive is a static folder the Worker serves like every other card asset", () => {
    expect(existsSync(join(PUBLIC, DESIGN_ARCHIVE_ROOT))).toBe(true);
    expect(readFileSync(join(PUBLIC, "_headers"), "utf8")).toContain("/assets/carddex/*");
  });
});

describe("the browser's copy of the archive", () => {
  test("keeps what the card renderers read and drops every pin, file map, source face, variant and token back", () => {
    const whole = archiveRegistry as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const raw = readFileSync(resolve(import.meta.dir, "../../src/lib/carddex/design-archive.json"), "utf8");
    const client = JSON.parse(clientRegistryCopy("design-archive.json", raw)!) as typeof whole;
    expect(Object.keys(client).sort()).toEqual(Object.keys(whole).sort());
    for (const [designKey, versions] of Object.entries(whole)) {
      expect(Object.keys(client[designKey]!).sort()).toEqual(Object.keys(versions).sort());
      for (const [version, entry] of Object.entries(versions)) {
        const copy = client[designKey]![version]!;
        expect(Object.keys(copy).sort()).toEqual(["atlases", "designKey", "generated", "layout", "version"]);
        expect(copy.generated).toEqual(entry.generated);
        expect(copy.layout).toEqual(entry.layout);
        for (const [atlasKey, atlas] of Object.entries(entry.atlases as Record<string, Record<string, unknown>>)) {
          const { sha256: _a, previewSha256: _b, sourceSha256: _c, ...kept } = atlas;
          expect((copy.atlases as Record<string, unknown>)[atlasKey]).toEqual(kept);
        }
      }
    }
    expect(JSON.stringify(client)).not.toMatch(/[a-f0-9]{64}/);
    expect(raw.length - JSON.stringify(client).length).toBeGreaterThan(0);
  });
});
