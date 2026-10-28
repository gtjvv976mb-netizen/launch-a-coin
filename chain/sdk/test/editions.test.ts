import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CREATOR_EDITION_TEMPLATE_KEYS,
  buildCreatorEditionMetadataDraft,
  creatorEditionIdentityCommitment,
  creatorEditionIssuanceKey,
  type CreatorEditionMetadataInput,
} from "../src/editions.ts";
import { base58Encode, toBase64 } from "../src/bytes.ts";

const address = (n: number) => base58Encode(new Uint8Array(32).fill(n));
const CID = "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const AR_ID = (n: number) => toBase64(new Uint8Array(32).fill(n)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const input = (): CreatorEditionMetadataInput => ({
  cluster: "devnet", tokenMint: address(1), originalCreator: address(2),
  templateKey: "doge", templateVersion: "gold-v1", assetAddress: address(3),
  earnedCardMint: address(4), collectionAddress: address(5), tokenName: "Honk",
  tokenTicker: "HONK", designName: "Imperial Gold", editionNumber: 7, lifetimeCap: 100,
  earnedLevelAtIssue: 8,
  front: { uri: `ipfs://${CID}/front.webp`, sha256: "a".repeat(64), type: "image/webp" },
  back: { uri: `ar://${AR_ID(2)}/back.png`, sha256: "b".repeat(64), type: "image/png" },
});

test("creator-edition lifetime key ignores owner and version; cluster/token/design remain isolated", () => {
  const a = input();
  const key = creatorEditionIssuanceKey(a);
  assert.equal(creatorEditionIssuanceKey({ ...a, templateVersion: "v2" } as CreatorEditionMetadataInput), key);
  assert.equal(creatorEditionIssuanceKey({ ...a, originalCreator: address(8) } as CreatorEditionMetadataInput), key);
  assert.notEqual(creatorEditionIssuanceKey({ ...a, cluster: "mainnet-beta" }), key);
  assert.notEqual(creatorEditionIssuanceKey({ ...a, tokenMint: address(9) }), key);
  assert.notEqual(creatorEditionIssuanceKey({ ...a, templateKey: "pepe" }), key);
  assert.notEqual(creatorEditionIdentityCommitment({ ...a, originalCreator: address(8) }), creatorEditionIdentityCommitment(a));
});

test("metadata draft records fixed identity, art and snapshot with collectible-only rights", () => {
  const a = input();
  const draft = buildCreatorEditionMetadataDraft(a);
  const identity = draft.metadata.properties.mintdex;
  assert.equal(draft.kind, "metadata-draft");
  assert.equal(draft.metadata.image, a.front.uri);
  assert.equal(draft.metadata.name, "Honk — Imperial Gold");
  assert.equal(identity.originalCreator, a.originalCreator);
  assert.equal(identity.tokenMint, a.tokenMint);
  assert.equal(identity.assetAddress, a.assetAddress);
  assert.equal(identity.collectionAddress, a.collectionAddress);
  assert.equal(identity.editionNumber, 7);
  assert.equal(identity.earnedLevelAtIssue, 8);
  assert.equal(identity.stylingRemainsWithToken, true);
  assert.equal(identity.collectibleTransferable, true);
  assert.equal(identity.creatorFeeRights, false);
  assert.equal(identity.reusableTemplateLicense, false);
  assert.equal(identity.statsMode, "issuance-snapshot");
  assert.equal(draft.metadata.properties.files.length, 2);
  assert.equal(draft.metadata.properties.files[0].type, "image/webp");
  assert.equal(draft.metadata.properties.files[1].type, "image/png");
  assert.match(draft.identityCommitment, /^[a-f0-9]{64}$/);
  assert.match(draft.contentCommitment, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(draft).includes("seller_fee_basis_points"), false);
  assert.equal("verified" in draft, false);
  assert.equal("minted" in draft, false);
  assert.deepEqual(buildCreatorEditionMetadataDraft(a), draft);
});

