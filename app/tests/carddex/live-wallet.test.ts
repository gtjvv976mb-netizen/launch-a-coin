import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { parseLiveAmount, formatLiveAmount } from "../../src/components/carddex/live/amounts";
import { getPairAsset, PAIR_ASSETS } from "../../src/lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../../src/lib/carddex/design-pairings";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { base58, fromBase58, hexHash, LIVE_PROGRAMS, parseLiveTransaction, partiallySignPlan, toBase64, unsentStageNext, validateLivePlan, validateWalletResult, destroyEphemeralSigner, type ExpectedPlan, type TransactionPlan,
  addEphemeralSignature, fromBase64, oversizedPlanError, planForWallet, planIsStale, refreshKeepsReview, signingOrderFor, signPlanWithWallet, validateWalletFirstResult, WALLET_CHANGED_TRANSACTION, WalletChangedTransaction } from "../../src/components/carddex/live/transaction";
import { liveModeOpen } from "../../src/components/carddex/live/mode";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { LiveWalletNotice } from "../../src/components/carddex/live/LiveWalletNotice";
import { WALLET_NOTICE_COPY, WALLET_NOTICE_TITLE, WALLET_OPEN_COPY, walletNoticeItems } from "../../src/components/carddex/live/wallet-notice";

// Deterministic, unfunded test-only signers. No wallet, RPC or network is used.
const creatorSeed = new Uint8Array(32).fill(3), assetSeed = new Uint8Array(32).fill(4);
const creator = base58(ed25519.getPublicKey(creatorSeed)), mint = base58(ed25519.getPublicKey(assetSeed));
const encodeText = (text: string) => { const data = new TextEncoder().encode(text); return [data.length & 255, data.length >> 8 & 255, 0, 0, ...data]; };
const computeInstructions = [4,0,5,2,32,161,7,0,4,0,9,3,232,3,0,0,0,0,0,0];
const tokenUri = "https://launchacard.fun/m/test-token";
function short(n: number) { return n < 128 ? [n] : [(n & 127) | 128, n >> 7]; }
function fixture(cardTemplate = "pokemon-classic", quoteKey = "sol") {
  const asset = getPairAsset(quoteKey), custom = quoteKey !== "sol";
  const blockhashBytes = new Uint8Array(32).fill(7);
  const data = [214,144,76,236,95,139,49,180, ...encodeText("Test"), ...encodeText("TEST"), ...encodeText(tokenUri), ...fromBase58(creator), ...new Uint8Array(11)];
  const accounts = Array.from({length:custom?20:16},(_,i)=>i===0?1:i===5?0:custom&&i===18?5:2);
  const message = Uint8Array.from([128, 2, 0, custom?4:3, custom?6:5,
    ...fromBase58(creator), ...fromBase58(mint), ...fromBase58(asset.mint), ...fromBase58(LIVE_PROGRAMS.pump), ...fromBase58(LIVE_PROGRAMS.compute),
    ...(custom ? fromBase58(asset.tokenProgram) : []),
    ...blockhashBytes, 3, ...computeInstructions, 3, accounts.length, ...accounts, ...short(data.length), ...data, 0]);
  const bytes = Uint8Array.from([2, ...new Uint8Array(128), ...message]);
  const plan: TransactionPlan = { kind: "token", network: "solana:mainnet", transactionBase64: toBase64(bytes), messageSha256: hexHash(message), blockhash: base58(blockhashBytes), lastValidBlockHeight: 10_000, requiredSigners: [creator, mint], feePayer: creator, bindingSha256: "a".repeat(64), instructionPrograms: [LIVE_PROGRAMS.compute,LIVE_PROGRAMS.pump], verifiedSlot: 100,
    review: { networkFeeLamports: "10000", priorityFeeLamports: "500", rentAndProgramCostLamports: "1000000", totalDebitLamports: "1010500", initialBuyQuoteBaseUnits: "0", launchInitialBuyQuoteBaseUnits: "0", quoteKey: asset.key, quoteMint: asset.mint, quoteDecimals: asset.decimals, minimumTokensOut: "0", computeUnitLimit:500000,microLamportsPerComputeUnit:1000 } };
  const expected: ExpectedPlan = { kind: "token", creator, mint, tokenMint: mint, name: "Test", symbol: "TEST", tokenMetadataUri: tokenUri, nftMetadataUri: "https://launchacard.fun/m/test-nft", cardTemplate, cardImageSha256: "c".repeat(64), nftMetadataSha256: "d".repeat(64), quoteTokenProgram: asset.tokenProgram, bindingSha256: plan.bindingSha256, quoteKey: asset.key, quoteMint: asset.mint, quoteDecimals: asset.decimals, initialBuyQuoteBaseUnits: "0", launchInitialBuyQuoteBaseUnits: "0" };
  return { plan, expected, bytes };
}

