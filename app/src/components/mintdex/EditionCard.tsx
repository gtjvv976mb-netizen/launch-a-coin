import { useRef, type CSSProperties } from "react";
import { getCardDesign } from "../../lib/carddex/designs";
import { cardArtSources } from "../../lib/mintdex/art";
import { getEdition, type Edition, type EditionKey } from "../../lib/mintdex/editions";
import type { CardData } from "./MintCard";
import { frameLayout, tierForLevel } from "../../lib/mintdex/tiers";
import { CardPrint, boxStyle } from "./CardPrint";
import { GeneratedCardFront, generatedCardStyle } from "../carddex/GeneratedCardArt";
import { useImageFailure } from "./image-state";
import "../../editions-card.css";

export type EditionCardProps = {
  edition: Edition | EditionKey;
  card: CardData;
  compact?: boolean;
  priority?: boolean;
  sizes?: string;
  className?: string;
};

/** Geometric print ornament, deliberately independent from any licensed character or card system. */
function EditionOrnament({ edition }: { edition: EditionKey }) {
  switch (edition) {
    case "wildtype":
      return (
        <svg viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
          <path d="M34 116V43h80M516 43h80v73M34 727v111h112M596 727v111H484" />
          <path d="m529 52 38 22v44l-38 22-38-22V74Z" />
          <path d="m529 71 20 12v26l-20 12-20-12V83Z" />
          <path d="M75 746h480M75 757h180M375 757h180" />
          <path d="m82 744 13-19 13 19-13 19Zm40 0 13-19 13 19-13 19Zm40 0 13-19 13 19-13 19Z" />
        </svg>
      );
    case "ronin":
      return (
        <svg viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
          <path d="M47 41h536v798H47zM61 55h508v770H61z" />
          <path d="M503 41v798M59 654h444M59 664h444M59 674h444M59 684h444" />
          <path d="m77 129 76-76m-76 93 93-93m-93 110L187 53M455 759l41-41m-24 41 24-24" />
          <path d="M104 724h69v69h-69zm10 10h49v49h-49zM123 744h30v9h-20v20h-10z" />
          <path d="m508 48 64 64V48ZM62 824v-64l64 64Z" className="mdx-edition__solid" />
        </svg>
      );
    case "astral":
      return (
        <svg viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
          <path d="M40 840V44h550v796ZM54 827V58h522v769" />
          <path d="M91 640V341a224 224 0 0 1 448 0v299M107 624V341a208 208 0 0 1 416 0v283" />
          <path d="m315 34 8 21 21 8-21 8-8 21-8-21-21-8 21-8ZM91 681l7 16 17 7-17 7-7 16-7-16-17-7 17-7ZM539 681l7 16 17 7-17 7-7 16-7-16-17-7 17-7" />
          <path d="m101 110 58 25 44-41 112 37 103-37 57 41 55-25M159 135l28 54M475 135l-32 54" />
          <circle cx="101" cy="110" r="4" /><circle cx="159" cy="135" r="4" />
          <circle cx="203" cy="94" r="4" /><circle cx="315" cy="131" r="4" />
          <circle cx="418" cy="94" r="4" /><circle cx="475" cy="135" r="4" />
          <circle cx="530" cy="110" r="4" />
          <path d="M106 788h146m126 0h146m-209-14 14 14-14 14-14-14Z" />
          <path d="m39 573 5 12 12 5-12 5-5 12-5-12-12-5 12-5Zm552 44 5 12 12 5-12 5-5 12-5-12-12-5 12-5ZM34 137l8 80-8 81m562-161-8 80 8 81" />
        </svg>
      );
    case "neon-circuit":
      return (
        <svg viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
          <path d="M72 31h480l47 47v724l-47 47H72l-41-41V72Z" />
          <path d="M90 49h449l42 42v698l-42 42H90l-41-41V90Z" />
          <path d="M35 225h44v54l-20 20v196l20 20v80H35M595 198h-37v93l18 18v154l-18 18v156h37" />
          <path d="M112 723h142l22-22h75l22 22h141M112 735h91m223 0h88M112 747h61m283 0h58" />
          <path d="m98 95 11-11h81m-81 14h52M445 787h82l11-11m-72-2h48" />
          <path d="M71 391h21v71H71zM542 352h21v71h-21z" className="mdx-edition__solid" />
        </svg>
      );
    case "sovereign":
      return (
        <svg viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
          <path d="M35 35h560v810H35zM48 48h534v784H48zM62 62h506v756H62z" />
          <path d="M82 164V83h81M467 83h81v81M82 716v81h81M467 797h81v-81" />
          <path d="m83 83 48 48m-35-48 35 35m-48-22 22 22m442-35-48 48m35-48-35 35m48-22-22 22M83 797l48-48m-35 48 35-35m-48 22 22-22m442 35-48-48m35 48-35-35m48 22-22-22" />
          <path d="m315 67 9 20 21 4-15 16 3 23-18-10-18 10 3-23-15-16 21-4Z" />
          <path d="M112 743h406l-17 12 17 12H112l17-12Z" />
          <path d="M190 777h94m62 0h94m-125-12 12 12-12 12-12-12Z" />
        </svg>
      );
    case "abyssal":
      return (
        <svg viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
          <rect x="36" y="36" width="558" height="808" rx="54" />
          <rect x="53" y="53" width="524" height="774" rx="43" />
          <rect x="79" y="193" width="472" height="426" rx="74" />
          <path d="M52 744q87-12 175 0t176 0 175 0M52 754q87-12 175 0t176 0 175 0M52 764q87-12 175 0t176 0 175 0M52 774q87-12 175 0t176 0 175 0" />
          <path d="M88 97h29m-14-14v29M513 97h29m-14-14v29M88 783h29m-14-14v29M513 783h29m-14-14v29" />
          <path d="M70 319h17m-17 14h17m-17 14h17m-17 14h17m-17 14h17M543 433h17m-17 14h17m-17 14h17m-17 14h17m-17 14h17" />
        </svg>
      );
  }
}

