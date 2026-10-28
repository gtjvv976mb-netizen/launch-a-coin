/**
 * The live trade ticker (hype arcade): a strip above the page that scrolls the real activity feed (buys, sells,
 * launches, design unlocks, bids and card sales) with the coin's picture, ticker and amount. Fed by the same Home
 * read the site already polls (GET /home on devnet, the sim's getHome in test mode): no made-up rows. It holds
 * still under the pointer or keyboard focus, pauses offscreen, in a hidden tab and under dialogs, and under calm
 * motion it becomes a still row you can scroll sideways. A design unlock that arrives while you watch plays the
 * big tier-up burst in that design's colors.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { CHAIN_POLL_MS, chainHome } from "../../lib/chain/data";
import { hasRecentActivity, isRecentActivityAt } from "../../lib/mintdex/activity-freshness";
import { getHome } from "../../lib/mintdex/api";
import { IS_SIM } from "../../lib/mintdex/mode";
import { tierForLevel } from "../../lib/mintdex/tiers";
import type { EventRow } from "../../lib/mintdex/types";
import { getPairAsset } from "../../lib/carddex/pairs";
import { quoteAtoms } from "../../lib/carddex/quote-display";
import { revPoll, useNow } from "./hooks";
import { FrameMini, Thumb, solFigure, usePauseGate } from "./ui";

/** Seconds each row takes to cross (the strip's speed is the same whatever the row count). */
const SEC_PER_ROW = 3.4;
const MAX_ROWS = 24;
const POLL_MS = IS_SIM ? 15_000 : CHAIN_POLL_MS;

type HomeLike = { activity: EventRow[]; rev?: string };

const fetchHome = (): Promise<HomeLike> => (IS_SIM ? getHome() : chainHome()) as Promise<HomeLike>;

/** The activity rows: Home's own poll when it is fresh (no second read on Home), else a light poll of our own. */
function useActivity(enabled: boolean): EventRow[] {
  const qc = useQueryClient();
  const poll = useMemo(() => revPoll(qc, ["ticker"], fetchHome), [qc]);
  const { data } = useQuery({
    queryKey: ["ticker"],
    enabled,
    staleTime: 10_000,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const home = qc.getQueryState<HomeLike>(["home"]);
      if (home?.data && Date.now() - home.dataUpdatedAt < POLL_MS) return home.data;
      return poll();
    },
  });
  // Home's poll lands between ours: follow it at once.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.query.queryKey[0] === "home" && e.action.type === "success")
        bump((n) => n + 1);
    });
  }, [qc, enabled]);
  const home = qc.getQueryState<HomeLike>(["home"]);
  const tickerAt = qc.getQueryState(["ticker"])?.dataUpdatedAt ?? 0;
  // Whichever read is newer: Home's own poll or ours. Nothing before mount (the server rendered an empty strip).
  const src = !enabled
    ? []
    : home?.data && (!data || home.dataUpdatedAt >= tickerAt)
      ? home.data.activity
      : (data?.activity ?? []);
  const ids = src
    .slice(0, MAX_ROWS)
    .map((r) => r.id)
    .join(",");
  // A stable list while the rows are the same (a poll that changed nothing re-renders nothing below).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => src.slice(0, MAX_ROWS), [ids]);
}

function kindOf(e: EventRow): { tag: string; tone: string } {
  switch (e.kind) {
    case "buy":
      return { tag: "Buy", tone: "up" };
    case "sell":
      return { tag: "Sell", tone: "down" };
    case "launch":
      return { tag: "New", tone: "hype" };
    case "levelup":
      return { tag: "Level up", tone: "tier" };
    case "sale":
      return { tag: "Card sold", tone: "zap" };
    case "bid":
      return { tag: "Bid", tone: "zap" };
    default:
      return { tag: "Listed", tone: "zap" };
  }
}

