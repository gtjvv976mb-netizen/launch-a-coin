import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { View3DHost, type View3DItem } from "../components/mintdex/card3d";
import { quoteFixed, useSectionParam } from "../components/mintdex/coin";
import { revPoll, useAction } from "../components/mintdex/hooks";
import { MintCard } from "../components/mintdex/MintCard";
import { useMe, useSessionUi } from "../components/mintdex/session";
import { SimTag } from "../components/mintdex/trust";
import {
  AutoGrid, Button, ButtonLink, Change, KpiGroup, Num, PageHeader, SectionHead, TextLink, Thumb, type StatItem,
} from "../components/mintdex/ui";
import { EmptyState } from "../components/mintdex/empty-state";
import { getCardDesign } from "../lib/carddex/designs";
import { getPairAsset } from "../lib/carddex/pairs";
import { claimFaucet, getPortfolio } from "../lib/mintdex/api";
import { FLOW, IS_SIM, MODE_COPY } from "../lib/mintdex/copy";
import { sol, tokens } from "../lib/mintdex/format";
import { NOINDEX_PORTFOLIO, pageHead } from "../lib/mintdex/seo";
import type { Me, PortfolioData } from "../lib/mintdex/types";

// Older saved offer links are accepted and folded into Cards; there is no NFT marketplace. `page` is kept for the
// inherited chain portfolio (ChainPortfolio.tsx); this page shows every section at once and ignores it. An old ?tab=
// link scrolls to its section (useSectionParam).
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

/** What each list shows before its "Show all" (density R4: lists show their first rows, then expand in place). */
const COINS_FIRST = 12;
const CARDS_FIRST = 4;
const BALANCES_FIRST = 10;

/**
 * A list's first rows, then one toggle that shows the rest in place ("Show all 25 balances") and closes back
 * ("Show fewer"). Opening moves focus to the first new item (`[data-item=first]` index, tabIndex -1); closing brings
 * the toggle back into view. Instant at every motion level (nothing travels).
 */
function useShowAll(count: number, first: number) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const limit = open ? count : first;
  function toggle() {
    const opening = !open;
    setOpen(opening);
    requestAnimationFrame(() => {
      if (opening) listRef.current?.querySelector<HTMLElement>(`[data-item="${first}"]`)?.focus();
      else toggleRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  }
  return { open, limit, listRef, toggleRef, toggle, more: count > first };
}

function ShowAll({ state, count, noun }: { state: ReturnType<typeof useShowAll>; count: number; noun: string }) {
  if (!state.more) return null;
  return (
    <div className="cdx-portfolio__more">
      <Button ref={state.toggleRef} variant="ghost" size="sm" onClick={state.toggle}>
        {state.open ? "Show fewer" : `Show all ${count} ${noun}`}
      </Button>
    </div>
  );
}

/** The sections' loading rows: the final layout with each value a flat bar at its real size. */
function LoadingRows({ label }: { label: string }) {
  return (
    <div className="cdx-holdings__rows" aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((n) => (
        <div key={n} className="cdx-holding cdx-holding--loading" aria-hidden="true">
          <span className="mdx-skeleton cdx-holding__thumb" />
          <span className="cdx-holding__id"><span className="mdx-skeleton cdx-bar cdx-bar--name" /><span className="mdx-skeleton cdx-bar cdx-bar--sub" /></span>
          <span className="mdx-skeleton cdx-bar cdx-bar--fig cdx-holding__value" />
        </div>
      ))}
    </div>
  );
}

/**
 * Holdings: one whole-row link per coin. Wide panes (480px and up) read Coin · Held · Value · 24h on one line
 * under a header row, at the list row height; narrow ones two lines (name and value, then ticker and amount held,
 * and the 24h change). Rules sit between rows, square. The first 12, then "Show all".
 */
