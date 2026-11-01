import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, AccountState, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { readQuoteBalance } from "../src/market.ts";

// A token pair's initial buy is paid in that token: the Launch form reads the wallet's balance first (1 November 2026).
const FARTCOIN = new PublicKey("9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump");
function tokenAccount(owner: PublicKey, mint: PublicKey, amount: bigint, frozen = false) {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: frozen ? AccountState.Frozen : AccountState.Initialized,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
  return { data, owner: TOKEN_PROGRAM_ID, lamports: 2_039_280, executable: false };
}

describe("quote balance for an initial buy", () => {
  test("the wallet's balance is its associated account's; none, or frozen, is zero", async () => {
    const owner = Keypair.generate().publicKey, ata = getAssociatedTokenAddressSync(FARTCOIN, owner, false, TOKEN_PROGRAM_ID);
    const read = (account: ReturnType<typeof tokenAccount> | null) => readQuoteBalance({
      async getAccountInfo(key: PublicKey) { expect(key.equals(ata)).toBe(true); return account as never; },
    }, { owner: owner.toBase58(), quoteMint: FARTCOIN.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58() });
    expect(await read(null)).toBe(0n);
    expect(await read(tokenAccount(owner, FARTCOIN, 2_500_000n))).toBe(2_500_000n);
    expect(await read(tokenAccount(owner, FARTCOIN, 2_500_000n, true))).toBe(0n);
  });
});
