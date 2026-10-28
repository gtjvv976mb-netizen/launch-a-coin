/**
 * Portfolio on devnet (refs/chain/m3-contract.md §2.2 Portfolio): the connected wallet's binder from
 * GET /wallets/:address (browser only, every 20 s while visible, every 5 s after the viewer's own transaction).
 * Coins held, cards held or listed (each opens its market sheet: card fees with their breakdown and Withdraw,
 * list, re-price, delist, accept), bids placed (raise, cancel) and offers on the viewer's cards (accept at the
 * amount shown, with the seller fee floor handled by the client flow). The test-mode Portfolio's layout: the
 * 56px header, the stats row, the section tabs and pager, fitted ledgers and the card shelf.
 *
 * Owner: app:pages. No wallet, no data: the page asks to connect; SSR renders the loading frame (the wallet is a
 * browser thing, m3-contract §3.3).
 */
import type { ApiBid, ApiCoinSummary, ApiWallet, ApiWalletCard, ApiWalletCoin } from "@mintdex/chain-sdk/api";
import { Link, getRouteApi } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { num, shortAddress, toBid, toCoinSummary, walletName } from "../../../lib/chain/adapt";
import { acceptBid, cancelBid } from "../../../lib/chain/client";
import { useChainConfig, useChainWallet } from "../../../lib/chain/data";
import { CHAIN_COPY, DEVNET_FAUCETS, MODE_COPY, PORTFOLIO_COPY } from "../../../lib/mintdex/copy";
import { atName, timeAgo, tokens } from "../../../lib/mintdex/format";
import type { CoinSummary } from "../../../lib/mintdex/types";
import { useNow } from "../../mintdex/hooks";
import { MintCard } from "../../mintdex/MintCard";
import {
  Button,
  ButtonLink,
  EmptyState,
  GridCaption,
  LabelNum,
  Num,
  PageFrame,
  PageHeader,
  Pager,
  Shelf,
  ShelfItem,
  Skeleton,
  Tabs,
  TextLink,
  Thumb,
  TierTag,
  fitCardGrid,
  prefersReducedMotion,
  solFigure,
  usePageKeys,
  useSize,
} from "../../mintdex/ui";
import { NetworkNotice } from "../NetworkNotice";
import { marketRules } from "./ChainCardPanel";
import { SheetLink } from "./ChainMarket";
import { ChainSaleReview, type ChainReview } from "./ChainSaleReview";
import { ConnectButton, signBlocker, useTx, useViewer } from "./tx";
import { View3DHost } from "../../mintdex/card3d";
import { NET_NAME, NET_SHORT } from "../../../lib/chain/env";
import { IS_DEVNET } from "../../../lib/mintdex/mode";

const routeApi = /* @__PURE__ */ getRouteApi("/portfolio");
const rootApi = /* @__PURE__ */ getRouteApi("__root__");

/**
 * True on the devnet test site, whose banner already says devnet SOL has no real value (__root.tsx, site-host.ts).
 * One such line per screen: the page adds its own only where the banner is missing (mintdex.fun before the cutover).
 */
function useDevnetBanner(): boolean {
  return rootApi.useLoaderData({ select: (d) => d.devnetSite });
}

type View = "holdings" | "deeds" | "bids" | "offers";
const TAB_VIEW = { coins: "holdings", cards: "deeds", bids: "bids", offers: "offers" } as const;
const VIEW_TAB = { holdings: "coins", deeds: "cards", bids: "bids", offers: "offers" } as const;

const ROW_H = 56;
const HEAD_H = 32;
const BLOCK_PAD_Y = 16;
const MOBILE_ROWS = 8;
const MOBILE_CARDS = 6;
const CARD_FIT = { strip: 56, gap: 20, minW: 140, maxW: 240 };
const PAD_X = "px-4 lg:px-5 short:px-4";
const COIN_COLS = "lg:grid-cols-[minmax(0,1.6fr)_1fr_1fr]";
const BID_COLS = "lg:grid-cols-[minmax(0,1fr)_112px_128px_196px]";
const OFFER_COLS = "lg:grid-cols-[minmax(0,1fr)_128px_112px]";

