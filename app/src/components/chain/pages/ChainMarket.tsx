/**
 * The card market on devnet (refs/chain/m3-contract.md §2.2 Market). The page keeps the test-mode shelf (listings,
 * top bids, every card, recent sales from GET /market); a tile opens the card's market sheet instead of leaving
 * the page: the card, its holder, buy now, the bids, and the same actions as the coin page (place, raise and
 * cancel a bid, accept at the amount shown, list with a price, an end date and void-on-unlock, re-price, delist,
 * buy now, withdraw), through the shared card panel (ChainCardPanel). The tile is still a link to the coin page,
 * so a middle click or Cmd click opens the coin in a new tab.
 *
 * Owner: app:pages. Data: the coin detail read (lib/chain/data.ts chainCoinPage), shared with the coin page's
 * cache key, polled while the sheet is open.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";

import { boostedPollMs, chainCoinPage, takeFresh, useChainWallet, type ChainCoinPage } from "../../../lib/chain/data";
import { num } from "../../../lib/chain/adapt";
import { MARKET_COPY } from "../../../lib/mintdex/copy";
import { marketCapText, marketCapWatch } from "../../../lib/carddex/quote-display";
import { tierForLevel } from "../../../lib/mintdex/tiers";
import type { CoinSummary } from "../../../lib/mintdex/types";
import { CardBack, View3DHost, type Card3DHandle } from "../../mintdex/card3d";
import { useClaimable } from "../../mintdex/cases";
import { MintCard } from "../../mintdex/MintCard";
import {
  GridCaption,
  LabelNum,
  Modal,
  Num,
  ShelfItem,
  Skeleton,
  TextLink,
  solFigure,
} from "../../mintdex/ui";
import { EmptyState } from "../../mintdex/empty-state";
import { ChainCardPanel, unlockText } from "./ChainCardPanel";
import { useViewer } from "./tx";
import { APP_CLUSTER, NET_NAME } from "../../../lib/chain/env";

/** The Market tabs: All cards (the default), For sale, With bids. */
export type MarketView = "all" | "listed" | "bids";

/**
 * A Market tile's second caption line: one figure for the tab. For sale shows the buy now price, With bids the top
 * bid, All cards whichever exists (buy now first), else nothing (the line stays, empty). One figure fits a 150px
 * tile (market.tsx GRID.minW), so no price is ever cut short. The tile's link label still reads both.
 */
export function MarketOffer({ coin, view }: { coin: CoinSummary; view: MarketView }) {
  if (view !== "bids" && coin.listPrice != null) {
    return <LabelNum label="Buy now" value={`${solFigure(coin.listPrice)} SOL`} />;
  }
  if (view !== "listed" && coin.topBid != null) {
    return <LabelNum label="Top bid" value={`${solFigure(coin.topBid)} SOL`} />;
  }
  return null;
}

/**
 * A link to a coin page that opens the card's market sheet on a plain click (a modified click still opens the
 * coin in a new tab or window). Renders the sheet next to itself.
 */
