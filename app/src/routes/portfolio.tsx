import { lazy, Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { useLiveWallet } from "../components/carddex/live/wallet";
import { PairLogo } from "../components/carddex/PairLogo";
import { View3DHost } from "../components/mintdex/card3d";
import { EmptyState } from "../components/mintdex/empty-state";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import { GridCaption, PageFrame, PageHeader, Skeleton, TextLink } from "../components/mintdex/ui";
import { getCardDesign } from "../lib/carddex/designs";
import { fetchCreatorLaunches, launchCard } from "../lib/carddex/live/launches";
import { getPairAsset } from "../lib/carddex/pairs";
import { EXPLORE_COINS } from "../lib/mintdex/copy";
import { NOINDEX_PORTFOLIO, pageHead } from "../lib/mintdex/seo";

/*
 * Portfolio: the coins the connected mainnet wallet launched here, each as the one-of-one card it minted (a link to
 * the coin's page). The wallet is the only identity: connect it (the same control as the rail and Launch) and the page
 * lists that wallet's finished launches; disconnected, it asks for the wallet. The coins and cards themselves live in
 * the wallet; this page only reads the launches this site recorded.
 * Styles: styles/screens/portfolio.css.
 */
// Older links (?tab=coins|cards|balances, ?page=) still open the page; the list has no tabs or pages now.
type PortfolioSearch = { tab?: "coins" | "cards" | "balances" | "bids" | "offers"; page?: number };
export const Route = createFileRoute("/portfolio")({
  validateSearch: (raw: Record<string, unknown>): PortfolioSearch => ({
    tab: raw.tab === "coins" || raw.tab === "cards" || raw.tab === "balances" || raw.tab === "bids" || raw.tab === "offers" ? raw.tab : undefined,
    page: Number.isInteger(Number(raw.page)) && Number(raw.page) >= 2 && Number(raw.page) <= 999 ? Number(raw.page) : undefined,
  }),
  head: () =>
    pageHead({
      path: "/portfolio",
      title: "Portfolio | Launch a Card",
      description: "The coins your Solana wallet launched on Launch a Card, each with its one-of-one NFT card.",
      noindex: NOINDEX_PORTFOLIO,
    }),
  component: Portfolio,
});

const LiveWalletButton = lazy(() => import("../components/carddex/live/LiveWalletButton").then((m) => ({ default: m.LiveWalletButton })));

function Portfolio() {
  const wallet = useLiveWallet();
  const address = wallet.address;
  if (!address) {
    return (
      <PageFrame className="mdx-page cdx-portfolio cdx-portfolio--out">
        <PageHeader title="Portfolio" />
        <EmptyState
          hero
          className="cdx-portfolio-empty"
          title="Your launches show here"
          body="Connect the wallet you launch with to see your coins and their cards."
          action={
            <div className="flex flex-col items-center gap-3">
              <Suspense fallback={null}>
                <LiveWalletButton compact />
              </Suspense>
              <TextLink to="/discover">{EXPLORE_COINS}</TextLink>
            </div>
          }
        />
      </PageFrame>
    );
  }
  return <Launches address={address} />;
}

function Launches({ address }: { address: string }) {
  const launches = useQuery({
    queryKey: ["live-launches", "creator", address],
    queryFn: () => fetchCreatorLaunches(address),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const rows = useMemo(() => launches.data ?? [], [launches.data]);
  const items = useMemo(() => rows.map((l) => ({ id: l.tokenMint, card: launchCard(l) as CardData })), [rows]);
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  return (
    <PageFrame className="mdx-page cdx-portfolio">
      <PageHeader
        title="Portfolio"
        context={
          <>
            <span className="num">{short}</span>
            {launches.isSuccess ? (
              <>
                {" · "}
                <span className="num">{rows.length}</span> {rows.length === 1 ? "coin launched" : "coins launched"}
              </>
            ) : null}
          </>
        }
      />
      {launches.isPending ? (
        <div className="cdx-portfolio-launches" aria-busy="true">
          <Skeleton className="h-[260px] rounded-panel" />
          <Skeleton className="h-[260px] rounded-panel" />
        </div>
      ) : launches.isError && !rows.length ? (
        <EmptyState
          inline
          title="Couldn't load your launches"
          action={
            <TextLink onClick={() => void launches.refetch()} disabled={launches.isFetching}>
              {launches.isFetching ? "Trying again…" : "Try again"}
            </TextLink>
          }
        />
      ) : rows.length ? (
        <ul className="cdx-portfolio-launches">
          {rows.map((l, i) => {
            const pair = getPairAsset(l.quoteAssetKey);
            return (
              <li key={l.tokenMint}>
                <View3DHost item={items[i]} list={items}>
                  <Link
                    to="/coin/$id"
                    params={{ id: l.tokenMint }}
                    className="block"
                    aria-label={`${l.name}, $${l.ticker}, ${pair.symbol} pair, ${getCardDesign(l.designKey).name} design`}
                  >
                    <MintCard card={items[i].card} priority={i < 4} sizes="(max-width: 1023px) 44vw, 220px" />
                    <GridCaption
                      name={l.name}
                      value={<PairLogo asset={pair} size={16} />}
                      sub={<span className="text-slate">${l.ticker}</span>}
                      subRight={<span className="text-slate">{pair.symbol}</span>}
                    />
                  </Link>
                </View3DHost>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title="No coins launched yet"
          body="Coins this wallet launches here show up with their cards."
          action={<TextLink to="/launch">Launch a coin</TextLink>}
        />
      )}
    </PageFrame>
  );
}