const DESKTOP_MQ = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_MQ);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_MQ).matches,
    () => true,
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- pieces

function Sol({ v }: { v: number }) {
  return (
    <span className="num whitespace-nowrap text-[15px] text-ink">
      {solFigure(v)}
      <span className="mdx-unit"> SOL</span>
    </span>
  );
}

function Ledger({ head, children }: { head?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-panel bg-plinth py-2 shadow-ring">
      {head}
      <div className="mdx-stagger">{children}</div>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="rounded-panel bg-plinth py-2 shadow-ring" aria-busy="true" aria-label="Loading your portfolio">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={PAD_X}>
          <div className="flex h-14 items-center gap-3">
            <Skeleton className="h-10 w-10 flex-none" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-32 rounded-pill" />
              <Skeleton className="h-2.5 w-16 rounded-pill" />
            </div>
            <Skeleton className="h-3 w-20 rounded-pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:flex lg:gap-5" aria-busy="true" aria-label="Loading your cards">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} onWall className="w-full rounded-[5.04%/3.61%] lg:w-[160px]" style={{ aspectRatio: "63 / 88" }} />
      ))}
    </div>
  );
}

/** Thumb + "{Name} card" over one slate meta line; opens the card's market sheet (a modified click opens the coin). */
function CardCell({ coin, meta }: { coin: CoinSummary; meta: string }) {
  return (
    <SheetLink coin={coin} className="group flex min-w-0 flex-1 items-center gap-3">
      <Thumb src={coin.image} size={40} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-[1.25] text-ink underline-offset-4 decoration-1 group-hover:underline">
          {coin.name} card
        </span>
        <span className="block truncate text-[12px] leading-[1.3] text-slate" suppressHydrationWarning>
          {meta}
        </span>
      </span>
    </SheetLink>
  );
}

function Standing({ leading, top, className = "" }: { leading: boolean; top: number | null; className?: string }) {
  return leading ? (
    <span className={`whitespace-nowrap text-[13px] font-semibold text-up ${className}`}>Top bid</span>
  ) : (
    <span className={`whitespace-nowrap text-[13px] text-slate ${className}`}>
      Top <span className="num">{solFigure(top ?? 0)}</span>
    </span>
  );
}

// ---------------------------------------------------------------- sections

function CoinLedger({ rows }: { rows: ApiWalletCoin[] }) {
  return (
    <Ledger
      head={
        <div className={`hidden lg:block ${PAD_X}`}>
          <div className={`mdx-micro grid h-8 items-center gap-x-6 border-b border-hairline ${COIN_COLS}`}>
            <span>Coin</span>
            <span className="text-right">Held</span>
            <span className="text-right">Value</span>
          </div>
        </div>
      }
    >
      {rows.map((c) => {
        const amount = num(c.amount);
        return (
          <Link
            key={c.mint}
            to="/coin/$id"
            params={{ id: c.mint }}
            className={`group/coin block transition-colors duration-(--t-fast) ease-room hover:bg-tint focus-visible:outline-offset-[-2px] ${PAD_X}`}
          >
            <div className={`flex h-14 items-center gap-3 border-b border-rule group-last/coin:border-b-0 lg:grid lg:gap-x-6 ${COIN_COLS}`}>
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <Thumb src={c.image?.url ?? ""} size={40} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold leading-[1.25] text-ink">{c.name}</span>
                  <span className="block truncate text-[12px] leading-[1.3] text-slate">
                    <span className="num text-ink lg:hidden">{tokens(amount)} </span>
                    {`$${c.symbol}`}
                  </span>
                </span>
              </span>
              <span className="num hidden text-right text-[15px] text-ink lg:block">{tokens(amount)}</span>
              <span className="flex flex-none flex-col items-end lg:block lg:text-right">
                <Sol v={num(c.valueLamports)} />
              </span>
            </div>
          </Link>
        );
      })}
    </Ledger>
  );
}

