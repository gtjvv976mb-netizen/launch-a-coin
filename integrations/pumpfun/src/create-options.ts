/**
 * The coin's create-time options this site offers on pump.fun's create_v2 (owner request, 31 October 2026: "also add
 * other launch coin features of pump.fun such as all holders get the fees"). Dependency-free, so the browser and the
 * server share one rule, the way fee-share-rules.ts and wallet-guards.ts are shared.
 *
 * - holderReward: pump.fun holder rewards. The program ignores the creator argument and makes the coin's
 *   holderRewardsPda(mint) its creator for good, so every creator fee accrues there and pump.fun (Global
 *   holderRewardClaimAuthority) pays it out to eligible holders from time to time. The creator earns no creator fees,
 *   the coin can never return to a regular coin, and a creator fee split is impossible (pump-fees 6016).
 * - creatorFeeBps: a custom creator fee rate, stored only for pairs admitted through pump.fun's QuoteControl (on SOL and
 *   USDC pump.fun ignores it silently, so it is never offered there). 1 to Global.maxConfigurableCreatorFeeBps, fixed
 *   for the coin's life (only a pump.fun CTO changes it).
 *
 * Not offered: mayhem mode (refused on QuoteControl pairs, doubles supply) and cashback (deprecated, 6082). Their flag
 * bytes are always zero.
 *
 * An option that is not chosen is absent (never false or 0) wherever it is saved or hashed, so every launch saved
 * before these options existed keeps its request hash, payload and binding byte for byte.
 */
export type CreateOptions = { holderReward?: true; creatorFeeBps?: number };
/** What pump.fun's Global allows right now (read at prepare; the form reads the same through the server). */
export type CreateOptionsGlobal = { holderRewards: boolean; creatorFeeConfigurable: boolean; maxCreatorFeeBps: number };

/** The only catalog admission where pump.fun stores a custom creator fee rate. */
export const CREATOR_FEE_RATE_ADMISSION = "quoteControl";
/** The highest custom rate this site ever accepts, whatever Global says (pump.fun's own cap on 31 October 2026). */
export const CREATOR_FEE_RATE_CEILING_BPS = 300;

export const HOLDER_REWARDS_OFF = "pump.fun has holder rewards switched off right now, so this coin can't be launched with them. Choose \"Creator keeps fees\" to launch.";
export const HOLDER_REWARDS_NO_SPLIT = "A holder-rewards coin pays its creator fees to holders, so it can't also share them with wallets. Choose one.";
export const CREATOR_FEE_RATE_PAIR = "A custom creator fee rate is only stored for custom pairs. On SOL and USDC pump.fun always uses its standard rate.";
export const CREATOR_FEE_RATE_OFF = "pump.fun doesn't accept custom creator fee rates right now. Clear the rate to use pump.fun's standard one.";
export const createFeeRateRange = (max: number) => `Use a creator fee rate from 0.01% to ${(max / 100).toFixed(2)}%.`;

/** True for a pair whose coins can carry a custom creator fee rate (catalog admission "quoteControl"). */
export const creatorFeeRateEligible = (admission: string | null | undefined) => admission === CREATOR_FEE_RATE_ADMISSION;

/**
 * The options as saved and hashed: only chosen ones, in a fixed key order. `holderReward` must be true or absent (false
 * reads as absent); `creatorFeeBps` a whole number of basis points, 0 or absent meaning none. Throws on anything else.
 */
export function readCreateOptions(raw: { holderReward?: unknown; creatorFeeBps?: unknown } | null | undefined): CreateOptions {
  const holder = raw?.holderReward, bps = raw?.creatorFeeBps;
  if (holder !== undefined && holder !== null && typeof holder !== "boolean") throw new Error("Choose who receives the creator fees.");
  if (bps !== undefined && bps !== null && (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > 10_000)) throw new Error(createFeeRateRange(CREATOR_FEE_RATE_CEILING_BPS));
  return { ...(holder === true ? { holderReward: true as const } : {}), ...(typeof bps === "number" && bps > 0 ? { creatorFeeBps: bps } : {}) };
}

/**
 * Why these options can't be used for this pair (its catalog admission) and, when known, pump.fun's current Global;
 * null when they can. The server repeats it with the Global it reads at prepare.
 */
export function createOptionsProblem(options: CreateOptions, context: { admission: string; global?: CreateOptionsGlobal | null }): string | null {
  const global = context.global ?? null;
  if (options.holderReward && global && !global.holderRewards) return HOLDER_REWARDS_OFF;
  if (options.creatorFeeBps !== undefined) {
    if (!creatorFeeRateEligible(context.admission)) return CREATOR_FEE_RATE_PAIR;
    const max = Math.min(CREATOR_FEE_RATE_CEILING_BPS, global ? global.maxCreatorFeeBps : CREATOR_FEE_RATE_CEILING_BPS);
    if (global && (!global.creatorFeeConfigurable || global.maxCreatorFeeBps < 1)) return CREATOR_FEE_RATE_OFF;
    if (!Number.isInteger(options.creatorFeeBps) || options.creatorFeeBps < 1 || options.creatorFeeBps > max) return createFeeRateRange(max);
  }
  return null;
}

/**
 * The 11 bytes create_v2's data ends with for these options: is_mayhem_mode (always 0), is_cashback_enabled (always 0),
 * creator_fee_bps (u64 little-endian, 0 when unset) and is_holder_reward. Checked with pump-sdk 4.1.0's own builder.
 */
export function createV2FlagTail(options: CreateOptions): Uint8Array {
  const tail = new Uint8Array(11);
  let bps = options.creatorFeeBps ?? 0;
  for (let i = 2; i < 10; i++) { tail[i] = bps % 256; bps = Math.floor(bps / 256); }
  tail[10] = options.holderReward ? 1 : 0;
  return tail;
}

export const sameCreateOptions = (a: CreateOptions, b: CreateOptions) => !!a.holderReward === !!b.holderReward && (a.creatorFeeBps ?? 0) === (b.creatorFeeBps ?? 0);

/** A rate in basis points as a percent with two decimals ("1.25%"). */
export const formatFeeRate = (bps: number) => `${(bps / 100).toFixed(2)}%`;
