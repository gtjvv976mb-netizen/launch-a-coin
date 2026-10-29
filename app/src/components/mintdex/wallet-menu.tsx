/**
 * The signed-in wallet menu (the top bar's AccountControl), loaded on demand. The same rows, in the same order and
 * words, as the phone Menu sheet (chrome-05): the account first, then Portfolio and the faucet, and Start over last,
 * after a rule, in the negative colour. Help, Terms and Calm motion live in the desktop top bar and footer.
 */
import * as Popover from "@radix-ui/react-popover";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { sol } from "../../lib/mintdex/format";
import { MODE_COPY } from "../../lib/mintdex/copy";
import type { Me } from "../../lib/mintdex/types";
import { StartOverDialog, WalletButton, faucetLabelOf, useWalletActions } from "./AppShell";
import { Avatar, Num } from "./ui";

export default function WalletMenu({ me }: { me: NonNullable<Me> }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { faucet, leave, busy, leaving } = useWalletActions(() => setOpen(false));
  const faucetLabel = faucetLabelOf(me);
  const faucetOff = !me.canFaucet || busy;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <WalletButton ref={trigger} me={me} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          ref={panel}
          aria-label="Account"
          className="mdx-menu mdx-pop cdx-overlay-menu"
          // Radix skips links when it picks the first control; start on the first row (Portfolio) instead.
          onOpenAutoFocus={(e) => {
            const first = panel.current?.querySelector<HTMLElement>(".mdx-menu-item");
            if (!first) return;
            e.preventDefault();
            first.focus({ preventScroll: true });
          }}
        >
          <div className="cdx-overlay-menu__account">
            <Avatar handle={me.handle} size={32} />
            <div className="min-w-0">
              <p className="cdx-overlay-menu__handle">@{me.handle}</p>
              <p className="cdx-overlay-menu__balance">
                <Num size="md" watch={me.balance}>
                  {sol(me.balance, 2)}
                </Num>
                <span className="mdx-unit"> SOL</span>
              </p>
            </div>
            {MODE_COPY.walletNote ? <span className="cdx-overlay-menu__note">{MODE_COPY.walletNote}</span> : null}
          </div>
          <Link to="/portfolio" className="mdx-menu-item" onClick={() => setOpen(false)}>
            Portfolio
          </Link>
          <button
            type="button"
            className="mdx-menu-item"
            onClick={faucetOff ? undefined : faucet}
            aria-disabled={faucetOff || undefined}
          >
            {busy ? "Claiming..." : faucetLabel}
          </button>
          <hr className="cdx-overlay-menu__rule" />
          <button
            type="button"
            className="mdx-menu-item cdx-overlay-menu__danger"
            onClick={() => {
              setOpen(false);
              // The confirm hands focus back to the wallet pill, not to this row, which leaves with the menu.
              trigger.current?.focus({ preventScroll: true });
              setConfirm(true);
            }}
          >
            Start over
          </button>
        </Popover.Content>
      </Popover.Portal>
      <StartOverDialog
        handle={me.handle}
        open={confirm}
        onOpenChange={setConfirm}
        leaving={leaving}
        leave={leave}
      />
    </Popover.Root>
  );
}
