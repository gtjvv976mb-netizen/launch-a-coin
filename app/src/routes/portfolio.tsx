import { useId, useSyncExternalStore, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PageControls, usePageCapacity } from "../components/carddex/Viewport";
import { tabPanelProps } from "../components/carddex/ViewTabs";
import { View3DHost, type View3DItem } from "../components/mintdex/card3d";
import { quoteFixed } from "../components/mintdex/coin";
import { revPoll, useAction } from "../components/mintdex/hooks";
import { MintCard } from "../components/mintdex/MintCard";
import { useMe, useSessionUi } from "../components/mintdex/session";
import {
  Button, ButtonLink, Change, Num, PageFrame, PageHeader, Skeleton, Tabs, TextLink, Thumb,
} from "../components/mintdex/ui";
import { EmptyState } from "../components/mintdex/empty-state";
import { getCardDesign } from "../lib/carddex/designs";
import { getPairAsset } from "../lib/carddex/pairs";
import { claimFaucet, getPortfolio } from "../lib/mintdex/api";
import { EXPLORE_COINS, FLOW, IS_SIM } from "../lib/mintdex/copy";
import { sol, tokens } from "../lib/mintdex/format";
import { NOINDEX_PORTFOLIO, pageHead } from "../lib/mintdex/seo";
import type { Me, PortfolioData } from "../lib/mintdex/types";

/*
 * Portfolio (MintDex's format): the page header, one stats row, the section tabs (Coins | Cards | Balances) and a
 * fitted page of rows or cards with the pager under it. Signed out: the header and the fanned card backs.
 * Styles: styles/screens/portfolio.css. Details (what a test balance is, how value is counted) live on /how#demo.
 */

// Older saved offer and bid links are accepted and folded into Cards; there is no NFT marketplace.
type PortfolioSearch = { tab?: "coins" | "cards" | "balances" | "bids" | "offers"; page?: number };
export const Route = createFileRoute("/portfolio")({
  validateSearch: (raw: Record<string, unknown>): PortfolioSearch => ({
    tab: raw.tab === "balances" ? "balances" : raw.tab === "cards" || raw.tab === "bids" || raw.tab === "offers" ? "cards" : undefined,
    page: Number.isInteger(Number(raw.page)) && Number(raw.page) >= 2 && Number(raw.page) <= 999 ? Number(raw.page) : undefined,
  }),
  loader: () => IS_SIM ? getPortfolio() : null,
  shouldReload: ({ cause }) => cause !== "stay",
  head: () => pageHead({
    path: "/portfolio",
    title: "Portfolio | Launch a Card",
    description: "Your coins, your one-of-one NFT cards and your quote balances on Launch a Card.",
    noindex: NOINDEX_PORTFOLIO,
  }),
  component: Portfolio,
});

/** The one short link to the details this page no longer spells out. */
const DETAILS = <TextLink to="/how" hash="demo">How it works</TextLink>;

/** Desktop pages its lists to the screen (MintDex); phones list everything and the page scrolls. */
const DESK_QUERY = "(min-width: 1024px)";
function subscribeDesk(cb: () => void) {
  const list = window.matchMedia(DESK_QUERY);
  list.addEventListener("change", cb);
  return () => list.removeEventListener("change", cb);
}
function useDesk() {
  return useSyncExternalStore(subscribeDesk, () => window.matchMedia(DESK_QUERY).matches, () => true);
}

/** A Coins row: a coin held, or one you launched and hold none of (`launched`: no amount, value or 24h of yours). */
type CoinRow = { coin: PortfolioData["holdings"][number]["coin"]; amount: number; valueQuote: string | number; launched: boolean };

/**
 * The Coins rows: what you hold, then every coin you launched that you hold none of (its card is under Cards), so a
 * creator finds their coin on the first tab. A coin you launched and hold appears once, as a holding.
 */
function coinRows(data: PortfolioData): CoinRow[] {
  const held = new Set(data.holdings.map((h) => h.coin.id));
  return [
    ...data.holdings.map((h) => ({ coin: h.coin, amount: h.amount, valueQuote: h.valueQuote, launched: false })),
    ...data.deeds.filter((d) => !held.has(d.coin.id)).map((d) => ({ coin: d.coin, amount: 0, valueQuote: 0, launched: true })),
  ];
}

