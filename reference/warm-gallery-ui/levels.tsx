import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { z } from "zod";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import type { CardSide } from "../components/mintdex/card3d";
import { PageFrame } from "../components/mintdex/ui";
import {
  CARD_DESIGNS,
  DEFAULT_CARD_DESIGN,
  getCardDesign,
  isCardDesignKey,
  type CardDesign,
} from "../lib/carddex/designs";
import { pageHead } from "../lib/mintdex/seo";
import "../carddex.css";

export const Route = createFileRoute("/levels")({
  validateSearch: z.object({
    design: z.string().optional().catch(undefined),
    collection: z.string().optional().catch(undefined),
    icon: z.string().optional().catch(undefined),
    edition: z.string().optional().catch(undefined),
    view3d: z.string().optional().catch(undefined),
  }),
  head: () =>
    pageHead({
      path: "/levels",
      title: "The design archive | CardDex",
      description: `${CARD_DESIGNS.length} premium card designs. Pick the permanent design for your own token, from trading-card classics to limited-edition foil artwork.`,
    }),
  component: Designs,
});
const GROUPS = [
  { key: "all", name: "All designs" },
  { key: "classic", name: "Trading card classics" },
  { key: "premium", name: "Premium" },
  { key: "stocks", name: "Stock-linked" },
  { key: "limited", name: "Limited editions" },
] as const;

function Designs() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/levels" });
  const key = search.design ?? search.icon ?? search.edition;
  const design = getCardDesign(isCardDesignKey(key) ? key : DEFAULT_CARD_DESIGN);
  const [category, setCategory] = useState(search.collection === "stocks" ? "stocks" : "all");
  const [query, setQuery] = useState("");
  const [side, setSide] = useState<CardSide>("face");
  const shown = useMemo(
    () =>
      CARD_DESIGNS.filter(
        (d) =>
          (category === "all" || d.category === category) &&
          `${d.name} ${d.description}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [category, query],
  );
  const card: CardData = {
    cardTemplate: design.key,
    name: "Glorb",
    ticker: "GLORB",
    image: "/assets/creatures/glorb.webp",
    level: design.materialLevel,
    mcapUsd: 125000,
    holders: 842,
    dexNo: 0,
    dexLabel: "Sample",
    lore: "A small creature with a very big world to discover.",
    ownerHandle: "you",
  };
  const pick = (d: CardDesign) => {
    setSide("face");
    void navigate({ search: { design: d.key }, replace: true, resetScroll: false }).then(() => {
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
          <p className="cdx-eyebrow">The design archive / {CARD_DESIGNS.length} permanent prints</p>
          <h1 className="mdx-h1">Choose your signature.</h1>
          <p className="cdx-muted">Your token. Your artwork. One design from day one.</p>
        </div>
        <Link
          to="/launch"
          search={{ design: design.key }}
          className="mdx-btn mdx-btn--primary cdx-use-design"
        >
          Launch with this design ↗
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
            <p className="cdx-eyebrow">
              {design.category === "limited"
                ? "Limited edition design"
                : design.category === "classic"
                  ? "Trading card classic"
                  : design.category === "stocks"
                    ? "Stock-linked edition"
                    : "Premium collection"}
            </p>
            <h2>{design.name}</h2>
            <p>{design.description}</p>
            {design.stock && (
              <p className="cdx-stock-reference">
                <span>
                  Stock reference <b>{design.stock.ticker}</b>
                </span>
                <span>
                  Reference pair <b>{design.stock.pair}</b>
                </span>
              </p>
            )}
            <Link to="/launch" search={{ design: design.key }} className="cdx-text-action mt-6">
              Make this your design ↗
            </Link>
            <span className="cdx-demo-note">
              Sample token · drag the card to inspect both sides
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
                      : CARD_DESIGNS.filter((d) => d.category === g.key).length}
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
                    card={{ ...card, cardTemplate: d.key, level: d.materialLevel }}
                    depth="flat"
                    sizes="(max-width:650px) 40vw, 250px"
                  />
                </div>
                <span className="cdx-design-row__text">
                  <strong>{d.name}</strong>
                  <small>
                    {d.category === "classic"
                      ? "Trading card classic"
                      : d.category === "limited"
                        ? "Limited edition"
                        : d.category === "stocks"
                          ? `${d.stock?.ticker} / Stock reference`
                          : "Premium foil"}
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
            Every design is available at launch. Stock-linked editions are visual references, not
            shares or a claim of equity backing. Your token artwork and identity remain yours.
          </p>
        </section>
      </div>
    </PageFrame>
  );
}
