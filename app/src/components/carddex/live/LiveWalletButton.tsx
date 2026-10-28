import { useState, type Ref } from "react";
import { Button } from "../../mintdex/ui";
import { WalletConnectDialog } from "../../mintdex/wallet-connect";
import { useLiveWallet } from "./wallet";

/** The mainnet wallet control: the button here, the connect and connected-state dialog in mintdex/wallet-connect.tsx. */
export function LiveWalletButton({ compact = false, quiet = false, buttonRef }: { compact?: boolean; quiet?: boolean; buttonRef?: Ref<HTMLButtonElement> }) {
  const wallet = useLiveWallet();
  const [open, setOpen] = useState(false);
  const address = wallet.address;
  const short = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;
  return <>
    <Button ref={buttonRef} variant={quiet ? "outline" : "primary"} size={compact ? "sm" : "md"} block={!compact} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={address ? `Mainnet wallet ${short}` : "Connect mainnet wallet"}>
      {address ? short : compact ? "Connect wallet" : "Connect mainnet wallet"}
    </Button>
    <WalletConnectDialog open={open} onOpenChange={setOpen} />
  </>;
}