test("all immutable content changes alter commitment without reopening issuance slot", () => {
  const a = input();
  const expected = buildCreatorEditionMetadataDraft(a);
  const variants: Partial<CreatorEditionMetadataInput>[] = [
    { templateVersion: "gold-v2" }, { tokenName: "Renamed" }, { tokenTicker: "RENAMED" },
    { designName: "Another finish" }, { editionNumber: 8 }, { lifetimeCap: 101 },
    { earnedLevelAtIssue: 9 }, { assetAddress: address(6) }, { collectionAddress: address(7) },
    { front: { ...a.front, sha256: "c".repeat(64) } },
    { front: { ...a.front, type: "image/jpeg" } },
    { back: { ...a.back, uri: `ar://${AR_ID(3)}/back.png` } },
  ];
  for (const patch of variants) {
    const changed = buildCreatorEditionMetadataDraft({ ...a, ...patch });
    assert.notEqual(changed.contentCommitment, expected.contentCommitment);
    assert.equal(changed.issuanceKey, expected.issuanceKey);
  }
});

test("rejects mutable artwork, hostile URLs, uncommitted images and identical sides", () => {
  const a = input();
  for (const uri of ["https://mintdex.fun/img/live.png", "blob:x", "data:image/png;base64,x", "javascript:alert(1)",
    `${a.front.uri}?v=2`, `${a.front.uri}#fragment`, `ipfs://${CID}/../front.png`, "ipfs://fake/front.png",
    `ipfs://bafy${"a".repeat(50)}/front.png`, `ipfs://${CID}a/front.png`, `ar://${"b".repeat(43)}/front.png`]) {
    assert.throws(() => buildCreatorEditionMetadataDraft({ ...a, front: { ...a.front, uri } }), /content-addressed/);
  }
  assert.throws(() => buildCreatorEditionMetadataDraft({ ...a, front: { ...a.front, sha256: "a" } }), /art commitment/);
  assert.throws(() => buildCreatorEditionMetadataDraft({ ...a, back: a.front }), /separate artwork/);
  for (const type of [undefined, "image/svg+xml", "text/html", "image/gif", ""]) {
    assert.throws(() => buildCreatorEditionMetadataDraft({ ...a, front: { ...a.front, type } } as CreatorEditionMetadataInput), /MIME type/);
  }
  const v0 = base58Encode(Uint8Array.from([0x12, 0x20, ...new Uint8Array(32).fill(4)]));
  assert.equal(buildCreatorEditionMetadataDraft({ ...a, front: { ...a.front, uri: `ipfs://${v0}/front.webp` } }).kind, "metadata-draft");
  const raw = "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq";
  assert.equal(buildCreatorEditionMetadataDraft({ ...a, front: { ...a.front, uri: `ipfs://${raw}` } }).kind, "metadata-draft");
});

test("rejects fee-card/token substitution, malformed addresses, unsized editions and invented earned tiers", () => {
  const a = input();
  for (const assetAddress of [a.tokenMint, a.earnedCardMint, a.collectionAddress]) {
    assert.throws(() => buildCreatorEditionMetadataDraft({ ...a, assetAddress }), /separate addresses/);
  }
  for (const patch of [
    { cluster: "mainnet" }, { tokenMint: "preview" }, { originalCreator: "" }, { templateKey: "__proto__" },
    { editionNumber: 0 }, { editionNumber: 101 }, { editionNumber: 1.5 }, { lifetimeCap: 0 },
    { lifetimeCap: Number.MAX_SAFE_INTEGER + 1 }, { earnedLevelAtIssue: 15 }, { earnedLevelAtIssue: 0 },
    { templateVersion: "../../replace" }, { tokenName: "Honk\nspoof" }, { tokenTicker: "" },
  ]) assert.throws(() => buildCreatorEditionMetadataDraft({ ...a, ...patch } as CreatorEditionMetadataInput));
  for (const templateVersion of [undefined, null, 1, {}, []]) {
    assert.throws(() => buildCreatorEditionMetadataDraft({ ...a, templateVersion } as CreatorEditionMetadataInput), /template version/);
  }
});

test("shared twenty-design contract agrees with current app catalogs", () => {
  const source = ["meme-icons.ts", "editions.ts"].map(name => readFileSync(
    new URL(`../../../app/src/lib/mintdex/${name}`, import.meta.url), "utf8",
  )).join("\n");
  const keys = [...source.matchAll(/key: "([a-z-]+)"/g)].map(match => match[1]);
  assert.equal(new Set(CREATOR_EDITION_TEMPLATE_KEYS).size, 20);
  assert.deepEqual([...CREATOR_EDITION_TEMPLATE_KEYS].sort(), keys.sort());
});
