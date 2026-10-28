/** The signed-in rail wallet menu (AppShell's WalletBlock): Portfolio, the faucet, Start over. Loaded on demand. */
import * as Popover from "@radix-ui/react-popover";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Me } from "../../lib/mintdex/types";
import { StartOverDialog, WalletButton, faucetLabelOf, useWalletActions } from "./AppShell";

export default function WalletMenu({ me }: { me: NonNullable<Me> }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { faucet, leave, busy, leaving } = useWalletActions(() => setOpen(false));
  const faucetLabel = faucetLabelOf(me);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <WalletButton me={me} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="mdx-menu mdx-pop z-50 flex w-[var(--radix-popover-trigger-width)] min-w-[200px] flex-col outline-none"
        >
          <Link to="/portfolio" className="mdx-menu-item" onClick={() => setOpen(false)}>
            Open portfolio
          </Link>
          <button
            type="button"
            className="mdx-menu-item"
            onClick={faucet}
            disabled={!me.canFaucet || busy}
          >
            {busy ? "Claiming..." : faucetLabel}
          </button>
          <button
            type="button"
            className="mdx-menu-item"
            onClick={() => {
              setOpen(false);
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
