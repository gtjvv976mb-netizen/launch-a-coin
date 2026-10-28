import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  ActionColumn,
  CoinCardPane,
  CoinObject,
  CoinDetails,
  CoinHeader,
  CoinPhoneHero,
  CoinStats,
  LoreEditor,
  McapChart,
  TradesList,
} from "../../components/mintdex/coin";
import { revPoll } from "../../components/mintdex/hooks";
import { LaunchedDialog } from "../../components/mintdex/trust";
import { EmptyState, Ledge, Modal, Tabs, TextLink, prefersReducedMotion } from "../../components/mintdex/ui";
import { ChainCoinNotFound } from "../../components/chain/pages/ChainCoinNotFound";
import { ChainCoinView } from "../../components/chain/pages/ChainCoinPage";
import { chainCoinHead, chainCoinLoader, type ChainCoinRoute } from "../../lib/chain/data";
import { getCoin, getCoinRoute } from "../../lib/mintdex/api";
import { COIN_NOT_FOUND, IS_SIM, MODE_COPY } from "../../lib/mintdex/copy";
import {
  NOINDEX_COINS,
  canonicalCoinPath,
  clip,
  looksLikeAddress,
  pageHead,
  sentences,
  shareArt,
} from "../../lib/mintdex/seo";
import { getCardDesign } from "../../lib/carddex/designs";
import type { CoinDetail } from "../../lib/mintdex/types";

/** Phone sections (P1-5): one at a time under the hero, kept in ?tab= so a notification can link to the card. */
type CoinTab = "trade" | "card" | "chart" | "trades";
const TAB_OPTIONS: Array<{ value: CoinTab; label: string }> = [
  { value: "trade", label: "Trade" },
  { value: "card", label: "Card" },
  { value: "chart", label: "Chart" },
  { value: "trades", label: "Trades" },
];

/**
 * ?minted=1: the launcher just minted this card, so the page opens "Your card is live" once (P1-12).
 * ?tab=card|chart|trades: the phone section that shows (Trade when absent). Desktop shows everything.
 */
const coinSearch = z.object({
  minted: z.number().int().optional().catch(undefined),
  tab: z.enum(["trade", "card", "chart", "trades"]).optional().catch(undefined),
});

export const Route = createFileRoute("/coin/$id")({
  validateSearch: coinSearch,
  // Links people type (P0-10): a canonical id loads the page; a ticker ($HONK, honk, CORGI) or another casing
  // answers 301 to /coin/{id}; anything else, a real devnet mint included, is a real 404 rendered inside the
  // app shell by notFoundComponent below. Never a 500.
  loader: async ({ params, location }) => {
    if (params.id.length > 200) throw notFound();
    // Devnet: the id is a mint and the data comes from the chain API (lib/chain/data.ts; page: ChainCoinPage.tsx);
    // a ticker or name slug answers 301 to its mint when exactly one visible coin goes by it.
    if (!IS_SIM) return (await chainCoinLoader(params.id, location.search)) as never;
    const res = await getCoinRoute({ data: { id: params.id } });
    // The query string goes along (?tab=card from a shared or notification link keeps its section).
    if (res.status === "moved") {
      throw redirect({ to: "/coin/$id", params: { id: res.id }, search: location.search, statusCode: 301 });
    }
    if (res.status === "missing") throw notFound();
    return res.page;
  },
  head: ({ loaderData }) =>
    !IS_SIM
      ? chainCoinHead(loaderData as unknown as ChainCoinRoute, coinHead)
      : loaderData
        ? coinHead(loaderData.coin)
        : { meta: [{ title: "Card not found | CardDex" }, { name: "robots", content: "noindex" }] },
  notFoundComponent: IS_SIM ? CoinNotFound : ChainCoinNotFound,
  component: IS_SIM ? CoinView : ChainCoinView,
});

/** Title, description and share tags (P0-11, P1-12): no simulated $ figure while in test mode (decision C5). */
function coinHead(coin: CoinDetail) {
  const design = getCardDesign(coin.cardTemplate);
  const head = pageHead({
    path: canonicalCoinPath(coin),
    title: `${coin.name} ($${coin.ticker}) on CardDex`,
    description: sentences(clip(coin.lore, 140), `${design.name}, creator-selected NFT card`, MODE_COPY.coinQualifier),
    image: shareArt(coin.image),
    imageAlt: `${coin.name} card art`,
    card: "summary",
    noindex: NOINDEX_COINS,
  });
  // twitter:creator from the coin's own X link, when it has one (P1-12).
  const xHandle = coin.xUrl?.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/)?.[1];
  if (xHandle) head.meta.push({ name: "twitter:creator", content: `@${xHandle}` });
  return head;
}

