/** A user's own "no" in the wallet: never followed by another prompt. Wallets report it as 4001 or in words. */
export function walletRejected(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return code === 4001 || typeof message === "string" && /reject|denied|declin|cancel|closed|dismiss/i.test(message);
}
/** The wallet signed in with another account than the connected creator: refused, with no fallback prompt. */
export class SignInOtherAccount extends Error {
  constructor() { super("Your wallet signed in with another account. Reconnect the creator wallet to continue."); this.name = "SignInOtherAccount"; }
}
/** Phantom answers a sign-in that names another host than the page's with -32000 and shows no prompt (www, workers.dev). */
export class SignInWrongSite extends Error {
  constructor(host: string) { super(`Open ${host} to sign in. Your wallet checks that a sign-in names the site you are on.`); this.name = "SignInWrongSite"; }
}