function Row({ e, copy }: { e: EventRow; copy: boolean }) {
  const k = kindOf(e);
  const tier = e.kind === "levelup" ? tierForLevel(e.level) : null;
  const style = tier
    ? ({ "--tk": tier.sheen.length > 1 ? tier.sheen[1] : tier.ring } as CSSProperties)
    : undefined;
  return (
    <li
      className="mdx-ticker__item"
      data-tone={k.tone}
      style={style}
      aria-hidden={copy || undefined}
    >
      {/* Out of the tab order: the same feed is on Home as a list; the strip is for the eye (and a screen reader's
          virtual cursor, which skips the hidden copy). */}
      <Link to="/coin/$id" params={{ id: e.coinId }} tabIndex={-1} className="mdx-ticker__link">
        <Thumb src={e.image} size={20} />
        <span className="mdx-ticker__tag">{k.tag}</span>
        <span className="mdx-ticker__sym">${e.ticker}</span>
        {tier ? (
          <span className="mdx-ticker__amt">
            <FrameMini level={e.level} className="mr-1 inline-block align-[-3px]" />
            {tier.name}
          </span>
        ) : e.kind === "launch" ? (
          <span className="mdx-ticker__amt">launched</span>
        ) : (
          <span className="mdx-ticker__amt num">
            {e.kind === "sell" ? "-" : e.kind === "buy" ? "+" : ""}
            {quoteAtoms(e.quoteAmount ?? e.amount ?? 0, e.quoteAssetKey, true)} {getPairAsset(e.quoteAssetKey).symbol}
          </span>
        )}
      </Link>
    </li>
  );
}

let lastBurst = 0;

export function Ticker() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const rows = useActivity(mounted);
  const now = useNow();
  const recent = hasRecentActivity(rows, now);
  const ref = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  usePauseGate(ref, { margin: "0px", hold: held });

  // A design unlock that arrives while the page is open: the big burst in that design's colors (one at a time).
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!rows.length) return;
    if (!seen.current) {
      seen.current = new Set(rows.map((r) => r.id));
      return;
    }
    const fresh = rows.filter((r) => !seen.current!.has(r.id));
    for (const r of rows) seen.current.add(r.id);
    const now = Date.now();
    const up = fresh.find((r) => r.kind === "levelup" && isRecentActivityAt(r.createdAt, now));
    if (!up || document.hidden || now - lastBurst < 8000) return;
    lastBurst = now;
    const el = ref.current?.querySelector<HTMLElement>(".mdx-ticker__track");
    const box = el?.getBoundingClientRect();
    void import("./arcade").then((m) =>
      m.tierBurst(
        up.level,
        box ? { x: Math.min(window.innerWidth - 80, box.left + 140), y: box.bottom } : undefined,
      ),
    );
  }, [rows]);

  if (!rows.length) {
    // Same height before data lands (no shift), and nothing at all to read.
    return <div ref={ref} className="mdx-ticker" aria-hidden data-empty="" />;
  }
  const dur = `${Math.max(24, rows.length * SEC_PER_ROW)}s`;
  return (
    <div
      ref={ref}
      className="mdx-ticker"
      role="region"
      aria-label={recent ? "Live activity" : "Past activity"}
      data-activity={recent ? "live" : "past"}
      data-held={held || undefined}
    >
      <span className="mdx-ticker__live" aria-hidden>
        <span className={recent ? "mdx-live" : "mdx-ticker__past-dot"} />
        {recent ? "Live" : "Past activity"}
      </span>
      <div className="mdx-ticker__view">
        <ul className="mdx-ticker__track" style={{ "--dur": dur } as CSSProperties}>
          {rows.map((e) => (
            <Row key={e.id} e={e} copy={false} />
          ))}
          {rows.map((e) => (
            <Row key={`c${e.id}`} e={e} copy />
          ))}
        </ul>
      </div>
      {/* WCAG 2.2.2: anything that moves by itself can be paused. */}
      <button
        type="button"
        className="mdx-ticker__pause"
        aria-pressed={held}
        aria-label={`${held ? "Play" : "Pause"} ${recent ? "live" : "past"} activity`}
        onClick={() => setHeld((h) => !h)}
      >
        {held ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  );
}