/** Coins: one whole-row link each (Coin, Held, Value in the coin's quote, 24h, Design). */
function Holdings({ rows }: { rows: CoinRow[] }) {
  return (
    <div className="cdx-holdings">
      <div className="cdx-holdings__head mdx-micro" aria-hidden="true">
        <span>Coin</span><span>Held</span><span>Value</span><span>24h</span><span>Design</span>
      </div>
      <div className="mdx-stagger cdx-holdings__rows">
        {rows.map(({ coin, amount, valueQuote, launched }) => (
          <Link key={coin.id} to="/coin/$id" params={{ id: coin.id }} className="cdx-holding mdx-row">
            <span className="cdx-holding__id">
              <Thumb src={coin.image} size={40} />
              <span className="min-w-0">
                <span className="cdx-holding__name">{coin.name}</span>
                <span className="cdx-holding__sub">
                  ${coin.ticker}
                  <span className="lg:hidden"> · {launched ? "Launched" : <span className="num">{tokens(amount)}</span>}</span>
                </span>
              </span>
            </span>
            <span className="cdx-holding__held num">{launched ? "Launched" : tokens(amount)}</span>
            {launched ? (
              <>
                <span className="cdx-holding__value cdx-holding__none"><span aria-hidden>—</span><span className="sr-only">No value: you hold none</span></span>
                <span className="cdx-holding__chg cdx-holding__none" aria-hidden>—</span>
              </>
            ) : (
              <>
                <span className="cdx-holding__value">
                  <Num size="sm" unit={coin.quoteSymbol}>{quoteFixed(valueQuote, coin.quoteAssetKey)}</Num>
                  <Change v={coin.change24h} className="cdx-holding__chg-sub" />
                </span>
                <span className="cdx-holding__chg"><Change v={coin.change24h} /></span>
              </>
            )}
            <span className="cdx-holding__design">{getCardDesign(coin.cardTemplate).name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Cards owned: the one-of-one card of each coin you launched, in its tray, with its name and design. */
function Cards({ rows }: { rows: PortfolioData["deeds"] }) {
  const list: View3DItem[] = rows.map(({ coin }) => ({ id: coin.id, card: coin }));
  return (
    <ul role="list" aria-label="Your cards" className="cdx-portfolio__cards">
      {rows.map(({ coin }, i) => (
        <li key={coin.id}>
          <View3DHost item={list[i]} list={list} className="cdx-portfolio__tile">
            <Link to="/coin/$id" params={{ id: coin.id }} search={{ tab: "card" }} className="cdx-portfolio__card group">
              <span className="mdx-pocket block">
                <MintCard card={coin} compact depth="table" idle="float" sizes="(max-width: 767px) 45vw, 200px" />
              </span>
              <span className="cdx-portfolio__cap">
                <span className="cdx-portfolio__capname">{coin.name}</span>
                <span className="cdx-portfolio__capsub">{getCardDesign(coin.cardTemplate).name} · 1 / 1</span>
              </span>
            </Link>
          </View3DHost>
        </li>
      ))}
    </ul>
  );
}

/**
 * Test balances: SOL first, then the quotes your coins are in, then every other quote, each group by symbol. Every
 * quote starts with a demo balance, so the quotes you trade in are what lifts a tile to the front.
 */
function balanceRows(me: NonNullable<Me>, byQuote: Record<string, string>): Array<[string, number]> {
  const entries = Object.entries(me.quoteBalances ?? { sol: me.balance });
  const rank = ([key]: [string, number]) => (key === "sol" ? 0 : Number(byQuote[key] ?? 0) > 0 ? 1 : 2);
  return [...entries].sort((a, b) => rank(a) - rank(b) || getPairAsset(a[0]).symbol.localeCompare(getPairAsset(b[0]).symbol));
}

function Balances({ rows, byQuote }: { rows: Array<[string, number]>; byQuote: Record<string, string> }) {
  return (
    <dl className="cdx-balance-grid" aria-label="Test balances by quote asset">
      {rows.map(([key, value]) => {
        const asset = getPairAsset(key);
        return (
          <div key={key}>
            <dt><span className="cdx-balance-grid__sym">{asset.symbol}</span> <span className="cdx-balance-grid__name">{asset.name}</span></dt>
            <dd className="num">{quoteFixed(value, key)}</dd>
            {/* Only for a quote your coins are in: 36 lines of "In coins 0.00" said nothing. */}
            {Number(byQuote[key] ?? 0) > 0 ? <dd className="cdx-balance-grid__in">In coins <span className="num">{quoteFixed(byQuote[key] ?? 0, key)}</span></dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

function SignedOut() {
  const { openEnter } = useSessionUi();
  return (
    <PageFrame className="mdx-page cdx-portfolio cdx-portfolio--out">
      <PageHeader title="Portfolio" />
      <EmptyState
        hero
        className="cdx-portfolio-empty"
        title="See your cards here"
        action={<div className="flex flex-col items-center gap-3"><Button onClick={() => openEnter()}>Try the demo</Button><TextLink to="/discover">{EXPLORE_COINS}</TextLink></div>}
      />
    </PageFrame>
  );
}

type View = "coins" | "cards" | "balances";
const PHONE_BALANCES = 12;

function Collection({ me }: { me: NonNullable<Me> }) {
  const initial = Route.useLoaderData();
  const qc = useQueryClient();
  const { data, isError, refetch, isFetching } = useQuery({
    queryKey: ["portfolio", me.id],
    queryFn: revPoll(qc, ["portfolio", me.id], () => getPortfolio()),
    initialData: initial ?? undefined,
    staleTime: 5_000,
    refetchInterval: 12_000,
  });
  const { run, pending } = useAction();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.tab === "cards" ? "cards" : search.tab === "balances" ? "balances" : "coins";
  const byQuote = data?.totals.holdingsValueByQuote ?? {};
  const balances = balanceRows(me, byQuote);
  const coins = data ? coinRows(data) : [];
  const count = view === "cards" ? data?.deeds.length ?? 0 : view === "balances" ? balances.length : coins.length;
  const tabsId = useId();
  // One fitted page per view on desktop (MintDex): rows of 64px, cards of about 300px, balance tiles of 84px; the
  // pager turns. Phones show the whole list (the columns still follow the width), but balances, one per pair, come 12
  // to a page: SOL and the quotes your coins use first (readiness audit UX-1; 87 rows were a 5,276 px page).
  const grid = usePageCapacity({
    rowHeight: view === "cards" ? 300 : view === "balances" ? 84 : 64,
    minWidth: view === "coins" ? 10000 : view === "cards" ? 168 : 200,
    maxColumns: view === "coins" ? 1 : view === "cards" ? 6 : 4,
    maxRows: view === "cards" ? 2 : 10,
  });
  const desk = useDesk();
  const perPage = desk ? grid.count : view === "balances" ? PHONE_BALANCES : Math.max(1, count);
  const pages = Math.max(1, Math.ceil(count / perPage));
  const page = Math.min((search.page ?? 1) - 1, pages - 1);
  const from = page * perPage;
  const setPage = (next: number) => void navigate({ search: (s) => ({ ...s, page: next > 0 ? next + 1 : undefined }), replace: true, resetScroll: false });
  const coinValue = data?.holdings.reduce((s, h) => s + (h.valueSol ?? 0), 0) ?? 0;
  // Coins in quotes with no SOL reference are valued in their own quote, never converted: each such quote's total,
  // in the order the holdings list them (two shown, then how many more).
  const priced = data ? data.holdings.some((h) => h.valueSol != null) : false;
  const ownQuotes = data
    ? [...new Set(data.holdings.filter((h) => h.valueSol == null).map((h) => h.coin.quoteAssetKey ?? "sol"))]
        .filter((key) => Number(byQuote[key] ?? 0) > 0)
    : [];
  return (
    <PageFrame className="mdx-page cdx-portfolio">
      <PageHeader
        title="Portfolio"
        context={<>@{me.handle} · {DETAILS}</>}
        right={
          me.canFaucet ? (
            <Button variant="outline" pending={pending === "faucet"} pendingLabel="Claiming..." onClick={() => void run("faucet", () => claimFaucet(), FLOW.faucetSent, { keys: [["portfolio"]] })}>
              {FLOW.claimFaucet}
            </Button>
          ) : undefined
        }
      />
      <dl className="cdx-portfolio__summary" data-quotes={ownQuotes.length || undefined}>
        <div><dt className="mdx-micro">Test SOL</dt><dd><Num size="lg" unit="SOL" watch={me.balance}>{sol(me.balance, 2)}</Num></dd></div>
        <div>
          <dt className="mdx-micro">Coins</dt>
          <dd>
            {data ? (
              <span className="cdx-portfolio__coins">
                {priced || !ownQuotes.length ? <Num size="lg" unit="SOL">{sol(coinValue, 2)}</Num> : null}
                {ownQuotes.slice(0, 2).map((key, i) => (
                  <span key={key} className="cdx-portfolio__coin-quote">
                    {priced || i > 0 ? <span aria-hidden className="cdx-portfolio__sep">·</span> : null}
                    <Num size="lg" unit={getPairAsset(key).symbol}>{quoteFixed(byQuote[key] ?? 0, key)}</Num>
                  </span>
                ))}
                {ownQuotes.length > 2 ? <span className="cdx-portfolio__more">+{ownQuotes.length - 2} more<span className="sr-only"> quotes</span></span> : null}
              </span>
            ) : <Skeleton className="h-7 w-24 rounded-chip" />}
          </dd>
        </div>
        <div><dt className="mdx-micro">Cards</dt><dd>{data ? <Num size="lg">{data.deeds.length}</Num> : <Skeleton className="h-7 w-10 rounded-chip" />}</dd></div>
      </dl>
      <Tabs
        panels
        idBase={tabsId}
        label="Portfolio sections"
        value={view}
        className="cdx-portfolio__tabs"
        onChange={(next) => void navigate({ search: { tab: next === "coins" ? undefined : next }, replace: true, resetScroll: false })}
        options={[
          { value: "coins", label: "Coins", count: data ? coins.length : undefined },
          { value: "cards", label: "Cards", count: data?.deeds.length },
          { value: "balances", label: "Balances" },
        ]}
      />
      <div
        ref={grid.ref}
        {...tabPanelProps(tabsId, view)}
        className="cdx-portfolio__rows"
        style={{ "--page-columns": grid.columns, "--page-rows": grid.rows } as CSSProperties}
      >
        {!data && isError ? (
          <EmptyState
            compact
            title="Couldn't load."
            action={<Button variant="outline" size="sm" pending={isFetching} pendingLabel="Trying again..." onClick={() => void refetch()}>Try again</Button>}
          />
        ) : !data ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Loading your portfolio">
            {[0, 1, 2].map((n) => <Skeleton key={n} className="h-16 w-full rounded-panel" />)}
          </div>
        ) : view === "balances" ? (
          <Balances rows={balances.slice(from, from + perPage)} byQuote={byQuote} />
        ) : view === "cards" ? (
          data.deeds.length ? (
            <Cards rows={data.deeds.slice(from, from + perPage)} />
          ) : (
            <EmptyState title="No cards yet" action={<ButtonLink to="/launch">Launch a coin</ButtonLink>} />
          )
        ) : coins.length ? (
          <Holdings rows={coins.slice(from, from + perPage)} />
        ) : (
          <EmptyState title="No coins yet" action={<ButtonLink to="/discover">{EXPLORE_COINS}</ButtonLink>} />
        )}
      </div>
      {pages > 1 ? (
        <PageControls
          page={page}
          pages={pages}
          onPage={setPage}
          label={`${count} ${view === "cards" ? "card" : view === "balances" ? "balance" : "coin"}${count === 1 ? "" : "s"}`}
        />
      ) : null}
    </PageFrame>
  );
}

function Portfolio() {
  const me = useMe();
  return me ? <Collection me={me} /> : <SignedOut />;
}
