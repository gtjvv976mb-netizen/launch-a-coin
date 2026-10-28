// Fee math mirrored from card-program-v2 §7.7 (sale splits) and §8 (what a holder can withdraw).

const BPS = 10_000n;

export interface SaleSplits {
  protocolFee: bigint;
  royalty: bigint;
  sellerNet: bigint;
}

/**
 * `protocol = floor(price × protocol_bps / 1e4)`, `royalty = floor(price × royalty_bps / 1e4)` (0 when the seller is
 * the launcher), `seller_net = price − protocol − royalty`. The three always sum to the price (test U7).
 */
export function saleSplits(
  price: bigint,
  protocolFeeBps: number,
  royaltyBps: number,
  sellerIsLauncher: boolean
): SaleSplits {
  if (price < 0n) throw new RangeError("negative price");
  const protocolFee = (price * BigInt(protocolFeeBps)) / BPS;
  const royalty = sellerIsLauncher ? 0n : (price * BigInt(royaltyBps)) / BPS;
  return { protocolFee, royalty, sellerNet: price - protocolFee - royalty };
}

/** Fee bps that a sale actually charges (compared with the `max_total_fee_bps` guard). */
export const effectiveFeeBps = (protocolFeeBps: number, royaltyBps: number, sellerIsLauncher: boolean): number =>
  protocolFeeBps + (sellerIsLauncher ? 0 : royaltyBps);

export interface FeeBalances {
  /** Lamports in the card vault `["card", mint]`. */
  vaultLamports: bigint;
  /** Lamports in pump's `["creator-vault", card_vault]` (curve leg). */
  pumpCreatorVaultLamports: bigint;
  /** WSOL token `amount` in the AMM creator vault ATA (AMM leg); null when the ATA does not exist. */
  ammVaultAtaAmount: bigint | null;
  /** Lamports of every WSOL token account owned by the card vault (leg 3; closing returns all of it). */
  vaultWsolAccountLamports: bigint[];
  /** `Rent::minimum_balance(0)` of the cluster (650,240 on devnet and on mainnet, read 2026-10-04). Read it from RPC. */
  rent0: bigint;
  /** Optional, unused since localnet test L7 (2026-10-03): pAMM does not skip AMM balances below token-account rent. */
  tokenAccountRent?: bigint;
}

export interface WithdrawableBreakdown {
  /** Spendable without a sweep: max(vault − rent0, 0). */
  vaultAvailable: bigint;
  curveLeg: bigint;
  ammLeg: bigint;
  wsolLeg: bigint;
  /** One-time vault top-up the first sweep's signer pays (rent0 − vault when below rent). */
  topUp: bigint;
  /** What a `withdraw_fees` would move from the vault to the holder right now (≥ 0; 0 = NothingToWithdraw). */
  total: bigint;
  /** The holder's balance change from the withdraw: total − topUp (before the tx fee). */
  netToHolder: bigint;
  /**
   * Always false. Kept for compatibility: card-program-v2 §7.4 planned a UI "pending" state in case pAMM skipped AMM
   * balances below token-account rent, but localnet test L7 showed `transfer_creator_fees_to_pump` moves any non-zero
   * balance (it closes and re-creates the ATA), so every AMM balance is withdrawable (card-program-v2 §18.5).
   */
  ammLegMaybeSkipped: boolean;
}

/**
 * The seller's fee floor for `accept_bid(.., min_fees_to_seller)` and `list_card(.., min_fees_to_seller)`
 * (card-program-v2 §18.9, audit A1): exactly what the sale's sweep + vault payout (`CardSold.fees_to_seller`) would
 * pay the seller right now, i.e. `withdrawableBreakdown(b).total`. Fill `vaultWsolAccountLamports` from
 * `getTokenAccountsByOwner(card_vault, { mint: WSOL })` and pass the same accounts as the sale's extra WSOL accounts.
 * Accrued fees only grow until someone withdraws them, so the floor holds unless they were hidden from the sale.
 */
export const sellerFeeFloor = (b: FeeBalances): bigint => withdrawableBreakdown(b).total;

export function withdrawableBreakdown(b: FeeBalances): WithdrawableBreakdown {
  const pos = (x: bigint) => (x > 0n ? x : 0n);
  const vaultAvailable = pos(b.vaultLamports - b.rent0);
  const curveLeg = pos(b.pumpCreatorVaultLamports - b.rent0);
  const ammLeg = b.ammVaultAtaAmount ?? 0n;
  const wsolLeg = b.vaultWsolAccountLamports.reduce((s, x) => s + x, 0n);
  const topUp = pos(b.rent0 - b.vaultLamports);
  // The AMM leg lands in pump's creator vault first, and pump's collect keeps rent0 there, so the two legs
  // are netted together. After the top-up the vault holds max(vault, rent0); everything above rent0 is paid out.
  const total = vaultAvailable + pos(b.pumpCreatorVaultLamports + ammLeg - b.rent0) + wsolLeg;
  const ammLegMaybeSkipped = false; // L7: pAMM never skips a non-zero AMM balance
  return { vaultAvailable, curveLeg, ammLeg, wsolLeg, topUp, total, netToHolder: total - topUp, ammLegMaybeSkipped };
}
