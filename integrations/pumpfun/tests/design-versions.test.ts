import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import art from "../src/design-assets.json";
import { reviewLaunchInput, type PrepareLaunchInput } from "../src/index.ts";
import { archivedDesignVersions, designVersionId } from "../../../app/src/lib/carddex/design-versions";

// Deterministic test-only public identities. No signatures are ever generated.
const creator = Keypair.fromSeed(new Uint8Array(32).fill(101)).publicKey.toBase58();
const mint = Keypair.fromSeed(new Uint8Array(32).fill(102)).publicKey.toBase58();

/** The card hashes production launches recorded before the 31 October redesign (dc57e17) replaced their art. */
const RECORDED = {
  // a965ba32: Testcard, complete, its card NFT minted.
  "pair-cards": { quoteKey: "cards", front: "0fab1e5bae070412f65fcf0ddc5c935fdf4e1c06db0f23b1e40cd23b09b5190d", back: "b901b5f8852cb0936ae7a7d81438a8cd30817b142e3ba727adb0db8761aeae63" },
  // ca9a389f: AAPLX, prepared, its coin not yet created.
  "pair-aaplx": { quoteKey: "aaplx", front: "2f04d84650281392d62d139375d4639fae20b4df34d0b1e263a402d4c8dfa0fd", back: "ead0438f2c47f85680630157b89bf3b57b1493cb941535f352e76626d4dcbca9" },
} as const;

function input(designKey: keyof typeof RECORDED, front: string, back: string): PrepareLaunchInput {
  return {
    creator, mint, name: "CardDex Example", symbol: "CARDX", quoteKey: RECORDED[designKey].quoteKey,
    tokenMetadataUri: "ipfs://bafybeiexample/token.json",
    card: {
      designKey, frontSha256: front, backSha256: back,
      frontUri: `https://launchacard.fun/api/live/assets/${front}.webp`, backUri: `https://launchacard.fun/api/live/assets/${back}.webp`,
      nftMetadataUri: "ipfs://bafybeiexample/nft.json",
    },
  };
}

describe("pinned design versions in the launch review", () => {
  test("the hashes saved launches recorded before the redesign still pass, unchanged", () => {
    for (const [designKey, recorded] of Object.entries(RECORDED) as [keyof typeof RECORDED, (typeof RECORDED)[keyof typeof RECORDED]][]) {
      // The redesign replaced both faces: the recorded art is no longer the current entry.
      expect(art[designKey].front.sha256).not.toBe(recorded.front);
      expect(art[designKey].back.sha256).not.toBe(recorded.back);
      const reviewed = reviewLaunchInput(input(designKey, recorded.front, recorded.back));
      expect(reviewed.card).toMatchObject({ designKey, frontSha256: recorded.front, backSha256: recorded.back });
    }
  });

  test("the current art still passes, and new launches record it", () => {
    for (const designKey of Object.keys(RECORDED) as (keyof typeof RECORDED)[]) {
      const current = art[designKey];
      expect(reviewLaunchInput(input(designKey, current.front.sha256, current.back.sha256)).card.frontSha256).toBe(current.front.sha256);
    }
  });

  test("unknown, mixed and other designs' hashes refuse with the same error", () => {
    const { front, back } = RECORDED["pair-aaplx"];
    const cards = RECORDED["pair-cards"];
    for (const [f, b] of [
      ["a".repeat(64), "b".repeat(64)],
      [front, art["pair-aaplx"].back.sha256], // an archived front with the current back
      [art["pair-aaplx"].front.sha256, back], // the current front with an archived back
      [cards.front, cards.back], // another design's archived version
      [front, front],
    ]) expect(() => reviewLaunchInput(input("pair-aaplx", f!, b!))).toThrow("Card front/back hashes do not match the reviewed design manifest");
    expect(() => reviewLaunchInput(input("pair-aaplx", front.toUpperCase(), back))).toThrow("lowercase SHA-256 required");
  });

  test("no archived version is a design's current art", () => {
    expect(archivedDesignVersions().length).toBeGreaterThanOrEqual(2);
    for (const entry of archivedDesignVersions()) {
      const current = art[entry.designKey as keyof typeof art];
      expect(current).toBeDefined();
      expect(entry.version).not.toBe(designVersionId(current.front.sha256, current.back.sha256));
    }
  });
});