function Holdings({ rows }: { rows: PortfolioData["holdings"] }) {
  const all = useShowAll(rows.length, COINS_FIRST);
  return (
    <div className="cdx-holdings">
      <div className="cdx-holdings__head" aria-hidden="true">
        <span>Coin</span><span>Held</span><span>Value</span><span>24h</span>
      </div>
      <div className="cdx-holdings__rows" ref={(el) => { all.listRef.current = el; }}>
        {rows.slice(0, all.limit).map(({ coin, amount, valueQuote }, i) => (
          <Link key={coin.id} to="/coin/$id" params={{ id: coin.id }} className="cdx-holding" data-item={i}>
            <Thumb src={coin.image} size={32} />
            <span className="cdx-holding__id">
              <span className="cdx-holding__name">{coin.name}</span>
              <span className="cdx-holding__sub">
                ${coin.ticker}
                <span className="cdx-holding__design"> · {getCardDesign(coin.cardTemplate).name}</span>
                <span className="cdx-holding__held-sub"> · <span className="num">{tokens(amount)}</span> held</span>
              </span>
            </span>
            <span className="cdx-holding__held num">{tokens(amount)}</span>
            <span className="cdx-holding__value">
              <Num size="sm" unit={coin.quoteSymbol}>{quoteFixed(valueQuote, coin.quoteAssetKey)}</Num>
              <Change v={coin.change24h} className="cdx-holding__chg-sub" />
            </span>
            <span className="cdx-holding__chg"><Change v={coin.change24h} /></span>
          </Link>
        ))}
      </div>
      <ShowAll state={all} count={rows.length} noun="coins" />
    </div>
  );
}

/** The cards: one tile per one-of-one card in an auto-fill grid, the View in 3D chip on the card's own corner (the
 * host is the card). The first 4 (two rows of two in every arrangement), then "Show all". */
function Cards({ rows }: { rows: PortfolioData["deeds"] }) {
  const all = useShowAll(rows.length, CARDS_FIRST);
  const list: View3DItem[] = rows.map(({ coin }) => ({ id: coin.id, card: coin }));
  return (
    <>
      <AutoGrid min="var(--tile-min-design)" label="Your cards" className="cdx-portfolio__cards" ref={(el) => { all.listRef.current = el; }}>
        {rows.slice(0, all.limit).map(({ coin }, i) => (
          <li key={coin.id}>
            <View3DHost item={list[i]} list={list} className="cdx-portfolio__tile">
              <Link to="/coin/$id" params={{ id: coin.id }} className="cdx-portfolio__card" data-item={i}>
                <MintCard card={coin} compact depth="table" idle="float" sizes="(max-width: 767px) 45vw, 200px" />
                <span className="cdx-portfolio__cap">
                  <span className="cdx-portfolio__capname">{coin.name}</span>
                  <span className="cdx-portfolio__capsub">${coin.ticker} · {getCardDesign(coin.cardTemplate).name}</span>
                </span>
              </Link>
            </View3DHost>
          </li>
        ))}
      </AutoGrid>
      <ShowAll state={all} count={rows.length} noun="cards" />
    </>
  );
}

