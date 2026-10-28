/**
 * Launch a Card chrome primitives: Holo Soft (refs/soft-modern-delta.md, on top of refs/vintage-delta.md and spec
 * sections 6, 7 and 12.2). A warm pearl canvas, paper panels with large radii, and every control a pill or a
 * soft rounded rectangle. Radius roles: chip 6, row 12, field 14, pop 18, panel 24, aside 28, pill. One foil
 * from the Holo Seal, in four meanings only (logo, where you are, level up, the primary sheen). Cards stay the
 * most colorful objects; every minted card sits in a tray concentric with its corner.
 * Props are optional unless marked (req). Every component also takes className unless noted.
 *
 * Layout
 *   PageFrame      children. View root: flex column, h-full on desktop, gap 24 (short 16).
 *   PageHeader     title (req), context, right. The 56px header row: h1 + one slate context line | controls.
 *   SectionHead    title (req), right (string renders as Small slate), as "h2" | "h3", live (a value that
 *                  changes on each real event: shows the 6px LiveDot after the title, which pings on mount and
 *                  on each change), livePaused (the dot turns slate and still). 32px section header.
 *   Ledge          style. The 5px ledge with its faded hairline (absolute-position it yourself in custom layouts).
 *   Pocket         featured, children (req). The tray every minted card sits in (6px, featured 12px; phones 4 and
 *                  8), concentric with the card corner. Drawn outside its box: no layout change. Wrap the lift,
 *                  not the reverse.
 *   Caption        name (req), no ("No. 004"), level, tierSuffix (", 3 of 14"), rows [{ label, value }],
 *                  link, children, as "p" | "h2" | "h3". Featured caption, flush left with the card: serif
 *                  plate No., sans name, tier chip, round dot leader rows.
 *   GridCaption    name (req), value (line 1 right, num), sub (line 2 left), subRight (line 2 right). 56px strip.
 *   LabelNum       label (req), value (req). "Buy now 14.78": slate words + ink num.
 *   Shelf<T>       items (req), cols (req), keyOf (req), render(item, cardW) (req), cardW (a maximum; omit to
 *                  fill the width), gap = 20, rowGap, dealKey (the view shown: sort, design, search, tab; a
 *                  change deals every card again). Rows of cards on one continuous ledge each (spec 6.4).
 *                  CSS sizes the columns and ledges, so server markup fits any screen before measuring. Cells
 *                  cascade in (mdx-enter) on mount, page turns and dealKey changes (P1-20).
 *   ShelfItem      card (req), caption (req), width (max). In a tray. Wrap it in a Link: hover lifts the card
 *                  6px out of its tray.
 *   EmptyState     title (req), body, action. The card back in its tray on a ledge, centered.
 *   Skeleton       onWall, style. Shimmering block (tint on panel, wall-deep on canvas), row radius.
 *   Stats          items [{ label, value, unit?, watch?, tick? }] (req), size "md" | "lg", cols. dl grid.
 *   fitCardGrid(width, height, { minW, maxW, strip = 56, gap = 20, aspect = 63/88 }, count)
 *                  -> { rows, cols, cardW, count }. Largest readable cards that fit with no scroll.
 *   FitList<T>     items (req), rowHeight (req), render(item, i) (req), onFit(n), slack, ...div attrs (role,
 *                  handlers: useLiveList's bind). Whole rows only.
 *   useSize<T>(fallback) -> [ref, { width, height }]. ResizeObserver, SSR safe.
 *   usePageKeys(page, pages, setPage, { wrap, enabled, afterPage }). ArrowLeft / ArrowRight paging (not in
 *                  fields or dialogs). Use wrap: true for the Home stepper. If the focused card or row unmounts
 *                  with the page, focus moves to afterPage's target or main#content (P1-24).
 *   useFlash(value) -> "up" | "down" | undefined. One-frame flash when a polled number changes.
 *   useTick(value) -> { n, dir }. Bumps n when a watched value changes (never under reduced motion): key the
 *                  value on n with class mdx-tick and data-dir so it slides in. Num tick does this for you.
 *   useArrivals(ids) -> Set of ids that appeared since the previous list (empty on the first list, stable
 *                  between polls). Mark those rows data-new for the sky wash.
 *   useLiveList(items, idOf, [one, many]) -> { shown, fresh, paused, setPaused, held, said, bind }. A live
 *                  list (P1-17): rows hold still under the pointer, with focus inside or while paused (kept per
 *                  viewer); fresh rows get the wash; said is the polite "2 new trades"; bind makes it a log.
 *   prefersReducedMotion() -> boolean. The one reduced motion check for JS motion (false on the server): true
 *     only under the Calm motion switch.
 *   CARD_ASPECT    63 / 88. Size a MintCard by width only; it always renders at aspect-ratio 63 / 88.
 *   isTypingTarget(target), isDialogOpen(): guards for global keyboard shortcuts.
 *
 * Controls
 *   Button         variant "primary" | "outline" (secondary) | "ghost" | "chip" (quick amounts) | "buy" | "sell",
 *                  size "md" 44 | "sm" 32 | "lg" 48, block, pending, pendingLabel, ref, ...button attrs. type
 *                  defaults to "button". Pills (a button beside an input in .mdx-pair takes the field radius).
 *                  disabled and pending render aria-disabled (pending also aria-busy) instead of the disabled
 *                  attribute, so a focused button keeps focus; the click (and a form's Enter submit) is blocked
 *                  and onBlocked runs. feedback ({ state, seq } from useAction) + successLabel: on success the
 *                  label becomes a drawn check and "Bought" for 1.1s; on error the button shakes once (P1-8).
 *   CheckIcon      size = 12. The check that draws itself (mdx-check).
 *   ButtonLink     to (req), params, search, variant, size, block. Router Link styled as a Button.
 *   buttonClass({ variant, size, block }) -> class string for other elements.
 *   TextLink       to | href | onClick, params, search, target, rel, disabled. Ink 500, underline on hover;
 *                  a 44px hit area on phones (mdx-hit).
 *   Tabs<T>        value (req), options [{ value, label, count?, level?, disabled? }] (req), onChange (req),
 *                  label (req, aria), size "md" 40px | "sm" (chart ranges, num 13, 32px). Segmented tabs: a pill
 *                  track with one sheet thumb that slides to the selection (44px tracks on phones).
 *   SideToggle     side "buy" | "sell" (req), onChange (req). Buy | Sell: the selected half is a sliding Up or
 *                  Down thumb with a sheet label.
 *   SortMenu<T>    value (req), options [{ value, label }] (req), onChange (req), label = "Sort". Select pill.
 *   Pager          page (req, 0 based), pages (req), onPage (req). "Page 1 of 4" + chevrons; null if 1 page.
 *                  The end chevrons are aria-disabled, so focus stays put on the last page.
 *   Stepper        index (req, 0 based), count (req), onStep (req), wrap = true, announce (what the live region
 *                  says after a step; default "2 of 5"), prevLabel, nextLabel. Dots (the active one a foil pill)
 *                  + chevrons.
 *   ChevronButton  dir "left" | "right" (req), label (req), onClick, disabled. 32px circle (44 on phones),
 *                  aria-disabled when disabled.
 *   Field          label (req), htmlFor, help, error, right (label row right side), children (req).
 *   Input          prefix ("@", "$"), suffix ("SOL"), size "md" 44 | "lg" 48, numeric (num 20px), ref,
 *                  ...input attrs. Sheet field, 14px radius, 1px field stroke, ink focus with a soft halo.
 *   Modal          open (req), onOpenChange (req), title (req), description (sr-only; omitted when not
 *                  given), width = 440 (guide 560). 28px corners, springs in, fades out. Phones: a bottom
 *                  sheet (./sheet: grip, swipe down to dismiss, 44px close, .mdx-sheet-foot pins the CTA).
 *   ToastProvider / useToast() -> toast(kind "ok" | "err" | "level", text, { level?, action? }). Level
 *                  toasts wear the holo rim, one sheen and the 16x22 frame mini of that design. action
 *                  { label, to, params, search | href | onClick } adds a link and keeps the toast until
 *                  dismissed. Timers pause on hover, focus and a hidden tab; errors stay 10s; a Dismiss button
 *                  and Escape; errors are announced through role=alert, the rest through role=status (P1-2).
 *
 * Values
 *   Num            children (req), unit ("SOL"), size "xs" 13 | "sm" 14 | "md" 17 | "lg" 20 | "hero",
 *                  tone "ink" | "slate" | "inherit", watch (number to flash Up or Down on change), tick (with
 *                  watch: the new value slides in; hero numbers and the wallet balance only, never list rows).
 *   solFigure(lamports) -> "0.42": SOL for captions and stats, two decimals (1 from 100, 3 under 0.01).
 *   Change         v (req, fraction: 1.78 = 178%), period = "in 24 hours", pill (tinted pill: the Coin hero and
 *                  the Home caption only). Triangle + percent, Up or Down.
 *   Address        address (req, null shows "assigned at launch"), copy = true, row (full width), label (the
 *                  slate MODE_COPY.addressLabel line above), compact (a copy glyph instead of the words).
 *                  Copies with a fallback and toasts the result.
 *   FrameMini      level (req), size "xs" 9x13 | "sm" 12x17 | "md" 16x22. Real frame miniature, 1px hairline.
 *   TierTag        level (req), size "sm" 13px | "md" 14px, suffix, miniOnly, plain. A pill chip on the design's
 *                  tint (tiers.ts) with ink text; plain drops the chip (for dense rows); miniOnly is a bare mini.
 *   Thumb          src (req), size = 36, alt. Coin art, radius 0.28 x size, faint inner ring.
 *   Avatar         handle (req), size = 32. A circle in one flat foil stop picked by the handle, ink initial.
 *   LiveDot        pulse, paused. The 6px live dot; pings on mount and when pulse changes (at most every 2s);
 *                  slate and still while paused.
 *   LivePause      paused (req), onChange (req). "Pause" / "Resume" live updates, for a live list's header.
 *   Hallmark       size = 28. The Holo Seal: a serif M on pastel foil in a hexagon seal; 28 and 32 are
 *                  pixel-hinted at 1x.
 *   GenIcon        name (req), size. Mask icon in currentColor (rail and mobile tab bar only).
 *
 * CSS classes (src/mintdex.css): mdx-ledge, mdx-pocket (+ --pocket, mdx-pocket--featured), mdx-leaders, mdx-plate,
 * mdx-name, mdx-plinth, mdx-aside, mdx-main, mdx-pair, mdx-h1, mdx-h2, mdx-display, mdx-small, mdx-micro,
 * mdx-unit, mdx-mini, mdx-label, mdx-input, mdx-select, mdx-menu-trigger, mdx-drop (+ data-over), mdx-range
 * (+ --fill, --tier), mdx-progress (+ __fill, --tier), mdx-menu, mdx-menu-item, mdx-menu-check, mdx-pop,
 * mdx-dialog, mdx-overlay, mdx-row (+ data-new, inset focus ring), mdx-thumb, mdx-live, mdx-step-dot, mdx-lift,
 * mdx-enter (+ --i), mdx-check, mdx-btn__done, mdx-btn[data-feedback], mdx-toast__x, mdx-toast__action, mdx-badge
 * (+ --dot), mdx-suggest, mdx-skip,
 * mdx-stagger, mdx-page, mdx-tick, mdx-lot-in, mdx-lot-out (+ --d), mdx-fade, mdx-skeleton, mdx-hit, mdx-routebar
 * (+ data-phase), mdx-livepause, mdx-draw, mdx-dot-in, mdx-grid-in, mdx-chip-pop, data-pending on tabs; utilities
 * num and addr; variants short:, wide:, xwide:, fit:. Tokens: rounded-{chip,row,field,pop,panel,aside,pill},
 * shadow-{ring,rest,raise,lift,float,modal}, ease-{room,spring,exit,sheen}, --t-* durations, --stagger.
 */
