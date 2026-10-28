/**
 * The devnet coin page (refs/chain/m3-contract.md §2.2 Coin): chain price, market cap and chart from the read
 * API, the trade ticket (curve or PumpSwap), the card panel, the real mint address with Solana Explorer links,
 * and "Your card is live" for the launcher after a launch. The layout is the test-mode coin page's own grid
 * (routes/coin/$id.tsx CoinView), with the same header, chart and trades blocks (components/mintdex/coin.tsx),
 * so devnet and test mode look the same at every width (1280x720 never scrolls; phones use the section tabs).
 *
 * Owner: app:pages. Data: lib/chain/data.ts (SSR loader, then a /rev poll every 20 s, every 5 s for 2 minutes
 * after the viewer's own transaction or while an unlock is pending).
 */
import { API_LIMITS } from "@mintdex/chain-sdk/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { big, chartStart, num } from "../../../lib/chain/adapt";
import {
  boostedPollMs,
  chainCoinPage,
  takeFresh,
  useChainWallet,
  type ChainCoinPage,
  type ChainCoinRoute,
} from "../../../lib/chain/data";
import { COIN_COPY, COIN_NOT_FOUND, FIXPACK_COPY, MODE_COPY } from "../../../lib/mintdex/copy";
import { priceText, sol } from "../../../lib/mintdex/format";
import { marketCapText, marketCapWatch } from "../../../lib/carddex/quote-display";
import type { CoinDetail } from "../../../lib/mintdex/types";
import {
  COIN_CARD_SIZES,
  CaptionTop,
  CoinCase,
  CoinHeader,
  CoinObject,
  DesignProgress,
  McapChart,
  PhoneHeroDesign,
  TradesList,
} from "../../mintdex/coin";
import { revPoll } from "../../mintdex/hooks";
import { CardBack } from "../../mintdex/card3d";
import { MintCard } from "../../mintdex/MintCard";
import { LaunchedDialog, ShareButton, coinShare } from "../../mintdex/trust";
import {
  Address,
  Button,
  ButtonLink,
  Change,
  EmptyState,
  Ledge,
  Num,
  Skeleton,
  Tabs,
  TextLink,
  prefersReducedMotion,
  useSize,
} from "../../mintdex/ui";
import { CardExplorerLinks, ChainCardPanel, DisclosureChevron } from "./ChainCardPanel";
import { ChainTradePanel } from "./ChainTradePanel";
import { useViewer } from "./tx";
import { NET_NAME, NET_SHORT } from "../../../lib/chain/env";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const routeApi = /* @__PURE__ */ getRouteApi("/coin/$id");

/** Phone sections: three tabs. The Chart section holds the stats, the chart and the recent trades (an old
 * ?tab=trades link opens it). */
type CoinTab = "trade" | "card" | "chart";
const TAB_OPTIONS: Array<{ value: CoinTab; label: string }> = [
  { value: "trade", label: "Trade" },
  { value: "card", label: "Card" },
  { value: "chart", label: "Chart" },
];

/** When each mint's unlock window was first seen open on this page (the 5 s poll stops after 2 minutes). */
const pendingSeen = new Map<string, number>();

function cardPending(page: ChainCoinPage | null | undefined): boolean {
  if (!page) return false;
  const c = page.detail.card;
  const mint = page.detail.mint;
  if (c.pendingLevel === 0 && !c.unlockQueued) {
    pendingSeen.delete(mint);
    return false;
  }
  const since = pendingSeen.get(mint) ?? Date.now();
  pendingSeen.set(mint, since);
  return Date.now() - since < API_LIMITS.pendingPollMaxMs;
}

/** "0.000000478": SOL per coin without trailing zeros. */
function priceSolText(p: number) {
  const t = priceText(p);
  return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
}

/**
 * A tiny price that fits its stat: from four zeros after the point on, the zeros are a count, "0.0(8)1032" with
 * the 8 as a subscript for 0.000000001032 (the usual DEX notation). The full value is the title and what screen
 * readers hear.
 */
