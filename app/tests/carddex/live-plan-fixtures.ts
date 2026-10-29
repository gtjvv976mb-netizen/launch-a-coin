import { ed25519 } from "@noble/curves/ed25519.js";
import { getPairAsset } from "../../src/lib/carddex/pairs";
import { base58, fromBase58, hexHash, LIVE_PROGRAMS, toBase64, type ExpectedPlan, type TransactionPlan } from "../../src/components/carddex/live/transaction";

// Prepared coin and card plans in this adapter's exact v0 shape, for the browser verifier and wallet-flow tests.
// Deterministic, unfunded test-only signers. No wallet, RPC or network is used.
export const creatorSeed = new Uint8Array(32).fill(3), assetSeed = new Uint8Array(32).fill(4), nftSeed = new Uint8Array(32).fill(5);
export const creator = base58(ed25519.getPublicKey(creatorSeed)), mint = base58(ed25519.getPublicKey(assetSeed)), nft = base58(ed25519.getPublicKey(nftSeed));
const encodeText = (text: string) => { const data = new TextEncoder().encode(text); return [data.length & 255, data.length >> 8 & 255, 0, 0, ...data]; };
const computeInstructions = [4,0,5,2,32,161,7,0,4,0,9,3,232,3,0,0,0,0,0,0];
const tokenUri = "https://launchacard.fun/m/test-token";
function short(n: number) { return n < 128 ? [n] : [(n & 127) | 128, n >> 7]; }
export function fixture(cardTemplate = "pokemon-classic", quoteKey = "sol") {
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

export function nftFixture(cardTemplate = "pokemon-classic", quoteKey = "sol") {
  const {plan: tokenPlan, expected: tokenExpected} = fixture(cardTemplate, quoteKey);
  const expected: ExpectedPlan = {...tokenExpected, kind:"nft", mint:nft};
  const attributes = {token_mint:mint,quote_mint:expected.quoteMint,card_design:expected.cardTemplate,binding_sha256:expected.bindingSha256,card_sha256:expected.cardImageSha256,metadata_sha256:expected.nftMetadataSha256};
  const createData = [20,0,...encodeText(expected.name),...encodeText(expected.nftMetadataUri),1,1,0,0,0,6,6,0,0,0,...Object.entries(attributes).flatMap(([key,value])=>[...encodeText(key),...encodeText(value)]),1,0,1,0,0,0,0];
  const blockhashBytes = new Uint8Array(32).fill(7);
  const message = Uint8Array.from([128,2,0,3,5,...fromBase58(creator),...fromBase58(nft),...fromBase58(LIVE_PROGRAMS.core),...new Uint8Array(32),...fromBase58(LIVE_PROGRAMS.compute),...blockhashBytes,4,...computeInstructions,2,8,1,2,0,0,0,0,3,2,...short(createData.length),...createData,2,6,1,2,0,0,3,2,5,15,0,0,1,0,0]);
  const bytes = Uint8Array.from([2,...new Uint8Array(128),...message]);
  const plan:TransactionPlan = {...tokenPlan,kind:"nft",requiredSigners:[creator,nft],transactionBase64:toBase64(bytes),messageSha256:hexHash(message),instructionPrograms:[LIVE_PROGRAMS.compute,LIVE_PROGRAMS.core]};
  return {plan,expected,bytes};
}
