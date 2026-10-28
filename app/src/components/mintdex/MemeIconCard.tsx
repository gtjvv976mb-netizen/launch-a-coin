import { useRef, type CSSProperties } from "react";
import { getCardDesign } from "../../lib/carddex/designs";

import { cardArtSources } from "../../lib/mintdex/art";
import { getMemeIcon, type MemeIcon, type MemeIconKey } from "../../lib/mintdex/meme-icons";
import { frameLayout, tierForLevel } from "../../lib/mintdex/tiers";
import { CardPrint, boxStyle } from "./CardPrint";
import type { CardData } from "./MintCard";
import { ThemeEmblem } from "./theme-emblem";
import { GeneratedCardFront, generatedCardStyle } from "../carddex/GeneratedCardArt";
import { useImageFailure } from "./image-state";

export type MemeIconCardProps = {
  icon: MemeIcon | MemeIconKey;
  /** The creator's token is the only source of card identity and central artwork. */
  card: CardData;
  compact?: boolean;
  priority?: boolean;
  sizes?: string;
  className?: string;
};

/** Recognizable theme art for both the decorative card medallion and the template chooser. */
export function MemeThemePortrait({ icon: input, className = "", priority = false }: {
  icon: MemeIcon | MemeIconKey;
  className?: string;
  priority?: boolean;
}) {
  const icon = typeof input === "string" ? getMemeIcon(input) : input;
  const ref = useRef<HTMLImageElement>(null);
  const source = icon?.mascotCrop && icon.artSrc ? icon.artSrc.replace(/\.webp$/, "-320.webp") : null;
  const variant = priority ? "selected" : "preview";
  const image = useImageFailure(ref, source, variant);
  if (!icon?.mascotCrop || !source) return null;
  const [x, y, size] = icon.mascotCrop;
  return <div
    className={`mdx-meme-theme-portrait ${className}`}
    data-meme-theme-portrait={icon.key}
    role="img"
    aria-label={`${icon.inspiration ?? icon.name} theme illustration${image.failed ? " unavailable" : ""}`}
    style={{ "--portrait-base": icon.palette[0], "--portrait-accent": icon.palette[1], "--portrait-paper": icon.palette[2] } as CSSProperties}
  >
    <img
      key={`${source}:${variant}`}
      ref={ref}
      src={source}
      alt=""
      hidden={image.failed}
      draggable={false}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      style={{ left: `${(-x / size) * 100}%`, top: `${(-y / size) * 100}%`, width: `${(956 / size) * 100}%`, height: `${(1440 / size) * 100}%` }}
      onError={image.onError}
      onLoad={image.onLoad}
    />
    {image.failed ? <span className="mdx-meme-theme-portrait__unavailable">Theme illustration unavailable</span> : null}
  </div>;
}

