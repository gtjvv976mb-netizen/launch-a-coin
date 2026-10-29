/**
 * The ownership message, in the Sign In With Solana layout wallets recognise. Its grammar allows the chain ids
 * mainnet, testnet, devnet, localnet and solana:mainnet/testnet/devnet only (github.com/phantom/sign-in-with-solana).
 * The server writes it and checks the stored copy; the page reads it back before asking the wallet to sign it.
 * "mainnet" is also what a solana:signIn request carries, so both routes sign the same text.
 */
export const LIVE_SIGN_IN_CHAIN_ID = "mainnet";
export const LIVE_SIGN_IN_STATEMENT = "Authorize Launch a Card launch preparation. This message does not send a transaction or move funds.";
const HEADER = " wants you to sign in with your Solana account:";

/**
 * A solana:signIn request with every field set by the server, so the wallet adds only the account it signs in with.
 * Its text (liveSignInText) is the plain ownership message's, so a wallet that signs it and the signMessage fallback
 * sign identical bytes.
 */
export type LiveSignInInput = {
  domain: string; uri: string; statement: string; version: "1"; chainId: typeof LIVE_SIGN_IN_CHAIN_ID;
  nonce: string; issuedAt: string; expirationTime: string;
};
export function liveSignInInput(input: {origin: string; nonce: string; issuedAt: Date; expiresAt: Date}): LiveSignInInput {
  return {domain: new URL(input.origin).host, uri: input.origin, statement: LIVE_SIGN_IN_STATEMENT, version: "1", chainId: LIVE_SIGN_IN_CHAIN_ID,
    nonce: input.nonce, issuedAt: input.issuedAt.toISOString(), expirationTime: input.expiresAt.toISOString()};
}
/** The exact SIWS text for this request and account: createSignInMessageText's layout for exactly these fields. */
export function liveSignInText(input: LiveSignInInput, address: string): string {
  return `${input.domain}${HEADER}\n${address}\n\n${input.statement}\n\nURI: ${input.uri}\nVersion: ${input.version}\nChain ID: ${input.chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expirationTime}`;
}
export function liveSignInMessage(input: {origin: string; wallet: string; nonce: string; issuedAt: Date; expiresAt: Date}): string {
  return liveSignInText(liveSignInInput(input), input.wallet);
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

/**
 * The page's check before a solana:signIn prompt: the request names this exact page (Phantom refuses a domain or URI
 * that differs from the page's, with error -32000 and no prompt) and this site's mainnet wording.
 */
export function liveSignInInputProblem(input: LiveSignInInput, origin: string): string | null {
  let host: string;
  try { host = new URL(origin).host; } catch { return "This site's address could not be read, so your wallet was not opened."; }
  if (input.domain !== host || input.uri !== origin) return `Open ${input.domain} to sign in. Your wallet checks that a sign-in names the site you are on.`;
  if (input.chainId !== LIVE_SIGN_IN_CHAIN_ID || input.version !== "1" || input.statement !== LIVE_SIGN_IN_STATEMENT) return "This sign-in request has unexpected wording, so your wallet was not opened.";
  if (!/^[A-Za-z0-9]{8,}$/.test(input.nonce) || !(Date.parse(input.issuedAt) < Date.parse(input.expirationTime))) return "This sign-in request is incomplete, so your wallet was not opened.";
  return null;
}

/** The SIWS fields of a signed message, as @solana/wallet-standard-util's parseSignInMessage reads them. */
export type ParsedSignIn = {
  domain: string; address: string; statement?: string; uri?: string; version?: string; chainId?: string; nonce?: string;
  issuedAt?: string; expirationTime?: string; notBefore?: string; requestId?: string; resources?: string[];
};
// The grammar of @solana/wallet-standard-util 1.x (createSignInMessageText's inverse). That package is not installed.
const SIGN_IN_GRAMMAR = new RegExp("^(?<domain>[^\\n]+?) wants you to sign in with your Solana account:\\n(?<address>[^\\n]+)(?:\\n|$)" +
  "(?:\\n(?<statement>[\\S\\s]*?)(?:\\n|$))??(?:\\nURI: (?<uri>[^\\n]+))?(?:\\nVersion: (?<version>[^\\n]+))?(?:\\nChain ID: (?<chainId>[^\\n]+))?" +
  "(?:\\nNonce: (?<nonce>[^\\n]+))?(?:\\nIssued At: (?<issuedAt>[^\\n]+))?(?:\\nExpiration Time: (?<expirationTime>[^\\n]+))?" +
  "(?:\\nNot Before: (?<notBefore>[^\\n]+))?(?:\\nRequest ID: (?<requestId>[^\\n]+))?(?:\\nResources:(?<resources>(?:\\n- [^\\n]+)*))?\\n*$");
export function parseSignInMessage(text: string): ParsedSignIn | null {
  const groups = SIGN_IN_GRAMMAR.exec(text)?.groups;
  if (!groups) return null;
  const optional = (value: string | undefined) => value === undefined || value === "" ? undefined : value;
  return {domain: groups.domain, address: groups.address, statement: optional(groups.statement), uri: optional(groups.uri), version: optional(groups.version),
    chainId: optional(groups.chainId), nonce: optional(groups.nonce), issuedAt: optional(groups.issuedAt), expirationTime: optional(groups.expirationTime),
    notBefore: optional(groups.notBefore), requestId: optional(groups.requestId), resources: groups.resources ? groups.resources.split("\n- ").slice(1) : undefined};
}
/**
 * verifySignIn's checks, without the package: the wallet's signed bytes parse as SIWS, every field equals the request
 * (the address: the signed-in account), and the canonical text rebuilt from them is exactly what was signed. Wallets
 * compose the text themselves, so this compares fields first, then the bytes. Null when accepted, else the plain
 * reason. The ed25519 signature check is the caller's.
 */
export function liveSignInOutputProblem(input: LiveSignInInput, address: string, signedMessage: Uint8Array): string | null {
  let text: string;
  try { text = new TextDecoder("utf-8", {fatal: true}).decode(signedMessage); } catch { return "Your wallet signed a sign-in message this site cannot read, so it was not accepted."; }
  const parsed = parseSignInMessage(text);
  if (!parsed) return "Your wallet signed something other than a sign-in message, so it was not accepted.";
  if (parsed.domain !== input.domain || parsed.uri !== input.uri) return "This sign-in is for another site, so it was not accepted.";
  if (parsed.address !== address) return "This sign-in names another wallet, so it was not accepted.";
  if (parsed.chainId !== input.chainId) return "This sign-in is not for Solana mainnet, so it was not accepted.";
  if (parsed.statement !== input.statement || parsed.version !== input.version || parsed.nonce !== input.nonce || parsed.issuedAt !== input.issuedAt ||
    parsed.expirationTime !== input.expirationTime || parsed.notBefore || parsed.requestId || parsed.resources) return "Your wallet changed the sign-in message, so it was not accepted.";
  if (text !== liveSignInText(input, address)) return "Your wallet changed the sign-in message, so it was not accepted.";
  return null;
}
