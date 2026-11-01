/**
 * A launch's initial buy on a token pair is paid in that token, from the creator's wallet. Said before anything is
 * uploaded, with the way forward (owner report 1 November 2026: "Your wallet needs Fartcoin before its initial buy").
 */
export function quoteBuyShortfall(symbol: string, have: string | null, need: string): string {
  return have === null || /^0(\.0*)?$/.test(have)
    ? `Your initial buy is paid in ${symbol}, and this wallet has none. Get ${symbol} first, or set the initial buy to 0 and buy after launch.`
    : `Your initial buy is ${need} ${symbol}, but this wallet has ${have} ${symbol}. Lower the buy, get more ${symbol}, or set it to 0 and buy after launch.`;
}
