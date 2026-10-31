import { Icon } from "../mintdex/ui";
import {
  OFFICIAL_TOKEN_MINT,
  OFFICIAL_TOKEN_NAME,
  OFFICIAL_TOKEN_TICKER,
  OFFICIAL_TOKEN_URL,
  OFFICIAL_X_HANDLE,
  OFFICIAL_X_URL,
} from "../../lib/carddex/official";

/*
 * The site's official X account and token (lib/carddex/official.ts). Plain links that open the other site in a new
 * tab: rel="noopener noreferrer", the existing external glyph, and a screen-reader hint naming where they go. No
 * price, market cap or call to buy: the token link is information.
 */

const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * The desktop rail foot: one row of two quiet links under Terms & risks, in the same 14px slate style (40px tall
 * under a fine pointer, 44px on touch). One row, not two, so the rail foot still fits a 640px-tall window; the row
 * wraps rather than overflows if the type renders wider.
 */
export function OfficialRailLinks() {
  const cls = "mdx-link inline-flex min-h-6 items-center gap-1 text-[14px] font-normal text-slate";
  return (
    <div className="flex flex-wrap items-center gap-x-4" data-official-row="">
      <a href={OFFICIAL_X_URL} {...NEW_TAB} className={cls} data-official="x">
        {OFFICIAL_X_HANDLE}
        <span className="sr-only"> on X (opens X in a new tab)</span>
        <Icon name="external" size={12} />
      </a>
      <a href={OFFICIAL_TOKEN_URL} {...NEW_TAB} className={cls} data-official="token">
        Token<span className="sr-only"> {OFFICIAL_TOKEN_TICKER}, this site's official token (opens pump.fun in a new tab)</span>
        <Icon name="external" size={12} />
      </a>
    </div>
  );
}

/** Phones have no rail: the same two links close every page, above the tab bar, each a 44px target (.mdx-hit). */
export function OfficialPhoneLinks() {
  const cls = "mdx-link mdx-hit inline-flex items-center gap-1 text-[14px] font-normal text-slate";
  return (
    <nav aria-label="Official links" className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 lg:hidden">
      <a href={OFFICIAL_X_URL} {...NEW_TAB} className={cls} data-official="x">
        {OFFICIAL_X_HANDLE} on X<span className="sr-only"> (opens X in a new tab)</span>
        <Icon name="external" size={12} />
      </a>
      <a href={OFFICIAL_TOKEN_URL} {...NEW_TAB} className={cls} data-official="token">
        Official token<span className="sr-only"> {OFFICIAL_TOKEN_TICKER} (opens pump.fun in a new tab)</span>
        <Icon name="external" size={12} />
      </a>
    </nav>
  );
}

/**
 * How it works (#official): the account, the token with its full mint as selectable text, and who it belongs to.
 * The two link rows are 44px tall (.cdx-how__linkrow), so each link's .mdx-hit area stays inside its own row and the
 * X link's lower edge never sits under the token link's target.
 */
export function OfficialLinksDetails() {
  return (
    <ul>
      <li className="cdx-how__linkrow">
        X:{" "}
        <a href={OFFICIAL_X_URL} {...NEW_TAB} className="mdx-link mdx-hit cdx-how__ext" data-official="x">
          {OFFICIAL_X_HANDLE}
          <span className="sr-only"> (opens X in a new tab)</span>
          <Icon name="external" size={12} />
        </a>
      </li>
      <li className="cdx-how__linkrow">
        Token:{" "}
        <a href={OFFICIAL_TOKEN_URL} {...NEW_TAB} className="mdx-link mdx-hit cdx-how__ext" data-official="token">
          {OFFICIAL_TOKEN_NAME} ({OFFICIAL_TOKEN_TICKER}) on pump.fun
          <span className="sr-only"> (opens pump.fun in a new tab)</span>
          <Icon name="external" size={12} />
        </a>
      </li>
      <li>
        Its mint address: <span className="cdx-how__mint">{OFFICIAL_TOKEN_MINT}</span>
      </li>
      <li>It was created on pump.fun, not through Launch a Card.</li>
      <li>Any other token using this name is not this site's. Check the mint address.</li>
    </ul>
  );
}
