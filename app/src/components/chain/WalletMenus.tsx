/**
 * The connected wallet (lazy chunk; ConnectWallet.tsx shows it once a wallet is connected, and the wallet host
 * prefetches it as it mounts, so it is there by the time any wallet connects):
 *   - RailConnected: the desktop wallet card (wallet face, handle or short address, devnet SOL balance or the
 *     wrong-network flag) and its menu: Portfolio, copy address, Solana Explorer, handle, faucet link, switch
 *     wallet, disconnect;
 *   - HeaderConnected: the phone header's balance and wallet face, opening the account sheet with the same actions;
 *   - HandleDialog: the optional handle. Sign-In With Solana (the wallet signs a short text, no transaction, no
 *     fee), then POST /wallets/handle; the new handle shows everywhere at once.
 * The wrong-network notice heads both menus while the account is not on devnet. Account switches inside the wallet
 * follow at once (the host listens to standard:events).
 *
 * Owner: app:wallet.
 */
import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { setHandle } from "../../lib/chain/client";
import { explorerUrl } from "../../lib/chain/env";
import { setChainHandle, shortAddress, useChainMe } from "../../lib/chain/identity";
import { chainErrorText } from "../../lib/chain/tx-copy";
import { useWalletSnapshot, wallet, type WalletSnapshot } from "../../lib/chain/wallet";
import { FAUCET_URL, WALLET_COPY } from "../../lib/chain/wallet-copy";
import { HANDLE_RE, isReservedHandle } from "../../lib/mintdex/constants";
import { MODE_COPY } from "../../lib/mintdex/copy";
import { sol } from "../../lib/mintdex/format";
import type { Me } from "../../lib/mintdex/types";
import { useSessionUi } from "../mintdex/session";
import { isCoarsePointer, Sheet } from "../mintdex/sheet";
import { Avatar, Button, CalmSwitch, Field, Input, Modal, Num, useToast } from "../mintdex/ui";
import { NetworkNotice } from "./NetworkNotice";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** The handle when the wallet set one (never the short-address stand-in). */
function realHandle(me: Me): string | null {
  return me && me.handle && !me.handle.includes("...") ? me.handle : null;
}

/** "@handle", else the short address. */
function nameOf(w: WalletSnapshot, me: Me): string {
  const h = realHandle(me);
  return h ? `@${h}` : shortAddress(w.address ?? "");
}

/** The wallet's own icon (a data: URI from its registration), else a letter avatar. */
function WalletFace({ w, size }: { w: WalletSnapshot; size: number }) {
  if (w.walletIcon) {
    return (
      <img
        src={w.walletIcon}
        alt=""
        width={size}
        height={size}
        className="flex-none rounded-[10px] bg-sheet shadow-ring"
        style={{ width: size, height: size }}
      />
    );
  }
  return <Avatar handle={w.address ?? "?"} size={size} />;
}

/** Balance figure, the wrong-network flag, or a quiet placeholder while the first read runs. */
function BalanceLine({ w, me, size }: { w: WalletSnapshot; me: Me; size: "sm" | "md" | "lg" }) {
  if (!w.clusterOk) {
    return <span className="text-[13px] font-semibold leading-5 text-down">{WALLET_COPY.switchNetworkShort}</span>;
  }
  if (!me) return <span className="text-[13px] leading-5 text-slate">{WALLET_COPY.balanceLoading}</span>;
  return (
    <>
      <Num size={size} watch={me.balance} tick>
        {sol(me.balance, 2)}
      </Num>
      <span className={cx("font-medium text-slate", size === "lg" ? "text-[14px]" : "text-[13px]")}> SOL</span>
    </>
  );
}

/** Copy, switch and disconnect: shared by the rail menu and the phone sheet. */
function useWalletMenu(close: () => void) {
  const toast = useToast();
  const w = useWalletSnapshot();
  return {
    async copy() {
      close();
      if (!w.address) return;
      try {
        await navigator.clipboard.writeText(w.address);
        toast("ok", WALLET_COPY.addressCopied);
      } catch {
        toast("err", `${WALLET_COPY.copyFailed} ${w.address}`);
      }
    },
    switchWallet() {
      close();
      // After the menu or sheet has closed and handed focus back.
      setTimeout(() => wallet.openModal(), 260);
    },
    async disconnect() {
      close();
      await wallet.disconnect().catch(() => undefined);
      toast("ok", WALLET_COPY.disconnected);
    },
  };
}

// ---------------------------------------------------------------- desktop rail

