import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { parseLiveAmount, formatLiveAmount } from "../../src/components/carddex/live/amounts";
import { designForPair, getPairAsset, OFFERED_PAIRS, PAIR_ASSETS } from "../../src/lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../../src/lib/carddex/design-pairings";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { base58, fromBase58, hexHash, LIVE_PROGRAMS, parseLiveTransaction, partiallySignPlan, toBase64, unsentStageNext, validateLivePlan, validateWalletResult, destroyEphemeralSigner, type ExpectedPlan, type TransactionPlan,
  addEphemeralSignature, fromBase64, oversizedPlanError, planForWallet, planIsStale, refreshKeepsReview, signingOrderFor, signPlanWithWallet, validateWalletFirstResult, WALLET_CHANGED_TRANSACTION, WalletChangedTransaction } from "../../src/components/carddex/live/transaction";
import { liveModeOpen } from "../../src/components/carddex/live/mode";
import { signForLaunch, WALLET_RETRY_NOTICE } from "../../src/components/carddex/live/launch-flow";
import { BUY_DOES_NOT_FIT, liveBuyOff, liveBuyRefusal, STOCK_BUY_WARNS } from "../../src/components/carddex/live/buy-fit";
import { messageOf, payerGuardData, phantomGuarded, tokenGuardData, unsignedTransaction } from "../../../integrations/pumpfun/tests/message-fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { LiveWalletNotice } from "../../src/components/carddex/live/LiveWalletNotice";
import { LiveTokenImage } from "../../src/components/carddex/live/LiveTokenImage";
import { WALLET_NOTICE_COPY, WALLET_NOTICE_TITLE, WALLET_OPEN_COPY, walletNoticeItems } from "../../src/components/carddex/live/wallet-notice";
import { assetSeed, creator, creatorSeed, fixture, mint, nftFixture } from "./live-plan-fixtures";
import { HELD_PAIR_DESIGNS } from "../../src/lib/carddex/pair-designs";

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
  test("all reviewed quotes and creator-design presets verify exact token accounts and NFT binding attributes", () => {
    const stockPairs = {"stock-gme": "gmex", "stock-tsla": "tslax", "stock-nvda": "nvdax", "stock-aapl": "aaplx", "stock-mstr": "mstrx", "stock-coin": "coinx", gamestop: "gmex", amc: "amc", coinbase: "coinx", strategy: "mstrx"};
    // Every offered pair with its own card, every held identity on its own pair (content holds), the earlier stock and
    // chooser combinations saved launches may carry, and a neutral design on every reviewed quote (AAVE and UNI
    // included: saved launches never re-check the offer).
    const held = Object.keys(HELD_PAIR_DESIGNS).map(key => [key, key.slice(5)] as const);
    const pairs = [...Object.entries(stockPairs), ...MEME_PAIR_PRESETS.map(({design, quote}) => [design, quote] as const), ...OFFERED_PAIRS.map(asset => [designForPair(asset.key)!, asset.key] as const), ...held, ...PAIR_ASSETS.map(asset=>["pokemon-classic",asset.key] as const)];
    expect(pairs).toHaveLength(10 + 31 + 109 + 9 + 117);
    for (const [design, quoteKey] of pairs) {
      const token = fixture(design, quoteKey), nft = nftFixture(design, quoteKey);
      const wire=validateLivePlan(token.plan, token.expected);
      expect(wire.signers).toEqual([creator, mint]);
      expect(validateLivePlan(nft.plan, nft.expected).signers[0]).toBe(creator);
      const asset=getPairAsset(quoteKey);
      const differentMint=getPairAsset(quoteKey==="sol"?"usdc":"sol").mint;
      expect(differentMint).not.toBe(asset.mint);
      const wrongProgram = asset.tokenProgram === getPairAsset("sol").tokenProgram ? getPairAsset("gmex").tokenProgram : getPairAsset("sol").tokenProgram;
      const create=wire.instructions.find(instruction=>instruction.program===LIVE_PROGRAMS.pump)!;
      if(quoteKey!=="sol"){
        expect(create.accounts[18]).toBe(asset.tokenProgram);
        expect(() => validateLivePlan(token.plan, {...token.expected, quoteTokenProgram: wrongProgram})).toThrow("creation accounts");
      }else{
        // Native SOL create_v2 has no quote-program account to substitute.
        expect(create.accounts).toHaveLength(16);
        expect(wire.keys).not.toContain(wrongProgram);
      }
      expect(() => validateLivePlan(token.plan, {...token.expected, quoteDecimals: token.expected.quoteDecimals + 1})).toThrow("quote or initial buy changed");
      expect(() => validateLivePlan(token.plan, {...token.expected, quoteMint: differentMint})).toThrow("quote or initial buy changed");
      const wrongDesign = CARD_DESIGNS.find(candidate => candidate.key !== design)!.key;
      expect(() => validateLivePlan(nft.plan, {...nft.expected, cardTemplate: wrongDesign})).toThrow("card NFT attributes");
      expect(() => validateLivePlan(nft.plan, {...nft.expected, quoteMint: differentMint})).toThrow("quote or initial buy changed");
      // Prefer equal precision; unique-unit quotes such as XMR still reject a coherently relabelled different mint.
      const replacement = PAIR_ASSETS.find(candidate => candidate.key !== quoteKey && candidate.key!=="sol" && candidate.decimals === token.expected.quoteDecimals)
        ?? PAIR_ASSETS.find(candidate=>candidate.key!==quoteKey && candidate.key!=="sol");
      if(!replacement)throw new Error(`A distinct non-native quote fixture is required for ${quoteKey}.`);
      expect(replacement.mint).not.toBe(asset.mint);
      expect(wire.keys).not.toContain(replacement.mint);
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
    expect(walletNoticeItems(plan, sol, "launchacard.fun").map(item => item.key)).toEqual(["approvalsCoin", "networkFee", "coinSigner", "newSite"]);
    expect(walletNoticeItems(plan, sol)[1].text).toBe("A network fee of about 0.0000105 SOL.");
    const buy = { ...plan, review: { ...plan.review, initialBuyQuoteBaseUnits: "100000000" } };
    const items = walletNoticeItems(buy, sol, "launchacard.fun");
    expect(items.map(item => item.key)).toEqual(["approvalsCoin", "networkFee", "initialBuy", "tokenAccount", "unverified", "coinSigner", "newSite"]);
    expect(items[2].text).toBe("Your initial buy: 0.1 SOL.");
    expect(items.at(-1)!.text).toBe("Phantom may show a notice that this site is new. Check that the address bar reads launchacard.fun.");
    expect(walletNoticeItems(buy, stock).map(item => item.key)).toContain("stockQuote");
    expect(walletNoticeItems(nftFixture().plan, sol).map(item => item.key)).toEqual(["approvalsCard", "networkFee", "cardSigner", "cardLock", "newSite"]);
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

describe("the coin image in the review", () => {
  const asset = (sha: string, ext: string, mimeType: string) => ({ sha256: sha.repeat(64), url: `https://launchacard.fun/api/live/assets/${sha.repeat(64)}.${ext}`, mimeType, bytes: 1 });
  const three = { artwork: asset("a", "png", "image/png"), cardImage: asset("b", "png", "image/png"), caseImage: asset("c", "png", "image/png") };
  test("shows the server-made turning card with its still, and nothing for a launch saved before it", () => {
    const html = renderToStaticMarkup(createElement(LiveTokenImage, { intent: { name: "Glorb", assets: { ...three, tokenImage: asset("d", "gif", "image/gif"), tokenPoster: asset("e", "png", "image/png") } } }));
    expect(html).toContain(`src="${asset("d", "gif", "image/gif").url}"`);
    expect(html).toContain('width="1024" height="1024"');
    expect(html).toContain('alt="Glorb coin image: your complete card turning from front to back"');
    expect(html).toContain(`href="${asset("d", "gif", "image/gif").url}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain(`href="${asset("e", "png", "image/png").url}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain("Wallets that cannot play it show the front.");
    // The artwork, card and case prints are never offered as the coin image.
    for (const role of Object.values(three)) expect(html).not.toContain(role.url);
    expect(renderToStaticMarkup(createElement(LiveTokenImage, { intent: { name: "Glorb", assets: three } }))).toBe("");
    const compact = renderToStaticMarkup(createElement(LiveTokenImage, { intent: { name: "Glorb", assets: { ...three, tokenImage: asset("d", "gif", "image/gif") } }, compact: true }));
    expect(compact).toContain('data-compact="true"'); expect(compact).not.toContain("Wallets that cannot");
    expect(compact).not.toContain(">Still<");
  });
});

// What a guard-adding wallet returns: its own version of the message (a test-side rewrite), signed in the creator slot.
const walletRewrites = (rewrite: (message: Uint8Array) => Uint8Array) => fakeWallet(unsigned => unsignedTransaction(rewrite(messageOf(unsigned))));
const LIGHTHOUSE_V0 = "L1TEVtgA75k273wWz1s6XMmDhQY5i3MwcvKb4VbZzfK";
describe("Phantom's Lighthouse assertions in the browser", () => {
  for (const [kind, make, seed] of [["coin", fixture, assetSeed], ["card", nftFixture, nftSeed]] as const) test(`the page co-signs a ${kind} message with appended read-only assertions, recompiled mid-way through the readonly keys`, async () => {
    const { plan, expected } = make(), wallet = walletRewrites(message => phantomGuarded(message, [{ target: creator, data: payerGuardData(10_000_000n) }, { target: expected.mint, data: tokenGuardData(1n) }]));
    const signed = await signPlanWithWallet(plan, expected, { address: expected.mint, seed: seed.slice() }, "wallet-first", wallet.sign);
    expect(wallet.shown).toHaveLength(1);
    const final = parseLiveTransaction(signed);
    expect(hexHash(final.message)).not.toBe(plan.messageSha256);
    expect(final.programs.slice(-2)).toEqual([LIVE_PROGRAMS.lighthouse, LIVE_PROGRAMS.lighthouse]);
    expect(final.signers).toEqual([creator, expected.mint]);
    // Both signatures cover the message the wallet returned, not the plan's.
    expect(ed25519.verify(final.signatures[0], final.message, fromBase58(creator))).toBe(true);
    expect(ed25519.verify(final.signatures[1], final.message, fromBase58(expected.mint))).toBe(true);
  });
  test("a refreshed blockhash goes through to the server, which re-checks it before relaying anything", () => {
    const { plan } = fixture(), unsigned = fromBase64(plan.transactionBase64);
    const refreshed = phantomGuarded(messageOf(unsigned), [{ target: creator, data: payerGuardData() }], { blockhash: base58(new Uint8Array(32).fill(9)) });
    const signed = unsignedTransaction(refreshed); signed.set(ed25519.sign(refreshed, creatorSeed), 1);
    expect(validateWalletFirstResult(unsigned, signed, creator)).toEqual(signed);
  });
  test("assertions outside the rule are refused and never co-signed", async () => {
    const { plan, expected } = fixture(), payer = { target: creator, data: payerGuardData() };
    const stranger = base58(new Uint8Array(32).fill(66));
    for (const rewrite of [
      (message: Uint8Array) => phantomGuarded(message, [{ ...payer, program: LIGHTHOUSE_V0 }]),
      (message: Uint8Array) => phantomGuarded(message, [{ target: creator, data: Uint8Array.from([0, 0, 0]) }]),
      (message: Uint8Array) => phantomGuarded(message, [payer], { writableProgram: true }),
      (message: Uint8Array) => phantomGuarded(message, [{ ...payer, program: stranger }], { at: 1 }),
      (message: Uint8Array) => phantomGuarded(message, [{ target: stranger, data: payerGuardData() }], { newKeys: [stranger] }),
      (message: Uint8Array) => phantomGuarded(message, [{ ...payer, extraAccounts: [mint] }]),
    ]) {
      const wallet = walletRewrites(rewrite);
      const refused = await signPlanWithWallet(plan, expected, { address: mint, seed: assetSeed.slice() }, "wallet-first", wallet.sign).then(() => null, (error: unknown) => error);
      expect(refused).toBeInstanceOf(WalletChangedTransaction);
      expect(parseLiveTransaction((refused as WalletChangedTransaction).returned).signatures[1].every(byte => byte === 0)).toBe(true);
    }
  });
  test("assertions Phantom places among the plan instructions are co-signed, as on a real card (2026-10-31)", async () => {
    const { plan, expected } = fixture(), payer = { target: creator, data: payerGuardData() };
    for (const at of [0, 1, 2]) {
      const signed = await signPlanWithWallet(plan, expected, { address: mint, seed: assetSeed.slice() }, "wallet-first", walletRewrites(message => phantomGuarded(message, [payer, payer], { at })).sign);
      expect(parseLiveTransaction(signed).signatures.every(signature => signature.some(Boolean))).toBe(true);
    }
  });
  test("a page-first plan must come back byte for byte: the page's signature covers the exact message", async () => {
    const { plan, expected } = fixture(), wallet = walletRewrites(message => phantomGuarded(message, [{ target: creator, data: payerGuardData() }]));
    const refused = await signPlanWithWallet(plan, expected, { address: mint, seed: assetSeed.slice() }, "page-first", wallet.sign).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(WalletChangedTransaction);
  });
  test("the parser takes up to 32 instructions, enough for nine or more assertions", () => {
    const { plan } = fixture(), message = messageOf(fromBase64(plan.transactionBase64));
    // Three plan instructions here; the decoder takes 32 in all.
    expect(parseLiveTransaction(unsignedTransaction(phantomGuarded(message, Array.from({ length: 16 }, () => ({ target: creator, data: payerGuardData() }))))).instructions).toHaveLength(19);
    expect(parseLiveTransaction(unsignedTransaction(phantomGuarded(message, Array.from({ length: 29 }, () => ({ target: creator, data: Uint8Array.from([6, 0]) }))))).instructions).toHaveLength(32);
    expect(() => parseLiveTransaction(unsignedTransaction(phantomGuarded(message, Array.from({ length: 30 }, () => ({ target: creator, data: Uint8Array.from([6, 0]) })))))).toThrow("instruction count");
  });
});

describe("the wallet step with one wallet-first retry", () => {
  const signer = () => ({ address: mint, seed: assetSeed.slice() });
  const feeChange = (unsigned: Uint8Array) => { const out = unsigned.slice(), at = out.findIndex((_, i) => out[i] === 9 && out[i + 1] === 3 && out[i + 2] === 232 && out[i + 3] === 3); out[at + 2] = 233; return out; };
  test("a wallet that appends accepted assertions signs once, wallet first", async () => {
    const { plan, expected } = fixture(), wallet = walletRewrites(message => phantomGuarded(message, [{ target: creator, data: payerGuardData() }]));
    const changed: Uint8Array[] = [], opened: boolean[] = [];
    const step = await signForLaunch({ plan, receivedAt: 1_000, now: () => 2_000, expected, signer: signer(), order: "wallet-first", refresh: async () => { throw new Error("not stale"); },
      walletSign: wallet.sign, onWalletChanged: (_plan, returned) => changed.push(returned), onWalletOpen: retry => opened.push(retry) });
    expect(step).toMatchObject({ status: "signed", order: "wallet-first", retried: false });
    expect(wallet.shown).toHaveLength(1); expect(changed).toHaveLength(0); expect(opened).toEqual([false]);
  });
  test("a wallet-first wallet that changes the fee is logged, then asked once more with the same unsigned transaction", async () => {
    const { plan, expected } = fixture(); let calls = 0;
    const wallet = fakeWallet(unsigned => ++calls === 1 ? feeChange(unsigned) : unsigned);
    const changed: Uint8Array[] = [], opened: boolean[] = [];
    const step = await signForLaunch({ plan, receivedAt: 1_000, now: () => 2_000, expected, signer: signer(), order: "wallet-first", refresh: async () => { throw new Error("not stale"); },
      walletSign: wallet.sign, onWalletChanged: (_plan, returned) => changed.push(returned), onWalletOpen: retry => opened.push(retry) });
    expect(step).toMatchObject({ status: "signed", order: "wallet-first", retried: true });
    expect(changed).toHaveLength(1); expect(opened).toEqual([false, true]);
    // Neither prompt carried any signature: the wallet always signs first (Phantom warns otherwise).
    for (const shown of wallet.shown) expect(parseLiveTransaction(shown).signatures.every(sig => sig.every(b => b === 0))).toBe(true);
    if (step.status !== "signed") throw new Error("Expected signed");
    const final = parseLiveTransaction(step.signed);
    expect(hexHash(final.message)).toBe(plan.messageSha256);
    expect(ed25519.verify(final.signatures[1], final.message, fromBase58(mint))).toBe(true);
    expect(WALLET_RETRY_NOTICE).toContain("nothing was sent");
  });
  test("a wallet-first wallet that changes the message twice stops with nothing signed by this page", async () => {
    const { plan, expected } = fixture(), wallet = fakeWallet(feeChange), changed: Uint8Array[] = [];
    const refused = await signForLaunch({ plan, receivedAt: 1_000, now: () => 2_000, expected, signer: signer(), order: "wallet-first", refresh: async () => { throw new Error("not stale"); },
      walletSign: wallet.sign, onWalletChanged: (_plan, returned) => changed.push(returned) }).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(WalletChangedTransaction);
    expect(wallet.shown).toHaveLength(2); expect(changed).toHaveLength(2);
    for (const shown of wallet.shown) expect(parseLiveTransaction(shown).signatures.every(sig => sig.every(b => b === 0))).toBe(true);
  });
  test("a page-first wallet that changes the message is not retried", async () => {
    const { plan, expected } = fixture(), wallet = fakeWallet(feeChange), changed: Uint8Array[] = [];
    const refused = await signForLaunch({ plan, receivedAt: 1_000, now: () => 2_000, expected, signer: signer(), order: "page-first", refresh: async () => { throw new Error("not stale"); },
      walletSign: wallet.sign, onWalletChanged: (_plan, returned) => changed.push(returned) }).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(WalletChangedTransaction);
    expect(wallet.shown).toHaveLength(1); expect(changed).toHaveLength(1);
  });
  test("a stale plan is prepared again before the retry, and a moved cost returns to the review", async () => {
    const { plan, expected } = fixture(); let clock = 1_000, calls = 0, refreshes = 0;
    const wallet = fakeWallet(unsigned => { clock += 40_000; return ++calls === 1 ? feeChange(unsigned) : unsigned; });
    const step = await signForLaunch({ plan, receivedAt: 1_000, now: () => clock, expected, signer: signer(), order: "wallet-first",
      refresh: async () => { refreshes++; return { ...plan, review: { ...plan.review, totalDebitLamports: "9999999" } }; }, walletSign: wallet.sign });
    expect(refreshes).toBe(1); expect(wallet.shown).toHaveLength(1);
    expect(step).toMatchObject({ status: "changed" });
  });
});

describe("the initial-buy refusal copy", () => {
  test("names a tokenized-stock quote's own reason, the size reason otherwise, and nothing when the buy fits", () => {
    expect(liveBuyRefusal({ buyFits: true, buyBlocked: null })).toBeNull();
    expect(liveBuyRefusal({ buyFits: false, buyBlocked: "issuer-controls" })).toBe(STOCK_BUY_WARNS);
    expect(liveBuyRefusal({ buyFits: false, buyBlocked: null })).toBe(BUY_DOES_NOT_FIT);
    expect(liveBuyRefusal({ buyFits: false })).toBe(BUY_DOES_NOT_FIT);
  });
  test("the Launch page's buy is off with the server's reason, and off from the start for a tokenized-stock quote (MW-2)", () => {
    // A size or issuer refusal from the server is shown as it says.
    expect(liveBuyOff("meme", BUY_DOES_NOT_FIT)).toBe(BUY_DOES_NOT_FIT);
    expect(liveBuyOff("stock", STOCK_BUY_WARNS)).toBe(STOCK_BUY_WARNS);
    // Before sign-in the size check has no answer: a stock quote's buy is off with its own reason, others stay on.
    expect(liveBuyOff("stock", undefined)).toBe(STOCK_BUY_WARNS);
    expect(liveBuyOff("native", undefined)).toBeNull();
    expect(liveBuyOff("meme", undefined)).toBeNull();
    // The server's answer that the buy fits wins.
    expect(liveBuyOff("stock", null)).toBeNull();
    expect(liveBuyOff("native", null)).toBeNull();
  });
});
