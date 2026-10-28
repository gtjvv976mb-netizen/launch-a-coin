// Fee math shared by the client (reviews, quotes) and the server (the source of truth). Pure functions on the
// constants in constants.ts: no imports beyond them, safe in every bundle (backlog P0-8, P1-9).
//
// Card sales: the buyer pays the price; the protocol keeps DEED_PROTOCOL_BPS, the launcher gets the resale
// royalty (nothing when the launcher is the seller), and the seller gets the rest. Separately, the seller keeps
// whatever card fees are still in the card's fee vault: the sale sweeps the vault to them.

import { CREATOR_ROYALTY_BPS, DEED_PROTOCOL_BPS, OWNER_FEE_BPS, TRADE_FEE_BPS } from "./constants";

export type SaleSplit = {
  /** Protocol fee on the sale (lamports). */
  protocol: number;
  /** Resale royalty to the launcher (lamports); 0 when the launcher sells their own card. */
  royalty: number;
  /** What the seller gets from the price after both (lamports), before the fee vault. */
  sellerNet: number;
};

/** Split a card sale price. `creatorId === sellerId` means the launcher is selling, so no royalty. */
export function saleSplit(price: number, creatorId: string, sellerId: string): SaleSplit {
  const protocol = Math.floor((price * DEED_PROTOCOL_BPS) / 10000);
  const royalty = creatorId === sellerId ? 0 : Math.floor((price * CREATOR_ROYALTY_BPS) / 10000);
  return { protocol, royalty, sellerNet: price - protocol - royalty };
}

/**
 * The trade fee as line items (P1-9 step 8), so the fee row is built from data. Test mode has one line: the 1%
 * fee, half of it to the card's fee vault. On devnet this becomes pump.fun's fee plus the creator fee that
 * fills the vault, without touching the ticket's markup.
 */
export type FeeLine = { key: string; bps: number };
export const TRADE_FEE_LINES: readonly FeeLine[] = [{ key: "trade", bps: TRADE_FEE_BPS }];
/** The share of each trade that fills the card's fee vault (bps of the trade). */
export const VAULT_BPS = OWNER_FEE_BPS;

/** Slippage the trade ticket allows: the order fails if the fill is worse than the quote by more than this. */
export const MAX_SLIPPAGE_BPS = 200;
/** Above this price impact the ticket warns before a buy or sell (fraction, 0.05 = 5%). */
export const HIGH_IMPACT = 0.05;

/** The least a trade may return given a quote, after the allowed slippage. */
export function minOutAfterSlippage(quoted: number): number {
  return Math.floor((quoted * (10000 - MAX_SLIPPAGE_BPS)) / 10000);
}