export function RailConnected() {
  const w = useWalletSnapshot();
  const me = useChainMe();
  const [open, setOpen] = useState(false);
  const [handleOpen, setHandleOpen] = useState(false);
  const close = () => setOpen(false);
  const menu = useWalletMenu(close);
  if (!w.address) return null;
  const address = w.address;
  const label = nameOf(w, me);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="wallet-connected"
          data-address={address}
          aria-label={`${WALLET_COPY.accountTitle}: ${label}${w.clusterOk ? "" : `. ${WALLET_COPY.switchNetwork}`}`}
          className="flex h-[52px] items-center gap-3 rounded-pop bg-sheet px-3 text-left shadow-raise transition-[box-shadow,translate] duration-(--t-base) ease-room hover:-translate-y-px hover:shadow-lift data-[state=open]:shadow-lift"
        >
          <WalletFace w={w} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-[1.3] text-slate">{label}</span>
            <span className="block leading-[1.2]">
              <BalanceLine w={w} me={me} size="md" />
            </span>
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="mdx-menu mdx-pop z-50 flex w-[var(--radix-popover-trigger-width)] min-w-[232px] flex-col outline-none"
        >
          <NetworkNotice compact className="mb-1" />
          <p className="px-3 pb-1 pt-1.5 text-[12px] leading-4 text-slate">
            {w.walletName ?? "Wallet"}, {shortAddress(address)}
          </p>
          <Link to="/portfolio" className="mdx-menu-item" onClick={close}>
            {WALLET_COPY.openPortfolio}
          </Link>
          <button type="button" className="mdx-menu-item" onClick={() => void menu.copy()}>
            {WALLET_COPY.copyAddress}
          </button>
          <a
            href={explorerUrl("address", address)}
            target="_blank"
            rel="noopener noreferrer"
            className="mdx-menu-item"
            onClick={close}
          >
            {WALLET_COPY.viewExplorer}
          </a>
          {w.canSignMessage ? (
            <button
              type="button"
              className="mdx-menu-item"
              onClick={() => {
                close();
                setHandleOpen(true);
              }}
            >
              {realHandle(me) ? WALLET_COPY.editHandle : WALLET_COPY.setHandle}
            </button>
          ) : null}
          {FAUCET_URL ? (
            <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="mdx-menu-item" onClick={close}>
              {WALLET_COPY.getSol}
            </a>
          ) : null}
          <button type="button" className="mdx-menu-item" onClick={menu.switchWallet}>
            {WALLET_COPY.switchWallet}
          </button>
          <button
            type="button"
            className="mdx-menu-item text-slate"
            data-testid="wallet-disconnect"
            onClick={() => void menu.disconnect()}
          >
            {WALLET_COPY.disconnect}
          </button>
        </Popover.Content>
      </Popover.Portal>
      <HandleDialog open={handleOpen} onOpenChange={setHandleOpen} address={address} current={realHandle(me)} />
    </Popover.Root>
  );
}

// ---------------------------------------------------------------- phone header

export function HeaderConnected() {
  const w = useWalletSnapshot();
  const me = useChainMe();
  const [sheet, setSheet] = useState(false);
  if (!w.address) return null;
  const label = nameOf(w, me);
  const balance = me && w.clusterOk ? `, ${sol(me.balance, 2)} ${MODE_COPY.walletUnit}` : "";
  return (
    <>
      <button
        type="button"
        data-testid="wallet-connected"
        data-address={w.address}
        onClick={() => setSheet(true)}
        aria-haspopup="dialog"
        aria-label={`${WALLET_COPY.accountTitle}, ${label}${balance}${w.clusterOk ? "" : `. ${WALLET_COPY.switchNetwork}`}`}
        className="flex h-11 items-center gap-2 rounded-pill pl-2 pr-1 transition-colors duration-(--t-fast) ease-room hover:bg-track"
      >
        <span className="whitespace-nowrap">
          {w.clusterOk && me ? (
            <>
              <Num size="sm" watch={me.balance} tick className="text-[15px]!">
                {sol(me.balance, 2)}
              </Num>
              <span className="text-[13px] font-medium text-slate">&nbsp;SOL</span>
            </>
          ) : !w.clusterOk ? (
            <span className="text-[13px] font-semibold text-down">{WALLET_COPY.switchNetworkShort}</span>
          ) : null}
        </span>
        <span className="relative">
          <WalletFace w={w} size={30} />
          {!w.clusterOk ? (
            <span aria-hidden className="mdx-badge mdx-badge--dot -right-0.5 -top-0.5 shadow-[0_0_0_2px_var(--color-wall)]" />
          ) : null}
        </span>
      </button>
      <ChainAccountSheet open={sheet} onOpenChange={setSheet} />
    </>
  );
}

// ---------------------------------------------------------------- phone account sheet

/** Open the next sheet or dialog once the closing sheet has slid away and handed focus back. */
function afterSheet(fn: () => void) {
  setTimeout(fn, 260);
}

function ChainAccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const w = useWalletSnapshot();
  const me = useChainMe();
  const { openGuide } = useSessionUi();
  const [handleOpen, setHandleOpen] = useState(false);
  const close = () => onOpenChange(false);
  const menu = useWalletMenu(close);
  if (!w.address) return null;
  const address = w.address;
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={WALLET_COPY.accountTitle}>
        <div className="flex items-center gap-3 rounded-pop bg-sheet p-3 shadow-raise">
          <WalletFace w={w} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[14px] leading-[1.3] text-slate">{nameOf(w, me)}</p>
            <p className="leading-[1.2]">
              <BalanceLine w={w} me={me} size="lg" />
            </p>
          </div>
          <span className="ml-auto self-start whitespace-nowrap text-[12px] leading-[1.3] text-slate">
            {WALLET_COPY.solNote}
          </span>
        </div>
        <NetworkNotice className="mt-3" />
        <nav aria-label="Account" className="-mx-3 mt-3 flex flex-col">
          <Link to="/portfolio" className="mdx-menu-item text-[15px]" onClick={close}>
            Portfolio
          </Link>
          <button type="button" className="mdx-menu-item text-[15px]" onClick={() => void menu.copy()}>
            {WALLET_COPY.copyAddress}
          </button>
          <a
            href={explorerUrl("address", address)}
            target="_blank"
            rel="noopener noreferrer"
            className="mdx-menu-item text-[15px]"
            onClick={close}
          >
            {WALLET_COPY.viewExplorer}
          </a>
          {w.canSignMessage ? (
            <button
              type="button"
              className="mdx-menu-item text-[15px]"
              onClick={() => {
                close();
                afterSheet(() => setHandleOpen(true));
              }}
            >
              {realHandle(me) ? WALLET_COPY.editHandle : WALLET_COPY.setHandle}
            </button>
          ) : null}
          {FAUCET_URL ? (
            <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="mdx-menu-item text-[15px]" onClick={close}>
              {WALLET_COPY.getSol}
            </a>
          ) : null}
          <button
            type="button"
            className="mdx-menu-item text-[15px]"
            onClick={() => {
              close();
              afterSheet(openGuide);
            }}
          >
            How MintDex works
          </button>
          <Link to="/legal" className="mdx-menu-item text-[15px]" onClick={close}>
            Terms, privacy and risks
          </Link>
          <button type="button" className="mdx-menu-item text-[15px]" onClick={menu.switchWallet}>
            {WALLET_COPY.switchWallet}
          </button>
          <button
            type="button"
            className="mdx-menu-item text-[15px] text-slate"
            data-testid="wallet-disconnect"
            onClick={() => void menu.disconnect()}
          >
            {WALLET_COPY.disconnect}
          </button>
        </nav>
        <CalmSwitch size="md" className="mt-2 border-t border-rule pt-3" />
      </Sheet>
      <HandleDialog open={handleOpen} onOpenChange={setHandleOpen} address={address} current={realHandle(me)} />
    </>
  );
}

// ---------------------------------------------------------------- the optional handle (SIWS)

function HandleDialog({
  open,
  onOpenChange,
  address,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  address: string;
  current: string | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const w = useWalletSnapshot();
  const [handle, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Touch screens: no autofocus, so the keyboard does not rise while the sheet slides in.
  const [autoFocus] = useState(() => !isCoarsePointer());

  useEffect(() => {
    if (open) {
      setValue(current ?? "");
      setError(null);
    }
  }, [open, current]);

  const clean = handle.trim().toLowerCase();
  const valid = HANDLE_RE.test(clean);
  const why = clean ? WALLET_COPY.handleInvalid : WALLET_COPY.handleEmpty;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!valid) return setError(why);
    if (isReservedHandle(clean)) return setError(WALLET_COPY.handleReserved);
    if (!w.canSignMessage) return setError(WALLET_COPY.handleNoSign);
    setBusy(true);
    setError(null);
    try {
      const r = await setHandle(clean);
      if (r.address === address) setChainHandle(qc, address, r.handle);
      onOpenChange(false);
      toast("ok", WALLET_COPY.handleSaved(r.handle));
    } catch (err) {
      setError(chainErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={WALLET_COPY.handleTitle}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <p className="text-[15px] leading-[1.5] text-slate">{WALLET_COPY.handleBody}</p>
        <Field label="Handle" htmlFor="chain-handle" help={WALLET_COPY.handleHelp} error={error ?? undefined}>
          <Input
            id="chain-handle"
            prefix="@"
            autoFocus={autoFocus}
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            maxLength={16}
            onChange={(e) => {
              setValue(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase());
              if (error) setError(null);
            }}
            placeholder="your_handle"
            aria-invalid={!!error}
            aria-describedby="chain-handle-help"
          />
        </Field>
        <div className="mdx-sheet-foot">
          <Button
            type="submit"
            block
            disabled={!valid}
            onBlocked={() => setError(why)}
            pending={busy}
            pendingLabel={WALLET_COPY.handleSaving}
          >
            {WALLET_COPY.handleSave}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
