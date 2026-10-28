/**
 * Honesty and sharing pieces (backlog P0-5, P0-6, P0-7, P1-12), on the Holo Soft primitives in ./ui.
 *
 *   ModeBadge      The "Test mode" pill beside the wordmark (rail lockup and MobileHeader). Opens a small popover
 *                  (a bottom sheet on phones): what is simulated, the USD rate, and links to a devnet faucet (the
 *                  guide in test mode) and to Terms and risks. Renders nothing when the mode has no badge (mainnet).
 *   BotTag         The small "bot" chip after a demo bot's handle.
 *   ConfirmDialog  open (req), onOpenChange (req), title (req), children (req), confirmLabel (req), cancelLabel,
 *                  pending, pendingLabel, onConfirm (req). A Modal with a secondary cancel and a primary confirm.
 *                  Used by Start over now; the devnet Disconnect and pre-sign reviews reuse it.
 *   ShareButton    title (req), text (req), path (req), address, label, className. A round icon button: the
 *                  native share sheet on touch devices, else a popover with Copy link and Post on X (and Copy
 *                  mint address once MODE is not sim). Share text never carries a simulated $ figure.
 *   LaunchedDialog coin, open (req), onOpenChange (req). "Your card is live": the new card, Post on X, Copy link.
 *
 * Every visible word comes from lib/mintdex/copy.ts (MODE_COPY, WORDS) so flipping MODE changes the claims.
 */
import * as Popover from "@radix-ui/react-popover";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { copyKey, copyText } from "../../lib/mintdex/clipboard";
import {
  DEVNET_FAUCETS,
  FLOW,
  HOME_COPY,
  IS_SIM,
  MODE_COPY,
  WORDS,
  shareCoinText,
} from "../../lib/mintdex/copy";
import { dexNo } from "../../lib/mintdex/format";
import { absoluteUrl, canonicalCoinPath } from "../../lib/mintdex/seo";
import type { CoinDetail } from "../../lib/mintdex/types";
import { MintCard } from "./MintCard";
import { useSessionUi } from "./session";
import { Button, Modal, Pocket, menuCollisionPadding, useToast } from "./ui";
import { Sheet, isPhoneNow } from "./sheet";
import { ViewportPages } from "../carddex/live/ViewportPages";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- mode badge

/** The devnet badge's faucet link (devnet build only: DEVNET_FAUCETS is empty in sim and mainnet builds). */
const FAUCET = HOME_COPY.getDevnetSol ? DEVNET_FAUCETS[0] : undefined;

/**
 * The visible test-mode signal (P0-5). A 22px sheet pill with a hairline ring, inline beside the wordmark, so
 * it adds no rail row. On phones the hit area grows to 44px without moving the pill.
 */
