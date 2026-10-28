import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useId, useMemo, useRef, useState } from "react";
import { searchSchema, text } from "../lib/mintdex/search";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { type CardData } from "../components/mintdex/MintCard";
import {
  Button,
  ButtonLink,
  Chip,
  IconButton,
  Icon,
  PageFrame,
  PageHeader,
  TextLink,
} from "../components/mintdex/ui";
import { EmptyState } from "../components/mintdex/empty-state";
import { DesignTile } from "../components/carddex/GalleryTile";
import {
  CARD_DESIGNS,
  DEFAULT_CARD_DESIGN,
  getCardDesign,
  isCardDesignKey,
  type CardDesign,
} from "../lib/carddex/designs";
import { pageHead } from "../lib/mintdex/seo";
import {
  PAIR_ASSETS,
  allowedQuotesForDesign,
  boundQuoteForDesign,
  defaultQuoteForDesign,
  getPairAsset,
  isPairAssetKey,
  preferredDesignForQuote,
  recommendedMemeQuoteForDesign,
} from "../lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../lib/carddex/design-pairings";
import { initialQuoteReserves, quoteMetrics } from "../lib/carddex/quote-simulation";
import { QuoteAssetPicker } from "../components/carddex/QuoteAssetPicker";
import { ViewTabs, tabPanelProps } from "../components/carddex/ViewTabs";

export const Route = createFileRoute("/levels")({
  validateSearch: searchSchema({
    design: text(),
    quote: text(),
    collection: text(),
    icon: text(),
    edition: text(),
    view3d: text(),
  }),
  head: () =>
    pageHead({
      path: "/levels",
      title: "Card designs | Launch a Card",
      description: `${CARD_DESIGNS.length} premium card designs. Pick the permanent design for your own token, from trading-card classics to limited-edition foil artwork.`,
    }),
  component: Designs,
});
const GROUPS = [
  { key: "all", name: "All" },
  { key: "classic", name: "Classics" },
  { key: "premium", name: "Premium" },
  { key: "stocks", name: "Stock pairs" },
  { key: "memes", name: "Meme pairs" },
  { key: "limited", name: "Limited" },
] as const;

const matchesCategory = (design: CardDesign, group: string) =>
  group === "all" ||
  (group === "stocks"
    ? boundQuoteForDesign(design.key)?.kind === "stock"
    : group === "memes"
      ? !!recommendedMemeQuoteForDesign(design.key)
      : design.category === group);
const memePairKeys = new Set<string>(MEME_PAIR_PRESETS.map((preset) => preset.quote));
const memePairAssets = PAIR_ASSETS.filter((asset) => memePairKeys.has(asset.key));
const matchesMemePair = (design: CardDesign, quoteKey: string) =>
  MEME_PAIR_PRESETS.some((preset) => preset.design === design.key && preset.quote === quoteKey);
/** What a search reads for each design: its name and description, and the tickers and names of the pairs it wears. */
const searchText = (d: CardDesign) =>
  `${d.name} ${d.description} ${boundQuoteForDesign(d.key)?.symbol ?? ""} ${boundQuoteForDesign(d.key)?.name ?? ""} ${MEME_PAIR_PRESETS.filter(
    (preset) => preset.design === d.key,
  )
    .map((preset) => {
      const asset = getPairAsset(preset.quote);
      return `${asset.symbol} ${asset.name}`;
    })
    .join(" ")}`.toLowerCase();

/** Phones: one pane at a time (Preview, Designs, Pair). From 768px the preview sits beside the library, whose own
 * tabs read Designs and Pair; the same state drives both rows, so a resize keeps the place. */
type Pane = "preview" | "designs" | "pair";