/** Test balances by quote asset: SOL first, then the quotes you hold or trade in, then the zeros. The first 10. */
function Balances({ rows, byQuote }: { rows: Array<[string, number]>; byQuote: Record<string, string> }) {
  const all = useShowAll(rows.length, BALANCES_FIRST);
  return (
    <>
      <table className="cdx-balances">
        <caption className="sr-only">Test balances by quote asset</caption>
        <thead>
          <tr><th scope="col">Asset</th><th scope="col" className="cdx-balances__n">Balance</th><th scope="col" className="cdx-balances__n">In coins</th></tr>
        </thead>
        <tbody ref={(el) => { all.listRef.current = el; }}>
          {rows.slice(0, all.limit).map(([key, value], i) => {
            const asset = getPairAsset(key);
            return (
              <tr key={key}>
                <th scope="row" data-item={i} tabIndex={all.open && i === BALANCES_FIRST ? -1 : undefined}>
                  <span className="cdx-balances__sym">{asset.symbol}</span><span className="cdx-balances__name">{asset.name}</span>
                </th>
                <td className="cdx-balances__n num">{quoteFixed(value, key)}</td>
                <td className="cdx-balances__n num">{quoteFixed(byQuote[key] ?? 0, key)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="cdx-portfolio__caption">A separate demo balance per quote asset.</p>
      <ShowAll state={all} count={rows.length} noun="balances" />
    </>
  );
}

/** The balance rows in their order: SOL, then what you hold or trade in, then the zeros, each group by symbol. */
function balanceRows(me: NonNullable<Me>, byQuote: Record<string, string>): Array<[string, number]> {
  const entries = Object.entries(me.quoteBalances ?? { sol: me.balance });
  const rank = ([key, value]: [string, number]) => (key === "sol" ? 0 : value > 0 || Number(byQuote[key] ?? 0) > 0 ? 1 : 2);
  return [...entries].sort((a, b) => rank(a) - rank(b) || getPairAsset(a[0]).symbol.localeCompare(getPairAsset(b[0]).symbol));
}

/** The signed-out first run: the page's frame (figures as dashes, the coins table's header) holding the invitation. */
function SignedOut() {
  const { openEnter } = useSessionUi();
  const dashes: StatItem[] = [
    { label: "Total value", value: null, sub: MODE_COPY.enterGift },
    { label: "Test SOL", value: null },
    { label: "Coins", value: null },
    { label: "Cards", value: null },
  ];
  return (
    <div className="mdx-frame cdx-portfolio cdx-portfolio--out">
      <PageHeader title="Portfolio" context="Your coins, your one-of-one cards and what they are worth." />
      <KpiGroup items={dashes} lead strip className="cdx-portfolio__kpis cdx-portfolio__kpis--out" />
      <section className="cdx-portfolio__panel cdx-portfolio__invite" aria-labelledby="portfolio-coins-out">
        <SectionHead title={<span id="portfolio-coins-out">Coins</span>} />
        <div className="cdx-holdings">
          <div className="cdx-holdings__head" aria-hidden="true">
            <span>Coin</span><span>Held</span><span>Value</span><span>24h</span>
          </div>
        </div>
        <EmptyState
          hero
          className="cdx-portfolio-empty"
          title="Start your collection"
          body="Try the demo to trade a coin or launch your own. Each coin you launch comes with its one-of-one card."
          action={<><Button onClick={() => openEnter()}>Try the demo</Button><TextLink to="/discover">Explore coins</TextLink></>}
        />
      </section>
    </div>
  );
}

/** The figures, from the rows as shown: total value = test SOL + the coins valued in SOL. */
function totalsOf(me: NonNullable<Me>, data: PortfolioData | undefined) {
  if (!data) return null;
  const priced = data.holdings.filter((h) => h.valueSol != null);
  const coins = priced.reduce((s, h) => s + (h.valueSol ?? 0), 0);
  const unpriced = data.holdings.length - priced.length;
  // The 24h move of what you hold now: today's value against the same amounts at prices 24 hours ago.
  const moving = priced.filter((h) => (h.valueSol ?? 0) > 0 && 1 + h.coin.change24h > 0);
  const before = moving.reduce((s, h) => s + (h.valueSol ?? 0) / (1 + h.coin.change24h), 0);
  const now = moving.reduce((s, h) => s + (h.valueSol ?? 0), 0);
  const change = moving.length ? (now - before) / (me.balance + (coins - now) + before) : null;
  return { coins, unpriced, total: me.balance + coins, change };
}

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
  useSectionParam(search.tab, () => void navigate({ search: (p) => ({ ...p, tab: undefined }), replace: true, resetScroll: false }));
  const totals = totalsOf(me, data ?? undefined);
  const byQuote = data?.totals.holdingsValueByQuote ?? {};
  const balances = balanceRows(me, byQuote);
  // No data yet: a flat bar while it loads; if the read failed, a grey dash and one line with Retry in each list.
  const failed = !data && isError;
  const loading = failed ? null : <span className="mdx-skeleton cdx-bar cdx-bar--kpi" aria-label="Loading" />;
  const retry = (what: string) => (
    <EmptyState
      compact
      title={`Couldn't load your ${what}.`}
      body="Check your connection, then try again. Your test balances are safe in this browser."
      action={<Button variant="outline" size="sm" pending={isFetching} pendingLabel="Retrying..." onClick={() => void refetch()}>Retry</Button>}
    />
  );
  const items: StatItem[] = [
    {
      label: "Total value",
      value: totals ? sol(totals.total, 2) : loading,
      unit: totals ? "SOL" : undefined,
      watch: totals?.total,
      change: totals ? (
        totals.change == null ? (
          <span className="mdx-dash" aria-label="No 24h change: you hold no coins">{"—"}</span>
        ) : (
          <span className="cdx-portfolio__chg"><Change v={totals.change} pill period="in 24 hours, at the coins you hold now" /><span aria-hidden="true">24h</span></span>
        )
      ) : undefined,
      sub: "Test SOL plus your coins; 24h is their price move",
    },
    { label: "Test SOL", value: sol(me.balance, 2), unit: "SOL", watch: me.balance },
    {
      label: "Coins",
      value: totals ? sol(totals.coins, 2) : loading,
      unit: totals ? "SOL" : undefined,
      sub: !data ? undefined : totals?.unpriced ? `Plus ${totals.unpriced} in other quotes (Balances)` : `${data.holdings.length} held`,
    },
    { label: "Cards", value: data ? String(data.deeds.length) : loading, sub: "One of one each" },
  ];
  const noCoins = !!data && !data.holdings.length;
  const noCards = !!data && !data.deeds.length;
  return (
    <div className="mdx-frame cdx-portfolio">
      <PageHeader
        title="Portfolio"
        context={<>@{me.handle} · test wallet</>}
        right={
          <>
            <SimTag />
            {me.canFaucet ? (
              <Button variant="outline" pending={pending === "faucet"} pendingLabel="Claiming..." onClick={() => void run("faucet", () => claimFaucet(), FLOW.faucetSent, { keys: [["portfolio"]] })}>
                {FLOW.claimFaucet}
              </Button>
            ) : null}
          </>
        }
      />
      <KpiGroup items={items} lead strip className="cdx-portfolio__kpis" />
      <div className="cdx-portfolio__grid">
        <section data-section="coins" data-empty={noCoins || undefined} className="cdx-portfolio__panel cdx-portfolio__coins" aria-labelledby="portfolio-coins">
          <SectionHead title={<span id="portfolio-coins">Coins</span>} right={data ? <span className="num">{data.holdings.length} held</span> : undefined} />
          {failed ? (
            retry("coins")
          ) : !data ? (
            <LoadingRows label="Loading your coins" />
          ) : data.holdings.length ? (
            <Holdings rows={data.holdings} />
          ) : (
            <EmptyState compact title="No coins yet." body="Buy one on its page or launch your own." action={<ButtonLink to="/discover" variant="outline" size="sm">Discover coins</ButtonLink>} />
          )}
        </section>
        <section data-section="cards" data-empty={noCards || undefined} className="cdx-portfolio__panel cdx-portfolio__deck" aria-labelledby="portfolio-cards">
          <SectionHead title={<span id="portfolio-cards">Cards</span>} right={data ? <span className="num">{data.deeds.length} owned</span> : undefined} />
          {failed ? (
            retry("cards")
          ) : !data ? (
            <LoadingRows label="Loading your cards" />
          ) : data.deeds.length ? (
            <Cards rows={data.deeds} />
          ) : (
            <EmptyState compact title="No cards yet." body="Launch a coin to get its one-of-one card." action={<ButtonLink to="/launch" variant="outline" size="sm">Launch a coin</ButtonLink>} />
          )}
        </section>
        <section data-section="balances" className="cdx-portfolio__panel cdx-portfolio__balances" aria-labelledby="portfolio-balances">
          <SectionHead
            title={<span id="portfolio-balances">Test balances</span>}
            right={<span className="num text-slate">{balances.length} {balances.length === 1 ? "asset" : "assets"}</span>}
          />
          <Balances rows={balances} byQuote={byQuote} />
        </section>
      </div>
    </div>
  );
}

function Portfolio() {
  const me = useMe();
  return me ? <Collection me={me} /> : <SignedOut />;
}