function CoinNotFound() {
  const { id } = Route.useParams();
  return (
    <EmptyState
      className="mdx-page"
      title={COIN_NOT_FOUND.title}
      body={looksLikeAddress(id) ? COIN_NOT_FOUND.address : COIN_NOT_FOUND.unknown}
      action={<TextLink to="/discover">{COIN_NOT_FOUND.action}</TextLink>}
    />
  );
}

/*
 * Layout (spec 8.3). One grid, three arrangements:
 * - 1280 and up: object column (wall, sleeved card on the ledge, caption) | market column (header row,
 *   stats, one plinth block with chart and trades) | action column (plinth, full height, bleeds to
 *   the content edges). Fits one screen; lists and bids fit to the height.
 * - 1024 to 1279: the object column folds away. A 96px card stands on a short ledge left of the header
 *   and stats, the caption details move under the stats, and main may scroll.
 * - Phones (P1-5, decision C11): the column wrappers dissolve (`contents`). A compact hero (112px card, name,
 *   market cap, address) and four segmented tabs, then one section at a time: Trade (the ticket), Card (the
 *   full card, its caption and progress, the card panel, links), Chart (stats, chart), Trades. The section
 *   lives in ?tab=, rendered by the server, and CSS (.mdx-coin[data-tab]) hides the others.
 */