function PriceSol({ p }: { p: number | null }) {
  if (p == null) return <>—</>;
  const full = priceSolText(p);
  const m = /^0\.(0{4,})(\d+)$/.exec(full);
  if (!m) return <>{full}</>;
  return (
    <span title={full}>
      <span aria-hidden>
        0.0<sub className="relative top-[0.3em] align-baseline text-[0.62em]">{m[1].length}</sub>
        {m[2].slice(0, 4)}
      </span>
      <span className="sr-only">{full}</span>
    </span>
  );
}

/** A link to MintDex itself (a coin whose Website is its own coin page) adds nothing: skip it. */
function ownSite(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === "mintdex.fun" || host.endsWith(".mintdex.fun");
  } catch {
    return false;
  }
}

/** Why an unverified card shows its back instead of its art (R20). */
const UNVERIFIED_TITLE = "This card's mint could not be verified, so its art is not shown.";

/** The card art, only when the card mint is the program's own PDA (R20); the card back otherwise. */
function CardArt({ page, sizes, priority }: { page: ChainCoinPage; sizes?: string; priority?: boolean }) {
  if (!page.detail.card.cardMintVerified) return <CardBack title={UNVERIFIED_TITLE} />;
  return <MintCard card={page.coin} sizes={sizes} depth="table" idle="float" className="mdx-card3d--hero" priority={priority} />;
}

/** The newest trade (trades run oldest first): each new one jolts the case. */
function latestTrade(page: ChainCoinPage) {
  return page.trades.length ? page.trades[page.trades.length - 1].id : null;
}

/** Phones: the compact hero above the section tabs (the test-mode CoinPhoneHero with the devnet card check). */
function ChainPhoneHero({
  page,
  onCard,
  ref,
  className = "",
}: {
  page: ChainCoinPage;
  onCard: () => void;
  ref?: Ref<HTMLElement>;
  className?: string;
}) {
  const coin = page.coin;
  return (
    <section ref={ref} aria-label={`${coin.name} at a glance`} className={cx("grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4", className)}>
      <button type="button" onClick={onCard} aria-label={`Show the ${coin.name} card`} className="mdx-pocket block w-[112px] rounded-[5.04%/3.61%]">
        <CardArt page={page} priority sizes={COIN_CARD_SIZES} />
      </button>
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="mdx-h1 -mb-1 min-w-0 truncate pb-1">{coin.name}</h1>
          <ShareButton {...coinShare(coin)} label={`Share ${coin.name}`} />
        </div>
        <span className="mt-0.5 text-[13px] leading-[17px] text-slate">${coin.ticker}</span>
        <Num size="hero" watch={marketCapWatch(coin)} tick className="mt-2.5 text-[28px]!">
          {marketCapText(coin, false)}
        </Num>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[12px] font-medium leading-none text-slate">Market cap</span>
          <Change v={coin.change24h} pill className="text-[13px]" />
        </div>
        {/* The design, not the address: the address is in Coin details (Card section) and in Share. */}
        <PhoneHeroDesign coin={coin} />
      </div>
    </section>
  );
}

/** Phones: the top of the Card section (full card, caption, design progress). Coin details close the section. */
function ChainCardPane({ page, className = "" }: { page: ChainCoinPage; className?: string }) {
  const coin = page.coin;
  return (
    <section aria-label={`The ${coin.name} card`} data-pane="card" className={cx("flex flex-col", className)}>
      <CoinCase
        coin={coin}
        latestTradeId={latestTrade(page)}
        back={page.detail.card.cardMintVerified ? undefined : UNVERIFIED_TITLE}
        phone
        className="mx-auto mt-2 w-[min(260px,74vw)]"
      />
      {/* The design chip is in the hero right above: the caption here is the number and the launcher. */}
      <CaptionTop coin={coin} chip={false} className="mt-6" />
      <DesignProgress coin={coin} className="mt-3" />
    </section>
  );
}

/** Where the coin trades now, in one line (graduation state, m3-contract §2.2). */
function venueLine(page: ChainCoinPage): string {
  const d = page.detail;
  if (d.graduated) return MODE_COPY.curveComplete;
  if (d.curve?.complete) return "Curve complete. Moving to PumpSwap within a minute.";
  return `On the pump.fun curve, ${Math.round(page.coin.curveProgress * 100)}% sold. It moves to PumpSwap when it sells out.`;
}

