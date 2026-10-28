import { CHAIN_API_ORIGIN, DEV_CONNECT_SRC, PUBLIC_RPC_URL } from './chain/env';
import { IS_CHAIN } from './mintdex/mode';

/**
 * Security headers applied to every Worker response. Import in app/src/server.ts
 * and wrap the final response: `return applySecurityHeaders(response, new URL(request.url))`.
 */
// Local devnet builds only (refs/chain/m3-contract.md §1.2): the chain API on http://127.0.0.1:8788 is not covered by
// `https:`, for API calls (connect-src) nor for the art it serves under /img/ (img-src, media-src). Empty in every
// production and sim build, so the header there is byte-for-byte unchanged.
const EXTRA_DEV_SRC = DEV_CONNECT_SRC.length ? ` ${DEV_CONNECT_SRC.join(' ')}` : '';

/**
 * connect-src. Sim builds (today's live site) keep `'self' https:` byte for byte. Devnet builds talk to exactly three
 * places (refs/chain/devnet-plan.md M3 3.2, R21 mitigation 5): this origin, the chain API origin and the public devnet
 * RPC (https, plus its wss twin for a future subscription), and the Cloudflare Web Analytics beacon endpoint. Naming
 * them stops any script that runs in the page (an injected inline script, a compromised beacon) from sending the
 * sign-in token or wallet data to a host of its choosing.
 */
function devnetConnectSrc(): string {
  const origins = new Set<string>(["'self'", CHAIN_API_ORIGIN]);
  try {
    const rpc = new URL(PUBLIC_RPC_URL);
    origins.add(rpc.origin);
    if (rpc.protocol === 'https:') origins.add(`wss://${rpc.host}`);
  } catch {
    /* PUBLIC_RPC_URL is validated in env.ts; nothing to add */
  }
  origins.add('https://cloudflareinsights.com');
  for (const o of DEV_CONNECT_SRC) origins.add(o);
  return [...origins].join(' ');
}
const CONNECT_SRC = IS_CHAIN ? devnetConnectSrc() : `'self' https:${EXTRA_DEV_SRC}`;

// These production hosts are served directly by the owner's Cloudflare Workers. They do not receive the
// historical Higgsfield platform framing policy. Keep that platform's cross-origin design preview intact on its
// own hosts, while disallowing foreign frames around the public MintDex site and its direct Worker origins.
const OWNED_SITE_HOSTS = new Set([
  'mintdex.fun',
  'www.mintdex.fun',
  'devnet.mintdex.fun',
  'mintdex-site.gtjvv976mb.workers.dev',
  'mintdex-site-mainnet.gtjvv976mb.workers.dev',
]);

export function applySecurityHeaders(response: Response, requestUrl?: URL): Response {
  const headers = new Headers(response.headers);
  const ownedSite = requestUrl != null && OWNED_SITE_HOSTS.has(requestUrl.hostname);
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
      // Cloudflare Web Analytics beacon, injected at the edge for mintdex.fun.
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; " +
      `img-src 'self' data: blob: https:${EXTRA_DEV_SRC}; media-src 'self' https:${EXTRA_DEV_SRC}; ` +
      `connect-src ${CONNECT_SRC}; ` +
      "base-uri 'self'; form-action 'self'" + (ownedSite ? "; frame-ancestors 'self'" : ''),
  );
  if (ownedSite) headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-XSS-Protection', '0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
