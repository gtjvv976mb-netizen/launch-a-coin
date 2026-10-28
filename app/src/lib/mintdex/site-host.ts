// Which public site a request is for (launch-plan §1.1, §1.4, §6 APP). The devnet build (Higgsfield website 35c4, branch
// main) serves mintdex.fun until the cutover and carddex.invalid from Phase B on (through the mintdex-devnet-site
// proxy, which sets X-Forwarded-Host). On carddex.invalid it is the devnet test site: robots noindex and a one-line
// note. After the cutover MAIN flips MAINNET_SITE_LIVE and redeploys main to 35c4: the devnet build is then the test
// site wherever it is served (carddex.invalid, mintdex.higgsfield.app), its canonical and share links move to
// carddex.invalid, and the note points at mintdex.fun.
//
// The mainnet and sim builds never read a request header here (IS_DEVNET is a literal, so this code is dropped).
// Owner: app.

import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { IS_DEVNET } from "./mode";

/**
 * False until mintdex.fun serves the mainnet site (launch-plan Phase E). MAIN sets it to true in a commit on main right
 * after the cutover and redeploys website 35c4 (off the critical path): the devnet site then says "MintDex runs on
 * Solana mainnet at mintdex.fun.", which would not be true before.
 */
export const MAINNET_SITE_LIVE = false;

export const MAIN_SITE_ORIGIN = "https://launchacard.fun";
export const DEVNET_SITE_HOST = "carddex.invalid";
export const DEVNET_SITE_ORIGIN = `https://${DEVNET_SITE_HOST}`;

/** The public host of this request: X-Forwarded-Host from the proxy, else Host; location.host in the browser. */
const requestHost = createIsomorphicFn()
  .server((): string => {
    try {
      return (getRequestHeader("x-forwarded-host") ?? getRequestHeader("host") ?? "").split(",")[0].trim().toLowerCase();
    } catch {
      return "";
    }
  })
  .client((): string => window.location.host.toLowerCase());

/** True when `host` is the devnet site's host. */
export function isDevnetSiteHost(host: string | null | undefined): boolean {
  return (host ?? "").toLowerCase() === DEVNET_SITE_HOST;
}

/**
 * True when this page is the devnet test site: a devnet build on carddex.invalid, or any devnet build once
 * MAINNET_SITE_LIVE is set. Always false in the mainnet and sim builds. The root loader calls it once per request
 * (the result travels with the dehydrated loader data, so the hydrating client agrees with the server).
 */
export function isDevnetTestSite(): boolean {
  if (!IS_DEVNET) return false;
  if (MAINNET_SITE_LIVE) return true;
  return isDevnetSiteHost(requestHost());
}

/** The one-line note on the devnet test site (no em dashes). */
export const DEVNET_SITE_NOTE = MAINNET_SITE_LIVE
  ? { lead: "This is the devnet test site. MintDex runs on Solana mainnet at", link: "mintdex.fun", href: MAIN_SITE_ORIGIN }
  : { lead: "Test tokens have no monetary value.", link: "", href: "" };
