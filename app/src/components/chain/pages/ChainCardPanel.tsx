/**
 * The devnet card panel (refs/chain/m3-contract.md §2.2 Coin, card-program-v2 §7): who holds the card, the
 * design it keeps against the one its market cap reaches now, the unlock window ("Confirming 2 of 3, about
 * 40 s"), "Unlock design" (queues the watchdog, no wallet prompt), the card fees with their breakdown and
 * Withdraw, the listing (list with price, expiry and void-on-evolve, re-price, delist, buy now) and the bids
 * (place, raise, cancel, accept at the amount shown). Same layout and words as the test-mode card panel
 * (components/mintdex/coin.tsx DeedPanel).
 *
 * Owner: app:pages. Every write runs through lib/chain/client.ts; the seller fee floor (card-program-v2 §18.9) is
 * computed by the client flows, and this panel says so when the fees moved and the wallet asks again.
 */
import type { ApiBid, ApiCardState, ApiConfig, ApiListing, ApiWallet } from "@mintdex/chain-sdk/api";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type Ref } from "react";

import { num, walletName } from "../../../lib/chain/adapt";
import {
  acceptBid,
  buyNow,
  cancelBid,
  delistCard,
  listCard,
  placeBid,
  queueEvolve,
  withdrawFees,
} from "../../../lib/chain/client";
import { boost, useChainConfig, type ChainCoinPage } from "../../../lib/chain/data";
import { CHAIN_COPY, COIN_COPY, FIXPACK_COPY, FLOW, SWITCH_COPY, WORDS, pct } from "../../../lib/mintdex/copy";
import { capSol, launchCapsOf } from "../../../lib/chain/launch-caps";
import { CARD_BIDDING_NOTICE, CARD_BIDDING_SUSPENDED } from "../../../lib/mintdex/card-bidding";
import { concentratedNote, listingPauseReason, resumeText } from "../../../lib/chain/listing-state";
import { atName, cleanAmount, parseSol, sol, timeAgo, untilText } from "../../../lib/mintdex/format";
import { tierForLevel } from "../../../lib/mintdex/tiers";
import type { BidRow } from "../../../lib/mintdex/types";
import { whenRevealed } from "../../mintdex/card3d";
import { claimCard } from "../../mintdex/cases";
import { useArrivals, useNow } from "../../mintdex/hooks";
import { Button, Field, FrameMini, Input, Modal, Num, SectionHead, TextLink, useToast } from "../../mintdex/ui";
import { ChainSaleReview, type ChainReview } from "./ChainSaleReview";
import { chainErrorText, ExplorerLink, FaucetLinks, openWallet, signBlocker, useSiteTransactionHold, SITE_TRANSACTION_HOLD_NOTICE, useTx, type Viewer } from "./tx";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const BID_ROW = 32;
/** Devnet Config defaults (card-program-v2 §13 step 7) until GET /config answers. */
const DEFAULT_MIN_BID = 30_000_000;
const PAUSE_EVOLVE = 2;
const PAUSE_MARKET = 4;

/** "in 3d" past two days, else "in 5h" / "in 12m" (a listing's end). */
function endsIn(ms: number, now: number) {
  const days = Math.floor((ms - now) / 86_400_000);
  return days >= 2 ? `in ${days}d` : untilText(ms, now);
}

/** "2m" for dense rows. */
function ago(ms: number, now?: number) {
  return timeAgo(ms, now).replace(/ ago$/, "");
}

function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-[22px] items-center gap-3">
      <dt className="w-[90px] flex-none text-[13px] text-slate">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-baseline justify-end gap-3 text-right">{children}</dd>
    </div>
  );
}

/**
 * Market settings from the live Config (display only; the client's verifier reads its own), and the Worker's exposure
 * caps of the first mainnet weeks (launch-plan §4.5: 2 SOL per bid and per listing until lifted; null = none).
 */
export function marketRules(cfg: ApiConfig | null) {
  const caps = launchCapsOf(cfg);
  return {
    maxBid: caps && Number.isFinite(caps.maxBid) ? caps.maxBid : null,
    maxListPrice: caps && Number.isFinite(caps.maxListPrice) ? caps.maxListPrice : null,
    minBid: cfg ? num(cfg.minBid) || DEFAULT_MIN_BID : DEFAULT_MIN_BID,
    protocolBps: cfg?.protocolFeeBps ?? 250,
    royaltyBps: cfg?.creatorRoyaltyBps ?? 500,
    marketPaused: !!cfg && (cfg.paused & PAUSE_MARKET) !== 0,
    evolvePaused: !!cfg && (cfg.paused & PAUSE_EVOLVE) !== 0,
  };
}

/** Where a pending unlock stands, in words ("Confirming 2 of 3, about 40 s"). */
export function unlockText(card: ApiCardState): string | null {
  if (card.pendingLevel > 0 && card.progress) {
    const p = card.progress;
    return `Confirming ${Math.min(p.obs, p.obsNeeded)} of ${p.obsNeeded}, about ${Math.max(1, p.etaSeconds)} s`;
  }
  if (card.pendingLevel > 0) return "Confirming the new market cap...";
  if (card.unlockQueued) return "Queued, checking now...";
  return null;
}

