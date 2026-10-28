import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { BOT_HINT } from "../../lib/mintdex/copy";
import { atName, timeAgo } from "../../lib/mintdex/format";
import { tierForLevel } from "../../lib/mintdex/tiers";
import { getPairAsset } from "../../lib/carddex/pairs";
import { marketCapText, quoteAtoms } from "../../lib/carddex/quote-display";
import {
  pumpFunCoinUrl,
  solscanTokenUrl,
  type PublicLiveLaunch,
} from "../../lib/carddex/live/launches";
import type { CoinSummary, EventRow, SaleRow } from "../../lib/mintdex/types";
import { BotTag } from "./trust";
import {
  Change,
  CurveTrack,
  FrameMini,
  Icon,
  SectionHead,
  TextLink,
  Thumb,
  solFigure,
  useTick,
} from "./ui";

/**
 * Coin row (Home's Trending), two lines on a 56px pitch: rank, 36px thumb, the name with its $TICKER, the bonding
 * curve as a small track (`curve`), then the market cap over the signed 24h change, right-aligned and tabular. No
 * dividers; hover and focus tint the rounded row. The caller puts it in a list item (the FLIP order lives there).
 */
export function CoinRow({
  coin,
  rank,
  curve = false,
}: {
  coin: CoinSummary;
  rank?: number;
  curve?: boolean;
}) {
  // A rank that changes with a poll (the row glides to its new place, M20) ticks its numeral in.
  const t = useTick(rank);
  return (
    <Link
      to="/coin/$id"
      params={{ id: coin.id }}
      className="mdx-row cdx-feed-coin"
      data-ranked={rank != null || undefined}
    >
      {rank != null && (
        <span className="cdx-feed-coin__rank num">
          <span
            key={t.n}
            className={t.n ? "mdx-tick" : undefined}
            data-dir={t.dir === "up" ? "down" : "up"}
          >
            {rank}
          </span>
        </span>
      )}
      <Thumb src={coin.image} size={36} />
      <span className="cdx-feed-coin__id">
        <span className="cdx-feed-coin__name">
          <span className="truncate">{coin.name}</span>
          <span className="cdx-feed-coin__ticker num">${coin.ticker}</span>
        </span>
        {curve ? (
          <CurveTrack progress={coin.curveProgress} graduated={coin.graduated} size="sm" />
        ) : null}
      </span>
      <span className="cdx-feed-coin__figures">
        <span className="num cdx-feed-coin__cap">{marketCapText(coin)}</span>
        <Change v={coin.change24h} className="cdx-feed-coin__change" />
      </span>
    </Link>
  );
}

/**
 * The player who did it, then " · bot" in slate after a demo bot's handle (backlog P0-6; one quiet word, not a chip
 * on every row). The handle is the part that gives way: it truncates before the bot word and the time.
 */
function Who({ handle, bot = false }: { handle: string | null; bot?: boolean }) {
  return (
    <>
      <b className="min-w-0 truncate font-semibold">{handle ? atName(handle) : "Someone"}</b>
      {bot ? (
        <span className="cdx-feed-event__bot" title={BOT_HINT}>
          <span aria-hidden> · </span>bot<span className="sr-only">, {BOT_HINT.toLowerCase()}</span>
        </span>
      ) : null}
    </>
  );
}

function Amount({ lamports, quoteAssetKey }: { lamports: number | null; quoteAssetKey?: string }) {
  return (
    <span className="cdx-feed-event__amount">
      <span className="num">{quoteAtoms(lamports ?? 0, quoteAssetKey, true)}</span>{" "}
      {getPairAsset(quoteAssetKey).symbol}
    </span>
  );
}

/** An activity event as who did it (or the coin, for an unlock) and what they did, amount and ticker included. */
function eventParts(e: EventRow): { who: ReactNode; what: ReactNode } {
  const t = <span className="cdx-feed-event__ticker">${e.ticker}</span>;
  const who = <Who handle={e.handle} bot={e.isBot} />;
  switch (e.kind) {
    case "launch":
      return { who, what: <>launched {t}</> };
    case "levelup": {
      const tier = tierForLevel(e.level);
      return {
        who: <b className="min-w-0 truncate font-semibold">${e.ticker}</b>,
        what: (
          <>
            unlocked the <FrameMini level={e.level} className="mx-px align-[-3px]" /> {tier.name}{" "}
            design
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
            sold <Amount lamports={e.quoteAmount ?? e.amount} quoteAssetKey={e.quoteAssetKey} /> of{" "}
            {t}
          </>
        ),
      };
    default:
      return {
        who,
        what: (
          <>
            bought <Amount lamports={e.quoteAmount ?? e.amount} quoteAssetKey={e.quoteAssetKey} />{" "}
            of {t}
          </>
        ),
      };
  }
}

/**
 * Activity row, two lines on a 48px pitch: the 28px coin thumb, then who did it (handle 600, " · bot") with the time
 * ago at the right, over what they did in slate, which gets the full width and wraps rather than cut an amount or a
 * ticker. In the DOM the time comes last, so it reads as one sentence: "@handle bought 1.03 SOL of $HONK, 2m ago".
 * `isNew` (from useLiveList) marks a row that arrived with the latest poll: it gets the wash once.
 */
export function EventItem({
  e,
  now,
  isNew = false,
}: {
  e: EventRow;
  now: number;
  isNew?: boolean;
}) {
  const { who, what } = eventParts(e);
  return (
    <Link
      to="/coin/$id"
      params={{ id: e.coinId }}
      data-new={isNew || undefined}
      className="mdx-row cdx-feed-event"
    >
      <Thumb src={e.image} size={28} />
      <span className="cdx-feed-event__text">
        <span className="cdx-feed-event__who">{who}</span>
        <span className="cdx-feed-event__what">{what}</span>
        <span className="cdx-feed-event__time num">
          <span className="sr-only">, </span>
          {timeAgo(e.createdAt, now)}
        </span>
      </span>
    </Link>
  );
}

/**
 * A finished mainnet launch (Home's "Launched on pump.fun"): the card as the NFT shows it (the coin art if the
 * receipt has no card image, a card-shaped blank if neither loads), the name, $TICKER, design and time, and two
 * links out: the coin on pump.fun and the token on Solscan. Real data only; there is no in-app page for it.
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
    </li>
  );
}

/** The launch list while it loads: the rows' own size, flat bars, no shimmer, no layout shift when data lands. */
export function LaunchedSkeleton({ rows = 3 }: { rows?: number }) {
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