function nftFixture(cardTemplate = "pokemon-classic", quoteKey = "sol") {
  const {plan: tokenPlan, expected: tokenExpected} = fixture(cardTemplate, quoteKey);
  const nft = base58(ed25519.getPublicKey(new Uint8Array(32).fill(5)));
  const expected: ExpectedPlan = {...tokenExpected, kind:"nft", mint:nft};
  const attributes = {token_mint:mint,quote_mint:expected.quoteMint,card_design:expected.cardTemplate,binding_sha256:expected.bindingSha256,card_sha256:expected.cardImageSha256,metadata_sha256:expected.nftMetadataSha256};
  const createData = [20,0,...encodeText(expected.name),...encodeText(expected.nftMetadataUri),1,1,0,0,0,6,6,0,0,0,...Object.entries(attributes).flatMap(([key,value])=>[...encodeText(key),...encodeText(value)]),1,0,1,0,0,0,0];
  const blockhashBytes = new Uint8Array(32).fill(7);
  const message = Uint8Array.from([128,2,0,3,5,...fromBase58(creator),...fromBase58(nft),...fromBase58(LIVE_PROGRAMS.core),...new Uint8Array(32),...fromBase58(LIVE_PROGRAMS.compute),...blockhashBytes,4,...computeInstructions,2,8,1,2,0,0,0,0,3,2,...short(createData.length),...createData,2,6,1,2,0,0,3,2,5,15,0,0,1,0,0]);
  const bytes = Uint8Array.from([2,...new Uint8Array(128),...message]);
  const plan:TransactionPlan = {...tokenPlan,kind:"nft",requiredSigners:[creator,nft],transactionBase64:toBase64(bytes),messageSha256:hexHash(message),instructionPrograms:[LIVE_PROGRAMS.compute,LIVE_PROGRAMS.core]};
  return {plan,expected,bytes};
}

