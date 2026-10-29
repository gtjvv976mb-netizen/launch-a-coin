import { getCardDesign, isCardDesignKey } from "../designs";
import { all } from "../../mintdex/server/db.server";
import { LIVE_LAUNCHES_LIMIT, type PublicLiveLaunch } from "./launches";

/**
 * The public list of finished mainnet launches (Home's "Launched on pump.fun"). Read-only and keyless: it reads the
 * launch receipts this Worker already stored, never the chain. Each row is rebuilt from named fields only, so no
 * raw payload, receipt, signature or full wallet ever leaves the server; the creator is a shortened address.
 */
export type LaunchRow = {
  token_mint: string;
  creator_wallet: string;
  design_key: string;
  payload_json: string;
  created_at: number;
};

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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
  return MINT.test(wallet) ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : null;
}

/** One stored receipt as a public row, or null when it lacks a name, a ticker or a valid mint. */
export function publicLaunchFromRow(row: LaunchRow): PublicLiveLaunch | null {
  if (!MINT.test(row.token_mint)) return null;
  let payload: {
    fields?: { name?: unknown; symbol?: unknown };
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
    tokenMint: row.token_mint,
    designKey: row.design_key,
    designName: isCardDesignKey(row.design_key) ? getCardDesign(row.design_key).name : null,
    image: assetPath(payload.assets?.artwork?.url),
    cardImage: assetPath(payload.assets?.cardImage?.url),
    creator: shortAddress(row.creator_wallet),
    createdAt: row.created_at,
  };
}

export async function listCompletedLaunches(
  limit = LIVE_LAUNCHES_LIMIT,
): Promise<PublicLiveLaunch[]> {
  const rows = await all<LaunchRow>(
    "SELECT token_mint, creator_wallet, design_key, payload_json, created_at FROM live_launch_intents WHERE status = 'complete' ORDER BY created_at DESC LIMIT ?",
    Math.min(Math.max(1, limit), LIVE_LAUNCHES_LIMIT),
  );
  return rows.map(publicLaunchFromRow).filter((x): x is PublicLiveLaunch => x !== null);
}

/** GET /api/live/launches: cached by browsers and the edge for 30 s; a failed read is never cached. */
export async function serveLiveLaunches(): Promise<Response> {
  try {
    const launches = await listCompletedLaunches();
    return Response.json({ launches }, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (error) {
    console.error("Live launch list failed", error);
    return Response.json(
      { error: "The launch list could not be read." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
