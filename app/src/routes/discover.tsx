import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { num, oneOf, searchSchema, text } from "../lib/mintdex/search";
import { CoinTile } from "../components/carddex/GalleryTile";
import {
  AutoGrid,
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

/** Every coin up to 48 is laid out on the page (density R4); a longer list shows its first 48 and one "Show all N
 * coins" that expands in place (the page param stays in the URL: any value above 1 means expanded). */
const INLINE = 48;

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
  const expanded = (search.page ?? 1) > 1;
  const visible = expanded ? coins : coins.slice(0, INLINE);
  // "Show all" moves focus to the first coin it added, so keyboard users carry on from there.
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
  // The count is announced once typing pauses (500ms), not on every keystroke: a quiet status of its own, with the
  // visible words. Nothing is said on arrival.
  const matchText = query.trim() ? `${coins.length} ${coins.length === 1 ? "coin matches" : "coins match"} “${query.trim()}”` : `${coins.length} ${coins.length === 1 ? "coin" : "coins"}`;
  const [said, setSaid] = useState("");
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) { typed.current = true; return; }
    const timer = setTimeout(() => setSaid(matchText), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const clearSearch = () => {
    // The field stays mounted; carry focus back to it so typing can start again.
    setQuery("");
    searchRef.current?.focus();
  };
  return (
    <PageFrame className="cdx-discover">
      {/* One header row from 1024px: the title and its one line (count, sort, the page's Simulated label), then
          search, sort and the primary. Only the count phrase ellipsizes, so a long query never hides Simulated. */}
      <PageHeader
        title="Discover"
        context={
          <>
            <span className="cdx-discover__ctx">
              <span>
                {count}
                {query.trim()
                  ? ` ${coins.length === 1 ? "matches" : "match"} “${query.trim()}”`
                  : null}
              </span>{" "}
              · sorted by {sortLabel}
            </span>{" "}
            <SimTag className="cdx-discover__sim" />
            <span className="sr-only" role="status">{said}</span>
          </>
        }
        toolbar={
          <>
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
          </>
        }
        right={
          <ButtonLink to="/launch" className="cdx-discover__launch">
            Launch a coin
          </ButtonLink>
        }
      />
      <div className="cdx-discover__body">
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
          <AutoGrid ref={gridRef} min="var(--coin-min)" className="cdx-token-grid">
            {visible.map((c, i) => (
              <li key={c.id} className="cdx-token-item">
                {/* The first rows load at once and at high priority; the rest when they near the screen. The sizes match
                    the laid-out card (half the column on phones, a quarter on tablets, about 160-200px above). */}
                <CoinTile
                  coin={c}
                  list={items}
                  priority={i < 8}
                  sizes="(max-width: 767px) 50vw, (max-width: 1023px) 25vw, 200px"
                />
              </li>
            ))}
          </AutoGrid>
        ) : query.trim() ? (
          <EmptyState
            compact
            title={`No coins match “${query.trim()}”`}
            action={
              <Button variant="outline" size="sm" onClick={clearSearch}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No coins yet"
            body="Every coin launched here shows up with its card. Launch the first one."
            action={<TextLink to="/levels">Browse card designs</TextLink>}
          />
        )}
        {!expanded && coins.length > INLINE ? (
          <div className="cdx-discover__more">
            <span className="cdx-discover__shown">
              Showing <span className="tabular-nums">{INLINE}</span> of{" "}
              <span className="tabular-nums">{coins.length}</span>
            </span>
            <Button
              variant="outline"
              onClick={() => {
                focusFrom.current = INLINE;
                void navigate({
                  search: (s) => ({ ...s, page: 2 }),
                  replace: true,
                  resetScroll: false,
                });
              }}
            >
              {/* One text run: the button's flex gap would otherwise space out the count. */}
              <span className="tabular-nums">{`Show all ${coins.length} coins`}</span>
            </Button>
          </div>
        ) : null}
      </div>
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
        toolbar={
          <>
            <span aria-hidden className="cdx-discover__search cdx-skel cdx-skel--field" />
            <span aria-hidden className="cdx-skel cdx-skel--select" />
          </>
        }
        right={
          <ButtonLink to="/launch" className="cdx-discover__launch">
            Launch a coin
          </ButtonLink>
        }
      />
      <div className="cdx-discover__body">
        <p className="sr-only" role="status">
          Loading coins
        </p>
        {/* 14 tiles: the two rows above the fold at 1440 (7 columns). */}
        <div aria-hidden>
          <AutoGrid min="var(--coin-min)" className="cdx-token-grid">
            {Array.from({ length: 14 }, (_, i) => (
              <li key={i} className="cdx-token-item">
                <div className="cdx-token-cell cdx-token-cell--skel">
                  <span className="cdx-skel cdx-skel--card" />
                  <span className="cdx-token-cell__caption">
                    <span className="cdx-skel cdx-skel--name" />
                    <span className="cdx-skel cdx-skel--ticker" />
                    <span className="cdx-skel cdx-skel--track" />
                  </span>
                </div>
              </li>
            ))}
          </AutoGrid>
        </div>
      </div>
    </PageFrame>
  );
}
