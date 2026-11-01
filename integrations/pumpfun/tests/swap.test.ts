import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, AccountState, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { checkSignedQuoteSwap, JUPITER_ROUTE_DISCRIMINATOR, LAUNCH_SOL_RESERVE_LAMPORTS, prepareQuoteSwap, reviewSwapInstructions, SwapRefused, type JupiterSwapInstructions } from "../src/swap.ts";

// Getting a token pair's quote with SOL (swap.ts). The fixture is Jupiter's real answer for 1 Fartcoin (ExactOut),
// captured 1 November 2026, rewritten for a test keypair: its owner and token accounts swapped for the test wallet's.
const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/jupiter-fartcoin-exact-out.json"), "utf8"));
const FARTCOIN = new PublicKey("9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump");
const CAPTURED = new PublicKey("8pvZ1zaCMkD1WnUUg4QZiLXnor25k7L1LqUEKBuLRR3c");
const creator = Keypair.generate();
const atas = (owner: PublicKey) => [owner, getAssociatedTokenAddressSync(NATIVE_MINT, owner), getAssociatedTokenAddressSync(FARTCOIN, owner)].map(k => k.toBase58());
function proposal(): JupiterSwapInstructions {
  let text = JSON.stringify(fixture.instructions);
  const [from, to] = [atas(CAPTURED), atas(creator.publicKey)];
  from.forEach((key, i) => { text = text.split(key).join(to[i]); });
  return JSON.parse(text);
}
const target = (over: Partial<Parameters<typeof reviewSwapInstructions>[1]> = {}) => ({
  creator: creator.publicKey.toBase58(), quoteMint: FARTCOIN.toBase58(), quoteTokenProgram: TOKEN_PROGRAM_ID.toBase58(), need: 1_000_000n, maxSpend: 50_000_000n, ...over,
});
const refused = (fn: () => unknown, words: string) => { try { fn(); } catch (error) { expect(error).toBeInstanceOf(SwapRefused); expect((error as Error).message).toContain(words); return; } throw new Error("not refused"); };

