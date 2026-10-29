import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { searchSchema, text } from "../lib/mintdex/search";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { useViewIn3D } from "../components/carddex/CardControls";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import { Button, ButtonLink, Tabs, TextLink } from "../components/mintdex/ui";
import { COLLECTION, DesignMini } from "../components/carddex/GalleryTile";
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
  type PairAsset,
} from "../lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../lib/carddex/design-pairings";
import { DESIGN_GROUPS, inDesignGroup } from "../components/carddex/design-groups";
import { initialQuoteReserves, quoteMetrics } from "../lib/carddex/quote-simulation";
import { QuoteAssetPicker } from "../components/carddex/QuoteAssetPicker";

/**
 * Designs (/levels), in mintdex.fun's Designs format: the collections as segmented tabs, the selected design at the
 * centre of a coverflow (its neighbours fanned back on either side), its name and the one primary under the ledge,
 * and the design table in a full-height aside that scrolls on its own (on phones: a strip of design chips, then the
 * selected design's plinth). No unlock thresholds, slider or level-up: a coin keeps the one design its creator picks.
 * Styles: styles/screens/designs.css. Every explanation lives at /how#cards and /how#pairs.
 */

/** The selected design on its turntable, with the stage's three controls (Turn over, Pause, View in 3D). */
function DesignStage({ card }: { card: CardData }) {
  const view3d = useViewIn3D(card);
  return (
    <>
      {/* The stage's card width (designs.css --W): 260px on upright phones, up to 400px on wide screens. */}
      <HeroTurntable card={card} viewportFit controls={view3d.control} sizes="(max-width: 559px) 260px, (max-width: 767px) 40vw, (max-width: 1279px) 260px, 400px" />
      {view3d.viewer}
    </>
  );
}

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
      description: `${CARD_DESIGNS.length} card designs. Pick the one your coin keeps for good, from trading-card classics to limited-edition foil artwork.`,
    }),
  component: Designs,
});
// The collections and their membership are shared with Launch's All designs dialog (design-groups.ts).
const GROUPS = DESIGN_GROUPS;

const matchesCategory = inDesignGroup;
const memePairKeys = new Set<string>(MEME_PAIR_PRESETS.map((preset) => preset.quote));
const memePairAssets = PAIR_ASSETS.filter((asset) => memePairKeys.has(asset.key));
const matchesMemePair = (design: CardDesign, quoteKey: string) =>
  MEME_PAIR_PRESETS.some((preset) => preset.design === design.key && preset.quote === quoteKey);
/** A design's catalogue number ("No. 07"), the plate MintDex prints before a name. */
const catalogueNo = (d: CardDesign) => String(CARD_DESIGNS.findIndex((x) => x.key === d.key) + 1).padStart(2, "0");

/**
 * A side card's place in the coverflow (mintdex.fun's values): `n` steps from the centre, fanned back 52deg, each
 * step 0.34 card widths out and 0.26 back; the second step blurs, the third and fourth fade. Five steps out it waits
 * unseen, so a card sliding in fades in instead of appearing.
 */
