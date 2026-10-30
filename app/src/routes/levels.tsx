import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { searchSchema, text } from "../lib/mintdex/search";
import { HeroTurntable } from "../components/carddex/HeroTurntable";
import { useViewIn3D } from "../components/carddex/CardControls";
import { MintCard, type CardData } from "../components/mintdex/MintCard";
import { ButtonLink, Tabs, TextLink } from "../components/mintdex/ui";
import { COLLECTION, DesignMini } from "../components/carddex/GalleryTile";
import { getCardDesign, isCardDesignKey, type CardDesign } from "../lib/carddex/designs";
import { pageHead } from "../lib/mintdex/seo";
import { defaultQuoteForDesign, designForPair, isOfferedPair, pairForDesign, type PairAsset } from "../lib/carddex/pairs";
import { ORDERED_PAIRS, PAIR_GROUPS, groupAlias, isPairGroup, pairGroupOf, shortPairName, type PairGroup } from "../components/carddex/pair-groups";
import { initialQuoteReserves, quoteMetrics } from "../lib/carddex/quote-simulation";

/**
 * Designs (/levels), in mintdex.fun's Designs format: the pair groups as segmented tabs, the selected design at the
 * centre of a coverflow (its neighbours fanned back on either side), its name, its pair and the one primary under the
 * ledge, and the design table in a full-height aside that scrolls on its own (on phones: a strip of design chips, then
 * the selected design's plinth). The pair picks the card, so this shows the one design of each launchable pair, and
 * its primary opens Launch on that pair. A design no pair has (kept by coins made with it) still opens from a link,
 * with no launch action. Styles: styles/screens/designs.css. Every explanation lives at /how#cards and /how#pairs.
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

/** Every launchable design, with its pair, in the offered pairs' reading order (pair-groups.ts). */
type PairedDesign = { design: CardDesign; pair: Readonly<PairAsset> };
const PAIRED: readonly PairedDesign[] = ORDERED_PAIRS.map((pair) => ({ pair, design: getCardDesign(designForPair(pair.key)!) }));
const pairedIn = (group: PairGroup) => PAIRED.filter(({ pair }) => group === "all" || pairGroupOf(pair) === group);

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
      description: `${PAIRED.length} card designs, one for each pair. Pick a pair and your coin keeps its card for good.`,
    }),
  component: Designs,
});
/** A launchable design's catalogue number ("No. 07") among the pairs, the plate MintDex prints before a name. */
const catalogueNo = (d: CardDesign) => String(PAIRED.findIndex((x) => x.design.key === d.key) + 1).padStart(2, "0");

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
  // Older links used the design collections (memes, stocks, classic...): the pair groups keep memes and stocks, and
  // the old "base" group (SOL and USDC) is now part of Crypto.
  const collection = groupAlias(search.collection);
  const group: PairGroup = isPairGroup(collection) ? collection : "all";
  const shown = useMemo(() => pairedIn(group), [group]);
  // A design from the link (one no pair has still opens, with no launch action), else the linked pair's design,
  // else the group's first.
  const linked = isCardDesignKey(key) ? getCardDesign(key) : isOfferedPair(search.quote) ? getCardDesign(designForPair(search.quote)!) : null;
  const design = linked ?? shown[0]?.design ?? PAIRED[0]!.design;
  const pair = pairForDesign(design.key);
  // The sample card's quote: the design's pair; a design no pair has shows the quote coins made with it read as.
  const quote = pair ?? defaultQuoteForDesign(design.key);
  const index = shown.findIndex((d) => d.design.key === design.key);
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
  const cardIn = ({ design: d, pair: p }: PairedDesign): CardData => ({
    ...card,
    cardTemplate: d.key,
    level: d.materialLevel,
    quoteAssetKey: p.key,
    quoteMint: p.mint,
    ...quoteMetrics(initialQuoteReserves(p.key), p.key),
  });
  // A pick keeps you on the page (comparing designs is pick, look, pick again); the caption and this line say what is
  // selected.
  const [announce, setAnnounce] = useState("");
  const go = (d: PairedDesign, say = true) => {
    if (say) setAnnounce(`${d.design.name} selected, ${d.pair.symbol} pair.`);
    void navigate({ search: { ...search, design: d.design.key, quote: undefined, icon: undefined, edition: undefined }, replace: true, resetScroll: false });
  };
  const setGroup = (next: string) => {
    // The selected design stays when the group holds it; otherwise the group's first.
    const target = isPairGroup(next) ? next : "all";
    const list = pairedIn(target);
    const nextDesign = list.find((d) => d.design.key === design.key) ?? list[0]!;
    void navigate({
      search: { ...search, collection: target === "all" ? undefined : target, design: nextDesign.design.key, quote: undefined, icon: undefined, edition: undefined },
      replace: true,
      resetScroll: false,
    });
  };
  // A launchable design that is not in the group in view (an old link, a group that does not hold it) gives the centre
  // to the group's first, so the coverflow, the table and the strip always mark the same design. A design no pair has
  // keeps the centre: it is shown from its link, outside the list.
  useEffect(() => {
    if (index === -1 && pair && shown.length) go(shown[0]!, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, shown, pair?.key]);

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
  }, [design.key, group]);

  // The one primary: Launch on this design's pair (its card comes with it). A design no pair has offers none.
  const primary = pair ? (
    <ButtonLink to="/launch" search={{ quote: pair.key }}>
      Use this pair
    </ButtonLink>
  ) : null;
  const collectionName = COLLECTION[design.category];
  const fan = index === -1 ? [] : shown.map((d, i) => ({ d, n: i - index })).filter(({ n }) => n !== 0 && Math.abs(n) <= FAN_REACH);

  return (
    <div className="cdx-designs flex min-h-0 min-w-0 flex-col gap-4 lg:h-full" data-testid="design-collections">
      <nav aria-label="Pair groups" className="flex-none">
        <Tabs
          label="Pair groups"
          value={group}
          onChange={(v) => setGroup(String(v))}
          className="mdx-noscrollbar mdx-design-collections max-w-full max-lg:overflow-x-auto"
          options={PAIR_GROUPS.map((g) => ({ value: g.key, label: g.name, count: pairedIn(g.key).length }))}
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
                  Same coin. {PAIRED.length} designs.
                </h1>
                <p className="mt-1 text-[13px] leading-[1.45] text-slate">
                  Your pair picks your card.{" "}
                  <TextLink to="/how" hash="cards">
                    Details
                  </TextLink>
                </p>
              </div>
            </header>
            <section aria-label="Design preview" className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="mdx-cf cdx-cf relative -mx-4 flex justify-center overflow-clip px-4 pt-2 lg:-mx-2 lg:min-h-[240px] lg:flex-1 lg:px-2 lg:[container-type:size]">
                <div className="mdx-cf__stage relative flex h-full w-full items-end justify-center">
                  {/* The neighbours: pointer shortcuts only (the table and the strip are the keyboard's way). */}
                  <div aria-hidden className="mdx-cf__track">
                    {fan.map(({ d, n }) => (
                      <div
                        key={d.design.key}
                        className="mdx-cf__item"
                        data-near={Math.abs(n) === 1 || undefined}
                        style={fanStyle(n, 20 - Math.abs(n))}
                        onClick={() => go(d)}
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
                {pair ? <span className="mdx-plate cdx-cf-cap__no">No. {catalogueNo(design)}</span> : null}
                <span className="cdx-cf-cap__name">{design.name}</span>
                <span data-chip="" className="cdx-cf-cap__chip">
                  <DesignMini design={design} />
                  <span>
                    {collectionName}
                    <span className="text-slate"> · {pair ? `${pair.symbol} pair` : "Existing coins only"}</span>
                  </span>
                </span>
                {primary ? <span className="cdx-cf-cap__go">{primary}</span> : null}
              </div>
              {/* Phones: the designs as one strip of chips (MintDex's .mdx-strip): each chip is the design's swatch and its
                  pair's symbol (the full name is in its label, the caption and the plinth), so 95 chips stay short. */}
              <div
                ref={stripRef}
                role="group"
                aria-label="Designs"
                className="mdx-strip cdx-designs__strip -mx-4 mt-3 flex flex-none px-4 py-0.5 lg:hidden"
              >
                {shown.map((d) => (
                  <button
                    key={d.design.key}
                    type="button"
                    data-design={d.design.key}
                    aria-pressed={d.design.key === design.key}
                    aria-label={`${d.design.name}, ${d.pair.symbol} pair`}
                    className="cdx-design-chip"
                    onClick={() => go(d)}
                  >
                    <DesignMini design={d.design} />
                    <span className="cdx-design-chip__pair num">{d.pair.symbol}</span>
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
            >
              {shown.map((d) => {
                const pressed = d.design.key === design.key;
                return (
                  <button
                    key={d.design.key}
                    type="button"
                    data-design={d.design.key}
                    aria-pressed={pressed}
                    aria-label={`${d.design.name}, ${d.pair.symbol} pair`}
                    className="mdx-ladrow cdx-ladrow"
                    onClick={() => go(d)}
                  >
                    <span aria-hidden className="mdx-plate cdx-ladrow__no">
                      {catalogueNo(d.design)}
                    </span>
                    <DesignMini design={d.design} className="mdx-mini" />
                    <span className="cdx-ladrow__name">{d.design.name}</span>
                    <span className="cdx-ladrow__pair num">{d.pair.symbol}</span>
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
              <p className="cdx-designs__pair">
                {pair ? (
                  <>
                    <strong>{pair.symbol}</strong> <span>{shortPairName(pair)}</span>
                  </>
                ) : (
                  <span>Existing coins only. No pair offers this design.</span>
                )}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