import { Link, type LinkProps } from "@tanstack/react-router";
import {
  Fragment,
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import { thumbSources } from "../../lib/mintdex/art";
import { Icon, type IconName } from "./icons";
// The card sheets stay in the global stylesheet, first, where the card3d barrel import used to put them: every
// page that shows a card back (the 404 included) needs them, and the cascade keeps its order.
import "../../themed-card-backs.css";
import "../../carddex-cards.css";
// Direct card3d files, never the barrel: this module is in every page's first download, the card engine is not.
import { CardDeck } from "./card3d/CardBack";
import { CardMotionCell, CardMotionProvider, gather, prefetchGather } from "./card3d/context";
import { fanVars } from "./card3d/light";
import { motionLevel, setCalm, useFreshMount, useMotionLevel } from "./card3d/motion3d";
import { copyKey, copyText } from "../../lib/mintdex/clipboard";
import { LAMPORTS } from "../../lib/mintdex/constants";
import { MODE_COPY } from "../../lib/mintdex/copy";
import { sol } from "../../lib/mintdex/format";
import { frameMiniSrc, tierForLevel } from "../../lib/mintdex/tiers";
import { ancestry, focusNear, focusPageHome } from "./focus";
import { Sheet, useIsPhone } from "./sheet";
import { useOpenedOnce } from "./opened-once";
import { tabDomId, tabKeys, tabPanelDomId } from "../carddex/ViewTabs";

export { ancestry, focusNear, focusPageHome };
export { Icon, type IconName };

/** Every card is a Pokemon card: 63 x 88 mm. */
export const CARD_ASPECT = 63 / 88;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- brand and icons

export type GenIconName = "launch" | "bid" | "deed" | "levelup" | "volume" | "cards";

/** The generated mask icon set, recolored by currentColor. Rail tabs and the mobile tab bar only. */
export function GenIcon({
  name,
  size = 22,
  className = "",
}: {
  name: GenIconName;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`mdx-icon ${className}`}
      style={{ "--s": `${size}px`, "--src": `url(/assets/icons/mask/${name}.webp)` } as CSSProperties}
    />
  );
}

/** Sizes with a pixel-hinted seal for 1x screens (brand/src/logo.py SMALL). */
const HINTED_SEAL = new Set([28, 32]);

/**
 * The Holo Seal: a serif M on pastel foil in a hexagon seal (light version), the logo in the rail and the
 * mobile header.
 * The seal fills the square box's height. 1x screens get the seal hand-hinted for 28 or 32 px;
 * 2x and up (and every other size) get the vector.
 */
export function Hallmark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const svg = "/assets/brand/carddex.svg";
  return (
    <img
      src={svg}
      srcSet={undefined}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={cx("block flex-none", className)}
    />
  );
}

// ---------------------------------------------------------------- buttons and links

/**
 * One recipe per variant (mintdex.css @layer components, .mdx-btn): "primary" is the cream pill (one per view),
 * "outline" renders the secondary recipe (a quiet nested pill; the name is kept for call sites), "ghost" is text
 * with a track hover, "danger" a destructive confirm, "chip" a quick amount. "buy"/"sell" stay for the inherited
 * chain pages only.
 */
export type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "chip" | "buy" | "sell";
export type ButtonSize = "md" | "sm" | "lg";

export function buttonClass({
  variant = "primary",
  size = "md",
  block = false,
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}) {
  return cx(
    "mdx-btn",
    `mdx-btn--${variant}`,
    size !== "md" && `mdx-btn--${size}`,
    block && "mdx-btn--block",
  );
}

/**
 * Where a money action stands (backlog P1-8). "signing" and "confirming" are reserved for devnet, where a wallet
 * approves and the chain confirms between pending and success.
 */
export type ActionState = "idle" | "pending" | "signing" | "confirming" | "success" | "error";
/** A button's feedback: the state and a sequence number that changes on every outcome (it replays the shake). */
export type Feedback = { state: ActionState; seq: number } | null | undefined;

