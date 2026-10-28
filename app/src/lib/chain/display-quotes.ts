// Browser-only, read-only quote inputs. Loaded lazily by quote-data.ts for mainnet and devnet launches so fees and
// launch reserves come from the configured cluster, with no fixed initial-reserve fallback.
import {
  PUMP_FEES_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  decodePumpGlobal,
  pumpFeeConfigPda,
  pumpGlobalPda,
} from "@mintdex/chain-sdk";
import {
  curveFeeMarketCap,
  decodeFeeConfig,
  feesForMarketCap,
  type CurveReserves,
  type FeeBps,
  type PoolReserves,
} from "@mintdex/chain-sdk/quote";

import { assertCluster, getAccounts, readCurveContext, readPoolContext } from "./trust";

export type QuoteVenue = "curve" | "pool" | "launch";
export type DisplayQuoteSource =
  | { venue: "curve" | "launch"; reserves: CurveReserves; fees: FeeBps; readAt: number }
  | { venue: "pool"; reserves: PoolReserves; fees: FeeBps; readAt: number };

function usableFees(fees: FeeBps | null | undefined): fees is FeeBps {
  if (!fees) return false;
  const parts = [fees.lpFeeBps, fees.protocolFeeBps, fees.creatorFeeBps];
  return parts.every((v) => v >= 0n) && parts.reduce((sum, v) => sum + v, 0n) < 10_000n;
}

/** No cached or development-network fallback: an unreadable schedule produces no numeric estimate. */
export async function readDisplayQuoteSource(
  venue: QuoteVenue,
  mint?: string,
): Promise<DisplayQuoteSource | null> {
  try {
    await assertCluster();
    if (venue === "launch") {
      const [global, fee] = await getAccounts([pumpGlobalPda(), pumpFeeConfigPda()]);
      if (!global || global.owner !== PUMP_PROGRAM_ID || !fee || fee.owner !== PUMP_FEES_PROGRAM_ID)
        return null;
      const g = decodePumpGlobal(global.data);
      const reserves: CurveReserves = {
        virtualSolReserves: g.initialVirtualSolReserves,
        virtualTokenReserves: g.initialVirtualTokenReserves,
        realSolReserves: 0n,
        realTokenReserves: g.initialRealTokenReserves,
        tokenTotalSupply: g.tokenTotalSupply,
        complete: false,
      };
      const fees = feesForMarketCap(decodeFeeConfig(fee.data), curveFeeMarketCap(reserves));
      if (!usableFees(fees)) return null;
      return { venue, reserves, fees, readAt: Date.now() };
    }
    if (!mint) return null;
    if (venue === "pool") {
      const context = await readPoolContext(mint);
      return context && usableFees(context.fees)
        ? { venue, reserves: context.reserves, fees: context.fees, readAt: Date.now() }
        : null;
    }
    const context = await readCurveContext(mint);
    return context && usableFees(context.fees)
      ? { venue, reserves: context.reserves, fees: context.fees, readAt: Date.now() }
      : null;
  } catch {
    return null;
  }
}
