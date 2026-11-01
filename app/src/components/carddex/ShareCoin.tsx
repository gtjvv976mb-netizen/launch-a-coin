import { useEffect, useRef, useState } from "react";

import { buttonClass, Icon } from "../mintdex/ui";
import { OFFICIAL_X_HANDLE } from "../../lib/carddex/official";
import { copyText } from "../../lib/mintdex/clipboard";
import { absoluteUrl } from "../../lib/mintdex/seo";

/*
 * Sharing a launched coin (owner request 1 November 2026: "Share your card"): post it on X through X's own composer
 * (the visitor reads and sends the post themselves), the phone's share sheet where there is one, the coin page's link,
 * and the card image to attach. Used on the launch panel once a launch is complete (`creator`) and on every coin page.
 * The link's preview on X shows the card (the coin page's share image). Nothing here posts anything by itself.
 * Styles: styles/screens/coin.css (.cdx-share*).
 */

export type ShareCoinProps = {
  name: string;
  ticker: string;
  mint: string;
  /** The card image (a same-origin /api/live/assets path), offered to save and attach; null when the launch has none. */
  cardImage: string | null;
  /** The creator, right after their launch: the post speaks in their voice. */
  creator?: boolean;
  className?: string;
};

/** The post X's composer opens with: the creator's voice or a visitor's, the ticker as a cashtag, our handle. */
export function shareText({ name, ticker, creator }: Pick<ShareCoinProps, "name" | "ticker" | "creator">): string {
  return creator
    ? `I just launched ${name} ($${ticker}) on ${OFFICIAL_X_HANDLE} 🃏 It comes with its own one-of-one NFT card.`
    : `${name} ($${ticker}) has its own one-of-one NFT card on ${OFFICIAL_X_HANDLE} 🃏`;
}
export const coinPageUrl = (mint: string) => absoluteUrl(`/coin/${mint}`);
/** X's documented Web Intent: the composer, prefilled; the visitor posts it or not. */
export function xShareUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
/** A stored launch asset's same-origin path (/api/live/assets/…), so the browser can save it; null for anything else. */
export function assetHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const path = new URL(url, "https://launchacard.fun").pathname;
    return /^\/api\/live\/assets\/[\w./-]+$/.test(path) ? path : null;
  } catch { return null; }
}
const fileName = (ticker: string) => `${ticker.replace(/[^\w-]/g, "") || "coin"}-card.png`;

export function ShareCoin({ name, ticker, mint, cardImage, creator = false, className = "" }: ShareCoinProps) {
  const url = coinPageUrl(mint), text = shareText({ name, ticker, creator });
  const [native, setNative] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "blocked">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The share sheet exists on phones and some desktops only: decided after mount, so the server's markup matches.
  useEffect(() => { setNative(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const result = await copyText(url);
    clearTimeout(timer.current);
    setCopied(result);
    if (result === "copied") timer.current = setTimeout(() => setCopied("idle"), 2_000);
  };
  const share = async () => {
    try { await navigator.share({ title: `${name} ($${ticker})`, text, url }); }
    catch { /* Closed or refused: nothing to do. */ }
  };
  return (
    <div className={`cdx-share ${className}`}>
      <div className="cdx-share__row">
        <a href={xShareUrl(text, url)} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: creator ? "primary" : "outline", size: "sm" })} aria-label={`Post ${name} on X (opens X in a new tab)`}>
          Post on X
          <Icon name="external" size={14} />
        </a>
        {native ? (
          <button type="button" className={buttonClass({ variant: "outline", size: "sm" })} onClick={() => void share()}>
            <Icon name="share" size={14} />
            Share
          </button>
        ) : null}
        <button type="button" className={buttonClass({ variant: "outline", size: "sm" })} onClick={() => void copy()}>
          <Icon name="copy" size={14} />
          {copied === "copied" ? "Link copied" : "Copy link"}
        </button>
        {cardImage ? (
          <a href={cardImage} download={fileName(ticker)} className={buttonClass({ variant: "outline", size: "sm" })}>
            Save card image
          </a>
        ) : null}
      </div>
      <span className="sr-only" role="status">{copied === "copied" ? "Link copied" : ""}</span>
      {copied === "blocked" ? (
        <label className="cdx-share__manual">
          <span>Copying is blocked here. Select the link and copy it:</span>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} ref={(el) => el?.select()} />
        </label>
      ) : null}
      {creator && cardImage ? <p className="cdx-share__tip">Tip: save the card image and add it to your post so it shows full size.</p> : null}
    </div>
  );
}