/** The 12px check that draws itself on a successful action (P1-8). Exported for toasts and rows. */
export function CheckIcon({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden className={cx("mdx-check", className)}>
      <path
        d="M2.5 6.4 4.9 8.8 9.5 3.6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  pending = false,
  pendingLabel,
  feedback,
  successLabel,
  onBlocked,
  className = "",
  type = "button",
  disabled,
  children,
  ref,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  pending?: boolean;
  pendingLabel?: ReactNode;
  /** P1-8: on "success" the label becomes a drawn check and successLabel for a moment; "error" shakes once. */
  feedback?: Feedback;
  successLabel?: ReactNode;
  /** Called when a click (or a form's Enter submit) is blocked because the button is disabled, not busy. */
  onBlocked?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  // aria-disabled, not the disabled attribute: a disabled button drops focus to <body> (after every trade,
  // bid or page turn), an aria-disabled one keeps it and still reads as unavailable (backlog P0-1).
  const inert = !!disabled || pending;
  const state = feedback?.state;
  const done = state === "success" && successLabel != null && !pending;
  return (
    <button
      ref={ref}
      type={type}
      aria-disabled={inert || undefined}
      aria-busy={pending || undefined}
      data-feedback={pending ? undefined : state === "success" || state === "error" ? state : undefined}
      // Two shake keyframes alternate, so a second error in a row shakes again.
      data-seq={state === "error" ? (feedback!.seq % 2 ? "1" : "0") : undefined}
      className={cx(buttonClass({ variant, size, block }), className)}
      onClick={(e) => {
        // Blocks the action, including a form's Enter submit (browsers send it as a click on the
        // form's default button).
        if (inert) {
          e.preventDefault();
          if (!pending) onBlocked?.();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {pending && pendingLabel ? (
        pendingLabel
      ) : done ? (
        <span key={feedback!.seq} className="mdx-btn__done inline-flex items-center gap-1.5">
          <CheckIcon />
          {successLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export function ButtonLink({
  to,
  params,
  search,
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  children,
  onClick,
}: {
  to: LinkProps["to"];
  params?: LinkProps["params"];
  search?: LinkProps["search"];
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      params={params}
      search={search}
      onClick={onClick}
      className={cx(buttonClass({ variant, size, block }), className)}
    >
      {children}
    </Link>
  );
}

/** Text link: ink 500, underline on hover. No arrows, brackets or moving dots. 44px hit area on phones. */
export function TextLink({
  to,
  params,
  search,
  hash,
  href,
  target,
  rel,
  onClick,
  disabled,
  children,
  className = "",
  "aria-label": ariaLabel,
}: {
  to?: LinkProps["to"];
  params?: LinkProps["params"];
  search?: LinkProps["search"];
  hash?: LinkProps["hash"];
  href?: string;
  target?: string;
  rel?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const cls = cx("mdx-link mdx-hit", className);
  if (to) {
    return (
      <Link
        to={to}
        params={params}
        search={search}
        hash={hash}
        onClick={onClick}
        className={cls}
        aria-label={ariaLabel}
      >
        {children}
      </Link>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        target={target}
        rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
        onClick={onClick}
        className={cls}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cls}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return <Icon name={dir === "left" ? "chevron-left" : "chevron-right"} />;
}

/**
 * An icon-only button: a 36px circle (32 with size="sm") with a 16px glyph, reaching the hit size through ::after.
 * `label` is required: it is the accessible name and the tooltip. Icon-only is for close, search, menu, help,
 * chevrons and the card-corner 3D button; everything else gets words (Button with an icon child).
 * tone "quiet": transparent with a track hover (bars, dialogs, the search clear); "secondary": the nested pill.
 */
export function IconButton({
  icon,
  label,
  tone = "quiet",
  size = "md",
  className = "",
  type = "button",
  disabled,
  onClick,
  ref,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  label: string;
  tone?: "quiet" | "secondary";
  size?: "md" | "sm";
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cx(
        "mdx-btn mdx-btn--icon",
        tone === "quiet" ? "mdx-btn--ghost" : "mdx-btn--outline",
        size === "sm" && "mdx-btn--sm",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/**
 * A filter chip (Discover and Designs categories): a track pill at the control height, ink label, an optional
 * count in caption slate ("Classics 7"). Pressed is aria-pressed (ink fill, ground label). One row, never wrapping:
 * put chips in a `.mdx-chiprow` (nowrap, scrolls sideways with an edge fade when it overflows).
 */
export function Chip({
  pressed = false,
  count,
  onClick,
  children,
  className = "",
}: {
  pressed?: boolean;
  count?: number;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={cx("mdx-chip", className)}>
      {children}
      {count != null ? <span className="mdx-chip__count num">{count}</span> : null}
    </button>
  );
}

/**
 * A read-only status pill, never interactive: 20px tall, 12/600. tone "neutral" (track and slate: "optional",
 * "you", "Simulated"), "up" and "down" (the soft market pair), "ink" (a count that needs action), "gold" (a data
 * mark only, e.g. the current period; never on chrome).
 */
export function Badge({
  tone = "neutral",
  children,
  className = "",
  title,
}: {
  tone?: "neutral" | "up" | "down" | "ink" | "gold";
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cx("mdx-tag", className)} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/**
 * 32px secondary circle chevron (pager, stepper); 44px on phones. Disabled is aria-disabled, so a chevron
 * that reaches the last page keeps focus.
 */
export function ChevronButton({
  dir,
  label,
  onClick,
  disabled,
  className = "",
}: {
  dir: "left" | "right";
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cx("mdx-btn mdx-btn--outline mdx-btn--icon", className)}
    >
      <Chevron dir={dir} />
    </button>
  );
}

// ---------------------------------------------------------------- selection controls

export type TabOption<T> = {
  value: T;
  label: ReactNode;
  count?: number;
  level?: number;
  disabled?: boolean;
};

/**
 * Segmented tabs: a pill track with one sheet thumb that slides to the selection. Until the first measurement
 * (server HTML, hydration) the selected option paints its own thumb, and the slide only switches on after a
 * painted measurement, so the thumb never flies in from 0. Re-measured on resize and after fonts load.
 */
export function Tabs<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className = "",
  panels = false,
  idBase,
}: {
  value: T;
  options: Array<TabOption<T>>;
  onChange: (v: T) => void;
  label: string;
  size?: "md" | "sm";
  className?: string;
  /** The options switch the panel below (role="tablist" with arrow keys), not a value such as a chart range. */
  panels?: boolean;
  /** With panels: ids for the tabs and their shared panel (tabPanelProps(idBase, value) on the panel). */
  idBase?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  // The thumb's laid-out width. A move animates transform only (translateX + scaleX from this width); once it
  // lands, the width takes the new size with transitions off (data-snap) so the pill's ends are round again.
  const [base, setBase] = useState<number | null>(null);
  const [snap, setSnap] = useState(false);
  // Layout effect on the client (measure before paint), plain effect on the server (where it never runs).
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const b = root.querySelector<HTMLElement>(".mdx-tabs__tab[data-selected]");
      const next = b ? { x: b.offsetLeft, w: b.offsetWidth } : null;
      setThumb((prev) =>
        prev && next && prev.x === next.x && prev.w === next.w ? prev : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    root.querySelectorAll(".mdx-tabs__tab").forEach((el) => ro.observe(el));
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [value, options.length]);
  useEffect(() => {
    // Before the first painted measurement nothing animates: the width simply follows.
    if (thumb && (base == null || !ready) && base !== thumb.w) setBase(thumb.w);
  }, [thumb, base, ready]);
  useEffect(() => {
    if (!snap) return;
    const id = requestAnimationFrame(() => setSnap(false));
    return () => cancelAnimationFrame(id);
  }, [snap]);
  useEffect(() => {
    if (!thumb || ready) return;
    // Transitions only after the first painted measurement.
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [thumb, ready]);
  return (
    <div
      ref={ref}
      role={panels ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={panels ? tabKeys : undefined}
      data-measured={thumb ? "" : undefined}
      data-ready={ready ? "" : undefined}
      className={cx(
        "mdx-tabs mdx-noscrollbar max-w-full max-lg:overflow-x-auto",
        size === "sm" && "mdx-tabs--sm",
        className,
      )}
    >
      <span
        aria-hidden
        className="mdx-tabs__thumb"
        data-snap={snap || undefined}
        style={
          {
            "--x": `${thumb?.x ?? 0}px`,
            "--w": `${base ?? thumb?.w ?? 0}px`,
            "--s": thumb && base ? thumb.w / base : 1,
          } as CSSProperties
        }
        onTransitionEnd={(e) => {
          if (e.propertyName !== "transform" || !thumb || base === thumb.w) return;
          setSnap(true);
          setBase(thumb.w);
        }}
      />
      {options.map((o) => {
        const content = (
          <>
            {o.level ? <FrameMini level={o.level} /> : null}
            <span>
              {o.label}
              {o.count != null ? (
                <>
                  {" "}
                  (<span className="num">{o.count}</span>)
                </>
              ) : null}
            </span>
          </>
        );
        return (
          <button
            key={String(o.value)}
            type="button"
            className="mdx-tabs__tab"
            role={panels ? "tab" : undefined}
            id={panels && idBase ? tabDomId(idBase, String(o.value)) : undefined}
            aria-controls={panels && idBase ? tabPanelDomId(idBase) : undefined}
            aria-pressed={panels ? undefined : o.value === value}
            aria-selected={panels ? o.value === value : undefined}
            tabIndex={panels && o.value !== value ? -1 : undefined}
            data-selected={o.value === value || undefined}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {/* The hidden semibold copy reserves the selected width so tabs never jitter. */}
            <span className="grid">
              <span className="col-start-1 row-start-1 inline-flex items-center gap-1.5">
                {content}
              </span>
              <span
                aria-hidden
                className="invisible col-start-1 row-start-1 inline-flex items-center gap-1.5 font-semibold"
              >
                {content}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Buy | Sell: the selected half is a sliding Up or Down thumb with a sheet label (CSS, driven by data-side). */
export function SideToggle({
  side,
  onChange,
  className = "",
}: {
  side: "buy" | "sell";
  onChange: (side: "buy" | "sell") => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Trade side" data-side={side} className={cx("mdx-side", className)}>
      {(["buy", "sell"] as const).map((s) => (
        <button
          key={s}
          type="button"
          data-side={s}
          aria-pressed={side === s}
          onClick={() => onChange(s)}
        >
          {s === "buy" ? "Buy" : "Sell"}
        </button>
      ))}
    </div>
  );
}

/** Sort control: a native select as a 36px pill on the track, the "Sort" label outside in slate. */
export function SortMenu<T extends string>({
  value,
  options,
  onChange,
  label = "Sort",
  labelClassName = "",
  className = "",
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label?: string;
  /** Extra classes for the visible label, e.g. "max-lg:sr-only" to keep it for screen readers only on phones. */
  labelClassName?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("inline-flex h-10 flex-none items-center gap-2 max-lg:h-11", className)}>
      <label htmlFor={id} className={cx("text-body text-slate", labelClassName)}>
        {label}
      </label>
      <select
        id={id}
        className="mdx-select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * "Page 1 of 4" + two 32px chevrons. Hidden entirely when there is one page. The end chevrons are
 * aria-disabled, so a focused Next keeps focus on the last page.
 */
export function Pager({
  page,
  pages,
  onPage,
  className = "",
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
  className?: string;
}) {
  if (pages <= 1) return null;
  const p = Math.min(Math.max(0, page), pages - 1);
  return (
    <div className={cx("flex flex-none items-center gap-2", className)}>
      <span className="mr-1 whitespace-nowrap text-body text-slate" aria-live="polite">
        Page <span className="num text-body text-ink">{p + 1}</span> of{" "}
        <span className="num text-body text-ink">{pages}</span>
      </span>
      <ChevronButton
        dir="left"
        label="Previous page"
        disabled={p <= 0}
        onClick={() => onPage(p - 1)}
      />
      <ChevronButton
        dir="right"
        label="Next page"
        disabled={p >= pages - 1}
        onClick={() => onPage(p + 1)}
      />
    </div>
  );
}

/**
 * Home stepper: dots on the left (the active one an 18x6 foil pill), chevrons on the right. "2 of 5" stays
 * for screen readers. With `onTogglePlay` it also carries the 32px Pause/Play button of an auto-advancing
 * carousel (WCAG 2.2.2), hidden under calm motion (nothing advances by itself there). `cluster` sets the dots,
 * Pause and the chevrons together at the right end of the row.
 */
export function Stepper({
  index,
  count,
  onStep,
  wrap = true,
  announce,
  prevLabel = "Previous",
  nextLabel = "Next",
  dotsOnly = false,
  playing,
  onTogglePlay,
  cluster = false,
  align = "center",
  className = "",
}: {
  index: number;
  count: number;
  onStep: (i: number) => void;
  wrap?: boolean;
  /** Only the dots, spread over the row: the caller puts the chevrons somewhere else (on the card's edges). */
  dotsOnly?: boolean;
  /**
   * What the polite live region says after a step ("Honk, Mythic design, market cap $466K, 3 of 5"). Set it
   * on a step only, never from polled data, so a poll never re-announces. Default "3 of 5".
   */
  announce?: string;
  prevLabel?: string;
  nextLabel?: string;
  /** The carousel advances by itself (shows Pause); false shows Play. Only with onTogglePlay. */
  playing?: boolean;
  onTogglePlay?: () => void;
  /** Dots, Pause and chevrons together at the right end. */
  cluster?: boolean;
  /** dotsOnly: "start" sets the dots (and Pause) at the row's start, under a left-aligned caption (Home at fit). */
  align?: "center" | "start";
  className?: string;
}) {
  if (count <= 1) return null;
  const i = Math.min(Math.max(0, index), count - 1);
  const prev = wrap ? (i - 1 + count) % count : i - 1;
  const next = wrap ? (i + 1) % count : i + 1;
  const play = onTogglePlay ? (
    <button
      type="button"
      onClick={onTogglePlay}
      aria-label={playing ? "Pause featured cards" : "Play featured cards"}
      className="mdx-playbtn grid h-8 w-8 flex-none place-items-center rounded-pill text-ink max-lg:h-11 max-lg:w-11"
    >
      <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden fill="currentColor">
        {playing ? (
          <>
            <rect x="2" y="1.5" width="2.2" height="7" rx="0.8" />
            <rect x="5.8" y="1.5" width="2.2" height="7" rx="0.8" />
          </>
        ) : (
          <path d="M2.5 1.6v6.8a.6.6 0 0 0 .9.5l5.4-3.4a.6.6 0 0 0 0-1L3.4 1.1a.6.6 0 0 0-.9.5Z" />
        )}
      </svg>
    </button>
  ) : playing !== undefined ? (
    // Calm turns the button off after hydration: an empty slot of the same size keeps the row from shifting.
    <span aria-hidden className="h-8 w-8 flex-none max-lg:h-11 max-lg:w-11" />
  ) : null;
  return (
    <div
      className={cx(
        "flex items-center gap-4",
        cluster ? "justify-end gap-3" : align === "start" ? "justify-start gap-2" : "justify-between",
        className,
      )}
    >
      <span className="sr-only" aria-live="polite">
        {announce ?? `${i + 1} of ${count}`}
      </span>
      {/* Phones: ten 44px dot targets cannot fit beside the two 44px chevrons, so a "3 / 10" count stands in
          for the dots and the chevrons step (A11Y-2). Desktop: 40px dot targets around the small visible dot. */}
      <span aria-hidden className="mdx-step-count num hidden max-lg:inline">
        {i + 1} / {count}
      </span>
      <div
        className={cx(
          "flex min-w-0 items-center max-lg:hidden",
          !cluster && "max-lg:flex-1",
          dotsOnly && (align === "start" ? "-ml-1.5" : "flex-1 justify-center"),
        )}
        role="group"
        aria-label="Featured cards"
      >
        {Array.from({ length: count }, (_, k) => (
          <button
            key={k}
            type="button"
            onClick={() => onStep(k)}
            aria-label={`Show card ${k + 1} of ${count}`}
            aria-current={k === i || undefined}
            className={cx(
              "grid h-10 w-10 flex-none place-items-center rounded-pill",
            )}
          >
            <span className="mdx-step-dot" data-active={k === i || undefined} />
          </button>
        ))}
      </div>
      {play}
      <div className={cx("flex flex-none gap-2", dotsOnly && "hidden")}>
        <ChevronButton
          dir="left"
          label={prevLabel}
          disabled={!wrap && i <= 0}
          onClick={() => onStep(prev)}
        />
        <ChevronButton
          dir="right"
          label={nextLabel}
          disabled={!wrap && i >= count - 1}
          onClick={() => onStep(next)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- fields

export function Field({
  label,
  htmlFor,
  help,
  error,
  right,
  children,
  className = "",
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const helpId = htmlFor ? `${htmlFor}-help` : undefined;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="mdx-label mb-0">
          {label}
        </label>
        {right ? <span className="text-caption text-slate">{right}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={helpId} role="alert" className="mt-1.5 text-body leading-[1.45] text-down">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="mt-1.5 text-body leading-[1.45] text-slate">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** Text field. prefix "@" or "$" sits at left 14px; suffix ("SOL", "$GLORB") at right 14px. */
export function Input({
  prefix,
  suffix,
  size = "md",
  numeric = false,
  className = "",
  ref,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
  size?: "md" | "lg";
  numeric?: boolean;
  ref?: Ref<HTMLInputElement>;
}) {
  const input = (
    <input
      ref={ref}
      className={cx(
        "mdx-input",
        size === "lg" && "h-12",
        numeric && "num text-title",
        prefix != null && "pl-8",
        suffix != null && "pr-14",
        className,
      )}
      {...rest}
    />
  );
  if (prefix == null && suffix == null) return input;
  return (
    <div className="relative">
      {prefix != null && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-body text-slate">
          {prefix}
        </span>
      )}
      {input}
      {suffix != null && (
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-body text-slate">
          {suffix}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- values

/** Figure sizes on the type scale (12 / 14 / 16 / 20 / 24, and the one 30px lead figure a screen may have). */
const NUM_SIZE = {
  xs: "text-caption",
  sm: "text-body",
  md: "text-lead",
  lg: "text-title",
  xl: "text-heading",
  hero: "text-figure tracking-[-0.01em]",
} as const;
const NUM_TONE = { ink: "text-ink", slate: "text-slate", inherit: "" } as const;

/**
 * A data number: condensed, tabular. The unit follows in sans 500 slate. With `tick` (and `watch`), the new
 * value slides in from below (up) or above (down) while the color flash eases back: hero numbers and the
 * wallet balance only, never list rows. The value on screen is always a real one.
 */
export function Num({
  children,
  unit,
  size = "md",
  tone = "ink",
  watch,
  flashKey,
  tick = false,
  odo = false,
  className = "",
}: {
  children: ReactNode;
  unit?: ReactNode;
  size?: keyof typeof NUM_SIZE;
  tone?: keyof typeof NUM_TONE;
  /** Pass the raw polled value to flash Up or Down when it changes. */
  watch?: number;
  /** What `watch` belongs to (a coin id): when it changes, the new value is a different thing, so no flash. */
  flashKey?: string | number;
  /** Slide the new value in when `watch` changes. */
  tick?: boolean;
  /**
   * Hero figures (M19): a string value rolls digit by digit to the new value (an odometer) instead of the tick.
   * Same markup on the server and the client (the columns derive from the text).
   */
  odo?: boolean;
  className?: string;
}) {
  const flash = useFlash(watch, flashKey);
  const t = useTick(tick && !odo ? watch : undefined);
  return (
    <span
      className={cx(
        "num whitespace-nowrap",
        NUM_SIZE[size],
        NUM_TONE[tone],
        watch !== undefined && "mdx-flash",
        className,
      )}
      data-flash={flash}
    >
      {odo && typeof children === "string" ? (
        <Odometer text={children} />
      ) : tick && watch !== undefined ? (
        <span key={t.n} className={t.n ? "mdx-tick" : undefined} data-dir={t.dir}>
          {children}
        </span>
      ) : (
        children
      )}
      {unit != null ? <span className="mdx-unit"> {unit}</span> : null}
    </span>
  );
}

/**
 * The odometer (M19): every digit is a column of 0 to 9 that rolls (translateY, 600ms) to its new digit. The real
 * text sits underneath, invisible, so width, baseline, copy and screen readers all use it; the rolling columns
 * are drawn over it and hidden from assistive tech. A change of shape (another length, a new comma) re-cuts the
 * columns without rolling. Calm motion: the global rule makes the roll instant.
 */
export function Odometer({ text }: { text: string }) {
  const chars = Array.from(text);
  const shape = text.replace(/\d/g, "0");
  return (
    <span className="mdx-odo">
      <span className="mdx-odo__text">{text}</span>
      <span key={shape} aria-hidden className="mdx-odo__roll">
        {chars.map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={i} className="mdx-odo__d">
              <span style={{ "--n": Number(ch) } as CSSProperties}>
                {"0123456789".split("").map((d) => (
                  <b key={d}>{d}</b>
                ))}
              </span>
            </span>
          ) : (
            <span key={i}>{ch}</span>
          ),
        )}
      </span>
    </span>
  );
}

/**
 * A SOL figure for captions and stats ("Top bid 0.42", "Coins value 0.00"): two decimals so neighbors
 * line up, one decimal from 100 SOL, three for a nonzero amount under 0.01 so it never reads as zero.
 * Takes lamports.
 */
export function solFigure(lamports: number) {
  const v = Math.abs(lamports / LAMPORTS);
  return sol(lamports, v >= 100 ? 1 : v > 0 && v < 0.01 ? 3 : 2);
}

/** Words then a number: "Buy now 14.78" (slate sans words, ink num value). */
export function LabelNum({
  label,
  value,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("whitespace-nowrap", className)}>
      <span className="text-slate">{label}</span> <span className="num text-ink">{value}</span>
    </span>
  );
}

/**
 * A signed change: "+4.1%" in --color-up, "−2.3%" in --color-down, tabular; direction is in the sign, never colour
 * alone. One decimal under 100%. Zero renders "0.0%" in slate with no sign. `pill` sets it on the soft pair (track
 * for zero): the Coin hero and the Home caption; dense rows keep the plain coloured text (mintdex.css .mdx-change).
 */
export function Change({
  v,
  className = "",
  period = "in 24 hours",
  pill = false,
  hideZero = false,
}: {
  v: number;
  className?: string;
  period?: string;
  pill?: boolean;
  /** Render nothing when the change rounds to 0.0% (a quiet coin says nothing instead of "0.0%"). */
  hideZero?: boolean;
}) {
  const pct = Number.isFinite(v) ? Math.abs(v * 100) : 0;
  const text = pct >= 100 ? pct.toFixed(0) : pct.toFixed(1);
  if (text === "0.0") {
    if (hideZero) return null;
    return (
      <span className={cx("mdx-change num", className)} data-dir="flat" data-pill={pill || undefined}>
        <span className="sr-only">No change {period}: </span>0.0%
      </span>
    );
  }
  const up = v > 0;
  // The sign carries the direction in the text, so it is read too ("plus 4.1 percent"); never colour alone. U+2212 is
  // the typographic minus. A plain text node, so a screen's span rules never put the sign on its own line.
  return (
    <span className={cx("mdx-change num", className)} data-dir={up ? "up" : "down"} data-pill={pill || undefined}>
      {up ? "+" : "\u2212"}
      {text}%<span className="sr-only"> {period}</span>
    </span>
  );
}

/**
 * Coin address in Fragment Mono: first 6 + "..." + chars -8 to -4 in slate, then the "mint" suffix in ink
 * with a 1px underline. As a button it copies the full address (backlog P1-26): the Clipboard API, then the
 * old execCommand path, and if both are blocked the full address appears selected in a read-only field with
 * a "Press Ctrl+C" toast. Success toasts and flips the label to "Copied" with a brief tint on the address.
 * The label and button words come from MODE_COPY ("Copy test address" in test mode, decision C6); `label`
 * adds the slate "Test address, not on chain" line above the row.
 */
export function Address({
  address,
  copy = true,
  row = false,
  label = false,
  compact = false,
  className = "",
}: {
  address: string | null | undefined;
  copy?: boolean;
  row?: boolean;
  label?: boolean;
  /** A copy glyph in place of the "Copy test address" words (the phone coin hero); the name stays. */
  compact?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!address) {
    return (
      <span className={cx("text-body text-slate", className)}>
        Address ends in mint, assigned at launch.
      </span>
    );
  }
  const text = (
    <span
      className={cx(
        "addr whitespace-nowrap rounded-chip transition-[background-color,box-shadow] duration-(--t-slow) ease-room",
        copied && "bg-wash shadow-[0_0_0_3px_var(--color-wash)]",
      )}
    >
      <span className="text-slate">
        {address.slice(0, 6)}...{address.slice(-8, -4)}
      </span>
      <span className="text-ink underline decoration-1 underline-offset-2">
        {address.slice(-4)}
      </span>
    </span>
  );
  const caption = label ? (
    <span className="mdx-micro block leading-[1.3]">{MODE_COPY.addressLabel}</span>
  ) : null;
  if (!copy) {
    return (
      <span className={className} title={address}>
        {caption}
        {text}
      </span>
    );
  }
  const full = address;
  async function doCopy() {
    const result = await copyText(full);
    clearTimeout(timer.current);
    if (result === "copied") {
      setManual(false);
      setCopied(true);
      toast("ok", MODE_COPY.addressCopied);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } else {
      // Both copy paths are blocked (an embed, plain HTTP, a strict in-app browser): show the whole address
      // selected in a read-only field, so one key press copies it.
      setManual(true);
      toast("err", `Press ${copyKey()}+C to copy the address.`);
    }
  }
  const rowClass = cx("flex min-h-8 items-center gap-3", row && "w-full justify-between");
  return (
    <div className={cx(row && "w-full", className)}>
      {caption}
      {manual ? (
        <div className={rowClass}>
          <input
            readOnly
            autoFocus
            value={full}
            aria-label={MODE_COPY.addressLabel}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setManual(false)}
            className="addr mdx-input h-8 min-w-0 flex-1 px-2"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={doCopy}
          title={full}
          aria-label={copied ? MODE_COPY.addressCopied : `${MODE_COPY.copyAddress}, ${full}`}
          className={cx("mdx-hit group text-left", rowClass)}
        >
          {text}
          {compact ? (
            <span aria-hidden className="grid h-6 w-6 flex-none place-items-center text-ink">
              {copied ? <CheckIcon size={12} /> : <CopyGlyph />}
            </span>
          ) : (
            <span className="whitespace-nowrap text-body font-medium text-ink underline-offset-4 group-hover:underline">
              {copied ? "Copied" : MODE_COPY.copyAddress}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

function CopyGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9.25 2.5v-.25A1.25 1.25 0 0 0 8 1H3.25A1.25 1.25 0 0 0 2 2.25V7a1.25 1.25 0 0 0 1.25 1.25h.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const MINI = { xs: 13, sm: 17, md: 22 } as const;

/**
 * A miniature of the real frame image: how the chrome names a design (tier accents never appear as text).
 * A 1px ink hairline (mdx-mini) keeps pale frames, like Frost's ice holo, visible on wall and plinth.
 * It loads the 48 x 67 miniature (frameMiniSrc), never the full frame.
 */
export function FrameMini({
  level,
  size = "sm",
  className = "",
}: {
  level: number;
  size?: keyof typeof MINI;
  className?: string;
}) {
  const t = tierForLevel(level);
  const h = MINI[size];
  return (
    <img
      src={frameMiniSrc(t.key)}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
      loading="lazy"
      height={h}
      width={Math.round(h * CARD_ASPECT)}
      className={cx("mdx-mini inline-block flex-none", className)}
      style={{ height: h, width: "auto", aspectRatio: "63 / 88" }}
    />
  );
}

/**
 * Frame mini + "{Name} design" on a pill chip in the design's tint (tiers.ts), ink text (13:1 or better).
 * Optional slate suffix (", 3 of 14" or ", kept"). `plain` drops the chip (dense rows: tints never appear in
 * menus or rows); `miniOnly` is a bare mini.
 */
export function TierTag({
  level,
  size = "sm",
  suffix,
  miniOnly = false,
  plain = false,
  className = "",
}: {
  level: number;
  size?: "sm" | "md";
  suffix?: string;
  miniOnly?: boolean;
  plain?: boolean;
  className?: string;
}) {
  const t = tierForLevel(level);
  if (miniOnly) {
    return (
      <span
        role="img"
        aria-label={`${t.name} design`}
        title={`${t.name} design`}
        className={cx("inline-flex", className)}
      >
        <FrameMini level={level} />
      </span>
    );
  }
  return (
    <span
      data-chip={plain ? undefined : ""}
      className={cx(
        "inline-flex items-center gap-1.5 font-medium text-ink",
        !plain && "rounded-pill py-0.5 pl-1.5 pr-2.5",
        !plain && (size === "md" ? "min-h-7" : "min-h-6"),
        size === "md" ? "text-body" : "text-body",
        className,
      )}
      style={plain ? undefined : { background: t.tint }}
    >
      <FrameMini level={level} />
      <span>
        {t.name} design
        {suffix ? <span className="text-slate">{suffix}</span> : null}
      </span>
    </span>
  );
}

/** Coin art thumbnail: radius 0.28 x size (36 gets 10, 28 gets 8), a faint inner ring. */
export function Thumb({ src, size = 36, alt = "" }: { src: string; size?: number; alt?: string }) {
  // Uploaded and seeded art have a 96px copy (and a 320px one for sharp screens): never the 800px original.
  const sized = thumbSources(src, size);
  return (
    <img
      {...sized}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="mdx-thumb block flex-none bg-tint object-cover"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    />
  );
}

/** The flat warm stops avatars pick from (never a gradient; tokens in carddex-theme.css). The dark initial on each is 10:1 or better. */
const AVATAR = ["var(--avatar-1)", "var(--avatar-2)", "var(--avatar-3)", "var(--avatar-4)", "var(--avatar-5)"] as const;

export function Avatar({
  handle,
  size = 32,
  className = "",
}: {
  handle: string;
  size?: number;
  className?: string;
}) {
  const stop = AVATAR[[...handle].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
  return (
    <span
      aria-hidden
      className={cx(
        "grid flex-none place-items-center rounded-pill font-semibold leading-none text-on-cta",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: stop }}
    >
      {handle.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The 6px live dot (the one green without a sign, hidden from screen readers). It pings once on mount and
 * again whenever `pulse` changes (a new event id), at most once every 2s, never under reduced motion.
 */
export function LiveDot({
  pulse,
  paused = false,
  className = "",
}: {
  pulse?: unknown;
  /** Live updates are paused (P1-17): the dot turns slate and stops pinging. */
  paused?: boolean;
  className?: string;
}) {
  const [n, setN] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (paused || prefersReducedMotion()) return;
    const now = Date.now();
    if (now - last.current < 2000) return;
    last.current = now;
    setN((x) => x + 1);
  }, [pulse, paused]);
  return (
    <span aria-hidden className={cx("mdx-live", className)} data-paused={paused || undefined}>
      {n && !paused ? <span key={n} className="mdx-live__ping" /> : null}
    </span>
  );
}

/**
 * Pause or resume live updates (P1-17, WCAG 2.2.2): a small slate text button for a live list's header. The
 * choice is kept per viewer in this browser and applies to every live list.
 */
export function LivePause({
  paused,
  onChange,
  className = "",
}: {
  paused: boolean;
  onChange: (paused: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!paused)}
      aria-label={paused ? "Resume live updates" : "Pause live updates"}
      className={cx("mdx-livepause mdx-hit", className)}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="currentColor">
        {paused ? (
          <path d="M2.5 1.6v6.8a.6.6 0 0 0 .9.5l5.4-3.4a.6.6 0 0 0 0-1L3.4 1.1a.6.6 0 0 0-.9.5Z" />
        ) : (
          <>
            <rect x="2" y="1.5" width="2.2" height="7" rx="0.8" />
            <rect x="5.8" y="1.5" width="2.2" height="7" rx="0.8" />
          </>
        )}
      </svg>
      <span aria-hidden>{paused ? "Resume" : "Pause"}</span>
    </button>
  );
}

/**
 * The Calm motion switch (refs/alive-3d-spec.md 10.2): a role="switch" pill that turns every ambient loop, 3D
 * turn and celebration into the still version (setCalm keeps the choice in this browser and sets
 * html[data-motion] live). A device that asks for reduced motion starts it on; the switch stays the visitor's
 * override in either direction. Its state renders after mount: the server HTML shows it off and disabled until
 * hydration, same size.
 */
export function CalmSwitch({
  className = "",
  size = "sm",
  compact = false,
}: {
  className?: string;
  size?: "sm" | "md";
  /** The top bar's form: the words in caption slate beside the pill, no full-width row. */
  compact?: boolean;
}) {
  const level = useMotionLevel();
  const [state, setState] = useState<{ ready: boolean; on: boolean }>({ ready: false, on: false });
  useEffect(() => {
    setState({ ready: true, on: level === "calm" });
  }, [level]);
  const locked = !state.ready;
  // The row is the switch's label, so a tap anywhere on it (the words included) toggles, not only the 36px pill.
  return (
    <label className={cx("mdx-calm", compact && "mdx-calm--compact", className)} data-size={size}>
      <span className="mdx-calm__label">Calm motion</span>
      <button
        type="button"
        role="switch"
        aria-checked={state.on}
        aria-disabled={locked || undefined}
        aria-label="Calm motion"
        onClick={() => {
          if (locked) return;
          const next = !state.on;
          setCalm(next);
          setState((s) => ({ ...s, on: next }));
        }}
        className="mdx-switch flex-none"
        data-on={state.on || undefined}
        data-ready={state.ready || undefined}
      >
        <span aria-hidden className="mdx-switch__thumb" />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------- page template

/** View root: header row, then a body that fills the rest (desktop). */
export function PageFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mdx-frame", className)}>
      {children}
    </div>
  );
}

/**
 * The 56px page header row: h1 + one context line on the left, view controls on the right.
 * Desktop keeps the context to one line (ellipsis); phones let it wrap.
 */
export function PageHeader({
  title,
  context,
  right,
  aside,
  back,
  wrapContext = false,
  className = "",
}: {
  title: ReactNode;
  /** One line about the data or the object (the finding, the count, the scope), 14px slate, at every width. */
  context?: ReactNode;
  /** At most one primary (ButtonLink/Button) and one secondary or IconButton. */
  right?: ReactNode;
  /** A data block before `right` (the coin's market cap Stat): bottom-aligned with the context line. */
  aside?: ReactNode;
  /** Phones only: a 44px utility row above the title (a TextLink back to the list). */
  back?: ReactNode;
  wrapContext?: boolean;
  className?: string;
}) {
  return (
    <header className={cx("mdx-pagehead", className)} data-wrap={wrapContext || undefined}>
      {back ? <div className="mdx-pagehead__back">{back}</div> : null}
      <div className="mdx-pagehead__text">
        {/* One line on desktop (fitted header row); phones let a long title wrap instead of cutting it. */}
        <h1 className="mdx-h1 mdx-pagehead__title">{title}</h1>
        {context ? <p className="mdx-pagehead__context">{context}</p> : null}
      </div>
      {aside || right ? (
        <div className="mdx-pagehead__right">
          {aside}
          {right}
        </div>
      ) : null}
    </header>
  );
}

/**
 * Section header inside a column: title left, link or slate meta right. `live` (a value that changes on each
 * real event, such as the newest row id) adds the 6px live dot 8px after the title.
 */
export function SectionHead({
  title,
  right,
  as: As = "h2",
  live,
  livePaused = false,
  focusHome = false,
  className = "",
}: {
  title: ReactNode;
  right?: ReactNode;
  as?: "h2" | "h3";
  live?: string | number | boolean;
  /** Live updates are paused: the dot turns slate and stays still. */
  livePaused?: boolean;
  /** The section's landing spot when a control inside it leaves with its action (focusNear). */
  focusHome?: boolean;
  className?: string;
}) {
  const heading = (
    <As
      className="mdx-h2 truncate max-lg:min-w-[min(100%,max-content)]"
      {...(focusHome ? { "data-focus-home": "", tabIndex: -1 } : null)}
    >
      {title}
    </As>
  );
  return (
    // Phones: when the title and the right side cannot share the line (a 320px screen), the right side wraps
    // under the title instead of cutting the title short. Desktop keeps one 32px line (fitted columns).
    <div className={cx("flex h-8 flex-none items-center max-lg:h-auto max-lg:min-h-8", className)}>
      <div className="flex w-full items-baseline justify-between gap-3 max-lg:flex-wrap max-lg:gap-y-1">
        {live != null && live !== false ? (
          <span className="flex min-w-0 items-center gap-2">
            {heading}
            <LiveDot pulse={live} paused={livePaused} />
          </span>
        ) : (
          heading
        )}
        {right == null ? null : typeof right === "string" ? (
          <span className="flex-none text-body text-slate">{right}</span>
        ) : (
          <span className="flex-none text-body">{right}</span>
        )}
      </div>
    </div>
  );
}

export type StatItem = {
  label: string;
  /** The figure. Missing is a grey dash: pass null (never "--" or a made-up zero). */
  value: ReactNode | null;
  unit?: ReactNode;
  /** A signed change shown after the figure (Change v), or any small node such as a Badge. */
  change?: ReactNode;
  /** One caption line under the figure ("of 1,000,000", "vs 24h ago"). */
  sub?: ReactNode;
  watch?: number;
  tick?: boolean;
};

/**
 * KPIs as type in one divided container (house rule: no tile per KPI, no icon, no sparkline): a 12px slate label
 * above a tabular figure, cells split by 1px hairlines; two columns at 360px. `lead` sets the first figure as the
 * screen's one 30px lead figure (Portfolio total, the coin's market cap); the others stay at 24 (`size="lg"`) or
 * 16 (`size="md"`). `KpiGroup` is the same component under the name the screens use.
 */
export function Stats({
  items,
  size = "md",
  cols,
  lead = false,
  className = "",
}: {
  items: StatItem[];
  size?: "md" | "lg";
  cols?: number;
  lead?: boolean;
  className?: string;
}) {
  return (
    <dl
      className={cx("mdx-kpis", className)}
      data-size={size}
      style={{ "--kpi-cols": cols ?? items.length } as CSSProperties}
    >
      {items.map((it, i) => (
        <div key={it.label} className="mdx-kpi" data-lead={(lead && i === 0) || undefined}>
          <dt className="mdx-kpi__label">{it.label}</dt>
          <dd className="mdx-kpi__value">
            {it.value == null ? (
              <span className="mdx-dash" aria-label="Not available">
                {"\u2014"}
              </span>
            ) : (
              <Num size={lead && i === 0 ? "hero" : size === "lg" ? "xl" : "md"} unit={it.unit} watch={it.watch} tick={it.tick}>
                {it.value}
              </Num>
            )}
            {it.change != null ? <span className="mdx-kpi__change">{it.change}</span> : null}
          </dd>
          {it.sub != null ? <dd className="mdx-kpi__sub">{it.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
export const KpiGroup = Stats;

/**
 * The signature element: the bonding-curve track. Every pump.fun coin is on a curve until it graduates; the gold
 * fill is the true ratio (no stub at zero), the label reads "Curve 64%" and, past graduation, "Graduated". It is a
 * progressbar with a text value, so a screen reader hears "Curve 64%, 36% left to graduation". Missing data is a
 * grey dash. `size="sm"` (tiles, rows) drops the trailing note; `note` overrides it ("Graduates at 85 SOL").
 */
export function CurveTrack({
  progress,
  graduated = false,
  size = "md",
  label = "Curve",
  note,
  className = "",
}: {
  /** 0..1 (CoinSummary.curveProgress); null or undefined when the coin has no curve data. */
  progress: number | null | undefined;
  graduated?: boolean;
  size?: "sm" | "md";
  label?: string;
  note?: ReactNode;
  className?: string;
}) {
  const known = progress != null && Number.isFinite(progress);
  const pct = known ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : 0;
  const done = graduated || (known && pct >= 100);
  const valueText = !known
    ? `${label}: not available`
    : done
      ? `${label} complete: graduated`
      : `${label} ${pct}%, ${100 - pct}% left to graduation`;
  return (
    <div className={cx("mdx-curve", className)} data-size={size} data-done={done || undefined}>
      <div className="mdx-curve__head">
        <span className="mdx-curve__label">
          {label}{" "}
          {known ? <span className="num">{done ? "100%" : `${pct}%`}</span> : <span className="mdx-dash">{"\u2014"}</span>}
        </span>
        {size === "md" ? (
          <span className="mdx-curve__note">{note ?? (done ? "Graduated" : known ? "to graduation" : null)}</span>
        ) : null}
      </div>
      <div
        className="mdx-curve__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? pct : undefined}
        aria-valuetext={valueText}
      >
        {known && pct > 0 ? <span className="mdx-curve__fill" style={{ width: `${done ? 100 : pct}%` }} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- signature: sleeve, ledge, captions, shelf

/** The ledge every card stands on (card bottom edge touches its top edge): one faded hairline. */
export function Ledge({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cx("mdx-ledge", className)} style={style} />;
}

/**
 * The tray every minted card sits in, concentric with its corner. Drawn outside its box: no layout change.
 * Wrap the lift, not the reverse.
 */
export function Pocket({
  featured = false,
  className = "",
  children,
}: {
  featured?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("mdx-pocket", featured && "mdx-pocket--featured", className)}>{children}</div>
  );
}

/** Featured caption: serif No. / sans name / tier chip / up to three round dot leader rows / one link. */
export function Caption({
  no,
  name,
  level,
  tierSuffix,
  rows,
  link,
  children,
  as: As = "p",
  className = "",
}: {
  no?: ReactNode;
  name: ReactNode;
  level?: number;
  tierSuffix?: string;
  rows?: Array<{ label: ReactNode; value: ReactNode }>;
  link?: ReactNode;
  children?: ReactNode;
  as?: "p" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cx("mdx-caption", className)}>
      {no != null ? <span className="mdx-plate text-body leading-[1.3] text-slate">{no}</span> : null}
      {/* mt-0 cancels the accent guard's -4px top margin: its 4px top padding is the gap under No. */}
      <As className="mdx-name mt-0 truncate">{name}</As>
      {level != null ? (
        <TierTag level={level} size="md" suffix={tierSuffix} className="mt-2 self-start" />
      ) : null}
      {rows?.length ? (
        <dl className="mdx-leaders mdx-caption__rows">
          {rows.map((r, i) => (
            <div key={i}>
              <dt className="text-body text-slate">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
      {link ? <div className="mdx-caption__link">{link}</div> : null}
    </div>
  );
}

/** Shelf caption: two lines under the ledge, 56px strip including the ledge. */
export function GridCaption({
  name,
  value,
  sub,
  subRight,
  stack = false,
  className = "",
}: {
  name: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  subRight?: ReactNode;
  /**
   * Phone grids only (they scroll): when the cell is too narrow for both figures on one line, `sub` and
   * `subRight` take a line each instead of cutting a price short (a container query, so the server markup is
   * right at any width). Fitted desktop grids leave it off: their strip is a fixed 56px.
   */
  stack?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("mdx-gridcap", stack && "mdx-gridcap--stack", className)}>
      <div className="flex h-5 items-baseline justify-between gap-2 leading-5">
        <span className="mdx-gridcap__name min-w-0 truncate text-body font-semibold text-ink">
          {name}
        </span>
        {value != null ? <span className="num flex-none text-body text-ink">{value}</span> : null}
      </div>
      <div className="mdx-gridcap__sub flex h-[18px] items-baseline justify-between gap-2 text-body leading-[18px]">
        <span className="min-w-0 truncate">{sub}</span>
        {subRight != null ? <span className="flex flex-none items-center">{subRight}</span> : null}
      </div>
    </div>
  );
}

/**
 * One shelf cell: the card in its tray and its caption. The card is MintCard's TABLE depth: pointing at it, or
 * focusing its link, lifts it out of the tray into your hand (Card3D's Hold), so there is no .mdx-lift wrapper.
 * `width` is a maximum: the cell never grows past its Shelf column, so it can never overflow it.
 */
export function ShelfItem({
  card,
  caption,
  width,
}: {
  card: ReactNode;
  caption: ReactNode;
  width?: number;
}) {
  return (
    <div className="min-w-0" style={width ? { maxWidth: width } : undefined}>
      <Pocket>{card}</Pocket>
      {caption}
    </div>
  );
}

type ShelfEnter = "deal" | "rise" | "none";

/** The session key that marks a grid route as dealt (spec M7: the deal plays once per route per session). */
function dealtKey() {
  return `mdx-dealt:${window.location.pathname}`;
}

/**
 * True when this component's first render is a fresh client render (a client navigation, a dialog opening),
 * false when it hydrates server HTML, even when its code-split route hydrates after the root's effects. React
 * hydrates with the server snapshot, so the first value says which it is; it is kept for the component's life.
 */
export function useClientMount(): boolean {
  // The card engine's own check (it also waits for the router's first render), so a shelf and its cards agree.
  return useFreshMount();
}

/**
 * The entrance a shelf plays when it mounts: none for server-painted cards (and their hydration), the deal from
 * the deck on the first client-navigated visit of a grid route this session (full motion), Rise otherwise.
 */
function shelfEnter(fresh: boolean): ShelfEnter {
  if (!fresh) return "none";
  const level = motionLevel();
  if (level === "calm") return "none";
  if (level === "lite") return "rise";
  try {
    if (sessionStorage.getItem(dealtKey()) === "1") return "rise";
  } catch {
    return "rise";
  }
  return "deal";
}

/** Cell depth in the parallax shelf (L13): one of -16, -8, 0, 8, 16 px, from the coin's dex number. */
function cellZ(seed: number) {
  return ((((seed * 37) % 5) + 5) % 5) * 8 - 16;
}

/**
 * The parallax shelf (L13, desktop, full motion): while the pointer moves over the grid the whole shelf leans
 * toward it on a spring (rotateX up to 1.6deg, rotateY up to 2.4deg; cells sit at their own depths) and a soft
 * 520px spotlight follows it on the wall. It sleeps when the pointer is still or out, and never runs under calm,
 * lite, on touch, offscreen or with a dialog open. One transform write per frame, no layout reads in the loop.
 */
function useShelfParallax(
  host: { current: HTMLDivElement | null },
  rotor: { current: HTMLDivElement | null },
  spot: { current: HTMLDivElement | null },
  enabled: boolean,
) {
  useEffect(() => {
    const el = host.current;
    const r = rotor.current;
    const s = spot.current;
    if (!enabled || !el || !r || !s) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let rect = el.getBoundingClientRect();
    const st = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, sx: 0, sy: 0, px: 0, py: 0, on: false };
    let raf = 0;
    let last = 0;
    let still = 0;
    const live = () => motionLevel() === "full" && !document.hidden && !isDialogOpen();
    const frame = (now: number) => {
      raf = 0;
      if (!live()) {
        r.style.transform = "";
        s.style.opacity = "0";
        return;
      }
      const dt = Math.min(0.034, (now - (last || now)) / 1000) || 0.016;
      last = now;
      // Spring (k 170, c 19) toward the pointer's lean.
      for (const k of ["x", "y"] as const) {
        const v = k === "x" ? "vx" : "vy";
        const t = k === "x" ? st.tx : st.ty;
        st[v] += ((t - st[k]) * 170 - st[v] * 19) * dt;
        st[k] += st[v] * dt;
      }
      st.sx += (st.px - st.sx) * Math.min(1, dt * 9);
      st.sy += (st.py - st.sy) * Math.min(1, dt * 9);
      r.style.transform = `rotateX(${(-st.y * 1.6).toFixed(3)}deg) rotateY(${(st.x * 2.4).toFixed(3)}deg)`;
      s.style.transform = `translate3d(${(st.sx - 260).toFixed(1)}px, ${(st.sy - 260).toFixed(1)}px, 0)`;
      const moving =
        Math.abs(st.tx - st.x) + Math.abs(st.ty - st.y) + Math.abs(st.vx) + Math.abs(st.vy) > 0.002 ||
        Math.abs(st.px - st.sx) + Math.abs(st.py - st.sy) > 0.5;
      still = moving ? 0 : still + 1;
      if (still < 3) raf = requestAnimationFrame(frame);
      // Back at rest with the pointer gone: the shelf goes flat again (no 3D layers while nobody leans it).
      else if (!st.on && Math.abs(st.x) + Math.abs(st.y) < 0.01) {
        r.style.transform = "";
        el.removeAttribute("data-lean");
      }
    };
    const wake = () => {
      if (!raf && live()) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    const onEnter = () => {
      rect = el.getBoundingClientRect();
      st.on = true;
      s.style.opacity = "1";
      if (motionLevel() === "full") el.setAttribute("data-lean", "");
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!st.on) onEnter();
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      const y = (e.clientY - rect.top) / Math.max(1, rect.height);
      st.tx = Math.max(-1, Math.min(1, (x - 0.5) * 2));
      st.ty = Math.max(-1, Math.min(1, (y - 0.5) * 2));
      st.px = e.clientX - rect.left;
      st.py = e.clientY - rect.top;
      if (st.sx === 0 && st.sy === 0) {
        st.sx = st.px;
        st.sy = st.py;
      }
      wake();
    };
    const onLeave = () => {
      st.on = false;
      st.tx = 0;
      st.ty = 0;
      s.style.opacity = "0";
      wake();
    };
    const ro = new ResizeObserver(() => {
      rect = el.getBoundingClientRect();
    });
    ro.observe(el);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      r.style.transform = "";
      el.removeAttribute("data-lean");
    };
  }, [host, rotor, spot, enabled]);
}

/**
 * Shelf grid: each row of cards stands on one continuous ledge spanning the container. `render` must
 * put the card (full cell width, 63/88) first, then a GridCaption; ShelfItem does exactly that.
 *
 * Motion (refs/alive-3d-spec.md M7 to M9, L4, L13): the cards are dealt from a small deck at the shelf's top
 * center on the first client-navigated visit of the route this session; later visits, searches and page turns
 * rise in (mdx-enter). A change of `shuffleKey` (Discover's design or sort, Market's tab) shuffles: the cards on
 * the table gather to the deck face down and riffle, then the new view is dealt. A further change mid-shuffle
 * jumps to the end with Rise. A light passes over one card at a time (the glint, weighted by `glintOf`). A hard
 * load keeps the server-painted cards in place and plays the wave instead: a lean and a light pass run along the
 * shelf once. At rest every card sways in 3D on its own phase (card3d.css).
 */
export function Shelf<T>({
  items,
  cols,
  cardW,
  gap = 20,
  rowGap,
  keyOf,
  render,
  dealKey,
  shuffleKey,
  glintOf,
  parallax = false,
  seedOf,
  turntable = true,
  className = "",
}: {
  items: T[];
  cols: number;
  cardW?: number;
  gap?: number;
  rowGap?: number;
  keyOf: (item: T, index: number) => string | number;
  render: (item: T, cardW: number) => ReactNode;
  /**
   * The view the shelf shows (sort, design, search, tab, page). When it changes every card is dealt again with
   * the staggered entrance (P1-20); polls keep it, so they never replay the deal.
   */
  dealKey?: string | number;
  /** The part of the view whose change shuffles the deck (M9): the design filter and sort, the Market tab. */
  shuffleKey?: string | number;
  /** The glint's weight for a card (default 1; Portfolio gives 3 to the viewer's cards with fees to withdraw). */
  glintOf?: (item: T) => number | undefined;
  /** The pointer-driven parallax shelf and spotlight (L13): desktop grids only. */
  parallax?: boolean;
  /** A stable number per item (the dex number) that sets its depth in the parallax shelf. */
  seedOf?: (item: T) => number;
  /**
   * The cards are inline turntables (owner 2026-10-17, card3d/spin.ts): the ones in view spin slowly in place on a
   * neon pedestal (at most 8, 4 on phones), pause facing front under the pointer, and rest under lite and calm.
   */
  turntable?: boolean;
  className?: string;
}) {
  const [ref, size] = useSize<HTMLDivElement>({ width: 340, height: 600 });
  const deckRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const view = String(dealKey ?? "shelf");
  const shuffle = String(shuffleKey ?? "");

  // What is on the table: the live items of the view shown. While a shuffle gathers the old view's cards to the
  // deck they stay (frozen as they were), and the deal brings the new view.
  const fresh = useClientMount();
  const [shown, setShown] = useState<{ view: string; shuffle: string; enter: ShelfEnter }>(() => ({
    view,
    shuffle,
    enter: shelfEnter(fresh),
  }));
  const live = view === shown.view;
  const frozen = useRef(items);
  if (live) frozen.current = items;
  const list = live ? items : frozen.current;
  const latest = useRef({ view, shuffle });
  latest.current = { view, shuffle };
  const gathering = useRef(0);

  // The route counts as dealt once a shelf has shown it (a hard load shows the cards at rest and marks it too).
  useEffect(() => {
    try {
      sessionStorage.setItem(dealtKey(), "1");
    } catch {
      // Storage blocked: the deal may play again on the next visit.
    }
  }, []);
  // A shelf that can shuffle has the gather chunk ready before the first sort or filter change.
  const canShuffle = shuffleKey !== undefined;
  useEffect(() => {
    if (canShuffle) prefetchGather();
  }, [canShuffle]);

  useEffect(() => {
    if (view === shown.view) return;
    const container = ref.current;
    const level = motionLevel();
    const wantsShuffle = shuffle !== shown.shuffle && level === "full" && !!container && !gathering.current;
    if (!wantsShuffle) {
      // Mid-shuffle, search typing, paging, lite or calm: straight to the new view with Rise.
      gathering.current = 0;
      setShown({ view, shuffle, enter: level === "calm" ? "none" : "rise" });
      return;
    }
    const token = Date.now();
    gathering.current = token;
    void gather(container, deckRef.current).then(() => {
      if (gathering.current !== token) return;
      gathering.current = 0;
      setShown({ ...latest.current, enter: "deal" });
    });
    // shown is read for the comparison only; the effect follows the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, shuffle]);

  const settled = useSettled(shown.view);
  useShelfParallax(ref, rotorRef, spotRef, parallax);
  const c = Math.max(1, Math.floor(cols));
  // `w` is the measured (or requested) card width handed to render(); before hydration it comes from
  // the fallback size. The layout itself is CSS: columns never exceed the shelf (cardW is a maximum),
  // and the ledge sits at the real card height via container units, so the server markup already fits
  // a phone and every ledge meets its cards before any measuring.
  const w = cardW ?? Math.max(40, Math.floor((size.width - (c - 1) * gap) / c));
  const gaps = (c - 1) * gap;
  const colW = `((100cqw - ${gaps}px) / ${c})`;
  const cardWCss = cardW != null ? `min(${cardW}px, ${colW})` : colW;
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += c) rows.push(list.slice(i, i + c));
  const dealing = shown.enter === "deal";
  return (
    // No clip: the cells are minmax(0, ...) columns, so nothing overflows the shelf except each tray's 4px rim
    // and the card shadows, which belong in the page gutter (a one-axis clip cut the outer trays flush, QA).
    <div
      ref={ref}
      data-settled={settled || undefined}
      data-v3d-group=""
      className={cx(
        "mdx-shelf relative flex w-full min-w-0 flex-col [container-type:inline-size]",
        parallax && "mdx-shelf--3d",
        className,
      )}
    >
      {parallax ? (
        <div aria-hidden className="mdx-shelf__spothost">
          <div ref={spotRef} className="mdx-shelf__spot" />
        </div>
      ) : null}
      <CardDeck ref={deckRef} className="mdx-shelf__deck" />
      <div ref={rotorRef} className="mdx-shelf__rotor flex w-full min-w-0 flex-col" style={{ rowGap: rowGap ?? gap }}>
        <CardMotionProvider enter={shown.enter} deck={deckRef} glint wave={!fresh} turntable={turntable}>
          <Fragment key={shown.view}>
            {rows.map((row, r) => (
              <div key={r} className="mdx-shelf__row relative">
                <Ledge className="mdx-shelf__ledge absolute inset-x-0" style={{ top: `calc(${cardWCss} * 88 / 63)` }} />
                <div
                  className="mdx-shelf__grid relative grid justify-center"
                  style={{
                    gridTemplateColumns:
                      cardW != null
                        ? `repeat(${c}, minmax(0, ${cardW}px))`
                        : `repeat(${c}, minmax(0, 1fr))`,
                    columnGap: gap,
                  }}
                >
                  {row.map((item, i) => {
                    const index = r * c + i;
                    return (
                      // The Rise entrance sits on the cell; the deal and the Hold belong to the card itself.
                      <div
                        key={keyOf(item, index)}
                        className={cx("mdx-shelf__cell min-w-0", !dealing && "mdx-enter")}
                        style={
                          {
                            "--i": Math.min(index, 10),
                            ...(parallax && seedOf ? { "--z": `${cellZ(seedOf(item))}px` } : null),
                            // The column fan: every card leans back and the columns face the shelf's middle
                            // (static, from the column only, so the server and the client agree).
                            ...fanVars(i, c),
                          } as CSSProperties
                        }
                      >
                        <div className="mdx-shelf__z">
                          <CardMotionCell index={index} glintWeight={glintOf?.(item)}>
                            {render(item, w)}
                          </CardMotionCell>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Fragment>
        </CardMotionProvider>
      </div>
    </div>
  );
}

/** Skeleton block in the shape of the final row or card, with the one infinite shimmer (static under reduced motion). */
export function Skeleton({
  className = "",
  onWall = false,
  style,
}: {
  className?: string;
  onWall?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cx(onWall ? "mdx-skeleton--wall" : "mdx-skeleton", className)}
      style={style}
    />
  );
}

// ---------------------------------------------------------------- modal

export type ModalProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: number;
};

/**
 * A dialog: centered on desktop, a bottom sheet on phones (backlog P1-1). The phone test only matters once the
 * dialog is open, which never happens in the server HTML, so the switch costs no hydration mismatch.
 */
export function Modal(props: ModalProps) {
  const phone = useIsPhone();
  if (phone) {
    const { open, onOpenChange, title, description, children } = props;
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
        {children}
      </Sheet>
    );
  }
  return <LazyDialogModal {...props} />;
}

const loadDialogModal = () => import("./dialog-modal");
const DialogModal = lazy(loadDialogModal);

/** Radix Dialog is a lazy chunk: it mounts on first open (useOpenedOnce), so it stays out of every page's first download. */
function LazyDialogModal(props: ModalProps) {
  if (!useOpenedOnce(props.open, loadDialogModal)) return null;
  return (
    <Suspense fallback={null}>
      <DialogModal {...props} />
    </Suspense>
  );
}


// ---------------------------------------------------------------- toasts

export type ToastKind = "ok" | "err" | "level";
/** Where a toast can take you (P1-2): a route (to, params, search), a plain href, or a handler. */
export type ToastAction = {
  label: string;
  to?: LinkProps["to"];
  params?: LinkProps["params"];
  search?: LinkProps["search"];
  href?: string;
  onClick?: () => void;
};
export type ToastOpts = { level?: number; action?: ToastAction };
export type ToastFn = (kind: ToastKind, text: string, opts?: ToastOpts) => void;
type Toast = {
  id: number;
  kind: ToastKind;
  text: string;
  level?: number;
  action?: ToastAction;
  leaving?: boolean;
};
const ToastCtx = createContext<ToastFn>(() => {});

/** How long a toast takes to leave (mdx-toast-out) before it is removed. */
const TOAST_OUT_MS = 160;
/** On screen: ok 5s, level 7s, errors 10s (WCAG 2.2.1 wants time to read). A toast with an action stays. */
const TOAST_MS: Record<ToastKind, number> = { ok: 5_000, level: 7_000, err: 10_000 };
const TOAST_MAX = 3;

type Timer = { timer?: ReturnType<typeof setTimeout>; remaining: number; started: number };

/**
 * Toasts sit bottom left of the content area (phones: 12px above the tab bar). Max 3; a fourth sends the oldest
 * out. Ink pills with 18px corners that rise in and fade 6px down on the way out, and the rest of the stack
 * glides to its new place (FLIP, transform only). Ok toasts lead with a mint check, level toasts wear the holo
 * rim and one sheen.
 *
 * Readable (backlog P1-2): timers pause while the pointer is over the stack, while focus is inside it and while
 * the tab is hidden; errors stay 10s; a toast with an action never times out; every toast has a Dismiss button,
 * and Escape dismisses the newest one. Screen readers hear ok and level toasts through a polite status region
 * and errors through an alert region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [said, setSaid] = useState<{ status: string; alert: string }>({ status: "", alert: "" });
  const seq = useRef(0);
  const timers = useRef(new Map<number, Timer>());
  const removals = useRef(new Set<ReturnType<typeof setTimeout>>());
  const hold = useRef({ hover: false, focus: false, hidden: false });
  const stackRef = useRef<HTMLDivElement>(null);
  const tops = useRef(new Map<number, number>());
  // Where focus was before it entered the stack, to hand it back when the last focused toast goes.
  const before = useRef<HTMLElement | null>(null);
  useFocusRescue();

  const held = () => hold.current.hover || hold.current.focus || hold.current.hidden;

  const dismiss = useCallback((id: number) => {
    // A toast dismissed from the keyboard (or a click, which focuses the button) must not drop focus to <body>:
    // the next toast's Dismiss takes it, else whatever had focus before the stack, else the page home.
    const root = stackRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-toast="${id}"]`);
    if (root && el && el.contains(document.activeElement)) {
      const others = [...root.querySelectorAll<HTMLElement>("[data-toast]:not([data-leaving])")].filter(
        (x) => x !== el,
      );
      const next = others[others.length - 1]?.querySelector<HTMLElement>(".mdx-toast__x");
      if (next) next.focus({ preventScroll: true });
      else if (before.current?.isConnected) before.current.focus({ preventScroll: true });
      else focusPageHome();
    }
    const t = timers.current.get(id);
    if (t?.timer) clearTimeout(t.timer);
    timers.current.delete(id);
    setToasts((list) => list.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    const r = setTimeout(
      () => {
        removals.current.delete(r);
        setToasts((list) => list.filter((x) => x.id !== id));
      },
      prefersReducedMotion() ? 0 : TOAST_OUT_MS,
    );
    removals.current.add(r);
  }, []);

  const start = useCallback(
    (id: number) => {
      const t = timers.current.get(id);
      if (!t || t.timer || held()) return;
      t.started = Date.now();
      t.timer = setTimeout(() => dismiss(id), Math.max(0, t.remaining));
    },
    [dismiss],
  );
  const pause = useCallback(() => {
    for (const t of timers.current.values()) {
      if (!t.timer) continue;
      clearTimeout(t.timer);
      t.timer = undefined;
      t.remaining -= Date.now() - t.started;
    }
  }, []);
  const resume = useCallback(() => {
    if (held()) return;
    for (const id of timers.current.keys()) start(id);
  }, [start]);

  useEffect(() => {
    const map = timers.current;
    const rem = removals.current;
    const onVis = () => {
      hold.current.hidden = document.visibilityState === "hidden";
      if (hold.current.hidden) pause();
      else resume();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      map.forEach((t) => t.timer && clearTimeout(t.timer));
      rem.forEach(clearTimeout);
    };
  }, [pause, resume]);

  const push = useCallback<ToastFn>(
    (kind, text, opts) => {
      const id = ++seq.current;
      const toast: Toast = { id, kind, text, level: opts?.level, action: opts?.action };
      setToasts((list) => {
        const live = list.filter((x) => !x.leaving);
        // A fourth toast sends the oldest out (with its exit), never drops it on the spot.
        const over = live.length - (TOAST_MAX - 1);
        if (over > 0) for (const x of live.slice(0, over)) queueMicrotask(() => dismiss(x.id));
        return [...list, toast];
      });
      // Announce: errors through the alert region, everything else through the status region. A trailing
      // no-break space alternates so the same sentence twice is still announced twice.
      const say = id % 2 ? `${text}\u00a0` : text;
      setSaid((p) => (kind === "err" ? { ...p, alert: say } : { ...p, status: say }));
      if (!opts?.action) {
        timers.current.set(id, { remaining: TOAST_MS[kind], started: Date.now() });
        start(id);
      }
    },
    [dismiss, start],
  );

  // Escape dismisses the newest toast (not while typing, and never under an open dialog or menu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isDialogOpen()) return;
      const inStack = !!stackRef.current?.contains(e.target as Node);
      if (!inStack && isTypingTarget(e.target)) return;
      const last = [...toasts].reverse().find((x) => !x.leaving);
      if (!last) return;
      dismiss(last.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toasts, dismiss]);

  // FLIP: toasts that stay glide from where they were to where they are now (transform only).
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const root = stackRef.current;
    if (!root) return;
    const next = new Map<number, number>();
    const motion = !prefersReducedMotion();
    root.querySelectorAll<HTMLElement>("[data-toast]").forEach((el) => {
      const id = Number(el.dataset.toast);
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const before = tops.current.get(id);
      if (motion && before != null && Math.abs(before - top) > 0.5 && !el.hasAttribute("data-leaving")) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], {
          duration: 220,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    });
    tops.current = next;
  }, [toasts]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* What screen readers hear. The visible stack below is a plain region with real buttons. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {said.status}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {said.alert}
      </div>
      <div
        ref={stackRef}
        role="region"
        aria-label="Notifications"
        onMouseEnter={() => {
          hold.current.hover = true;
          pause();
        }}
        onMouseLeave={() => {
          hold.current.hover = false;
          resume();
        }}
        onFocus={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            before.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
          }
          hold.current.focus = true;
          pause();
        }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          hold.current.focus = false;
          resume();
        }}
        className="mdx-toasts"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-toast={t.id}
            data-kind={t.kind}
            data-leaving={t.leaving ? "" : undefined}
            className={cx(
              "mdx-toast pointer-events-auto flex items-center gap-3",
              t.kind === "level" && "mdx-toast--level",
            )}
          >
            {t.kind === "ok" ? (
              <span
                aria-hidden
                className="mdx-toast__ok grid h-[18px] w-[18px] flex-none place-items-center rounded-pill"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M2 5.2 4.1 7.3 8 2.9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            ) : null}
            {t.kind === "level" && t.level ? <FrameMini level={t.level} size="md" /> : null}
            <span className="min-w-0 flex-1 py-1">
              {t.text}
              {t.action ? (
                <>
                  {" "}
                  <ToastActionLink action={t.action} onDone={() => dismiss(t.id)} />
                </>
              ) : null}
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="mdx-toast__x grid h-8 w-8 flex-none place-items-center self-start rounded-pill max-lg:h-11 max-lg:w-11 max-lg:-my-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
                <path
                  d="M2.5 2.5l9 9M11.5 2.5l-9 9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** A toast's action: a route link, a plain link or a button, underlined in the toast's own text color. */
function ToastActionLink({ action, onDone }: { action: ToastAction; onDone: () => void }) {
  const cls = "mdx-toast__action";
  const click = () => {
    action.onClick?.();
    onDone();
  };
  if (action.to) {
    return (
      <Link to={action.to} params={action.params} search={action.search} className={cls} onClick={click}>
        {action.label}
      </Link>
    );
  }
  if (action.href) {
    return (
      <a href={action.href} className={cls} onClick={click} target="_blank" rel="noopener noreferrer">
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={click}>
      {action.label}
    </button>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ---------------------------------------------------------------- keyboard and live numbers

/** True when a key press belongs to a text field (so global shortcuts must not fire). */
export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * True while a dialog, popover or menu is open (Radix marks them role="dialog" or role="menu" with
 * data-state="open"). A menu leaves ArrowLeft and ArrowRight alone, so without the menu check they
 * would page the shelf behind an open Discover design menu.
 */
export function isDialogOpen() {
  if (typeof document === "undefined") return false;
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
}

// ---------------------------------------------------------------- focus that stays in place (P1-24)

/** Set while arrow-key paging settles focus itself (usePageKeys), so the rescue below stays out of its way. */
let pagingUntil = 0;

/**
 * Mounted once (ToastProvider): watches for the focused element leaving the DOM while focus falls to <body>,
 * and hands focus to focusNear. Dialogs (Radix returns focus to the opener) and arrow-key paging (usePageKeys)
 * settle focus themselves and are left alone.
 */
function useFocusRescue() {
  useEffect(() => {
    let last: HTMLElement | null = null;
    let chain: HTMLElement[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || t === document.body) return;
      last = t;
      chain = ancestry(t);
    };
    const check = () => {
      timer = undefined;
      if (!last || last.isConnected) return;
      const lost = chain;
      last = null;
      chain = [];
      const now = document.activeElement;
      if (now && now !== document.body) return;
      if (Date.now() < pagingUntil || isDialogOpen()) return;
      if (lost.some((a) => a.matches('[role="dialog"], [role="alertdialog"], [data-toast]'))) return;
      focusNear(lost);
    };
    const mo = new MutationObserver(() => {
      if (last && !last.isConnected && !timer) timer = setTimeout(check, 30);
    });
    document.addEventListener("focusin", onIn);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onIn);
      mo.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);
}

/**
 * ArrowLeft / ArrowRight page grids and fitted lists (and step the Home featured card with wrap: true).
 * Ignored while typing in a field or when a dialog is open. Never pages on wheel or trackpad.
 *
 * Keyboard users keep their place (backlog P1-24): paged content is keyed by coin, so the focused card or row
 * can unmount with the page. After paging, if the element that had focus is gone, focus moves to a stable
 * target: `afterPage(next)` when given, otherwise the page's main region (main#content), so the next Tab
 * starts at the top of the new page instead of the top of the document.
 */
export function usePageKeys(
  page: number,
  pages: number,
  setPage: (p: number) => void,
  {
    wrap = false,
    enabled = true,
    afterPage,
  }: { wrap?: boolean; enabled?: boolean; afterPage?: (next: number) => void } = {},
) {
  const state = useRef({ page, pages, setPage, wrap, afterPage });
  state.current = { page, pages, setPage, wrap, afterPage };
  useEffect(() => {
    if (!enabled) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;
      const s = state.current;
      if (s.pages <= 1) return;
      let next = s.page + (e.key === "ArrowLeft" ? -1 : 1);
      if (s.wrap) next = (next + s.pages) % s.pages;
      else if (next < 0 || next >= s.pages) return;
      e.preventDefault();
      const had = document.activeElement;
      pagingUntil = Date.now() + 600;
      s.setPage(next);
      if (!(had instanceof HTMLElement) || had === document.body) return;
      // Check after the new page paints, and again after an exit animation (the Home step holds the old card
      // for 160ms before it unmounts).
      const settle = () => {
        if (had.isConnected) return;
        // Only when focus was lost with the old page (it fell to <body>), never away from where it went since.
        const now = document.activeElement;
        if (now && now !== document.body) return;
        if (s.afterPage) s.afterPage(next);
        else focusPageHome();
      };
      for (const ms of [0, 450]) {
        const t = setTimeout(() => {
          timers.delete(t);
          settle();
        }, ms);
        timers.add(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      timers.forEach(clearTimeout);
    };
  }, [enabled]);
}

/**
 * The one reduced motion check for JS motion (false on the server). Every JS-driven moment asks it; CSS
 * motion is switched off by the calm block in mintdex.css. html[data-motion="calm"] is set by the head script (a
 * stored Calm choice, or the device's reduced motion setting when nothing is stored) or live by setCalm.
 */
export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return document.documentElement.dataset.motion === "calm";
}

/**
 * When a polled number changes, returns "up" or "down" for one frame. Put it on the numeral as
 * data-flash together with the mdx-flash class: the color jumps, then eases back to ink over 600ms.
 * Skipped under reduced motion.
 */
export function useFlash(value: number | null | undefined, key?: string | number): "up" | "down" | undefined {
  const prev = useRef(value);
  const prevKey = useRef(key);
  const [flash, setFlash] = useState<"up" | "down" | undefined>(undefined);
  useEffect(() => {
    const before = prev.current;
    const sameThing = prevKey.current === key;
    prev.current = value;
    prevKey.current = key;
    if (!sameThing || value == null || before == null || value === before || prefersReducedMotion()) return;
    setFlash(value > before ? "up" : "down");
  }, [value, key]);
  useEffect(() => {
    if (!flash) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setFlash(undefined));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [flash]);
  return flash;
}

/**
 * Number tick: bumps `n` (with the direction) when a watched value changes, so a span keyed on `n` with
 * class mdx-tick and data-dir slides the new value in. n stays 0 until the first change (server markup and
 * hydration match) and never moves under reduced motion. Num tick wraps this.
 */
export function useTick(value: number | null | undefined) {
  const prev = useRef(value);
  const [t, setT] = useState<{ n: number; dir?: "up" | "down" }>({ n: 0 });
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (value == null || before == null || value === before || prefersReducedMotion()) return;
    setT((s) => ({ n: s.n + 1, dir: value > before ? "up" : "down" }));
  }, [value]);
  return t;
}

/**
 * The ids that appeared since the previous list: empty on the first list, stable between polls that bring
 * nothing new. Mark those rows data-new (the sky arrival wash).
 */
export function useArrivals(ids: Array<string | number>) {
  const seen = useRef<Set<string | number> | null>(null);
  const [fresh, setFresh] = useState<Set<string | number>>(() => new Set());
  const key = ids.join("|");
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const f = ids.filter((id) => !known.has(id));
    for (const id of ids) known.add(id);
    if (f.length) setFresh(new Set(f));
    // The joined key stands for the list: re-run only when its ids change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

/**
 * True once a list's entrance has played; false again for a moment whenever `deal` changes (a new sort, page or
 * view deals the list again). Put it on the list as data-settled: CSS then stops the entrance on rows a poll
 * merely reorders. React moves a reordered row in the DOM, and a moved element restarts its CSS animation, so
 * without this a poll that only changes the order makes the moved rows blink in again (delta 13.4).
 */
export function useSettled(deal: unknown = 0, ms = 700) {
  const [settled, setSettled] = useState<{ deal: unknown } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSettled({ deal }), ms);
    return () => clearTimeout(t);
  }, [deal, ms]);
  return settled !== null && Object.is(settled.deal, deal);
}

/** Everything that wants to know when a dialog opens or closes (one shared 500ms check, only while someone listens). */
const dialogListeners = new Set<() => void>();
let dialogTimer: ReturnType<typeof setInterval> | undefined;
let dialogWas = false;
function watchDialogs(fn: () => void) {
  dialogListeners.add(fn);
  if (!dialogTimer) {
    dialogTimer = setInterval(() => {
      const open = isDialogOpen();
      if (open === dialogWas) return;
      dialogWas = open;
      dialogListeners.forEach((f) => f());
    }, 500);
  }
  return () => {
    dialogListeners.delete(fn);
    if (!dialogListeners.size && dialogTimer) {
      clearInterval(dialogTimer);
      dialogTimer = undefined;
    }
  };
}

/**
 * The page's own loops (Home vitrine, aura, ghosts, sky) pause where nobody sees them (spec 9.1.8): `is-paused`
 * on `ref` while it is offscreen (optional, `margin` around the viewport), the tab is hidden, a dialog is open or
 * the caller holds it (`hold`: Home's Pause). CSS stops every animation under .is-paused. `onChange(live)` hears
 * the automatic gates (the turntable timer), never the hold.
 */
export function usePauseGate(
  ref: { current: HTMLElement | null },
  {
    offscreen = true,
    margin = "100px",
    hold = false,
    onChange,
  }: { offscreen?: boolean; margin?: string; hold?: boolean; onChange?: (live: boolean) => void } = {},
) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const held = useRef(hold);
  held.current = hold;
  const resync = useRef<() => void>(() => {});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = true;
    let lastLive: boolean | null = null;
    const sync = () => {
      const live = visible && !document.hidden && !isDialogOpen();
      el.classList.toggle("is-paused", !live || held.current);
      if (live !== lastLive) {
        lastLive = live;
        cb.current?.(live);
      }
    };
    resync.current = sync;
    let io: IntersectionObserver | undefined;
    if (offscreen && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (es) => {
          visible = es[es.length - 1].isIntersecting;
          sync();
        },
        { rootMargin: margin },
      );
      io.observe(el);
    }
    sync();
    document.addEventListener("visibilitychange", sync);
    const stop = watchDialogs(sync);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      stop();
      resync.current = () => {};
    };
  }, [ref, offscreen, margin]);
  useEffect(() => {
    resync.current();
  }, [hold]);
}

/**
 * Rank glide (M20): when a polled list reorders, every row that kept its place in the list slides from where it
 * was to where it is now (FLIP: measured before and after the commit, then a 420ms transform animation). New
 * rows keep their own wash entrance. `order` is the list's ids in order; children of `ref` carry data-flip={id}.
 * Never under calm motion; transform only.
 */
export function useFlip(ref: { current: HTMLElement | null }, order: Array<string | number>) {
  const key = order.join("|");
  const before = useRef(new Map<string, number>());
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-flip]"));
    const now = new Map<string, number>();
    for (const r of rows) now.set(r.dataset.flip!, r.offsetTop);
    const prev = before.current;
    before.current = now;
    if (!prev.size || prefersReducedMotion() || document.hidden) return;
    for (const r of rows) {
      const from = prev.get(r.dataset.flip!);
      const to = now.get(r.dataset.flip!);
      if (from == null || to == null || from === to) continue;
      r.animate([{ transform: `translateY(${from - to}px)` }, { transform: "none" }], {
        duration: 420,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
    // The joined key stands for the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

const LIVE_PAUSE_KEY = "mdx:live-paused";
const LIVE_PAUSE_EVENT = "mdx:live-paused";

/**
 * A live list (backlog P1-17). The rows on screen hold still while the pointer is over the list, while focus is
 * inside it (so a focused row never unmounts) and while the viewer has paused live updates (LivePause; kept in
 * this browser and shared by every live list). `fresh` holds the rows that arrived since the list last moved
 * (mark them data-new: they enter with the sky wash), and `said` is one polite sentence for screen readers
 * ("2 new trades"). Spread `bind` on the list element: a log that screen readers do not read row by row.
 * The paused choice is read after mount, so the server HTML and hydration always show the live list.
 */
export function useLiveList<T>(
  items: T[],
  idOf: (item: T) => string | number,
  noun: [one: string, many: string],
) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [paused, setPausedState] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(LIVE_PAUSE_KEY) === "1") setPausedState(true);
    } catch {
      // Storage blocked: live updates simply start unpaused.
    }
    const follow = (e: Event) => setPausedState(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(LIVE_PAUSE_EVENT, follow);
    return () => window.removeEventListener(LIVE_PAUSE_EVENT, follow);
  }, []);
  const setPaused = useCallback((p: boolean) => {
    setPausedState(p);
    try {
      localStorage.setItem(LIVE_PAUSE_KEY, p ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
    window.dispatchEvent(new CustomEvent(LIVE_PAUSE_EVENT, { detail: p }));
  }, []);

  const held = hover || focus || paused;
  // What the list showed when it was last free to move (written during render: idempotent).
  const frozen = useRef(items);
  if (!held) frozen.current = items;
  const shown = held ? frozen.current : items;
  const fresh = useArrivals(shown.map(idOf));

  const [said, setSaid] = useState("");
  const flip = useRef(false);
  useEffect(() => {
    if (!fresh.size) return;
    // A trailing no-break space alternates, so the same sentence twice is still announced twice.
    flip.current = !flip.current;
    const n = fresh.size;
    setSaid(`${n} new ${n === 1 ? noun[0] : noun[1]}${flip.current ? "\u00a0" : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  const bind = {
    role: "log",
    "aria-live": "off" as const,
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") setHover(true);
    },
    onPointerLeave: () => setHover(false),
    onFocus: () => setFocus(true),
    onBlur: (e: ReactFocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
    },
  };
  return { shown, fresh, paused, setPaused, held, said, bind };
}

// ---------------------------------------------------------------- layout fitting

/**
 * Collision padding for a popover menu: 12px from every edge, plus the phone bottom tab bar (its
 * measured height with the safe area; 0 at 1024px and up, where the bar is display: none), so a long
 * menu stops above the bar and scrolls instead of covering it. Call it when the menu opens.
 */
export function menuCollisionPadding() {
  const bar =
    typeof document === "undefined"
      ? 0
      : (document.querySelector("[data-tabbar]")?.getBoundingClientRect().height ?? 0);
  return { top: 12, right: 12, left: 12, bottom: 12 + Math.round(bar) };
}

/** Measure an element (client only). SSR renders with the fallback size. */
export function useSize<T extends HTMLElement>(fallback = { width: 1100, height: 620 }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  // Layout effect on the client (measure before paint), plain effect on the server.
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) =>
        Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1 ? s : { width, height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * How many cards (63/88 plus a caption strip) fit in a box without scrolling. When every item fits on
 * one page, prefer the biggest cards; otherwise show as many readable cards (>= minW) as possible.
 * Spec values: strip 56 (5 ledge + 10 + 20 + 18 + 3), gap 20. Discover minW 150 maxW 280.
 */
export function fitCardGrid(
  width: number,
  height: number,
  opts: { strip?: number; gap?: number; minW: number; maxW: number; aspect?: number },
  itemCount = Number.POSITIVE_INFINITY,
) {
  const aspect = opts.aspect ?? CARD_ASPECT;
  const strip = opts.strip ?? 56;
  const gap = opts.gap ?? 20;
  const configs: Array<{ rows: number; cols: number; cardW: number; count: number }> = [];
  for (let rows = 1; rows <= 4; rows++) {
    const maxH = (height - (rows - 1) * gap) / rows - strip;
    const wByH = Math.min(opts.maxW, maxH * aspect);
    if (wByH < opts.minW) continue;
    for (let cols = 1; cols <= 12; cols++) {
      const wByW = (width - (cols - 1) * gap) / cols;
      const cardW = Math.floor(Math.min(wByH, wByW));
      if (cardW < opts.minW) break;
      configs.push({ rows, cols, cardW, count: rows * cols });
    }
  }
  if (!configs.length) return { rows: 1, cols: 1, cardW: opts.minW, count: 1 };
  const fitsAll = configs.filter((c) => c.count >= itemCount);
  if (fitsAll.length) return fitsAll.sort((a, b) => b.cardW - a.cardW || a.count - b.count)[0];
  return configs.sort((a, b) => b.count - a.count || b.cardW - a.cardW)[0];
}

/** Renders only the rows that fully fit the available height (no scroll, no half rows). */
export function FitList<T>({
  items,
  rowHeight,
  render,
  onFit,
  slack = 0,
  className = "",
  ...rest
}: {
  items: T[];
  rowHeight: number;
  render: (item: T, index: number) => ReactNode;
  /** Called with how many rows fit, so a "View all" link can appear when items.length is larger. */
  onFit?: (visible: number) => void;
  /** Pixels to keep free below the last row. */
  slack?: number;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const [ref, size] = useSize<HTMLDivElement>({ width: 340, height: rowHeight * 6 });
  const n = Math.max(1, Math.floor((size.height - slack + 0.5) / rowHeight));
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  useEffect(() => {
    onFitRef.current?.(n);
  }, [n]);
  return (
    // The rows wrap column-wise, so a row that does not fit whole (a measurement off by a pixel, a hidden tab
    // that has not laid out) moves past the right edge, where overflow hides it, instead of showing cut.
    <div
      ref={ref}
      {...rest}
      className={cx(
        "flex min-h-0 flex-1 flex-col flex-wrap content-start overflow-hidden [&>*]:w-full [&>*]:flex-none",
        className,
      )}
    >
      {items.slice(0, n).map((item, i) => render(item, i))}
    </div>
  );
}
