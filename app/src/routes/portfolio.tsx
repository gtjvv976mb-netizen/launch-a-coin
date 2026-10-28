import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { View3DHost } from "../components/mintdex/card3d";
import { revPoll, useAction } from "../components/mintdex/hooks";
import { MintCard } from "../components/mintdex/MintCard";
import { useMe, useSessionUi } from "../components/mintdex/session";
import {
  Button, ButtonLink, Change, EmptyState, Num, PageFrame, PageHeader,
  Pager, Skeleton, Tabs, TextLink, Thumb,
} from "../components/mintdex/ui";
import { getCardDesign } from "../lib/carddex/designs";
import { getPairAsset } from "../lib/carddex/pairs";
import { quoteAtoms } from "../lib/carddex/quote-display";
import { claimFaucet, getPortfolio } from "../lib/mintdex/api";
import { FLOW, IS_SIM, MODE_COPY } from "../lib/mintdex/copy";
import { sol, tokens } from "../lib/mintdex/format";
import { NOINDEX_PORTFOLIO, pageHead } from "../lib/mintdex/seo";
import type { Me, PortfolioData } from "../lib/mintdex/types";

// Older saved offer links are accepted and folded into Cards; there is no NFT marketplace.
type PortfolioSearch = { tab?: "coins" | "cards" | "bids" | "offers"; page?: number };
export const Route = createFileRoute("/portfolio")({
  validateSearch: (raw: Record<string, unknown>): PortfolioSearch => ({
    tab: raw.tab === "cards" || raw.tab === "bids" || raw.tab === "offers" ? "cards" : undefined,
    page: Number.isInteger(Number(raw.page)) && Number(raw.page) >= 2 && Number(raw.page) <= 999 ? Number(raw.page) : undefined,
  }),
  loader: () => IS_SIM ? getPortfolio() : null,
  shouldReload: ({ cause }) => cause !== "stay",
  head: () => pageHead({ path: "/portfolio", title: "Your collection | Launch a Card", noindex: NOINDEX_PORTFOLIO }),
  component: Portfolio,
});

