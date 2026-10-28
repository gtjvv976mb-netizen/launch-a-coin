import { useId, useRef, type CSSProperties } from "react";
import type { CardDesign } from "../../lib/carddex/designs";
import { cardArtSources } from "../../lib/mintdex/art";
import { dexNo } from "../../lib/mintdex/format";
import { useImageFailure } from "./image-state";
import { GeneratedCardFront, generatedCardStyle } from "../carddex/GeneratedCardArt";
import { marketCapText } from "../../lib/carddex/quote-display";
import { getTradingPair } from "../../lib/carddex/pairs";
import type { CardData } from "./MintCard";

function Star() {
  return <svg viewBox="0 0 20 20" aria-hidden><path d="m10 1.3 2.6 5.6 6.1.7-4.5 4.2 1.2 6.1-5.4-3-5.4 3 1.2-6.1L1.3 7.6l6.1-.7Z" /></svg>;
}

/** Geometry and the creator's own print remain crisp at every card size. No template name is printed. */
export function TradingCardFace({ card, design, priority = false, sizes, compact = false, className = "", style: outerStyle, label }: {
  card: CardData; design: CardDesign; priority?: boolean; sizes?: string; compact?: boolean; className?: string; style?: CSSProperties; label?: string;
}) {
  const id = useId().replaceAll(":", "");
  const img = useRef<HTMLImageElement>(null);
  const art = useImageFailure(img, card.image || null, `${design.key}:${sizes ?? ""}`);
  const source = card.image ? cardArtSources(card.image) : null;
  const duel = design.layout?.startsWith("yugioh");
  const full = design.layout === "pokemon-full-art" || design.layout === "one-piece";
  const style = {
    ...generatedCardStyle(design.key),
    "--design-base": design.palette[0], "--design-metal": design.palette[1], "--design-paper": design.palette[2],
    "--card-radius": "5.04% / 3.61%", aspectRatio: "63 / 88", ...outerStyle,
  } as CSSProperties;
  const sample = card.dexLabel === "Sample";
  const address = card.mintAddress ? `${card.mintAddress.slice(0, 5)}…${card.mintAddress.slice(-4)}` : sample ? "Sample token" : card.dexNo > 0 ? "Demo token" : "Not launched";
  const quote = card.mcapLabel ?? marketCapText(card);
  return <div className={`mdx-card cdx-trading-card ${compact ? "cdx-trading-card--compact" : ""} ${className}`} data-classic-layout={design.layout} data-card-template={design.key} data-finish={design.finish} data-carddex-premium="" style={style} role={label ? "img" : undefined} aria-label={label}>
    <div className="cdx-trading-card__stock" aria-hidden />
    <GeneratedCardFront cardTemplate={design.key} priority={priority} />
    <svg className="cdx-trading-card__engraving" viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden>
      <defs><linearGradient id={`${id}metal`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={design.palette[1]} /><stop offset=".18" stopColor={design.palette[2]} /><stop offset=".44" stopColor={design.palette[1]} /><stop offset=".63" stopColor={design.palette[0]} /><stop offset=".82" stopColor={design.palette[2]} /><stop offset="1" stopColor={design.palette[1]} /></linearGradient></defs>
      <rect x="12" y="12" width="606" height="856" rx="24" fill="none" stroke={`url(#${id}metal)`} strokeWidth="11" />
      <rect x="25" y="25" width="580" height="830" rx="20" fill="none" stroke={design.palette[2]} strokeWidth="1.5" />
      {design.stock ? <>
        <rect x="34" y="34" width="562" height="812" rx={design.key === "stock-aapl" ? 40 : 12} />
        <rect x="45" y="45" width="540" height="790" rx={design.key === "stock-aapl" ? 32 : 6} />
        {design.key === "stock-gme" ? <>
          <path d="M40 185h25v48H40m550-48h-25v48h25M40 642h25v48H40m550-48h-25v48h25M79 738h472M230 109h170" />
          <path d="M89 756v34m-17-17h34m408-11v8m-17 7v8M251 780h128" />
        </> : design.key === "stock-tsla" ? <>
          <path d="M35 197h21l12 15v426l-12 15H35m560-456h-21l-12 15v426l12 15h21M184 109h262M184 782h262" />
          <path d="m42 279 16-29-7 23h16l-24 38 8-32Zm544 259-16-29 7 23h-16l24 38-8-32Z" />
        </> : design.key === "stock-nvda" ? <>
          {Array.from({ length: 8 }, (_, n) => <path key={n} d={`M33 ${200+n*61}h17l14 14v22M597 ${200+n*61}h-17l-14 14v22`} />)}
          <path d="M205 102h220v16H205zM205 762h220v16H205zM78 75h44v44H78zm430 0h44v44h-44z" />
        </> : design.key === "stock-aapl" ? <>
          <rect x="56" y="56" width="518" height="768" rx="24" />
          <path d="M276 105h78M276 788h78M32 300h13v84H32m553 57h13v84h-13" />
          <circle cx="315" cy="767" r="7" />
        </> : design.key === "stock-mstr" ? <>
          <path d="M77 77h476v726H77zM91 91h448v698H91zM35 228h25v355H35m560-355h-25v355h25" />
          <path d="M215 103h200M215 114h200M215 770h200M215 781h200m-319-39 20-14 20 14-20 14Zm398 0 20-14 20 14-20 14Z" />
        </> : <>
          <path d="M37 212h25v425H37m556-425h-25v425h25M191 108h248M191 778h248" />
          <path d="M78 76h42v42H78zm432 0h42v42h-42zM78 762h42v42H78zm432 0h42v42h-42z" />
          <circle cx="315" cy="107" r="13" /><circle cx="315" cy="778" r="13" />
        </>}
      </> : design.layout === "obsidian-archive" ? <>
        <path d="M42 160V42h118M470 42h118v118M42 720v118h118M470 838h118V720M53 160V53h107M470 53h107v107M53 720v107h107M470 827h107V720" />
        <path d="m42 42 73 73m473-73-73 73M42 838l73-73m473 73-73-73" />
        <path d="M31 218h12v444H31m568-444h-12v444h12" />
      </> : design.layout === "magic-etched" ? <>
        <path d="M49 173V64q266-53 532 0v109M51 706v105q264 44 528 0V706" />
        <path d="M61 237V92q254-44 508 0v145M61 672v126q254 33 508 0V672" />
        <path d="M33 179h14v517H33m564-517h-14v517h14" />
      </> : design.layout === "duel-masters" ? <>
        <path d="M33 267q31-121 174-186h303q91 32 89 154v407q-53 132-174 185H140Q31 781 31 650Z" />
        <path d="M51 275Q77 149 211 99h295q76 32 75 139M581 623q-50 132-161 186H148q-98-36-99-159" />
      </> : duel ? <>
        <path d="M38 38h554v804H38zM45 44h540v792H45z" />
        <path d="M69 166h492v478H69zM76 173h478v464H76z" />
        <path d="M58 662h514v142H58zM63 667h504v132H63z" />
      </> : <>
        <path d="M43 116V43h96m352 0h96v73M43 764v73h96m352 0h96v-73" />
        <path d="M34 211h10v458H34m562-458h-10v458h10" />
        <path d="m315 31 8 10-8 10-8-10Zm0 798 8 10-8 10-8-10Z" />
      </>}
    </svg>
    <div className="cdx-trading-card__art">
      {card.image ? <img ref={img} src={source?.card ?? card.image} srcSet={source?.srcSet} sizes={source ? sizes ?? "300px" : undefined} alt="" hidden={art.failed} draggable={false} loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : undefined} onError={art.onError} onLoad={art.onLoad} /> : null}
      {!card.image || art.failed ? <span>{art.failed ? "Artwork unavailable" : "Your token art"}</span> : null}
      {full ? <i className="cdx-trading-card__art-shade" /> : null}
    </div>
    <div className="cdx-trading-card__name"><strong>{card.name}</strong><span className="cdx-trading-card__attribute" aria-label="One of one"><svg viewBox="0 0 32 32" aria-hidden><path d="m16 3 11 6.5v13L16 29 5 22.5v-13Z" /><path d="M16 8v16M11 12l5-4 5 4" /></svg></span></div>
    {duel ? <div className="cdx-trading-card__star-rail" aria-hidden>{Array.from({ length: design.layout === "yugioh-spell" ? 1 : 8 }, (_, index) => <i key={index}><Star /></i>)}</div> : null}
    <div className="cdx-trading-card__type"><b>${card.ticker}</b><span>{card.tradingPair ?? getTradingPair(card.ticker, card.quoteAssetKey)}</span></div>
    <div className="cdx-trading-card__effect">
      <p>{card.lore || "Every token has a story. This is where yours begins."}</p>
      <div className="cdx-trading-card__stats"><span>Market cap <b>{quote}</b></span><span>Holders <b>{sample || card.dexNo > 0 || card.mintAddress ? card.holders : "—"}</b></span></div>
      <div className="cdx-trading-card__address"><span>Token</span><b>{address}</b></div>
    </div>
    <div className="cdx-trading-card__footer"><span>{card.ownerHandle ? `@${card.ownerHandle}` : "Launch a Card"}</span><span>{card.dexLabel ?? (card.dexNo > 0 || card.mintAddress ? dexNo(card.dexNo) : "Preview")}</span></div>
    <div className="mdx-card__lights cdx-trading-card__lights" aria-hidden><i className="cdx-trading-card__foil" /><i className="cdx-trading-card__reflection" /><div className="mdx-card__gloss" /></div>
  </div>;
}