/** Original MintDex card structure with a cosmetic frame and the creator's actual token data. */
export function EditionCard({ edition: input, card, compact = false, priority = false, sizes, className = "" }: EditionCardProps) {
  const edition = typeof input === "string" ? getEdition(input) : input;
  const artRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);
  const variant = `${compact ? "compact" : priority ? "selected" : "staged"}:${sizes ?? ""}`;
  const frameSource = edition?.frameArtSrc ?? null;
  const frame = useImageFailure(frameRef, frameSource, variant);
  const tokenArt = useImageFailure(artRef, card.image || null, variant);
  if (!edition) return null;
  const tier = tierForLevel(card.level);
  const layout = frameLayout(tier.key);
  const art = card.image ? cardArtSources(card.image) : null;
  const failed = tokenArt.failed;
  const frameReady = !!frameSource && !frame.failed;
  const frameThumbnail = frameSource?.replace(/\.webp$/, "-320.webp");
  const radius = (layout.radius ?? 0.0504) * 100;
  const style = {
    ...generatedCardStyle(card.cardTemplate),
    "--accent": tier.accent,
    "--edition-base": edition.palette[0],
    "--edition-accent": edition.palette[1],
    "--edition-paper": edition.palette[2],
    "--card-radius": `${radius.toFixed(2)}% / ${((radius * 63) / 88).toFixed(2)}%`,
    aspectRatio: "63 / 88",
  } as CSSProperties;

  return (
    <div
      className={`mdx-card mdx-edition ${compact ? "mdx-card--compact mdx-edition--compact" : ""} ${className}`}
      data-edition={edition.key}
      data-frame-print={frameSource ? edition.key : undefined}
      data-frame-ready={frameReady ? "" : undefined}
      data-edition-availability="selected"
      data-tier={tier.key}
      data-finish={getCardDesign(card.cardTemplate).finish}
      data-card-template={card.cardTemplate}
      data-carddex-premium=""
      style={style}
      role="img"
      aria-label={`${card.name} ($${card.ticker}), ${edition.name} trading card. Permanent creator-selected print.${failed ? " Token artwork unavailable." : ""}${frame.failed ? " Frame artwork unavailable." : ""}`}
    >
      {!frameReady ? <>
        <div className="mdx-edition__paper" aria-hidden="true" />
        <div className="mdx-edition__ornament"><EditionOrnament edition={edition.key} /></div>
      </> : null}
      {frameSource ? <img
        key={`${frameSource}:${variant}`}
        ref={frameRef}
        className="mdx-edition__frame"
        data-theme-frame-art={edition.key}
        src={compact || !priority ? frameThumbnail : frameSource}
        srcSet={!compact && priority ? `${frameThumbnail} 320w, ${frameSource} 1360w` : undefined}
        sizes={!compact && priority ? (sizes ?? "(max-width: 640px) 240px, 300px") : undefined}
        alt=""
        hidden={frame.failed}
        draggable={false}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        onError={frame.onError}
        onLoad={frame.onLoad}
      /> : null}
      <div className="mdx-card__art mdx-edition__art" style={boxStyle(layout.window, 0.004)}>
        {card.image ? (
          <img
            key={`${card.image}:${variant}`}
            ref={artRef}
            src={art?.card ?? card.image}
            srcSet={art?.srcSet}
            sizes={art ? (sizes ?? (compact ? "100px" : "300px")) : undefined}
            alt=""
            hidden={failed}
            draggable={false}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : undefined}
            onError={tokenArt.onError}
            onLoad={tokenArt.onLoad}
          />
        ) : null}
        {!card.image || failed ? <span className={failed ? "mdx-edition__art-unavailable" : "mdx-edition__art-empty"}>{failed ? "Coin artwork unavailable" : "Your coin art"}</span> : null}
      </div>
      <GeneratedCardFront cardTemplate={card.cardTemplate} designVersion={card.designVersion} priority={priority} />
      <CardPrint card={card} layout={layout} tier={tier} preview />
      <div className="mdx-card__lights mdx-edition__lights" aria-hidden="true">
        <i className="mdx-edition__reflection" />
        <i className="mdx-edition__sheen" />
      </div>
    </div>
  );
}
