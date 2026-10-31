import { MAX_FEE_RECIPIENTS, TOTAL_FEE_BPS, type FeeRecipient } from "../../../../../integrations/pumpfun/src/fee-share-rules";

/**
 * The Launch form's "Share creator fees" group, without UI: rows of wallet + percent, their checks and the total. Light
 * on purpose (no curve maths): the form ships in the main bundle. The panel checks each wallet is on the ed25519 curve
 * before anything is uploaded, and the server checks everything again.
 */
export { MAX_FEE_RECIPIENTS };
export const FEE_SPLIT_PERMANENT = "The split is permanent. pump.fun allows it to be set once, and it can't be changed afterward.";
export const FEE_SPLIT_WALLETS = "Recipients must be Solana wallets.";
export const FEE_SPLIT_FREE = "pump.fun pays creator fees; Launch a Card takes none.";
/** What sharing adds: its own approval after the card, and pump.fun's account rent. */
export const FEE_SPLIT_STEP = "Your wallet approves the split separately, after your coin and card are confirmed. It costs a network fee and about 0.006 SOL of rent for pump.fun's fee-sharing account (about 0.0075 SOL on a token pair).";
/** Off: pump.fun's default. */
export const FEE_SPLIT_DEFAULT = "Off: you keep 100% of your coin's creator fees, pump.fun's default.";

export type FeeSplitRow = { wallet: string; percent: string };
export type FeeSplitDraft = { on: boolean; rows: FeeSplitRow[] };
export const EMPTY_FEE_SPLIT: FeeSplitDraft = { on: false, rows: [] };

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A base58 string that decodes to exactly 32 bytes (a Solana address; whether it is a wallet is checked later). */
export function isAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  let length = 0;
  while (n) { length++; n /= 256n; }
  for (const c of value) { if (c !== "1") break; length++; }
  return length === 32;
}
/** A share typed as a percent ("12.5", "33.33") in whole basis points, or null: more than 0, at most 100, up to 2 decimals. */
export function percentToBps(text: string): number | null {
  const value = text.trim().replace(/%$/, "").trim();
  const match = /^(\d{0,3})(?:\.(\d{0,2}))?$/.exec(value);
  if (!match || !match[1] && !match[2]) return null;
  const bps = Number(match[1] || "0") * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps > 0 && bps <= TOTAL_FEE_BPS ? bps : null;
}
/** Basis points as the page shows them: "12.5%", "33.33%", "100%". */
export function formatShare(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}
/** The rows' total in basis points, counting only shares that read as a percent. */
export function feeSplitTotal(rows: readonly FeeSplitRow[]): number {
  return rows.reduce((total, row) => total + (percentToBps(row.percent) ?? 0), 0);
}
export type FeeSplitCheck = {
  /** Per row, the problem with its wallet and its share, in the field's own words (null when fine). */
  rows: { wallet: string | null; percent: string | null }[];
  /** The total's problem (not 100%), or the group's (no rows). */
  total: string | null;
  /** The split as whole basis points, when every check passes. */
  shares: FeeRecipient[] | null;
};
/** Every check the form can make without curve maths, in the words shown under each field. */
export function checkFeeSplit(rows: readonly FeeSplitRow[]): FeeSplitCheck {
  const seen = new Map<string, number>();
  const checked = rows.map((row, index) => {
    const wallet = row.wallet.trim();
    const walletProblem = !wallet ? "Enter a Solana wallet address." : !isAddress(wallet) ? "This is not a Solana wallet address." : seen.has(wallet) ? "This wallet is already in the split." : null;
    if (wallet && !seen.has(wallet)) seen.set(wallet, index);
    const percentProblem = !row.percent.trim() ? "Enter a share." : percentToBps(row.percent) === null ? "Use a share above 0 and up to 100, with at most 2 decimals." : null;
    return { wallet: walletProblem, percent: percentProblem };
  });
  const total = feeSplitTotal(rows);
  const totalProblem = !rows.length ? "Add at least one wallet, or turn fee sharing off."
    : rows.length > MAX_FEE_RECIPIENTS ? `A split can have at most ${MAX_FEE_RECIPIENTS} wallets.`
      : total !== TOTAL_FEE_BPS ? `The shares add up to ${formatShare(total)}. They must add up to exactly 100%.` : null;
  const ok = !totalProblem && checked.every(row => !row.wallet && !row.percent);
  return { rows: checked, total: totalProblem, shares: ok ? rows.map(row => ({ address: row.wallet.trim(), bps: percentToBps(row.percent)! })) : null };
}
/** A saved draft's split, as far as it reads (anything else is dropped). */
export function readFeeSplitDraft(value: unknown): FeeSplitDraft {
  if (!value || typeof value !== "object") return EMPTY_FEE_SPLIT;
  const { on, rows } = value as { on?: unknown; rows?: unknown };
  const kept = Array.isArray(rows) ? rows.slice(0, MAX_FEE_RECIPIENTS).filter((row): row is FeeSplitRow => !!row && typeof row === "object" &&
    typeof (row as FeeSplitRow).wallet === "string" && typeof (row as FeeSplitRow).percent === "string")
    .map(row => ({ wallet: row.wallet.slice(0, 44), percent: row.percent.slice(0, 6) })) : [];
  return { on: on === true, rows: kept };
}
/** The starting rows when sharing is turned on: the connected wallet with 100%, or one empty row. */
export function firstFeeSplitRows(connected: string | null): FeeSplitRow[] {
  return [{ wallet: connected ?? "", percent: "100" }];
}