type CardRow = { card: ApiWalletCard; coin: CoinSummary; listPrice: number | null; listNote: string | null };

function CardShelf({ items, cols, cardW, gap }: { items: CardRow[]; cols: number; cardW?: number; gap: number }) {
  return (
    <Shelf
      items={items}
      cols={cols}
      cardW={cardW}
      gap={gap}
      rowGap={20}
      keyOf={(d) => d.coin.id}
      // Your cards with card fees waiting to be withdrawn catch the passing light three times as often (L4).
      glintOf={(d) => (num(d.card.withdrawable) > 0 ? 3 : 1)}
      parallax
      seedOf={(d) => d.coin.dexNo}
      render={({ card, coin, listPrice, listNote }, w) => (
        <View3DHost item={{ id: coin.id, card: coin }}>
        <SheetLink coin={coin} className="block" label={`${coin.name} card, ${solFigure(num(card.withdrawable))} SOL of card fees to withdraw`}>
          <ShelfItem
            card={<MintCard card={coin} compact={w < 210} />}
            caption={
              <GridCaption
                name={coin.name}
                value={
                  <>
                    <span className="mdx-unit">Fees</span> {solFigure(num(card.withdrawable))}
                  </>
                }
                sub={
                  listPrice != null ? (
                    <LabelNum label="Listed" value={solFigure(listPrice)} />
                  ) : listNote ? (
                    <span className="text-slate">{listNote}</span>
                  ) : coin.topBid != null ? (
                    <LabelNum label="Top bid" value={solFigure(coin.topBid)} />
                  ) : (
                    <span className="text-slate">No bids</span>
                  )
                }
                subRight={<TierTag level={coin.level} miniOnly />}
              />
            }
          />
        </SheetLink>
        </View3DHost>
      )}
    />
  );
}

type BidItem = { bid: ApiBid; raw: ApiCoinSummary; coin: CoinSummary };

function BidLedger({ rows, now, tx, blocked }: { rows: BidItem[]; now: number; tx: ReturnType<typeof useTx>; blocked: boolean }) {
  return (
    <Ledger>
      {rows.map(({ bid, coin }) => {
        const amount = num(bid.amount);
        const leading = coin.topBid != null && amount >= coin.topBid;
        const key = `cancel:${coin.id}`;
        return (
          <div key={bid.mint} className={`group/row ${PAD_X}`}>
            <div className={`flex h-14 items-center gap-3 border-b border-rule group-last/row:border-b-0 lg:grid lg:gap-x-6 ${BID_COLS}`}>
              <CardCell coin={coin} meta={`Holder ${atName(coin.ownerHandle)}, ${timeAgo((bid.updatedAt || bid.createdAt) * 1000, now)}`} />
              <span className="hidden text-right lg:block">
                <Standing leading={leading} top={coin.topBid} />
              </span>
              <span className="flex flex-none flex-col items-end lg:block lg:text-right">
                <Sol v={amount} />
                <Standing leading={leading} top={coin.topBid} className="lg:hidden" />
              </span>
              <span className="flex flex-none items-center justify-end gap-2">
                <SheetLink coin={coin} className="mdx-link mdx-hit hidden text-[13px] lg:inline">
                  Raise
                </SheetLink>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={blocked || (!!tx.busy && !tx.pending(key))}
                  pending={tx.pending(key)}
                  pendingLabel={tx.label(key, "Cancelling...")}
                  onClick={() =>
                    void tx.run(key, (onStep) => cancelBid({ mint: coin.id }, onStep), {
                      keys: [["coin", coin.id], ["market"]],
                      mints: [coin.id],
                      success: "Bid cancelled. Your SOL is back in your wallet.",
                    })
                  }
                >
                  Cancel bid
                </Button>
              </span>
            </div>
          </div>
        );
      })}
    </Ledger>
  );
}

