import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { num, oneOf, searchSchema } from "../../lib/mintdex/search";

import {
  BackToDiscover,
  CardFacts,
  CoinAbout,
  CoinCase,
  CoinMarket,
  LoreEditor,
  McapChart,
  TokenFacts,
  TradeActionBar,
  TradePanel,
  TradesList,
  useSectionParam,
  useTradeTicket,
} from "../../components/mintdex/coin";
import { revPoll } from "../../components/mintdex/hooks";
import { LaunchedDialog, ShareButton, SimTag, coinShare } from "../../components/mintdex/trust";
import { Modal, PageHeader, TextLink } from "../../components/mintdex/ui";
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
import type { CoinDetail, CoinPage } from "../../lib/mintdex/types";

/** The coin's card art as an img sizes value: about 168px on phones, the 240 to 300px column on tablets, 320px up. */
const CASE_SIZES = "(max-width: 767px) 180px, (max-width: 1023px) 300px, 320px";

/**
 * ?minted=1: the launcher just minted this card, so the page opens "Your card is live" once (P1-12).
 * ?tab=card|chart|trade|trades|details: an old section link; the page scrolls to that section (useSectionParam).
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
 * Layout (styles/screens/coin.css). One page that scrolls once (main), with no tabs at any width. One DOM order at
 * every width, the reading and Tab order: the card (case, controls, the card's facts), the market strip, the trade
 * ticket (with the token's facts on tall desktop windows), the chart, the activity, About; then the dialogs and the
 * phone action bar. CSS grid areas place them:
 * - 1280 and up: sticky card column | the strip over the chart, the activity and About | the sticky ticket.
 * - 1024 to 1279: the same three tracks, narrower (the card's and token's facts move into About).
 * - 768 to 1023: the strip across, then the card column beside the ticket, the chart, the activity and About; the
 *   Buy or Sell submit sits in the action bar.
 * - Phones: the card beside the market figures, then the ticket, the chart, the activity and About; the action
 *   bar holds the submit. Old ?tab= links scroll to their section (data-section).
 */
function CoinView() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const { minted, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  useSectionParam(tab, () => void navigate({ search: (p) => ({ ...p, tab: undefined }), replace: true, resetScroll: false }));
  // "Your card is live" opens after mount (never in the server HTML) and only for the coin's launcher, so a
  // pasted ?minted=1 link shows nothing to anyone else. Closing it drops ?minted from the URL.
  const isLauncher = !!initial?.viewer?.isCreator;
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    if (!minted) return;
    if (isLauncher) setLaunched(true);
    else void navigate({ search: (p) => ({ ...p, minted: undefined }), replace: true, resetScroll: false });
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
  // Keyed by coin: another coin starts with a fresh ticket, case and lists.
  return <CoinScreen key={page.coin.id} page={page} loreOpen={loreOpen} setLoreOpen={setLoreOpen} launched={launched} setLaunched={setLaunched} />;
}

/** The coin page itself, once there is a page: the ticket's state lives here (useTradeTicket needs the page). */
function CoinScreen({
  page,
  loreOpen,
  setLoreOpen,
  launched,
  setLaunched,
}: {
  page: CoinPage;
  loreOpen: boolean;
  setLoreOpen: (open: boolean) => void;
  launched: boolean;
  setLaunched: (open: boolean) => void;
}) {
  const { minted } = Route.useSearch();
  const navigate = Route.useNavigate();
  const ticket = useTradeTicket(page);
  const { coin, trades } = page;
  const design = getCardDesign(coin.cardTemplate);
  // The newest trade (trades run oldest first): each new one jolts the case.
  const latestTradeId = trades.length ? trades[trades.length - 1].id : null;
  return (
    <div className="mdx-frame cdx-coin-screen">
      <PageHeader
        title={coin.name}
        context={
          <>
            ${coin.ticker} · {design.name} design · launched by {atName(coin.creatorHandle)}
            {coin.creatorIsBot ? " (bot)" : ""}
            {/* Below 1024 the Simulated tag ends the context line (the title row keeps its room for the name). */}
            <span className="cdx-coin-screen__simtag"><SimTag /></span>
          </>
        }
        back={<BackToDiscover compact />}
        right={<><span className="cdx-coin-screen__simtag--wide"><SimTag /></span><ShareButton {...coinShare(coin)} label={`Share ${coin.name}`} /></>}
      />
      <div className="cdx-coin-screen__grid">
        <section data-section="card" className="cdx-coin-screen__object" aria-label={`${coin.name} collectible card`}>
          <div className="cdx-coin-screen__case">
            <CoinCase coin={coin} latestTradeId={latestTradeId} priority inspect={false} sizes={CASE_SIZES} />
          </div>
          <CardFacts page={page} className="cdx-coin-screen__facts" />
        </section>
        <CoinMarket coin={coin} />
        <div data-section="trade" className="cdx-coin-screen__side">
          <TradePanel page={page} ticket={ticket} />
          <TokenFacts page={page} className="cdx-coin-screen__token" />
        </div>
        <div data-section="chart" className="cdx-coin-screen__chart">
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
        <div data-section="trades" className="cdx-coin-screen__activity">
          <TradesList trades={trades} count={coin.trades} />
        </div>
        <div data-section="details" className="cdx-coin-screen__details">
          <CoinAbout
            page={page}
            onEdit={() => setLoreOpen(true)}
            cardFacts={<CardFacts page={page} className="cdx-coin-about__card" />}
          />
        </div>
      </div>
      <Modal open={loreOpen} onOpenChange={setLoreOpen} title="Edit description">
        <LoreEditor coinId={coin.id} lore={coin.lore} onDone={() => setLoreOpen(false)} />
      </Modal>
      <LaunchedDialog
        coin={coin}
        open={launched}
        onOpenChange={(o) => {
          setLaunched(o);
          if (!o && minted) void navigate({ search: (p) => ({ ...p, minted: undefined }), replace: true, resetScroll: false });
        }}
      />
      {/* Last child of the view root, so it sticks for the whole page (density R7). */}
      <TradeActionBar ticket={ticket} />
    </div>
  );
}
