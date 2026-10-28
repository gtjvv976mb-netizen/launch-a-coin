/**
 * Finished mainnet launches, as GET /api/live/launches returns them (launches.server.ts builds each row). Shared by
 * the server and the Home section, so this file holds no server code.
 */
export const LIVE_LAUNCHES_LIMIT = 12;

export type PublicLiveLaunch = {
  name: string;
  ticker: string;
  /** The coin's pump.fun mint: the only full address in a row (it is the coin's public id). */
  tokenMint: string;
  designKey: string;
  /** The reviewed design's name, or null for a key this build does not know. */
  designName: string | null;
  /** Same-origin paths under /api/live/assets/, or null when the stored receipt has none. */
  image: string | null;
  cardImage: string | null;
  /** The creator wallet shortened to "AbCd…WxYz". */
  creator: string | null;
  createdAt: number;
};

export const pumpFunCoinUrl = (mint: string) => `https://pump.fun/coin/${mint}`;
export const solscanTokenUrl = (mint: string) => `https://solscan.io/token/${mint}`;

export async function fetchLiveLaunches(): Promise<PublicLiveLaunch[]> {
  const res = await fetch("/api/live/launches", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Launch list ${res.status}`);
  const body = (await res.json()) as { launches?: PublicLiveLaunch[] };
  return Array.isArray(body.launches) ? body.launches : [];
}
