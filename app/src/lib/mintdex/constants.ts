// Protocol constants shared by the client (quotes, previews) and the server
// (the source of truth). Amounts are integers: SOL in lamports (1e9), coin
// amounts in base units (1e6).

export const LAMPORTS = 1_000_000_000;
export const TOKEN_UNIT = 1_000_000;

/** Test-mode reference rate used to express market caps in USD. */
export const SOL_USD = 150;

// pump.fun bonding-curve parameters (test mode mirrors them exactly):
// 1B supply, 793.1M sold on the curve, virtual reserves 30 SOL / 1.073B tokens.
// When the curve's real tokens run out (~85 SOL raised) the coin graduates to
// PumpSwap; test mode keeps trading on the same constant-product reserves.
export const TOTAL_SUPPLY_TOKENS = 1_000_000_000;
export const CURVE_SUPPLY_TOKENS = 793_100_000;
export const VIRTUAL_SOL = 30 * LAMPORTS;
export const VIRTUAL_TOKENS = 1_073_000_000 * TOKEN_UNIT;
/** Virtual tokens left in the curve at graduation. */
export const CURVE_END_TOKENS = VIRTUAL_TOKENS - CURVE_SUPPLY_TOKENS * TOKEN_UNIT;

/** Every MintDex coin address ends with this suffix. */
export const MINT_SUFFIX = "mint";

export const TRADE_FEE_BPS = 100; // 1% per trade
export const OWNER_FEE_BPS = 0; // half the trade fee fills the card's fee vault: the holder's card fees
export const DEED_PROTOCOL_BPS = 0; // 2.5% on deed sales
export const CREATOR_ROYALTY_BPS = 0; // 5% resale royalty to the launcher on every card sale

export const LAUNCH_FEE = Math.round(0.02 * LAMPORTS);
export const START_BALANCE = 100 * LAMPORTS;
export const FAUCET_AMOUNT = 50 * LAMPORTS;
export const FAUCET_BELOW = 5 * LAMPORTS;
export const FAUCET_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const MIN_BID = Math.round(0.1 * LAMPORTS);

export const MAX_DEV_BUY = 20 * LAMPORTS;

export const HANDLE_RE = /^[a-z0-9_]{3,16}$/;

/**
 * Handles nobody can register (backlog P0-6): official and brand names, and the demo bots' handles (the list in
 * server/seed.server.ts NPCS; keep the two in step). Handles that start with "mintdex" or "official" are reserved
 * too, so no one can pose as the team.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "carddex",
  "mintdex",
  "mintdexdotfun",
  "admin",
  "administrator",
  "support",
  "help",
  "official",
  "team",
  "staff",
  "mod",
  "mods",
  "moderator",
  "system",
  "root",
  "bot",
  "pumpfun",
  "pump_fun",
  "pumpswap",
  "solana",
  "phantom",
  "helius",
  // Demo bots (test mode).
  "sol_degen",
  "jpeg_junkie",
  "deed_hunter",
  "rare_ape",
  "moon_banker",
  "bag_holder",
  "card_whale",
  "protoflip",
  "slime_collector",
  "gm_goblin",
  "holo_hunter",
  "foil_maxi",
  "mint_monk",
  "pack_ripper",
]);

/** True for a handle (already lowercased) that is reserved for the team, partners or the demo bots. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle) || /^(carddex|mintdex|official)/.test(handle);
}
export const TICKER_RE = /^[A-Z0-9]{2,8}$/;
