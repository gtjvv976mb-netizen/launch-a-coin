import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { num, oneOf, searchSchema, text } from "../lib/mintdex/search";
import { MintCard } from "../components/mintdex/MintCard";
import { View3DHost } from "../components/mintdex/card3d";
import {
  Button,
  Change,
  GridCaption,
  Icon,
  IconButton,
  Num,
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
import { listCoins } from "../lib/mintdex/api";
import { getCardDesign } from "../lib/carddex/designs";
import { marketCapText, marketCapWatch } from "../lib/carddex/quote-display";
import { pageHead } from "../lib/mintdex/seo";
import { sortCoins } from "../lib/mintdex/sort";
import type { CoinSummary } from "../lib/mintdex/types";

/*
 * Discover (MintDex's format): the header row (Discover, the count, then the Design and Sort pills), then the shelf:
 * every coin's card in its tray on a ledge, with its caption (name and market cap, ticker and 24h). Desktop fits one
 * page of cards to the screen (the pager in the header row turns pages, kept in ?page=); phones show every card two
 * up and the page scrolls, with the search field on top. The shelf deals in, leans toward the pointer and shuffles on a Design or
 * Sort change (Shelf, ui.tsx). Styles: styles/screens/discover.css.
 */
export const Route = createFileRoute("/discover")({
  validateSearch: searchSchema({
    q: text(40),
    sort: oneOf(["trending", "mcap", "new", "next"]),
    design: text(40),
    focus: num(),
    tier: num(),
    page: num(),
  }),
  loader: () => listCoins({ data: {} }),
  shouldReload: ({ cause }) => cause !== "stay",
  head: () =>
    pageHead({
      path: "/discover",
      title: "Discover | Launch a Card",
      description:
        "Discover coins and their creator-selected NFT trading cards. A demo with simulated pump.fun trading.",
    }),
  component: Discover,
});

const SORTS = [
  { value: "trending", label: "Trending" },
  { value: "mcap", label: "Market cap" },
  { value: "new", label: "Newest" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

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
  const sort: Sort = search.sort === "mcap" || search.sort === "new" ? search.sort : "trending";
  const design = search.design ?? "";
  const go = (next: { q?: string; sort?: Sort; design?: string; page?: number }) =>
    void navigate({
      search: (previous) => ({ ...previous, ...next, page: next.page }),
      replace: true,
      resetScroll: false,
    });
  const setQuery = (value: string) => go({ q: value || undefined });
  const { data } = useQuery({
    queryKey: ["coins", {}],
    queryFn: () => listCoins({ data: {} }),
    initialData: initial,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  // The Design pill lists the designs the coins on the shelf wear, by name.
  const designs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of data) {
      const d = getCardDesign(c.cardTemplate);
      seen.set(d.key, d.name);
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);
  // One order for every sort, shared with the server and Home (lib/mintdex/sort.ts): fair across pairs.
  const coins = useMemo(
    () =>
      sortCoins(
        data
          .filter((c) => `${c.name} ${c.ticker}`.toLowerCase().includes(query.trim().toLowerCase().replace(/^\$/, "")))
          .filter((c) => !design || getCardDesign(c.cardTemplate).key === design),
        sort,
      ),
    [data, query, sort, design],
  );
  const items = useMemo(() => coins.map((c) => ({ id: c.id, card: c })), [coins]);
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
      <label className="cdx-dex__pill">
        <span className="cdx-dex__pill-label">Sort</span>
        <select
          className="mdx-select"
          value={sort}
          onChange={(e) => go({ sort: e.target.value === "trending" ? undefined : (e.target.value as Sort) })}
        >
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
            keyOf={(c: CoinSummary) => c.id}
            dealKey={`${sort}|${design}|${trimmed}|${page}`}
            shuffleKey={`${sort}|${design}`}
            parallax={desk}
            seedOf={(c: CoinSummary) => c.dexNo}
            render={(c: CoinSummary, w) => <CoinCell coin={c} width={w} list={items} index={order.get(c.id) ?? 99} />}
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

/**
 * One shelf cell: the card in its tray (a link to the coin), then its caption. A market cap in the coin's own quote
 * ("38.84K DOGE") takes the second line beside the ticker, so a long name never pushes it out (VIS-5).
 */
function CoinCell({ coin, width, list, index }: { coin: CoinSummary; width: number; list: Array<{ id: string; card: CoinSummary }>; index: number }) {
  const mc = marketCapText(coin);
  const native = coin.mcapUsd == null;
  const figure = (
    <Num size="sm" tone="inherit" watch={marketCapWatch(coin)}>
      {mc}
    </Num>
  );
  return (
    <View3DHost item={{ id: coin.id, card: coin }} list={list} style={{ maxWidth: width }}>
      <Link
        to="/coin/$id"
        params={{ id: coin.id }}
        className="block"
        aria-label={`${coin.name}, $${coin.ticker}, market cap ${mc}, ${getCardDesign(coin.cardTemplate).name} design`}
      >
        <ShelfItem
          width={width}
          card={
            // The first four load at once and at high priority; the rest when they near the screen. The sizes follow
            // the laid-out card (under half the screen on phones, 150 to 240px on the fitted desktop shelf).
            <MintCard card={coin} compact={width < 190} priority={index < 4} sizes="(max-width: 1023px) 46vw, 240px" />
          }
          caption={
            <GridCaption
              name={coin.name}
              value={native ? undefined : figure}
              sub={<span className="text-slate">${coin.ticker}</span>}
              subRight={native ? figure : <Change v={coin.change24h} />}
            />
          }
        />
      </Link>
    </View3DHost>
  );
}
