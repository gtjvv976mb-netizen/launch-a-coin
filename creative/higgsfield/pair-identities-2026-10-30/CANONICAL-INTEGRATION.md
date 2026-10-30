# Pair-identity asset installation

The importer consumes only complete, visually accepted pairs from `accepted-pairs-51.json`, `accepted-pairs-38.json`, optional `accepted-pairs-final.json`, and highest-priority optional `accepted-pairs-tailoring-v2.json`. It does not generate artwork, spend credits, call a wallet, or deploy the site. The individual Higgsfield masters remain in ignored `output/`; their accepted SHA256 and job IDs are recorded in `integration-provenance.json` with the exact quote mint.

From `app/`:

```sh
bun scripts/prepare-pair-designs.ts
bun scripts/check-pair-design-assets.ts
bun scripts/proof-pair-designs.ts
```

Use `--only=pair-sol,pair-doge` to limit an import or proof. `--force` deliberately repeats normalization/measurement/flattening when the importer or canonical engine changes. An accepted replacement master with a different source hash automatically reimports that pair. Incomplete fronts/backs never enter any installation index.

`--plan` reads the current accepted manifests and reports pending imports/revocations without changing anything. If a formerly installed pair loses acceptance or its accepted master changes, the importer gates it out before conversion and retains its old transformation record under `integration-provenance.json` → `retired`. Its files are not deleted. Acceptance is checked again after rasterization, so a source revoked during the import cannot be activated from a stale snapshot.

`--revoke-only` applies acceptance revocations without importing new pairs. Revocations should be gated immediately, even while waiting to batch enough newly completed designs for the next build.

The deterministic importer verifies the accepted source bytes, trims complete outside near-white margins conservatively, and resizes the unchanged artwork to 1260×1897 WebP plus 320×482 WebP. It measures the actual creator-art aperture and three light name/type/details surfaces from the new front; diagnostic rectangles are saved in ignored `output/higgsfield/pair-identities-2026-10-30/integration/`. These measured coordinates select existing artwork pixels. Creator content still uses the one 63:88 canonical Launch a Card v2 grid.

Chromium flattens the actual `CanonicalSkinSurface` into 1260×1760 rounded RGBA atlases, followed by 320×447 previews. PNG source input avoids Resvg's inability to decode WebP; Chromium also avoids the detailed nested SVG mask/use expansion exhausting Resvg WASM memory. The actual creator print proof uses the normal `creatorCardSvg`, installed site fonts, and Resvg after the atlas has been flattened.

