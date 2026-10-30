import { getCardDesign, isCardDesignKey } from "../designs";
import { all, one } from "../../mintdex/server/db.server";
import { LIVE_LAUNCHES_LIMIT, SOLANA_ADDRESS, type PublicLiveLaunch } from "./launches";

/**
 * The public list of finished mainnet launches: the only coins the site shows. Read-only and keyless: it reads the
 * launch receipts this Worker already stored, never the chain. Each row is rebuilt from named fields only, so no
 * raw payload, receipt, signature or full wallet ever leaves the server; the creator is a shortened address.
 */
export type LaunchRow = {
  token_mint: string;
  nft_mint?: string | null;
  creator_wallet: string;
  design_key: string;
  quote_key?: string | null;
  quote_mint?: string | null;
  payload_json: string;
  created_at: number;
};

const COLUMNS = "token_mint, nft_mint, creator_wallet, design_key, quote_key, quote_mint, payload_json, created_at";
/** Only this Worker's own content-addressed asset paths, served same-origin (never a stored absolute URL). */
const ASSET_PATH = /^\/api\/live\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/;

function assetPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const path = new URL(value, "https://placeholder.invalid").pathname;
    return ASSET_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

function shortAddress(wallet: string) {
  return SOLANA_ADDRESS.test(wallet) ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : null;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** One stored receipt as a public row, or null when it lacks a name, a ticker or a valid mint. */
export function publicLaunchFromRow(row: LaunchRow): PublicLiveLaunch | null {
  if (!SOLANA_ADDRESS.test(row.token_mint)) return null;
  let payload: {
    fields?: { name?: unknown; symbol?: unknown; description?: unknown; quoteAssetKey?: unknown; quoteMint?: unknown };
    assets?: { artwork?: { url?: unknown }; cardImage?: { url?: unknown } };
  };
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  const name = payload.fields?.name,
    ticker = payload.fields?.symbol;
  if (typeof name !== "string" || !name || typeof ticker !== "string" || !ticker) return null;
  return {
    name: name.slice(0, 32),
    ticker: ticker.slice(0, 13),
    lore: text(payload.fields?.description).slice(0, 280),
    tokenMint: row.token_mint,
    nftMint: row.nft_mint && SOLANA_ADDRESS.test(row.nft_mint) ? row.nft_mint : null,
    designKey: row.design_key,
    designName: isCardDesignKey(row.design_key) ? getCardDesign(row.design_key).name : null,
    quoteAssetKey: row.quote_key || text(payload.fields?.quoteAssetKey) || "sol",
    quoteMint: row.quote_mint || text(payload.fields?.quoteMint),
    image: assetPath(payload.assets?.artwork?.url),
    cardImage: assetPath(payload.assets?.cardImage?.url),
    creator: shortAddress(row.creator_wallet),
    createdAt: row.created_at,
  };
}

const rows = (list: LaunchRow[]) => list.map(publicLaunchFromRow).filter((x): x is PublicLiveLaunch => x !== null);

export async function listCompletedLaunches(limit = LIVE_LAUNCHES_LIMIT): Promise<PublicLiveLaunch[]> {
  return rows(
    await all<LaunchRow>(
      `SELECT ${COLUMNS} FROM live_launch_intents WHERE status = 'complete' ORDER BY created_at DESC LIMIT ?`,
      Math.min(Math.max(1, limit), LIVE_LAUNCHES_LIMIT),
    ),
  );
}

/** The finished launches one wallet created, newest first. */
export async function listCreatorLaunches(wallet: string): Promise<PublicLiveLaunch[]> {
  if (!SOLANA_ADDRESS.test(wallet)) return [];
  return rows(
    await all<LaunchRow>(
      `SELECT ${COLUMNS} FROM live_launch_intents WHERE status = 'complete' AND creator_wallet = ? ORDER BY created_at DESC LIMIT ?`,
      wallet,
      LIVE_LAUNCHES_LIMIT,
    ),
  );
}

/** One finished launch by its coin's mint, or null (any other address, or a launch that has not finished). */
export async function getCompletedLaunch(mint: string): Promise<PublicLiveLaunch | null> {
  if (!SOLANA_ADDRESS.test(mint)) return null;
  const row = await one<LaunchRow>(
    `SELECT ${COLUMNS} FROM live_launch_intents WHERE status = 'complete' AND token_mint = ? LIMIT 1`,
    mint,
  );
  return row ? publicLaunchFromRow(row) : null;
}

/**
 * GET /api/live/launches: every finished launch, or with ?creator=<wallet> the ones that wallet created. Cached by
 * browsers and the edge for 30 s (a creator's own list is never cached, so it shows a launch as soon as it lands);
 * a failed read is never cached.
 */
export async function serveLiveLaunches(request?: Request): Promise<Response> {
  const creator = request ? new URL(request.url).searchParams.get("creator") : null;
  if (creator !== null && !SOLANA_ADDRESS.test(creator)) {
    return Response.json({ error: "Not a Solana address." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const launches = creator ? await listCreatorLaunches(creator) : await listCompletedLaunches();
    return Response.json(
      { launches },
      { headers: { "Cache-Control": creator ? "private, no-store" : "public, max-age=30" } },
    );
  } catch (error) {
    console.error("Live launch list failed", error);
    return Response.json(
      { error: "The launch list could not be read." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