describe("Jupiter's proposal, against the allowlist", () => {
  test("the captured route passes: one Jupiter route, the creator's own accounts, the SOL it wraps", () => {
    expect(Buffer.from(fixture.instructions.swapInstruction.data, "base64").subarray(0, 8).toString("hex")).toBe(JUPITER_ROUTE_DISCRIMINATOR);
    const { instructions, wrapLamports, terms } = reviewSwapInstructions(proposal(), target());
    expect(instructions).toHaveLength(6);
    expect(wrapLamports).toBe(BigInt(fixture.quote.otherAmountThreshold));
    // The route's own terms, read from its data: Jupiter's quote, to the lamport.
    expect(terms).toEqual({ outAmount: 1_000_000n, quotedInAmount: BigInt(fixture.quote.inAmount), slippageBps: 100, maxIn: BigInt(fixture.quote.otherAmountThreshold) });
  });
  test("anything else is refused", () => {
    const p = () => proposal();
    const other = Keypair.generate().publicKey.toBase58();
    // SOL sent anywhere but the creator's own wSOL account.
    const steal = p(); steal.setupInstructions![1].accounts[1].pubkey = other;
    refused(() => reviewSwapInstructions(steal, target()), "moved SOL somewhere unexpected");
    // A second signer.
    const cosign = p(); cosign.swapInstruction.accounts.push({ pubkey: other, isSigner: true, isWritable: false });
    refused(() => reviewSwapInstructions(cosign, target()), "another signer");
    // Unwrapping to someone else.
    const drain = p(); drain.cleanupInstruction!.accounts[1].pubkey = other;
    refused(() => reviewSwapInstructions(drain, target()), "token instruction that is not allowed");
    // A token account for another owner.
    const foreign = p(); foreign.setupInstructions![0].accounts[2].pubkey = other;
    refused(() => reviewSwapInstructions(foreign, target()), "not the creator's own");
    // An unknown program, extra instructions, a ledger route, two routes, a non-route Jupiter call.
    const unknown = p(); unknown.setupInstructions!.push({ programId: other, accounts: [], data: "" });
    refused(() => reviewSwapInstructions(unknown, target()), "program that is not allowed");
    refused(() => reviewSwapInstructions({ ...p(), otherInstructions: [p().swapInstruction] }, target()), "extra instructions");
    refused(() => reviewSwapInstructions({ ...p(), tokenLedgerInstruction: p().swapInstruction }, target()), "Token-ledger");
    const twice = p(); twice.setupInstructions!.push(twice.swapInstruction);
    refused(() => reviewSwapInstructions(twice, target()), "more than one route");
    const notRoute = p(); notRoute.swapInstruction.data = Buffer.alloc(16).toString("base64");
    refused(() => reviewSwapInstructions(notRoute, target()), "not a plain Jupiter swap");
    // The route's pinned accounts (the security review's attack, 1 November 2026): its source must be the creator's wSOL,
    // its output the creator's quote account, its mints wSOL and the quote, and no platform fee account.
    const usdcAta = getAssociatedTokenAddressSync(new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), creator.publicKey).toBase58();
    for (const [index, key] of [[3, usdcAta], [6, other], [7, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"], [8, other], [9, other], [2, other]] as const) {
      const pinned = p(); pinned.swapInstruction.accounts[index].pubkey = key;
      expect(() => reviewSwapInstructions(pinned, target())).toThrow(SwapRefused);
    }
    // The creator or its accounts handed to the route's pools.
    const legs = p(); legs.swapInstruction.accounts.push({ pubkey: creator.publicKey.toBase58(), isSigner: false, isWritable: true });
    refused(() => reviewSwapInstructions(legs, target()), "passes the creator's accounts to its pools");
    // A platform fee in the route's own terms, or more slippage than allowed.
    const fee = p(); const feeData = Buffer.from(fee.swapInstruction.data, "base64"); feeData[feeData.length - 1] = 50; fee.swapInstruction.data = feeData.toString("base64");
    refused(() => reviewSwapInstructions(fee, target()), "platform fee");
    const slip = p(); const slipData = Buffer.from(slip.swapInstruction.data, "base64"); slipData.writeUInt16LE(5_000, slipData.length - 3); slip.swapInstruction.data = slipData.toString("base64");
    refused(() => reviewSwapInstructions(slip, target()), "too much slippage");
    // Wrapping more SOL than the route itself may take.
    const overwrap = p(); const wrap = Buffer.from(overwrap.setupInstructions![1].data, "base64"); wrap.writeBigUInt64LE(10_000_000n, 4); overwrap.setupInstructions![1].data = wrap.toString("base64");
    refused(() => reviewSwapInstructions(overwrap, target()), "more SOL than its route can use");
    // More SOL than the cap.
    refused(() => reviewSwapInstructions(p(), target({ maxSpend: 1_000_000n })), "more SOL than allowed");
  });
});

/** A fake mainnet: the route's lookup tables (holding every other account), a blockhash, and a simulation outcome. */
function fakeChain(outcome: { quoteAfter: bigint; payerAfter: bigint; err?: unknown; otherTokenAccounts?: PublicKey[]; wsolBefore?: bigint }) {
  const raw = proposal();
  const keys = new Set<string>();
  for (const ix of [...raw.setupInstructions!, raw.swapInstruction, raw.cleanupInstruction!]) for (const a of ix.accounts) if (!a.isSigner) keys.add(a.pubkey);
  const tableKey = new PublicKey(raw.addressLookupTableAddresses![0]);
  const table = new AddressLookupTableAccount({ key: tableKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined,
    addresses: [...keys].map(k => new PublicKey(k)) } });
  const quoteData = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode({ mint: FARTCOIN, owner: creator.publicKey, amount: outcome.quoteAfter, delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, quoteData);
  const blockhash = Keypair.generate().publicKey.toBase58();
  return {
    proposal: { ...raw, addressLookupTableAddresses: [tableKey.toBase58()] },
    connection: {
      async getAddressLookupTable(key: PublicKey) { return { value: key.equals(tableKey) ? table : null }; },
      async getLatestBlockhash() { return { blockhash, lastValidBlockHeight: 1000 }; },
      async getRecentPrioritizationFees() { return [{ slot: 1, prioritizationFee: 5_000 }]; },
      async getFeeForMessage() { return { value: 5_000 }; },
      async getAccountInfo() {
        if (outcome.wsolBefore === undefined) return null;
        const data = Buffer.alloc(ACCOUNT_SIZE);
        AccountLayout.encode({ mint: NATIVE_MINT, owner: creator.publicKey, amount: outcome.wsolBefore, delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized,
          isNativeOption: 1, isNative: 2_039_280n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
        return { data, owner: TOKEN_PROGRAM_ID, lamports: 2_039_280 + Number(outcome.wsolBefore), executable: false };
      },
      async getTokenAccountsByOwner(_owner: PublicKey, filter: { programId: PublicKey }) {
        return { value: filter.programId.equals(TOKEN_PROGRAM_ID) ? (outcome.otherTokenAccounts ?? []).map(pubkey => ({ pubkey, account: {} })) : [] };
      },
      async simulateTransaction() {
        return { value: { err: outcome.err ?? null, unitsConsumed: 120_000, innerInstructions: [], logs: [],
          accounts: [{ lamports: Number(outcome.payerAfter), owner: SystemProgram.programId.toBase58(), data: ["", "base64"], executable: false, rentEpoch: 0 },
            { lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), data: [quoteData.toString("base64"), "base64"], executable: false, rentEpoch: 0 }, null] } };
      },
    },
  };
}

describe("compiled, simulated and checked again once signed", () => {
  test("a plan is the site's own transaction: the creator alone signs and pays, within the size target; it leaves `need`", async () => {
    const chain = fakeChain({ quoteAfter: 1_000_000n, payerAfter: 1_000_000_000n });
    const plan = await prepareQuoteSwap(chain.connection as never, chain.proposal, target());
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    expect(tx.message.staticAccountKeys[0].equals(creator.publicKey)).toBe(true);
    expect(tx.serialize().length).toBeLessThanOrEqual(1072);
    // The most it takes: the SOL it wraps plus the network fee.
    expect(plan.spendLamports).toBe((BigInt(fixture.quote.otherAmountThreshold) + 5_000n).toString());
    expect(plan.quoteAfter).toBe("1000000");
  });
  test("a route that names any other token account of the creator's is refused, whatever it is for", async () => {
    const chain = fakeChain({ quoteAfter: 1_000_000n, payerAfter: 1_000_000_000n });
    const usdc = getAssociatedTokenAddressSync(new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), creator.publicKey);
    const named = { ...chain.proposal, swapInstruction: { ...chain.proposal.swapInstruction, accounts: [...chain.proposal.swapInstruction.accounts, { pubkey: usdc.toBase58(), isSigner: false, isWritable: true }] } };
    const withUsdc = fakeChain({ quoteAfter: 1_000_000n, payerAfter: 1_000_000_000n, otherTokenAccounts: [usdc] });
    await expect(prepareQuoteSwap(withUsdc.connection as never, named, target())).rejects.toThrow("another of the creator's token accounts");
  });
  test("short of the token, short of SOL to launch after, or a failed simulation: no plan", async () => {
    let chain = fakeChain({ quoteAfter: 999_999n, payerAfter: 1_000_000_000n });
    await expect(prepareQuoteSwap(chain.connection as never, chain.proposal, target())).rejects.toThrow("not leave enough of the token");
    chain = fakeChain({ quoteAfter: 1_000_000n, payerAfter: LAUNCH_SOL_RESERVE_LAMPORTS - 1n });
    await expect(prepareQuoteSwap(chain.connection as never, chain.proposal, target())).rejects.toThrow("enough SOL left to launch");
    chain = fakeChain({ quoteAfter: 1_000_000n, payerAfter: 1_000_000_000n, err: { InstructionError: [4, { Custom: 1 }] } });
    await expect(prepareQuoteSwap(chain.connection as never, chain.proposal, target())).rejects.toThrow("doesn't have enough SOL");
    // Wrapped SOL already in the wallet could be spent beyond what the swap wraps: refused, never counted on.
    chain = fakeChain({ quoteAfter: 1_000_000n, payerAfter: 1_000_000_000n, wsolBefore: 5_000_000n });
    await expect(prepareQuoteSwap(chain.connection as never, chain.proposal, target())).rejects.toThrow("holds wrapped SOL");
  });
  test("the signed copy must carry the creator's valid signature and the same route, and still deliver", async () => {
    const chain = fakeChain({ quoteAfter: 1_000_000n, payerAfter: 1_000_000_000n });
    const plan = await prepareQuoteSwap(chain.connection as never, chain.proposal, target());
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    tx.sign([creator]);
    const signedTarget = { ...target(), reviewedSpend: BigInt(plan.spendLamports), lookupTables: plan.lookupTables, preparedBase64: plan.transactionBase64 };
    const ok = await checkSignedQuoteSwap(chain.connection as never, Buffer.from(tx.serialize()).toString("base64"), signedTarget);
    expect(ok.quoteAfter).toBe(1_000_000n);
    // Signed by someone else.
    const forged = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    forged.signatures[0] = Keypair.generate().secretKey.subarray(0, 64);
    await expect(checkSignedQuoteSwap(chain.connection as never, Buffer.from(forged.serialize()).toString("base64"), signedTarget)).rejects.toThrow("signature did not verify");
    // Phantom's read-only check on the payer (signer and writable for the swap itself) is accepted; a check on an
    // account outside the swap is not.
    const tables = await Promise.all(plan.lookupTables.map(async key => (await chain.connection.getAddressLookupTable(new PublicKey(key))).value!));
    const decompiled = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64")).message, { addressLookupTableAccounts: tables });
    const guard = (account: PublicKey) => new TransactionInstruction({ programId: new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"), keys: [{ pubkey: account, isSigner: false, isWritable: false }], data: Buffer.from([6, 0, 1, 2]) });
    const withGuard = (account: PublicKey) => { const t = new VersionedTransaction(new TransactionMessage({ ...decompiled, instructions: [...decompiled.instructions, guard(account)] }).compileToV0Message(tables)); t.sign([creator]); return Buffer.from(t.serialize()).toString("base64"); };
    expect((await checkSignedQuoteSwap(chain.connection as never, withGuard(creator.publicKey), signedTarget)).quoteAfter).toBe(1_000_000n);
    await expect(checkSignedQuoteSwap(chain.connection as never, withGuard(Keypair.generate().publicKey), signedTarget)).rejects.toThrow("outside the swap");
    // A different (still allowlisted) route than the one prepared: refused, even when properly signed.
    const otherRoute = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64")).message, { addressLookupTableAccounts: tables });
    const route = otherRoute.instructions.find(ix => ix.programId.toBase58() === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")!;
    route.data = Buffer.from(route.data); route.data.writeBigUInt64LE(9_999n, route.data.length - 11);
    const swapped = new VersionedTransaction(new TransactionMessage(otherRoute).compileToV0Message(tables)); swapped.sign([creator]);
    await expect(checkSignedQuoteSwap(chain.connection as never, Buffer.from(swapped.serialize()).toString("base64"), signedTarget)).rejects.toThrow("different swap than the one you reviewed");
    // Prices moved so far it no longer delivers.
    const short = fakeChain({ quoteAfter: 10n, payerAfter: 1_000_000_000n });
    await expect(checkSignedQuoteSwap(short.connection as never, Buffer.from(tx.serialize()).toString("base64"), signedTarget)).rejects.toThrow("no longer leave enough");
  });
});
