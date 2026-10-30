import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { atName, timeAgo } from "../../lib/mintdex/format";
import { tierForLevel } from "../../lib/mintdex/tiers";
import { getPairAsset } from "../../lib/carddex/pairs";
import { marketCapText, quoteAtoms } from "../../lib/carddex/quote-display";
import { pumpFunCoinUrl, solscanTokenUrl, type PublicLiveLaunch } from "../../lib/carddex/live/launches";
import type { CoinSummary, EventRow } from "../../lib/mintdex/types";
import { BotTag } from "./trust";
import { Change, FrameMini, Icon, SectionHead, TextLink, Thumb, useTick } from "./ui";

/**
 * Coin row (Trending and search-style lists), 52px: rank, 36px thumb, name over $TICKER,
 * market cap over the 24h change (left out when it rounds to 0.0%). No dividers; hover tints the rounded row. Use
 * FitList rowHeight={52}.
 */
export function CoinRow({ coin, rank, flipId }: { coin: CoinSummary; rank?: number; flipId?: string }) {
  // A rank that changes with a poll (the row glides to its new place, M20) ticks its numeral in.
  const t = useTick(rank);
  return (
    <Link
      to="/coin/$id"
      params={{ id: coin.id }}
      data-flip={flipId}
      className={`mdx-row -mx-2 grid h-[52px] items-center gap-3 px-2 hover:bg-tint ${
        rank != null
          ? "grid-cols-[20px_36px_minmax(0,1fr)_auto]"
          : "grid-cols-[36px_minmax(0,1fr)_auto]"
      }`}
    >
      {rank != null && (
        <span className="num overflow-clip text-[13px] text-slate">
          <span key={t.n} className={t.n ? "mdx-tick" : undefined} data-dir={t.dir === "up" ? "down" : "up"}>
            {String(rank).padStart(2, "0")}
          </span>
        </span>
      )}
      <Thumb src={coin.image} size={36} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-[1.25] text-ink">
          {coin.name}
        </span>
        <span className="block truncate text-[12px] leading-[1.3] text-slate">${coin.ticker}</span>
      </span>
      <span className="flex flex-col items-end">
        {/* The figure is the market cap whatever the list is ranked by (GalleryTile's MC unit, INTEGRITY-2). */}
        <span className="text-[16px] leading-[1.2] text-ink">
          <span className="mr-1 text-[12px] font-medium text-slate" aria-hidden>MC</span>
          <span className="sr-only">, market cap </span>
          <span className="num">{marketCapText(coin)}</span>
        </span>
        <Change v={coin.change24h} hideZero className="text-[13px] leading-[1.3]" />
      </span>
    </Link>
  );
}

/**
 * The player who did it, with the "bot" tag after a demo bot's handle (backlog P0-6). The handle is the part
 * that gives way: it truncates before the tag (never cut) and long before the action line under it.
 */
function Who({ handle, bot = false }: { handle: string | null; bot?: boolean }) {
  return (
    <>
      <b className="min-w-0 truncate font-semibold">{handle ? atName(handle) : "Someone"}</b>
      {bot ? <BotTag /> : null}
    </>
  );
}

function Amount({ lamports, quoteAssetKey }: { lamports: number | null; quoteAssetKey?: string }) {
  return (
    <>
      <span className="num">{quoteAtoms(lamports ?? 0, quoteAssetKey, true)}</span> {getPairAsset(quoteAssetKey).symbol}
    </>
  );
}

/** An activity event as who did it (or the coin, for an unlock) and what they did, amount and ticker included. */
function eventParts(e: EventRow): { who: ReactNode; what: ReactNode } {
  const t = `$${e.ticker}`;
  const who = <Who handle={e.handle} bot={e.isBot} />;
  switch (e.kind) {
    case "launch":
      return { who, what: <>launched {t}</> };
    case "levelup": {
      const tier = tierForLevel(e.level);
      return {
        who: <b className="min-w-0 truncate font-semibold">{t}</b>,
        what: (
          <>
            unlocked the <FrameMini level={e.level} className="mx-px align-[-3px]" /> {tier.name} design
          </>
        ),
      };
    }
    case "sale":
      return {
        who,
        what: (
          <>
            bought the {t} card for <Amount lamports={e.amount} />
          </>
        ),
      };
    case "bid":
      return {
        who,
        what: (
          <>
            bid <Amount lamports={e.amount} /> on the {t} card
          </>
        ),
      };
    case "list":
      return {
        who,
        what: (
          <>
            listed the {t} card at <Amount lamports={e.amount} />
          </>
        ),
      };
    case "sell":
      return {
        who,
        what: (
          <>
            sold <Amount lamports={e.quoteAmount ?? e.amount} quoteAssetKey={e.quoteAssetKey} /> of {t}
          </>
        ),
      };
    default:
      return {
        who,
        what: (
          <>
            bought <Amount lamports={e.quoteAmount ?? e.amount} quoteAssetKey={e.quoteAssetKey} /> of {t}
          </>
        ),
      };
  }
}

