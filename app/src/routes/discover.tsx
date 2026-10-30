import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { num, searchSchema, text } from "../lib/mintdex/search";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import { View3DHost } from "../components/mintdex/card3d";
import {
  Button,
  GridCaption,
  Icon,
  IconButton,
  PageFrame,
  PageHeader,
  Pager,
  Shelf,
  ShelfItem,
  TextLink,
  fitCardGrid,
  useSize,
} from "../components/mintdex/ui";
import { EmptyState } from "../components/mintdex/empty-state";
import { useLoaderViewport } from "../components/mintdex/hooks";
import { PairLogo } from "../components/carddex/PairLogo";
import { launchCard, liveLaunchesQuery, matchesLaunch, type PublicLiveLaunch } from "../lib/carddex/live/launches";
import { getLaunchedCoins } from "../lib/carddex/live/launched";
import { getCardDesign } from "../lib/carddex/designs";
import { getPairAsset } from "../lib/carddex/pairs";
import { pageHead } from "../lib/mintdex/seo";

/*
 * Discover (MintDex's format): the header row (Discover, the count, then the Design pill), then the shelf: every
 * launched coin's card in its tray on a ledge, newest first, with its caption (name, then ticker and pair). Desktop
 * fits one page of cards to the screen (the pager in the header row turns pages, kept in ?page=); phones show every
 * card two up and the page scrolls, with the search field on top. The shelf deals in, leans toward the pointer and
 * shuffles on a Design change (Shelf, ui.tsx). Before the first launch: "No coins yet" and the Launch link.
 * Styles: styles/screens/discover.css.
 */
export const Route = createFileRoute("/discover")({
  validateSearch: searchSchema({
    q: text(40),
    design: text(40),
    focus: num(),
    page: num(),
  }),
  loader: () => getLaunchedCoins(),
  shouldReload: ({ cause }) => cause !== "stay",
  head: () =>
    pageHead({
      path: "/discover",
      title: "Discover | Launch a Card",
      description: "Every coin launched on pump.fun through Launch a Card, with the one-of-one card its pair picked.",
    }),
  component: Discover,
});

/** A shelf item: the coin's mint as its id, the launch and the card it minted. */
type Cell = { id: string; launch: PublicLiveLaunch; card: CardData };

/** The fitted desktop shelf: a 56px caption strip under each card, cards 132 to 240px wide (compact under 190). */
const FIT = { strip: 56, gap: 20, minW: 132, maxW: 240 };

/** Desktop (the fitted shelf) from 1024px; the server guesses from the root loader's viewport. */
const DESK_QUERY = "(min-width: 1024px)";
function subscribeDesk(cb: () => void) {
  const list = window.matchMedia(DESK_QUERY);
  list.addEventListener("change", cb);
  return () => list.removeEventListener("change", cb);
}
function useDesk(serverGuess: boolean) {
  return useSyncExternalStore(subscribeDesk, () => window.matchMedia(DESK_QUERY).matches, () => serverGuess);
}

