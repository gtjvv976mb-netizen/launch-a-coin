/**
 * The devnet identity surfaces (refs/chain/m3-contract.md §2.2): the wallet IS the player.
 *   - ChainRailWallet: the desktop rail's wallet card;
 *   - ChainHeaderAccount: the phone header's right side.
 * Before a wallet connects both show Connect (and the phone header the guide button), which is all the server HTML
 * and the main chunk carry. A wallet can only connect once the lazy Wallet Standard host has loaded, so the
 * connected card, its menu, the account sheet and the handle dialog live in WalletMenus.tsx, a lazy chunk the host
 * prefetches as it mounts (C10: main chunk budget). No handle login, no faucet, no test SOL (C9).
 *
 * Owner: app:wallet. AppShell renders these in place of the sim's wallet card and account sheet (`IS_SIM ? … : …`).
 */
import { lazy, Suspense } from "react";

import { CONNECT_COPY } from "../../lib/chain/connect-copy";
import { requestWallet } from "../../lib/chain/identity";
import { useWalletSnapshot } from "../../lib/chain/wallet";
import { MODE_COPY } from "../../lib/mintdex/copy";
import { useDevnetSite, useSessionUi } from "../mintdex/session";
import { Button } from "../mintdex/ui";

const loadMenus = () => import("./WalletMenus");
const RailConnected = lazy(() => loadMenus().then((m) => ({ default: m.RailConnected })));
const HeaderConnected = lazy(() => loadMenus().then((m) => ({ default: m.HeaderConnected })));

export function ChainRailWallet() {
  const w = useWalletSnapshot();
  // The devnet test site's banner already says devnet SOL has no real value: one notice per screen.
  const devnetSite = useDevnetSite();
  if (w.connected && w.address) {
    return (
      <Suspense fallback={<div aria-hidden className="h-[52px] rounded-pop bg-sheet shadow-raise" />}>
        <RailConnected />
      </Suspense>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        block
        data-testid="wallet-connect"
        pending={w.connecting}
        pendingLabel={CONNECT_COPY.connecting}
        onClick={() => requestWallet()}
      >
        {CONNECT_COPY.connect}
      </Button>
      {MODE_COPY.railStart && !devnetSite ? (
        <p className="text-[12px] leading-[1.3] text-slate">{MODE_COPY.railStart}</p>
      ) : null}
    </div>
  );
}

export function ChainHeaderAccount() {
  const w = useWalletSnapshot();
  const { openGuide } = useSessionUi();
  if (w.connected && w.address) {
    return (
      <Suspense fallback={<span aria-hidden className="block h-11 w-24" />}>
        <HeaderConnected />
      </Suspense>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={openGuide}
        aria-label="How MintDex works"
        className="grid h-11 w-11 place-items-center rounded-pill text-ink transition-colors duration-(--t-fast) ease-room hover:bg-track"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="none">
          <circle cx="10" cy="10" r="7.75" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M7.9 7.9a2.15 2.15 0 1 1 3.02 1.97c-.55.25-.92.72-.92 1.33v.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="10" cy="13.9" r="0.95" fill="currentColor" />
        </svg>
      </button>
      <Button
        size="sm"
        className="ml-1"
        data-testid="wallet-connect"
        pending={w.connecting}
        pendingLabel={CONNECT_COPY.connecting}
        onClick={() => requestWallet()}
      >
        <span className="max-[359px]:hidden">{CONNECT_COPY.connect}</span>
        <span className="hidden max-[359px]:inline">{CONNECT_COPY.connectShort}</span>
      </Button>
    </>
  );
}
