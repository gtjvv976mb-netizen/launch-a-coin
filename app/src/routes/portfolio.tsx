import { useId, useState } from "react";
import { tabPanelProps } from "../components/carddex/ViewTabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { View3DHost, type View3DItem } from "../components/mintdex/card3d";
import { quoteFixed, useCoinBand } from "../components/mintdex/coin";
import { revPoll, useAction } from "../components/mintdex/hooks";
import { MintCard } from "../components/mintdex/MintCard";
import { useMe, useSessionUi } from "../components/mintdex/session";
import { SimTag } from "../components/mintdex/trust";
import {
  Button, ButtonLink, Change, KpiGroup, Num, PageHeader, SectionHead, Tabs, TextLink, Thumb, type StatItem,
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
// inherited chain portfolio (ChainPortfolio.tsx); this page's lists scroll and ignore it.
type PortfolioView = "coins" | "cards" | "balances";
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

/** Rows shown before "Show more": holdings past 50 and cards past 24 (natural lists, no viewport pager). */
const HOLDINGS_BATCH = 50;
const CARDS_BATCH = 24;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** A tab label with its count after it in slate ("Coins 10"). */
function counted(label: string, n: number | undefined) {
  return n == null ? label : <>{label} <span className="cdx-portfolio__count num">{n}</span></>;
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
 * Holdings: one whole-row link per coin. Wide panes read Coin · Held · Value · 24h under a header row; narrow ones
 * two lines (name and value, then ticker and amount held, and the 24h change). Rules sit between rows, square.
 */
function Holdings({ rows }: { rows: PortfolioData["holdings"] }) {
  const [limit, setLimit] = useState(HOLDINGS_BATCH);
  return (
    <div className="cdx-holdings">
      <div className="cdx-holdings__head" aria-hidden="true">
        <span>Coin</span><span>Held</span><span>Value</span><span>24h</span>
      </div>
      <div className="cdx-holdings__rows">
        {rows.slice(0, limit).map(({ coin, amount, valueQuote }) => (
          <Link key={coin.id} to="/coin/$id" params={{ id: coin.id }} className="cdx-holding">
            <Thumb src={coin.image} size={40} />
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
      {rows.length > limit ? (
        <div className="cdx-portfolio__more">
          <span className="text-caption text-slate">Showing <span className="num">{limit}</span> of <span className="num">{rows.length}</span></span>
          <Button variant="outline" onClick={() => setLimit((n) => n + HOLDINGS_BATCH)}>Show more coins</Button>
        </div>
      ) : null}
    </div>
  );
}

/** The cards: one tile per one-of-one card, the View in 3D chip on the card's own corner (the host is the card). */
function Cards({ rows }: { rows: PortfolioData["deeds"] }) {
  const [limit, setLimit] = useState(CARDS_BATCH);
  const list: View3DItem[] = rows.map(({ coin }) => ({ id: coin.id, card: coin }));
  return (
    <>
      <div className="cdx-portfolio__cards">
        {rows.slice(0, limit).map(({ coin }, i) => (
          <View3DHost key={coin.id} item={list[i]} list={list} className="cdx-portfolio__tile">
            <Link to="/coin/$id" params={{ id: coin.id }} search={{ tab: "card" }} className="cdx-portfolio__card">
              <MintCard card={coin} compact depth="table" idle="float" sizes="(max-width: 767px) 50vw, 200px" />
              <span className="cdx-portfolio__cap">
                <span className="cdx-portfolio__capname">{coin.name}</span>
                <span className="cdx-portfolio__capsub">${coin.ticker} · {getCardDesign(coin.cardTemplate).name}</span>
              </span>
            </Link>
          </View3DHost>
        ))}
      </div>
      {rows.length > limit ? (
        <div className="cdx-portfolio__more">
          <span className="text-caption text-slate">Showing <span className="num">{limit}</span> of <span className="num">{rows.length}</span></span>
          <Button variant="outline" onClick={() => setLimit((n) => n + CARDS_BATCH)}>Show more cards</Button>
        </div>
      ) : null}
    </>
  );
}

/** Test balances by quote asset: SOL first, then the quotes you hold or trade in, then the zeros. */
function Balances({ me, byQuote }: { me: NonNullable<Me>; byQuote: Record<string, string> }) {
  const entries = Object.entries(me.quoteBalances ?? { sol: me.balance });
  const rank = ([key, value]: [string, number]) => (key === "sol" ? 0 : value > 0 || Number(byQuote[key] ?? 0) > 0 ? 1 : 2);
  const rows = [...entries].sort((a, b) => rank(a) - rank(b) || getPairAsset(a[0]).symbol.localeCompare(getPairAsset(b[0]).symbol));
  return (
    <table className="cdx-balances">
      <caption className="sr-only">Test balances by quote asset</caption>
      <thead>
        <tr><th scope="col">Asset</th><th scope="col" className="cdx-balances__n">Balance</th><th scope="col" className="cdx-balances__n">In coins</th></tr>
      </thead>
      <tbody>
        {rows.map(([key, value]) => {
          const asset = getPairAsset(key);
          return (
            <tr key={key}>
              <th scope="row"><span className="cdx-balances__sym">{asset.symbol}</span><span className="cdx-balances__name">{asset.name}</span></th>
              <td className="cdx-balances__n num">{quoteFixed(value, key)}</td>
              <td className="cdx-balances__n num">{quoteFixed(byQuote[key] ?? 0, key)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
      <KpiGroup items={dashes} lead className="cdx-portfolio__kpis cdx-portfolio__kpis--out" />
      <section className="cdx-portfolio__panel cdx-portfolio__invite" aria-label="Coins">
        <SectionHead title="Coins" />
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
  const band = useCoinBand();
  const view: PortfolioView = search.tab === "cards" || search.tab === "balances" ? search.tab : "coins";
  const tabsId = useId();
  const totals = totalsOf(me, data ?? undefined);
  // No data yet: a flat bar while it loads; if the read failed, a grey dash and one line with Retry in each list.
  const failed = !data && isError;
  const loading = failed ? null : <span className="mdx-skeleton cdx-bar cdx-bar--kpi" aria-label="Loading" />;
  const retry = (what: string) => (
    <EmptyState
      inline
      title={`Couldn't load your ${what}.`}
      body="Check your connection, then try again. Your test balances are safe in this browser."
      action={<Button variant="outline" pending={isFetching} pendingLabel="Retrying..." onClick={() => void refetch()}>Retry</Button>}
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
  // Phones and tablets: the shown section is the tab panel; from 1024 every section shows and the tabs go.
  const panel = (section: PortfolioView) => (band !== "wide" && section === view ? tabPanelProps(tabsId, view) : {});
  return (
    <div className="mdx-frame cdx-portfolio" data-tab={view}>
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
      <KpiGroup items={items} lead className="cdx-portfolio__kpis" />
      <div className="cdx-portfolio__tabs">
        <Tabs
          panels
          idBase={tabsId}
          label="Portfolio sections"
          value={view}
          onChange={(next) => void navigate({ search: { tab: next === "coins" ? undefined : next }, replace: true, resetScroll: false })}
          options={[
            { value: "coins", label: counted("Coins", data?.holdings.length) },
            { value: "cards", label: counted("Cards", data?.deeds.length) },
            { value: "balances", label: counted("Balances", Object.keys(me.quoteBalances ?? { sol: 0 }).length) },
          ]}
        />
      </div>
      <div className="cdx-portfolio__grid">
        <section data-section="coins" className="cdx-portfolio__panel cdx-portfolio__coins" aria-label="Coins" {...panel("coins")}>
          <SectionHead title="Coins" right={data ? <span className="num">{data.holdings.length} held</span> : undefined} />
          {failed ? (
            retry("coins")
          ) : !data ? (
            <LoadingRows label="Loading your coins" />
          ) : data.holdings.length ? (
            <Holdings rows={data.holdings} />
          ) : (
            <EmptyState inline title="No coins yet" body="Buy a coin on its page, or launch one of your own." action={<><ButtonLink to="/discover">Discover coins</ButtonLink><TextLink to="/launch">Launch a coin</TextLink></>} />
          )}
        </section>
        <section data-section="cards" className="cdx-portfolio__panel cdx-portfolio__deck" aria-label="Cards" {...panel("cards")}>
          <SectionHead title="Cards" right={data ? <span className="num">{data.deeds.length} owned</span> : undefined} />
          {failed ? (
            retry("cards")
          ) : !data ? (
            <LoadingRows label="Loading your cards" />
          ) : data.deeds.length ? (
            <Cards rows={data.deeds} />
          ) : (
            <EmptyState inline title="No cards yet" body="Launch a coin to get its one-of-one card, with the design you choose." action={<TextLink to="/launch">Launch a coin</TextLink>} />
          )}
        </section>
        <section data-section="balances" className={cx("cdx-portfolio__panel cdx-portfolio__balances")} aria-label="Test balances" {...panel("balances")}>
          <SectionHead title="Test balances" right={<span className="text-caption text-slate">Separate demo balance per quote</span>} />
          <Balances me={me} byQuote={data?.totals.holdingsValueByQuote ?? {}} />
        </section>
      </div>
    </div>
  );
}

function Portfolio() {
  const me = useMe();
  return me ? <Collection me={me} /> : <SignedOut />;
}