function OfferLedger({
  rows,
  now,
  onAccept,
  blocked,
}: {
  rows: BidItem[];
  now: number;
  onAccept: (offer: BidItem) => void;
  blocked: boolean;
}) {
  return (
    <Ledger>
      {rows.map((o) => {
        const { bid, coin } = o;
        const b = toBid(bid);
        return (
          <div key={`${bid.mint}:${bid.bidder}`} className={`group/row ${PAD_X}`}>
            <div className={`flex h-14 items-center gap-3 border-b border-rule group-last/row:border-b-0 lg:grid lg:gap-x-6 ${OFFER_COLS}`}>
              <CardCell coin={coin} meta={`From ${atName(b.handle)}, ${timeAgo(b.createdAt, now)}`} />
              <span className="flex-none text-right">
                <Sol v={b.amount} />
              </span>
              <span className="flex flex-none justify-end">
                <Button
                  size="sm"
                  aria-label={`Accept the ${solFigure(b.amount)} SOL bid from ${atName(b.handle)} on the ${coin.name} card`}
                  title={bid.acceptable ? undefined : "This bid cannot be accepted right now."}
                  disabled={blocked || !bid.acceptable}
                  onClick={() => onAccept(o)}
                >
                  Accept
                </Button>
              </span>
            </div>
          </div>
        );
      })}
    </Ledger>
  );
}

// ---------------------------------------------------------------- views

function Frame({ title, context, right, children }: { title: ReactNode; context: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <PageFrame className="mdx-page">
      <PageHeader title={title} context={context} right={right} />
      {children}
    </PageFrame>
  );
}

/**
 * No wallet: one invitation. What the page shows, one Connect action, and a way to look around without a wallet.
 * The header has no context line (the invitation says it); it top-aligns, 5px down, so the h1 sits on the same line
 * as on pages whose header carries a context line (PageHeader bottom-aligns a 57px title block in its 56px row).
 * Phones on a site without the devnet banner (and without the desktop rail's note) get the one "no real value" line.
 */
function SignedOut() {
  const banner = useDevnetBanner();
  return (
    <PageFrame className="mdx-page">
      <PageHeader title="Portfolio" className="lg:items-start lg:pt-[5px]" />
      <div className="-mb-[calc(80px_+_env(safe-area-inset-bottom))] flex flex-1 flex-col pb-[calc(80px_+_env(safe-area-inset-bottom))] lg:mb-[calc(var(--main-pad)*-1)] lg:pb-[var(--main-pad)]">
        <EmptyState
          className="flex-1"
          hero
          title={PORTFOLIO_COPY.signedOutTitle}
          body={PORTFOLIO_COPY.signedOutBody}
          action={
            <div className="flex flex-col items-center gap-3">
              <ConnectButton />
              <TextLink to="/discover" className="text-[14px]">
                {PORTFOLIO_COPY.explore}
              </TextLink>
              {IS_DEVNET && !banner ? (
                <p className="text-[12px] leading-[1.3] text-slate lg:hidden">{CHAIN_COPY.noValue}</p>
              ) : null}
            </div>
          }
        />
      </div>
    </PageFrame>
  );
}

/**
 * One empty section: what goes here, then its one next action. Desktop: the card back on its ledge. Phones: a
 * compact panel in the ledger's place, so the action sits above the tab bar instead of under it.
 */
function Empty({ desktop, title, body, action }: { desktop: boolean; title: ReactNode; body: ReactNode; action?: ReactNode }) {
  if (desktop) return <EmptyState title={title} body={body} action={action} />;
  return (
    <div className="rounded-panel bg-plinth px-5 py-6 text-center shadow-ring">
      <p className="text-[17px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[360px] text-pretty text-[13px] leading-[1.45] text-slate">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function Loading() {
  return (
    <Frame title="Portfolio" context={MODE_COPY.walletContext}>
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-3 lg:flex lg:h-[52px] lg:gap-10" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-panel lg:w-28" />
          ))}
        </div>
        <LedgerSkeleton />
      </div>
    </Frame>
  );
}