/** Precision frame geometry; the selected token supplies every picture inside it. */
function CraftedFrame({ icon }: { icon: MemeIconKey }) {
  const ornament = (() => {
    switch (icon) {
      case "gamestop":
        return <>
          <path d="M27 163h24v96l-13 13v340l13 13v92H27M603 163h-24v96l13 13v340l-13 13v92h24" />
          <path d="m89 101 16-16h106m208 0h106l16 16M89 779l16 16h106m208 0h106l16-16" />
          <path d="m44 369 12 20-12 20m542-40-12 20 12 20M159 118h76m160 0h76" />
        </>;
      case "amc":
        return <>
          <path d="M39 191V42h143m266 0h143v149M39 689v149h143m266 0h143V689M52 168V55h107m312 0h107v113M52 712v113h107m312 0h107V712" />
          <path d="M114 157q201-89 402 0M129 163q186-76 372 0m-282-46 96 24 96-24m-177-7 81 31 81-31m-63-13-18 44-18-44m-58 640 76-29 76 29m-58 13-18-42-18 42" />
          <path d="M40 250h13v380H40zM577 250h13v380h-13z" className="mdx-meme-icon__solid" />
        </>;
      case "blackberry":
        return <>
          <rect x="38" y="38" width="554" height="804" rx="36" />
          <path d="M61 145h508M61 733h508M45 319h9v86h-9m531-86h9v86h-9" />
          {[0, 1, 2, 3, 4, 5, 6].map((index) => <rect key={index} x={211 + index * 31} y="749" width="22" height="12" rx="3" />)}
          {[0, 1, 2, 3, 4].map((index) => <g key={index}><rect x="37" y={229 + index * 82} width="18" height="44" rx="4" /><rect x="575" y={229 + index * 82} width="18" height="44" rx="4" /></g>)}
          <path d="M258 122h114m-83-12h52M225 780h180m-150 12h120" />
        </>;
      case "nokia":
        return <>
          <rect x="40" y="33" width="550" height="814" rx="55" />
          <path d="M47 253q-15 187 0 374M583 253q15 187 0 374M235 120q80-23 160 0m-143 12q63-17 126 0M235 758q80 23 160 0m-143-12q63 17 126 0" />
          <path d="m43 213 10-8 10 8-10 8Zm544 0-10-8-10 8 10 8ZM43 667l10-8 10 8-10 8Zm544 0-10-8-10 8 10 8Z" />
          <path d="M35 332h24v216H35zM571 332h24v216h-24zM285 103h60M285 777h60" />
        </>;
      case "coinbase":
        return <>
          <path d="M32 183V33h150m266 0h150v150M32 697v150h150m266 0h150V697M47 191V48h145m246 0h145v143M47 689v143h145m246 0h145V689" />
          <path d="M77 149V104h65V86h346v18h65v45M77 731v45h65v18h346v-18h65v-45M40 330h12v220H40zM578 330h12v220h-12z" />
          <path d="m315 92 14 14-14 14-14-14Zm0 668 14 14-14 14-14-14Z" />
        </>;
      case "binance":
        return <>
          <path d="M35 168V35h133m294 0h133v133M35 712v133h133m294 0h133V712M48 180V48h132m270 0h132v132M48 700v132h132m270 0h132V700" />
          <path d="m43 302 14 8v16l-14 8-14-8v-16Zm0 244 14 8v16l-14 8-14-8v-16Zm544-244 14 8v16l-14 8-14-8v-16Zm0 244 14 8v16l-14 8-14-8v-16Z" />
          <path d="M221 119h188m-155-12h122M221 761h188m-155 12h122m-304-88 11-22 11 22-11 22Zm544 0-11-22-11 22 11 22Z" />
        </>;
      case "kraken":
        return <>
          <rect x="33" y="33" width="564" height="814" rx="46" />
          <rect x="46" y="46" width="538" height="788" rx="38" />
          <path d="M35 253q30 40 0 80t0 80 0 80 0 80 0 80M595 253q-30 40 0 80t0 80 0 80 0 80 0 80M221 116q47-16 94 0t94 0M221 764q47 16 94 0t94 0" />
          <path d="m95 104 12 12-12 12-12-12Zm440 0 12 12-12 12-12-12Zm-440 648 12 12-12 12-12-12Zm440 0 12 12-12 12-12-12Z" />
        </>;
      case "strategy":
        return <>
          <path d="M81 30h468l51 51v718l-51 51H81l-51-51V81ZM94 45h442l49 49v692l-49 49H94l-49-49V94Z" />
          <path d="M30 237h22v134H30m570-134h-22v134h22M30 509h22v134H30m570-134h-22v134h22M32 176l23 40m-23 194 23 40m-23 194 23 40m543-508-23 40m23 194-23 40m23 194-23 40" />
          <path d="M214 119h202m-172-14h142M214 761h202m-172 14h142" />
          <path d="m105 81 12-12h51m294 0h51l12 12M105 799l12 12h51m294 0h51l12-12" />
        </>;
      default:
        return <>
          <path d="M36 145V36h109m340 0h109v109M36 735v109h109m340 0h109V735M49 145V49h96m340 0h96v96M49 735v96h96m340 0h96v-96" />
          <path d="M180 115h270M180 765h270m-135-15 15 15-15 15-15-15Z" />
        </>;
    }
  })();
  return (
    <svg className="mdx-meme-icon__crafted" viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
      <rect x="19" y="19" width="592" height="842" rx="23" />
      {ornament}
    </svg>
  );
}

