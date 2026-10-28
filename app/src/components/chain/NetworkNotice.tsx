/**
 * "Switch your wallet to devnet" (refs/chain/m3-contract.md §2.2): shown wherever the connected account does not
 * list solana:devnet. MintDex refuses to sign for such an account (the wallet host throws WRONG_NETWORK), so this
 * says what is wrong and the one thing to do before anyone presses a button: a short bold line, then (not compact)
 * the how. Renders nothing while no wallet is connected, and nothing in the server HTML (the wallet snapshot is
 * EMPTY there).
 *
 * Owner: app:wallet.
 */
import { useChainConfig } from "../../lib/chain/data";
import { APP_CLUSTER } from "../../lib/chain/env";
import { useWalletSnapshot } from "../../lib/chain/wallet";
import { NETWORK_NOTICE_COPY } from "../../lib/mintdex/copy";

/**
 * compat §6.4: the server answers for another cluster than this build (ApiConfig.cluster, display data). Reading
 * works; every flow refuses with WRONG_NETWORK before it builds (flows.ts assertServerCluster).
 */
export function useWrongServer(): boolean {
  const cfg = useChainConfig();
  return !!cfg && typeof cfg.cluster === "string" && cfg.cluster !== APP_CLUSTER;
}

/** True while a wallet is connected on the wrong network. */
export function useWrongNetwork(): boolean {
  const w = useWalletSnapshot();
  return w.connected && !w.clusterOk;
}

export function NetworkNotice({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const wrong = useWrongNetwork();
  const wrongServer = useWrongServer();
  if (!wrong && !wrongServer) return null;
  // The server's network wins: switching the wallet would not help while the server is on another one.
  const title = wrongServer ? NETWORK_NOTICE_COPY.server : NETWORK_NOTICE_COPY.wallet;
  const how = wrongServer ? NETWORK_NOTICE_COPY.serverHow : NETWORK_NOTICE_COPY.walletHow;
  return (
    <div
      role="status"
      data-testid={wrongServer ? "server-network-notice" : "network-notice"}
      className={`rounded-row bg-down-soft px-3 py-2.5 text-down ${className}`}
    >
      <p className="text-[13px] font-semibold leading-[1.35]">{title}</p>
      {compact ? null : <p className="mt-1 text-[13px] leading-[1.45]">{how}</p>}
    </div>
  );
}