/**
 * Activity row, 44px: the 28px coin thumb, then two lines: who did it (handles 600, the bot tag) with the time
 * ago at the right, over what they did, which gets the full width so the amount and the ticker are never cut
 * (a 16 character handle still leaves the action line whole at 1280x720). In the DOM the time comes last, so it
 * reads as one sentence: "@handle bought 1.03 SOL of $HONK, 2m ago". Phones (the list scrolls): the action may
 * wrap to a second line. `isNew` (from useArrivals) marks a row that arrived with the latest poll: it enters with
 * the sky wash.
 */
export function EventItem({ e, now, isNew = false }: { e: EventRow; now: number; isNew?: boolean }) {
  const { who, what } = eventParts(e);
  return (
    <Link
      to="/coin/$id"
      params={{ id: e.coinId }}
      data-new={isNew || undefined}
      className="mdx-row -mx-2 grid h-11 min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 px-2 hover:bg-tint max-lg:h-auto max-lg:min-h-11 max-lg:py-1.5"
    >
      <Thumb src={e.image} size={28} />
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 text-[13px] leading-[1.35] text-ink [grid-template-areas:'who_time'_'what_what']">
        <span className="flex min-w-0 items-center gap-1.5 [grid-area:who]">{who}</span>
        <span className="min-w-0 [grid-area:what] lg:truncate max-lg:line-clamp-2">{what}</span>
        <span className="self-center whitespace-nowrap text-right text-[12px] leading-[1.3] text-slate [grid-area:time]">
          <span className="sr-only">, </span>
          {timeAgo(e.createdAt, now)}
        </span>
      </span>
    </Link>
  );
}

/**
 * A finished mainnet launch (Home's "Launched on pump.fun"), as an activity-style row in the rail: the card as the NFT
 * shows it (the coin art if the receipt has no card image, a card-shaped blank if neither loads), the name, then
 * $TICKER, design and time in slate, and two links out: the coin on pump.fun and the token on Solscan. Real data only;
 * there is no in-app page for it.
 */
export function LaunchedItem({ launch: l, now }: { launch: PublicLiveLaunch; now: number }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : (l.cardImage ?? l.image);
  return (
    <li className="cdx-feed-launch">
      <span className="cdx-feed-launch__card" data-art={!l.cardImage || undefined}>
        {src ? (
          <img
            src={src}
            alt=""
            width={40}
            height={56}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        ) : null}
      </span>
      <span className="cdx-feed-launch__id">
        <span className="cdx-feed-launch__name">{l.name}</span>
        <span className="cdx-feed-launch__meta">
          <span className="num">${l.ticker}</span>
          {l.designName ? <> · {l.designName}</> : null}
          {" · "}
          <time dateTime={new Date(l.createdAt).toISOString()} className="num">
            {timeAgo(l.createdAt, now)}
          </time>
        </span>
        <span className="cdx-feed-launch__links">
          <TextLink href={pumpFunCoinUrl(l.tokenMint)} target="_blank">
            View on pump.fun<span className="sr-only">: {l.name} (opens in a new tab)</span>
            <Icon name="external" size={14} />
          </TextLink>
          <TextLink href={solscanTokenUrl(l.tokenMint)} target="_blank">
            Solscan<span className="sr-only">: {l.name} token (opens in a new tab)</span>
            <Icon name="external" size={14} />
          </TextLink>
        </span>
      </span>
    </li>
  );
}

/** The launch list while it loads: the rows' own size, flat bars, no shimmer, no layout shift when data lands. */
export function LaunchedSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <ul aria-busy="true" aria-label="Loading launches" className="cdx-home-launched__list">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} aria-hidden className="cdx-feed-launch" data-skeleton>
          <span className="cdx-feed-launch__card" />
          <span className="cdx-feed-launch__id">
            <span className="cdx-feed-launch__bar" data-w="name" />
            <span className="cdx-feed-launch__bar" data-w="meta" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * @deprecated Migration alias for old panel pages: the section header with panel padding.
 * New code uses SectionHead from ./ui inside a plinth column.
 */
export function PanelHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="px-4 pt-3">
      <SectionHead title={title} right={right} />
    </div>
  );
}
