import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { parseLiveAmount, formatLiveAmount } from "../../src/components/carddex/live/amounts";
import { getPairAsset, PAIR_ASSETS } from "../../src/lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../../src/lib/carddex/design-pairings";
import { base58, fromBase58, hexHash, LIVE_PROGRAMS, parseLiveTransaction, partiallySignPlan, toBase64, validateLivePlan, validateWalletResult, destroyEphemeralSigner, type ExpectedPlan, type TransactionPlan } from "../../src/components/carddex/live/transaction";

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
      expect(() => validateLivePlan(nft.plan, {...nft.expected, cardTemplate: "spark"})).toThrow("card NFT attributes");
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
