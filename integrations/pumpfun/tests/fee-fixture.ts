import { createHash } from "node:crypto";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { creatorVaultPda, feeSharingConfigPda, PUMP_SDK } from "@pump-fun/pump-sdk";
import { PAIR_ASSETS } from "../src/index.ts";
import { pinnedLookupTable } from "../src/live.ts";
import tableFixture from "./fixtures/mainnet-pump-lookup-table-2026-10-29.json";

// An unsigned creator fee split plan in the adapter's exact shape, built offline from the pinned SDK and the recorded
// lookup table, for the browser verifier and wallet-flow tests in app/. No RPC, wallet or network is used.
const table = () => pinnedLookupTable({ executable: tableFixture.value.executable, owner: new PublicKey(tableFixture.value.owner), lamports: tableFixture.value.lamports,
  data: Buffer.from(tableFixture.value.data[0], "base64"), rentEpoch: 0 } as AccountInfo<Buffer>)!;
export async function feeSplitFixture(options: { creator: string; mint: string; quoteKey: "sol" | "usdc"; recipients: { address: string; bps: number }[] }) {
  const asset = PAIR_ASSETS.find((entry) => entry.key === options.quoteKey)!;
  const creator = new PublicKey(options.creator), mint = new PublicKey(options.mint), quoteMint = new PublicKey(asset.mint), quoteTokenProgram = new PublicKey(asset.tokenProgram);
  const sharingVault = creatorVaultPda(feeSharingConfigPda(mint)), shares = options.recipients.map((entry) => ({ address: new PublicKey(entry.address), shareBps: entry.bps }));
  const instructions = [
    await PUMP_SDK.sweepCreatorFeeInstruction({ payer: creator, mint, creator, quoteMint, quoteTokenProgram }),
    await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null }),
    ...(asset.key === "sol" ? [] : [createAssociatedTokenAccountIdempotentInstruction(creator, getAssociatedTokenAddressSync(quoteMint, sharingVault, true, quoteTokenProgram), sharingVault, quoteMint, quoteTokenProgram)]),
    asset.key === "sol"
      ? await PUMP_SDK.updateFeeShares({ authority: creator, mint, currentShareholders: [creator], newShareholders: shares, bondingCurveComplete: false })
      : await PUMP_SDK.updateFeeSharesV2({ authority: creator, mint, currentShareholders: [creator], newShareholders: shares, quoteMint, quoteTokenProgram, bondingCurveComplete: false }),
  ];
  const blockhash = new PublicKey(new Uint8Array(32).fill(7)).toBase58(), units = 400_000, microLamports = 1_000;
  const message = new TransactionMessage({ payerKey: creator, recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports }), ...instructions] }).compileToV0Message([table()]);
  const transaction = new VersionedTransaction(message), bytes = transaction.serialize();
  return {
    kind: "fees" as const, network: "solana:mainnet" as const, transactionBase64: Buffer.from(bytes).toString("base64"),
    messageSha256: createHash("sha256").update(message.serialize()).digest("hex"), blockhash, lastValidBlockHeight: 10_000,
    requiredSigners: [options.creator], feePayer: options.creator, bindingSha256: "a".repeat(64), verifiedSlot: 100,
    instructionPrograms: [...new Set(message.compiledInstructions.map((ix) => message.staticAccountKeys[ix.programIdIndex].toBase58()))],
    review: { networkFeeLamports: "5000", priorityFeeLamports: String(Math.ceil(units * microLamports / 1_000_000)), rentAndProgramCostLamports: "5852160", totalDebitLamports: "5857560",
      initialBuyQuoteBaseUnits: "0", launchInitialBuyQuoteBaseUnits: "0", quoteKey: asset.key, quoteMint: asset.mint, quoteDecimals: asset.decimals, minimumTokensOut: "0",
      computeUnitLimit: units, microLamportsPerComputeUnit: microLamports, transactionBytes: bytes.length, feeRecipients: options.recipients },
    expected: { creator: options.creator, tokenMint: options.mint, quoteKey: asset.key, quoteMint: asset.mint, quoteTokenProgram: asset.tokenProgram, recipients: options.recipients },
  };
}