/** The faucet link in the header: devnet SOL is free from a public faucet (no in-app faucet). None on mainnet. */
function FaucetLink() {
  const f = DEVNET_FAUCETS[0];
  if (!IS_DEVNET || !f) return null;
  return (
    <TextLink href={f.href} target="_blank" className="text-[14px]">
      Get devnet SOL
    </TextLink>
  );
}

export function ChainPortfolio() {
  const viewer = useViewer();
  // The wallet host loads after hydration; give it a moment before saying no wallet is connected.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(t);
  }, []);
  if (viewer.connected && viewer.address) return <Binder address={viewer.address} />;
  if ((!viewer.ready && !waited) || viewer.connecting) return <Loading />;
  return <SignedOut />;
}

function Binder({ address }: { address: string }) {
  const viewer = useViewer();
  const { wallet, error } = useChainWallet(address);
  const rules = marketRules(useChainConfig());
  const tx = useTx();
  const now = useNow();
  const desktop = useIsDesktop();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const view: View = TAB_VIEW[search.tab ?? "coins"];
  const page = (search.page ?? 1) - 1;
  const setPage = (p: number) =>
    void navigate({ search: (s) => ({ ...s, page: p > 0 ? p + 1 : undefined }), replace: true, resetScroll: false });
  const setView = (v: View) =>
    void navigate({
      search: { tab: v === "holdings" ? undefined : VIEW_TAB[v], page: undefined },
      replace: true,
      resetScroll: false,
    });
  const [review, setReview] = useState<ChainReview | null>(null);
  const [bodyRef, body] = useSize<HTMLDivElement>({ width: 1000, height: 492 });
  const tabsRef = useRef<HTMLDivElement>(null);
  const banner = useDevnetBanner();
  const blocked = !!signBlocker(viewer);
  // Phones page from under the list: bring the tabs and the first row of the new page back into view.
  const goPhone = (p: number) => {
    setPage(p);
    const el = tabsRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  };

  const data = useMemo(() => (wallet ? shape(wallet) : null), [wallet]);

  function openAccept({ bid, raw, coin }: BidItem) {
    setReview({
      kind: "accept",
      coin: { mint: coin.id, name: coin.name, ticker: coin.ticker },
      bid: { bidder: bid.bidder, amount: num(bid.amount), handle: atName(walletName(bid.bidderHandle, bid.bidder)) },
      launcherIsSeller: raw.launcher === address,
      feesToSeller: num(raw.withdrawableLamports),
      protocolBps: rules.protocolBps,
      royaltyBps: rules.royaltyBps,
    });
  }

  async function confirmAccept() {
    if (review?.kind !== "accept") return;
    const r = await tx.run(
      "sale",
      (onStep) => acceptBid({ mint: review.coin.mint, bidder: review.bid.bidder, minAmountLamports: BigInt(review.bid.amount) }, onStep),
      {
        keys: [["coin", review.coin.mint], ["market"]],
        mints: [review.coin.mint],
        success: `Sold to ${review.bid.handle}. The card and its future card fees are theirs.`,
      },
    );
    if (r) setReview(null);
  }

  const totals = wallet?.totals;
  const list: unknown[] = data ? data[view] : [];
  const fit = fitCardGrid(body.width, body.height, CARD_FIT, data?.deeds.length ?? 0);
  const perPage =
    view === "deeds"
      ? desktop
        ? fit.count
        : MOBILE_CARDS
      : desktop
        ? Math.max(1, Math.floor((body.height - BLOCK_PAD_Y - (view === "holdings" ? HEAD_H : 0)) / ROW_H))
        : MOBILE_ROWS;
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const cur = Math.min(page, pages - 1);
  const from = cur * perPage;
  usePageKeys(cur, pages, desktop ? setPage : goPhone);

  // What this wallet has on MintDex. Its SOL balance is not repeated here: the rail (phones: the header) shows it.
  const stats = [
    { label: "Coins value", value: solFigure(num(totals?.holdingsValueLamports)), watch: totals ? num(totals.holdingsValueLamports) : undefined },
    {
      label: "Card fees to withdraw",
      value: solFigure(num(totals?.withdrawableLamports)),
      watch: totals ? num(totals.withdrawableLamports) : undefined,
    },
    { label: "In bid escrow", value: solFigure(num(totals?.escrowedLamports)), watch: totals ? num(totals.escrowedLamports) : undefined },
  ];

  let content: ReactNode;
  if (!data) {
    content = error ? (
      <Empty
        desktop={desktop}
        title={`${NET_SHORT} did not answer`}
        body={`Your wallet could not be read from ${NET_NAME} right now. It retries on its own.`}
      />
    ) : view === "deeds" ? (
      <CardsSkeleton />
    ) : (
      <LedgerSkeleton />
    );
  } else if (view === "holdings") {
    // Each empty section: what goes here, then one next action.
    content = data.holdings.length ? (
      <CoinLedger rows={data.holdings.slice(from, from + perPage)} />
    ) : (
      <Empty
        desktop={desktop}
        title={PORTFOLIO_COPY.noCoinsTitle}
        body={PORTFOLIO_COPY.noCoinsBody}
        action={<ButtonLink to="/discover">{PORTFOLIO_COPY.explore}</ButtonLink>}
      />
    );
  } else if (view === "deeds") {
    content = data.deeds.length ? (
      <CardShelf
        items={data.deeds.slice(from, from + perPage)}
        cols={desktop ? fit.cols : 2}
        cardW={desktop ? fit.cardW : undefined}
        gap={desktop ? 20 : 12}
      />
    ) : (
      <Empty
        desktop={desktop}
        title={PORTFOLIO_COPY.noCardsTitle}
        body={PORTFOLIO_COPY.noCardsBody}
        action={<ButtonLink to="/launch">{PORTFOLIO_COPY.launch}</ButtonLink>}
      />
    );
  } else if (view === "bids") {
    content = data.bids.length ? (
      <BidLedger rows={data.bids.slice(from, from + perPage)} now={now} tx={tx} blocked={blocked} />
    ) : (
      <Empty
        desktop={desktop}
        title={PORTFOLIO_COPY.noBidsTitle}
        body={PORTFOLIO_COPY.noBidsBody}
        action={
          <ButtonLink to="/market">
            {PORTFOLIO_COPY.toMarket}
          </ButtonLink>
        }
      />
    );
  } else {
    content = data.offers.length ? (
      <OfferLedger rows={data.offers.slice(from, from + perPage)} now={now} onAccept={openAccept} blocked={blocked || !!tx.busy} />
    ) : data.deeds.length ? (
      <Empty
        desktop={desktop}
        title={PORTFOLIO_COPY.noOffersTitle}
        body={PORTFOLIO_COPY.noOffersBody}
        action={<Button onClick={() => setView("deeds")}>{PORTFOLIO_COPY.seeCards}</Button>}
      />
    ) : (
      <Empty
        desktop={desktop}
        title={PORTFOLIO_COPY.noOffersTitle}
        body={PORTFOLIO_COPY.noOffersNoCards}
        action={<ButtonLink to="/launch">{PORTFOLIO_COPY.launch}</ButtonLink>}
      />
    );
  }

  const title = viewer.handle ? `@${viewer.handle}` : shortAddress(address);
  // One "no real value" line per screen: the devnet test site's banner already carries it; mainnet always says
  // real SOL. A wallet on the wrong network gets the notice under the header (what to switch, and how).
  const context = IS_DEVNET && banner ? MODE_COPY.walletContext : `${MODE_COPY.walletContext}. ${CHAIN_COPY.noValue}`;

  return (
    <PageFrame className="mdx-page">
      <PageHeader title={title} context={context} right={<FaucetLink />} />
      <NetworkNotice className="flex-none" />

      {/* Phones: the three figures share one row; a label may take two lines, the figures stay on one baseline. */}
      <dl className="grid flex-none grid-cols-3 gap-3 lg:flex lg:h-[52px] lg:items-center lg:gap-10">
        {stats.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col justify-between lg:block">
            <dt className="mdx-micro lg:truncate">{s.label}</dt>
            <dd className="mt-1">
              <Num size={desktop ? "lg" : "md"} unit="SOL" watch={s.watch}>
                {s.value}
              </Num>
            </dd>
          </div>
        ))}
      </dl>

      {/* Phones: the four tabs share the row (shorter "Bids"); the counts stay in every tab's name. */}
      <div ref={tabsRef} className="flex h-10 flex-none scroll-mt-[72px] items-center justify-between gap-6 max-lg:h-11">
        <Tabs
          label="Portfolio sections"
          className={cx("min-w-0", !desktop && "mdx-tabs--fill")}
          value={view}
          onChange={(v) => setView(v)}
          options={[
            { value: "holdings", label: PORTFOLIO_COPY.tabCoins, count: data?.holdings.length },
            { value: "deeds", label: PORTFOLIO_COPY.tabCards, count: data?.deeds.length },
            { value: "bids", label: desktop ? PORTFOLIO_COPY.tabBids : PORTFOLIO_COPY.tabBidsShort, count: data?.bids.length },
            { value: "offers", label: PORTFOLIO_COPY.tabOffers, count: data?.offers.length },
          ]}
        />
        <div className="hidden lg:block">
          <Pager page={cur} pages={pages} onPage={setPage} />
        </div>
      </div>

      <div ref={bodyRef} className={cx("min-h-0 flex-1 lg:min-h-[240px]")}>
        {content}
      </div>

      {pages > 1 ? (
        <div className="flex justify-center lg:hidden">
          <Pager page={cur} pages={pages} onPage={goPhone} />
        </div>
      ) : null}
      <ChainSaleReview
        review={review}
        pending={tx.pending("sale")}
        pendingLabel={tx.label("sale")}
        feedback={tx.feedback("sale")}
        error={tx.error("sale")}
        note={tx.note("sale")}
        onConfirm={() => void confirmAccept()}
        onClose={() => {
          if (tx.pending("sale")) return;
          setReview(null);
          tx.reset("sale");
        }}
      />
    </PageFrame>
  );
}

