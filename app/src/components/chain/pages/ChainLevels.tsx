/**
 * Levels on chain (refs/chain/m3-contract.md §2.2 Levels): the selected design's unlock line as the card program
 * stores it. Devnet: a market cap in devnet SOL (ApiConfig.levelMinMcapLamports); the USD label stays once, under the
 * slider (MODE_COPY.usdNote). Mainnet: the SOL equivalent of the chain Config's USD threshold (ApiConfig.thresholdsUsd,
 * $15K to $1M) at the Config's current price; the USD figure itself is in the ladder and on the slider.
 *
 * Owner: app:pages. Display only; the thresholds the program enforces live in its Config.
 */
import { num, tierUsdOf } from "../../../lib/chain/adapt";
import { useChainConfig } from "../../../lib/chain/data";
import { FIXPACK_COPY } from "../../../lib/mintdex/copy";
import { sol, usdCompact } from "../../../lib/mintdex/format";
import { APP_CLUSTER, SOL_WORD } from "../../../lib/chain/env";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Devnet: "Unlocks at 4.24 devnet SOL of market cap." Mainnet: "Unlocks at about 98.3 SOL of market cap at today's
 * price." Then the short tier meaning (a design reflects market cap, not holders). The page header says the mark must
 * hold for about an hour, so this line does not repeat it. One slate line under the design.
 */
export function ChainLevelNote({ level, className = "" }: { level: number; className?: string }) {
  const cfg = useChainConfig();
  const lamports = cfg ? num(cfg.levelMinMcapLamports[level - 1]) : 0;
  const usd = tierUsdOf(cfg)[level - 1] ?? 0;
  return (
    <p className={cx("text-pretty text-[13px] leading-[1.45] text-slate", className)}>
      {level <= 1 ? (
        "Every card starts here at launch."
      ) : APP_CLUSTER === "mainnet" ? (
        lamports > 0 ? (
          <>
            Unlocks at about <span className="num text-ink">{sol(lamports, 1)}</span> SOL of market cap at today&apos;s price.
          </>
        ) : (
          <>
            Unlocks at <span className="num text-ink">{usdCompact(usd)}</span> market cap.
          </>
        )
      ) : lamports > 0 ? (
        <>
          Unlocks at <span className="num text-ink">{sol(lamports, 2)}</span> {SOL_WORD} of market cap.
        </>
      ) : (
        "Unlocks when the market cap holds above this mark on devnet."
      )}{" "}
      {FIXPACK_COPY.tierMeaningShort}
    </p>
  );
}