export function ChainCardPanel({
  page,
  viewer,
  wallet,
  balance,
  bidsRef,
  noteRef,
  bidFit = 6,
  hideNote = false,
  pane,
  className = "",
}: {
  page: ChainCoinPage;
  viewer: Viewer;
  wallet: ApiWallet | null;
  balance: number | null;
  bidsRef?: Ref<HTMLDivElement>;
  noteRef?: Ref<HTMLParagraphElement>;
  bidFit?: number;
  hideNote?: boolean;
  pane?: string;
  className?: string;
}) {
  const { detail, coin, bids } = page;
  const card = detail.card;
  const mint = detail.mint;
  const now = useNow();
  const toast = useToast();
  const tx = useTx();
  const siteHeld = useSiteTransactionHold();
  const rules = marketRules(useChainConfig());
  const address = viewer.address;
  const [allOpen, setAllOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [review, setReview] = useState<ChainReview | null>(null);
  const [queueing, setQueueing] = useState(false);
  const bidRef = useRef<HTMLInputElement>(null);

  const isHolder = !!address && card.holder === address && card.holderMode !== "unknown";
  const listing: ApiListing | null = card.listing;
  const myListing = !!listing && !!address && listing.seller === address;
  const listed = !!listing && listing.buyable && !listing.voided && !listing.expired;
  const pauseReason = listingPauseReason(listing, card, rules.evolvePaused);
  const frozen = !!card.frozen && isHolder;
  const concentrated = concentratedNote(card);
  const rawBid = (b: BidRow): ApiBid | undefined => detail.bids.find((x) => x.bidder === b.bidderId);
  const myBidRaw: ApiBid | null =
    (address && (detail.bids.find((b) => b.bidder === address) ?? wallet?.bids.find((x) => x.bid.mint === mint)?.bid)) || null;
  const myBid = myBidRaw ? num(myBidRaw.amount) : 0;
  const top = bids[0]?.amount ?? 0;
  const topOther = bids.find((b) => b.bidderId !== address)?.amount ?? 0;
  const fees = card.fees;
  const feesTotal = num(fees.total);
  const fresh = useArrivals(bids.map((b) => b.id));
  const keys = [["coin", mint], ["market"], ["home"]];
  const network = signBlocker(viewer);

  // ---------------------------------------------------------------- level changes while the page is open

  // A design unlocked while watching: the level toast (P1-19). A window that closed without one: the reset note.
  const lastLevel = useRef(card.level);
  const lastPending = useRef(card.pendingLevel);
  const [resetAt, setResetAt] = useState<number | null>(null);
  useEffect(() => {
    if (card.level > lastLevel.current) {
      const t = tierForLevel(card.level);
      const up = card.level;
      // The toast lands on the card's Ascend burst (at once under calm or with no card in view).
      void whenRevealed(coin.dexNo, up).then(() =>
        toast("level", `${coin.name} unlocked the ${t.name} design. It keeps it for good.`, { level: up }),
      );
      setResetAt(null);
    } else if (lastPending.current > 0 && card.pendingLevel === 0 && card.level === lastLevel.current) {
      setResetAt(Date.now());
    }
    lastLevel.current = card.level;
    lastPending.current = card.pendingLevel;
  }, [card.level, card.pendingLevel, coin.name, toast]);
  const showReset = resetAt != null && now - resetAt < 90_000 && card.pendingLevel === 0;

  async function unlock() {
    if (siteHeld || queueing) return;
    setQueueing(true);
    try {
      const r = await queueEvolve(mint);
      boost(mint);
      setResetAt(null);
      if (r.reason === "paused") toast("err", "Unlocks are paused for now.");
      else if (r.reason === "no_level_above") toast("err", "The market cap is below the next design's line again.");
      else toast("ok", `Unlock started. The ${tierForLevel(card.liveLevel).name} design lands once the market cap holds.`);
    } catch (e) {
      toast("err", chainErrorText(e));
    } finally {
      setQueueing(false);
    }
  }

  /** Fix pack F2: one click to keep the listing without the unlock pause (a re-price with the flag off). */
  async function keepWithoutPause() {
    if (siteHeld || !listing) return;
    await tx.run(
      "list",
      (onStep) => listCard({ mint, priceLamports: BigInt(num(listing.price)), expiresAt: listing.expiresAt, voidOnEvolve: false }, onStep),
      { keys, mints: [mint], success: FIXPACK_COPY.keepListedDone },
    );
  }

  // ---------------------------------------------------------------- bids

  const [bidInput, setBidInput] = useState("");
  const [bidTried, setBidTried] = useState(false);
  const suggested = Math.max(rules.minBid, Math.ceil((Math.max(top * 1.05, rules.minBid)) / 1e7) * 1e7);
  const bidAmount = bidInput ? parseSol(bidInput) : NaN;
  const bidValid = Number.isFinite(bidAmount) && bidAmount > 0;
  const spendable = balance != null ? balance + myBid : null;
  const bidShort = viewer.connected && bidValid && spendable != null && bidAmount > spendable;
  const bidLow = bidValid && bidAmount < rules.minBid;
  const bidHigh = bidValid && rules.maxBid != null && bidAmount > rules.maxBid;
  const bidError = tx.error("bid");
  type Hint = { tone: "error" | "info"; node: ReactNode };
  let hint: Hint | null = null;
  if (CARD_BIDDING_SUSPENDED) hint = { tone: "info", node: CARD_BIDDING_NOTICE };
  else if (bidError) hint = { tone: "error", node: bidError };
  else if (network) hint = { tone: "error", node: network };
  else if (rules.marketPaused) hint = { tone: "error", node: "The card market is paused for now." };
  else if (bidTried && bidInput && !bidValid) hint = { tone: "error", node: "Enter an amount in SOL, like 0.05." };
  else if (bidShort)
    hint = {
      tone: "error",
      node: (
        <>
          {FLOW.notEnough} (wallet <span className="num">{sol(spendable!, 3)}</span>). <FaucetLinks lead={false} />
        </>
      ),
    };
  else if (bidLow) hint = { tone: "error", node: `Bids start at ${sol(rules.minBid, 2)} SOL.` };
  else if (bidHigh) hint = { tone: "error", node: SWITCH_COPY.capError(capSol(rules.maxBid!)) };
  else if (bidValid && listed && bidAmount >= num(listing!.price))
    hint = {
      tone: "info",
      node: (
        <>
          Buy now is <span className="num">{sol(num(listing!.price))}</span>.{" "}
          <button type="button" className="mdx-link mdx-hit text-[12px]" onClick={() => openBuy()}>
            Buy instead?
          </button>
        </>
      ),
    };
  else if (bidValid && topOther > 0)
    hint = {
      tone: "info",
      node:
        bidAmount > topOther ? (
          <>
            Top bid <span className="num">{sol(topOther)}</span>. You&apos;d lead.
          </>
        ) : (
          <>
            Top bid <span className="num">{sol(topOther)}</span>. Bid more to lead.
          </>
        ),
    };
  else if (bidValid) hint = { tone: "info", node: "No other bids. You'd set the first price." };
  const bidBlocked = siteHeld || CARD_BIDDING_SUSPENDED || !bidValid || bidShort || bidLow || bidHigh || !!network || rules.marketPaused || !!tx.busy;
  const bidLabel = bidValid ? `${myBid ? "Raise to" : "Bid"} ${sol(bidAmount)} SOL` : myBid ? "Raise bid" : "Place bid";

  async function placeIt(amount: number) {
    if (siteHeld || CARD_BIDDING_SUSPENDED) return;
    const raise = myBid > 0;
    const r = await tx.run("bid", (onStep) => placeBid({ mint, amountLamports: BigInt(amount) }, onStep), {
      keys,
      mints: [mint],
      success: raise
        ? `Bid changed to ${sol(amount)} SOL. The full amount is in escrow.`
        : `Bid placed: ${sol(amount)} SOL is in escrow.`,
    });
    if (r) setBidInput("");
    else bidRef.current?.focus();
  }

  function doBid(e: FormEvent) {
    e.preventDefault();
    if (siteHeld || CARD_BIDDING_SUSPENDED) return;
    if (!viewer.connected) {
      openWallet();
      return;
    }
    if (bidBlocked) {
      setBidTried(true);
      if (!bidInput) setBidInput(String(suggested / 1e9));
      bidRef.current?.focus();
      return;
    }
    void placeIt(bidAmount);
  }

  // ---------------------------------------------------------------- reviews

  function openAccept(b: BidRow) {
    if (siteHeld) return;
    const raw = rawBid(b);
    if (!raw) return;
    setAllOpen(false);
    setReview({
      kind: "accept",
      coin: { mint, name: coin.name, ticker: coin.ticker },
      bid: { bidder: raw.bidder, amount: num(raw.amount), handle: atName(b.handle) },
      launcherIsSeller: card.launcher === address,
      feesToSeller: num(fees.netToHolder),
      protocolBps: rules.protocolBps,
      royaltyBps: rules.royaltyBps,
    });
  }

  function openBuy() {
    if (siteHeld) return;
    if (!listing || !listed) return;
    if (!viewer.connected) {
      openWallet();
      return;
    }
    setReview({
      kind: "buy",
      coin: { mint, name: coin.name, ticker: coin.ticker },
      price: num(listing.price),
      myBid: myBid > 0 ? myBid : null,
      balance,
    });
  }

  async function confirmReview() {
    if (siteHeld || !review) return;
    // The card changes hands (M15): the case spins once with a ring of light, then the success toast.
    if (review.kind === "accept") {
      const msg = `Sold to ${review.bid.handle}. The card and its future card fees are theirs.`;
      const r = await tx.run(
        "sale",
        (onStep) =>
          acceptBid({ mint, bidder: review.bid.bidder, minAmountLamports: BigInt(review.bid.amount) }, onStep),
        { keys, mints: [mint] },
      );
      if (r) {
        setReview(null);
        await claimCard(coin.id);
        toast("ok", msg);
      }
    } else {
      const r = await tx.run(
        "sale",
        (onStep) =>
          buyNow({ mint, expectedPriceLamports: BigInt(review.price), cancelOwnBid: review.myBid != null }, onStep),
        { keys, mints: [mint] },
      );
      if (r) {
        setReview(null);
        await claimCard(coin.id);
        toast("ok", `The ${coin.name} card is yours.`, {
          action: { label: "View in portfolio", to: "/portfolio", search: { tab: "cards" } },
        });
      }
    }
  }

  // ---------------------------------------------------------------- rows

  const shown = bids.slice(0, bidFit);
  const more = bids.length > shown.length;
  const PHONE_BIDS = 3;
  const phoneMore = bids.length > PHONE_BIDS;
  const listBox = {
    "--bids-h": `${Math.max(1, Math.min(bids.length, 8)) * BID_ROW}px`,
    "--bids-h-sm": `${Math.max(1, Math.min(bids.length, PHONE_BIDS)) * BID_ROW}px`,
  } as CSSProperties;

  const bidLine = (b: BidRow) => {
    const mine = b.bidderId === address;
    const raw = rawBid(b);
    const acceptable = raw ? raw.acceptable : false;
    return (
      <div key={b.id} data-new={fresh.has(b.id) || undefined} className="mdx-row flex h-8 items-center gap-2 rounded-none text-[13px]">
        <span className={cx("flex min-w-0 flex-1 items-center gap-1.5", mine ? "font-semibold text-ink" : "text-slate")}>
          <span className="truncate">
            {atName(b.handle)}
            {mine ? " (you)" : ""}
          </span>
        </span>
        <Num size="sm" unit="SOL" className="flex-none">
          {sol(b.amount)}
        </Num>
        <span className="w-10 flex-none text-right text-[12px] text-slate" suppressHydrationWarning>
          {ago(b.createdAt, now)}
        </span>
        {isHolder && (
          <Button
            size="sm"
            className="h-7 flex-none px-2.5"
            aria-label={`Accept the ${sol(b.amount)} SOL bid from ${atName(b.handle)}`}
            title={acceptable ? undefined : "This bid cannot be accepted right now."}
            disabled={siteHeld || !!tx.busy || !acceptable || rules.marketPaused || !!network}
            onClick={() => openAccept(b)}
          >
            Accept
          </Button>
        )}
      </div>
    );
  };

  const myStanding = !myBid ? null : myBid >= top ? "top" : "below";
  const unlocking = unlockText(card);
  const canUnlock = card.liveLevel > card.level && card.pendingLevel === 0 && !card.unlockQueued;
  const holderName = card.holder ? atName(walletName(card.holderHandle, card.holder)) : "Unknown";

  return (
    <section className={cx("flex flex-col", className)} aria-label="The card" data-pane={pane}>
      <SectionHead title="The card" focusHome />
      {siteHeld ? <p role="status" className="mt-2 text-[13px] leading-5 text-slate">{SITE_TRANSACTION_HOLD_NOTICE}</p> : null}

      <dl className="mt-2">
        <CardRow label="Holder">
          <span className="flex min-w-0 items-center gap-1.5 text-[14px] text-ink">
            <span className="truncate">
              {holderName}
              {isHolder && <span className="font-semibold"> (you)</span>}
            </span>
            {card.holderMode === "listing" ? <span className="flex-none text-[12px] text-slate">in escrow</span> : null}
            {card.frozen ? (
              <span className="flex-none text-[12px] font-medium text-ink" title={FIXPACK_COPY.frozenHelp}>
                {FIXPACK_COPY.frozenLabel}
              </span>
            ) : null}
          </span>
        </CardRow>
        <CardRow label="Fee vault">
          <TextLink className="text-[13px]" onClick={() => setFeesOpen(true)}>
            {isHolder && feesTotal > 0 ? "Withdraw" : "Details"}
          </TextLink>
          <Num size="sm" unit="SOL">
            {sol(feesTotal)}
          </Num>
        </CardRow>
      </dl>

      {/* The design is the caption chip's (and the sheet's) to show; this panel says only what is moving: a new
          design the market cap reached, its unlock, or an unlock that reset. Whole sentences that wrap. */}
      {unlocking || canUnlock || showReset ? (
        <div
          role={unlocking || !canUnlock ? "status" : undefined}
          className="mt-2 flex items-start gap-2 rounded-row bg-tint px-3 py-2 text-[13px] leading-[1.45] text-ink"
        >
          {unlocking || canUnlock ? (
            <FrameMini level={card.pendingLevel || card.liveLevel} size="xs" className="mt-[3px]" />
          ) : null}
          <p className="min-w-0 flex-1 text-pretty">
            {unlocking ? (
              COIN_COPY.unlocking(tierForLevel(card.pendingLevel || card.liveLevel).name, unlocking.toLowerCase())
            ) : canUnlock ? (
              <>
                {COIN_COPY.unlockReady(tierForLevel(card.liveLevel).name)}{" "}
                {rules.evolvePaused ? (
                  <span className="text-slate">{COIN_COPY.unlockPaused}</span>
                ) : (
                  <TextLink className="font-semibold" disabled={siteHeld || queueing} onClick={() => void unlock()}>
                    {queueing ? COIN_COPY.unlockStarting : COIN_COPY.unlockAction}
                  </TextLink>
                )}
              </>
            ) : (
              <span className="text-slate">{COIN_COPY.unlockReset}</span>
            )}
          </p>
        </div>
      ) : null}
      {concentrated ? (
        <p className="mt-2 text-pretty text-[12px] leading-4 text-slate">
          <span className="font-medium text-ink">{FIXPACK_COPY.concentratedBadge}.</span> {concentrated}
        </p>
      ) : null}

      {/* Buy now / listing */}
      <div className="mt-3">
        {isHolder ? (
          myListing && listing ? (
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <span className="mdx-micro block">Listed for buy now</span>
                <Num size="lg" unit="SOL" className="mt-1 block">
                  {sol(num(listing.price))}
                </Num>
                <span className="mt-0.5 block text-[12px] leading-4 text-slate">
                  {pauseReason === "pause"
                    ? resumeText(listing, now)
                      ? FIXPACK_COPY.pausedRow(resumeText(listing, now)!)
                      : FIXPACK_COPY.pausedNoTime
                    : pauseReason === "evolve-paused"
                      ? "Paused while card unlocks are paused."
                    : listing.voided
                    ? "Voided by an unlock. Delist or list again."
                    : listing.expired
                      ? "Expired. Delist or list again."
                      : [
                          listing.expiresAt ? `Ends ${endsIn(listing.expiresAt * 1000, now)}` : "No end date",
                          listing.voidOnEvolve ? "voids on unlock" : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                </span>
                {pauseReason === "pause" ? (
                  <TextLink className="mt-1 text-[12px]" disabled={siteHeld || !!tx.busy || !!network || frozen} onClick={() => void keepWithoutPause()}>
                    {FIXPACK_COPY.keepListed}
                  </TextLink>
                ) : null}
              </div>
              <div className="flex flex-none gap-2">
                <Button variant="outline" className="px-3" disabled={siteHeld || !!tx.busy || !!network || frozen} onClick={() => setListOpen(true)}>
                  Re-price
                </Button>
                <Button
                  variant="outline"
                  className="px-3"
                  disabled={siteHeld || !!network || (!!tx.busy && !tx.pending("delist"))}
                  pending={tx.pending("delist")}
                  pendingLabel={tx.label("delist", "Delisting...")}
                  onClick={() =>
                    void tx.run("delist", (onStep) => delistCard({ mint }, onStep), {
                      keys,
                      mints: [mint],
                      success: "Listing removed. The card is back in your wallet.",
                    })
                  }
                >
                  Delist
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-[13px] leading-[1.45] text-slate">
                Not listed.{card.lastSalePrice !== "0" ? (
                  <>
                    {" "}
                    Last sale <span className="num">{sol(num(card.lastSalePrice))}</span> SOL.
                  </>
                ) : null}
              </p>
              <Button
                variant="outline"
                className="flex-none px-4"
                disabled={siteHeld || !!tx.busy || !!network || rules.marketPaused || frozen}
                title={frozen ? FIXPACK_COPY.frozenHelp : undefined}
                onClick={() => setListOpen(true)}
              >
                List card
              </Button>
            </div>
          )
        ) : listed && listing ? (
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <span className="mdx-micro block">Buy now</span>
              <Num size="lg" unit="SOL" className="mt-1 block">
                {sol(num(listing.price))}
              </Num>
            </div>
            <Button onClick={openBuy} disabled={siteHeld || !!tx.busy || rules.marketPaused}>
              {siteHeld ? "Card purchases paused" : viewer.connected ? "Buy card" : CHAIN_COPY.connectToBuy}
            </Button>
          </div>
        ) : (
          <p className="text-[13px] leading-[1.45] text-slate">
            {pauseReason === "pause" && listing
              ? resumeText(listing, now)
                ? FIXPACK_COPY.pausedForBuyers(resumeText(listing, now)!)
                : FIXPACK_COPY.pausedNoTime
              : pauseReason === "evolve-paused"
                ? "Buy now is paused while card unlocks are paused."
                : listing?.voided
                  ? "The listing was voided by an unlock."
                  : listing?.expired
                    ? "The listing expired."
                    : "Not listed."}
            {card.lastSalePrice !== "0" ? (
              <>
                {" "}
                Last sale <span className="num">{sol(num(card.lastSalePrice))}</span> SOL.
              </>
            ) : null}
          </p>
        )}
      </div>

      {listing && listing.voidOnEvolve && listing.protectionActive === false ? (
        <p role="status" className="mt-2 text-pretty text-[12px] leading-4 text-ink">
          {FIXPACK_COPY.protectionOff}. <span className="text-slate">{FIXPACK_COPY.protectionOffHelp}</span>
        </p>
      ) : null}
      {frozen ? (
        <p role="status" className="mt-2 text-pretty text-[12px] leading-4 text-slate">
          {FIXPACK_COPY.frozenHelp}
        </p>
      ) : null}

      {/* Bids */}
      <div className="mt-4 flex h-5 flex-none items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold leading-5 text-ink">
          Bids (<span className="num">{Math.max(bids.length, coin.bidCount)}</span>)
          {CARD_BIDDING_SUSPENDED ? <span className="ml-2 text-[11px] font-normal text-slate" title={CARD_BIDDING_NOTICE}>Suspended</span> : null}
        </h3>
        {more || phoneMore ? (
          <TextLink className={cx("text-[13px]", !more && "lg:hidden")} onClick={() => setAllOpen(true)}>
            View all
          </TextLink>
        ) : null}
      </div>
      <div
        ref={bidsRef}
        className="mt-1 h-[var(--bids-h)] flex-none overflow-hidden max-lg:h-[var(--bids-h-sm)] xl:h-auto xl:min-h-0 xl:flex-1"
        style={listBox}
      >
        {bids.length === 0 ? (
          <p className="py-1.5 text-[13px] leading-5 text-slate">{CARD_BIDDING_SUSPENDED ? "No open bids." : "No bids yet. Set the first price."}</p>
        ) : (
          <div className="mdx-stagger divide-y divide-rule max-lg:[&>:nth-child(n+4)]:hidden xl:flex xl:h-full xl:flex-col xl:flex-wrap xl:content-start xl:[&>*]:w-full xl:[&>*]:flex-none">
            {shown.map(bidLine)}
          </div>
        )}
      </div>

      {!isHolder && (
        <form onSubmit={doBid} noValidate className="@container flex flex-none flex-col pt-3 lg:mt-auto">
          {myBid > 0 && (
            <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="flex-none text-slate">Your bid</span>
                <span className="flex-none">
                  <span className="num text-[15px] text-ink">{sol(myBid)}</span> <span className="mdx-unit">SOL</span>
                </span>
                <span className={cx("truncate", myStanding === "top" ? "font-semibold text-ink" : "text-slate")}>
                  {myStanding === "top" ? "Top bid" : "Below the top bid"}
                </span>
              </span>
              <TextLink
                className="flex-none text-[13px]"
                disabled={siteHeld || !!tx.busy || !!network}
                onClick={() =>
                  void tx.run("cancel", (onStep) => cancelBid({ mint }, onStep), {
                    keys,
                    mints: [mint],
                    success: "Bid cancelled. Your SOL is back in your wallet.",
                  })
                }
              >
                {tx.pending("cancel") ? tx.label("cancel", "Cancelling...") : "Cancel bid"}
              </TextLink>
            </div>
          )}
          {/* The amount keeps room for a typed bid (128px at least); under 300px the button goes under it. */}
          <div className="mdx-pair flex gap-3 @max-[299px]:flex-col @max-[299px]:gap-2">
            <div className="min-w-[128px] flex-1">
              <Input
                ref={bidRef}
                id="bid-amt"
                disabled={siteHeld || CARD_BIDDING_SUSPENDED}
                aria-label="Bid amount in SOL"
                aria-invalid={hint?.tone === "error" || undefined}
                aria-describedby="bid-hint"
                numeric
                suffix="SOL"
                inputMode="decimal"
                enterKeyHint="go"
                autoComplete="off"
                value={bidInput}
                onChange={(e) => {
                  setBidInput(cleanAmount(e.target.value));
                  setBidTried(false);
                  tx.reset("bid");
                }}
                placeholder={sol(suggested)}
              />
            </div>
            <Button
              type="submit"
              variant={listed ? "outline" : "primary"}
              disabled={siteHeld || CARD_BIDDING_SUSPENDED || (viewer.connected && bidBlocked)}
              pending={tx.pending("bid")}
              pendingLabel={tx.label("bid")}
              feedback={tx.feedback("bid")}
              successLabel="Bid placed"
              onBlocked={() => {
                setBidTried(true);
                bidRef.current?.focus();
              }}
            >
              {CARD_BIDDING_SUSPENDED ? "Bidding suspended" : viewer.connected ? bidLabel : CHAIN_COPY.connectToBid}
            </Button>
          </div>
          {CARD_BIDDING_SUSPENDED || !hideNote || hint?.tone === "error" ? (
            <p
              ref={noteRef}
              id="bid-hint"
              role={hint?.tone === "error" ? "alert" : undefined}
              className={cx("pt-2 text-[12px] leading-[1.45]", hint?.tone === "error" ? "text-down" : "text-slate")}
            >
              {hint
                ? hint.node
                : tx.note("cancel") ??
                  [WORDS.ownThisCard(coin.ticker), WORDS.escrow, rules.maxBid != null ? SWITCH_COPY.bidCapNote(capSol(rules.maxBid)) : ""]
                    .filter(Boolean)
                    .join(" ")}
            </p>
          ) : null}
        </form>
      )}
      {isHolder && (!hideNote || tx.error("delist")) && (
        <p
          ref={noteRef}
          role={tx.error("delist") ? "alert" : undefined}
          className={cx("flex-none pt-3 text-[12px] leading-[1.45] lg:mt-auto", tx.error("delist") ? "text-down" : "text-slate")}
        >
          {tx.error("delist") ?? (network || WORDS.salesNote)}
        </p>
      )}

      <Modal open={allOpen} onOpenChange={setAllOpen} title={`Bids on ${coin.name}`}>
        <div className="mdx-stagger divide-y divide-rule">{bids.map(bidLine)}</div>
      </Modal>
      <FeesDialog
        open={feesOpen}
        onOpenChange={setFeesOpen}
        card={card}
        isHolder={isHolder}
        network={network}
        tx={tx}
        onWithdraw={async () => {
          const r = await tx.run("withdraw", (onStep) => withdrawFees({ mint }, onStep), {
            keys,
            mints: [mint],
            success: `Withdrew ${sol(num(fees.netToHolder), 4)} SOL of card fees.`,
          });
          if (r) setFeesOpen(false);
        }}
      />
      <ListDialog
        open={listOpen}
        onOpenChange={setListOpen}
        coinName={coin.name}
        listing={myListing ? listing : null}
        minPrice={rules.minBid}
        maxPrice={rules.maxListPrice}
        protocolBps={rules.protocolBps}
        feesToSeller={num(fees.netToHolder)}
        graduated={card.graduated}
        tx={tx}
        onList={async (input) => {
          const reprice = myListing;
          const r = await tx.run(
            "list",
            (onStep) =>
              listCard(
                { mint, priceLamports: BigInt(input.price), expiresAt: input.expiresAt, voidOnEvolve: input.voidOnEvolve },
                onStep,
              ),
            {
              keys,
              mints: [mint],
              success: reprice ? `Price changed to ${sol(input.price)} SOL.` : `Listed for ${sol(input.price)} SOL.`,
            },
          );
          if (r) setListOpen(false);
        }}
      />
      <ChainSaleReview
        review={review}
        pending={tx.pending("sale")}
        pendingLabel={tx.label("sale")}
        feedback={tx.feedback("sale")}
        error={tx.error("sale")}
        note={tx.note("sale")}
        onConfirm={() => void confirmReview()}
        onClose={() => {
          if (tx.pending("sale")) return;
          setReview(null);
          tx.reset("sale");
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------- fees (card-program-v2 §8, m3-contract §2.2)

function FeeRow({ label, v, sign, strong = false }: { label: ReactNode; v: number; sign?: "+" | "-"; strong?: boolean }) {
  return (
    <div className={cx("h-7 text-[14px] leading-7", strong && "font-semibold")}>
      <dt className={strong ? "text-ink" : "text-slate"}>{label}</dt>
      <dd>
        <Num size={strong ? "md" : "sm"} unit="SOL">
          {sign && v > 0 ? sign : ""}
          {sol(v, 6)}
        </Num>
      </dd>
    </div>
  );
}

/**
 * The card fees, leg by leg (the vault, the curve's creator vault, PumpSwap's, wrapped SOL), and Withdraw. Anyone but
 * the holder sees what is ready for the holder and what was paid out, with the legs behind "Show the breakdown".
 */
function FeesDialog({
  open,
  onOpenChange,
  card,
  isHolder,
  network,
  tx,
  onWithdraw,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  card: ApiCardState;
  isHolder: boolean;
  network: string | null;
  tx: ReturnType<typeof useTx>;
  onWithdraw: () => void;
}) {
  const siteHeld = useSiteTransactionHold();
  const f = card.fees;
  const total = num(f.total);
  const topUp = num(f.topUp);
  const message = siteHeld ? SITE_TRANSACTION_HOLD_NOTICE : tx.error("withdraw") ?? tx.note("withdraw") ?? (isHolder ? network : null);
  // Where the card fees wait, leg by leg.
  const sources = (
    <dl className="mdx-leaders mt-3">
      <FeeRow label="In the card's fee vault" v={num(f.vaultAvailable)} />
      <FeeRow label="Waiting on the pump.fun curve" v={num(f.curveLeg)} />
      <FeeRow label="Waiting on PumpSwap" v={num(f.ammLeg)} />
      <FeeRow label="Wrapped SOL" v={num(f.wsolLeg)} />
      {topUp > 0 ? <FeeRow label="One-time vault top-up" v={topUp} sign="-" /> : null}
    </dl>
  );
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o && tx.pending("withdraw")) return;
        onOpenChange(o);
        if (!o) tx.reset("withdraw");
      }}
      title="Card fees"
    >
      <p className="text-[13px] leading-[1.45] text-slate">
        Every trade of this coin pays the card. {siteHeld ? "Withdrawals are paused until funding is ready." : "The holder withdraws it any time."}
      </p>
      {isHolder ? (
        <>
          {sources}
          <dl className="mdx-leaders mt-2 border-t border-hairline pt-2">
            <FeeRow label="You receive" v={num(f.netToHolder)} strong />
          </dl>
          <p className="mt-3 text-pretty text-[13px] leading-[1.45] text-slate">
            {topUp > 0
              ? `The first withdrawal pays a one-time ${sol(topUp, 5)} SOL top-up that keeps the vault open. `
              : null}
            Paid out so far: <span className="num text-ink">{sol(num(card.feesPaidOut), 4)}</span> SOL. Network fee not
            included.
          </p>
        </>
      ) : (
        // Someone who cannot withdraw sees two figures; where the fees wait is one tap away.
        <>
          <dl className="mdx-leaders mt-3">
            <FeeRow label={COIN_COPY.readyForHolder} v={num(f.netToHolder)} strong />
            <FeeRow label={COIN_COPY.paidOut} v={num(card.feesPaidOut)} />
          </dl>
          <details className="group mt-2">
            <summary className="mdx-hit inline-flex h-8 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink [&::-webkit-details-marker]:hidden">
              {COIN_COPY.feeBreakdown}
              <DisclosureChevron />
            </summary>
            {sources}
          </details>
        </>
      )}
      <p role={siteHeld ? "status" : "alert"} className={cx("text-[13px] leading-[1.45]", siteHeld ? "text-slate" : "text-down", message ? "mt-3" : "sr-only")}>
        {message}
      </p>
      <div className="mdx-sheet-foot mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={tx.pending("withdraw")}>
          Close
        </Button>
        {isHolder ? (
          <Button
            disabled={siteHeld || total <= 0 || !!network || (!!tx.busy && !tx.pending("withdraw"))}
            pending={tx.pending("withdraw")}
            pendingLabel={tx.label("withdraw", "Withdrawing...")}
            feedback={tx.feedback("withdraw")}
            successLabel="Withdrawn"
            onClick={onWithdraw}
          >
            Withdraw {sol(num(f.netToHolder), 4)} SOL
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- list and re-price (card-program-v2 §7.6)

const EXPIRY = [
  { value: 0, label: "Never" },
  { value: 86_400, label: "1 day" },
  { value: 3 * 86_400, label: "3 days" },
  { value: 7 * 86_400, label: "7 days" },
  { value: 30 * 86_400, label: "30 days" },
] as const;

function ListDialog({
  open,
  onOpenChange,
  coinName,
  listing,
  minPrice,
  maxPrice = null,
  protocolBps,
  feesToSeller,
  graduated = false,
  tx,
  onList,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  coinName: string;
  /** The viewer's own listing when re-pricing. */
  listing: ApiListing | null;
  minPrice: number;
  /** The Worker's listing cap while it is on (launch-plan §4.5), else null. */
  maxPrice?: number | null;
  protocolBps: number;
  feesToSeller: number;
  /** The coin trades on PumpSwap (F7 note). */
  graduated?: boolean;
  tx: ReturnType<typeof useTx>;
  onList: (input: { price: number; expiresAt: number; voidOnEvolve: boolean }) => void;
}) {
  const siteHeld = useSiteTransactionHold();
  const [price, setPrice] = useState("");
  const [expiry, setExpiry] = useState<number>(7 * 86_400);
  const [voidOnEvolve, setVoidOnEvolve] = useState(true);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPrice(listing ? String(num(listing.price) / 1e9) : "");
    setVoidOnEvolve(listing ? listing.voidOnEvolve : true);
    setExpiry(listing ? (listing.expiresAt ? 7 * 86_400 : 0) : 7 * 86_400);
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const lamports = price ? parseSol(price) : NaN;
  const over = Number.isFinite(lamports) && maxPrice != null && lamports > maxPrice;
  const valid = Number.isFinite(lamports) && lamports >= minPrice && !over;
  const error =
    tx.error("list") ??
    (over
      ? SWITCH_COPY.capError(capSol(maxPrice!))
      : tried && !Number.isFinite(lamports)
        ? "Enter a price in SOL, like 0.25."
        : tried && !valid
          ? `Listings start at ${sol(minPrice, 2)} SOL.`
          : null);
  const note = tx.note("list");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (siteHeld) return;
    if (!valid) {
      setTried(true);
      return;
    }
    const expiresAt = expiry ? Math.floor(Date.now() / 1000) + expiry : 0;
    onList({ price: lamports, expiresAt, voidOnEvolve });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o && tx.pending("list")) return;
        onOpenChange(o);
        if (!o) tx.reset("list");
      }}
      title={listing ? `Change the ${coinName} price` : `List the ${coinName} card`}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Buy now price" htmlFor="list-price" error={error}>
          <Input
            id="list-price"
            numeric
            suffix="SOL"
            inputMode="decimal"
            autoComplete="off"
            value={price}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "list-price-help" : undefined}
            onChange={(e) => {
              setPrice(cleanAmount(e.target.value));
              setTried(false);
              tx.reset("list");
            }}
            placeholder={sol(minPrice, 2)}
          />
        </Field>
        <Field label="Listing ends" htmlFor="list-expiry">
          <select
            id="list-expiry"
            className="mdx-input"
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
          >
            {EXPIRY.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-[1.45] text-ink">
          <input
            type="checkbox"
            checked={voidOnEvolve}
            onChange={(e) => setVoidOnEvolve(e.target.checked)}
            className="mt-1 h-4 w-4 flex-none accent-[var(--color-ink)]"
          />
          <span>
            {FIXPACK_COPY.pauseLabel}
            <span className="block text-[13px] text-slate">{FIXPACK_COPY.pauseHelp}</span>
          </span>
        </label>
        <p className="text-pretty text-[13px] leading-[1.45] text-slate">
          The card waits in escrow while listed. A sale pays you the price after the {pct(protocolBps)} protocol fee and
          the resale royalty, plus the card fees (now <span className="num text-ink">{sol(feesToSeller, 4)}</span> SOL).
          {maxPrice != null ? ` ${SWITCH_COPY.listCapNote(capSol(maxPrice))}` : null}
        </p>
        {graduated ? <p className="text-pretty text-[13px] leading-[1.45] text-slate">{FIXPACK_COPY.graduatedFees}</p> : null}
        {note ? (
          <p role="status" className="text-[13px] font-medium leading-[1.45] text-ink">
            {note}
          </p>
        ) : null}
        <div className="mdx-sheet-foot mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={tx.pending("list")}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={siteHeld || !valid || (!!tx.busy && !tx.pending("list"))}
            onBlocked={() => setTried(true)}
            pending={tx.pending("list")}
            pendingLabel={tx.label("list", "Listing...")}
            feedback={tx.feedback("list")}
            successLabel="Listed"
          >
            {listing ? "Change price" : valid ? `List for ${sol(lamports)} SOL` : "List card"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The chevron of a disclosure summary (inside a `group` details); it turns when the disclosure opens. */
export function DisclosureChevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className="flex-none transition-transform duration-(--t-fast) ease-room group-open:rotate-180"
    >
      <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A Solana Explorer row for a card (the card NFT mint), shown only when the card mint is the program's PDA. */
export function CardExplorerLinks({ card, mint, className = "" }: { card: ApiCardState; mint: string; className?: string }) {
  return (
    <span className={cx("flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] leading-5", className)}>
      <ExplorerLink id={mint}>{CHAIN_COPY.explorerCoin}</ExplorerLink>
      {card.cardMintVerified ? <ExplorerLink id={card.cardMint}>{CHAIN_COPY.explorerCard}</ExplorerLink> : null}
    </span>
  );
}