/** The wallet read in the page's lists: coins by value, cards (with their listing state), bids and offers. */
function shape(w: ApiWallet) {
  const listings = new Map(w.listings.map((l) => [l.mint, l]));
  const deeds: CardRow[] = w.cards
    .map((card) => {
      const l = listings.get(card.coin.mint) ?? card.coin.listing;
      const live = !!l && card.listed && l.buyable && !l.voided && !l.expired;
      return {
        card,
        coin: toCoinSummary(card.coin),
        listPrice: live && l ? num(l.price) : null,
        listNote: card.listed && l && !live ? (l.voided ? "Listing voided" : "Listing expired") : null,
      };
    })
    .sort((a, b) => a.coin.mcapUsd == null ? b.coin.mcapUsd == null ? 0 : 1 : b.coin.mcapUsd == null ? -1 : b.coin.mcapUsd - a.coin.mcapUsd);
  const item = (x: { bid: ApiBid; coin: ApiCoinSummary }): BidItem => ({ bid: x.bid, raw: x.coin, coin: toCoinSummary(x.coin) });
  return {
    holdings: [...w.coins].sort((a, b) => num(b.valueLamports) - num(a.valueLamports)),
    deeds,
    bids: w.bids.map(item),
    offers: w.offers.map(item).sort((a, b) => num(b.bid.amount) - num(a.bid.amount)),
  };
}
