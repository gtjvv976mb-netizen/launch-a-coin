// Sign-In With Solana message format for the mintdex-chain API (refs/chain/m3-contract.md §3.2).
// Pure and import free: the Worker rebuilds the message from the stored nonce and compares it byte for byte;
// the app shows and signs exactly the text POST /auth/nonce returned (wallet feature solana:signMessage).

/** The statement line every MintDex devnet sign-in carries. */
export const SIWS_STATEMENT =
  "Sign in to MintDex on Solana devnet. This request does not trigger a transaction or cost any fees.";
export const SIWS_VERSION = "1";
export const SIWS_CHAIN_ID = "devnet";
/** The cluster a sign-in is for: statement and chain id differ, so a devnet sign-in can never pass on mainnet (compat §6.2). */
export type SiwsCluster = "devnet" | "mainnet";
export const SIWS_STATEMENTS: Record<SiwsCluster, string> = {
  devnet: SIWS_STATEMENT,
  mainnet: "Sign in to MintDex on Solana mainnet. This request does not trigger a transaction or cost any fees.",
};
/** A nonce (and the message carrying it) is valid for 10 minutes and only once. */
export const SIWS_NONCE_TTL_SEC = 600;
/** A session token from /auth/verify lasts 12 hours. */
export const API_SESSION_TTL_SEC = 43_200;

export interface SiwsFields {
  /** The requesting site's host (with port in dev), e.g. "mintdex.fun" or "127.0.0.1:8787". */
  domain: string;
  /** The wallet address (base58). */
  address: string;
  /** The requesting site's origin, e.g. "https://mintdex.fun". */
  uri: string;
  /** 22 to 64 characters of [A-Za-z0-9]. */
  nonce: string;
  /** ISO 8601 UTC, e.g. "2026-10-04T08:00:00.000Z". */
  issuedAt: string;
  expirationTime: string;
}

const NONCE_RE = /^[A-Za-z0-9]{22,64}$/;
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DOMAIN_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/;
const URI_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** True when every field has the allowed shape (no newlines can sneak into the message). */
export function siwsFieldsValid(f: SiwsFields): boolean {
  return (
    DOMAIN_RE.test(f.domain) &&
    ADDRESS_RE.test(f.address) &&
    URI_RE.test(f.uri) &&
    NONCE_RE.test(f.nonce) &&
    ISO_RE.test(f.issuedAt) &&
    ISO_RE.test(f.expirationTime)
  );
}

/** The exact message text for `cluster` (default devnet). Throws on a malformed field. */
export function buildSiwsMessage(f: SiwsFields, cluster: SiwsCluster = "devnet"): string {
  if (!siwsFieldsValid(f)) throw new Error("invalid sign-in fields");
  const statement = SIWS_STATEMENTS[cluster];
  if (!statement) throw new Error("unknown sign-in cluster");
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    "",
    statement,
    "",
    `URI: ${f.uri}`,
    `Version: ${SIWS_VERSION}`,
    `Chain ID: ${cluster}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

/** Parses a message built by buildSiwsMessage for `cluster`; null for anything else (strict: it must rebuild identically). */
export function parseSiwsMessage(text: string, cluster: SiwsCluster = "devnet"): SiwsFields | null {
  const lines = text.split("\n");
  if (lines.length !== 11) return null;
  const head = /^(.+) wants you to sign in with your Solana account:$/.exec(lines[0]);
  const field = (i: number, label: string) => (lines[i].startsWith(`${label}: `) ? lines[i].slice(label.length + 2) : null);
  const f = {
    domain: head?.[1] ?? "",
    address: lines[1],
    uri: field(5, "URI") ?? "",
    nonce: field(8, "Nonce") ?? "",
    issuedAt: field(9, "Issued At") ?? "",
    expirationTime: field(10, "Expiration Time") ?? "",
  };
  if (!siwsFieldsValid(f)) return null;
  return buildSiwsMessage(f, cluster) === text ? f : null;
}
