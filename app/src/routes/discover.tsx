import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { MintCard } from "../components/mintdex/MintCard";
import { View3DHost } from "../components/mintdex/card3d";
import { Button, ButtonLink, PageFrame, Change } from "../components/mintdex/ui";
import { SimTag } from "../components/mintdex/trust";
import { listCoins } from "../lib/mintdex/api";
import { getCardDesign } from "../lib/carddex/designs";
import { marketCapText } from "../lib/carddex/quote-display";
import { pageHead } from "../lib/mintdex/seo";
import "../carddex.css";

export const Route = createFileRoute("/discover")({
  validateSearch: z.object({
    q: z.string().max(40).optional().catch(undefined),
    sort: z.enum(["trending", "mcap", "new", "next"]).optional().catch(undefined),
    focus: z.number().optional().catch(undefined),
    tier: z.number().optional().catch(undefined),
    page: z.number().optional().catch(undefined),
  }),
  loader: () => listCoins({ data: {} }),
  shouldReload: ({ cause }) => cause !== "stay",
  head: () =>
    pageHead({
      path: "/discover",
      title: "Discover coins | Launch a Card",
      description:
        "Explore coins and their creator-selected NFT trading cards. A demo with simulated pump.fun trading.",
    }),
  component: Discover,
});
/** Tokens shown per batch; "Show more tokens" adds another batch (kept in ?page= so Back returns to it). */
const BATCH = 12;
function Discover() {
  const initial = Route.useLoaderData(),
    search = Route.useSearch();
  const navigate = useNavigate({ from: "/discover" });
  const query = search.q ?? "";
  const setQuery = (value: string) => void navigate({
    search: (previous) => ({ ...previous, q: value || undefined, page: undefined }),
    replace: true,
    resetScroll: false,
  });
  const { data } = useQuery({
    queryKey: ["coins", {}],
    queryFn: () => listCoins({ data: {} }),
    initialData: initial,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const coins = useMemo(
    () =>
      data
        .filter((c) => `${c.name} ${c.ticker}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) =>
          search.sort === "new"
            ? b.createdAt - a.createdAt
            : search.sort === "mcap"
              ? (b.mcapUsd ?? -1) - (a.mcapUsd ?? -1)
              : (b.volume24h ?? -1) - (a.volume24h ?? -1),
        ),
    [data, query, search.sort],
  );
  const batches = Math.max(1, Math.ceil(coins.length / BATCH));
  const shownBatches = Math.min(Math.max(1, search.page ?? 1), batches);
  const visible = coins.slice(0, shownBatches * BATCH);
  // "Show more tokens" moves focus to the first token it added, so keyboard users carry on from there.
  const gridRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    const from = focusFrom.current;
    if (from == null || visible.length <= from) return;
    focusFrom.current = null;
    gridRef.current?.children[from]?.querySelector<HTMLElement>(".cdx-token-cell__caption")?.focus();
  }, [visible.length]);
  const items = coins.map((c) => ({ id: c.id, card: c }));
  return (
    <PageFrame className="cdx-discover">
      <header className="cdx-archive__head">
        {/* The chip wraps under the title when the row is narrow, and keeps a clear 12px gap beside it. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="mdx-h1 cdx-discover__title">The collection.</h1>
          <SimTag className="mt-1.5" />
        </div>
        <Link to="/launch" className="mdx-link min-h-11 inline-flex items-center">
          Launch a coin
        </Link>
      </header>
      <div className="cdx-discover__tools">
        <label className="sr-only" htmlFor="token-search">
          Search coins
        </label>
        <input
          ref={searchRef}
          id="token-search"
          className="mdx-input"
          type="search"
          value={query}
          maxLength={40}
          placeholder="Search a coin or ticker…"
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={search.focus === 1}
        />
        <label className="sr-only" htmlFor="token-sort">
          Sort coins
        </label>
        <select
          id="token-sort"
          className="mdx-input"
          value={search.sort === "next" ? "trending" : (search.sort ?? "trending")}
          onChange={(e) =>
            void navigate({
              search: {
                q: query || undefined,
                sort: e.target.value as "trending" | "mcap" | "new",
              },
              replace: true,
            })
          }
        >
          <option value="trending">Trending</option>
          <option value="mcap">Market cap</option>
          <option value="new">Newest</option>
        </select>
      </div>
      <p className="cdx-discover__count" aria-live="polite">
        {coins.length === 1 ? "1 coin" : `${coins.length} coins`}
      </p>
      {coins.length > 0 ? (
        <ul ref={gridRef} role="list" className="cdx-token-grid">
          {visible.map((c, i) => (
            <li key={c.id} className="cdx-token-item">
              <article className="cdx-token-cell">
                <View3DHost item={{ id: c.id, card: c }} list={items}>
                  <Link
                    to="/coin/$id"
                    params={{ id: c.id }}
                    aria-label={`${c.name} $${c.ticker}, open coin, ${getCardDesign(c.cardTemplate).name} design`}
                  >
                    {/* The first row loads at once and at high priority; the rest when they near the screen. The sizes match the
                        laid-out card (two columns below 1024, about 200px above), so sharp screens get the 320px copies. */}
                    <MintCard card={c} depth="table" idle="turntable" priority={i < 4} sizes="(max-width: 1023px) 50vw, 200px" />
                  </Link>
                </View3DHost>
                <Link to="/coin/$id" params={{ id: c.id }} className="cdx-token-cell__caption">
                  <div>
                    <h2 className="cdx-token-cell__name">
                      <strong>{c.name}</strong>
                    </h2>
                    <span>${c.ticker}</span>
                  </div>
                  <div>
                    <span>{marketCapText(c)}</span>
                    <Change v={c.change24h} />
                  </div>
                </Link>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <div className="cdx-empty" role="status">
          <p>{query ? `No coins match “${query}”.` : "No coins yet."}</p>
          <div className="cdx-empty__actions">
            {query ? (
              <Button variant="outline" onClick={() => {
                // The button unmounts once the list fills again; carry focus to the search box it cleared.
                setQuery("");
                searchRef.current?.focus();
              }}>
                Clear search
              </Button>
            ) : null}
            <ButtonLink to="/launch">Launch a coin</ButtonLink>
          </div>
        </div>
      )}
      {shownBatches < batches ? (
        <div className="cdx-discover__more">
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
            Show more tokens
          </Button>
          <span>
            Showing {visible.length} of {coins.length}
          </span>
        </div>
      ) : null}
    </PageFrame>
  );
}
