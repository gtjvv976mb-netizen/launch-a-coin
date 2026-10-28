import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { num, oneOf, searchSchema, text } from "../lib/mintdex/search";
import { CoinTile } from "../components/carddex/GalleryTile";
import {
  Button,
  ButtonLink,
  IconButton,
  Icon,
  PageFrame,
  PageHeader,
  SortMenu,
  TextLink,
} from "../components/mintdex/ui";
import { EmptyState } from "../components/mintdex/empty-state";
import { SimTag } from "../components/mintdex/trust";
import { listCoins } from "../lib/mintdex/api";
import { pageHead } from "../lib/mintdex/seo";

export const Route = createFileRoute("/discover")({
  validateSearch: searchSchema({
    q: text(40),
    sort: oneOf(["trending", "mcap", "new", "next"]),
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
        "Explore coins and their creator-selected NFT trading cards. A demo with simulated pump.fun trading.",
    }),
  pendingComponent: DiscoverPending,
  component: Discover,
});

const SORTS = [
  { value: "trending", label: "Trending" },
  { value: "mcap", label: "Market cap" },
  { value: "new", label: "Newest" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

/** About 12 coins per batch, rounded up to whole rows of the live grid: "Show more coins" never leaves an orphan row. */
const BATCH = 12;
const batchFor = (cols: number) => Math.ceil(BATCH / Math.max(1, cols)) * Math.max(1, cols);

/** The grid's live column count (CSS decides it: 2 on phones, 3 on tablets, as many 190px columns as fit above). */
function useGridColumns(ref: { current: HTMLElement | null }, deps: unknown) {
  const [cols, setCols] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const n = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
      setCols((old) => (old === n ? old : n));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, deps]);
  return cols;
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Discover() {
  const initial = Route.useLoaderData(),
    search = Route.useSearch();
  const navigate = useNavigate({ from: "/discover" });
  const query = search.q ?? "";
  const sort: Sort = search.sort === "mcap" || search.sort === "new" ? search.sort : "trending";
  const setQuery = (value: string) =>
    void navigate({
      search: (previous) => ({ ...previous, q: value || undefined, page: undefined }),
      replace: true,
      resetScroll: false,
    });
  const { data, isError, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["coins", {}],
    queryFn: () => listCoins({ data: {} }),
    initialData: initial,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const coins = useMemo(
    () =>
      data
        .filter((c) => `${c.name} ${c.ticker}`.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) =>
          sort === "new"
            ? b.createdAt - a.createdAt
            : sort === "mcap"
              ? (b.mcapUsd ?? -1) - (a.mcapUsd ?? -1)
              : (b.volume24h ?? -1) - (a.volume24h ?? -1),
        ),
    [data, query, sort],
  );
  const gridRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cols = useGridColumns(gridRef, coins.length > 0);
  // Before the grid is measured (server HTML) the batch is 12; once the columns are known it fills whole rows.
  const batch = cols ? batchFor(cols) : BATCH;
  const batches = Math.max(1, Math.ceil(coins.length / batch));
  const shownBatches = Math.min(Math.max(1, search.page ?? 1), batches);
  const visible = coins.slice(0, shownBatches * batch);
  // "Show more coins" moves focus to the first coin it added, so keyboard users carry on from there.
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    const from = focusFrom.current;
    if (from == null || visible.length <= from) return;
    focusFrom.current = null;
    gridRef.current?.children[from]?.querySelector<HTMLElement>(".cdx-token-cell__link")?.focus();
  }, [visible.length]);
  const items = useMemo(() => coins.map((c) => ({ id: c.id, card: c })), [coins]);
  const sortLabel = SORTS.find((s) => s.value === sort)!.label.toLowerCase();
  const count = (
    <>
      <span className="tabular-nums">{coins.length}</span> {coins.length === 1 ? "coin" : "coins"}
    </>
  );
  const clearSearch = () => {
    // The field stays mounted; carry focus back to it so typing can start again.
    setQuery("");
    searchRef.current?.focus();
  };
  return (
    <PageFrame className="cdx-discover">
      <PageHeader
        title="Discover"
        context={
          <>
            <span aria-live="polite">
              {count}
              {query.trim()
                ? ` ${coins.length === 1 ? "matches" : "match"} “${query.trim()}”`
                : null}
            </span>{" "}
            · sorted by {sortLabel} <SimTag className="cdx-discover__sim" />
          </>
        }
        right={<ButtonLink to="/launch">Launch a coin</ButtonLink>}
      />
      <div className="cdx-discover__tools">
        <div className="cdx-discover__search">
          <label className="sr-only" htmlFor="token-search">
            Search coins
          </label>
          <Icon name="search" className="cdx-discover__search-glyph" />
          <input
            ref={searchRef}
            id="token-search"
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
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            autoFocus={search.focus === 1}
          />
          {query ? (
            <IconButton
              icon="close"
              label="Clear search"
              size="sm"
              className="cdx-discover__clear"
              onClick={clearSearch}
            />
          ) : null}
        </div>
        <SortMenu
          value={sort}
          options={[...SORTS]}
          label="Sort"
          labelClassName="max-md:sr-only"
          onChange={(value) =>
            void navigate({
              search: (previous) => ({
                ...previous,
                sort: value === "trending" ? undefined : value,
                page: undefined,
              }),
              replace: true,
              resetScroll: false,
            })
          }
        />
      </div>
      {isError && !isFetching ? (
        <p className="cdx-discover__stale" role="status">
          <Icon name="warning" className="cdx-discover__stale-glyph" />
          <span>
            Couldn't refresh the coin list. Showing figures from{" "}
            <span className="tabular-nums">{clock(dataUpdatedAt)}</span>.
          </span>{" "}
          <TextLink onClick={() => void refetch()}>Try again</TextLink>
        </p>
      ) : null}
      {coins.length > 0 ? (
        <ul ref={gridRef} role="list" className="cdx-token-grid">
          {visible.map((c, i) => (
            <li key={c.id} className="cdx-token-item">
              {/* The first row loads at once and at high priority; the rest when they near the screen. The sizes match the
                  laid-out card (half the column below 600px, a third below 1024, about 200px above). */}
              <CoinTile
                coin={c}
                list={items}
                priority={i < 5}
                sizes="(max-width: 599px) 50vw, (max-width: 1023px) 33vw, 220px"
              />
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <EmptyState
          inline
          className="cdx-discover__empty"
          title={`No coins match “${query.trim()}”`}
          body="Check the spelling, or search by name or ticker."
          action={
            <div className="cdx-discover__empty-actions">
              <Button variant="outline" onClick={clearSearch}>
                Clear search
              </Button>
              <TextLink to="/levels">Browse card designs</TextLink>
            </div>
          }
        />
      ) : (
        <EmptyState
          className="cdx-discover__empty"
          title="No coins yet"
          body="Every coin launched here shows up with its card. Launch the first one."
          action={<TextLink to="/levels">Browse card designs</TextLink>}
        />
      )}
      {shownBatches < batches ? (
        <div className="cdx-discover__more">
          <span className="cdx-discover__shown">
            Showing <span className="tabular-nums">{visible.length}</span> of{" "}
            <span className="tabular-nums">{coins.length}</span>
          </span>
          <Button
            variant="outline"
            onClick={() => {
              focusFrom.current = visible.length;
              void navigate({
                search: (s) => ({ ...s, page: shownBatches + 1 }),
                replace: true,
                resetScroll: false,
              });
            }}
          >
            Show more coins
          </Button>
        </div>
      ) : null}
    </PageFrame>
  );
}

/**
 * While the coin list loads (a client-side visit slower than the router's pending delay): the final layout with each
 * value as a flat bar at its real size, no shimmer, so nothing moves when the coins land.
 */
function DiscoverPending() {
  return (
    <PageFrame className="cdx-discover">
      <PageHeader
        title="Discover"
        context={<span className="cdx-skel cdx-skel--context" />}
        right={<ButtonLink to="/launch">Launch a coin</ButtonLink>}
      />
      <div className="cdx-discover__tools" aria-hidden>
        <span className="cdx-skel cdx-skel--field" />
        <span className="cdx-skel cdx-skel--select" />
      </div>
      <p className="sr-only" role="status">
        Loading coins
      </p>
      <ul role="list" className="cdx-token-grid" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <li key={i} className="cdx-token-item">
            <div className="cdx-token-cell">
              <span className="cdx-skel cdx-skel--card" />
              <span className="cdx-token-cell__caption">
                <span className="cdx-skel cdx-skel--name" />
                <span className="cdx-skel cdx-skel--ticker" />
                <span className="cdx-skel cdx-skel--track" />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </PageFrame>
  );
}
