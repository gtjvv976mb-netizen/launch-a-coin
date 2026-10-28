import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { atName, timeAgo, usdCompact } from "../../lib/mintdex/format";
import { tierForLevel } from "../../lib/mintdex/tiers";
import type { CoinSummary, EventRow, SaleRow } from "../../lib/mintdex/types";
import { BotTag } from "./trust";
import { Change, FrameMini, SectionHead, Thumb, solFigure, useTick } from "./ui";

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
        <span className="num text-[16px] leading-[1.2] text-ink">{usdCompact(coin.mcapUsd)}</span>
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

function Amount({ lamports }: { lamports: number }) {
  return (
    <>
      <span className="num">{solFigure(lamports)}</span> SOL
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
            sold <Amount lamports={e.amount} /> of {t}
          </>
        ),
      };
    default:
      return {
        who,
        what: (
          <>
            bought <Amount lamports={e.amount} /> of {t}
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
 * Card sale row, 52px: thumb, coin name over the buyer, price over the time ago. `isNew` (from a live list)
 * marks a sale that arrived with the latest poll: it enters with the sky wash.
 */
export function SaleItem({ s, now, isNew = false }: { s: SaleRow; now: number; isNew?: boolean }) {
  return (
    <Link
      to="/coin/$id"
      params={{ id: s.coinId }}
      data-new={isNew || undefined}
      className="mdx-row -mx-2 grid h-[52px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-2 hover:bg-tint"
    >
      <Thumb src={s.image} size={36} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold leading-[1.25] text-ink">
          {s.coinName}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-[1.3] text-slate">
          <span className="truncate">to {atName(s.buyer)}</span>
          {s.buyerIsBot ? <BotTag /> : null}
        </span>
      </span>
      <span className="flex flex-col items-end">
        <span className="whitespace-nowrap leading-[1.25]">
          <span className="num text-[15px] text-ink">{solFigure(s.price)}</span>
          <span className="text-[13px] font-medium text-slate"> SOL</span>
        </span>
        <span className="text-[12px] leading-[1.3] text-slate">{timeAgo(s.createdAt, now)}</span>
      </span>
    </Link>
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
