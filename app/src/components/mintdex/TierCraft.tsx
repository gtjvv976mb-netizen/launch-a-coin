import { useId } from "react";
import type { Box, FrameLayout, Tier, TierKey } from "../../lib/mintdex/tiers";

const W = 630;
const H = 880;

function panelPath(box: Box, pad = 2) {
  const x = box.x * W - pad;
  const y = box.y * H - pad;
  const w = box.w * W + pad * 2;
  const h = box.h * H + pad * 2;
  return `M${x},${y}h${w}v${h}h${-w}Z`;
}

function cutRect(x: number, y: number, w: number, h: number, cut: number) {
  return `M${x + cut},${y}H${x + w - cut}l${cut},${cut}V${y + h - cut}l${-cut},${cut}H${x + cut}l${-cut},${-cut}V${y + cut}Z`;
}

function polygon(r: number, count: number, angle = -Math.PI / 2) {
  return Array.from({ length: count }, (_, i) => {
    const a = angle + (i * Math.PI * 2) / count;
    return `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
  }).join("") + "Z";
}

function star(x: number, y: number, r: number) {
  return `M${x},${y - r}Q${x + r * 0.19},${y - r * 0.19} ${x + r},${y}Q${x + r * 0.19},${y + r * 0.19} ${x},${y + r}Q${x - r * 0.19},${y + r * 0.19} ${x - r},${y}Q${x - r * 0.19},${y - r * 0.19} ${x},${y - r}Z`;
}

/** Engraved die marks, rather than a second illustration over the coin's own artwork. */
const EMBLEM: Record<TierKey, string> = {
  spark: "",
  surge: "M5,-22L-12,2H-2L-6,23L13,-5H3Z",
  nova: star(0, 0, 22),
  tide: "M-23,5Q-10,-16 2,-3Q12,9 24,-9M-22,15Q-10,-3 2,8Q13,19 24,2M-16,-8Q-5,-22 6,-16",
  apex: "M-23,-12L-12,1L0,-20L12,1L23,-12L18,17H-18ZM-17,8H17M-15,23H15",
  ember: "M1,-24C8,-10 22,-8 19,7C17,22 -6,28 -17,12C-25,1 -12,-11 -8,-18C-9,-6 -5,-1 -2,0C2,-6 5,-12 1,-24ZM0,4C8,11 7,19 0,20C-8,18 -6,10 0,4Z",
  bloom: "M0,-5C-17,-26 17,-26 0,-5C21,-21 31,8 6,1C31,8 11,30 3,7C11,30 -17,30 -3,7C-17,30 -31,8 -6,1C-31,8 -21,-21 0,-5ZM0,-3A5,5 0 1 0 0,7A5,5 0 1 0 0,-3Z",
  mythic: "M0,-24L21,0L0,24L-21,0ZM0,-24L8,0L0,24L-8,0ZM-21,0H21",
  aurora: "M12,-22A24,24 0 1 0 16,20A20,20 0 0 1 12,-22Z" + star(18, -11, 6),
  relic: "M0,-26L5,-6L23,-13L8,1L23,14L5,8L0,27L-5,8L-23,14L-8,1L-23,-13L-5,-6ZM0,-16V17M-15,1H15",
  frost: "M0,-26V26M-22.5,-13L22.5,13M-22.5,13L22.5,-13M-7,-19L0,-12L7,-19M-7,19L0,12L7,19M-20,-3L-11,-6L-12,-16M20,3L11,6L12,16M-20,3L-11,6L-12,16M20,-3L11,-6L12,-16",
  regal: "M0,-26C-14,-12 -9,-5 -3,4C-19,-12 -30,0 -20,10C-19,1 -9,4 -6,11H6C9,4 19,1 20,10C30,0 19,-12 3,4C9,-5 14,-12 0,-26ZM-11,12H11M-8,17H8M-3,17L-8,25L0,22L8,25L3,17",
  celestial: "M-22,8L-9,-17L8,-8L21,-22M-9,-17L0,19L21,9L8,-8M-22,8L0,19" + star(-22, 8, 3) + star(-9, -17, 4) + star(8, -8, 3) + star(21, -22, 4) + star(0, 19, 3) + star(21, 9, 3),
  legend: "M-2,24C-25,13 -26,-8 -15,-25M2,24C25,13 26,-8 15,-25M-17,-17Q-30,-25 -26,-8Q-18,-7 -17,-17ZM-21,-4Q-36,-10 -28,7Q-20,6 -21,-4ZM-18,9Q-33,10 -20,22Q-13,18 -18,9ZM-9,21Q-21,26 -6,31Q0,25 -9,21ZM17,-17Q30,-25 26,-8Q18,-7 17,-17ZM21,-4Q36,-10 28,7Q20,6 21,-4ZM18,9Q33,10 20,22Q13,18 18,9ZM9,21Q21,26 6,31Q0,25 9,21Z",
};

const CORNERS = [
  "translate(32 30)",
  "translate(598 30) scale(-1 1)",
  "translate(32 850) scale(1 -1)",
  "translate(598 850) scale(-1 -1)",
];

/**
 * Rarity is physical at rest: pressed ink → etched metal → raised foil → inset jewels → gold leaf.
 * This single, static face overlay sits after the raster frame and before its text / light layers.
 * It intentionally adds no animation, filters, promoted layers or image requests. Parchment, art and
 * both footer labels are clipped out using the same frame layout as MintCard's readable content.
 */
export function TierCraft({ tier, layout, lite = false }: { tier: Tier; layout: FrameLayout; lite?: boolean }) {
  const id = `craft-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const level = tier.level;
  const etched = level >= 4;
  const raised = level >= 7;
  const inset = level >= 10;
  const precious = level >= 12;
  const legend = level === 14;
  const metal = `url(#${id}-metal)`;
  const jewel = `url(#${id}-jewel)`;
  const safe = `M0,0H${W}V${H}H0Z` + [layout.name, layout.window, layout.type, layout.text, ...layout.footer].map((box) => panelPath(box)).join("");
  const window = layout.window;
  const x = window.x * W - 7;
  const y = window.y * H - 7;
  const width = window.w * W + 14;
  const height = window.h * H + 14;
  // Match the raster frame's flat-top hex die. One silhouette prevents competing seal outlines.
  const seal = polygon(51, 6, 0);
  const insetSeal = polygon(raised ? 43 : 46, 6, 0);
  // One path holds every reeded cut. It stays crisp without expanding the SVG into a hundred nodes.
  const reeds = legend ? Array.from({ length: 37 }, (_, i) => {
    const px = 65 + i * 14;
    return `M${px},11v9M${px},860v9`;
  }).join("") + Array.from({ length: 54 }, (_, i) => {
    const py = 65 + i * 14;
    return `M10,${py}h9M611,${py}h9`;
  }).join("") : "";

  return (
    <svg className="mdx-card__craft mdx-tiercraft" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false" data-tier={tier.key} data-level={level} data-lite={lite ? "" : undefined}>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" className="mdx-tiercraft__bright" />
          <stop offset="0.19" className="mdx-tiercraft__base" />
          <stop offset="0.38" className="mdx-tiercraft__bright" />
          <stop offset="0.55" className="mdx-tiercraft__shade" />
          <stop offset="0.76" className="mdx-tiercraft__base" />
          <stop offset="1" className="mdx-tiercraft__bright" />
        </linearGradient>
        <linearGradient id={`${id}-jewel`} x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" className="mdx-tiercraft__gem-light" />
          <stop offset="0.42" className="mdx-tiercraft__gem" />
          <stop offset="1" className="mdx-tiercraft__gem-dark" />
        </linearGradient>
        <clipPath id={`${id}-safe`}><path d={safe} clipRule="evenodd" fillRule="evenodd" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}-safe)`}>
        {/* A pressed line at entry level. Each material promotion adds a visibly thicker cut. */}
        <rect className="mdx-tiercraft__recess" x="23" y="23" width="584" height="834" rx="23" fill="none" strokeWidth={raised ? 6 : etched ? 3.5 : 2} />
        <rect className="mdx-tiercraft__keyline" x="23" y="21" width="584" height="834" rx="23" fill="none" stroke={metal} strokeWidth={raised ? 3.5 : etched ? 2 : 1.2} />

        {etched ? <path d={cutRect(x, y, width, height, inset ? 17 : 11)} fill="none" stroke={metal} strokeWidth={inset ? 7 : raised ? 4 : 2.2} /> : null}

        {raised ? <path className="mdx-tiercraft__hairline" d={cutRect(x - 5, y - 5, width + 10, height + 10, inset ? 20 : 14)} fill="none" stroke={metal} strokeWidth="1.2" /> : null}

        {etched ? CORNERS.map((transform, i) => (
          <g key={i} transform={transform}>
            <path className="mdx-tiercraft__recess" d={inset ? "M-3,58V11Q-3,-3 11,-3H58V7H14Q7,7 7,14V58Z" : "M0,42V10Q0,0 10,0H42V4H11Q4,4 4,11V42Z"} />
            <path d={inset ? "M-3,55V10Q-3,-4 11,-4H55V4H14Q5,4 5,14V55Z" : "M0,40V9Q0,-1 10,-1H40V2H11Q3,2 3,11V40Z"} fill={metal} />
            {raised ? <path className="mdx-tiercraft__engraving" d="M13,39V18Q13,13 18,13H39M21,32V21H32" fill="none" strokeWidth="1.5" /> : null}
          </g>
        )) : level >= 2 ? <path className="mdx-tiercraft__pressed" d={level === 2 ? "M41,43L48,31L45,41H53L42,53L46,43ZM589,43L582,31L585,41H577L588,53L584,43Z" : star(43, 40, 9) + star(587, 40, 9) + star(43, 840, 7) + star(587, 840, 7)} /> : null}

        {/* Raised art-window brackets make the X / XI promotion readable at grid scale. */}
        {inset ? <path d={`M${x + 8},${y + 48}V${y + 16}l16,-16h32v7h-28l-13,13v28ZM${x + width - 8},${y + 48}V${y + 16}l-16,-16h-32v7h28l13,13v28ZM${x + 8},${y + height - 48}v32l16,16h32v-7h-28l-13,-13v-28ZM${x + width - 8},${y + height - 48}v32l-16,16h-32v-7h28l13,-13v-28Z`} fill={metal} /> : null}

        {level === 11 ? <path className="mdx-tiercraft__crystal" d={`M${x + 34},${y + 3}l9,-14l9,14l-9,14ZM${x + width - 52},${y + 3}l9,-14l9,14l-9,14ZM${x + 34},${y + height - 3}l9,-14l9,14l-9,14ZM${x + width - 52},${y + height - 3}l9,-14l9,14l-9,14Z`} fill={jewel} stroke={metal} strokeWidth="2" /> : null}

        {precious ? CORNERS.map((transform, i) => <g key={i} transform={transform}>
          <path d="M13,-11L26,0L13,22L0,0Z" fill={jewel} stroke={metal} strokeWidth={legend ? 4 : 3} />
          <path className="mdx-tiercraft__facet" d="M13,-7L20,0L13,15L6,0ZM6,0H20M13,-7V15" fill="none" strokeWidth="1.4" />
        </g>) : null}

        {level === 13 ? <>
          <path className="mdx-tiercraft__constellation" d="M83,109L148,112L184,103L253,112M377,112L451,103L489,112L547,109M40,571L43,617L35,651L43,695M590,571L587,617L595,651L587,695M84,754L149,763L199,752M431,752L481,763L546,754" fill="none" stroke={metal} strokeWidth="1.2" />
          <path fill={metal} d={star(83, 109, 4) + star(184, 103, 4) + star(253, 112, 3) + star(377, 112, 3) + star(451, 103, 4) + star(547, 109, 4) + star(40, 571, 4) + star(35, 651, 4) + star(590, 571, 4) + star(595, 651, 4) + star(149, 763, 4) + star(481, 763, 4)} />
        </> : null}

        {legend ? <>
          <path className="mdx-tiercraft__reeding" d={reeds} stroke={metal} strokeWidth="3" />
          <path className="mdx-tiercraft__enamel" d="M31,104V737M599,104V737M99,31H531M99,849H252M378,849H531" fill="none" strokeWidth="5" />
          <path d="M74,745C128,737 165,745 205,756M556,745C502,737 465,745 425,756M79,754Q92,737 105,750Q92,765 79,754ZM111,752Q123,739 135,753Q122,765 111,752ZM143,756Q155,744 166,760Q151,769 143,756ZM551,754Q538,737 525,750Q538,765 551,754ZM519,752Q507,739 495,753Q508,765 519,752ZM487,756Q475,744 464,760Q479,769 487,756Z" fill={metal} />
        </> : null}

        {/* The seal is kept inside the original 106 px gap between owner and dex number. */}
        {etched ? <g transform="translate(315 796)">
          <path className="mdx-tiercraft__recess" d={seal} transform="translate(0 2)" />
          <path d={seal} fill={metal} stroke={metal} strokeWidth="1.5" />
          <path className="mdx-tiercraft__seal" d={insetSeal} strokeWidth={raised ? 2 : 1} />
          <path className="mdx-tiercraft__emblem" d={EMBLEM[tier.key]} fill="none" stroke={metal} strokeWidth={legend ? 2.6 : 2.2} strokeLinecap="round" strokeLinejoin="round" />
          {inset && !lite ? <path className="mdx-tiercraft__seal-detail" d="M-23,-35H23M-23,35H23M-35,-23V23M35,-23V23" fill="none" stroke={metal} strokeWidth="1" /> : null}
        </g> : null}
      </g>
    </svg>
  );
}