/**
 * Under the ledge: the caption, the design chip and the design progress, then one closed "Coin details"
 * disclosure with the facts people look up now and then (the copyable mint address first, the two Explorer links,
 * where the coin trades, its own links). Phones: the caption and progress sit at the top of the Card section, and
 * the disclosure closes it.
 */
function ChainCoinDetails({ page, pane, className = "" }: { page: ChainCoinPage; pane?: string; className?: string }) {
  const coin = page.coin;
  const links = page.detail.links;
  const website = links.website && !ownSite(links.website) ? links.website : null;
  return (
    <div className={cx("min-w-0", className)} data-pane={pane}>
      <CaptionTop coin={coin} chipTitle={FIXPACK_COPY.tierMeaning} className="mb-2 hidden lg:block" />
      <DesignProgress coin={coin} className="max-lg:hidden" />
      <details className="group mt-2 max-lg:mt-0 max-lg:rounded-panel max-lg:bg-plinth max-lg:px-4">
        <summary className="mdx-hit inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-chip text-[13px] font-medium text-ink max-lg:flex max-lg:h-12 max-lg:justify-between [&::-webkit-details-marker]:hidden">
          {COIN_COPY.details}
          <DisclosureChevron />
        </summary>
        <div className="flex flex-col gap-1.5 pb-1 max-lg:pb-4">
          <Address address={coin.mintAddress} row label />
          <CardExplorerLinks card={page.detail.card} mint={page.detail.mint} />
          <p className="text-[13px] leading-[1.45] text-ink">{venueLine(page)}</p>
          {website || links.twitter || links.telegram ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] leading-5 max-lg:gap-x-6">
              {website ? (
                <TextLink href={website} target="_blank" rel="noopener noreferrer nofollow">
                  Website
                </TextLink>
              ) : null}
              {links.twitter ? (
                <TextLink href={links.twitter} target="_blank" rel="noopener noreferrer nofollow">
                  X profile
                </TextLink>
              ) : null}
              {links.telegram ? (
                <TextLink href={links.telegram} target="_blank" rel="noopener noreferrer nofollow">
                  Telegram
                </TextLink>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

/**
 * Price, 24h volume, holders and card fees (all time), as the test-mode CoinStats lays them out. A figure the
 * chain API does not know yet (holders) is left out instead of showing a dash: three up then.
 */
function ChainCoinStats({ page, pane, className = "" }: { page: ChainCoinPage; pane?: string; className?: string }) {
  const coin = page.coin;
  const holders = page.detail.holders;
  const known = holders != null;
  const items: Array<{ key: string; label: ReactNode; value: ReactNode; unit?: string; watch?: number; tick?: boolean }> = [
    { key: "price", label: "Price (SOL)", value: <PriceSol p={coin.priceSol} />, watch: coin.priceSol ?? undefined, tick: true },
    { key: "volume", label: "Volume 24h", value: coin.volume24h == null ? "—" : sol(coin.volume24h, 2), unit: "SOL" },
    ...(known ? [{ key: "holders", label: "Holders", value: holders.toLocaleString("en-US") }] : []),
    {
      key: "fees",
      label: (
        <>
          Card fees<span className={known ? "@min-[360px]:@max-[600px]:sr-only" : "@max-[600px]:sr-only"}> (all time)</span>
        </>
      ),
      value: sol(coin.ownerFees, 3),
      unit: "SOL",
    },
  ];
  return (
    <div className={cx("@container", className)} data-pane={pane}>
      <dl
        className={
          known
            ? "grid grid-cols-2 gap-x-4 gap-y-3 @min-[360px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] @min-[360px]:gap-y-0"
            : "grid grid-cols-3 gap-x-4"
        }
      >
        {items.map((it) => (
          <div key={it.key} className="min-w-0">
            <dt className="mdx-micro truncate">{it.label}</dt>
            <dd className="mt-1 truncate">
              <Num size="md" unit={it.unit} watch={it.watch} tick={it.tick}>
                {it.value}
              </Num>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- action column (the test-mode collapse ladder)

const BID_ROW = 32;
/**
 * Heights the collapse steps give back, in the order they go: the market cap after and venue rows (2 x 22, only
 * there once an amount is in), the bid note, then the quick amounts (8 + 32). Quick amounts go last, so a quick
 * amount never vanishes under the pointer that just picked it.
 */
const AFTER_H = 44;
const QUICK_H = 40;

function ChainActionColumn({
  page,
  className = "",
}: {
  page: ChainCoinPage;
  className?: string;
}) {
  const viewer = useViewer();
  const { wallet } = useChainWallet(viewer.address);
  const mint = page.detail.mint;
  const holdingStr = wallet?.coins.find((c) => c.mint === mint)?.amount;
  const holding = holdingStr ? big(holdingStr) : 0n;
  const balance = wallet ? num(wallet.lamports) : viewer.balance;

  const [bidsRef, bidsBox] = useSize<HTMLDivElement>({ width: 300, height: BID_ROW * 6 });
  const noteEl = useRef<HTMLParagraphElement | null>(null);
  const noteH = useRef(52);
  const [collapse, setCollapse] = useState(0);
  const [fixedHeight, setFixedHeight] = useState(false);
  // The ticket has an estimate (an amount is in): its quote rows show, so hiding the after rows frees space. Read
  // through a ref: the rows change the bid list's height, and that new height (h) is what runs the ladder again.
  const [quoted, setQuoted] = useState(false);
  const quotedRef = useRef(quoted);
  quotedRef.current = quoted;
  // Quick amounts show only with a wallet connected (ChainTradePanel).
  const connectedRef = useRef(viewer.connected);
  connectedRef.current = viewer.connected;
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const sync = () => setFixedHeight(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const h = bidsBox.height;
  const collapseRef = useRef(collapse);
  collapseRef.current = collapse;
  useEffect(() => {
    const current = collapseRef.current;
    if (noteEl.current) noteH.current = noteEl.current.offsetHeight;
    if (!fixedHeight) {
      if (current !== 0) setCollapse(0);
      return;
    }
    const steps = [quotedRef.current ? AFTER_H : 0, noteH.current, connectedRef.current ? QUICK_H : 0];
    const freed = (n: number) => steps.slice(0, n).reduce((a, b) => a + b, 0);
    const base = h - freed(current);
    let target = steps.length;
    for (let n = 0; n <= steps.length; n++) {
      if (base + freed(n) >= BID_ROW - 0.5) {
        target = n;
        break;
      }
    }
    if (target > current || (target < current && base + freed(target) >= BID_ROW + 4)) setCollapse(target);
  }, [h, fixedHeight]);
  const level = fixedHeight ? collapse : 0;
  const bidFit = Math.max(0, Math.floor((h + 0.5) / BID_ROW));

  return (
    <div
      className={cx(
        "contents lg:flex lg:min-h-0 lg:flex-col lg:gap-6 lg:overflow-hidden lg:bg-plinth",
        "mdx-aside lg:px-5 lg:py-6 short:gap-5 short:p-4",
        className,
      )}
    >
      <ChainTradePanel
        page={page}
        viewer={viewer}
        holding={holding}
        balance={balance}
        hideAfter={level >= 1}
        hideQuick={level >= 3}
        onQuote={setQuoted}
        pane="trade"
        className="order-3 rounded-panel bg-plinth p-4 lg:order-none lg:flex-none lg:rounded-none lg:bg-transparent lg:p-0"
      />
      <ChainCardPanel
        page={page}
        viewer={viewer}
        wallet={wallet}
        balance={balance}
        bidsRef={bidsRef}
        noteRef={noteEl}
        bidFit={bidFit}
        hideNote={level >= 2}
        pane="card"
        className="order-5 rounded-panel bg-plinth p-4 lg:order-none lg:min-h-0 lg:flex-1 lg:rounded-none lg:bg-transparent lg:p-0"
      />
    </div>
  );
}

// ---------------------------------------------------------------- the page

function CoinLoading() {
  return (
    <div className="mdx-page flex flex-col gap-4" aria-busy="true">
      <p className="text-[13px] leading-[1.45] text-slate" role="status">
        Reading this coin from {NET_NAME}...
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[264px_minmax(0,1fr)_320px]">
        <Skeleton onWall className="mx-auto w-[240px] rounded-[5.04%/3.61%]" style={{ aspectRatio: "63 / 88" }} />
        <Skeleton className="h-[320px] rounded-panel" />
        <Skeleton className="h-[320px] rounded-panel" />
      </div>
    </div>
  );
}

export function ChainCoinView() {
  const initial = routeApi.useLoaderData() as unknown as ChainCoinRoute;
  const { id } = routeApi.useParams();
  const { minted, tab: tabParam } = routeApi.useSearch();
  const tab: CoinTab = tabParam === "trades" ? "chart" : (tabParam ?? "trade");
  const navigate = routeApi.useNavigate();
  const heroRef = useRef<HTMLElement>(null);
  const qc = useQueryClient();

  const { data: page, isError } = useQuery({
    queryKey: ["coin", id],
    queryFn: async (): Promise<ChainCoinPage | null> => {
      // Right after the viewer's own transaction: the Worker re-reads the chain first (fresh=1, once).
      if (takeFresh(id)) return chainCoinPage(id, { fresh: true });
      return revPoll(qc, ["coin", id], () => chainCoinPage(id), (d) => d?.rev)();
    },
    initialData: initial.status === "ok" ? initial.page : undefined,
    staleTime: 3_000,
    refetchInterval: (q) => boostedPollMs(id, cardPending(q.state.data)),
  });

  const setTab = (next: CoinTab) => {
    void navigate({
      search: (p) => ({ ...p, tab: next === "trade" ? undefined : next }),
      replace: true,
      resetScroll: false,
    });
    const tabs = heroRef.current?.nextElementSibling as HTMLElement | null | undefined;
    if (!tabs) return;
    const stuck = tabs.getBoundingClientRect().top <= parseFloat(getComputedStyle(tabs).top || "0") + 1;
    if (stuck && heroRef.current) {
      const top = heroRef.current.getBoundingClientRect().bottom + window.scrollY - (parseFloat(getComputedStyle(tabs).top) || 0);
      window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  };

  // The server gave up on a slow chain API (generic title): name the coin once the browser has read it.
  const pageName = page ? `${page.coin.name} ($${page.coin.ticker}) on MintDex` : null;
  useEffect(() => {
    if (initial.status !== "ok" && pageName) document.title = pageName;
  }, [initial.status, pageName]);

  // "Your card is live" for the launcher only (the connected wallet), once, after mount.
  const viewer = useViewer();
  const isLauncher = !!page && !!viewer.address && page.detail.launcher === viewer.address;
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    if (!minted || !page) return;
    if (isLauncher) setLaunched(true);
    else if (viewer.ready && !viewer.connecting) void navigate({ search: {}, replace: true, resetScroll: false });
  }, [minted, isLauncher, page, viewer.ready, viewer.connecting, navigate]);

  if (page === undefined) {
    if (isError)
      return (
        <EmptyState
          className="mdx-page"
          title={`${NET_SHORT} did not answer`}
          body={`This coin could not be read from ${NET_NAME} right now. Try again in a moment.`}
          action={
            <div className="flex flex-col items-center gap-3">
              <Button onClick={() => void qc.invalidateQueries({ queryKey: ["coin", id] })}>Try again</Button>
              <TextLink to="/discover">{COIN_NOT_FOUND.action}</TextLink>
            </div>
          }
        />
      );
    return <CoinLoading />;
  }
  if (page === null) {
    return (
      <EmptyState
        className="mdx-page"
        title={COIN_NOT_FOUND.title}
        body={COIN_NOT_FOUND.address}
        action={<ButtonLink to="/discover">{COIN_NOT_FOUND.action}</ButtonLink>}
      />
    );
  }

  const coin: CoinDetail = page.coin;
  return (
    <div
      key={coin.id}
      data-tab={tab}
      className={[
        "mdx-page mdx-coin grid grid-cols-[minmax(0,1fr)] gap-3 md:max-lg:mx-auto md:max-lg:w-full md:max-lg:max-w-[600px]",
        "lg:grid-cols-[96px_minmax(0,1fr)_320px] lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-5 lg:gap-y-4",
        "xl:h-full xl:min-h-[600px] xl:grid-cols-[264px_minmax(0,1fr)_320px] xl:grid-rows-[minmax(0,1fr)] xl:gap-5",
        "wide:grid-cols-[300px_minmax(0,1fr)_360px] xwide:grid-cols-[340px_minmax(0,1fr)_380px]",
      ].join(" ")}
    >
      <ChainPhoneHero ref={heroRef} page={page} onCard={() => setTab("card")} className="order-1 lg:hidden" />
      <div className="mdx-coin__tabs sticky z-20 order-2 -mx-4 bg-wall px-4 py-1.5 lg:hidden">
        <Tabs value={tab} options={TAB_OPTIONS} onChange={setTab} label="Coin sections" className="mdx-tabs--fill" />
      </div>
      <ChainCardPane page={page} className="order-4 lg:hidden" />

      <div className="contents xl:flex xl:min-h-0 xl:flex-col xl:[grid-area:1/1/2/2]">
        <div aria-hidden className="mdx-case-spacer hidden xl:block xl:min-h-0 xl:flex-[1_1_0%] xl:max-h-[72px]" />
        <div className="order-1 flex flex-col max-lg:hidden lg:order-none lg:self-end lg:[grid-area:1/1/3/2] xl:min-h-0 xl:max-h-[calc(264px*173.683/112+65px)] xl:flex-[1000_1_0%] xl:self-stretch wide:max-h-[calc(300px*173.683/112+65px)] xwide:max-h-[calc(340px*173.683/112+65px)]">
          <div className="relative flex justify-center pt-6 lg:pt-0 xl:min-h-0 xl:flex-1 xl:items-end xl:justify-start xl:[container-type:size]">
            <CoinObject
              coin={coin}
              latestTradeId={latestTrade(page)}
              back={page.detail.card.cardMintVerified ? undefined : UNVERIFIED_TITLE}
            />
          </div>
          <Ledge />
        </div>
        <ChainCoinDetails
          page={page}
          pane="card"
          className="order-6 lg:order-none lg:[grid-area:3/1/4/3] xl:mt-4 xl:flex-none"
        />
      </div>

      <div className="contents xl:flex xl:min-h-0 xl:flex-col xl:gap-4 xl:[grid-area:1/2/2/3]">
        <CoinHeader
          coin={coin}
          className="max-lg:hidden lg:order-none lg:self-end lg:[grid-area:1/2/2/3] xl:h-14 xl:flex-none xl:flex-nowrap xl:self-stretch"
        />
        <ChainCoinStats page={page} pane="chart" className="order-7 max-lg:pt-1 lg:order-none lg:[grid-area:2/2/3/3] xl:flex-none" />
        <div className="contents lg:flex lg:flex-col lg:rounded-panel lg:bg-plinth lg:p-4 lg:shadow-ring lg:[grid-area:4/1/5/3] xl:min-h-0 xl:flex-1">
          <McapChart
            trades={page.chart}
            currentUsd={coin.mcapUsd}
            createdAt={chartStart(page.chart, coin.createdAt)}
            level={coin.level}
            tradeCount={page.trades.length}
            pane="chart"
            className="order-8 rounded-panel bg-plinth p-4 lg:order-none lg:rounded-none lg:bg-transparent lg:p-0 xl:min-h-0 xl:flex-[1.15]"
          />
          <TradesList
            trades={page.trades}
            count={page.trades.length}
            pane="chart"
            className="order-9 rounded-panel bg-plinth p-4 lg:order-none lg:mt-4 lg:rounded-none lg:bg-transparent lg:p-0 xl:min-h-0 xl:flex-1"
          />
        </div>
      </div>

      <ChainActionColumn page={page} className="lg:[grid-area:1/3/5/4] xl:[grid-area:1/3/2/4]" />

      <LaunchedDialog
        coin={coin}
        open={launched}
        onOpenChange={(o) => {
          setLaunched(o);
          if (!o && minted) void navigate({ search: {}, replace: true, resetScroll: false });
        }}
      />
    </div>
  );
}
