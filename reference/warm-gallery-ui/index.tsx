import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { z } from "zod";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import { Change, Thumb } from "../components/mintdex/ui";
import { getHome } from "../lib/mintdex/api";
import { CARD_DESIGNS, getCardDesign } from "../lib/carddex/designs";
import { usdCompact } from "../lib/mintdex/format";
import { pageHead } from "../lib/mintdex/seo";
import "../carddex.css";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ card: z.string().max(80).optional().catch(undefined) }),
  loader: () => getHome(),
  head: () =>
    pageHead({
      path: "/",
      title: "CardDex — A new frame for your token",
      description:
        "Creator-selected NFT trading cards for pump.fun tokens. Explore premium editions, trading-card classics and stock-linked designs in a new collector’s gallery.",
    }),
  component: Home,
});
const SHOWCASE = ["pokemon-classic", "yugioh-monster", "doge", "stock-tsla", "obsidian-archive"];
function sample(key: string, image = "glorb"): CardData {
  const design = getCardDesign(key);
  return {
    cardTemplate: key,
    name: "Your token",
    ticker: "TOKEN",
    image: `/assets/creatures/${image}.webp`,
    level: design.materialLevel,
    mcapUsd: 0,
    mcapLabel: "Preview",
    holders: 0,
    dexNo: 0,
    dexLabel: "Sample",
    lore: "A new story, made collectible.",
    ownerHandle: "you",
  };
}
function Arrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16 16 4M4 4h12v12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function Home() {
  const initial = Route.useLoaderData(),
    search = Route.useSearch();
  const { data } = useQuery({
    queryKey: ["home"],
    queryFn: () => getHome(),
    initialData: initial,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const coins = data.featured.length ? data.featured : data.trending;
  const [chosen, setChosen] = useState(search.card ?? "");
  const selected = coins.find((c) => c.id === chosen) ?? coins[0];
  const card = selected ?? sample("pokemon-classic");
  const design = getCardDesign(card.cardTemplate);
  const stocks = CARD_DESIGNS.filter((d) => d.category === "stocks");
  return (
    <div className="cdx-home">
      <section className="cdx-hero" aria-labelledby="home-title">
        <div className="cdx-hero__copy">
          <div className="cdx-editorial-line" data-reveal>
            <span className="cdx-status-dot" /> A new kind of collector’s market
          </div>
          <h1 id="home-title">
            <span data-reveal>A token.</span>
            <span data-reveal>A trading card.</span>
            <em data-reveal>Entirely yours.</em>
          </h1>
          <p className="cdx-hero__intro" data-reveal>
            Bring your token to life with a card worth keeping. Pick a premium design, make it your
            own, and build your collection.
          </p>
          <div className="cdx-hero__actions" data-reveal>
            <Link to="/launch" className="cdx-button cdx-button--ink">
              Create your card <Arrow />
            </Link>
            <Link to="/levels" className="cdx-text-action">
              Explore the archive <Arrow />
            </Link>
          </div>
          <div className="cdx-hero__signature" data-reveal>
            <div className="cdx-mini-stack" aria-hidden>
              <i />
              <i />
              <i />
            </div>
            <p>
              Made for pump.fun launches.
              <br />
              <span>One permanent design. One of one.</span>
            </p>
          </div>
        </div>
        <div className="cdx-hero__display">
          <span className="cdx-hero__edition" aria-hidden>
            THE
            <br />
            FIRST
            <br />
            EDITION.
          </span>
          <div className="cdx-hero__backprint" aria-hidden>
            CDX
          </div>
          <HeroTurntable card={card} className="cdx-hero__turntable" />
          <div className="cdx-hero__label">
            <div>
              <span className="cdx-overline">Currently on the turntable</span>
              <strong>{selected?.name ?? "Your next token"}</strong>
              <span>{design.name}</span>
            </div>
            <span className="cdx-hero__one">
              1<span>/</span>1
            </span>
          </div>
          {coins.length > 1 && (
            <div className="cdx-hero__selectors" aria-label="Choose a featured card">
              {coins.slice(0, 5).map((c) => (
                <button
                  type="button"
                  key={c.id}
                  aria-label={`Show ${c.name}`}
                  aria-pressed={selected?.id === c.id}
                  onClick={() => setChosen(c.id)}
                >
                  <Thumb src={c.image} size={30} />
                  <span>{c.ticker}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      <div
        className="cdx-running-line"
        aria-label="Creator-owned. Permanently designed. Made collectible."
      >
        <div>
          {[0, 1].map((i) => (
            <span key={i} aria-hidden={i === 1}>
              CREATOR OWNED <b>✳</b> PERMANENTLY DESIGNED <b>✳</b> MADE COLLECTIBLE <b>✳</b> A NEW
              FRAME FOR YOUR TOKEN <b>✳</b>
            </span>
          ))}
        </div>
      </div>
      <section className="cdx-home-archive" aria-labelledby="archive-title">
        <div className="cdx-section-heading" data-reveal>
          <div>
            <span className="cdx-overline">The design archive</span>
            <h2 id="archive-title">Find your signature.</h2>
          </div>
          <div>
            <p>
              Trading-card nostalgia, reimagined in
              <br className="hidden sm:block" /> foil, precious metal and your imagination.
            </p>
            <Link to="/levels" className="cdx-text-action">
              View all {CARD_DESIGNS.length} designs <Arrow />
            </Link>
          </div>
        </div>
        <div className="cdx-design-showcase">
          {SHOWCASE.map((key, i) => {
            const d = getCardDesign(key);
            return (
              <Link
                key={key}
                to="/levels"
                search={{ design: key }}
                className="cdx-showcase-card"
                data-reveal
                style={
                  {
                    "--reveal-delay": `${i * 55}ms`,
                    "--print-accent": d.palette[1],
                  } as CSSProperties
                }
              >
                <div className="cdx-showcase-card__object">
                  <MintCard
                    card={sample(key, ["glorb", "molten", "honk", "byte", "spore"][i])}
                    depth="flat"
                  />
                </div>
                <div>
                  <span>
                    {d.category === "stocks"
                      ? `${d.stock?.ticker} · Stock-linked`
                      : d.category === "limited"
                        ? "Limited edition"
                        : "Collector print"}
                  </span>
                  <h3>{d.name}</h3>
                  <Arrow />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
      <section className="cdx-market-section" aria-labelledby="market-title">
        <div className="cdx-section-heading" data-reveal>
          <div>
            <span className="cdx-overline">The token collection</span>
            <h2 id="market-title">
              A little culture.
              <br />
              <em>A lot of character.</em>
            </h2>
          </div>
          <Link to="/discover" className="cdx-text-action">
            Discover every token <Arrow />
          </Link>
        </div>
        <div className="cdx-market-ledger" data-reveal>
          <div className="cdx-market-ledger__head">
            <span>Token / creator-selected print</span>
            <span>Market cap</span>
            <span>24h change</span>
            <span>Explore</span>
          </div>
          {data.trending.slice(0, 6).map((c, i) => (
            <Link to="/coin/$id" params={{ id: c.id }} key={c.id} className="cdx-ledger-row">
              <span className="cdx-ledger-row__identity">
                <i>{String(i + 1).padStart(2, "0")}</i>
                <Thumb src={c.image} size={43} />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    ${c.ticker} <b>/</b> {getCardDesign(c.cardTemplate).name}
                  </small>
                </span>
              </span>
              <span className="num">{usdCompact(c.mcapUsd)}</span>
              <Change v={c.change24h} />
              <Arrow />
            </Link>
          ))}
        </div>
      </section>
      <section className="cdx-stock-feature" aria-labelledby="stock-title">
        <div data-reveal>
          <span className="cdx-overline">The stock-linked collection</span>
          <h2 id="stock-title">
            Familiar tickers.
            <br />
            <em>Unfamiliar frames.</em>
          </h2>
          <p>
            Dedicated designs for specific stocks, with their reference pair built into the print.
            Each card keeps your token’s own art and identity.
          </p>
          <Link
            to="/levels"
            search={{ collection: "stocks", design: "stock-tsla" }}
            className="cdx-button cdx-button--paper"
          >
            Explore stock designs <Arrow />
          </Link>
          <small>Design references only. No share ownership or equity backing is implied.</small>
        </div>
        <div className="cdx-stock-grid">
          {stocks.map((s, i) => (
            <Link
              to="/levels"
              search={{ design: s.key }}
              key={s.key}
              data-reveal
              className="cdx-stock-tile"
              style={
                { "--print-accent": s.palette[1], "--reveal-delay": `${i * 45}ms` } as CSSProperties
              }
            >
              <span>{s.stock?.ticker}</span>
              <strong>{s.stock?.name}</strong>
              <small>{s.stock?.pair}</small>
              <Arrow />
            </Link>
          ))}
        </div>
      </section>
      <section className="cdx-home-close" data-reveal>
        <p>Every collection starts with one.</p>
        <h2>
          Make yours
          <br />
          <em>worth a closer look.</em>
        </h2>
        <Link to="/launch" className="cdx-button cdx-button--ink">
          Create your card <Arrow />
        </Link>
      </section>
    </div>
  );
}
