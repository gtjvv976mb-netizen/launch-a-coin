/**
 * The wallet picker (refs/chain/m3-contract.md §2.2): the registered Wallet Standard wallets as rows, a plain
 * empty state with links to the wallets' download pages, and on phones a way to open MintDex inside a wallet app's
 * browser as the dialog's main buttons (no Mobile Wallet Adapter: wallet-integration §1, option B). Rendered by
 * the lazy wallet host only, so it never runs on the server and never ships in the main chunk. Centered dialog on
 * desktop, bottom sheet on phones (Modal).
 *
 * Owner: app:wallet.
 */
import { useEffect, useState } from "react";

import { FAUCET_URL, WALLET_COPY, WALLET_DOWNLOADS } from "../../lib/chain/wallet-copy";
import type { WalletInfo } from "../../lib/chain/wallet";
import { isCoarsePointer, isPhoneNow } from "../mintdex/sheet";
import { Modal } from "../mintdex/ui";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Wallet app browsers MintDex can open in from a phone browser without an injected wallet. */
function deepLinks(): Array<{ label: string; href: string }> {
  if (typeof location === "undefined") return [];
  const url = encodeURIComponent(location.href);
  const ref = encodeURIComponent(location.origin);
  return [
    { label: WALLET_COPY.openInPhantom, href: `https://phantom.app/ul/browse/${url}?ref=${ref}` },
    { label: WALLET_COPY.openInSolflare, href: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}` },
  ];
}

export function WalletModal({
  open,
  onOpenChange,
  wallets,
  connecting,
  error,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  wallets: WalletInfo[];
  /** Name of the wallet being connected, if any. */
  connecting: string | null;
  error: string | null;
  onPick: (name: string) => void;
}) {
  // Phones without an injected wallet get deep links into the wallet apps (decided once the dialog opens).
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    // A coarse pointer, or a phone-width screen that takes touch (some phone browsers report a fine pointer).
    if (open) setTouch(isCoarsePointer() || (isPhoneNow() && navigator.maxTouchPoints > 0));
  }, [open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={WALLET_COPY.pickerTitle} width={420}>
      <p className="text-[15px] leading-[1.5] text-slate">{WALLET_COPY.pickerBody}</p>
      {wallets.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2" aria-label="Wallets">
          {wallets.map((w) => {
            const busy = connecting === w.name;
            return (
              <li key={w.name}>
                <button
                  type="button"
                  data-testid={`wallet-${w.name}`}
                  aria-busy={busy || undefined}
                  aria-disabled={connecting !== null || undefined}
                  onClick={() => {
                    if (connecting === null) onPick(w.name);
                  }}
                  className={cx(
                    "flex h-14 w-full items-center gap-3 rounded-pop bg-sheet px-3.5 text-left shadow-raise",
                    "transition-[box-shadow,translate] duration-(--t-base) ease-room hover:-translate-y-px hover:shadow-lift",
                    connecting !== null && !busy && "opacity-60",
                  )}
                >
                  {w.icon ? (
                    <img src={w.icon} alt="" width={28} height={28} className="h-7 w-7 flex-none rounded-[8px]" />
                  ) : (
                    <span aria-hidden className="h-7 w-7 flex-none rounded-[8px] bg-track" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-ink">{w.name}</span>
                  {busy ? <span className="text-[13px] text-slate">{WALLET_COPY.connecting}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : touch ? (
        // Phones: a phone browser has no wallet to inject, so the two buttons that work come first and full width.
        <div className="mt-4" data-testid="no-wallets">
          <p className="text-[15px] leading-[1.5] text-ink">{WALLET_COPY.pickerPhone}</p>
          <div className="mt-3 flex flex-col gap-2">
            {deepLinks().map((l) => (
              <a key={l.href} href={l.href} rel="noopener noreferrer" className="mdx-btn mdx-btn--primary mdx-btn--block">
                {l.label}
              </a>
            ))}
          </div>
        </div>
      ) : (
        // Desktop: where to get a wallet, each name a link to its official download page.
        <div className="mt-4 rounded-pop bg-sheet p-4 shadow-ring" data-testid="no-wallets">
          <p className="text-[15px] leading-[1.5] text-ink">{WALLET_COPY.pickerEmpty}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {WALLET_DOWNLOADS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mdx-btn mdx-btn--outline mdx-btn--sm"
              >
                {l.label}
              </a>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-[1.45] text-slate">{WALLET_COPY.pickerInstall}</p>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[1.45] text-down">
          {error}
        </p>
      ) : null}
      <p className="mt-4 border-t border-hairline pt-3 text-[13px] leading-[1.45] text-slate">
        {WALLET_COPY.valueNote}
        {FAUCET_URL ? (
          <>
            {" "}
            <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="mdx-link mdx-hit">
              {WALLET_COPY.getSol}
            </a>
          </>
        ) : null}
      </p>
    </Modal>
  );
}