export function ModeBadge({ className = "" }: { className?: string }) {
  const { openGuide } = useSessionUi();
  const [open, setOpen] = useState(false);
  // Phones read the same words in a bottom sheet (P1-1); the trigger and its markup stay the same.
  const [sheet, setSheet] = useState(false);
  if (!MODE_COPY.badge) return null;
  const body = (close: () => void, fromSheet = false) => (
    <>
      <p className="text-[13px] leading-[1.45] text-slate max-lg:text-[15px] max-lg:leading-[1.5]">
        {MODE_COPY.explainer}
      </p>
      {MODE_COPY.usdNote ? (
        <p className="mt-2 text-[13px] leading-[1.45] text-slate max-lg:text-[15px] max-lg:leading-[1.5]">
          {MODE_COPY.usdNote}.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] leading-5 max-lg:mt-4 max-lg:text-[15px]">
        {/* Devnet: where the free SOL comes from (the guide has its own links in the rail and header). */}
        {FAUCET ? (
          <a href={FAUCET.href} target="_blank" rel="noopener noreferrer" className="mdx-link mdx-hit" onClick={close}>
            {HOME_COPY.getDevnetSol}
          </a>
        ) : (
          <button
            type="button"
            className="mdx-link mdx-hit"
            onClick={() => {
              close();
              // From the sheet, the guide rises once this one has slid away and handed focus back.
              if (fromSheet) setTimeout(openGuide, 260);
              else openGuide();
            }}
          >
            How Launch a Card works
          </button>
        )}
        <Link to="/legal" search={{ tab: "risks" }} className="mdx-link mdx-hit" onClick={close}>
          Terms and risks
        </Link>
      </div>
    </>
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${MODE_COPY.badge}: what this means`}
          onClick={(e) => {
            if (!isPhoneNow()) return;
            // preventDefault stops Radix opening the popover; the sheet opens instead.
            e.preventDefault();
            setSheet(true);
          }}
          className={cx(
            "relative inline-flex h-[22px] flex-none items-center rounded-pill bg-sheet px-[7px] text-[11.5px] font-semibold leading-none text-ink",
            "shadow-[0_0_0_1px_rgb(29_27_24/0.16)] transition-[background-color,box-shadow] duration-(--t-fast) ease-room",
            "hover:shadow-[0_0_0_1px_rgb(29_27_24/0.32)] data-[state=open]:shadow-[0_0_0_1px_rgb(29_27_24/0.32)]",
            "max-lg:before:absolute max-lg:before:inset-x-[-4px] max-lg:before:inset-y-[-11px] max-lg:before:content-['']",
            className,
          )}
        >
          {MODE_COPY.badge}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={menuCollisionPadding()}
          className="mdx-menu mdx-pop z-50 w-[min(300px,calc(100vw_-_24px))] p-4 outline-none"
        >
          <p className="mb-1 text-[14px] font-semibold leading-[1.3] text-ink">{MODE_COPY.badge}</p>
          {body(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
      <Sheet open={sheet} onOpenChange={setSheet} title={MODE_COPY.badge}>
        {body(() => setSheet(false), true)}
      </Sheet>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------- bot tag

/** "bot" after a demo bot's handle (P0-6). Neutral chip, slate on track (5.5:1 on canvas, 6.6:1 on panel). */
export function BotTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] flex-none items-center rounded-pill bg-track px-1.5 align-[1px] text-[11px] font-semibold leading-none text-slate",
        className,
      )}
    >
      bot
    </span>
  );
}

// ---------------------------------------------------------------- confirm dialog

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  pending = false,
  pendingLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="cdx-confirm-copy text-pretty text-[15px] leading-[1.5] text-slate">{children}</div>
      <div className="cdx-confirm-actions mdx-sheet-foot flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </Button>
        <Button pending={pending} pendingLabel={pendingLabel} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- sharing

/** X's post composer, prefilled with the selected card link. Opens in a new tab; nothing is posted until the viewer posts it. */
function xIntent(text: string, url: string) {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/** Touch devices with a native share sheet (phones, tablets). Desktop browsers get the popover. */
function canNativeShare() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

function ShareGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 10V2.5M5 5.25 8 2.25l3 3M4.5 7.5H4a1.5 1.5 0 0 0-1.5 1.5v3.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V9A1.5 1.5 0 0 0 12 7.5h-.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Copy link with the P1-26 fallback; returns true when the link reached the clipboard. */
function useCopyLink() {
  const toast = useToast();
  return async (url: string, what = "Link") => {
    const r = await copyText(url);
    if (r === "copied") toast("ok", `${what} copied.`);
    else toast("err", `Copy is blocked here. Select the link and press ${copyKey()}+C.`);
    return r === "copied";
  };
}

export function ShareButton({
  title,
  text,
  path,
  address,
  label = "Share",
  className = "",
}: {
  title: string;
  text: string;
  path: string;
  address?: string | null;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const copyLink = useCopyLink();
  const url = absoluteUrl(path);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setManual(false);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(e) => {
            if (!canNativeShare()) return;
            // The phone's own share sheet instead of the popover (preventDefault stops Radix opening it).
            e.preventDefault();
            navigator.share({ title, text, url }).catch(() => {});
          }}
          className={cx(
            "relative grid h-7 w-7 flex-none place-items-center rounded-pill text-ink transition-colors duration-(--t-fast) ease-room hover:bg-track data-[state=open]:bg-track",
            "max-lg:before:absolute max-lg:before:-inset-2 max-lg:before:content-['']",
            className,
          )}
        >
          <ShareGlyph />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={menuCollisionPadding()}
          className="mdx-menu mdx-pop z-50 flex w-[220px] flex-col outline-none"
        >
          {manual ? (
            <input
              readOnly
              autoFocus
              value={url}
              aria-label="Link to this page"
              onFocus={(e) => e.currentTarget.select()}
              className="mdx-input h-9 px-2.5 text-[13px]"
            />
          ) : (
            <button
              type="button"
              className="mdx-menu-item"
              onClick={async () => {
                if (await copyLink(url)) setOpen(false);
                else setManual(true);
              }}
            >
              Copy link
            </button>
          )}
          <a
            className="mdx-menu-item"
            href={xIntent(text, url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            Post on X
          </a>
          {!IS_SIM && address ? (
            <button
              type="button"
              className="mdx-menu-item"
              onClick={async () => {
                if (await copyLink(address, "Mint address")) setOpen(false);
              }}
            >
              {MODE_COPY.copyAddress}
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Share props for a coin page: canonical path, a title and text with no $ figure (decision C5). */
export function coinShare(coin: { id: string; name: string; ticker: string; mintAddress?: string | null }) {
  return {
    title: `${coin.name} ($${coin.ticker}) on Launch a Card`,
    text: shareCoinText(coin),
    path: canonicalCoinPath(coin),
    address: coin.mintAddress ?? null,
  };
}

// ---------------------------------------------------------------- launch moment

/**
 * After a launch (P1-12 step 5): the new card in its tray, one line, then Post on X and Copy link. Opened by
 * the coin page when it arrives with ?minted=1.
 */
export function LaunchedDialog({
  coin,
  open,
  onOpenChange,
}: {
  coin: CoinDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const copyLink = useCopyLink();
  const share = coinShare(coin);
  const url = absoluteUrl(share.path);
  // The celebration (hype arcade): once the reveal lands, the big neon burst and confetti from the new card.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (!cardRef.current) return;
      void import("./arcade").then((m) => m.launchBurst(m.centerOf(cardRef.current)));
    }, 1500);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={IS_SIM ? "Your demo card is ready" : "Your card is ready"}>
      <div className="cdx-launched-deck cdx-overlay-deck"><ViewportPages label="Your new card pages" pages={[
      <div key="card" className="cdx-launched-art">
        <div ref={cardRef} className="cdx-launched-art__card">
          <Pocket featured className="w-full">
            {/* The reveal (M14): the card starts face down and turns one and a half times into a burst and
                confetti once the dialog is open (under calm: the face at once, no confetti). */}
            <MintCard card={coin} depth="hand" />
          </Pocket>
        </div>
      </div>,
      <div key="share" className="cdx-launched-copy cdx-overlay-copy">
        <p className="text-pretty text-[15px] leading-[1.5] text-slate">
          {dexNo(coin.dexNo)} in the dex. You hold the one-of-one ${coin.ticker} card in your chosen design.
          {IS_SIM ? " This is a local demo; no real token or NFT has been minted." : ""}
        </p>
      {/* flex-1 only in the row: in the phone column a zero basis squashed both buttons to 15px bars (QA). */}
      <div className="mdx-sheet-foot flex flex-col gap-2 sm:flex-row-reverse">
        <a
          className="mdx-btn mdx-btn--primary flex-none sm:flex-1"
          href={xIntent(share.text, url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Post on X
        </a>
        <Button variant="outline" className="flex-none sm:flex-1" onClick={() => void copyLink(url)}>
          Copy link
        </Button>
      </div>
      </div>,
      ]} /></div>
    </Modal>
  );
}
