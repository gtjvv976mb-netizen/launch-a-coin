import type { CSSProperties } from "react";
import { getCardDesign } from "../../../lib/carddex/designs";

/** The reverse carries only geometric engraving: no theme name, tier or brand wordmark. */
export function DesignBack({ cardTemplate }: { cardTemplate?: string }) {
  const design = getCardDesign(cardTemplate);
  const style = { "--design-base": design.palette[0], "--design-metal": design.palette[1], "--design-paper": design.palette[2] } as CSSProperties;
  return <div className="cdx-design-back" data-back-layout={design.layout ?? design.key} style={style}>
    <svg viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden>
      <rect x="35" y="35" width="560" height="810" rx="25" /><rect x="48" y="48" width="534" height="784" rx="19" />
      <path d="M67 163V67h96m304 0h96v96M67 717v96h96m304 0h96v-96M67 191h496M67 689h496" />
      <path d="m315 72 17 22-17 22-17-22Zm0 692 17 22-17 22-17-22ZM34 255l15 15-15 15-15-15Zm562 0 15 15-15 15-15-15ZM34 595l15 15-15 15-15-15Zm562 0 15 15-15 15-15-15Z" />
      {Array.from({ length: 18 }, (_, n) => <ellipse key={n} cx="315" cy="440" rx={205 - n * 6} ry={245 - n * 5} transform={`rotate(${n * 10} 315 440)`} opacity=".45" />)}
    </svg>
    <div className="cdx-design-back__seal"><svg viewBox="0 0 100 100" aria-hidden><path d="m50 4 40 23v46L50 96 10 73V27Z" /><path d="m50 18 28 16v32L50 82 22 66V34Z" />{design.key === "stock-gme" ? <path d="M22 35h56v35H22zM35 42v21m-10-10h20m17-8v3m8 9v3M39 73h22" /> : design.key === "stock-tsla" ? <path d="m57 19-28 34h22l-10 29 31-40H49Z" /> : design.key === "stock-nvda" ? <><path d="M30 30h40v40H30zM39 39h22v22H39zM40 20v10m10-10v10m10-10v10M40 70v10m10-10v10m10-10v10M20 40h10m-10 10h10m-10 10h10m40-20h10M70 50h10M70 60h10" /></> : design.key === "stock-aapl" ? <><rect x="28" y="21" width="44" height="58" rx="12" /><path d="M41 31h18M46 70h8" /></> : design.key === "stock-mstr" ? <><ellipse cx="50" cy="34" rx="26" ry="10" /><path d="M24 34v13c0 13 52 13 52 0V34M24 47v13c0 13 52 13 52 0V47M24 60v8c0 13 52 13 52 0v-8" /></> : design.key === "stock-coin" ? <><circle cx="50" cy="50" r="28" /><circle cx="50" cy="50" r="19" /><path d="M40 40h20v20H40zM50 13v10m0 54v10M13 50h10m54 0h10" /></> : <path d="M65 35H43L31 50l12 15h22M39 50h26" />}</svg></div>
  </div>;
}