function Discover() {
  const initial = Route.useLoaderData(),
    search = Route.useSearch();
  const navigate = useNavigate({ from: "/discover" });
  const query = search.q ?? "";
  const design = search.design ?? "";
  const go = (next: { q?: string; design?: string; page?: number }) =>
    void navigate({
      search: (previous) => ({ ...previous, ...next, page: next.page }),
      replace: true,
      resetScroll: false,
    });
  const setQuery = (value: string) => go({ q: value || undefined });
  // The server render's list seeds the query Home and the header search share; a failed server read leaves it to the
  // browser.
  const launches = useQuery({ ...liveLaunchesQuery, initialData: initial ?? undefined });
  const data = useMemo(() => launches.data ?? [], [launches.data]);
  // The Design pill lists the designs the coins on the shelf wear, by name.
  const designs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of data) {
      const d = getCardDesign(l.designKey);
      seen.set(d.key, d.name);
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);
  // Newest first, as the list arrives.
  const coins = useMemo<Cell[]>(
    () =>
      data
        .filter((l) => matchesLaunch(l, query))
        .filter((l) => !design || getCardDesign(l.designKey).key === design)
        .map((l) => ({ id: l.tokenMint, launch: l, card: launchCard(l) })),
    [data, query, design],
  );
  const items = useMemo(() => coins.map((c) => ({ id: c.id, card: c.card })), [coins]);
  const order = useMemo(() => new Map(coins.map((c, i) => [c.id, i])), [coins]);

  // The shelf's room: measured once mounted; the first frame (server and hydration) estimates it from the viewport.
  const vp = useLoaderViewport();
  const desk = useDesk((vp?.w ?? 390) >= 1024);
  const guess = vp && vp.w >= 1024 ? { width: vp.w - 224 - 48, height: (vp.h ?? 900) - 53 - 40 - 48 - 72 - 48 } : { width: 358, height: 600 };
  const [bodyRef, size] = useSize<HTMLDivElement>(guess);
  const fit = desk ? fitCardGrid(size.width, size.height, FIT, coins.length) : null;
  const perPage = fit ? fit.count : coins.length || 1;
  const pages = Math.max(1, Math.ceil(coins.length / perPage));
  const page = Math.min(Math.max(1, search.page ?? 1), pages) - 1;
  const visible = fit ? coins.slice(page * perPage, page * perPage + perPage) : coins;

  // Screen readers hear the match count once typing settles (not on load).
  const trimmed = query.trim();
  const matchText = trimmed ? `${coins.length} ${coins.length === 1 ? "coin matches" : "coins match"} “${trimmed}”` : `${coins.length} ${coins.length === 1 ? "coin" : "coins"}`;
  const [said, setSaid] = useState("");
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) { typed.current = true; return; }
    const timer = setTimeout(() => setSaid(matchText), 500);
    return () => clearTimeout(timer);
    // The count follows the query; the text is read when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const searchRef = useRef<HTMLInputElement>(null);
  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  const pills = (
    <>
      <label className="cdx-dex__pill">
        <span className="cdx-dex__pill-label">Design</span>
        <select
          className="mdx-select"
          value={design}
          onChange={(e) => go({ design: e.target.value || undefined })}
        >
          <option value="">{desk ? "All" : "All designs"}</option>
          {designs.map(([key, name]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <PageFrame className="mdx-page cdx-dex">
      {/* Phones: the search field over the title (desktop searches from the rail). */}
      <div className="cdx-dex__search lg:hidden">
        <label className="sr-only" htmlFor="discover-search">Search coins</label>
        <Icon name="search" className="cdx-dex__search-glyph" />
        <input
          ref={searchRef}
          id="discover-search"
          className="mdx-input"
          type="search"
          value={query}
          maxLength={40}
          placeholder="Search coins"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={search.focus === 1 && !desk}
        />
        {query ? <IconButton icon="close" label="Clear search" size="sm" className="cdx-dex__clear" onClick={clearSearch} /> : null}
      </div>
      <PageHeader
        title="Discover"
        className="cdx-dex__head"
        context={
          <>
            <span className="num">{coins.length}</span> {coins.length === 1 ? "coin" : "coins"}
            {trimmed ? <> for “{trimmed}” · <TextLink onClick={() => setQuery("")}>Clear</TextLink></> : null}
            {" · "}
            <TextLink to="/how" hash="cards">How it works</TextLink>
            <span className="sr-only" role="status">{said}</span>
          </>
        }
        toolbar={
          <>
            {pills}
            {/* The pager sits in the header row, so turning pages never changes the shelf's room. */}
            {fit && pages > 1 ? <Pager page={page} pages={pages} onPage={(next) => go({ page: next > 0 ? next + 1 : undefined })} /> : null}
          </>
        }
      />
      <div ref={bodyRef} className="cdx-dex__body">
        {coins.length > 0 ? (
          <Shelf
            items={visible}
            cols={fit ? fit.cols : 2}
            cardW={fit ? fit.cardW : undefined}
            gap={fit ? FIT.gap : 12}
            rowGap={fit ? FIT.gap : 16}
            keyOf={(c: Cell) => c.id}
            dealKey={`${design}|${trimmed}|${page}`}
            shuffleKey={design}
            parallax={desk}
            seedOf={(c: Cell) => order.get(c.id) ?? 0}
            render={(c: Cell, w) => <CoinCell coin={c} width={w} list={items} index={order.get(c.id) ?? 99} />}
          />
        ) : trimmed || design ? (
          <EmptyState
            inline
            title={trimmed ? `No coins match “${trimmed}”` : "No coins wear this design yet"}
            action={
              <Button variant="outline" size="sm" onClick={() => (trimmed ? clearSearch() : go({ design: undefined }))}>
                {trimmed ? "Clear search" : "All designs"}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No coins yet"
            action={<TextLink to="/launch">Launch a coin</TextLink>}
          />
        )}
      </div>
    </PageFrame>
  );
}

/** One shelf cell: the card in its tray (a link to the coin's page), then its caption: name, ticker and pair. */
function CoinCell({ coin, width, list, index }: { coin: Cell; width: number; list: Array<{ id: string; card: CardData }>; index: number }) {
  const { launch } = coin;
  const pair = getPairAsset(launch.quoteAssetKey);
  return (
    <View3DHost item={{ id: coin.id, card: coin.card }} list={list} style={{ maxWidth: width }}>
      <Link
        to="/coin/$id"
        params={{ id: coin.id }}
        className="block"
        aria-label={`${launch.name}, $${launch.ticker}, ${pair.symbol} pair, ${getCardDesign(launch.designKey).name} design`}
      >
        <ShelfItem
          width={width}
          card={
            // The first four load at once and at high priority; the rest when they near the screen.
            <MintCard card={coin.card} compact={width < 190} priority={index < 4} sizes="(max-width: 1023px) 36vw, 240px" />
          }
          caption={
            <GridCaption
              name={launch.name}
              value={<PairLogo asset={pair} size={16} />}
              sub={<span className="text-slate">${launch.ticker}</span>}
              subRight={<span className="text-slate">{pair.symbol}</span>}
            />
          }
        />
      </Link>
    </View3DHost>
  );
}
