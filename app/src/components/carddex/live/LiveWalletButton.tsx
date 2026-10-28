import { useState, type Ref } from "react";
import { Button, Modal } from "../../mintdex/ui";
import { connectLiveWallet, disconnectLiveWallet, useLiveWallet } from "./wallet";
import "../../../carddex-live.css";

export function LiveWalletButton({ compact = false, quiet = false, buttonRef }: { compact?: boolean; quiet?: boolean; buttonRef?: Ref<HTMLButtonElement> }) {
  const wallet = useLiveWallet();
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const address = wallet.address;
  const short = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;
  return <>
    <Button ref={buttonRef} variant={quiet ? "outline" : "primary"} size={compact ? "sm" : "md"} block={!compact} onClick={() => { setError(""); setOpen(true); }} aria-haspopup="dialog" aria-label={address ? `Mainnet wallet ${short}` : "Connect mainnet wallet"}>
      {address ? short : compact ? "Connect wallet" : "Connect mainnet wallet"}
    </Button>
    <Modal open={open} onOpenChange={setOpen} title={address ? "Your mainnet wallet" : "Connect a Solana wallet"} description="Connect the creator wallet. This does not authorize a payment or transaction.">
      <div className="cdx-live-wallet">
        <p>Solana mainnet. Connecting shares your public address. Each transaction still needs your review in the wallet.</p>
        {address ? <>
          <p className="cdx-live-address">{address}</p>
          <p>{wallet.name}{wallet.mainnet ? " · Mainnet supported" : " · Switch this account to mainnet"}</p>
          <Button variant="outline" block onClick={() => { void disconnectLiveWallet(); setOpen(false); }}>Disconnect wallet</Button>
        </> : !wallet.ready ? <p role="status">Finding wallets…</p> : wallet.wallets.length ? <ul aria-label="Available Solana wallets">
          {wallet.wallets.map(w => <li key={w.name}><Button variant="outline" block pending={wallet.connecting === w.name} pendingLabel={`Connecting ${w.name}…`} disabled={!!wallet.connecting} onClick={async () => {
            setError("");
            try { await connectLiveWallet(w.name); setOpen(false); }
            catch (e) { setError(e instanceof Error ? e.message : "Connection was canceled. Choose a wallet to try again."); }
          }}><img src={w.icon} alt="" width={24} height={24} />{w.name}</Button></li>)}
        </ul> : <p>No compatible wallet was detected. Open Launch a Card in your Solana wallet’s browser, or enable a Wallet Standard browser extension.</p>}
        {error ? <p role="alert" className="cdx-live-error">{error}</p> : null}
      </div>
    </Modal>
  </>;
}