describe("real quote amount precision", () => {
  test("parses every base unit without floating-point rounding", () => {
    expect(parseLiveAmount("18446744073.709551615", 9)).toBe("18446744073709551615");
    expect(parseLiveAmount("18446744073.709551616", 9)).toBeNull();
    expect(parseLiveAmount("0.000000001", 9)).toBe("1");
    expect(parseLiveAmount("9007199254.740993", 6)).toBe("9007199254740993");
    expect(formatLiveAmount("9007199254740993", 6)).toBe("9,007,199,254.740993");
    expect(formatLiveAmount("1", 9)).toBe("0.000000001");
  });
  test("rejects negative, exponent and excess-precision inputs", () => {
    for (const input of ["-1", "1e4", "NaN", "Infinity", "1.0000001", "1,000"]) expect(parseLiveAmount(input, 6)).toBeNull();
    expect(parseLiveAmount("", 6)).toBe("0");
    expect(parseLiveAmount(".5", 6)).toBe("500000");
  });
  test("new meme quotes retain their five, six and eight decimal precision up to the u64 boundary", () => {
    for (const [key, decimals] of [["pengu", 6], ["giga", 5], ["spx", 8], ["trump", 6], ["useless", 6], ["chillguy", 6]] as const) {
      expect(getPairAsset(key).decimals).toBe(decimals);
      const oneAtom = `0.${"0".repeat(decimals - 1)}1`;
      expect(parseLiveAmount(oneAtom, decimals)).toBe("1");
      expect(formatLiveAmount("1", decimals)).toBe(oneAtom);
      const max = 18_446_744_073_709_551_615n, unit = 10n ** BigInt(decimals);
      const decimal = (atoms: bigint) => `${atoms / unit}.${String(atoms % unit).padStart(decimals, "0")}`;
      expect(parseLiveAmount(decimal(max), decimals)).toBe(max.toString());
      expect(formatLiveAmount(max.toString(), decimals).replaceAll(",", "")).toBe(decimal(max));
      expect(parseLiveAmount(decimal(max + 1n), decimals)).toBeNull();
      expect(parseLiveAmount(`${oneAtom}1`, decimals)).toBeNull();
    }
  });
});
describe("creator-wallet transaction commitments", () => {
  test("stock and collector/meme presets verify exact token accounts and NFT binding attributes", () => {
    const stockPairs = {"stock-gme": "gmex", "stock-tsla": "tslax", "stock-nvda": "nvdax", "stock-aapl": "aaplx", "stock-mstr": "mstrx", "stock-coin": "coinx", gamestop: "gmex", amc: "amc", coinbase: "coinx", strategy: "mstrx"};
    const pairs = [...Object.entries(stockPairs), ...MEME_PAIR_PRESETS.map(({design, quote}) => [design, quote] as const)];
    for (const [design, quoteKey] of pairs) {
      const token = fixture(design, quoteKey), nft = nftFixture(design, quoteKey);
      expect(validateLivePlan(token.plan, token.expected).signers).toEqual([creator, mint]);
      expect(validateLivePlan(nft.plan, nft.expected).signers[0]).toBe(creator);
      const wrongProgram = getPairAsset(quoteKey).tokenProgram === getPairAsset("sol").tokenProgram ? getPairAsset("gmex").tokenProgram : getPairAsset("sol").tokenProgram;
      expect(() => validateLivePlan(token.plan, {...token.expected, quoteTokenProgram: wrongProgram})).toThrow();
      expect(() => validateLivePlan(token.plan, {...token.expected, quoteDecimals: token.expected.quoteDecimals + 1})).toThrow("quote or initial buy changed");
      expect(() => validateLivePlan(token.plan, {...token.expected, quoteMint: getPairAsset("sol").mint})).toThrow("quote or initial buy changed");
      const wrongDesign = CARD_DESIGNS.find(candidate => candidate.key !== design)!.key;
      expect(() => validateLivePlan(nft.plan, {...nft.expected, cardTemplate: wrongDesign})).toThrow("card NFT attributes");
      expect(() => validateLivePlan(nft.plan, {...nft.expected, quoteMint: getPairAsset("sol").mint})).toThrow("quote or initial buy changed");
      // Matching review labels and decimal precision do not make a different mint valid.
      const replacement = PAIR_ASSETS.find(asset => asset.key !== quoteKey && asset.decimals === token.expected.quoteDecimals)!;
      const changedQuote = {quoteKey: replacement.key, quoteMint: replacement.mint, quoteDecimals: replacement.decimals};
      expect(() => validateLivePlan({...token.plan, review: {...token.plan.review, ...changedQuote}}, {...token.expected, ...changedQuote, quoteTokenProgram: replacement.tokenProgram})).toThrow("selected quote mint");
      expect(() => validateLivePlan({...nft.plan, review: {...nft.plan.review, ...changedQuote}}, {...nft.expected, ...changedQuote, quoteTokenProgram: replacement.tokenProgram})).toThrow("card NFT attributes");
    }
  });
  test("accepts exact v0 plan and preserves the ephemeral signature through wallet signing", () => {
    const { plan, expected } = fixture();
    expect(validateLivePlan(plan, expected).signers).toEqual([creator, mint]);
    const partial = partiallySignPlan(plan, expected, { address: mint, seed: assetSeed });
    const parsed = parseLiveTransaction(partial);
    expect(ed25519.verify(parsed.signatures[1], parsed.message, fromBase58(mint))).toBe(true);
    const signed = partial.slice(); signed.set(ed25519.sign(parsed.message, creatorSeed), parsed.signatureOffset);
    expect(validateWalletResult(partial, signed, creator)).toEqual(signed);
  });
  test("rejects wrong network, creator, asset, quote, binding and review precision", () => {
    const { plan, expected } = fixture();
    for (const changed of [
      { network: "solana:devnet" }, { feePayer: mint }, { bindingSha256: "b".repeat(64) }, { messageSha256: "b".repeat(64) },
      { review: { ...plan.review, quoteKey: "doge" } }, { review: { ...plan.review, quoteDecimals: 6 } },
      { review: { ...plan.review, launchInitialBuyQuoteBaseUnits: "1" } }, { review: { ...plan.review, priorityFeeLamports: "501" } }, { review: { ...plan.review, computeUnitLimit: 600000 } }, { review: { ...plan.review, totalDebitLamports: -1 } },
    ]) expect(() => validateLivePlan({ ...plan, ...changed } as TransactionPlan, expected)).toThrow();
    expect(() => validateLivePlan(plan, { ...expected, mint: creator })).toThrow();
    expect(() => validateLivePlan(plan, { ...expected, quoteMint: mint })).toThrow();
  });
  test("rejects unexpected programs, extra signers, lookup tables and preexisting signatures", () => {
    const { plan, expected, bytes } = fixture();
    expect(() => validateLivePlan({ ...plan, instructionPrograms: [LIVE_PROGRAMS.core] }, expected)).toThrow();
    const badSigners = bytes.slice(); badSigners[0] = 3;
    expect(() => parseLiveTransaction(badSigners)).toThrow();
    const lookup = bytes.slice(); lookup[lookup.length - 1] = 1;
    expect(() => parseLiveTransaction(lookup)).toThrow();
    const preSigned = bytes.slice(); preSigned[1] = 1;
    expect(() => partiallySignPlan({ ...plan, transactionBase64: toBase64(preSigned) }, expected, { address: mint, seed: assetSeed })).toThrow();
  });
  test("rejects wallet message mutation, missing payer signature and changed partial signature", () => {
    const { plan, expected } = fixture();
    const partial = partiallySignPlan(plan, expected, { address: mint, seed: assetSeed });
    expect(() => validateWalletResult(partial, partial, creator)).toThrow();
    const changedMessage = partial.slice(); changedMessage[changedMessage.length - 2] ^= 1;
    expect(() => validateWalletResult(partial, changedMessage, creator)).toThrow();
    const changedSignature = partial.slice(); changedSignature[65] ^= 1;
    expect(() => validateWalletResult(partial, changedSignature, creator)).toThrow();
  });
  test("checks exact Pump operation and creation metadata before signing", () => {
    const {plan,expected}=fixture();
    for(const changed of [{name:"Other"},{symbol:"OTHER"},{tokenMetadataUri:"https://launchacard.fun/m/other"}]) expect(()=>validateLivePlan(plan,{...expected,...changed})).toThrow();
    const bytes=parseLiveTransaction(Uint8Array.from(atob(plan.transactionBase64),c=>c.charCodeAt(0))).bytes;
    const changed=bytes.slice(); changed[changed.length-12]=1;
    const mutated=parseLiveTransaction(changed);
    expect(()=>validateLivePlan({...plan,transactionBase64:toBase64(changed),messageSha256:hexHash(mutated.message)},expected)).toThrow();
  });
  test("checks Core name, URI, owner and exact wordless card attributes without royalties", () => {
    const {plan,expected}=nftFixture();
    expect(validateLivePlan(plan,expected).programs).toEqual([LIVE_PROGRAMS.compute,LIVE_PROGRAMS.compute,LIVE_PROGRAMS.core,LIVE_PROGRAMS.core]);
    for(const changed of [{name:"Other"},{nftMetadataUri:"https://launchacard.fun/m/other"},{cardTemplate:"other"},{tokenMint:creator},{nftMetadataSha256:"e".repeat(64)}]) expect(()=>validateLivePlan(plan,{...expected,...changed})).toThrow();
  });
  test("clears ephemeral seed bytes when a stage is finished", () => {
    const signer = { address: mint, seed: assetSeed.slice() };
    destroyEphemeralSigner(signer);
    expect(signer.seed.every(value => value === 0)).toBe(true);
  });
});
describe("after a signed transaction the server did not send", () => {
  test("only an unsendable, unsaved stage is prepared again; any other refusal keeps the signed bytes to send again", () => {
    expect(unsentStageNext({status: "prepared", nftSignature: null}, "token", true)).toBe("prepare");
    expect(unsentStageNext({status: "prepared", nftSignature: null}, "token", false)).toBe("resend");
    expect(unsentStageNext({status: "nft_pending", nftSignature: null}, "nft", true)).toBe("prepare");
    expect(unsentStageNext({status: "nft_pending", nftSignature: null}, "nft", false)).toBe("resend");
    // A saved signature is recovered, never replaced.
    for (const unsendable of [true, false]) {
      expect(unsentStageNext({status: "token_pending", nftSignature: null}, "token", unsendable)).toBeNull();
      expect(unsentStageNext({status: "nft_pending", nftSignature: "s".repeat(88)}, "nft", unsendable)).toBeNull();
      expect(unsentStageNext({status: "nft_pending", nftSignature: null}, "token", unsendable)).toBeNull();
    }
  });
});
describe("mainnet mode", () => {
  test("opens for new launches or for saved-launch recovery alone, and stays closed while unknown", () => {
    expect(liveModeOpen({ready: true, recoveryReady: true})).toBe(true);
    expect(liveModeOpen({ready: false, recoveryReady: true})).toBe(true);
    expect(liveModeOpen({ready: false, recoveryReady: false})).toBe(false);
    expect(liveModeOpen(null)).toBe(false); expect(liveModeOpen(undefined)).toBe(false);
  });
});