function CoinView() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const { minted, tab: tabParam } = Route.useSearch();
  const tab: CoinTab = tabParam ?? "trade";
  const navigate = Route.useNavigate();
  const heroRef = useRef<HTMLElement>(null);
  const setTab = (next: CoinTab) => {
    void navigate({
      search: (p) => ({ ...p, tab: next === "trade" ? undefined : next }),
      replace: true,
      resetScroll: false,
    });
    // When the tabs are stuck under the header (scrolled into a long section), bring the new section's top
    // just under them instead of leaving the reader halfway down a shorter one.
    const tabs = heroRef.current?.nextElementSibling as HTMLElement | null | undefined;
    if (!tabs) return;
    const stuck = tabs.getBoundingClientRect().top <= parseFloat(getComputedStyle(tabs).top || "0") + 1;
    if (stuck && heroRef.current) {
      const top = heroRef.current.getBoundingClientRect().bottom + window.scrollY - (parseFloat(getComputedStyle(tabs).top) || 0);
      window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  };
  // "Your card is live" opens after mount (never in the server HTML) and only for the coin's launcher, so a
  // pasted ?minted=1 link shows nothing to anyone else. Closing it drops ?minted from the URL.
  const isLauncher = !!initial?.viewer?.isCreator;
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    if (!minted) return;
    if (isLauncher) setLaunched(true);
    else void navigate({ search: {}, replace: true, resetScroll: false });
  }, [minted, isLauncher, navigate]);
  const qc = useQueryClient();
  const { data: page } = useQuery({
    queryKey: ["coin", id],
    // The 6s poll asks checkRev first and keeps the page it has when nothing changed (P0-12).
    queryFn: revPoll(qc, ["coin", id], () => getCoin({ data: { id } })),
    initialData: initial,
    staleTime: 3_000,
    refetchInterval: 6_000,
  });
  const [loreOpen, setLoreOpen] = useState(false);

  // The coin left the dex while the page was open (hidden under the content rules): the same honest
  // not-found state the route answers with (P0-10).
  if (!page) {
    return (
      <EmptyState
        className="mdx-page"
        title={COIN_NOT_FOUND.title}
        body={COIN_NOT_FOUND.unknown}
        action={<TextLink to="/discover">{COIN_NOT_FOUND.action}</TextLink>}
      />
    );
  }

  const { coin, trades } = page;
  const isOwner = !!page.viewer?.isOwner;
  // The newest trade (trades run oldest first): each new one jolts the case.
  const latestTradeId = trades.length ? trades[trades.length - 1].id : null;

  return (
    // Keyed on the coin: going from one coin to another remounts the page, so the entrance plays and no
    // typed amount or open dialog carries over to the next coin.
    <div
      key={coin.id}
      data-tab={tab}
      className={[
        // Tablets in portrait keep the phone sections in a centered 600px column.
        "mdx-page mdx-coin grid grid-cols-[minmax(0,1fr)] gap-3 md:max-lg:mx-auto md:max-lg:w-full md:max-lg:max-w-[600px]",
        "lg:grid-cols-[96px_minmax(0,1fr)_320px] lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-5 lg:gap-y-4",
        "xl:h-full xl:min-h-[600px] xl:grid-cols-[264px_minmax(0,1fr)_320px] xl:grid-rows-[minmax(0,1fr)] xl:gap-5",
        "wide:grid-cols-[300px_minmax(0,1fr)_360px] xwide:grid-cols-[340px_minmax(0,1fr)_380px]",
      ].join(" ")}
    >
      {/* The object: the sleeved card on the ledge, then its caption. The pocket (12px; 6px for the 96px
          card at 1024 to 1279) bleeds into the content padding and the gutter, so the card keeps its width. */}
      {/* Phones: the compact hero and the section tabs (sticky under the header). */}
      <CoinPhoneHero ref={heroRef} coin={coin} onCard={() => setTab("card")} className="order-1 lg:hidden" />
      <div className="mdx-coin__tabs sticky z-20 order-2 -mx-4 bg-wall px-4 py-1.5 lg:hidden">
        <Tabs
          value={tab}
          options={TAB_OPTIONS}
          onChange={setTab}
          label="Coin sections"
          className="mdx-tabs--fill"
        />
      </div>
      <CoinCardPane coin={coin} latestTradeId={latestTradeId} className="order-4 lg:hidden" />

      {/* Fit the complete 112 × 173.683 collector case and its external controls in the column.
          A small flexible spacer aligns it with the stats on taller screens. */}
      <div className="contents xl:flex xl:min-h-0 xl:flex-col xl:[grid-area:1/1/2/2]">
        <div aria-hidden className="mdx-case-spacer hidden xl:block xl:min-h-0 xl:flex-[1_1_0%] xl:max-h-[72px]" />
        <div className="order-1 flex flex-col max-lg:hidden lg:order-none lg:self-end lg:[grid-area:1/1/3/2] xl:min-h-0 xl:max-h-[calc(264px*173.683/112+65px)] xl:flex-[1000_1_0%] xl:self-stretch wide:max-h-[calc(300px*173.683/112+65px)] xwide:max-h-[calc(340px*173.683/112+65px)]">
          <div className="relative flex justify-center pt-6 lg:pt-0 xl:min-h-0 xl:flex-1 xl:items-end xl:justify-start xl:[container-type:size]">
            <CoinObject coin={coin} latestTradeId={latestTradeId} />
          </div>
          <Ledge />
        </div>
        <CoinDetails
          coin={coin}
          isOwner={isOwner}
          onEdit={() => setLoreOpen(true)}
          pane="card"
          className="order-6 lg:order-none lg:[grid-area:3/1/4/3] xl:mt-4 xl:flex-none"
        />
      </div>

      {/* The market: header row, stats, chart and recent trades. */}
      <div className="contents xl:flex xl:min-h-0 xl:flex-col xl:gap-4 xl:[grid-area:1/2/2/3]">
        <CoinHeader
          coin={coin}
          className="max-lg:hidden lg:order-none lg:self-end lg:[grid-area:1/2/2/3] xl:h-14 xl:flex-none xl:flex-nowrap xl:self-stretch"
        />
        <CoinStats
          coin={coin}
          pane="chart"
          className="order-7 max-lg:pt-1 lg:order-none lg:[grid-area:2/2/3/3] xl:flex-none"
        />
        <div className="cdx-coin-market contents lg:flex lg:flex-col lg:rounded-panel lg:bg-plinth lg:p-4 lg:shadow-ring lg:[grid-area:4/1/5/3] xl:min-h-0 xl:flex-1">
          <McapChart
            trades={trades}
            currentUsd={coin.mcapUsd}
            createdAt={coin.createdAt}
            level={coin.level}
            pane="chart"
            className="order-8 rounded-panel bg-plinth p-4 lg:order-none lg:rounded-none lg:bg-transparent lg:p-0 xl:min-h-0 xl:flex-[1.15]"
          />
          <TradesList
            trades={trades}
            count={coin.trades}
            pane="trades"
            className="order-9 rounded-panel bg-plinth p-4 lg:order-none lg:mt-4 lg:rounded-none lg:bg-transparent lg:p-0 xl:min-h-0 xl:flex-1"
          />
        </div>
      </div>

      {/* The actions: trade ticket, then the card. */}
      <ActionColumn page={page} className="lg:[grid-area:1/3/5/4] xl:[grid-area:1/3/2/4]" />

      <Modal open={loreOpen} onOpenChange={setLoreOpen} title="Edit description">
        <LoreEditor coinId={coin.id} lore={coin.lore} onDone={() => setLoreOpen(false)} />
      </Modal>
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
