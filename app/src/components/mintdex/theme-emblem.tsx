import type { EditionKey } from "../../lib/mintdex/editions";
import type { MemeIconKey } from "../../lib/mintdex/meme-icons";

export type ThemeEmblemKey = MemeIconKey | EditionKey;

/** Decorative collection marks. They never replace a token's artwork, name, ticker or ownership data. */
export function ThemeEmblem({ icon, className = "" }: { icon: ThemeEmblemKey; className?: string }) {
  const mark = (() => {
    switch (icon) {
      case "doge": return <>
        <path d="M25 72c-12-11-15-26-9-43m7 34-12-3 2-12 11 10m-2-16-10-7 7-10 5 12m51 35c12-11 15-26 9-43m-7 34 12-3-2-12-11 10m2-16 10-7-7-10-5 12M29 80h42" />
        <path d="M40 23h13c24 0 24 44 0 44H40zm-8 22h31M44 16v7m10-7v7m-10 44v9m10-9v9" />
      </>;
      case "pepe": return <>
        <path d="M16 65q34-14 68 0-34 24-68 0Zm34-8c-18-4-28-18-23-31 13 0 22 9 23 31Zm0 0c18-4 28-18 23-31-13 0-22 9-23 31Z" />
        <path d="M50 55C38 40 38 23 50 15c12 8 12 25 0 40ZM21 81q13-6 29 0t29 0M34 89q16-4 32 0" />
      </>;
      case "shib": return <>
        <path d="m18 45 5-30 21 15h12l21-15 5 30-10 27-22 15-22-15Z" />
        <path d="m27 28 9 11-10 8m47-19-9 11 10 8M29 53l13 5m29-5-13 5M41 67l9 8 9-8-9-5Z" />
      </>;
      case "bonk": return <>
        <path d="M20 71 62 22c4-5 13-6 17-2s3 13-2 17L28 79Zm48-45 7 7M20 71l8 8M14 85l7-7m7 6 5 5" />
        <path d="m17 33 11 2-5 9m44 23 15 1-5 12M28 13l5 11m55 19-11 3M46 79l-1 11" />
      </>;
      case "wif": return <>
        <path d="M23 54c0-25 9-37 27-37s27 12 27 37M20 54h60v20H20zM31 54V37m10 17V29m9 25V26m9 28V29m10 25V37M27 61v7m10-7v7m10-7v7m10-7v7m10-7v7m6-7v7" />
        <path d="M43 17c-7-12 8-18 13-8 3 6-3 9-6 8M25 81h50" />
      </>;
      case "popcat": return <>
        <path d="M25 50c-4-13-3-24-1-32l19 11h14l19-11c2 8 3 19-1 32M25 50c-8 31 58 31 50 0" />
        <ellipse cx="50" cy="61" rx="10" ry="14" /><path d="m32 43 3-1m30 1 3 1M13 43l-4-6m4 20H5m82-14 4-6m-4 20h8M27 89l5-7m41 7-5-7" />
      </>;
      case "gamestop": return <>
        <path d="M29 30h42c12 0 20 39 11 44-7 4-16-11-23-12H41c-7 1-16 16-23 12-9-5-1-44 11-44Z" />
        <path d="M29 40v17m-8-8h16m26-5h1m10 9h1M40 72h20M35 20h30" />
        <path d="M42 40h14v8H42zm4 0v-8h6v8" className="mdx-theme-emblem__solid" />
      </>;
      case "amc": return <>
        <path d="M20 42h60v40H20zM20 42l-4-17 59-14 4 17ZM25 23l10 13m7-17 10 13m7-17 10 13M29 52h42" />
        <path d="m45 59 15 8-15 8Z" className="mdx-theme-emblem__solid" />
      </>;
      case "blackberry": return <>
        <rect x="25" y="9" width="50" height="82" rx="11" /><rect x="32" y="20" width="36" height="34" rx="2" />
        <path d="M38 14h24M47 61h6m-17 8h4m8 0h4m8 0h4m-28 9h4m8 0h4m8 0h4M47 86h6" />
      </>;
      case "nokia": return <>
        <path d="M34 10h32c10 0 16 16 14 42l-4 29c-1 8-51 8-52 0l-4-29c-2-26 4-42 14-42Z" />
        <rect x="29" y="25" width="42" height="27" rx="3" /><path d="M40 17h20M34 61h6m20 0h6M34 70h6m9 0h2m9 0h6M34 79h6m9 0h2m9 0h6M48 59h4" />
      </>;
      case "coinbase": return <>
        <circle cx="50" cy="50" r="34" className="mdx-theme-emblem__solid" />
        <path d="M35 35h30v30H35z" className="mdx-theme-emblem__cutout" />
      </>;
      case "binance": return <>
        <path d="m50 12 17 17-8 8-9-9-9 9-8-8Zm0 76L33 71l8-8 9 9 9-9 8 8ZM12 50l17-17 8 8-9 9 9 9-8 8Zm76 0L71 67l-8-8 9-9-9-9 8-8ZM50 38l12 12-12 12-12-12Z" className="mdx-theme-emblem__solid" />
      </>;
      case "kraken": return <>
        <path d="M17 74V44a33 33 0 0 1 66 0v30H70V48H58v26H43V48H31v26Z" className="mdx-theme-emblem__solid" />
        <path d="M27 86q11-8 23 0t23 0" />
      </>;
      case "strategy": return <>
        <path d="M28 28h26c26 0 24 25 0 25H33m0 0h24c28 0 26 25 0 25H28M38 19v68m13-68v9m0 50v9" />
        <path d="m76 16 9 9m-9 62 9-9M18 39v22" />
      </>;
      case "wildtype": return <>
        <path d="m50 12 32 19v38L50 88 18 69V31Z" /><path d="M31 66c-8-23 5-35 33-36 6 25-6 39-33 36Zm0 0 29-31M40 55l-1-13m9 5 12 1M25 74l25 14 25-14" />
      </>;
      case "ronin": return <>
        <path d="M20 76 73 23l7 7-53 53Zm-4-1 12 12M66 15l19 19M71 9l20 20M14 57l29 29" />
        <path d="M18 20h27v27H18zM23 25h17v17H23z" />
      </>;
      case "astral": return <>
        <path d="m50 8 9 28 29 14-29 14-9 28-9-28L12 50l29-14Z" /><path d="m50 28 6 16 16 6-16 6-6 16-6-16-16-6 16-6Z" />
        <circle cx="22" cy="22" r="3" /><circle cx="78" cy="78" r="3" />
      </>;
      case "neon-circuit": return <>
        <path d="M33 22h34l11 11v34L67 78H33L22 67V33Z" /><path d="m54 30-20 25h15l-3 15 20-26H51ZM35 8v14m15-14v14M65 8v14M35 78v14m15-14v14m15-14v14M8 35h14M8 50h14M8 65h14m56-30h14M78 50h14M78 65h14" />
      </>;
      case "sovereign": return <>
        <path d="m15 30 19 16 16-26 16 26 19-16-8 42H23ZM24 82h52M25 61h50M50 6v8" />
        <path d="m50 43 7 9-7 9-7-9Z" />
      </>;
      case "abyssal": return <>
        <path d="M78 72c-22 24-66 2-62-27 3-25 40-36 58-16 14 15 1 37-17 35-15-1-21-20-8-26 10-4 19 9 9 14" />
        <path d="M29 69 18 80m27-6-4 15m19-16 5 13M20 47H9m17-20-8-7m29-3V7m24 17 8-8" />
      </>;
    }
  })();
  return <svg className={`mdx-theme-emblem ${className}`} data-theme-emblem={icon} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{mark}</svg>;
}