/** The subject's world is engraved into the frame itself, outside every original print and artwork box. */
function ThemePerimeter({ icon }: { icon: MemeIconKey }) {
  const rails = [0, 1].map((side) => <g key={side} transform={side ? "translate(630 0) scale(-1 1)" : undefined}>
    {icon === "doge" ? <>
      <path d="M26 143v585M18 143v585M35 153v554" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <g key={n} transform={`translate(0 ${n * 72})`}>
        <path d="M34 186c-18-8-22-21-15-36 15 9 22 21 15 36Zm0 0c18-7 24-16 20-28-14 5-22 15-20 28Z" className="mdx-meme-icon__inlay" />
      </g>)}
    </> : null}
    {icon === "pepe" ? <>
      <path d="M33 133c-27 62 27 86 0 148s27 86 0 148 27 86 0 148 27 86 0 148M25 133c-27 62 27 86 0 148s27 86 0 148 27 86 0 148 27 86 0 148" />
      {[0, 1, 2, 3].map((n) => <g key={n} transform={`translate(0 ${n * 155})`}>
        <path d="M32 187c-19-4-22-17-10-27 12 2 20 11 10 27Zm0 13c17-2 26-13 18-25-12-1-20 8-18 25Z" className="mdx-meme-icon__inlay" />
      </g>)}
    </> : null}
    {icon === "shib" ? <>
      <path d="M17 130h32v608H17M25 136v596" />
      {[0, 1, 2, 3, 4, 5].map((n) => <g key={n} transform={`translate(0 ${n * 97})`}>
        <path d="m24 149 23 19-23 33 11-31Z" className="mdx-meme-icon__inlay" />
        <path d="m34 211 8 9-8 9-8-9Z" />
      </g>)}
    </> : null}
    {icon === "bonk" ? <>
      <path d="M16 137h35v596H16M22 137v596" />
      {[0, 1, 2, 3, 4, 5, 6].map((n) => <g key={n} transform={`translate(0 ${n * 81})`}>
        <path d="m25 163 20-20v21l-20 20Z" className="mdx-meme-icon__inlay" />
        <circle cx="29" cy="203" r="2" /><circle cx="41" cy="203" r="2" />
      </g>)}
      <path d="m14 751 34-43m-30 47 34-43" />
    </> : null}
    {icon === "wif" ? <>
      <path d="M16 133v608M50 133v608" strokeDasharray="5 9" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <g key={n} transform={`translate(0 ${n * 73})`}>
        <path d="M26 139c26 16 26 38 0 54m16-54c-26 16-26 38 0 54M25 146c17 12 17 27 0 39m18-39c-17 12-17 27 0 39" />
      </g>)}
    </> : null}
    {icon === "popcat" ? <>
      <path d="M21 136v600M49 136v600" />
      {[0, 1, 2, 3].map((n) => <g key={n} transform={`translate(0 ${n * 154})`}>
        <path d="M39 154q-28 37 0 74m-5-61q-16 24 0 49m-10-36q-6 12 0 24" />
        <path d="m26 249 17 11-17 11Z" className="mdx-meme-icon__inlay" />
      </g>)}
    </> : null}
    {icon === "gamestop" ? <>
      {[0, 1, 2, 3, 4].map((n) => <g key={n} transform={`translate(0 ${n * 113})`}>
        <path d="M35 164v24m-12-12h24M25 214h5m12 0h5" />
      </g>)}
    </> : null}
    {icon === "amc" ? <>
      <path d="M22 137h27v597H22Z" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <rect key={n} x="28" y={149 + n * 65} width="15" height="26" rx="2" />)}
    </> : null}
    {icon === "blackberry" ? <>
      {[0, 1, 2, 3, 4, 5, 6].map((n) => <g key={n} transform={`translate(0 ${n * 82})`}>
        <rect x="21" y="155" width="27" height="16" rx="4" className="mdx-meme-icon__inlay" />
        <path d="M27 160h15m-15 5h10" />
      </g>)}
    </> : null}
    {icon === "nokia" ? <>
      <path d="M24 137v597m20-597v597" />
      {[0, 1, 2, 3, 4].map((n) => <g key={n} transform={`translate(0 ${n * 115})`}>
        <path d="M30 154v27m10-36v36m-15 35q9-11 18 0m-14 5q5-6 10 0" />
      </g>)}
    </> : null}
    {icon === "coinbase" ? <>
      <path d="M25 137v597M45 137v597" />
      {[0, 1, 2, 3, 4].map((n) => <path key={n} d={`M24 ${162 + n * 118}h22v22H24z`} className="mdx-meme-icon__inlay" />)}
    </> : null}
    {icon === "binance" ? <>
      <path d="M33 137v597" />
      {[0, 1, 2, 3, 4, 5].map((n) => <g key={n} transform={`translate(0 ${n * 97})`}>
        <path d="m33 154 15 15-15 15-15-15Zm0 42 7 7-7 7-7-7Z" className="mdx-meme-icon__inlay" />
      </g>)}
    </> : null}
    {icon === "kraken" ? <>
      <path d="M21 138q33 42 0 84t0 84 0 84 0 84 0 84 0 84 0 84M33 138q33 42 0 84t0 84 0 84 0 84 0 84 0 84 0 84" />
      {[0, 1, 2, 3, 4, 5, 6].map((n) => <circle key={n} cx="36" cy={184 + n * 84} r="5" />)}
    </> : null}
    {icon === "strategy" ? <>
      <path d="M20 137h28v597H20Z" />
      {[0, 1, 2, 3, 4, 5].map((n) => <path key={n} d={`m22 ${157 + n * 96} 24 24v20l-24-24Z`} className="mdx-meme-icon__inlay" />)}
    </> : null}
  </g>);
  return <svg className="mdx-meme-icon__engraving" data-theme-perimeter={icon} viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
    <rect x="11" y="11" width="608" height="858" rx="25" />
    <rect x="17" y="17" width="596" height="846" rx="23" />
    <path d="M42 122h546M42 750h546M43 826h211m122 0h211" />
    {rails}
  </svg>;
}

