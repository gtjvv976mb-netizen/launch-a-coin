/** Shown when the coin transaction cannot carry an initial buy (Solana's 1232-byte packet limit). */
export const BUY_DOES_NOT_FIT = "An initial buy doesn't fit in one transaction for this pair and name. Launch without it, then buy on pump.fun.";
/** Shown at the initial-buy step while the size check has no answer (it needs a wallet sign-in). */
export const BUY_FIT_AFTER_SIGN_IN = "A buy that can't fit shows after wallet sign-in, before anything is uploaded.";
/**
 * Shown when the first buy would spend a tokenized-stock quote: wallets warn on any transaction that moves a token with
 * a permanent delegate, so those launches go without an initial buy (ALLOW_PERMANENT_DELEGATE_QUOTE_BUY).
 */
export const STOCK_BUY_WARNS = "Wallets warn when a first buy spends a tokenized-stock quote (issuer controls). Launch without a buy, then buy on pump.fun.";
