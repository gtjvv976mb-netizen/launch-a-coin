/**
 * Finished mainnet launches, as GET /api/live/launches returns them (launches.server.ts builds each row). Shared by
 * the server and every page that lists coins (Home, Discover, search, the coin page, Portfolio), so this file holds
 * no server code. The site lists nothing else: these are the only coins it shows.
 */
import type { CardData } from "../../../components/mintdex/MintCard";
import { CREATION_MCAP_LABEL } from "../card-template";
import { getCardDesign } from "../designs";
import { getTradingPair } from "../pairs";

/**
 * The most launches one list answer carries, newest first: every page and the header search filter this one list in
 * the browser. Past this many launches, add cursor pages (created_at) to the API before raising it further.
 */
export const LIVE_LAUNCHES_LIMIT = 500;

/** A Solana address (a coin's mint or a wallet). */
export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type PublicLiveLaunch = {
  name: string;
  ticker: string;
  /** The coin's description, as its card and its public token metadata print it ("" for none). */
  lore: string;
  /** The coin's pump.fun mint: the coin's public id and the address its page is at. */
  tokenMint: string;
  /** The card NFT's mint, or null when the stored receipt has none. */
  nftMint: string | null;
  designKey: string;
  /** The reviewed design's name, or null for a key this build does not know. */
  designName: string | null;
  /**
   * The pinned version of the design's art this launch recorded (its card front/back sha256), when a later redesign
   * replaced it: the card renders that archived art (design-versions.ts). Null for the current art.
   */
  designVersion: string | null;
  /** The pair the coin trades against. */
  quoteAssetKey: string;
  quoteMint: string;
  /** Same-origin paths under /api/live/assets/, or null when the stored receipt has none. */
  image: string | null;
  cardImage: string | null;
  /** The creator wallet shortened to "AbCd…WxYz". */
  creator: string | null;
  createdAt: number;
};

export const pumpFunCoinUrl = (mint: string) => `https://pump.fun/coin/${mint}`;
export const solscanTokenUrl = (mint: string) => `https://solscan.io/token/${mint}`;

/** The card a finished launch minted, field for field as composition.server.ts printed it. */
export function launchCard(l: PublicLiveLaunch): CardData {
  return {
    name: l.name,
    ticker: l.ticker,
    lore: l.lore || undefined,
    image: l.image ?? "",
    cardTemplate: l.designKey,
    ...(l.designVersion ? { designVersion: l.designVersion } : {}),
    quoteAssetKey: l.quoteAssetKey,
    quoteMint: l.quoteMint,
    tradingPair: getTradingPair(l.ticker, l.quoteAssetKey),
    level: getCardDesign(l.designKey).materialLevel,
    mcapUsd: null,
    mcapLabel: CREATION_MCAP_LABEL,
    holders: 0,
    dexNo: 0,
    dexLabel: "1 / 1",
    ownerHandle: l.creator ?? undefined,
    mintAddress: l.tokenMint,
  };
}

/** A search over name, ticker ($ optional) and mint, as Discover and the header search read it. */
export function matchesLaunch(l: PublicLiveLaunch, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^\$/, "");
  if (!q) return true;
  return l.name.toLowerCase().includes(q) || l.ticker.toLowerCase().includes(q) || l.tokenMint.toLowerCase() === q;
}

async function readLaunches(query: string): Promise<PublicLiveLaunch[]> {
  const res = await fetch(`/api/live/launches${query}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Launch list ${res.status}`);
  const body = (await res.json()) as { launches?: PublicLiveLaunch[] };
  return Array.isArray(body.launches) ? body.launches : [];
}

/** Every finished launch, newest first (at most LIVE_LAUNCHES_LIMIT). */
export const fetchLiveLaunches = () => readLaunches("");

/** The finished launches one wallet created (Portfolio). */
export function fetchCreatorLaunches(wallet: string) {
  if (!SOLANA_ADDRESS.test(wallet)) return Promise.resolve([]);
  return readLaunches(`?creator=${encodeURIComponent(wallet)}`);
}

/** The query every coin list shares, so Home, Discover and the header search read one answer. */
export const liveLaunchesQuery = {
  queryKey: ["live-launches"] as const,
  queryFn: fetchLiveLaunches,
  staleTime: 30_000,
  refetchInterval: 60_000,
  retry: 1,
};
