import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { timeAgo } from "../../lib/mintdex/format";
import { pumpFunCoinUrl, solscanTokenUrl, type PublicLiveLaunch } from "../../lib/carddex/live/launches";
import { Icon, SectionHead, TextLink } from "./ui";

/**
 * A finished mainnet launch (Home's "Launched on pump.fun"), as an activity-style row in the rail: the card as the NFT
 * shows it (the coin art if the receipt has no card image, a card-shaped blank if neither loads), the name, then
 * $TICKER, design and time in slate, and two links out: the coin on pump.fun and the token on Solscan. The name opens
 * the coin's own page (/coin/<mint>).
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
        <Link to="/coin/$id" params={{ id: l.tokenMint }} className="cdx-feed-launch__name mdx-link">
          {l.name}
        </Link>
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
