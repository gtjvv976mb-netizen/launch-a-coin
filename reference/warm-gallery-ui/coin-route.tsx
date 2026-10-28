import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  CoinCase,
  DeedPanel,
  TradePanel,
  CoinDetails,
  CoinHeader,
  CoinStats,
  LoreEditor,
  McapChart,
  TradesList,
} from "../../components/mintdex/coin";
import { revPoll } from "../../components/mintdex/hooks";
import { LaunchedDialog } from "../../components/mintdex/trust";
import { EmptyState, Modal, TextLink } from "../../components/mintdex/ui";
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

/** The collectible and its token market share one continuous gallery folio. */
function CoinView() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const { minted } = Route.useSearch();
  const navigate = Route.useNavigate();
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
    <div key={coin.id} className="cdx-coin-folio pb-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-5">
        <TextLink to="/discover" className="text-[12px] text-slate">← Back to the collection</TextLink>
        <p className="text-[10px] font-medium uppercase tracking-[.16em] text-slate">Creator edition / one of one</p>
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.25fr)] xl:gap-20">
        <section className="cdx-coin-object min-w-0 lg:sticky lg:top-28" aria-label={`${coin.name} collectible card`}>
          <div className="cdx-coin-vitrine relative flex justify-center rounded-[32px] border border-hairline bg-plinth px-5 pb-8 pt-10 sm:px-8 sm:pt-12">
            <CoinCase coin={coin} latestTradeId={latestTradeId} priority className="w-full max-w-[370px]" />
          </div>
          <div className="mt-6 px-1"><CoinDetails coin={coin} isOwner={isOwner} onEdit={() => setLoreOpen(true)} /></div>
        </section>
        <div className="min-w-0">
          <CoinHeader coin={coin} className="mb-7" />
          {coin.lore ? <p className="mb-7 max-w-[600px] text-pretty text-[16px] leading-[1.7] text-slate">{coin.lore}</p> : null}
          <CoinStats coin={coin} className="border-y border-hairline py-5" />
          <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
            <section className="rounded-[24px] border border-hairline bg-plinth p-5 sm:p-6" aria-label="Trade this token"><p className="mb-5 text-[10px] font-medium uppercase tracking-[.18em] text-slate">Token exchange</p><TradePanel page={page} /></section>
            <div className="pt-1"><DeedPanel page={page} /></div>
          </div>
          <div className="mt-10 border-t border-hairline pt-7"><McapChart trades={trades} currentUsd={coin.mcapUsd} createdAt={coin.createdAt} level={coin.level} className="h-[340px]" /></div>
          <div className="mt-10 border-t border-hairline pt-7"><TradesList trades={trades} count={coin.trades} className="h-[330px]" /></div>
        </div>
      </div>
      <Modal open={loreOpen} onOpenChange={setLoreOpen} title="Edit description"><LoreEditor coinId={coin.id} lore={coin.lore} onDone={() => setLoreOpen(false)} /></Modal>
      <LaunchedDialog coin={coin} open={launched} onOpenChange={(open) => { setLaunched(open); if (!open && minted) void navigate({ search: {}, replace: true, resetScroll: false }); }} />
    </div>
  );
}
