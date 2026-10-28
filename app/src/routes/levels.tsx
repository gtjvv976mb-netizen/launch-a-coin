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
import { allowedQuotesForDesign, boundQuoteForDesign, defaultQuoteForDesign, getPairAsset, isPairAssetKey } from "../lib/carddex/pairs";
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

function Designs() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/levels" });
  const key = search.design ?? search.icon ?? search.edition;
  const design = getCardDesign(isCardDesignKey(key) ? key : DEFAULT_CARD_DESIGN);
  const collection = search.collection === "icons" ? "limited" : search.collection;
  const category = GROUPS.some(group => group.key === collection) ? collection! : "all";
  const setCategory = (collection: string) => { setPageIndex(0); void navigate({search: {...search, collection: collection === "all" ? undefined : collection}, replace: true, resetScroll: false}); };
  const [query, setQuery] = useState("");
  const [view, setView] = useState("preview");
  const viewsId = useId();
  const [libraryTab, setLibraryTab] = useState("designs");
  const [pageIndex, setPageIndex] = useState(0);
  const grid = usePageCapacity({rowHeight:185,minWidth:120,maxColumns:3,maxRows:3});
  const requestedQuote = isPairAssetKey(search.quote) ? getPairAsset(search.quote) : null;
  const quote = boundQuoteForDesign(design.key) ?? (requestedQuote && allowedQuotesForDesign(design.key).some(a=>a.key===requestedQuote.key) ? requestedQuote : defaultQuoteForDesign(design.key));
  const sampleMetrics = quoteMetrics(initialQuoteReserves(quote.key), quote.key);
  const matchesCategory = (d: CardDesign, group: string) => group === "all" || (group === "stocks" ? boundQuoteForDesign(d.key)?.kind === "stock" : group === "memes" ? boundQuoteForDesign(d.key)?.kind === "meme" : d.category === group);
  const shown = useMemo(
    () =>
      CARD_DESIGNS.filter(
        (d) =>
          matchesCategory(d, category) &&
          `${d.name} ${d.description} ${boundQuoteForDesign(d.key)?.symbol ?? ""} ${boundQuoteForDesign(d.key)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [category, query],
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
    const nextQuote = boundQuoteForDesign(d.key) ?? quote;
    setView("preview");
    void navigate({ search: { ...search, design: d.key, quote: nextQuote.key }, replace: true, resetScroll: false });
  };
  const pages = Math.max(1,Math.ceil(shown.length/grid.count));
  const page = Math.min(pageIndex,pages-1);
  return (
    <PageFrame className={`cdx-archive cdx-archive--${view}`}>
      <div className="sr-only">{view}</div>
      <header className="cdx-archive__head">
        <div>
          <h1 className="mdx-h1">Card designs.</h1>
          <p className="cdx-muted">{CARD_DESIGNS.length} designs. Your artwork takes the centre.</p>
        </div>
        <Link
          to="/launch"
          search={{ design: design.key, quote: quote.key }}
          className="mdx-btn mdx-btn--primary cdx-use-design"
        >
          Use this design
        </Link>
      </header>
      <ViewTabs className="cdx-view-tabs cdx-archive-mobile-tabs" label="Design views" idBase={`${viewsId}-m`} tabs={[{id:"preview",label:"Card preview",selected:view==="preview",onSelect:()=>setView("preview"),panel:`${viewsId}-preview`},{id:"designs",label:"Designs",selected:view==="library" && libraryTab==="designs",onSelect:()=>{setView("library");setLibraryTab("designs");},panel:`${viewsId}-library`},{id:"pair",label:"Pair",selected:view==="library" && libraryTab==="pair",onSelect:()=>{setView("library");setLibraryTab("pair");},panel:`${viewsId}-library`}]} />
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
          <ViewTabs className="cdx-view-tabs cdx-library-desktop-tabs" label="Library sections" idBase={viewsId} tabs={[{id:"designs",label:"Designs",selected:libraryTab==="designs",onSelect:()=>setLibraryTab("designs")},{id:"pair",label:"Trading pair",selected:libraryTab==="pair",onSelect:()=>setLibraryTab("pair")}]} />
          {libraryTab === "pair" ? <div className="cdx-fit-region" {...tabPanelProps(viewsId, "pair")}><QuoteAssetPicker value={quote.key} designKey={design.key} ticker="GLORB" compact viewport onChange={(nextQuote,nextDesign)=>void navigate({ search:{...search,design:nextDesign,quote:nextQuote},replace:true,resetScroll:false })} /></div> : <div className="contents" {...tabPanelProps(viewsId, "designs")}>
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
          <div ref={grid.ref} className="cdx-library__list" style={{"--page-columns":grid.columns,"--page-rows":grid.rows} as CSSProperties}>
            {shown.slice(page*grid.count,(page+1)*grid.count).map((d, i) => (
              <button
                key={d.key}
                type="button"
                className="cdx-design-row"
                data-reveal
                aria-pressed={design.key === d.key}
                aria-label={`Preview ${d.name}`}
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
                    card={{ ...card, cardTemplate: d.key, level: d.materialLevel, quoteAssetKey: (boundQuoteForDesign(d.key) ?? quote).key, quoteMint: (boundQuoteForDesign(d.key) ?? quote).mint, ...quoteMetrics(initialQuoteReserves((boundQuoteForDesign(d.key) ?? quote).key), (boundQuoteForDesign(d.key) ?? quote).key) }}
                    depth="flat"
                    sizes="(max-width: 1023px) 140px, 120px"
                  />
                </div>
                <span className="cdx-design-row__text">
                  <strong>{d.name}</strong>
                  <small>
                    {boundQuoteForDesign(d.key)
                      ? `${boundQuoteForDesign(d.key)!.symbol} · ${boundQuoteForDesign(d.key)!.kind === "stock" ? "Tokenized stock quote" : "Memecoin quote"}`
                      : d.category === "classic" ? "Trading card classic" : d.category === "limited" ? "Limited edition finish" : "Premium foil"}
                  </small>
                </span>
                <span className="cdx-design-row__arrow" aria-hidden>
                  {design.key === d.key ? "✓" : "↗"}
                </span>
              </button>
            ))}
            {shown.length === 0 && (
              <p className="cdx-empty" role="status">
                No designs match “{query}”. Try another name.
              </p>
            )}
          </div>
          <PageControls page={page} pages={pages} onPage={setPageIndex} label={`${shown.length} designs`} />
          </div>}
          <p className="cdx-library__foot">
            Stock pairs use tokenized quote assets; they do not grant equity.
          </p>
        </section>
      </div>
    </PageFrame>
  );
}
