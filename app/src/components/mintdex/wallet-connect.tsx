/**
 * The mainnet wallet dialog (LiveWalletButton opens it; styles/screens/overlays.css .cdx-wallet-connect). One page
 * for a first-time creator:
 *
 *   signed out   what connecting does (the public address only: no transaction, no funds move), the wallets this
 *                browser has, each one press, then where to get one. While the registry loads: two skeleton rows.
 *   no wallet    the same line, then what to do: install Phantom, Solflare or Backpack from its own site and
 *                reload, or open this page in the wallet app's browser on a phone.
 *   connected    the wallet, its full address, whether the account is on mainnet, then [Disconnect] [Done].
 *
 * Errors stay on the page in one alert line that says what happened and what to try next. Connecting and
 * disconnecting go through carddex/live/wallet.ts; nothing here signs or sends anything.
 */
import { useId, useState } from "react";

import { connectLiveWallet, disconnectLiveWallet, useLiveWallet } from "../carddex/live/wallet";
import { Badge, Button, Icon, Modal } from "./ui";

/** Official download pages (the wallets' own sites). */
const GET_WALLETS = [
  { name: "Phantom", href: "https://phantom.com/download" },
  { name: "Solflare", href: "https://solflare.com/download" },
  { name: "Backpack", href: "https://backpack.app/downloads" },
] as const;

const WHAT_CONNECTING_DOES =
  "Connecting shares your public wallet address with Launch a Card. It sends no transaction and moves no funds. Each launch step opens in your wallet for your approval.";

/** A wallet's own message plus the next step, unless it already names one. */
function withNextStep(message: string) {
  const text = message.trim().replace(/\.?$/, ".");
  return /try again|reconnect|switch|install|open /i.test(text) ? text : `${text} Choose a wallet to try again.`;
}

export function WalletConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const wallet = useLiveWallet();
  const [error, setError] = useState("");
  const id = useId();
  const address = wallet.address;
  // Where to get a wallet: the ones this browser does not have yet.
  const getable = GET_WALLETS.filter((g) => !wallet.wallets.some((w) => w.name.toLowerCase().startsWith(g.name.toLowerCase())));
  const close = () => onOpenChange(false);
  const change = (o: boolean) => {
    if (o) setError("");
    onOpenChange(o);
  };

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={address ? "Your mainnet wallet" : "Connect a Solana wallet"}
      description="Connect the creator wallet. This does not authorize a payment or transaction."
    >
      <div className="cdx-wallet-connect">
        {address ? (
          <>
            <div className="cdx-wallet-connect__account">
              <div className="cdx-wallet-connect__who">
                <span className="cdx-wallet-connect__name">{wallet.name}</span>
                <Badge tone="neutral">Connected</Badge>
              </div>
              <p className="cdx-wallet-connect__address" aria-label={`Address ${address}`}>
                {address}
              </p>
            </div>
            {wallet.mainnet ? (
              <p className="cdx-wallet-connect__line">
                Solana mainnet. Your wallet asks you to approve each launch transaction.
              </p>
            ) : (
              <p className="cdx-wallet-connect__warn" role="status">
                <Icon name="warning" />
                <span>This account is not on Solana mainnet. Switch it to mainnet in your wallet, then reconnect.</span>
              </p>
            )}
            <div className="cdx-overlay-actions mdx-sheet-foot">
              <Button
                variant="outline"
                onClick={() => {
                  void disconnectLiveWallet();
                  close();
                }}
              >
                Disconnect
              </Button>
              <Button onClick={close}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <p className="cdx-wallet-connect__line">{WHAT_CONNECTING_DOES}</p>
            {!wallet.ready ? (
              <div className="cdx-wallet-connect__group" aria-busy="true">
                <p className="cdx-wallet-connect__label" role="status">
                  Looking for wallets in this browser…
                </p>
                <div className="cdx-wallet-connect__list" aria-hidden>
                  <span className="cdx-wallet-connect__skeleton" />
                  <span className="cdx-wallet-connect__skeleton" />
                </div>
              </div>
            ) : wallet.wallets.length ? (
              <div className="cdx-wallet-connect__group">
                <p className="cdx-wallet-connect__label" id={`${id}-installed`}>
                  Installed in this browser
                </p>
                <ul className="cdx-wallet-connect__list" aria-labelledby={`${id}-installed`}>
                  {wallet.wallets.map((w) => {
                    const busy = wallet.connecting === w.name;
                    return (
                      <li key={w.name}>
                        <button
                          type="button"
                          className="cdx-wallet-connect__row"
                          aria-disabled={!!wallet.connecting || undefined}
                          aria-busy={busy || undefined}
                          onClick={async () => {
                            if (wallet.connecting) return;
                            setError("");
                            try {
                              await connectLiveWallet(w.name);
                              close();
                            } catch (e) {
                              setError(
                                withNextStep(e instanceof Error && e.message ? e.message : "The connection was canceled."),
                              );
                            }
                          }}
                        >
                          <img src={w.icon} alt="" width={24} height={24} className="cdx-wallet-connect__icon" />
                          <span className="cdx-wallet-connect__row-name">{busy ? `Connecting ${w.name}…` : w.name}</span>
                          <Icon name="chevron-right" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="cdx-wallet-connect__group">
                <p className="cdx-wallet-connect__empty">No Solana wallet found in this browser.</p>
                <p className="cdx-wallet-connect__line">
                  Install one from its own site, then reload this page. On a phone, open Launch a Card in your wallet
                  app’s browser.
                </p>
              </div>
            )}
            {error ? (
              <p className="cdx-wallet-connect__error" role="alert">
                <Icon name="warning" />
                <span>{error}</span>
              </p>
            ) : null}
            {wallet.ready && getable.length ? (
              <div className="cdx-wallet-connect__group">
                <p className="cdx-wallet-connect__label" id={`${id}-get`}>
                  {wallet.wallets.length ? "Get another wallet" : "Get a wallet"}
                </p>
                <ul className="cdx-wallet-connect__get" aria-labelledby={`${id}-get`}>
                  {getable.map((g) => (
                    <li key={g.name}>
                      <a className="mdx-link mdx-hit" href={g.href} target="_blank" rel="noopener noreferrer">
                        {g.name}
                        <span className="sr-only"> (opens in a new tab)</span>
                        <Icon name="external" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
