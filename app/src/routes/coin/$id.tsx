import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { num, oneOf, searchSchema } from "../../lib/mintdex/search";

import {
  BackToDiscover,
  CardFacts,
  CoinAbout,
  CoinCase,
  CoinFigures,
  CoinMarket,
  LoreEditor,
  McapChart,
  TradePanel,
  TradesList,
  useCoinBand,
} from "../../components/mintdex/coin";
import { revPoll } from "../../components/mintdex/hooks";
import { LaunchedDialog, ShareButton, SimTag, coinShare } from "../../components/mintdex/trust";
import { Modal, PageHeader, Tabs, TextLink } from "../../components/mintdex/ui";
import { EmptyState } from "../../components/mintdex/empty-state";
import { ChainCoinNotFound } from "../../components/chain/pages/ChainCoinNotFound";
import { ChainCoinView } from "../../components/chain/pages/ChainCoinPage";
import { chainCoinHead, chainCoinLoader, type ChainCoinRoute } from "../../lib/chain/data";
import { getCoin, getCoinRoute } from "../../lib/mintdex/api";
import { atName } from "../../lib/mintdex/format";
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
import { tabPanelProps } from "../../components/carddex/ViewTabs";
import type { CoinDetail } from "../../lib/mintdex/types";

/**
 * The ?tab= sections. Phones (under 768) show one at a time, Card first. From 768 the card stays beside one pane
 * (Trade first; ?tab=card falls back to Trade without rewriting the URL). From 1024 everything shows at once and
 * the tabs go. "trades" keeps its URL value; its label is Activity, so it never reads next to "Trade".
 */
type CoinTab = "trade" | "card" | "chart" | "trades" | "details";
const PHONE_TABS: Array<{ value: CoinTab; label: string }> = [
  { value: "card", label: "Card" },
  { value: "chart", label: "Chart" },
  { value: "trade", label: "Trade" },
  { value: "trades", label: "Activity" },
  { value: "details", label: "Details" },
];
const TABLET_TABS = PHONE_TABS.filter((t) => t.value !== "card");
/** The coin's card art as an img sizes value: the case column is 240 to 300px wide at every width. */
const CASE_SIZES = "(max-width: 767px) 280px, 300px";

/**
 * ?minted=1: the launcher just minted this card, so the page opens "Your card is live" once (P1-12).
 * ?tab=card|chart|trade|trades|details: the section phones and tablets show (see CoinTab).
 */
const coinSearch = searchSchema({
  minted: num(true),
  tab: oneOf(["trade", "card", "chart", "trades", "details"]),
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
        : { meta: [{ title: "Card not found | Launch a Card" }, { name: "robots", content: "noindex" }] },
  notFoundComponent: IS_SIM ? CoinNotFound : ChainCoinNotFound,
  component: IS_SIM ? CoinView : ChainCoinView,
});

/** Title, description and share tags (P0-11, P1-12): no simulated $ figure while in test mode (decision C5). */
function coinHead(coin: CoinDetail) {
  const design = getCardDesign(coin.cardTemplate);
  const head = pageHead({
    path: canonicalCoinPath(coin),
    title: `${coin.name} ($${coin.ticker}) | Launch a Card`,
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
 * Layout (styles/screens/coin.css). The DOM order is the reading and Tab order: the title, the market strip, the
 * section tabs, the ticket and the details, the chart, the activity, then the card; CSS grid areas place them.
 * - 1024 and up, one screen: card column (case, controls, the card's owner and edition) | market strip over the
 *   chart and the activity | the ticket with the details under it. Activity and details scroll in their panes.
 * - 768 to 1023: the market strip, then the card column beside one tabbed pane (Trade, Chart, Activity, Details).
 * - Phones: the market cap and the curve, the five tabs, then one section that fills the rest of the screen.
 */
function CoinView() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const { minted, tab: tabParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const band = useCoinBand();
  const tabsId = useId();
  const raw: CoinTab = tabParam ?? "card";
  // What the tabs show as selected: a ?tab= the band has no tab for falls back to its first tab.
  const tab: CoinTab = band === "tablet" && raw === "card" ? "trade" : raw;
  const setTab = (next: CoinTab) =>
    void navigate({ search: (p) => ({ ...p, tab: next === "card" ? undefined : next }), replace: true, resetScroll: false });
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
  const design = getCardDesign(coin.cardTemplate);
  // The newest trade (trades run oldest first): each new one jolts the case.
  const latestTradeId = trades.length ? trades[trades.length - 1].id : null;
  // Phones and tablets: the shown section is the tab panel; from 1024 there are no tabs.
  const panel = (section: CoinTab) => (band !== "wide" && section === tab ? tabPanelProps(tabsId, tab) : {});
  const share = <ShareButton {...coinShare(coin)} label={`Share ${coin.name}`} />;
  return (
    <div key={coin.id} data-tab={raw} className="mdx-frame cdx-coin-screen">
      <PageHeader
        title={coin.name}
        context={
          <>
            ${coin.ticker} · {design.name} design · launched by {atName(coin.creatorHandle)}
            {coin.creatorIsBot ? " (bot)" : ""}
          </>
        }
        back={<><BackToDiscover /><span className="cdx-coin-screen__utils"><SimTag />{share}</span></>}
        right={<><SimTag />{share}</>}
      />
      <div className="cdx-coin-screen__grid">
        <CoinMarket coin={coin} />
        <div className="cdx-coin-screen__tabs">
          <Tabs
            panels
            idBase={tabsId}
            value={tab}
            options={band === "tablet" ? TABLET_TABS : PHONE_TABS}
            onChange={setTab}
            label="Coin sections"
            className="mdx-tabs--fill"
          />
        </div>
        <div className="cdx-coin-screen__side">
          <section data-section="trade" className="cdx-coin-screen__ticket" aria-label={`Trade $${coin.ticker}`} {...panel("trade")}>
            <TradePanel page={page} />
          </section>
          <div data-section="details" className="cdx-coin-screen__details" {...panel("details")}>
            <CardFacts page={page} className="cdx-coin-screen__facts--phone" />
            <CoinAbout page={page} onEdit={() => setLoreOpen(true)} />
          </div>
        </div>
        <div data-section="chart" className="cdx-coin-screen__chart" {...panel("chart")}>
          <CoinFigures coin={coin} />
          <McapChart
            trades={trades}
            tradeCount={coin.trades}
            currentUsd={coin.mcapUsd}
            currentQuote={coin.mcapQuote}
            quoteAssetKey={coin.quoteAssetKey}
            createdAt={coin.createdAt}
            level={coin.level}
          />
        </div>
        <div data-section="trades" className="cdx-coin-screen__activity" {...panel("trades")}>
          <TradesList trades={trades} count={coin.trades} />
        </div>
        <section data-section="card" className="cdx-coin-screen__object" aria-label={`${coin.name} collectible card`} {...panel("card")}>
          <div className="cdx-coin-screen__case">
            <CoinCase coin={coin} latestTradeId={latestTradeId} priority inspect={false} sizes={CASE_SIZES} />
          </div>
          <CardFacts page={page} className="cdx-coin-screen__facts" />
        </section>
      </div>
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