function Designs() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/levels" });
  const key = search.design ?? search.icon ?? search.edition;
  const collection = search.collection === "icons" ? "limited" : search.collection;
  const category = GROUPS.some((group) => group.key === collection) ? collection! : "all";
  const selected = isCardDesignKey(key) ? getCardDesign(key) : null;
  const preferred = isPairAssetKey(search.quote) ? preferredDesignForQuote(search.quote) : null;
  const family = category === "stocks" ? "stock" : category === "memes" ? "meme" : null;
  const fallback = family
    ? (CARD_DESIGNS.find((d) => d.key === preferred && matchesCategory(d, category)) ??
      CARD_DESIGNS.find((d) => matchesCategory(d, category)))
    : null;
  const design = selected ?? fallback ?? getCardDesign(DEFAULT_CARD_DESIGN);
  const setCategory = (collection: string) => {
    setMemePairFilter("all");
    const paired = collection === "stocks" || collection === "memes";
    const next = paired
      ? matchesCategory(design, collection)
        ? design
        : (CARD_DESIGNS.find((d) => d.key === preferred && matchesCategory(d, collection)) ??
          CARD_DESIGNS.find((d) => matchesCategory(d, collection)))
      : null;
    const nextQuote = next
      ? (boundQuoteForDesign(next.key) ??
        (collection === "memes" ? recommendedMemeQuoteForDesign(next.key, quote.key) : null) ??
        defaultQuoteForDesign(next.key))
      : null;
    void navigate({
      search: {
        ...search,
        collection: collection === "all" ? undefined : collection,
        ...(next && nextQuote ? { design: next.key, quote: nextQuote.key } : {}),
      },
      replace: true,
      resetScroll: false,
    });
  };
  const [query, setQuery] = useState("");
  const [memePairFilter, setMemePairFilter] = useState("all");
  // The library is the answer to the page's question, so phones open on it; Preview is one tap away.
  const [pane, setPane] = useState<Pane>("designs");
  const libraryTab = pane === "pair" ? "pair" : "designs";
  const viewsId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [pairPending, setPairPending] = useState(false);
  const requestedQuote = isPairAssetKey(search.quote) ? getPairAsset(search.quote) : null;
  const quote =
    boundQuoteForDesign(design.key) ??
    (requestedQuote && allowedQuotesForDesign(design.key).some((a) => a.key === requestedQuote.key)
      ? requestedQuote
      : ((category === "memes" ? recommendedMemeQuoteForDesign(design.key) : null) ??
        defaultQuoteForDesign(design.key)));
  const sampleMetrics = quoteMetrics(initialQuoteReserves(quote.key), quote.key);
  const normalizedQuery = query.trim().toLowerCase();
  // Searching an exact asset must preview and apply that identity, including shared finishes.
  const queryPair =
    category === "memes"
      ? memePairAssets.find((asset) =>
          [asset.key, asset.symbol, asset.name].some(
            (value) => value.toLowerCase() === normalizedQuery,
          ),
        )
      : null;
  const filterPair =
    category === "memes"
      ? (memePairAssets.find((asset) => asset.key === memePairFilter) ?? queryPair)
      : null;
  const choiceQuote = (d: CardDesign) =>
    boundQuoteForDesign(d.key) ??
    (category === "memes"
      ? recommendedMemeQuoteForDesign(
          d.key,
          filterPair?.key ?? (d.key === design.key ? quote.key : undefined),
        )
      : null) ??
    quote;
  const shown = useMemo(
    () =>
      CARD_DESIGNS.filter(
        (d) =>
          matchesCategory(d, category) &&
          (!filterPair || matchesMemePair(d, filterPair.key)) &&
          searchText(d).includes(normalizedQuery),
      ),
    [category, normalizedQuery, filterPair?.key],
  );
  // Chip counts follow the search, so "Classics 2" means two classics match what is typed.
  const groupCounts = useMemo(
    () =>
      Object.fromEntries(
        GROUPS.map((g) => [
          g.key,
          CARD_DESIGNS.filter(
            (d) => matchesCategory(d, g.key) && searchText(d).includes(normalizedQuery),
          ).length,
        ]),
      ),
    [normalizedQuery],
  );
  const card: CardData = {
    cardTemplate: design.key,
    name: "Glorb",
    ticker: "GLORB",
    image: "/assets/creatures/glorb.webp",
    level: design.materialLevel,
    quoteAssetKey: quote.key,
    quoteMint: quote.mint,
    mcapUsd: sampleMetrics.mcapUsd,
    mcapQuote: sampleMetrics.mcapQuote,
    holders: 842,
    dexNo: 0,
    dexLabel: "Sample",
    lore: "A small creature with a very big world to discover.",
    ownerHandle: "you",
  };
  // Phones stay on the Designs tab after a pick (comparing designs is pick, look, pick again); the header and this
  // line say what is selected.
  const [announce, setAnnounce] = useState("");
  const pick = (d: CardDesign) => {
    const nextQuote = choiceQuote(d);
    setAnnounce(`${d.name} selected, GLORB / ${nextQuote.symbol} pair.`);
    void navigate({
      search: { ...search, design: d.key, quote: nextQuote.key },
      replace: true,
      resetScroll: false,
    });
  };
  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };
  const group = GROUPS.find((g) => g.key === category)!;
  const designsLabel = (n: number) => (
    <>
      <span className="tabular-nums">{n}</span> {n === 1 ? "design" : "designs"}
    </>
  );
  return (
    <PageFrame className={`cdx-archive cdx-archive--${pane}`}>
      <PageHeader
        title="Card designs"
        context={
          <>
            {designsLabel(CARD_DESIGNS.length)} · Selected:{" "}
            <span className="cdx-archive__selected">{design.name}</span>
          </>
        }
        right={
          pairPending ? (
            <Button disabled onBlocked={() => setPane("pair")}>
              Confirm pair first
            </Button>
          ) : (
            <ButtonLink to="/launch" search={{ design: design.key, quote: quote.key }}>
              Use this design
            </ButtonLink>
          )
        }
      />
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <ViewTabs
        className="cdx-view-tabs cdx-archive__tabs"
        label="Design views"
        idBase={`${viewsId}-m`}
        tabs={[
          {
            id: "preview",
            label: "Preview",
            selected: pane === "preview",
            onSelect: () => setPane("preview"),
            panel: `${viewsId}-preview`,
          },
          {
            id: "designs",
            label: "Designs",
            selected: pane === "designs",
            disabled: pairPending,
            onSelect: () => setPane("designs"),
            panel: `${viewsId}-library`,
          },
          {
            id: "pair",
            label: "Pair",
            selected: pane === "pair",
            onSelect: () => setPane("pair"),
            panel: `${viewsId}-library`,
          },
        ]}
      />
      <div className="cdx-archive__body">
        <section
          id={`${viewsId}-preview`}
          className="cdx-archive__vitrine"
          aria-label="Selected design preview"
        >
          <div className="cdx-archive__card" key={design.key}>
            <HeroTurntable card={card} viewportFit />
          </div>
          <div className="cdx-archive__caption">
            <h2 className="cdx-archive__name">{design.name}</h2>
            <p className="cdx-archive__meta">Sample card · GLORB / {quote.symbol} pair</p>
          </div>
        </section>
        <section id={`${viewsId}-library`} className="cdx-library" aria-label="Card design library">
          <ViewTabs
            className="cdx-view-tabs cdx-library__tabs"
            label="Library sections"
            idBase={viewsId}
            tabs={[
              {
                id: "designs",
                label: "Designs",
                selected: libraryTab === "designs",
                disabled: pairPending,
                onSelect: () => setPane("designs"),
              },
              {
                id: "pair",
                label: "Pair",
                selected: libraryTab === "pair",
                onSelect: () => setPane("pair"),
              },
            ]}
          />
          {libraryTab === "pair" ? (
            <div className="cdx-library__pair" {...tabPanelProps(viewsId, "pair")}>
              <QuoteAssetPicker
                value={quote.key}
                designKey={design.key}
                ticker="GLORB"
                compact
                onPendingChange={setPairPending}
                onChange={(nextQuote, nextDesign) =>
                  void navigate({
                    search: { ...search, design: nextDesign, quote: nextQuote },
                    replace: true,
                    resetScroll: false,
                  })
                }
              />
            </div>
          ) : (
            <div className="cdx-library__designs" {...tabPanelProps(viewsId, "designs")}>
              <div className="cdx-library__tools">
                <div className="cdx-library__search">
                  <label className="sr-only" htmlFor="design-search">
                    Search card designs
                  </label>
                  <Icon name="search" className="cdx-library__search-glyph" />
                  <input
                    ref={searchRef}
                    id="design-search"
                    className="mdx-input"
                    placeholder="Search designs"
                    value={query}
                    maxLength={40}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && query) {
                        e.preventDefault();
                        setQuery("");
                      }
                    }}
                    type="search"
                  />
                  {query ? (
                    <IconButton
                      icon="close"
                      label="Clear search"
                      size="sm"
                      className="cdx-library__clear"
                      onClick={clearSearch}
                    />
                  ) : null}
                </div>
                <div
                  className="mdx-chiprow cdx-library__chips"
                  role="group"
                  aria-label="Collection"
                >
                  {GROUPS.map((g) => (
                    <Chip
                      key={g.key}
                      pressed={category === g.key}
                      count={groupCounts[g.key]}
                      onClick={() => setCategory(g.key)}
                    >
                      {g.name}
                    </Chip>
                  ))}
                </div>
                {category === "memes" ? (
                  <div className="cdx-library__pair-filter">
                    <label htmlFor="design-pair-asset">Pair asset</label>
                    <select
                      id="design-pair-asset"
                      className="mdx-select"
                      value={memePairFilter}
                      disabled={pairPending}
                      onChange={(event) => setMemePairFilter(event.target.value)}
                    >
                      <option value="all">All pairs</option>
                      {memePairAssets.map((asset) => (
                        <option key={asset.key} value={asset.key}>
                          {asset.symbol} · {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <p className="cdx-library__count" aria-live="polite">
                <span className="tabular-nums">{shown.length}</span>{" "}
                {shown.length === 1 ? "design" : "designs"}
                {category === "all" ? "" : ` in ${group.name}`}
                {normalizedQuery ? ` matching “${query.trim()}”` : ""}
              </p>
              {shown.length > 0 ? (
                <ul role="list" className="cdx-library__list">
                  {shown.map((d) => {
                    const tileQuote = choiceQuote(d);
                    const paired = !!boundQuoteForDesign(d.key) || category === "memes";
                    const active = design.key === d.key && (!paired || quote.key === tileQuote.key);
                    return (
                      <li key={d.key}>
                        <DesignTile
                          design={d}
                          pairSymbol={tileQuote.symbol}
                          pressed={active}
                          onPick={() => pick(d)}
                          sizes="(max-width: 767px) 45vw, 160px"
                          card={{
                            ...card,
                            cardTemplate: d.key,
                            level: d.materialLevel,
                            quoteAssetKey: tileQuote.key,
                            quoteMint: tileQuote.mint,
                            ...quoteMetrics(initialQuoteReserves(tileQuote.key), tileQuote.key),
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  inline
                  className="cdx-library__empty"
                  title={
                    normalizedQuery
                      ? `No designs match “${query.trim()}”`
                      : `No designs in ${group.name}`
                  }
                  body={
                    normalizedQuery
                      ? "Try a design name, a ticker such as NVDAX, or another collection."
                      : "Try another pair asset or collection."
                  }
                  action={
                    <div className="cdx-library__empty-actions">
                      {normalizedQuery ? (
                        <Button variant="outline" onClick={clearSearch}>
                          Clear search
                        </Button>
                      ) : null}
                      {category !== "all" ? (
                        <TextLink onClick={() => setCategory("all")}>Show all designs</TextLink>
                      ) : null}
                    </div>
                  }
                />
              )}
            </div>
          )}
          <p className="cdx-library__foot">
            {category === "memes"
              ? "Meme & collector presets use the shown quote. Asset details identify the exact mint."
              : "Stock pairs use tokenized quote assets; they do not grant equity."}
          </p>
        </section>
      </div>
    </PageFrame>
  );
}
