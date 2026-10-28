/** The back inside a 3D card (kept apart from CardBack so Card3D and CardBack never import each other). */
import { useEffect, useRef } from "react";
import { getEdition } from "../../../lib/mintdex/editions";
import { getMemeIcon } from "../../../lib/mintdex/meme-icons";
import { GeneratedCardReverse } from "../../carddex/GeneratedCardArt";
import { DesignBack } from "./DesignBack";
import { ThemeBack } from "./theme-back";
import type { CardBackTheme } from "./types";
import "../../../themed-card-backs.css";

/** Sized copies (tools/process_assets.py cardback-sizes): new paths; the 900px original is untouched. */
export const BACK_SRC = "/assets/carddex-back.svg";
export const BACK_SRCSET = "/assets/carddex-back.svg 900w";

/**
 * The back of a 3D card: one flat plane. The shared Holo Seal layout in the design's template (templates.ts, CSS
 * variables on the scene): the plate recolored (its cream lines multiplied by the template's ink, its dark field
 * screened with the template's field) and the template's motif, with no tier label under the seal.
 * Its keylines and guilloche glint (the plate's own luminance is the foil map: the very copy
 * the img loaded, read back once it is in) and the seal's holo runs with the light. `face` puts it in front, with
 * no turn (CardBack hand).
 */
export function BackFace({ sizes, eager = false, face = false, theme }: { sizes: string; eager?: boolean; face?: boolean; theme?: CardBackTheme }) {
  const themed = getMemeIcon(theme?.memeIcon) ?? getEdition(theme?.edition);
  const ref = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    const im = img.current;
    if (!el || !im) return;
    const sync = () => {
      if (!im.complete || !im.naturalWidth || !im.currentSrc) return;
      el.style.setProperty("--back-mask", `url("${im.currentSrc}")`);
      el.setAttribute("data-lit", "");
    };
    sync();
    im.addEventListener("load", sync);
    // The first turn never shows an undecoded back: decode it when the page is idle.
    const decode = () => void im.decode().catch(() => undefined);
    const idle = "requestIdleCallback" in window;
    const h = idle ? window.requestIdleCallback(decode) : window.setTimeout(decode, 600);
    return () => {
      im.removeEventListener("load", sync);
      if (idle) window.cancelIdleCallback(h);
      else clearTimeout(h);
    };
  }, []);
  return (
    <div ref={ref} className={face ? "mdx-card3d__back mdx-card3d__back--face" : "mdx-card3d__back"} data-theme-back={themed?.key ?? theme?.cardTemplate} aria-hidden>
      <img
        ref={img}
        src={BACK_SRC}
        srcSet={BACK_SRCSET}
        sizes={sizes}
        alt=""
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
      {/* The design's template (card3d.css): the recolor and motif, all in this plane. */}
      <i className="mdx-card3d__back-tint" />
      <GeneratedCardReverse cardTemplate={theme?.cardTemplate} eager={eager} sizes={sizes}>{themed ? <ThemeBack theme={theme} sizes={sizes} /> : <DesignBack cardTemplate={theme?.cardTemplate} />}</GeneratedCardReverse>
      <div className="mdx-card3d__back-lights">
        <div className="mdx-card3d__back-foil" />
        <div className="mdx-card3d__back-seal" />
        {/* The back's holo and glare (card3d.css .mdx-card__poke--back). */}
        <i className="mdx-card__poke mdx-card__poke--back" />
        <div className="mdx-card__gloss" />
      </div>
    </div>
  );
}