/** A reusable frame around the creator's own token, carried by the existing solid-card 3D scene. */
export function MemeIconCard({ icon: input, card, compact = false, priority = false, sizes, className = "" }: MemeIconCardProps) {
  const icon = typeof input === "string" ? getMemeIcon(input) : input;
  const frameRef = useRef<HTMLImageElement>(null);
  const artRef = useRef<HTMLImageElement>(null);
  const variant = `${compact ? "compact" : priority ? "selected" : "staged"}:${sizes ?? ""}`;
  const frameSource = icon?.frameArtSrc ?? (icon?.frameKind === "higgsfield" ? icon.artSrc : null);
  const frame = useImageFailure(frameRef, frameSource, variant);
  const artSource = card.image || null;
  const art = useImageFailure(artRef, artSource, variant);
  if (!icon) return null;
  const tier = tierForLevel(card.level);
  const layout = frameLayout(tier.key);
  const sources = artSource ? cardArtSources(artSource) : null;
  const thumbnail = frameSource?.replace(/\.webp$/, "-320.webp");
  const frameWidth = icon.frameArtSrc ? 1360 : 956;
  const radius = (layout.radius ?? 0.0504) * 100;
  const style = {
    ...generatedCardStyle(card.cardTemplate),
    "--accent": tier.accent,
    "--meme-icon-base": icon.palette[0],
    "--meme-icon-accent": icon.palette[1],
    "--meme-icon-paper": icon.palette[2],
    "--card-radius": `${radius.toFixed(2)}% / ${((radius * 63) / 88).toFixed(2)}%`,
    aspectRatio: "63 / 88",
  } as CSSProperties;

  return (
    <div
      className={`mdx-card mdx-meme-icon ${compact ? "mdx-card--compact mdx-meme-icon--compact" : ""} ${className}`}
      data-meme-icon={icon.key}
      data-frame-kind={frameSource ? "higgsfield" : icon.frameKind}
      data-frame-print={icon.frameArtSrc ? icon.key : undefined}
      data-edition-availability="selected"
      data-tier={tier.key}
      data-finish={getCardDesign(card.cardTemplate).finish}
      data-card-template={card.cardTemplate}
      data-carddex-premium=""
      style={style}
      role="img"
      aria-label={`${card.name} ($${card.ticker}), ${icon.name} trading card.${icon.inspiration ? ` ${icon.inspiration}-inspired design.` : ""} Permanent creator-selected print.${art.failed ? " Token artwork unavailable." : ""}${frame.failed ? " Frame texture unavailable." : ""}`}
    >
      {/* A separate opaque sheet removes the original portrait behind all original-format panels and art. */}
      {frameSource && !frame.failed && !icon.frameArtSrc ? <div className="mdx-meme-icon__portrait-mask" aria-hidden="true" /> : null}
      <div className="mdx-card__art mdx-meme-icon__art" style={boxStyle(layout.window, 0.004)}>
        {artSource ? <img
          key={`${artSource}:${variant}`}
          ref={artRef}
          src={sources?.card ?? artSource}
          srcSet={sources?.srcSet}
          sizes={sources ? (sizes ?? (compact ? "100px" : "(max-width: 640px) 240px, 300px")) : undefined}
          alt=""
          hidden={art.failed}
          draggable={false}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
          onError={art.onError}
          onLoad={art.onLoad}
        /> : null}
        {!artSource || art.failed ? <span className={art.failed ? "mdx-meme-icon__art-unavailable" : "mdx-meme-icon__art-empty"}>
          {art.failed ? "Coin artwork unavailable" : "Your coin art"}
        </span> : null}
      </div>
      {frameSource ? <img
        key={`${frameSource}:${variant}`}
        ref={frameRef}
        className="mdx-meme-icon__frame"
        data-theme-frame-art={icon.frameArtSrc ? icon.key : undefined}
        src={compact || !priority ? thumbnail : frameSource}
        srcSet={!compact && priority ? `${thumbnail} 320w, ${frameSource} ${frameWidth}w` : undefined}
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
      {!frameSource || frame.failed ? <CraftedFrame icon={icon.key} /> : null}
      {!icon.frameArtSrc || frame.failed ? <ThemePerimeter icon={icon.key} /> : null}
      <GeneratedCardFront cardTemplate={card.cardTemplate} priority={priority} />
      <CardPrint card={card} layout={layout} tier={tier} preview />
      {icon.mascotCrop && !icon.frameArtSrc ? <div className="mdx-meme-icon__mascot" data-meme-mascot={icon.key} aria-hidden="true">
        <MemeThemePortrait icon={icon} priority={priority} />
      </div> : null}
      {!icon.frameArtSrc || frame.failed ? <div className="mdx-meme-icon__seal" data-theme-seal={icon.key} aria-hidden="true"><ThemeEmblem icon={icon.key} /></div> : null}
      <div className="mdx-card__lights mdx-meme-icon__lights" aria-hidden="true">
        <i className="mdx-meme-icon__reflection" />
        <i className="mdx-meme-icon__sheen" />
      </div>
    </div>
  );
}
