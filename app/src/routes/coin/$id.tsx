import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  CoinCase,
  DeedPanel,
  TradePanel,
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
type CoinTab = "trade" | "card" | "chart" | "trades" | "details";
const TAB_OPTIONS: Array<{ value: CoinTab; label: string }> = [
  { value: "card", label: "Card" },
  { value: "chart", label: "Chart" },
  { value: "trade", label: "Trade" },
  { value: "trades", label: "Trades" },
  { value: "details", label: "Details" },
];

/**
 * ?minted=1: the launcher just minted this card, so the page opens "Your card is live" once (P1-12).
 * ?tab=card|chart|trades: the phone section that shows (Trade when absent). Desktop shows everything.
 */
const coinSearch = z.object({
  minted: z.number().int().optional().catch(undefined),
  tab: z.enum(["trade", "card", "chart", "trades", "details"]).optional().catch(undefined),
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
    title: `${coin.name} ($${coin.ticker}) on Launch a Card`,
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
  const tab: CoinTab = tabParam ?? "card";
  const navigate = Route.useNavigate();
  const [detailTab,setDetailTab] = useState("token");
  const setTab = (next: CoinTab) => void navigate({search:p=>({...p,tab:next==="card"?undefined:next}),replace:true,resetScroll:false});
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

  const ownershipRows = [
    ["Owner",`@${coin.ownerHandle}${page.viewer?.isOwner ? " (you)" : ""}`],
    ["Design",getCardDesign(coin.cardTemplate).name],
    ["Edition","One of one"],
    ["Trading pair",coin.tradingPair],
    ["Quote asset",coin.quoteSymbol],
    ["Collection","Separate creator-owned NFT card"],
  ];
  return (
    <div key={coin.id} data-tab={tab} className="cdx-coin-screen">
      <header className="cdx-coin-screen__head"><CoinHeader coin={coin} /><span className="text-[12px] text-slate">Demo token · {coin.tradingPair}</span></header>
      <div className="cdx-coin-screen__tabs"><Tabs value={tab} options={TAB_OPTIONS} onChange={setTab} label="Coin sections" className="mdx-tabs--fill" /></div>
      <div className="cdx-coin-screen__body">
        <section className="cdx-coin-screen__object" aria-label={`${coin.name} collectible card`}>
          <div className="cdx-coin-screen__case"><CoinCase coin={coin} latestTradeId={latestTradeId} priority /></div>
        </section>
        <section className="cdx-coin-screen__pane" aria-label={TAB_OPTIONS.find(option=>option.value===tab)?.label}>
          {tab==="card" ? <><h2 className="text-lg font-semibold">The creator’s card</h2><div className="cdx-coin-screen__ownership"><dl>{ownershipRows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div><p className="text-[12px] text-slate">Fixed design. Its token trades separately.</p></> : null}
          {tab==="chart" ? <><CoinStats coin={coin} /><McapChart trades={trades} tradeCount={coin.trades} currentUsd={coin.mcapUsd} currentQuote={coin.mcapQuote} quoteAssetKey={coin.quoteAssetKey} createdAt={coin.createdAt} level={coin.level} className="cdx-coin-screen__chart" /></> : null}
          {tab==="trade" ? <TradePanel page={page} compact hideQuick hideAfter className="cdx-coin-screen__trade" /> : null}
          {tab==="trades" ? <TradesList trades={trades} count={coin.trades} className="cdx-coin-screen__trades" /> : null}
          {tab==="details" ? <><div className="cdx-view-tabs" aria-label="Token details"><button type="button" aria-pressed={detailTab==="token"} onClick={()=>setDetailTab("token")}>Token</button><button type="button" aria-pressed={detailTab==="story"} onClick={()=>setDetailTab("story")}>Story</button><button type="button" aria-pressed={detailTab==="owner"} onClick={()=>setDetailTab("owner")}>Ownership</button></div>{detailTab==="token" ? <CoinDetails coin={coin} isOwner={isOwner} onEdit={()=>setLoreOpen(true)} /> : detailTab==="story" ? <p className="cdx-coin-screen__story">{coin.lore || "The creator has not added a description."}</p> : <div className="cdx-coin-screen__ownership"><dl>{ownershipRows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>}</> : null}
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
