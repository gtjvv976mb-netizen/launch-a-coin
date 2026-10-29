/**
 * Honesty and sharing pieces (backlog P0-5, P0-6, P0-7, P1-12), on the Holo Soft primitives in ./ui.
 *
 *   ModeBadge      The "Test mode" pill beside the wordmark (rail lockup and MobileHeader). Opens a small popover
 *                  (a bottom sheet on phones): what is simulated, the USD rate, and links to a devnet faucet (the
 *                  /how#demo in test mode) and to Terms & risks. Renders nothing when the mode has no badge (mainnet).
 *   BotTag         The small "bot" chip after a demo bot's handle.
 *   SimTag         The small "Simulated" chip beside demo market figures (test mode only).
 *   ConfirmDialog  open (req), onOpenChange (req), title (req), children (req), confirmLabel (req), cancelLabel,
 *                  pending, pendingLabel, onConfirm (req). A Modal with a secondary cancel and a primary confirm.
 *                  Used by Start over now; the devnet Disconnect and pre-sign reviews reuse it.
 *   ShareButton    title (req), text (req), path (req), address, label, className. The quiet 36px IconButton look: the
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
  BOT_HINT,
  SIM_TAG,
  SIM_TAG_HINT,
  WORDS,
  shareCoinText,
} from "../../lib/mintdex/copy";
import { dexNo } from "../../lib/mintdex/format";
import { absoluteUrl, canonicalCoinPath } from "../../lib/mintdex/seo";
import type { CoinDetail } from "../../lib/mintdex/types";
import { MintCard } from "./MintCard";
import { Button, Icon, Modal, Pocket, menuCollisionPadding, useToast } from "./ui";
import { Sheet, isPhoneNow } from "./sheet";

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
  const [open, setOpen] = useState(false);
  // Phones read the same words in a bottom sheet (P1-1); the trigger and its markup stay the same.
  const [sheet, setSheet] = useState(false);
  if (!MODE_COPY.badge) return null;
  const body = (close: () => void) => (
    <>
      <p className="text-body text-slate max-lg:text-lead">
        {MODE_COPY.explainer}
      </p>
      {MODE_COPY.usdNote ? (
        <p className="mt-2 text-body text-slate max-lg:text-lead">
          {MODE_COPY.usdNote}.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-body max-lg:mt-4 max-lg:text-lead">
        {/* Devnet: where the free SOL comes from (the guide has its own links in the rail and header). */}
        {FAUCET ? (
          <a href={FAUCET.href} target="_blank" rel="noopener noreferrer" className="mdx-link mdx-hit" onClick={close}>
            {HOME_COPY.getDevnetSol}
          </a>
        ) : (
          <Link to="/how" hash="demo" className="mdx-link mdx-hit" onClick={close}>
            How it works
          </Link>
        )}
        <Link to="/legal" hash="risks" className="mdx-link mdx-hit" onClick={close}>
          Terms &amp; risks
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
          // The one demo signal (styles/shell.css .cdx-demo-pill): a track pill that reaches the hit size.
          className={cx("cdx-demo-pill", className)}
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
          aria-labelledby="mode-badge-title"
          className="mdx-menu mdx-pop z-50 w-[min(300px,calc(100vw_-_24px))] p-4 outline-none"
        >
          <p id="mode-badge-title" className="mb-1 text-body font-semibold text-ink">{MODE_COPY.badge}</p>
          {body(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
      <Sheet open={sheet} onOpenChange={setSheet} title={MODE_COPY.badge}>
        {body(() => setSheet(false))}
      </Sheet>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------- bot tag

/** "bot" after a demo bot's handle (P0-6). Neutral chip, slate on track (5.5:1 on canvas, 6.6:1 on panel). */
export function BotTag({ className = "" }: { className?: string }) {
  return (
    <span
      title={BOT_HINT}
      // The Badge recipe (neutral): demo figures keep this label (mintdex.css .mdx-tag).
      className={cx("mdx-tag align-[1px]", className)}
    >
      bot<span className="sr-only">, {BOT_HINT.toLowerCase()}</span>
    </span>
  );
}

/**
 * The "Simulated" tag beside demo market figures (CT-06): the same chip as the bot tag, so a screenshot of a market
 * cap or a 24h change never reads as a live quote. Renders nothing off sim.
 */
export function SimTag({ className = "" }: { className?: string }) {
  if (!SIM_TAG) return null;
  return (
    <span
      title={SIM_TAG_HINT}
      className={cx(
        "inline-flex h-[18px] flex-none items-center rounded-pill bg-track px-1.5 align-[1px] text-caption font-semibold leading-none text-slate",
        className,
      )}
    >
      {SIM_TAG}
    </span>
  );
}

// The confirm dialog lives in confirm.tsx so the app shell can use it without this file (MintCard).
export { ConfirmDialog } from "./confirm";

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
          data-tip={label}
          onClick={(e) => {
            if (!canNativeShare()) return;
            // The phone's own share sheet instead of the popover (preventDefault stops Radix opening it).
            e.preventDefault();
            navigator.share({ title, text, url }).catch(() => {});
          }}
          className={cx("mdx-btn mdx-btn--icon mdx-btn--ghost mdx-tip data-[state=open]:bg-track", className)}
        >
          <Icon name="share" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={menuCollisionPadding()}
          aria-label={label}
          className="mdx-menu mdx-pop z-50 flex w-[220px] flex-col outline-none"
        >
          {manual ? (
            <input
              readOnly
              autoFocus
              value={url}
              aria-label="Link to this page"
              onFocus={(e) => e.currentTarget.select()}
              className="mdx-input h-9 px-2.5 text-body"
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
      {/* One page (code-06): the new card, one sentence, then [Copy link] [Post on X]. */}
      <div className="cdx-launched">
        <div className="cdx-launched-art">
          <div ref={cardRef} className="cdx-launched-art__card">
            <Pocket featured className="w-full">
              {/* The reveal (M14): the card starts face down and turns one and a half times into a burst and
                  confetti once the dialog is open (under calm: the face at once, no confetti). */}
              <MintCard card={coin} depth="hand" />
            </Pocket>
          </div>
        </div>
        <p className="cdx-launched-copy">
          {dexNo(coin.dexNo)}. Your one-of-one ${coin.ticker} card.
          {IS_SIM ? " Demo: nothing was minted." : ""}
        </p>
        <div className="cdx-overlay-actions mdx-sheet-foot">
          <Button variant="outline" onClick={() => void copyLink(url)}>
            Copy link
          </Button>
          <a className="mdx-btn mdx-btn--primary" href={xIntent(share.text, url)} target="_blank" rel="noopener noreferrer">
            Post on X
            <span className="sr-only"> (opens in a new tab)</span>
            <Icon name="external" />
          </a>
        </div>
      </div>
    </Modal>
  );
}