function fanStyle(n: number, z: number): CSSProperties {
  const a = Math.abs(n);
  const sign = Math.sign(n);
  return {
    "--x": `calc(var(--W) * ${(sign * (0.8 + 0.34 * (a - 1))).toFixed(3)})`,
    "--z": `calc(var(--W) * ${(-(0.72 + 0.26 * (a - 1))).toFixed(3)})`,
    "--ry": `${-sign * 52}deg`,
    "--sg": sign,
    opacity: a >= 5 ? 0 : a === 4 ? 0.45 : a === 3 ? 0.7 : 1,
    filter: a >= 3 ? "blur(2.4px)" : a === 2 ? "blur(1.2px)" : undefined,
    zIndex: z,
  } as CSSProperties;
}
const FAN_REACH = 5;

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
  const [memePairFilter, setMemePairFilter] = useState("all");
  // A pair change that needs a compatible design waits for its confirmation (QuoteAssetPicker): the collections, the
  // pair filter, the table, the strip and the coverflow lock, and the primary reads "Confirm pair first" and takes
  // focus to the confirmation.
  const [pairPending, setPairPending] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const focusConfirm = () => confirmRef.current?.focus();
  useEffect(() => {
    if (!pairPending) return;
    // A safety net only: the confirmation sits beside the selected design and focus never moves on its own. Two
    // frames, so the check sees the panel at its new height.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => confirmRef.current?.scrollIntoView({ block: "nearest" }));
    });
    return () => cancelAnimationFrame(raf);
  }, [pairPending]);
  const requestedQuote = isPairAssetKey(search.quote) ? getPairAsset(search.quote) : null;
  const quote =
    boundQuoteForDesign(design.key) ??
    (requestedQuote && allowedQuotesForDesign(design.key).some((a) => a.key === requestedQuote.key)
      ? requestedQuote
      : ((category === "memes" ? recommendedMemeQuoteForDesign(design.key) : null) ??
        defaultQuoteForDesign(design.key)));
  const filterPair = category === "memes" ? (memePairAssets.find((asset) => asset.key === memePairFilter) ?? null) : null;
  /** The quote a design previews with here: its bound quote, the meme pair in view, else the current quote. */
  const choiceQuote = (d: CardDesign, pair: PairAsset | null = filterPair): PairAsset =>
    boundQuoteForDesign(d.key) ??
    (category === "memes"
      ? recommendedMemeQuoteForDesign(d.key, pair?.key ?? (d.key === design.key ? quote.key : undefined))
      : null) ??
    (allowedQuotesForDesign(d.key).some((a) => a.key === quote.key) ? quote : defaultQuoteForDesign(d.key));
  const shown = useMemo(
    () =>
      CARD_DESIGNS.filter(
        (d) => matchesCategory(d, category) && (!filterPair || matchesMemePair(d, filterPair.key)),
      ),
    [category, filterPair?.key],
  );
  const index = shown.findIndex((d) => d.key === design.key);
  const sampleMetrics = quoteMetrics(initialQuoteReserves(quote.key), quote.key);
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
  const cardIn = (d: CardDesign): CardData => {
    const q = choiceQuote(d);
    return {
      ...card,
      cardTemplate: d.key,
      level: d.materialLevel,
      quoteAssetKey: q.key,
      quoteMint: q.mint,
      ...quoteMetrics(initialQuoteReserves(q.key), q.key),
    };
  };
  // A pick keeps you on the page (comparing designs is pick, look, pick again); the caption and this line say what is
  // selected.
  const [announce, setAnnounce] = useState("");
  const go = (d: CardDesign, q: PairAsset, say = true) => {
    if (say) setAnnounce(`${d.name} selected, GLORB / ${q.symbol} pair.`);
    void navigate({
      search: { ...search, design: d.key, quote: q.key },
      replace: true,
      resetScroll: false,
    });
  };
  const pick = (d: CardDesign) => {
    if (pairPending) return;
    go(d, choiceQuote(d));
  };
  const setCategory = (next: string) => {
    if (pairPending) return;
    setMemePairFilter("all");
    // The selected design stays when the collection holds it; otherwise the collection's own first (a paired
    // collection opens on the requested quote's preferred design).
    const nextDesign = matchesCategory(design, next)
      ? design
      : (CARD_DESIGNS.find((d) => d.key === preferred && matchesCategory(d, next)) ??
        CARD_DESIGNS.find((d) => matchesCategory(d, next)) ??
        design);
    const nextQuote =
      boundQuoteForDesign(nextDesign.key) ??
      (next === "memes" ? recommendedMemeQuoteForDesign(nextDesign.key, nextDesign.key === design.key ? quote.key : undefined) : null) ??
      (allowedQuotesForDesign(nextDesign.key).some((a) => a.key === quote.key) ? quote : defaultQuoteForDesign(nextDesign.key));
    void navigate({
      search: {
        ...search,
        collection: next === "all" ? undefined : next,
        design: nextDesign.key,
        quote: nextQuote.key,
      },
      replace: true,
      resetScroll: false,
    });
  };
  /** The exact pair filter (Meme pairs): only the designs preset for that asset, previewed in it. */
  const setPairFilter = (next: string) => {
    if (pairPending) return;
    setMemePairFilter(next);
    const pair = memePairAssets.find((asset) => asset.key === next) ?? null;
    if (!pair) return;
    const nextDesign = matchesMemePair(design, pair.key)
      ? design
      : CARD_DESIGNS.find((d) => matchesCategory(d, "memes") && matchesMemePair(d, pair.key));
    if (nextDesign) go(nextDesign, choiceQuote(nextDesign, pair), false);
  };
  // A design that is not in the collection in view (an old link, a filter that dropped it) gives the centre to the
  // collection's first, so the coverflow, the table and the strip always mark the same design.
  useEffect(() => {
    if (index === -1 && shown.length && !pairPending) go(shown[0]!, choiceQuote(shown[0]!), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, shown, pairPending]);

  // The table's sliding mark and the strip follow the selection: the row (or chip) scrolls into its own box's view,
  // never the page.
  const ladderRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const list = ladderRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-design="${design.key}"]`);
    if (list && row && list.clientHeight) {
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top - 8;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
    }
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-design="${design.key}"]`);
    if (strip && chip && strip.clientWidth) strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
  }, [design.key, category, filterPair?.key]);

  const primary = pairPending ? (
    <Button disabled onBlocked={focusConfirm}>
      Confirm pair first
    </Button>
  ) : (
    <ButtonLink to="/launch" search={{ design: design.key, quote: quote.key }}>
      Use this design
    </ButtonLink>
  );
  const collectionName = COLLECTION[design.category];
  const fan = index === -1 ? [] : shown.map((d, i) => ({ d, n: i - index })).filter(({ n }) => n !== 0 && Math.abs(n) <= FAN_REACH);

  return (
    <div className="cdx-designs flex min-h-0 min-w-0 flex-col gap-4 lg:h-full" data-testid="design-collections">
      <nav aria-label="Design collections" className="flex-none" inert={pairPending}>
        <Tabs
          label="Design collections"
          value={category}
          onChange={(v) => setCategory(String(v))}
          className="mdx-noscrollbar mdx-design-collections max-w-full max-lg:overflow-x-auto"
          options={GROUPS.map((g) => ({
            value: g.key,
            label: g.name,
            count: CARD_DESIGNS.filter((d) => matchesCategory(d, g.key)).length,
            disabled: pairPending,
          }))}
        />
      </nav>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {/* No overflow here: the aside bleeds into main's padding (MintDex), and a hidden overflow there would let a
          focused row scroll this box sideways. The coverflow clips itself (.mdx-cf). */}
      <div className="min-h-0 min-w-0 flex-1">
        <div className="mdx-page cdx-designs__grid flex flex-col gap-6 lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_calc(var(--aside)_-_var(--main-pad))] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 lg:max-xl:[--aside:300px] xl:[--aside:340px] wide:[--aside:360px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-6 short:gap-4 lg:h-full">
            <header className="flex flex-none flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:min-h-14 lg:flex-nowrap">
              <div className="min-w-0">
                <h1 className="mdx-h1 -mb-1 pb-1 lg:truncate max-lg:[text-wrap:balance]">
                  Same coin. {CARD_DESIGNS.length} designs.
                </h1>
                <p className="mt-1 text-[13px] leading-[1.45] text-slate">
                  Your coin keeps its design for good.{" "}
                  <TextLink to="/how" hash="cards">
                    Details
                  </TextLink>
                </p>
              </div>
              {category === "memes" ? (
                <div className="cdx-designs__pairfilter" inert={pairPending}>
                  <label htmlFor="design-pair-asset" className="mdx-label">
                    Pair
                  </label>
                  <select
                    id="design-pair-asset"
                    className="mdx-select"
                    value={memePairFilter}
                    disabled={pairPending}
                    onChange={(event) => setPairFilter(event.target.value)}
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
            </header>
            <section aria-label="Design preview" className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="mdx-cf cdx-cf relative -mx-4 flex justify-center overflow-clip px-4 pt-2 lg:-mx-2 lg:min-h-[240px] lg:flex-1 lg:px-2 lg:[container-type:size]">
                <div className="mdx-cf__stage relative flex h-full w-full items-end justify-center">
                  {/* The neighbours: pointer shortcuts only (the table and the strip are the keyboard's way). */}
                  <div aria-hidden className="mdx-cf__track" inert={pairPending}>
                    {fan.map(({ d, n }) => (
                      <div
                        key={d.key}
                        className="mdx-cf__item"
                        data-near={Math.abs(n) === 1 || undefined}
                        style={fanStyle(n, 20 - Math.abs(n))}
                        onClick={() => pick(d)}
                      >
                        <MintCard card={cardIn(d)} depth="flat" sizes="(max-width: 1023px) 200px, 312px" />
                      </div>
                    ))}
                  </div>
                  <div className="mdx-cf__center relative flex-none" key={design.key}>
                    <DesignStage card={card} />
                  </div>
                </div>
              </div>
              {/* The caption under the ledge: the plate, the name, its collection and pair, the one primary. */}
              <div className="cdx-cf-cap">
                <span className="mdx-plate cdx-cf-cap__no">No. {catalogueNo(design)}</span>
                <span className="cdx-cf-cap__name">{design.name}</span>
                <span data-chip="" className="cdx-cf-cap__chip">
                  <DesignMini design={design} />
                  <span>
                    {collectionName}
                    <span className="text-slate"> · {quote.symbol} pair</span>
                  </span>
                </span>
                <span className="cdx-cf-cap__go">{primary}</span>
              </div>
              {/* Phones: the designs as one strip of chips (MintDex's .mdx-strip). */}
              <div
                ref={stripRef}
                role="group"
                aria-label="Designs"
                className="mdx-strip cdx-designs__strip -mx-4 mt-3 flex flex-none px-4 py-0.5 lg:hidden"
                inert={pairPending}
              >
                {shown.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    data-design={d.key}
                    aria-pressed={d.key === design.key}
                    className="cdx-design-chip"
                    onClick={() => pick(d)}
                  >
                    <DesignMini design={d} />
                    <span className="cdx-design-chip__name">{d.name}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* The aside: the design table (it scrolls on its own), then the selected design and its pair. Phones show
              only the selected design, as a plinth under the strip. */}
          <aside className="mdx-plinth mdx-aside cdx-designs__aside relative z-[1] flex min-h-0 flex-col lg:pt-[calc(2rem_-_var(--gutter))] short:pt-6" aria-label="Design details">
            <div aria-hidden className="cdx-ladder__head max-lg:hidden">
              <span>Design</span>
              <span>Pair</span>
            </div>
            <div
              ref={ladderRef}
              role="group"
              aria-label={`Designs, ${shown.length}`}
              className="cdx-ladder mdx-scroll max-lg:hidden"
              inert={pairPending}
            >
              {shown.map((d) => {
                const q = choiceQuote(d);
                const pressed = d.key === design.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    data-design={d.key}
                    aria-pressed={pressed}
                    aria-label={`${d.name}, ${q.symbol} pair`}
                    className="mdx-ladrow cdx-ladrow"
                    onClick={() => pick(d)}
                  >
                    <span aria-hidden className="mdx-plate cdx-ladrow__no">
                      {catalogueNo(d)}
                    </span>
                    <DesignMini design={d} className="mdx-mini" />
                    <span className="cdx-ladrow__name">{d.name}</span>
                    <span className="cdx-ladrow__pair num">{q.symbol}</span>
                  </button>
                );
              })}
              {index >= 0 ? (
                <span aria-hidden className="cdx-ladder__mark" style={{ transform: `translateY(calc(var(--row) * ${index}))` } as CSSProperties} />
              ) : null}
            </div>
            <div className="cdx-designs__info">
              <h2 className="mdx-h2 cdx-designs__title">
                <span>{design.name}</span>
                <span className="cdx-designs__tagline">{collectionName}</span>
              </h2>
              <p className="cdx-designs__desc">{design.description}</p>
              <div className="cdx-designs__pair">
                <QuoteAssetPicker
                  value={quote.key}
                  designKey={design.key}
                  ticker="GLORB"
                  compact
                  confirmationRef={confirmRef}
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
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