export function SheetLink({
  coin,
  className = "",
  label,
  children,
}: {
  coin: CoinSummary;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setOpen(true);
  };
  return (
    <>
      <Link
        to="/coin/$id"
        params={{ id: coin.id }}
        aria-label={label}
        aria-haspopup="dialog"
        className={className}
        onClick={onClick}
      >
        {children}
      </Link>
      <ChainCardSheet coin={coin} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** One shelf cell on devnet: the test-mode Market tile, opening the card's market sheet on a plain click. */
export function ChainMarketTile({
  coin,
  width,
  view = "all",
}: {
  coin: CoinSummary;
  width: number;
  view?: MarketView;
}) {
  const mcap = marketCapText(coin);
  const label = [
    `${coin.name}, ${tierForLevel(coin.level).name} design`,
    `market cap ${mcap}`,
    coin.listPrice != null ? `buy now ${solFigure(coin.listPrice)} SOL` : "not listed",
    coin.topBid != null ? `top bid ${solFigure(coin.topBid)} SOL` : "no bids",
  ].join(", ");
  return (
    <View3DHost item={{ id: coin.id, card: coin }} style={{ maxWidth: width }}>
      <SheetLink coin={coin} label={label} className="block">
      <ShelfItem
        width={width}
        card={<MintCard card={coin} compact={width < 210} />}
        caption={
          <GridCaption
            name={coin.name}
            value={
              <Num size="sm" tone="inherit" watch={marketCapWatch(coin)}>
                {mcap}
              </Num>
            }
            sub={<MarketOffer coin={coin} view={view} />}
          />
        }
      />
      </SheetLink>
    </View3DHost>
  );
}

/**
 * The card's market sheet: the card, its market cap and the coin page link on the left, the card panel (holder,
 * design, unlock, fee vault, listing, bids and every market action) on the right. A bottom sheet on phones
 * (Modal): there the card (112px) and its link sit side by side, so the panel and the bid row start on the first
 * screen.
 */
export function ChainCardSheet({
  coin,
  open,
  onOpenChange,
}: {
  coin: CoinSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mint = coin.id;
  const { data: page, isError } = useQuery({
    queryKey: ["coin", mint],
    queryFn: async (): Promise<ChainCoinPage | null> => chainCoinPage(mint, { fresh: takeFresh(mint) }),
    enabled: open,
    staleTime: 3_000,
    refetchInterval: (q) => (open ? boostedPollMs(mint, !!q.state.data && q.state.data.detail.card.pendingLevel > 0) : false),
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`The ${coin.name} card`} width={760}>
      {page ? (
        <SheetBody page={page} />
      ) : page === null ? (
        <EmptyState
          title={MARKET_COPY.gone}
          body={`It has no MintDex card${APP_CLUSTER === "mainnet" ? "" : " on devnet"} anymore.`}
          action={<TextLink to="/discover">{MARKET_COPY.explore}</TextLink>}
        />
      ) : isError ? (
        <p role="alert" className="text-[13px] leading-[1.45] text-down">
          {NET_NAME} did not answer. Close this and try again in a moment.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)]" aria-busy="true">
          <Skeleton onWall className="mx-auto w-[160px] rounded-[5.04%/3.61%] sm:w-full" style={{ aspectRatio: "63 / 88" }} />
          <Skeleton className="h-[320px] rounded-panel" />
        </div>
      )}
    </Modal>
  );
}

function SheetBody({ page }: { page: ChainCoinPage }) {
  const viewer = useViewer();
  const { wallet } = useChainWallet(viewer.address);
  const balance = wallet ? num(wallet.lamports) : viewer.balance;
  const coin = page.coin;
  const card = page.detail.card;
  const unlocking = unlockText(card);
  // The card in the sheet is in your hand: it lifts in after the sheet, breathes, a tap turns it over, and a
  // purchase from this sheet plays Claim on it before the toast.
  const cardEl = useRef<HTMLDivElement>(null);
  const cardHandle = useRef<Card3DHandle | null>(null);
  useClaimable(coin.id, cardEl, cardHandle);
  return (
    <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      {/* The design is the panel's Design row (and the card's own frame), so this column keeps the market cap. */}
      <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-4 sm:flex sm:flex-col sm:items-stretch sm:gap-0">
        <div ref={cardEl} className="mdx-pocket w-[112px] sm:w-full">
          {card.cardMintVerified ? (
            <MintCard ref={cardHandle} card={coin} depth="hand" idle="breathe" />
          ) : (
            <CardBack depth="hand" title="This card's mint could not be verified, so its art is not shown." />
          )}
        </div>
        <div className="flex min-w-0 flex-col sm:mt-4">
          <dl className="mdx-leaders flex w-full flex-col gap-1.5">
            <div className="text-[13px]">
              <dt className="text-slate">Market cap</dt>
              <dd>
                <Num size="sm">{marketCapText(coin)}</Num>
              </dd>
            </div>
          </dl>
          {unlocking ? <p className="mt-2 w-full text-[12px] leading-[1.45] text-slate">{unlocking}</p> : null}
          <TextLink to="/coin/$id" params={{ id: coin.id }} className="mt-3 self-start text-[13px]">
            Open the coin page
          </TextLink>
        </div>
      </div>
      <ChainCardPanel page={page} viewer={viewer} wallet={wallet} balance={balance} bidFit={5} className="min-w-0" />
    </div>
  );
}
