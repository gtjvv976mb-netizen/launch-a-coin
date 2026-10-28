import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, type CSSProperties } from "react";
import { PageControls, usePageCapacity } from "../components/carddex/Viewport";
import { z } from "zod";
import { MintCard } from "../components/mintdex/MintCard";
import { View3DHost } from "../components/mintdex/card3d";
import { PageFrame, Change } from "../components/mintdex/ui";
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
  const grid = usePageCapacity({ rowHeight:300, minWidth:190, maxColumns:4, maxRows:2 });
  const pages = Math.max(1, Math.ceil(coins.length / grid.count));
  const page = Math.min(Math.max(0, (search.page ?? 1) - 1), pages - 1);
  const visible = coins.slice(page * grid.count, (page + 1) * grid.count);
  const items = coins.map((c) => ({ id: c.id, card: c }));
  return (
    <PageFrame className="cdx-discover">
      <header className="cdx-archive__head">
        <div className="flex items-center gap-2">
          <h1 className="mdx-h1">The collection.</h1>
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
      <div ref={grid.ref} className="cdx-token-grid" style={{"--page-columns":grid.columns,"--page-rows":grid.rows} as CSSProperties}>
        {visible.map((c) => (
          <article key={c.id} className="cdx-token-cell">
            <View3DHost item={{ id: c.id, card: c }} list={items}>
              <Link
                to="/coin/$id"
                params={{ id: c.id }}
                aria-label={`Open ${c.name}, $${c.ticker}, ${getCardDesign(c.cardTemplate).name} design`}
              >
                <MintCard card={c} depth="table" idle="turntable" />
              </Link>
            </View3DHost>
            <Link to="/coin/$id" params={{ id: c.id }} className="cdx-token-cell__caption">
              <div>
                <strong>{c.name}</strong>
                <span>${c.ticker}</span>
              </div>
              <div>
                <span>{marketCapText(c)}</span>
                <Change v={c.change24h} />
              </div>
            </Link>
          </article>
        ))}
      </div>
      <PageControls page={page} pages={pages} onPage={next=>void navigate({search:s=>({...s,page:next ? next+1 : undefined}),replace:true,resetScroll:false})} label={`${coins.length} ${coins.length === 1 ? "coin" : "coins"}`} />
      {coins.length === 0 && (
        <div className="cdx-empty" role="status">
          No coins found. Try another search, or{" "}
          <Link to="/launch" className="mdx-link">
            launch the first one
          </Link>
          .
        </div>
      )}
    </PageFrame>
  );
}
