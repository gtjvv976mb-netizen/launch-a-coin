// Offline safety coverage for the retained SDK source reference. These checks
// exercise encoders/verifier math only, without enabling a CardDex chain adapter.
import { describe, expect, test } from "bun:test";
import {
  base58Encode, cardVaultPda, compileV0Message, decodeTransaction, pumpBuy,
  pumpSell, serializeTransaction, systemTransfer, verifyTransaction,
  DEVNET_PUMP_FEE_RECIPIENTS, DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  type Instruction, type TxIntent,
} from "@mintdex/chain-sdk";
import { INITIAL_RESERVES, quoteBuy, quoteSell } from "../../src/lib/mintdex/curve";

const address = (byte: number) => base58Encode(new Uint8Array(32).fill(byte));
const user = address(1), mint = address(2), other = address(3), creator = cardVaultPda(mint);
const feeRecipient = DEVNET_PUMP_FEE_RECIPIENTS[0], buybackFeeRecipient = DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[0];
const opts = { pumpFeeRecipients: DEVNET_PUMP_FEE_RECIPIENTS, pumpBuybackFeeRecipients: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS };
function transaction(instructions: Instruction[], payer = user) {
  const message = compileV0Message({ payer, instructions, recentBlockhash: address(4) });
  return serializeTransaction(message.bytes, message.signers.map(() => null));
}
const buy = (amount = 5000n, maxSolCost = 99_000_000n, owner = creator) => pumpBuy({ user, mint, creator: owner, feeRecipient, buybackFeeRecipient, amount, maxSolCost });
const intent: TxIntent = { kind: "pump_buy", user, mint, creator, minTokens: 1000n, maxSolCost: 100_000_000n };
describe("offline transaction verifier reference", () => {
  test("honest token buy passes and altered funds, recipient, payer and extra transfer fail", () => {
    expect(verifyTransaction(transaction([buy()]), intent, opts).ok).toBe(true);
    const attacks = [transaction([buy(999n)]), transaction([buy(5000n, 100_000_001n)]), transaction([buy(5000n, 1n, other)]), transaction([buy()], other), transaction([buy(), systemTransfer(user, other, 1n)])];
    for (const bytes of attacks) expect(verifyTransaction(bytes, intent, opts).ok).toBe(false);
    expect(verifyTransaction(transaction([buy()]), intent, {}).ok).toBe(false);
  });
  test("token sell exact amount and minimum output are protected", () => {
    const sellIntent: TxIntent = { kind: "pump_sell", user, mint, creator, amount: 7000n, minSolOutput: 1_000_000n };
    const sell = (amount: bigint, minSolOutput: bigint) => pumpSell({ user, mint, creator, feeRecipient, buybackFeeRecipient, amount, minSolOutput });
    expect(verifyTransaction(transaction([sell(7000n, 1_100_000n)]), sellIntent, opts).ok).toBe(true);
    expect(verifyTransaction(transaction([sell(8000n, 1_100_000n)]), sellIntent, opts).ok).toBe(false);
    expect(verifyTransaction(transaction([sell(7000n, 999_999n)]), sellIntent, opts).ok).toBe(false);
  });
  test("truncation and trailing bytes fail closed", () => {
    const bytes = transaction([buy()]);
    const decoded = decodeTransaction(bytes);
    expect(decoded.message.staticAccountKeys.slice(0, decoded.message.header.numRequiredSignatures)).toEqual([user]);
    for (const bad of [bytes.slice(0, 10), new Uint8Array([...bytes, 0]), new Uint8Array()]) expect(verifyTransaction(bad, intent, opts).ok).toBe(false);
  });
});
describe("CardDex token curve math", () => {
  test("integer reserve accounting conserves each fee, with no NFT royalty or creator income", () => {
    for (const amount of [1_000, 1_000_000, 1_000_000_000, 20_000_000_000]) {
      const buy = quoteBuy(INITIAL_RESERVES, amount);
      expect(buy.ok).toBe(true);
      expect(buy.ownerFee).toBe(0);
      expect(buy.protocolFee).toBe(buy.fee);
      expect(buy.after.vSol - INITIAL_RESERVES.vSol + buy.fee).toBe(amount);
      expect(INITIAL_RESERVES.vTok - buy.after.vTok).toBe(buy.tokensOut);
      const sell = quoteSell(buy.after, buy.tokensOut);
      expect(sell.ok).toBe(true);
      expect(sell.ownerFee).toBe(0);
      expect(sell.protocolFee).toBe(sell.fee);
      expect(sell.solOut + sell.fee).toBe(sell.gross);
      expect(sell.solOut).toBeLessThan(amount);
      expect(sell.after.vTok).toBe(INITIAL_RESERVES.vTok);
    }
  });
});
