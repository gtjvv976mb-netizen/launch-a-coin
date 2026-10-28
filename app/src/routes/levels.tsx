import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useId, useMemo, useState, type CSSProperties } from "react";
import { searchSchema, text } from "../lib/mintdex/search";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import { PageControls, usePageCapacity } from "../components/carddex/Viewport";
import { PageFrame } from "../components/mintdex/ui";
import {
  CARD_DESIGNS,
  DEFAULT_CARD_DESIGN,
  getCardDesign,
  isCardDesignKey,
  type CardDesign,
} from "../lib/carddex/designs";
import { pageHead } from "../lib/mintdex/seo";
import { PAIR_ASSETS, allowedQuotesForDesign, boundQuoteForDesign, defaultQuoteForDesign, getPairAsset, isPairAssetKey, preferredDesignForQuote, recommendedMemeQuoteForDesign } from "../lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../lib/carddex/design-pairings";
import { initialQuoteReserves, quoteMetrics } from "../lib/carddex/quote-simulation";
import { PairBadge, QuoteAssetPicker } from "../components/carddex/QuoteAssetPicker";
import { ViewTabs, tabPanelProps } from "../components/carddex/ViewTabs";
import "../carddex.css";

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
      title: "The design archive | Launch a Card",
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

const matchesCategory = (design: CardDesign, group: string) => group === "all" || (group === "stocks"
  ? boundQuoteForDesign(design.key)?.kind === "stock"
  : group === "memes" ? !!recommendedMemeQuoteForDesign(design.key) : design.category === group);
const memePairKeys = new Set<string>(MEME_PAIR_PRESETS.map(preset => preset.quote));
const memePairAssets = PAIR_ASSETS.filter(asset => memePairKeys.has(asset.key));
const matchesMemePair = (design: CardDesign, quoteKey: string) => MEME_PAIR_PRESETS.some(preset => preset.design === design.key && preset.quote === quoteKey);

