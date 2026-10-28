/**
 * The ownership message, in the Sign In With Solana layout wallets recognise. Its grammar allows the chain ids
 * mainnet, testnet, devnet, localnet and solana:mainnet/testnet/devnet only (github.com/phantom/sign-in-with-solana).
 * The server writes it and checks the stored copy; the page reads it back before asking the wallet to sign it.
 */
export const LIVE_SIGN_IN_CHAIN_ID = "mainnet";
export const LIVE_SIGN_IN_STATEMENT = "Authorize Launch a Card launch preparation. This message does not send a transaction or move funds.";
const HEADER = " wants you to sign in with your Solana account:";

export function liveSignInMessage(input: {origin: string; wallet: string; nonce: string; issuedAt: Date; expiresAt: Date}): string {
  return `${new URL(input.origin).host}${HEADER}\n${input.wallet}\n\n${LIVE_SIGN_IN_STATEMENT}\n\nURI: ${input.origin}\nVersion: 1\nChain ID: ${LIVE_SIGN_IN_CHAIN_ID}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt.toISOString()}\nExpiration Time: ${input.expiresAt.toISOString()}`;
}

/**
 * Null when the message is exactly this site's ownership message for this wallet on mainnet, else the plain reason
 * it is not. Both sides run it: the server before it accepts a signature, the page before it opens the wallet.
 */
export function liveSignInProblem(message: string, expected: {origin: string; wallet: string}): string | null {
  const lines = message.split("\n");
  const field = (index: number, label: string) => lines[index]?.startsWith(`${label}: `) ? lines[index].slice(label.length + 2) : null;
  let host: string;
  try { host = new URL(expected.origin).host; } catch { return "This site's address could not be read, so no message was signed."; }
  if (lines.length !== 11 || lines[0] !== `${host}${HEADER}` || field(5, "URI") !== expected.origin) return "This ownership message is for another site, so it was not signed.";
  if (lines[1] !== expected.wallet) return "This ownership message names another wallet, so it was not signed.";
  if (lines[2] !== "" || lines[3] !== LIVE_SIGN_IN_STATEMENT || lines[4] !== "" || field(6, "Version") !== "1") return "This ownership message has unexpected wording, so it was not signed.";
  if (field(7, "Chain ID") !== LIVE_SIGN_IN_CHAIN_ID) return "This ownership message is not for Solana mainnet, so it was not signed.";
  const nonce = field(8, "Nonce"), issued = field(9, "Issued At"), expires = field(10, "Expiration Time");
  const time = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? Date.parse(value) : NaN;
  if (!nonce || !/^[A-Za-z0-9]{8,}$/.test(nonce) || !(time(issued) < time(expires))) return "This ownership message is incomplete, so it was not signed.";
  return null;
}
