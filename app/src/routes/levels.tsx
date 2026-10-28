import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { z } from "zod";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
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
import "../carddex.css";

export const Route = createFileRoute("/levels")({
  validateSearch: z.object({
    design: z.string().optional().catch(undefined),
    quote: z.string().optional().catch(undefined),
    collection: z.string().optional().catch(undefined),
    icon: z.string().optional().catch(undefined),
    edition: z.string().optional().catch(undefined),
    view3d: z.string().optional().catch(undefined),
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
  const setCategory = (collection: string) => void navigate({search: {...search, collection: collection === "all" ? undefined : collection}, replace: true, resetScroll: false});
  const [query, setQuery] = useState("");
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
    void navigate({ search: { ...search, design: d.key, quote: nextQuote.key }, replace: true, resetScroll: false }).then(() => {
      if (window.innerWidth < 1024)
        document.querySelector(".cdx-archive__vitrine")?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
    });
  };
  return (
    <PageFrame className="cdx-archive">
      <header className="cdx-archive__head">
        <div>
          <h1 className="mdx-h1">Find your signature.</h1>
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
      <div className="cdx-archive__body">
        <section className="cdx-archive__vitrine" aria-label="Selected card design preview">
          <div
            className="cdx-archive__halo"
            style={{ "--cdx-accent": design.palette[1] } as CSSProperties}
            aria-hidden
          />
          <div className="cdx-archive__card" key={design.key}>
            <HeroTurntable card={card} />
          </div>
          <div className="cdx-archive__caption">
            <h2>{design.name}</h2>
            <PairBadge quoteAssetKey={quote.key} ticker="GLORB" />
            <span className="cdx-demo-note">
              Sample card · drag to inspect
            </span>
          </div>
        </section>
        <section className="cdx-library" aria-label="Card design library">
          <div className="cdx-library__tools">
            <label className="sr-only" htmlFor="design-search">
              Search card designs
            </label>
            <input
              id="design-search"
              className="mdx-input"
              placeholder="Find your design…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
            />
            <QuoteAssetPicker value={quote.key} designKey={design.key} ticker="GLORB" compact onChange={(nextQuote,nextDesign)=>void navigate({ search:{...search,design:nextDesign,quote:nextQuote},replace:true,resetScroll:false })} />
            <div className="cdx-filter" aria-label="Filter designs">
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
          <div className="cdx-library__list">
            {shown.map((d, i) => (
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
          <p className="cdx-library__foot">
            Stock pairs use tokenized quote assets; they do not grant equity.
          </p>
        </section>
      </div>
    </PageFrame>
  );
}
