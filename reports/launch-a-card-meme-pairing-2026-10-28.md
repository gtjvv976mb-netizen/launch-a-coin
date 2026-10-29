# Supported meme and collector pairs — 28 October 2026

**Later publication update:** the owner subsequently requested **make it live**. This verified pairing work is included in production version `70b4ec76-b521-4469-8ba3-02ba6670f42d`. The preview-only statements below describe the original implementation turn; see the [release record](launch-a-card-meme-release-2026-10-28.md) for current deployment status and limitations.

The owner requested themed card pairs for memecoins available through pump.fun, then clarified **do the supported meme pairs only**. This work remains in local preview under the earlier **Keep in preview** instruction. No deployment, push, paid generation, wallet signature or real transaction was performed.

Preview: **http://127.0.0.1:5310/levels?collection=memes**.

## Available presets

Seven existing premium front/back designs now have nine explicit supported design/quote combinations:

| Card finish | Exact quote choices | Identity |
| --- | --- | --- |
| Obsidian Archive | CARDS | Collector Crypt |
| Pokémon Classic | SV151, CARDS | Scarlet & Violet 151, Collector Crypt |
| Pokémon Prism | SV151, CARDS | Scarlet & Violet 151, Collector Crypt |
| Jade Reliquary | TOAD | The Toad Pepe |
| Imperial Gold | DOGE | Reviewed Solana Dogecoin representation |
| Stadium Chrome | BONK | Bonk |
| Couture Knit | WIF | dogwifhat |

CARDS and SV151 are labelled **Collector token quote**, with a separate dropdown group. TOAD is explicitly identified by its own name and symbol; it is not labelled PEPE. The exact mint, issuer/listing information and relevant terms remain available before launch. The existing Fartcoin, Pnut, MOODENG and TROLL quote options remain available with neutral designs.

The archive's **Meme pairs** filter and Launch's **Meme & collector pairs** browser show each preset's actual quote before selection. Applying a preset uses the existing pair-change path, preserving the creator's name, ticker, artwork and mode. Changing assets clears the optional initial buy; changing only a finish keeps an amount in the same quote. The optional matching-design disclosure also supports memes and collectors and applies only on an explicit action.

The new neutral-design presets are chooser recommendations, not retroactive hard restrictions on Pokémon, Pepe or Obsidian design keys. Existing defaults, historical SOL/stock cards, saved intents and all 83 trusted atlas variants are preserved. No new design key, source image, print geometry or paid artwork was needed. Existing rounded slabs, motion and shimmer remain.

## Exact registry additions

| Key | Mint | Decimals | Program |
| --- | --- | ---: | --- |
| CARDS | `CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp` | 6 | SPL Token |
| SV151 | `SV151D5pjygAKA8aJJcKzm4wFnRX5G92Fye94jQJk7g` | 6 | SPL Token |
| TOAD | `A13oRB9FFaiUjfi6LdCg6p9ka1u8SfGkUFs4SKvPpump` | 6 | Token2022 |

All three appear in [Pump's Supported Pair Assets](https://pump.fun/docs/custom-pairs). CARDS identity is independently confirmed by [Collector Crypt tokenomics](https://collectorcrypt.com/tokenomics). Fresh read-only public mainnet verification at **2026-10-28 13:32:12 UTC / 21:32:12 Asia/Manila**, confirmed slot **462494325**, matched the mainnet genesis and exact mint identities. All three have direct QuoteControl admission, initialized/unpaused state and positive reserves. TOAD has only MetadataPointer/TokenMetadata extensions and no mint/freeze authorities.

The app and official-SDK registries now agree on 19 assets. The original 16 asset objects and reserve snapshots remain unchanged. CARDS/SV151 demo reserve snapshots retain their earlier capture; TOAD uses the new capture. Actual mainnet preparation continues to fetch fresh state. Deterministic fixtures retain per-capture provenance and do not claim one atomic bank across all accounts.

The researched Solana PEPE mint is admitted on-chain but absent from the published supported table and has an unverified Pump identity; it remains excluded under the owner's supported-only instruction. A Pokémon-named candidate needs a multi-hop Pump-coin quote path and was not uniquely specified, so it also remains excluded. Pokémon-style presets use the distinct CARDS/SV151 symbols. Research-only candidates and public bytes are retained under ignored `output/meme-pairing-2026-10-28/`.

## Verification

- **202 app tests / 11,293 assertions** and **43 adapter tests / 613 assertions** pass.
- Guarded TypeScript/client/SSR build passes; Impeccable detector returns `[]`; final diff checks pass.
- All nine presets pass exact token/NFT metadata, stored quote identity, finalization, NFT preparation/completion and saved-read checks. Actual official-SDK unsigned token/Core plans pass the independent browser verifier. Exact mint substitution is rejected. Historical Pokémon/Pepe SOL and stock intents recover without reinterpretation. Collector amounts retain exact decimal accounting and no invented SOL/USD value.
- Archive baseline: 42 states / 255 checks at 1440×1000, 390×844 and 320×640 before TOAD. Final TOAD supplement: 15 affected states / 148 checks at the same sizes, covering all seven choices, exact launch links, new TOAD details, explicit matching apply/focus and the 19-option supported-only dropdown. Existing stock pending Keep/apply behavior also passes.
- Final Launch browser checks cover all seven paginated choices at 1440×1000, 390×844, 320×640, 768×1024 and 844×390 landscape. The dialog/sheet body and document have no overflow, all choices remain reachable, and closing returns focus to the opener. Uploaded artwork, name, ticker and Demo mode survive selection on desktop and small phone. Initial-buy clearing/preservation uses the correct quote units.
- Screenshots were visually inspected. No runtime errors, failed first-party responses, missing images or clipped controls were found. Existing archive unused-font preload warnings are unrelated. Physical phone sensors and real-wallet issuance were not exercised.

Logs and browser evidence are in ignored `output/meme-pairing-2026-10-28/` and `output/playwright/meme-pairing-2026-10-28/`. `archive-qa.json` and the early Launch logs explicitly represent the pre-TOAD baseline; `archive-toad-qa.json`, `final-launch-sizes.log` and `final-phone-selection.log` cover the final 19-asset implementation. Local preview remains on port 5310, with mainnet actions disabled locally. Production remains unchanged.