function Designs() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/levels" });
  const key = search.design ?? search.icon ?? search.edition;
  const collection = search.collection === "icons" ? "limited" : search.collection;
  const category = GROUPS.some(group => group.key === collection) ? collection! : "all";
  const selected = isCardDesignKey(key) ? getCardDesign(key) : null;
  const preferred = isPairAssetKey(search.quote) ? preferredDesignForQuote(search.quote) : null;
  const family = category === "stocks" ? "stock" : category === "memes" ? "meme" : null;
  const fallback = family ? CARD_DESIGNS.find(d => d.key === preferred && matchesCategory(d, category)) ?? CARD_DESIGNS.find(d => matchesCategory(d, category)) : null;
  const design = selected ?? fallback ?? getCardDesign(DEFAULT_CARD_DESIGN);
  const setCategory = (collection: string) => {
    setPageIndex(0);
    setMemePairFilter("all");
    const paired = collection === "stocks" || collection === "memes";
    const next = paired ? (matchesCategory(design, collection) ? design : CARD_DESIGNS.find(d => d.key === preferred && matchesCategory(d, collection)) ?? CARD_DESIGNS.find(d => matchesCategory(d, collection))) : null;
    const nextQuote = next ? boundQuoteForDesign(next.key) ?? (collection === "memes" ? recommendedMemeQuoteForDesign(next.key, quote.key) : null) ?? defaultQuoteForDesign(next.key) : null;
    void navigate({search: {...search, collection: collection === "all" ? undefined : collection, ...(next && nextQuote ? {design:next.key,quote:nextQuote.key} : {})}, replace: true, resetScroll: false});
  };
  const [query, setQuery] = useState("");
  const [memePairFilter, setMemePairFilter] = useState("all");
  const [view, setView] = useState("preview");
  const viewsId = useId();
  const [libraryTab, setLibraryTab] = useState("designs");
  const [pageIndex, setPageIndex] = useState(0);
  const [pairPending, setPairPending] = useState(false);
  const grid = usePageCapacity({rowHeight:185,minWidth:120,maxColumns:3,maxRows:3});
  const requestedQuote = isPairAssetKey(search.quote) ? getPairAsset(search.quote) : null;
  const quote = boundQuoteForDesign(design.key) ?? (requestedQuote && allowedQuotesForDesign(design.key).some(a=>a.key===requestedQuote.key) ? requestedQuote : (category === "memes" ? recommendedMemeQuoteForDesign(design.key) : null) ?? defaultQuoteForDesign(design.key));
  const sampleMetrics = quoteMetrics(initialQuoteReserves(quote.key), quote.key);
  const normalizedQuery = query.trim().toLowerCase();
  // Searching an exact asset must preview and apply that identity, including shared finishes.
  const queryPair = category === "memes" ? memePairAssets.find(asset => [asset.key, asset.symbol, asset.name].some(value => value.toLowerCase() === normalizedQuery)) : null;
  const filterPair = category === "memes" ? memePairAssets.find(asset => asset.key === memePairFilter) ?? queryPair : null;
  const choiceQuote = (d: CardDesign) => boundQuoteForDesign(d.key) ?? (category === "memes" ? recommendedMemeQuoteForDesign(d.key, filterPair?.key ?? (d.key === design.key ? quote.key : undefined)) : null) ?? quote;
  const shown = useMemo(
    () =>
      CARD_DESIGNS.filter(
        (d) =>
          matchesCategory(d, category) &&
          (!filterPair || matchesMemePair(d, filterPair.key)) &&
          `${d.name} ${d.description} ${boundQuoteForDesign(d.key)?.symbol ?? ""} ${boundQuoteForDesign(d.key)?.name ?? ""} ${MEME_PAIR_PRESETS.filter(preset=>preset.design===d.key).map(preset=>{const asset=getPairAsset(preset.quote);return `${asset.symbol} ${asset.name}`;}).join(" ")}`.toLowerCase().includes(normalizedQuery),
      ),
    [category, query, filterPair?.key],
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
  const pick = (d: CardDesign) => {
    const nextQuote = choiceQuote(d);
    setView("preview");
    void navigate({ search: { ...search, design: d.key, quote: nextQuote.key }, replace: true, resetScroll: false });
  };
  const pages = Math.max(1,Math.ceil(shown.length/grid.count));
  const page = Math.min(pageIndex,pages-1);
  const visibleDesigns = shown.slice(page*grid.count,(page+1)*grid.count);
  const visibleColumns = Math.min(grid.columns,Math.max(1,visibleDesigns.length));
  const visibleRows = Math.min(grid.rows,Math.max(1,Math.ceil(visibleDesigns.length/visibleColumns)));
  return (
    <PageFrame className={`cdx-archive cdx-archive--${view}`}>
      <div className="sr-only">{view}</div>
      <header className="cdx-archive__head">
        <div>
          <h1 className="mdx-h1">Card designs.</h1>
          <p className="cdx-muted">{CARD_DESIGNS.length} designs. Your artwork takes the centre.</p>
        </div>
        {pairPending ? <button type="button" disabled className="mdx-btn mdx-btn--primary cdx-use-design">Confirm pair first</button> : <Link
          to="/launch"
          search={{ design: design.key, quote: quote.key }}
          className="mdx-btn mdx-btn--primary cdx-use-design"
        >
          Use this design
        </Link>}
      </header>
      <ViewTabs className="cdx-view-tabs cdx-archive-mobile-tabs" label="Design views" idBase={`${viewsId}-m`} tabs={[{id:"preview",label:"Card preview",selected:view==="preview",onSelect:()=>setView("preview"),panel:`${viewsId}-preview`},{id:"designs",label:"Designs",selected:view==="library" && libraryTab==="designs",disabled:pairPending,onSelect:()=>{setView("library");setLibraryTab("designs");},panel:`${viewsId}-library`},{id:"pair",label:"Pair",selected:view==="library" && libraryTab==="pair",onSelect:()=>{setView("library");setLibraryTab("pair");},panel:`${viewsId}-library`}]} />
      <div className="cdx-archive__body" data-view={view}>
        <section id={`${viewsId}-preview`} className="cdx-archive__vitrine" aria-label="Selected card design preview">
          <div
            className="cdx-archive__halo"
            style={{ "--cdx-accent": design.palette[1] } as CSSProperties}
            aria-hidden
          />
          <div className="cdx-archive__card" key={design.key}>
            <HeroTurntable card={card} viewportFit />
          </div>
          <div className="cdx-archive__caption">
            <h2>{design.name}</h2>
            <button type="button" className="cdx-archive__pair-link mdx-link" onClick={()=>{setView("library");setLibraryTab("pair");}}>GLORB / {quote.symbol} · Pair details</button>
            <span className="cdx-demo-note">
              Sample card · drag to inspect
            </span>
          </div>
        </section>
        <section id={`${viewsId}-library`} className="cdx-library" aria-label="Card design library">
          <ViewTabs className="cdx-view-tabs cdx-library-desktop-tabs" label="Library sections" idBase={viewsId} tabs={[{id:"designs",label:"Designs",selected:libraryTab==="designs",disabled:pairPending,onSelect:()=>setLibraryTab("designs")},{id:"pair",label:"Trading pair",selected:libraryTab==="pair",onSelect:()=>setLibraryTab("pair")}]} />
          {libraryTab === "pair" ? <div className="cdx-fit-region" {...tabPanelProps(viewsId, "pair")}><QuoteAssetPicker value={quote.key} designKey={design.key} ticker="GLORB" compact viewport onPendingChange={setPairPending} onChange={(nextQuote,nextDesign)=>void navigate({ search:{...search,design:nextDesign,quote:nextQuote},replace:true,resetScroll:false })} /></div> : <div className="contents" {...tabPanelProps(viewsId, "designs")}>
          <div className="cdx-library__tools">
            <label className="sr-only" htmlFor="design-search">
              Search card designs
            </label>
            <input
              id="design-search"
              className="mdx-input"
              placeholder="Find your design…"
              value={query}
              onChange={(e) => {setQuery(e.target.value);setPageIndex(0);}}
              type="search"
            />
            <label className="sr-only" htmlFor="design-category">Design category</label><select id="design-category" className="cdx-category-select mdx-input" value={category} onChange={event=>setCategory(event.target.value)}>{GROUPS.map(group=><option key={group.key} value={group.key}>{group.name} · {CARD_DESIGNS.filter(d=>matchesCategory(d,group.key)).length}</option>)}</select>
            {category === "memes" ? <div className="cdx-library__pair-filter">
              <label htmlFor="design-pair-asset">Pair asset</label>
              <select id="design-pair-asset" className="mdx-input" value={memePairFilter} disabled={pairPending} onChange={event => { setMemePairFilter(event.target.value); setPageIndex(0); }}>
                <option value="all">All pairs</option>
                {memePairAssets.map(asset => <option key={asset.key} value={asset.key}>{asset.symbol} · {asset.name}</option>)}
              </select>
            </div> : null}
            <div className="cdx-filter" role="group" aria-label="Filter designs">
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  aria-pressed={category === g.key}
                  onClick={() => setCategory(g.key)}
                >
                  {g.name}
                  <span>
                    {g.key === "all"
                      ? CARD_DESIGNS.length
                      : CARD_DESIGNS.filter((d) => matchesCategory(d, g.key)).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div ref={grid.ref} className="cdx-library__list" style={{"--page-columns":visibleColumns,"--page-rows":visibleRows} as CSSProperties}>
            {visibleDesigns.map((d, i) => {
              const tileQuote = choiceQuote(d);
              const paired = !!boundQuoteForDesign(d.key) || category === "memes";
              const active = design.key === d.key && (!paired || quote.key === tileQuote.key);
              return (
              <button
                key={d.key}
                type="button"
                className="cdx-design-row"
                data-reveal
                aria-pressed={active}
                aria-label={`Preview ${d.name}${category === "memes" ? `, ${tileQuote.symbol} pair` : ""}`}
                onClick={() => pick(d)}
                style={
                  {
                    "--cdx-accent": d.palette[1],
                    "--cdx-base": d.palette[0],
                    "--cdx-order": Math.min(i, 8),
                  } as CSSProperties
                }
              >
                <div className="cdx-design-row__preview" aria-hidden>
                  <MintCard
                    card={{ ...card, cardTemplate: d.key, level: d.materialLevel, quoteAssetKey: tileQuote.key, quoteMint: tileQuote.mint, ...quoteMetrics(initialQuoteReserves(tileQuote.key), tileQuote.key) }}
                    depth="flat"
                    sizes="(max-width: 1023px) 140px, 120px"
                  />
                </div>
                <span className="cdx-design-row__text">
                  <strong>{d.name}</strong>
                  {paired ? <span className="cdx-design-row__pair">{d.stock?.ticker ? `${d.stock.ticker} · ` : ""}{tileQuote.symbol}</span> : null}
                  <small>
                    {boundQuoteForDesign(d.key)
                      ? `${boundQuoteForDesign(d.key)!.symbol} · ${boundQuoteForDesign(d.key)!.kind === "stock" ? "Tokenized stock quote" : "Memecoin quote"}`
                      : d.category === "classic" ? "Trading card classic" : d.category === "limited" ? "Limited edition finish" : "Premium foil"}
                  </small>
                </span>
                <span className="cdx-design-row__arrow" aria-hidden>
                  {active ? "✓" : "↗"}
                </span>
              </button>
            );})}
            {shown.length === 0 && (
              <p className="cdx-empty" role="status">
                No designs match “{query}”. Try another name.
              </p>
            )}
          </div>
          <PageControls page={page} pages={pages} onPage={setPageIndex} label={`${shown.length} ${shown.length === 1 ? "design" : "designs"}`} />
          </div>}
          <p className="cdx-library__foot">
            {category === "memes" ? "Meme & collector presets use the shown quote. Asset details identify the exact mint." : "Stock pairs use tokenized quote assets; they do not grant equity."}
          </p>
        </section>
      </div>
    </PageFrame>
  );
}
