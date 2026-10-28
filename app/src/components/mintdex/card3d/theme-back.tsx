import { useRef, type CSSProperties } from "react";

import { getEdition } from "../../../lib/mintdex/editions";
import { getMemeIcon } from "../../../lib/mintdex/meme-icons";
import { MemeThemePortrait } from "../MemeIconCard";
import { useImageFailure } from "../image-state";
import { ThemeEmblem } from "../theme-emblem";
import type { CardBackTheme } from "./types";

/** The original reverse's outline and keylines surround a subject-specific collector print. */
export function ThemeBack({ theme, sizes }: { theme?: CardBackTheme; sizes: string }) {
  const icon = getMemeIcon(theme?.memeIcon);
  const edition = getEdition(theme?.edition);
  const design = icon ?? edition;
  const printRef = useRef<HTMLImageElement>(null);
  const printSource = design?.backArtSrc ?? null;
  const print = useImageFailure(printRef, printSource, design?.key ?? "");
  if (!design) return null;
  const style = {
    "--theme-base": design.palette[0],
    "--theme-accent": design.palette[1],
    "--theme-paper": design.palette[2],
    "--theme-emblem-cutout": design.palette[0],
  } as CSSProperties;

  return <div className="mdx-theme-back" data-theme-pattern={design.key} data-theme-back-art={printSource && !print.failed ? design.key : undefined} style={style}>
    <div className="mdx-theme-back__field" />
    <svg className="mdx-theme-back__engraving" viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
      <path d="M82 30h466l52 52v716l-52 52H82l-52-52V82ZM88 44h454l44 44v704l-44 44H88l-44-44V88Z" />
      <path d="M88 160h454M88 720h454M92 172h446M92 708h446" />
      <path d="M44 227h16v426H44m542-426h-16v426h16" />
      <path d="m315 182 12 12-12 12-12-12Zm0 492 12 12-12 12-12-12Z" />
      <path d="M194 100h88m66 0h88m-139-16 18 16-18 16m36-32-18 16 18 16M240 128h150" />
    </svg>
    {["tl", "tr", "bl", "br"].map((corner) => <span key={corner} className={`mdx-theme-back__corner mdx-theme-back__corner--${corner}`}>
      <ThemeEmblem icon={design.key} />
    </span>)}
    <div className={`mdx-theme-back__hero${icon?.mascotCrop ? " mdx-theme-back__hero--portrait" : ""}`}>
      {icon?.mascotCrop ? <MemeThemePortrait icon={icon} priority /> : <ThemeEmblem icon={design.key} />}
    </div>
    {printSource ? <img
      ref={printRef}
      className="mdx-theme-back__print"
      data-theme-back-print={design.key}
      src={printSource}
      srcSet={`${printSource.replace(/\.webp$/, "-320.webp")} 320w, ${printSource} 1360w`}
      sizes={sizes}
      alt=""
      hidden={print.failed}
      draggable={false}
      loading="eager"
      decoding="async"
      onError={print.onError}
      onLoad={print.onLoad}
    /> : null}
  </div>;
}