The installed Playwright CLI is required. The wrapper runs from the project root (outside the app's npm override context) in offline mode, using its existing installed package rather than waiting for registry resolution on each open/render/close command. `PLAYWRIGHT_CLI` and `PLAYWRIGHT_CONFIG` can select another installed CLI/config. Only the importer-owned `pair-design-atlases` browser is opened or closed.

Backs are exact approved source conversions to 630×880 PNG, with the shared antialiased rounded card silhouette. Each WebP, preview, atlas and PNG reverse gets a pinned SHA256. All output files exist and source hashes are rechecked before the five installation indexes are updated. The active-design gate independently requires every source/layout/atlas/reverse/mint record; there is no generic decorative fallback exposed as a completed identity design.

New pair masters have no footer plates. Only their measured name/type/details surfaces are masked; the source rail selection preserves the full continuous lower ornament. The original 48 sources, 83 atlas variants, 48 PNG reverses and original 48 canonical SVG golden markup hashes remain unchanged. The checker reads every pinned file and verifies both new and historical bytes, exact accepted master provenance, absence of new footer masks, and light ink surfaces.

The installed full-size and small WebP paths remain in `generated-assets.ts`; measured source regions are in `generated-layouts.json`; trusted atlases are in `render-assets.json`; compatible reverses are in `token-back-assets.json`; trusted source hashes are in `integrations/pumpfun/src/design-assets.json`. `integration-provenance.json` is the reproducible transformation ledger and records accepted-manifest snapshot hashes.

The preview remains local on port 5310. Integration does not authorize publication or an actual launch.


## Tailoring v2 acceptance

The optional `accepted-pairs-tailoring-v2.json` uses the same whole-pair `acceptedPairs` schema as the existing acceptance manifests. It is the highest-priority layer. Both faces must carry matching exact mint/design fields and an accepted visual status; in-progress `acceptedFaces` do not replace either active face. The importer does not create or edit this acceptance file.

Old approved artwork remains selected while a v2 pair is incomplete. Once a complete v2 pair is installed, its key is remembered in `tailoringV2DesignKeys` and provenance records its `acceptanceManifest`. Withdrawing that v2 acceptance quarantines the design instead of silently reactivating the previous generic pair. An optional `revokedDesignKeys` array explicitly quarantines named keys. Reapproval of a complete v2 pair restores eligibility. This source-selection logic is shared by the importer and checker in `app/scripts/lib/pair-acceptance.ts`.

Before retiring or superseding an installed pair, the importer copies all seven pinned derivative files (two full WebPs, two compact WebPs, full atlas, preview atlas and PNG reverse) into ignored `output/higgsfield/pair-identities-2026-10-30/integration/retired/<key>@<fingerprint>/`. It verifies the existing hashes before archival. Prior metadata, source masters, job IDs and archive hashes remain under `integration-provenance.retired`; every original48 asset and original SVG golden is unchanged.

The v2 art direction and geometry-only guide live under `tailoring-v2/`. Those preparation files neither generate nor install public card artwork. Public replacements still require Higgsfield output, actual identity/geometry review and whole-pair acceptance before this pipeline activates them.

## Reviewed processing overrides and isolated proofs

`normalization-overrides.json` is pipeline-owned processing metadata, separate from source acceptance. Every entry is keyed by the exact master SHA and checks design, face and path. It can approve a wider individually inspected outside crop, opt into edge-connected neutral-background alpha cleanup, or reuse a measured blank paper crop from that same source. The original master is never modified. The importer pins the override-file hash and complete instruction record in provenance.

`sourcePaperPatches` contain normalized `from` and `to` rectangles plus an individual `reviewNote`. They crop only existing source pixels before deterministic resize/composition; no decorative replacement art is synthesized. A reviewed rounded crop mask can preserve native paper corners. Source/target pixel rectangles and source-patch pixel hashes are recorded. Held AGENCY403 is not approved merely because its type strip can be repaired; identity review stays separate.

V2 sources explicitly set `sourceMaterialGaps`, allowing actual source rail samples to fill gaps between fixed writing panels. A shared narrow native panel border gets a correspondingly narrower source-rim crop so one aperture cannot leak into its neighbor. Target content positions are unchanged, and the 48 legacy SVG golden outputs remain byte-identical.

Front `edgeConnectedWhiteCleanup` runs after the canonical SVG is flattened, so loading geometry cannot refill cleared pixels. Back cleanup can run on its source/PNG conversion. Only neutral exterior pixels connected through outer alpha/background are removed; enclosed ivory stays intact. A decoded atlas hides its loading surface to preserve real outer alpha. The FONE charcoal proof demonstrates the opt-in result.

For unaccepted assessments, `prepare-pair-sources.py` accepts `publicDirectory` inside its ignored output directory, separate from `app/public`. `app/scripts/proof-unaccepted-pair-fronts.ts --directory=<absolute-output-directory>` flattens the same prepared-source SVG and populates the actual creator print. It closes only its owned browser. These proofs cannot activate a design or write acceptance.

`python3 creative/higgsfield/pair-identities-2026-10-30/review-source-margins.py` creates read-only red-box diagnostics for newly accepted sources with wider exterior margins. It never approves or crops them, and is not the active-design selection gate. Inspect its actual proofs before adding an exact-master processing override.

## Accepted source-only compositions

Accepted faces can carry `derivation:{path,sha256}`, `reusedSourceJobs`, `newGeneration:false` and `countsAsNewPaidJob:false`. `pair-source-derivation.ts` verifies the derivation JSON and every local path/hash record it contains before conversion. The same guard runs in the asset checker; the normalized face provenance retains the original flags and verified input list. A reviewed composition can live in the isolated art output directory, while ordinary provider masters remain restricted to `originals/`. No composition is described as a new provider generation.

The final collection uses six such faces: BIKE and TRUMP reuse verified earlier Higgsfield heroes with their new frames; MICHI keeps its admitted photograph inside the new Higgsfield frame; TAO and ZAUTH preserve exact source-logo geometry in Higgsfield materials; ZEREBRO removes incidental address lettering using actual blank material from the same generated back. The accepted manifests own visual approval; isolated proof documents retain their original candidate status as historical evidence.

## Stable local checkpoint — 30 October 2026

The completed accepted import contains 95 active pairs: all 66 meme/collector pairs and 29 stock/crypto pairs, including all 62 tailored-v2 pairs. AAVE and UNI remain staged and unavailable as their unfinished exact designs. The original 48 source pairs, 83 legacy atlas variants, 48 PNG backs and all 48 SVG golden hashes are unchanged.

App checks passed: 413 tests / 63,957 assertions, TypeScript and the guarded client/SSR build. The asset checker verified 975 pinned public files plus all accepted composite derivation/input hashes. Twelve local HTTP reads for the six composite atlases/reverses returned the exact pinned bytes. `output/higgsfield/pair-identities-2026-10-30/integration/final-active-catalogue-95.json` freezes exact mappings and six installation-index hashes for the independent browser QA. This checkpoint does not claim browser QA completion or production publication.

`update-design-list.py` now uses the importer's shared whole-pair selector, validates selected-source matches before counting installations, records selected face provenance/history pointers, and distinguishes source-only compositions from new generation. Its final refresh reports 97 staged, 95 accepted/installed, 62 tailored-v2 and six source-only faces. Display descriptions follow accepted v2 materials; the earlier copy is retained in `tailoring-v2/registry-description-revision.json`.