// A stand-in wallet: records exactly what it was shown and signs the creator slot of whatever it returns.
function fakeWallet(change?: (bytes: Uint8Array) => Uint8Array) {
  const shown: Uint8Array[] = [];
  const sign = async (bytes: Uint8Array) => {
    shown.push(bytes.slice());
    const out = change ? change(bytes.slice()) : bytes.slice(), wire = parseLiveTransaction(out);
    out.set(ed25519.sign(wire.message, creatorSeed), wire.signatureOffset);
    return out;
  };
  return { shown, sign };
}
const nftSeed = new Uint8Array(32).fill(5);
describe("wallet-first signing order", () => {
  for (const [kind, make, seed] of [["coin", fixture, assetSeed], ["card", nftFixture, nftSeed]] as const) test(`the wallet signs the unsigned ${kind} plan first, then the page co-signs exactly what it returned`, async () => {
    const { plan, expected } = make(), wallet = fakeWallet();
    const signed = await signPlanWithWallet(plan, expected, { address: expected.mint, seed: seed.slice() }, "wallet-first", wallet.sign);
    // The wallet saw the prepared bytes unchanged, with both signature slots still empty.
    expect(wallet.shown).toHaveLength(1);
    expect(wallet.shown[0]).toEqual(fromBase64(plan.transactionBase64));
    expect(parseLiveTransaction(wallet.shown[0]).signatures.every(signature => signature.every(byte => byte === 0))).toBe(true);
    const final = parseLiveTransaction(signed);
    expect(hexHash(final.message)).toBe(plan.messageSha256);
    expect(final.signers).toEqual([creator, expected.mint]);
    expect(ed25519.verify(final.signatures[0], final.message, fromBase58(creator))).toBe(true);
    expect(ed25519.verify(final.signatures[1], final.message, fromBase58(expected.mint))).toBe(true);
    // The wallet's own signature is kept byte for byte; the page only fills the second slot.
    expect(final.signatures[0]).toEqual(Uint8Array.from(ed25519.sign(final.message, creatorSeed)));
  });
  test("wallets not on the wallet-first list keep the page-first order", async () => {
    const { plan, expected } = fixture(), wallet = fakeWallet();
    const signed = await signPlanWithWallet(plan, expected, { address: mint, seed: assetSeed.slice() }, "page-first", wallet.sign);
    const shown = parseLiveTransaction(wallet.shown[0]);
    expect(shown.signatures[0].every(byte => byte === 0)).toBe(true);
    expect(ed25519.verify(shown.signatures[1], shown.message, fromBase58(mint))).toBe(true);
    expect(parseLiveTransaction(signed).signatures.every((signature, i) => ed25519.verify(signature, shown.message, fromBase58([creator, mint][i])))).toBe(true);
  });
  test("the order follows the server's wallet list, by name in any case", () => {
    expect(signingOrderFor("Phantom", ["Phantom"])).toBe("wallet-first");
    expect(signingOrderFor("phantom ", ["Phantom"])).toBe("wallet-first");
    expect(signingOrderFor("Solflare", ["Phantom"])).toBe("page-first");
    expect(signingOrderFor("Backpack", ["*"])).toBe("wallet-first");
    expect(signingOrderFor(null, ["*"])).toBe("page-first");
    expect(signingOrderFor("Phantom", [])).toBe("page-first");
    expect(signingOrderFor("Phantom", undefined)).toBe("page-first");
  });
  test("a wallet that changes the message is refused and the page never adds its signature", async () => {
    const { plan, expected } = fixture();
    const changes: Array<(bytes: Uint8Array) => Uint8Array> = [
      // A different priority fee: the SetComputeUnitPrice data (9 bytes, 3 then u64 1000) gets another price.
      unsigned => { const out = unsigned.slice(), at = out.findIndex((_, i) => out[i] === 9 && out[i + 1] === 3 && out[i + 2] === 232 && out[i + 3] === 3); out[at + 2] = 233; return out; },
      // A refreshed blockhash.
      unsigned => { const wire = parseLiveTransaction(unsigned), out = unsigned.slice(), at = wire.signatureOffset + 128 + 4 + 1 + wire.keys.length * 32; out.set(new Uint8Array(32).fill(9), at); return out; },
    ];
    for (const change of changes) {
      const wallet = fakeWallet(change);
      const refused = await signPlanWithWallet(plan, expected, { address: mint, seed: assetSeed.slice() }, "wallet-first", wallet.sign).then(() => null, (error: unknown) => error);
      expect(refused).toBeInstanceOf(WalletChangedTransaction);
      expect((refused as Error).message).toBe(WALLET_CHANGED_TRANSACTION);
      expect((refused as Error).message).toContain("Nothing was sent and nothing was charged");
      // The returned bytes travel only to the change log. Their second slot is still empty: nothing here can land.
      const returned = parseLiveTransaction((refused as WalletChangedTransaction).returned);
      expect(hexHash(returned.message)).not.toBe(plan.messageSha256);
      expect(returned.signatures[1].every(byte => byte === 0)).toBe(true);
    }
    // A wallet that adds an instruction or returns something unreadable is refused the same way.
    const unsigned = fromBase64(plan.transactionBase64);
    expect(() => validateWalletFirstResult(unsigned, Uint8Array.from([...unsigned, 0]), creator)).toThrow(WalletChangedTransaction);
    expect(() => validateWalletFirstResult(unsigned, new Uint8Array(40), creator)).toThrow(WalletChangedTransaction);
  });
  test("the wallet-first result needs the creator's valid signature and an empty second slot", () => {
    const { plan } = fixture(), unsigned = fromBase64(plan.transactionBase64), wire = parseLiveTransaction(unsigned);
    expect(() => validateWalletFirstResult(unsigned, unsigned, creator)).toThrow("valid signature from the creator wallet");
    const wrongKey = unsigned.slice(); wrongKey.set(ed25519.sign(wire.message, assetSeed), wire.signatureOffset);
    expect(() => validateWalletFirstResult(unsigned, wrongKey, creator)).toThrow("valid signature from the creator wallet");
    const signed = unsigned.slice(); signed.set(ed25519.sign(wire.message, creatorSeed), wire.signatureOffset);
    expect(validateWalletFirstResult(unsigned, signed, creator)).toEqual(signed);
    const both = signed.slice(); both.set(ed25519.sign(wire.message, assetSeed), wire.signatureOffset + 64);
    expect(() => validateWalletFirstResult(unsigned, both, creator)).toThrow("unexpected second signature");
    expect(() => addEphemeralSignature(signed, { address: creator, seed: creatorSeed }, mint)).toThrow("different new-address key");
    expect(parseLiveTransaction(addEphemeralSignature(signed, { address: mint, seed: assetSeed }, mint)).signatures[1]).toEqual(Uint8Array.from(ed25519.sign(wire.message, assetSeed)));
  });
});
describe("a fresh blockhash when the wallet opens", () => {
  const withReview = (plan: TransactionPlan, review: Partial<TransactionPlan["review"]>): TransactionPlan => ({ ...plan, review: { ...plan.review, ...review } });
  test("a plan received more than about 30 seconds ago is stale", () => {
    const now = 1_800_000_000_000;
    expect(planIsStale(now - 29_000, now)).toBe(false);
    expect(planIsStale(now - 31_000, now)).toBe(true);
    expect(planIsStale(0, now)).toBe(true);
  });
  test("a re-prepared plan skips a second review only when nothing reviewed moved beyond the priority fee", () => {
    const { plan } = fixture();
    expect(refreshKeepsReview(plan, plan)).toBe(true);
    expect(refreshKeepsReview(plan, withReview(plan, { priorityFeeLamports: "900", totalDebitLamports: "1010900" }))).toBe(true);
    expect(refreshKeepsReview(plan, withReview(plan, { totalDebitLamports: "1000000" }))).toBe(true);
    expect(refreshKeepsReview(plan, withReview(plan, { totalDebitLamports: "1010501" }))).toBe(false);
    expect(refreshKeepsReview(plan, withReview(plan, { priorityFeeLamports: "900", totalDebitLamports: "1011000" }))).toBe(false);
    expect(refreshKeepsReview(withReview(plan, { minimumTokensOut: "100" }), withReview(plan, { minimumTokensOut: "99" }))).toBe(false);
    expect(refreshKeepsReview(plan, withReview(plan, { initialBuyQuoteBaseUnits: "1" }))).toBe(false);
    expect(refreshKeepsReview(plan, { ...plan, kind: "nft" })).toBe(false);
  });
  test("a stale plan is prepared again before the wallet opens; a fresh one goes as it is", async () => {
    const { plan } = fixture(), now = 1_800_000_000_000;
    let calls = 0;
    const again = (next: TransactionPlan | null) => async () => { calls++; return next; };
    expect(await planForWallet(plan, now - 5_000, again(plan), now)).toEqual({ status: "fresh", plan });
    expect(calls).toBe(0);
    const fresh = { ...plan, messageSha256: "f".repeat(64) };
    expect(await planForWallet(plan, now - 45_000, again(fresh), now)).toEqual({ status: "refreshed", plan: fresh });
    const costlier = withReview(fresh, { totalDebitLamports: "2000000" });
    expect(await planForWallet(plan, now - 45_000, again(costlier), now)).toEqual({ status: "changed", plan: costlier });
    expect(await planForWallet(plan, now - 45_000, again(null), now)).toEqual({ status: "gone" });
    expect(calls).toBe(3);
  });
});
describe("transaction size before the wallet opens", () => {
  test("an oversized plan is refused in plain words and a size that differs from the review is refused", () => {
    const { plan, expected, bytes } = fixture();
    const oversized = Uint8Array.from([...bytes, ...new Uint8Array(1300 - bytes.length)]);
    expect(() => validateLivePlan({ ...plan, transactionBase64: toBase64(oversized) }, expected)).toThrow(oversizedPlanError(1300));
    expect(oversizedPlanError(1300)).toBe("This transaction is 1,300 bytes, over Solana's 1,232-byte limit, so your wallet was not opened. Use a shorter name or symbol, or launch without an initial buy.");
    expect(validateLivePlan({ ...plan, review: { ...plan.review, transactionBytes: bytes.length, packetLimit: 1232 } }, expected).bytes.length).toBe(bytes.length);
    expect(() => validateLivePlan({ ...plan, review: { ...plan.review, transactionBytes: bytes.length + 1 } }, expected)).toThrow("size differs from the review");
  });
});
describe("what your wallet will show", () => {
  const sol = { symbol: "SOL", decimals: 9, kind: "native" }, stock = { symbol: "TSLAx", decimals: 8, kind: "stock" };
  test("lists the fee, any initial buy, the token account and the second signer from the plan", () => {
    const { plan } = fixture();
    expect(walletNoticeItems(plan, sol, "launchacard.fun").map(item => item.key)).toEqual(["networkFee", "coinSigner", "newSite"]);
    expect(walletNoticeItems(plan, sol)[0].text).toBe("A network fee of about 0.0000105 SOL.");
    const buy = { ...plan, review: { ...plan.review, initialBuyQuoteBaseUnits: "100000000" } };
    const items = walletNoticeItems(buy, sol, "launchacard.fun");
    expect(items.map(item => item.key)).toEqual(["networkFee", "initialBuy", "tokenAccount", "unverified", "coinSigner", "newSite"]);
    expect(items[1].text).toBe("Your initial buy: 0.1 SOL.");
    expect(items.at(-1)!.text).toBe("Phantom may show a notice that this site is new. Check that the address bar reads launchacard.fun.");
    expect(walletNoticeItems(buy, stock).map(item => item.key)).toContain("stockQuote");
    expect(walletNoticeItems(nftFixture().plan, sol).map(item => item.key)).toEqual(["networkFee", "cardSigner", "cardLock", "newSite"]);
    expect(WALLET_NOTICE_COPY.coinSigner).toContain("A second signer for the new coin's address");
  });
  test("is calm, plain and never tells anyone to click through a warning", () => {
    const { plan } = fixture();
    const html = renderToStaticMarkup(createElement(LiveWalletNotice, { plan: { ...plan, review: { ...plan.review, initialBuyQuoteBaseUnits: "1" } }, quote: stock, siteHost: "launchacard.fun" }));
    expect(html).toContain(`>${WALLET_NOTICE_TITLE}</h3>`);
    expect(html).toContain("<ul");
    expect(html).toContain("don&#x27;t approve");
    const copy = [WALLET_OPEN_COPY, WALLET_NOTICE_TITLE, ...Object.values(WALLET_NOTICE_COPY).map(value => typeof value === "function" ? value("1", "SOL") : value)];
    for (const text of copy) { expect(text).not.toMatch(/[\u2013\u2014]/); expect(text).not.toMatch(/ignore|anyway|click through|safe to proceed/i); }
  });
});