function Holdings({ rows }: { rows: PortfolioData["holdings"] }) {
  return (
    <div className="overflow-hidden rounded-panel bg-plinth p-2 shadow-ring">
      <div className="mdx-micro hidden grid-cols-[minmax(0,1.7fr)_1fr_1fr_80px_minmax(0,1fr)] gap-5 border-b border-hairline px-3 py-3 lg:grid">
        <span>Token</span><span className="text-right">Held</span><span className="text-right">Value</span><span className="text-right">24h</span><span>Card design</span>
      </div>
      <div className="mdx-stagger divide-y divide-hairline">
        {rows.map(({ coin, amount, valueQuote }) => (
          <Link key={coin.id} to="/coin/$id" params={{ id: coin.id }} className="group grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-row px-3 py-3 transition-colors hover:bg-tint lg:min-h-16 lg:grid-cols-[minmax(0,1.7fr)_1fr_1fr_80px_minmax(0,1fr)] lg:gap-5">
            <span className="flex min-w-0 items-center gap-3">
              <Thumb src={coin.image} size={40} />
              <span className="min-w-0"><span className="block truncate text-[15px] font-semibold text-ink group-hover:underline">{coin.name}</span><span className="block truncate text-[12px] text-slate">${coin.ticker}<span className="lg:hidden"> · {tokens(amount)} held</span></span></span>
            </span>
            <span className="num hidden text-right text-[14px] text-ink lg:block">{tokens(amount)}</span>
            <span className="text-right"><span className="num block text-[15px] text-ink">{quoteAtoms(valueQuote, coin.quoteAssetKey, true)} <span className="text-[12px] text-slate">{coin.quoteSymbol}</span></span><Change v={coin.change24h} className="text-[12px] lg:hidden" /></span>
            <span className="hidden text-right lg:block"><Change v={coin.change24h} className="text-[13px]" /></span>
            <span className="hidden truncate text-[12px] text-slate lg:block">{getCardDesign(coin.cardTemplate).name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Cards({ rows }: { rows: PortfolioData["deeds"] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {rows.map(({ coin }) => (
        <View3DHost key={coin.id} item={{ id: coin.id, card: coin }}>
          <Link to="/coin/$id" params={{ id: coin.id }} search={{ tab: "card" }} className="group block min-w-0">
            <MintCard card={coin} compact depth="table" idle="float" />
            <div className="mt-3 min-w-0 px-1"><p className="truncate text-[14px] font-semibold text-ink group-hover:underline">{coin.name}</p><p className="mt-0.5 truncate text-[12px] text-slate">{getCardDesign(coin.cardTemplate).name}</p><p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate">Creator's edition · 1 / 1</p></div>
          </Link>
        </View3DHost>
      ))}
    </div>
  );
}

function SignedOut() {
  const { openEnter } = useSessionUi();
  return (
    <PageFrame className="mdx-page">
      <PageHeader title="Your collection" context="Your tokens. Your cards." />
      <EmptyState hero className="flex-1" title="Start your collection" body="Enter the local demo to launch a token, choose its permanent card design and keep both in your portfolio." action={<div className="flex flex-col items-center gap-3"><Button onClick={() => openEnter()}>Enter Launch a Card</Button><TextLink to="/discover">Explore the tokens</TextLink></div>} />
    </PageFrame>
  );
}

function Collection({ me }: { me: NonNullable<Me> }) {
  const initial = Route.useLoaderData();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["portfolio", me.id],
    queryFn: revPoll(qc, ["portfolio", me.id], () => getPortfolio()),
    initialData: initial ?? undefined,
    staleTime: 5_000,
    refetchInterval: 12_000,
  });
  const { run, pending } = useAction();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.tab === "cards" ? "cards" : "coins";
  const rows = view === "cards" ? data?.deeds : data?.holdings;
  const perPage = view === "cards" ? 10 : 12;
  const pages = Math.max(1, Math.ceil((rows?.length ?? 0) / perPage));
  const page = Math.min((search.page ?? 1) - 1, pages - 1);
  const from = page * perPage;
  const setPage = (next: number) => void navigate({ search: (s) => ({ ...s, page: next > 0 ? next + 1 : undefined }), replace: true, resetScroll: false });
  return (
    <PageFrame className="mdx-page">
      <PageHeader title={`@${me.handle}`} context="Your tokens. Your one-of-one cards." right={me.canFaucet ? <Button variant="outline" pending={pending === "faucet"} pendingLabel="Claiming..." onClick={() => void run("faucet", () => claimFaucet(), FLOW.faucetSent, { keys: [["portfolio"]] })}>{FLOW.claimFaucet}</Button> : undefined} />
      <dl className="grid flex-none grid-cols-3 gap-3 rounded-panel border border-hairline bg-plinth p-4 sm:gap-6">
        <div className="min-w-0"><dt className="mdx-micro truncate">Demo wallet</dt><dd className="mt-1"><Num size="lg" unit="SOL" watch={me.balance}>{sol(me.balance, 2)}</Num></dd></div>
        <div className="min-w-0"><dt className="mdx-micro truncate">Token value</dt><dd className="mt-1">{data?.totals.holdingsValue === null ? <span className="text-[20px] font-semibold text-ink">By quote</span> : <Num size="lg" unit="SOL" watch={data?.totals.holdingsValue ?? undefined}>{sol(data?.totals.holdingsValue ?? 0)}</Num>}</dd></div>
        <div className="min-w-0"><dt className="mdx-micro truncate">NFT cards</dt><dd className="mt-1"><Num size="lg">{data?.deeds.length ?? 0}</Num></dd></div>
      </dl>
      {Object.keys(data?.totals.holdingsValueByQuote ?? {}).length > 0 ? <dl className="grid flex-none grid-cols-2 gap-3 rounded-panel border border-hairline bg-plinth p-4 sm:grid-cols-3" aria-label="Token values by quote asset">
        {Object.entries(data?.totals.holdingsValueByQuote ?? {}).map(([key,value])=><div key={key} className="min-w-0"><dt className="mdx-micro">{getPairAsset(key).symbol} holdings</dt><dd className="mt-1 truncate text-[15px] font-semibold text-ink">{quoteAtoms(value,key,true)} {getPairAsset(key).symbol}</dd></div>)}
      </dl> : null}
      <details className="flex-none rounded-panel border border-hairline bg-plinth px-4 py-3 text-[13px] text-slate">
        <summary className="cursor-pointer font-semibold text-ink">Demo quote balances</summary>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(me.quoteBalances ?? {sol:me.balance}).map(([key,value])=><div key={key} className="min-w-0"><dt>{getPairAsset(key).symbol}</dt><dd className="mt-0.5 break-words font-medium text-ink">{quoteAtoms(value,key,true)}</dd></div>)}</dl>
        <p className="mt-3">Separate test balances. Stock and memecoin quantities are not added to SOL.</p>
      </details>
      <div className="flex flex-none items-center justify-between gap-4">
        <Tabs label="Portfolio sections" value={view} onChange={(next) => void navigate({ search: { tab: next === "cards" ? "cards" : undefined }, replace: true, resetScroll: false })} options={[{ value: "coins", label: "Tokens", count: data?.holdings.length }, { value: "cards", label: "NFT cards", count: data?.deeds.length }]} />
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
      <div className="min-h-0 flex-1">
        {!data ? <div className="grid gap-3" aria-busy="true" aria-label="Loading your collection">{[0, 1, 2].map((n) => <Skeleton key={n} className="h-20 w-full rounded-panel" />)}</div> : view === "cards" ? data.deeds.length ? <Cards rows={data.deeds.slice(from, from + perPage)} /> : <EmptyState title="Your first card awaits" body="Launch a token and choose the premium design for its one-of-one card." action={<ButtonLink to="/launch">Launch a token</ButtonLink>} /> : data.holdings.length ? <Holdings rows={data.holdings.slice(from, from + perPage)} /> : <EmptyState title="No tokens yet" body="Discover a token to trade, or launch one of your own." action={<ButtonLink to="/discover">Discover tokens</ButtonLink>} />}
      </div>
      <p className="flex-none text-[12px] leading-5 text-slate">{MODE_COPY.guideNote}</p>
    </PageFrame>
  );
}

function Portfolio() {
  const me = useMe();
  return me ? <Collection me={me} /> : <SignedOut />;
}
