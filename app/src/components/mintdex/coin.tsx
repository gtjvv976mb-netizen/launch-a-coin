/**
 * Coin page pieces (/coin/$id): the market strip (market cap, bonding curve, price, 24h volume, holders), the
 * market-cap chart, the trade ticket (useTradeTicket, TradePanel and the phone TradeActionBar), the activity table,
 * the card's facts, the token's facts and About.
 * Layout lives in routes/coin/$id.tsx and styles/screens/coin.css: one page that scrolls once, one DOM order at every
 * width (no tabs); grid areas place the sections. useSectionParam scrolls an old ?tab= link to its section.
 * CoinHeader, CoinObject, CaptionTop, DesignProgress and PhoneHeroDesign serve the inherited chain page only.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link, useRouter } from "@tanstack/react-router";

import {
  claimFaucet,
  reportCoin,
  tradeCoin,
  updateLore,
} from "../../lib/mintdex/api";
import { FAUCET_AMOUNT, TOKEN_UNIT, TRADE_FEE_BPS } from "../../lib/mintdex/constants";
import {
  BOT_HINT,
  FLOW,
  IS_SIM,
  MODE_COPY,
  REPORT_REASONS,
  notEnoughSentence,
  pct,
  type ReportReason,
} from "../../lib/mintdex/copy";
import {
  priceSol,
  quoteBuy,
  quoteSell,
  type BuyQuote,
  type SellQuote,
} from "../../lib/mintdex/curve";
import {
  HIGH_IMPACT,
  MAX_SLIPPAGE_BPS,
  TRADE_FEE_LINES,
  minOutAfterSlippage,
} from "../../lib/mintdex/fees";
import {
  atName,
  dexNo,
  cleanAmount,
  sol,
  timeAgo,
  tokens,
  usdCompact,
  usdFull,
} from "../../lib/mintdex/format";
import { getCardDesign } from "../../lib/carddex/designs";
import { getPairAsset } from "../../lib/carddex/pairs";
import { marketCapText, marketCapWatch, quoteFixed, quoteNumber } from "../../lib/carddex/quote-display";
import { formatQuoteAmount, parseQuoteAmount, quoteMetrics } from "../../lib/carddex/quote-simulation";
import type { CoinDetail, CoinPage, TradeRow } from "../../lib/mintdex/types";
import { CardBack, CardCase, GyroChip, View3DButton, useView3DGestures, type Card3DHandle } from "./card3d";
import { useClaimable } from "./cases";
import { prefersReducedMotion, useAction, useLoaderViewport, useNow } from "./hooks";
import { useMe, useRequireMe } from "./session";
import { isCoarsePointer, isPhoneNow, useKeyboardSafe } from "./sheet";
import {
  BotTag,
  ShareButton,
  SimTag,
  coinShare,
} from "./trust";
import {
  ActionBar,
  Address,
  Badge,
  Button,
  Change,
  CurveTrack,
  Field,
  FrameMini,
  Icon,
  KpiGroup,
  LivePause,
  Modal,
  Num,
  SectionHead,
  SideToggle,
  Tabs,
  TextLink,
  useLiveList,
  useSize,
  type StatItem,
} from "./ui";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- old ?tab= links

/**
 * Old section links (?tab=trades from a notification, ?tab=card from Portfolio) still land on their section: the
 * page has no tabs any more, so the section with data-section={tab} is scrolled to the top of main (instantly) when
 * it is not already on screen, then `clear` drops ?tab from the URL (replace, no scroll reset). Keyed on the value,
 * not on mount, so a link to the coin already open works too. It waits for the router's render (its own scroll
 * reset runs then), with a double frame as the fallback when that render already happened (a hard load).
 */
export function useSectionParam(tab: string | undefined, clear: () => void) {
  const router = useRouter();
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    if (!tab) return;
    let done = false;
    let f1 = 0;
    let f2 = 0;
    const stop = () => {
      unsubscribe();
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
    };
    const go = () => {
      if (done) return;
      done = true;
      stop();
      const main = document.querySelector<HTMLElement>('[data-scroll-restoration-id="content"]');
      const el = main?.querySelector<HTMLElement>(`[data-section="${CSS.escape(tab)}"]`);
      if (main && el && el.getClientRects().length) {
        const box = main.getBoundingClientRect();
        const top = el.getBoundingClientRect().top;
        if (top < box.top || top > box.bottom - 48) el.scrollIntoView({ block: "start", behavior: "auto" });
      }
      clearRef.current();
    };
    const unsubscribe = router.subscribe("onRendered", go);
    f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(go);
    });
    return () => {
      done = true;
      stop();
    };
  }, [tab, router]);
}

// ---------------------------------------------------------------- formatting

/** "2m ago" becomes "2m" in dense tables. */
function ago(ms: number, now?: number) {
  return timeAgo(ms, now).replace(/ ago$/, "");
}

// The balance and column format lives in quote-display.ts (the Launch page shows balances the same way).
export { quoteFixed };

/** One precision for every percentage on the page: "2.4%", "144.1%", "<0.1%" (a size, never signed). */
function pctText(v: number) {
  const p = Math.abs(v * 100);
  if (p === 0) return "0.0%";
  return p < 0.05 ? "<0.1%" : `${p.toFixed(1)}%`;
}

/**
 * A price with its run of zeros counted (0.0000003551 reads 0.0₆3551, four significant figures), so a tiny price
 * is readable at a glance. Screen readers get the plain decimal. Prices of 0.001 and up print as they are.
 */
export function PriceFigure({ value }: { value: number }) {
  if (!Number.isFinite(value) || value <= 0) return <>0</>;
  if (value >= 0.001) return <>{Number(value.toPrecision(4)).toLocaleString("en-US", { maximumFractionDigits: 6 })}</>;
  let zeros = -Math.floor(Math.log10(value)) - 1;
  let digits = Math.round(value * 10 ** (zeros + 4));
  if (digits >= 10_000) {
    zeros -= 1;
    digits = Math.round(digits / 10);
  }
  const sig = String(digits).replace(/0+$/, "") || "0";
  const plain = `0.${"0".repeat(zeros)}${sig}`;
  return (
    <>
      <span className="sr-only">{plain}</span>
      <span aria-hidden="true" className="cdx-price">
        0.0<sub>{zeros}</sub>
        {sig}
      </span>
    </>
  );
}

/**
 * A handle, then " · bot" in slate for a demo bot (the quiet word Home's feed uses, not a chip on every row) and
 * "you" for the viewer. Truncates the handle, never the tags.
 */
function Handle({ handle, bot, you, className = "" }: { handle: string; bot?: boolean; you?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <span className="truncate">{atName(handle)}</span>
      {bot ? (
        <span className="cdx-handle__bot">
          <span aria-hidden>· </span>bot<span className="sr-only">, {BOT_HINT.toLowerCase()}</span>
        </span>
      ) : null}
      {you ? <Badge>you</Badge> : null}
    </span>
  );
}

// ---------------------------------------------------------------- the market strip

/** Graduation in words, for the curve cell and the details. */
function curveSentence(coin: CoinDetail) {
  if (coin.graduated) return MODE_COPY.curveComplete;
  return IS_SIM
    ? "The price follows a bonding curve. When the curve sells out, a pump.fun coin graduates to a PumpSwap pool. This curve is simulated."
    : "The price follows the pump.fun bonding curve. When it sells out, the coin graduates to a PumpSwap pool.";
}

/** A USD market cap of $100K and up reads compact ($853K, $1.23M) at every width, so the lead cell never overflows. */
const LEAD_COMPACT_FROM = 100_000;

/**
 * The coin's figures, as type in one divided container, in reading order: the market cap leads (30px) with its 24h
 * change, then the bonding curve (the signature track), price, 24h volume and holders. Missing is null (grey dash).
 */
function marketItems(coin: CoinDetail): StatItem[] {
  const native = coin.mcapUsd == null;
  const compact = (coin.mcapUsd ?? 0) >= LEAD_COMPACT_FROM;
  const known = coin.curveProgress != null && Number.isFinite(coin.curveProgress);
  return [
    {
      label: "Market cap",
      value: native ? quoteNumber(coin.mcapQuote, true) : marketCapText(coin, compact),
      unit: native ? coin.quoteSymbol : undefined,
      watch: marketCapWatch(coin),
      change: (
        <span className="cdx-coin-screen__chg">
          <Change v={coin.change24h} pill />
          <span aria-hidden="true">24h</span>
        </span>
      ),
    },
    {
      // The figure and its note are hidden from screen readers: the track's meter says the same words.
      label: "Bonding curve",
      value: coin.graduated ? (
        <span aria-hidden="true">Graduated</span>
      ) : known ? (
        <span aria-hidden="true">{Math.round(Math.min(1, Math.max(0, coin.curveProgress)) * 100)}%</span>
      ) : null,
      change: !coin.graduated && known ? <span className="cdx-coin-screen__curvenote" aria-hidden="true">to graduation</span> : undefined,
      sub: <CurveTrack label="Bonding curve" progress={coin.curveProgress} graduated={coin.graduated} />,
    },
    {
      label: "Price",
      value: <PriceFigure value={coin.priceQuote ?? coin.priceSol ?? 0} />,
      unit: coin.quoteSymbol,
    },
    { label: "Volume 24h", value: quoteFixed(coin.volume24hQuote, coin.quoteAssetKey), unit: coin.quoteSymbol },
    { label: "Holders", value: coin.holders.toLocaleString("en-US") },
  ];
}

/**
 * The market strip: market cap (the page's one lead figure), bonding curve, price, 24h volume and holders in one
 * divided surface. Desktop and tablets read it as one row over the chart; phones stack it beside the card. Phones
 * also take the "Enable phone tilt" chip here, in the hero's spare room, instead of a second row under the case.
 */
export function CoinMarket({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  return (
    <section className={cx("cdx-coin-screen__market", className)} aria-label={`${coin.name} market`}>
      <KpiGroup items={marketItems(coin)} lead />
      <GyroChip className="cdx-coin-screen__tilt" />
    </section>
  );
}

// ---------------------------------------------------------------- the card's facts and the coin's details

/** Owner, launcher and edition of the coin's one-of-one card, as label and value rows. */
export function CardFacts({ page, className = "" }: { page: CoinPage; className?: string }) {
  const { coin, viewer } = page;
  return (
    <dl className={cx("cdx-coin-facts", className)} aria-label="The creator's card">
      <div>
        <dt>Owner</dt>
        <dd><Handle handle={coin.ownerHandle} bot={coin.ownerIsBot} you={!!viewer?.isOwner} /></dd>
      </div>
      <div>
        <dt>Launched by</dt>
        <dd><Handle handle={coin.creatorHandle} bot={coin.creatorIsBot} you={!!viewer?.isCreator} /></dd>
      </div>
      <div>
        <dt>Edition</dt>
        <dd>One of one · <span className="num">{dexNo(coin.dexNo)}</span></dd>
      </div>
    </dl>
  );
}

/**
 * The token's facts people look up: trading pair, quote asset, quote mint (Solscan) and the coin's own address (in
 * test mode a test key that was never deployed, decision C6: the label says so). Label left, value right. The page
 * renders it twice (under the ticket on tall desktop windows, in About everywhere else); CSS shows one.
 */
export function TokenFacts({ page, className = "" }: { page: CoinPage; className?: string }) {
  const { coin } = page;
  const asset = getPairAsset(coin.quoteAssetKey);
  return (
    <dl className={cx("cdx-coin-facts", className)} aria-label={`$${coin.ticker} token`}>
      <div>
        <dt>Trading pair</dt>
        <dd>{coin.tradingPair ?? `${coin.ticker} / ${asset.symbol}`}</dd>
      </div>
      <div>
        <dt>Quote asset</dt>
        <dd>{asset.name}{asset.issuer ? <span className="text-slate"> · {asset.issuer}</span> : null}</dd>
      </div>
      <div>
        <dt>Quote mint</dt>
        <dd>
          <a
            className="mdx-link mdx-hit cdx-coin-facts__link"
            href={`https://solscan.io/token/${asset.mint}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`${asset.mint.slice(0, 4)}…${asset.mint.slice(-4)}, ${asset.symbol} quote mint on Solscan (opens in a new tab)`}
          >
            <span className="num">{asset.mint.slice(0, 4)}…{asset.mint.slice(-4)}</span> <Icon name="external" size={12} />
          </a>
        </dd>
      </div>
      <div>
        <dt>{coin.mintAddress && IS_SIM ? "Test address" : "Token address"}</dt>
        <dd>
          {coin.mintAddress ? (
            <Address address={coin.mintAddress} compact className="cdx-coin-facts__addr" />
          ) : (
            <span className="text-slate">{IS_SIM ? "None in the demo" : "Assigned at launch"}</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/**
 * About the coin: its description and what the bonding curve means (at most 65ch), with the facts beside it from
 * 640px of panel width (TokenFacts, and CardFacts when the card column does not show them), then the coin's own
 * links and the owner's Edit description (or Report for everyone else). One column in a narrow panel.
 */
export function CoinAbout({
  page,
  onEdit,
  cardFacts,
  className = "",
}: {
  page: CoinPage;
  onEdit: () => void;
  /** The card's facts, for the arrangements whose card column does not show them. */
  cardFacts?: ReactNode;
  className?: string;
}) {
  const { coin } = page;
  const isOwner = !!page.viewer?.isOwner;
  const asset = getPairAsset(coin.quoteAssetKey);
  const require = useRequireMe();
  const [reportOpen, setReportOpen] = useState(false);
  const headingId = useId();
  return (
    <section className={cx("cdx-coin-about", className)} aria-labelledby={headingId}>
      <SectionHead title={<span id={headingId}>About ${coin.ticker}</span>} />
      <div className="cdx-coin-about__body">
        <div className="cdx-coin-about__text">
          <p className={cx("cdx-coin-about__lore", !coin.lore && "text-slate")}>
            {coin.lore || "The creator has not added a description."}
          </p>
          <p className="cdx-coin-about__note">{curveSentence(coin)}</p>
          {asset.kind === "stock" ? <p className="cdx-coin-about__note">Paired with a tokenized stock asset. Your coin does not represent company shares.</p> : null}
          <div className="cdx-coin-about__actions">
            {coin.website ? (
              <TextLink href={coin.website} target="_blank" rel="noopener noreferrer nofollow">
                Website <Icon name="external" size={12} />
              </TextLink>
            ) : null}
            {coin.xUrl ? (
              <TextLink href={coin.xUrl} target="_blank" rel="noopener noreferrer nofollow">
                X profile <Icon name="external" size={12} />
              </TextLink>
            ) : null}
            {isOwner ? (
              <Button variant="outline" size="sm" onClick={onEdit}>Edit description</Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                aria-haspopup="dialog"
                onClick={() => require(() => setReportOpen(true), "Try the demo to report a card.")}
              >
                Report
              </Button>
            )}
          </div>
          {MODE_COPY.guideNote ? <p className="cdx-coin-about__foot">{MODE_COPY.guideNote}</p> : null}
        </div>
        <div className="cdx-coin-about__facts">
          <TokenFacts page={page} className="cdx-coin-about__token" />
          {cardFacts}
        </div>
      </div>
      <ReportDialog coin={coin} open={reportOpen} onOpenChange={setReportOpen} />
    </section>
  );
}

// ---------------------------------------------------------------- inherited chain page pieces

/** Header row of the inherited chain page: name, ticker and design | market cap and 24h change. */
export function CoinHeader({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  const design = getCardDesign(coin.cardTemplate);
  const hero = coin.mcapUsd == null ? quoteNumber(coin.mcapQuote, true) : marketCapText(coin, false);
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-5 gap-y-3", className)}>
      <div className="min-w-0 xl:flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="mdx-h1 min-w-0 truncate">{coin.name}</h1>
          <ShareButton {...coinShare(coin)} label={`Share ${coin.name}`} />
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-3 whitespace-nowrap text-body text-slate">
          <span className="flex-none">${coin.ticker}</span>
          <span className="hidden min-w-0 items-center gap-1.5 font-medium text-ink lg:inline-flex">
            <FrameMini level={coin.level} />
            <span className="min-w-0 truncate">{design.name}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-none items-end gap-5">
        <div className="flex flex-col items-start">
          <Num size="hero" unit={coin.mcapUsd == null ? coin.quoteSymbol : undefined} watch={marketCapWatch(coin)}>
            {hero}
          </Num>
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-caption font-medium text-slate">Market cap<SimTag /></span>
        </div>
        <div className="flex flex-col items-start">
          <Change v={coin.change24h} pill />
          <span className="mt-1 text-caption font-medium text-slate">24h</span>
        </div>
      </div>
    </header>
  );
}

/** "No. 004  Launched by @handle" (and the "bot" tag) over the design name: the inherited chain page caption. */
export function CaptionTop({
  coin,
  chip = true,
  chipTitle,
  className = "",
}: {
  coin: CoinDetail;
  chip?: boolean;
  chipTitle?: string;
  className?: string;
}) {
  const design = getCardDesign(coin.cardTemplate);
  return (
    <div className={cx("min-w-0", className)}>
      <div className="flex min-w-0 items-baseline gap-2 text-body text-slate">
        <span className="num flex-none">{dexNo(coin.dexNo)}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">Launched by {atName(coin.creatorHandle)}</span>
          {coin.creatorIsBot ? <BotTag /> : null}
        </span>
      </div>
      {chip ? (
        <p className="mt-2 text-body font-medium text-ink" title={chipTitle}>
          {design.name}
        </p>
      ) : null}
    </div>
  );
}

/** The inherited chain page's phone hero design line. */
export function PhoneHeroDesign({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  const design = getCardDesign(coin.cardTemplate);
  return <span className={cx("mt-2 block max-w-full truncate text-caption font-medium text-ink", className)}>{design.name}</span>;
}

/** The selected print is permanent and independent of token performance. */
export function DesignProgress({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  const design = getCardDesign(coin.cardTemplate);
  return (
    <p className={cx("text-body text-slate", className)}>
      <span className="font-medium text-ink">{design.name}.</span> Chosen by the creator. This card keeps its design.
    </p>
  );
}

/**
 * The next design is close (L10): within 10% of its market cap threshold, the case rim pulses in that design's
 * ring color. Designs are fixed at launch, so this never fires.
 */
export function nearNextOf(_coin: CoinDetail): { ring: string } | null {
  return null;
}

// ---------------------------------------------------------------- the card

/**
 * The coin's card in its labeled collector case. The case unboxes on client navigation, breathes and peeks, and
 * jolts on each new live token trade. `back` (an unverified devnet card mint) shows the printed back, with no case
 * and no flip. `inspect={false}` leaves the case row to Turn over, Pause spin and View in 3D (the 3D viewer shows
 * the cased card too).
 */
export function CoinCase({
  coin,
  latestTradeId,
  back,
  phone = false,
  compact = false,
  priority = false,
  inspect = true,
  sizes,
  className = "",
}: {
  coin: CoinDetail;
  latestTradeId?: string | number | null;
  /** The card back's title (why the art is not shown), instead of the case. */
  back?: string;
  phone?: boolean;
  compact?: boolean;
  priority?: boolean;
  inspect?: boolean;
  /** The card art's img sizes; defaults follow the inherited chain page. */
  sizes?: string;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<Card3DHandle | null>(null);
  useClaimable(coin.id, el, handle);
  // The 3D button and a long press open the same cased object.
  useView3DGestures(el, coin.id);
  // Each new live trade gives the case a small jolt (rate limited inside the card).
  const lastTrade = useRef(latestTradeId);
  useEffect(() => {
    const before = lastTrade.current;
    lastTrade.current = latestTradeId;
    if (before == null || latestTradeId == null || before === latestTradeId) return;
    if (el.current && el.current.getClientRects().length > 0) handle.current?.jolt();
  }, [latestTradeId]);
  return (
    <div ref={el} className={cx("mdx-casehost relative", className)}>
      {back ? (
        <CardBack depth="hand" title={back} />
      ) : (
        <CardCase
          ref={handle}
          card={coin}
          variant={compact ? "holder" : "labeled"}
          controls={compact ? "none" : "row"}
          inspect={inspect}
          nearNext={nearNextOf(coin)}
          priority={priority}
          sizes={sizes ?? (phone ? "(max-width: 1023px) 240px, 300px" : COIN_CARD_SIZES)}
          extraControl={<View3DButton item={{ id: coin.id, card: coin, cased: true }} className="mdx-v3dbtn--case" />}
        />
      )}
    </div>
  );
}

/** The inherited chain page's object: a labeled case at xl and a compact holder from 1024 to 1279px. */
export function CoinObject({
  coin,
  latestTradeId,
  back,
}: {
  coin: CoinDetail;
  latestTradeId?: string | number | null;
  back?: string;
}) {
  return (
    <>
      <div className="w-[96px] xl:hidden">
        {back ? <CardBack title={back} /> : <CoinCase coin={coin} latestTradeId={latestTradeId} compact priority />}
      </div>
      <div className="hidden xl:block xl:w-[min(100cqw,calc((100cqh_-_60px)*112/173.683))]">
        <CoinCase coin={coin} latestTradeId={latestTradeId} back={back} priority />
      </div>
    </>
  );
}

/** The inherited chain page's card as an img sizes value (its 112px phone hero, then the desktop columns). */
export const COIN_CARD_SIZES =
  "(max-width: 1023px) 112px, (max-width: 1279px) 96px, (max-width: 1439px) 264px, (max-width: 1679px) 300px, 340px";

/** Report a card that breaks the content rules (P1-28): one reason, one button. */
function ReportDialog({
  coin,
  open,
  onOpenChange,
}: {
  coin: CoinDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { run, pending } = useAction();
  const [reason, setReason] = useState<ReportReason | null>(null);
  useEffect(() => {
    if (open) setReason(null);
  }, [open]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Report ${coin.name}`}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason) return;
          const r = await run(
            "report",
            () => reportCoin({ data: { coinId: coin.id, reason } }),
            (res) =>
              res.first
                ? "Report sent. Coins that break the content rules are hidden."
                : "You already reported this card.",
            // Nothing on screen changes: no refetch.
            { keys: [] },
          );
          if (r) onOpenChange(false);
        }}
      >
        <fieldset>
          <legend className="text-body text-slate">
            What breaks the{" "}
            <TextLink to="/legal" hash="terms" onClick={() => onOpenChange(false)}>
              content rules
            </TextLink>
            ?
          </legend>
          <div className="mt-3 flex flex-col">
            {REPORT_REASONS.map((r) => (
              <label
                key={r.value}
                className="mdx-row -mx-2 flex min-h-11 cursor-pointer items-center gap-3 px-2 text-body text-ink hover:bg-raised"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="h-4 w-4 flex-none accent-[var(--color-ink)]"
                />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mdx-sheet-foot mt-5">
          <Button type="submit" block disabled={!reason} pending={pending === "report"} pendingLabel="Sending...">
            Send report
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- chart

const RANGES = [
  { key: "1h", label: "1H", ms: 3_600_000, words: "in the last hour" },
  { key: "6h", label: "6H", ms: 6 * 3_600_000, words: "in the last 6 hours" },
  { key: "24h", label: "24H", ms: 24 * 3_600_000, words: "in the last 24 hours" },
  { key: "all", label: "All", ms: Number.POSITIVE_INFINITY, words: "yet" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];
const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.key as RangeKey, label: r.label }));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
/** Time-axis steps, UTC aligned: the first that keeps the labels apart wins. */
const TIME_STEPS = [MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

const two = (n: number) => String(n).padStart(2, "0");
const utcDay = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const utcClock = (t: number) => { const d = new Date(t); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
const utcStamp = (t: number) => `${utcDay(t)}, ${utcClock(t)} UTC`;

function niceStep(span: number, count: number) {
  const raw = span / count;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** Round value ticks, 3 to 6 of them, with the top tick above the highest value so the line never meets the edge. */
function valueScale(values: number[]) {
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (!(hi > lo)) {
    const pad = hi > 0 ? hi * 0.1 : 1;
    lo = Math.max(0, lo - pad);
    hi += pad;
  }
  const step = niceStep(hi - lo, 4);
  const min = Math.max(0, Math.floor(lo / step) * step);
  let max = Math.ceil(hi / step) * step;
  if (max - hi < step * 0.08) max += step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2 && ticks.length < 7; v += step) ticks.push(v);
  return { min, max: ticks[ticks.length - 1], ticks };
}

/** Time ticks on one UTC-aligned step, at most `room` labels; midnight and day steps read "28 Oct", the rest "06:00". */
function timeTicks(t0: number, t1: number, room: number) {
  const span = Math.max(1, t1 - t0);
  const step = TIME_STEPS.find((s) => span / s <= room) ?? Math.ceil(span / room / DAY) * DAY;
  const ticks: Array<{ t: number; label: string }> = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    const midnight = t % DAY === 0;
    ticks.push({ t, label: step >= DAY || midnight ? utcDay(t) : utcClock(t) });
  }
  return ticks;
}

type ChartPoint = { t: number; v: number; id: number; side: "buy" | "sell" };

/** The plot's first-frame size by window: the same bands as --chart-plot-h in coin.css. */
function plotFallback(vp: { w: number; h?: number } | null): { width: number; height: number } {
  if (!vp) return { width: 640, height: 260 };
  const h = vp.h ?? 900;
  if (vp.w < 768) return { width: Math.max(240, vp.w - 56), height: 180 };
  if (vp.w < 1024) return { width: Math.max(240, vp.w - 80), height: 200 };
  const height = h >= 1040 ? 300 : h >= 860 ? 260 : vp.w < 1280 && h < 800 ? 164 : 200;
  // The centre column: the column less the card and ticket tracks and the gaps.
  const column = Math.min(vp.w - (vp.w >= 1280 ? 64 : 48), 1600);
  const width = vp.w >= 1280 ? column - Math.min(320, Math.max(280, column * 0.22)) - Math.min(360, Math.max(320, column * 0.25)) - 32 : column - 280 - 288 - 32;
  return { width: Math.max(240, Math.round(width - 32)), height };
}

/**
 * Market cap after each observed trade, drawn as a 2px gold line in steps: on a bonding curve the market cap only
 * moves when a trade fills, so the line holds level between trades and steps at each one (no smoothing, nothing
 * invented between observations). 3 to 6 round gridlines, 12px axis labels, a 1H / 6H / 24H / All range. Pointer,
 * tap and arrow keys inspect one trade at a time (crosshair, dot and readout; a screen reader hears the same).
 * The props keep the inherited chain page's shape.
 */
export function McapChart({
  trades,
  currentUsd,
  currentQuote,
  quoteAssetKey = "sol",
  createdAt,
  tradeCount,
  pane,
  className = "",
}: {
  trades: TradeRow[];
  currentUsd: number | null;
  currentQuote?: number;
  quoteAssetKey?: string;
  createdAt: number;
  /** Total history can exceed the latest 400 observations supplied by the catalogue. */
  tradeCount?: number;
  /** Compatibility input; card designs never change the chart. */
  level: number;
  pane?: string;
  className?: string;
}) {
  const native = currentUsd == null;
  const symbol = getPairAsset(quoteAssetKey).symbol;
  const axisFigure = (v: number) => (native ? quoteNumber(v, true) : usdCompact(v));
  const fullFigure = (v: number) => (native ? `${quoteNumber(v)} ${symbol}` : usdFull(v));
  const [range, setRange] = useState<RangeKey>("all");
  const [active, setActive] = useState<number | null>(null);
  // Server and first client frame use the same observation clock.
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  // The first frame's plot size (server and hydrating client alike), from the root loader's viewport and the plot
  // heights in coin.css (--chart-plot-h); the measured size takes over after mount.
  const vp = useLoaderViewport();
  const [ref, size] = useSize<HTMLDivElement>(plotFallback(vp));
  const headingId = useId();

  const samples = useMemo<ChartPoint[]>(
    () =>
      trades
        .flatMap((trade) => {
          // A quote-native sample must never fall back to an unrelated USD number, or vice versa.
          const v = native ? trade.mcapQuote : trade.mcapUsd;
          return v != null && Number.isFinite(v) && v >= 0 && Number.isFinite(trade.createdAt)
            ? [{ t: trade.createdAt, v, id: trade.id, side: trade.side }]
            : [];
        })
        .sort((a, b) => a.t - b.t || a.id - b.id),
    [trades, native],
  );
  const newest = samples.length ? samples[samples.length - 1].id : 0;
  const seen = useRef(newest);
  const [ping, setPing] = useState<number | null>(null);
  useEffect(() => {
    if (!newest || newest === seen.current) return;
    seen.current = newest;
    if (!prefersReducedMotion()) setPing(newest);
  }, [newest]);

  const lastT = samples.length ? samples[samples.length - 1].t : createdAt;
  const now = Math.max(clock ?? lastT, lastT);
  const def = RANGES.find((option) => option.key === range)!;
  const t0 = Number.isFinite(def.ms) ? now - def.ms : Math.min(createdAt, samples[0]?.t ?? createdAt);
  const t1 = Math.max(now, t0 + MINUTE);
  const points = useMemo(() => samples.filter((p) => p.t >= t0 && p.t <= t1), [samples, t0, t1]);
  const at = active != null && active < points.length ? active : null;
  const selected = at != null ? points[at] : null;

  const W = Math.max(240, Math.round(size.width));
  const H = Math.max(160, Math.round(size.height));
  const LANE = 52, TOP = 10, BOTTOM = 26;
  const plotW = W - LANE;
  const plotH = H - TOP - BOTTOM;
  const scale = valueScale(points.map((p) => p.v));
  const x = (t: number) => ((t - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => TOP + (1 - (v - scale.min) / (scale.max - scale.min || 1)) * plotH;
  const crisp = (n: number) => Math.round(n) + 0.5;
  const ticks = timeTicks(t0, t1, Math.max(2, Math.min(6, Math.floor(plotW / 84))));
  const path = points
    .map((p, i) => (i === 0 ? `M${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}` : `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}`))
    .join("");
  const last = points[points.length - 1];
  const isTruncated = (tradeCount ?? trades.length) > trades.length;

  function nearest(px: number) {
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    return best;
  }
  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!points.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setActive(nearest(((event.clientX - rect.left) / rect.width) * W));
  }
  function onKey(event: React.KeyboardEvent<HTMLElement>) {
    if (!points.length || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? points.length - 1
      : at == null ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, at + (event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1)));
    setActive(next);
  }

  // The stepper's value in words (a slider, so screen readers in browse mode hand it the arrow keys).
  const readout = selected
    ? `${fullFigure(selected.v)} after a ${selected.side} on ${utcStamp(selected.t)}`
    : last ? `Latest ${fullFigure(last.v)}` : "";
  const summary = last
    ? `Market cap after each trade ${def.key === "all" ? "since launch" : def.words.replace(/^in /, "over ")}: ${points.length} ${points.length === 1 ? "trade" : "trades"}, latest ${fullFigure(last.v)}.`
    : "";
  const emptyText = samples.length
    ? `No trades ${def.words}. Choose a longer range.`
    : "No trades yet. The chart starts with the first trade.";
  const tipLeft = selected ? x(selected.t) : 0;

  return (
    <section className={cx("cdx-chart", className)} aria-labelledby={headingId} data-pane={pane}>
      <SectionHead
        title={<span id={headingId}>{native ? `Market cap · ${symbol}` : "Market cap"}</span>}
        right={
          <Tabs size="sm" label="Chart range" value={range} options={RANGE_OPTIONS}
            onChange={(next) => { setRange(next); setActive(null); }} />
        }
      />
      <div ref={ref} className="cdx-chart__plot">
        {!points.length ? (
          <div className="cdx-chart__empty">
            <p>{emptyText}</p>
          </div>
        ) : (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${W} ${H}`}
            className="cdx-chart__svg"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={(event) => { if (event.pointerType !== "touch") setActive(null); }}
            role="img"
            aria-label={`Market cap chart, latest ${fullFigure(last.v)}`}
          >
            <desc>{summary}</desc>
            {scale.ticks.map((v, i) => (
              <g key={v}>
                <line x1={0} x2={plotW} y1={crisp(y(v))} y2={crisp(y(v))}
                  className={i === 0 ? "cdx-chart__base" : "cdx-chart__grid"} />
                <text x={W - 4} y={y(v) + 4} textAnchor="end" className="cdx-chart__label">{axisFigure(v)}</text>
              </g>
            ))}
            {ticks.map((tick) => {
              const tx = Math.min(plotW - 20, Math.max(20, x(tick.t)));
              return <text key={tick.t} x={tx} y={H - 7} textAnchor="middle" className="cdx-chart__label">{tick.label}</text>;
            })}
            <path d={path} className="cdx-chart__line" />
            {selected ? (
              <line x1={crisp(x(selected.t))} x2={crisp(x(selected.t))} y1={TOP} y2={TOP + plotH} className="cdx-chart__cross" />
            ) : null}
            <circle
              key={ping ?? "end"}
              cx={x(last.t)}
              cy={y(last.v)}
              r={4}
              className={cx("cdx-chart__dot", ping != null && "cdx-chart__dot--new")}
            />
            {selected ? <circle cx={x(selected.t)} cy={y(selected.v)} r={4} className="cdx-chart__dot" /> : null}
          </svg>
        )}
        {/* The keyboard way through the trades: one slider over the plot (role=img takes no keys in a screen
            reader's browse mode, and VoiceOver's swipe up/down adjusts a slider). Pointer input stays on the svg. */}
        {points.length ? (
          <div
            className="cdx-chart__stepper"
            role="slider"
            tabIndex={0}
            aria-label="Step through trades"
            aria-valuemin={1}
            aria-valuemax={points.length}
            aria-valuenow={(at ?? points.length - 1) + 1}
            aria-valuetext={readout}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          />
        ) : null}
        {selected ? (
          <div
            className="cdx-chart__tip"
            aria-hidden="true"
            data-side={tipLeft > plotW * 0.6 ? "left" : "right"}
            style={{ "--tip-x": `${(tipLeft / W) * 100}%` } as CSSProperties}
          >
            <b className="num">{fullFigure(selected.v)}</b>
            <span>{utcStamp(selected.t)} · {selected.side === "buy" ? "Buy" : "Sell"}</span>
          </div>
        ) : null}
      </div>
      <p className="cdx-chart__note">
        Each step is a trade · UTC{isTruncated ? ` · latest ${trades.length} trades` : ""}
        {native ? ` · in ${symbol}` : MODE_COPY.usdNote ? ` · ${MODE_COPY.usdNote}` : ""}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- activity

/**
 * Activity: the latest trades as a table (Time · Trader · amount · Market cap), newest first, in the page (it never
 * scrolls on its own), its header row sticky. Buys read "+0.30" in green and sells "−0.30" in red (the sign carries
 * it). Rows hold still under the pointer, with focus inside, or while paused; a trade that lands with a poll washes
 * in once and screen readers hear "1 new trade". It shows the latest `initial` (12) at every width, then one toggle
 * expands every loaded trade in place (focus moves to the first new row) and collapses back to the latest 12.
 */
export function TradesList({
  trades,
  count,
  initial = 12,
  pane,
  className = "",
}: {
  trades: TradeRow[];
  count: number;
  /** Rows shown before "Show all": the same at every width. */
  initial?: number;
  pane?: string;
  className?: string;
}) {
  const me = useMe();
  const all = useMemo(() => [...trades].reverse(), [trades]);
  const live = useLiveList(all, (t) => t.id, ["trade", "trades"]);
  const [open, setOpen] = useState(false);
  const rows = open ? live.shown : live.shown.slice(0, initial);
  const now = useNow();
  const total = Math.max(count, trades.length);
  const loaded = live.shown.length;
  const symbol = rows[0]?.quoteSymbol ?? trades[0]?.quoteSymbol ?? "SOL";
  const native = rows[0]?.mcapUsd == null && rows.length > 0;
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  function toggle() {
    if (open) {
      setOpen(false);
      // The list closes up above the toggle: bring the toggle back to where the pointer or focus is.
      requestAnimationFrame(() => toggleRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" }));
      return;
    }
    setOpen(true);
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-row="${initial}"]`)?.focus());
  }
  return (
    <section className={cx("cdx-trades", className)} aria-labelledby={headingId} data-pane={pane}>
      <SectionHead
        title={<span id={headingId}>Activity</span>}
        live={rows[0]?.id}
        livePaused={live.paused}
        right={
          total > 0 ? (
            <span className="cdx-trades__meta">
              <span className="text-slate">
                <span className="num">{total.toLocaleString("en-US")}</span> {total === 1 ? "trade" : "trades"}
              </span>
              <LivePause paused={live.paused} onChange={live.setPaused} />
            </span>
          ) : undefined
        }
      />
      <p className="sr-only" role="status" aria-live="polite">{live.said}</p>
      {rows.length === 0 ? (
        <p className="cdx-trades__empty">No trades yet. The first buy starts the list and the chart.</p>
      ) : (
        <div className="cdx-trades__scroll" {...live.bind}>
          <table className="cdx-trades__table">
            <caption className="sr-only">Trades, newest first{native ? `, amounts and market cap in ${symbol}` : ""}</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Trader</th>
                {/* A quote with no USD reference: both figure columns are in that quote, which can be wider than the fixed
                    columns ("CHILLHOUSE"), so the heads stay short and the line under the table names the unit. */}
                <th scope="col" className="cdx-trades__n">{native ? "Amount" : symbol}</th>
                <th scope="col" className="cdx-trades__n cdx-trades__mcap">{native ? <><span aria-hidden="true">MC</span><span className="sr-only">Market cap</span></> : "Market cap"}</th>
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {rows.map((t, i) => (
                <tr
                  key={t.id}
                  data-row={i}
                  tabIndex={open && i === initial ? -1 : undefined}
                  data-new={live.fresh.has(t.id) || undefined}
                  className="mdx-row"
                >
                  <td className="num text-slate" suppressHydrationWarning>{ago(t.createdAt, now)}</td>
                  <td><Handle handle={t.handle} bot={t.isBot} you={!!me && me.handle === t.handle} className="text-ink" /></td>
                  <td className={cx("num cdx-trades__n", t.side === "buy" ? "text-up" : "text-down")}>
                    <span className="sr-only">{t.side === "buy" ? "Buy " : "Sell "}</span>
                    {t.side === "buy" ? "+" : "−"}
                    {quoteFixed(t.quoteAmount ?? t.sol ?? 0, t.quoteAssetKey)}
                  </td>
                  <td className="num cdx-trades__n cdx-trades__mcap">
                    {t.mcapUsd == null ? quoteNumber(t.mcapQuote, true) : marketCapText(t)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* The table's caption says it to screen readers. */}
          {native ? <p className="cdx-trades__unit" aria-hidden="true">Amounts and market cap in {symbol}</p> : null}
          {loaded > initial ? (
            <div className="cdx-trades__more">
              <Button ref={toggleRef} variant="ghost" size="sm" onClick={toggle}>
                {open ? `Show latest ${initial}` : loaded >= total ? `Show all ${loaded} trades` : `Show the latest ${loaded} trades`}
              </Button>
            </div>
          ) : null}
          {(open || loaded <= initial) && total > all.length ? (
            <p className="cdx-trades__foot">Showing the latest <span className="num">{all.length}</span> of <span className="num">{total.toLocaleString("en-US")}</span> trades.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- trade ticket

type Quote = BuyQuote | SellQuote;

/** One quote row: label, dotted leader, figure (the .mdx-leaders definition list). */
function QuoteRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const EMPTY = <span className="mdx-dash">{"—"}</span>;

/** The ticket's one message slot (P1-9 step 9): generic, so wallet errors can use it on devnet. */
type TicketMessage = { kind: "error" | "warning" | "info"; text: ReactNode; plain: string };

/** The ticket's foot: what this trade is and is not, in the coin's own quote ("Test DOGE on a simulated curve."). */
const ticketNote = (symbol: string) => IS_SIM ? `Test ${symbol} on a simulated curve. Nothing is sent on chain.` : "";

/** A summary of the quote for screen readers, debounced so typing does not chatter (P1-9 step 3). */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The trade ticket's state, lifted out of the form so the phone action bar can carry the same submit: Buy | Sell,
 * the amount, the live quote (you receive, price impact, the trading fee, max slippage, market cap after), the one
 * message slot, the label and the submit path. Signed out, the submit opens the demo and then places this trade.
 * The route calls it once and hands the result to TradePanel and TradeActionBar.
 */
export function useTradeTicket(page: CoinPage) {
  const { coin, viewer } = page;
  const me = useMe();
  const require = useRequireMe();
  const { run, pending, feedback, errorOf, reset } = useAction();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("");
  // A blocked submit with nothing typed asks for an amount; typing clears it.
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // The two submits: the ticket's own (from 1024px) and the phone action bar's (below). Enter clicks the shown one.
  const inlineRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  // The bar's place in the Tab order (A11Y-5): a stop at the end of the ticket, below 1024px only (TradePanel).
  const barStopRef = useRef<HTMLSpanElement>(null);
  const formId = useId();
  const now = useNow(60_000);

  const asset = getPairAsset(coin.quoteAssetKey);
  const fmt = (atoms: number) => formatQuoteAmount(atoms, asset.key);
  const walletQuote = me?.quoteBalances?.[asset.key] ?? (asset.key === "sol" ? me?.balance ?? 0 : 0);
  const reserves = { vSol: coin.vQuote ?? coin.vSol, vTok: coin.vTok };
  const holding = viewer?.holding ?? 0;
  const amount =
    side === "buy" ? parseQuoteAmount(input || "0", asset.key) ?? NaN : Math.round(parseFloat(input || "0") * TOKEN_UNIT);
  const quote = useMemo<Quote | null>(() => {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return side === "buy" ? quoteBuy(reserves, amount) : quoteSell(reserves, amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, amount, coin.vQuote, coin.vSol, coin.vTok]);

  const afterMetrics = quote?.ok ? quoteMetrics(quote.after, asset.key) : coin;
  const impact = quote?.ok ? priceSol(quote.after) / priceSol(reserves) - 1 : 0;
  const highImpact = !!quote?.ok && Math.abs(impact) > HIGH_IMPACT;

  // What blocks the trade, in the order the ticket should say it (P1-9).
  const short = !!quote?.ok && !!me && side === "buy" && (quote as BuyQuote).solIn > walletQuote;
  let blocker: TicketMessage | null = null;
  if (quote && !quote.ok) {
    const t = `${quote.reason ?? "Enter an amount"}.`;
    blocker = { kind: "error", text: t, plain: t };
  } else if (short && me) {
    const plain = asset.key === "sol" ? notEnoughSentence(me, now) : `Not enough test ${asset.symbol}. Your balance is ${fmt(walletQuote)} ${asset.symbol}.`;
    blocker = {
      kind: "error",
      plain,
      text: me.canFaucet && asset.key === "sol" ? (
        <>
          {FLOW.notEnough}.{" "}
          <button
            type="button"
            className="mdx-link mdx-hit"
            disabled={pending === "faucet"}
            onClick={() =>
              void run(
                "faucet",
                () => claimFaucet(),
                `Faucet sent ${sol(FAUCET_AMOUNT, 0)} ${MODE_COPY.walletUnit}.`,
                { keys: [["portfolio"]] },
              )
            }
          >
            {pending === "faucet" ? "Claiming..." : FLOW.claimFaucet}
          </button>
        </>
      ) : (
        plain
      ),
    };
  } else if (quote?.ok && side === "sell" && amount > holding) {
    const t = holding > 0 ? `More than you hold (${tokens(holding)} $${coin.ticker}). Max sells all of it.` : `You hold no $${coin.ticker} yet.`;
    blocker = { kind: "error", text: t, plain: t };
  } else if (!quote && attempted) {
    blocker = { kind: "error", text: "Enter an amount.", plain: "Enter an amount." };
  }

  // The server's answer to the last try (until the amount changes), then any blocker, then the warning: one slot.
  const serverError = errorOf("trade");
  const warning = FLOW.highImpact(side, pctText(impact));
  const message: TicketMessage | null = serverError
    ? { kind: "error", text: serverError, plain: serverError }
    : blocker
      ? blocker
      : highImpact
        ? { kind: "warning", text: warning, plain: warning }
        : null;
  const invalid = message?.kind === "error";

  const summary = useDebounced(
    quote?.ok
      ? `You receive about ${
          side === "buy"
            ? `${tokens((quote as BuyQuote).tokensOut)} $${coin.ticker}`
            : `${fmt((quote as SellQuote).solOut)} ${asset.symbol}`
        }. Price impact ${pctText(impact)}. Fee ${fmt(quote.fee)} ${asset.symbol}.`
      : "",
    700,
  );

  const ready = !!me && !!quote?.ok && !blocker;

  function edit(next: string) {
    setInput(next);
    setAttempted(false);
    reset("trade");
  }

  function changeSide(s: "buy" | "sell") {
    setSide(s);
    edit("");
  }

  async function doTrade() {
    if (!quote?.ok) {
      inputRef.current?.focus();
      return;
    }
    const minOut = minOutAfterSlippage(
      side === "buy" ? (quote as BuyQuote).tokensOut : (quote as SellQuote).solOut,
    );
    const res = await run(
      "trade",
      () => tradeCoin({ data: { coinId: coin.id, side, amount, minOut, quoteAssetKey: asset.key, quoteMint: asset.mint } }),
      (r) =>
        r.side === "buy"
          ? `Bought ${tokens(r.tokens)} $${coin.ticker} for ${fmt(r.quoteNet ?? r.net ?? 0)} ${asset.symbol}.`
          : // What the wallet received, after the fee, in the quote's own format, so the toast, the quote and the
            // wallet agree (P0-8).
            `Sold ${tokens(r.tokens)} $${coin.ticker} for ${fmt(r.quoteNet ?? r.net ?? 0)} ${asset.symbol}.`,
      {
        keys: [["coin", coin.id], ["portfolio"]],
        // Holdings update immediately; the permanent card design stays unchanged.
        patch: (r, qc) =>
          qc.setQueryData<CoinPage | null>(["coin", coin.id], (old) => {
            if (!old) return old;
            return {
              ...old,
              coin: old.coin,
              viewer: old.viewer
                ? {
                    ...old.viewer,
                    holding: Math.max(0, old.viewer.holding + (r.side === "buy" ? r.tokens : -r.tokens)),
                  }
                : old.viewer,
            };
          }),
      },
    );
    if (res) {
      setInput("");
      setAttempted(false);
    }
    // The toast confirms the fill; on a failure the reason is in the slot right above the button. A fine pointer
    // goes back to the amount for the next trade; touch keeps focus on the pressed button (focusing the field
    // would raise the keyboard and scroll the page).
    if (!isCoarsePointer()) requestAnimationFrame(() => inputRef.current?.focus());
  }

  function blocked() {
    setAttempted(true);
    // No amount yet: the amount field takes focus ("Enter an amount." shows above the button). Otherwise focus moves
    // to the reason, so it is read and seen (P1-9 step 2).
    requestAnimationFrame(() => (quote ? msgRef.current : inputRef.current)?.focus());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!me) {
      const intent = quote?.ok
        ? side === "buy"
          ? `Start the demo and buy ${input} ${asset.symbol} of $${coin.ticker}`
          : `Start the demo and sell $${coin.ticker}`
        : "Start the demo";
      require(quote?.ok ? doTrade : () => inputRef.current?.focus(), "Pick a handle to trade.", intent);
      return;
    }
    if (!ready) {
      blocked();
      return;
    }
    void doTrade();
  }

  /** Enter in the amount presses the submit that is on screen (the bar's below 1024px), through its own blocked,
   * pending and signed-out handling, instead of an implicit submit through a hidden default button. */
  function onAmountKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    (isPhoneNow() ? barRef : inlineRef).current?.click();
  }

  const quick =
    side === "buy"
      ? [0.1, 0.5, 1, 5].map((v) => ({ label: String(v), aria: `${v} ${asset.symbol}`, value: String(v) }))
      : [0.25, 0.5, 0.75, 1].map((f) => {
          // 25/50/75% fill whole tokens (two decimals under one token); Max stays exact so it sells everything.
          const part = (holding * f) / TOKEN_UNIT;
          return {
            label: f === 1 ? "Max" : `${f * 100}%`,
            aria: f === 1 ? "All you hold" : `${f * 100}% of what you hold`,
            value:
              holding <= 0
                ? ""
                : f === 1
                  ? String(holding / TOKEN_UNIT)
                  : String(part >= 1 ? Math.floor(part) : Math.floor(part * 100) / 100),
          };
        });

  // A stable label (P1-9 step 2): the reason lives in the message slot, never in the button.
  const label = !me ? FLOW.enterToTrade : `${side === "buy" ? "Buy" : "Sell"} $${coin.ticker}`;
  const suffix = side === "buy" ? asset.symbol : `$${coin.ticker}`;
  // The phone bar's one line: what this trade spends, once there is an amount.
  const spend = quote?.ok
    ? side === "buy"
      ? `You pay ${input} ${asset.symbol}`
      : `You sell ${tokens(amount)} $${coin.ticker}`
    : null;
  // The primary stays cream and enabled (Launch's rule): a press with no amount, or one that cannot fill, says why in
  // the ticket's message slot instead of greying the screen's one action out.
  const submitProps = {
    type: "submit" as const,
    form: formId,
    disabled: false,
    pending: pending === "trade",
    pendingLabel: "Filling...",
    feedback: feedback("trade"),
    successLabel: side === "buy" ? "Bought" : "Sold",
    onBlocked: blocked,
  };

  // Tab from the ticket's last control lands on the bar's button (always on screen, so no scroll); Tab or Shift+Tab
  // from there carries on from the stop, so the order reads amount, Buy, then the chart (A11Y-5).
  const toBar = () => barRef.current?.focus({ preventScroll: true });
  const onBarKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const stop = barStopRef.current;
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey || !stop?.isConnected || !stop.getClientRects().length) return;
    const next = tabbableBeside(stop, e.shiftKey ? -1 : 1, barRef.current);
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  return {
    coin,
    me,
    asset,
    fmt,
    side,
    changeSide,
    input,
    edit,
    quote,
    afterMetrics,
    impact,
    highImpact,
    message,
    invalid,
    summary,
    walletQuote,
    holding,
    quick,
    label,
    suffix,
    spend,
    submit,
    submitProps,
    onAmountKey,
    formId,
    formRef,
    inputRef,
    msgRef,
    inlineRef,
    barRef,
    barStopRef,
    toBar,
    onBarKey,
  };
}

const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
/** The next (dir 1) or previous (dir -1) element Tab would reach from `from`, skipping `skip` (the bar's button). */
function tabbableBeside(from: HTMLElement, dir: 1 | -1, skip: HTMLElement | null): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el === from || (
    el !== skip && el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[inert]") && el.getClientRects().length > 0
  ));
  const at = all.indexOf(from);
  return at < 0 ? null : all[at + dir] ?? null;
}

export type TradeTicket = ReturnType<typeof useTradeTicket>;

/**
 * The trade ticket: Buy | Sell, the amount with its unit, quick amounts (0.1 / 0.5 / 1 / 5, or 25% / 50% / 75% /
 * Max of what you hold), the live quote, one message line and the submit. Below 1024px the submit is the phone
 * action bar's (TradeActionBar), so this one is hidden there (CSS). `hideQuick`, `hideAfter` and `compact` are kept
 * for older callers and no longer change the ticket.
 */
export function TradePanel({
  page,
  ticket,
  pane,
  className = "",
}: {
  page: CoinPage;
  ticket: TradeTicket;
  hideQuick?: boolean;
  hideAfter?: boolean;
  compact?: boolean;
  pane?: string;
  className?: string;
}) {
  const { coin } = page;
  const t = ticket;
  const { me, asset, side, quote } = t;
  const headingId = useId();
  // Phones: the button stays above the on-screen keyboard while the amount has focus (P1-5).
  useKeyboardSafe(t.formRef);

  return (
    <form
      ref={t.formRef}
      id={t.formId}
      onSubmit={t.submit}
      className={cx("cdx-trade-ticket", className)}
      aria-labelledby={headingId}
      data-pane={pane}
      noValidate
    >
      <h2 id={headingId} className="sr-only">Trade ${coin.ticker}</h2>
      <SideToggle side={side} onChange={t.changeSide} />

      {/* The input is named by its visible label and unit ("You pay SOL", "You sell $GLORB") and described by the
          balance beside the label and the message slot, by id, so the placeholder never stands in. */}
      <Field
        className="cdx-trade-ticket__field"
        label={<span id="trade-amt-label">{side === "buy" ? "You pay" : "You sell"}</span>}
        htmlFor="trade-amt"
        right={
          <span id="trade-amt-balance">
            {/* Signed out there is no wallet yet: the button below is the one way in (coin-26), so no balance. */}
            {!me ? null : side === "buy" ? (
              <>Test balance <span className="num text-ink">{quoteFixed(t.walletQuote, asset.key)}</span> {asset.symbol}</>
            ) : (
              <>Held <span className="num text-ink">{tokens(t.holding)}</span></>
            )}
          </span>
        }
      >
        <div className="relative">
          <input
            ref={t.inputRef}
            id="trade-amt"
            // Where focus lands when a ticket control leaves with its action (quick chips that hide): focusNear.
            data-focus-home
            aria-labelledby="trade-amt-label trade-amt-unit"
            aria-describedby="trade-amt-balance trade-msg"
            aria-invalid={t.invalid || undefined}
            inputMode="decimal"
            enterKeyHint="go"
            autoComplete="off"
            value={t.input}
            onChange={(e) => t.edit(cleanAmount(e.target.value, side === "buy" ? asset.decimals : 6))}
            onKeyDown={t.onAmountKey}
            placeholder="0.00"
            className="mdx-input num cdx-trade-ticket__input"
            style={{ paddingRight: t.suffix.length > 4 ? 104 : 64 }}
          />
          <span id="trade-amt-unit" className="cdx-trade-ticket__unit">
            {t.suffix}
          </span>
        </div>
      </Field>

      <div className="cdx-trade-ticket__quick" role="group" aria-label="Quick amounts">
        {t.quick.map((q) => (
          <Button
            key={q.label}
            variant="chip"
            size="sm"
            className="num"
            disabled={!q.value}
            aria-label={q.aria}
            onClick={() => t.edit(q.value)}
          >
            {q.label}
          </Button>
        ))}
      </div>

      <dl className="mdx-leaders cdx-trade-ticket__quote">
        <QuoteRow label="You receive (est.)">
          {quote?.ok ? (
            side === "buy" ? (
              <Num size="sm" unit={`$${coin.ticker}`}>{tokens((quote as BuyQuote).tokensOut)}</Num>
            ) : (
              <Num size="sm" unit={asset.symbol}>{t.fmt((quote as SellQuote).solOut)}</Num>
            )
          ) : (
            EMPTY
          )}
        </QuoteRow>
        <QuoteRow label="Price impact">
          {quote?.ok ? (
            // A size, never signed: a sell moves the price down, but the impact reads the same way.
            <span className={cx("num text-body", t.highImpact ? "text-down" : "text-ink")}>{pctText(t.impact)}</span>
          ) : (
            EMPTY
          )}
        </QuoteRow>
        {TRADE_FEE_LINES.map((line) => (
          <QuoteRow key={line.key} label={`Trading fee ${pct(line.bps)}`}>
            {quote?.ok ? (
              <Num size="sm" unit={asset.symbol}>{t.fmt(Math.round((quote.fee * line.bps) / TRADE_FEE_BPS))}</Num>
            ) : (
              EMPTY
            )}
          </QuoteRow>
        ))}
        <QuoteRow label="Max slippage">
          <span className="num text-body text-ink">{pct(MAX_SLIPPAGE_BPS)}</span>
        </QuoteRow>
        <QuoteRow label="Market cap after">
          {quote?.ok ? <Num size="sm">{marketCapText({ ...t.afterMetrics, quoteAssetKey: asset.key })}</Num> : EMPTY}
        </QuoteRow>
      </dl>
      <p className="sr-only" role="status">{t.summary}</p>

      {/* The one message slot (P1-9): errors (alert) and the impact warning. Empty, it takes no room. */}
      <div id="trade-msg" ref={t.msgRef} tabIndex={-1} className="cdx-trade-ticket__msg">
        {t.message ? (
          <p role={t.message.kind === "error" ? "alert" : "status"} data-kind={t.message.kind}>
            {t.message.kind === "warning" ? <Icon name="warning" /> : null}
            <span>{t.message.text}</span>
          </p>
        ) : null}
      </div>

      <Button ref={t.inlineRef} {...t.submitProps} block className="cdx-trade-ticket__submit">
        {t.label}
      </Button>
      {/* Below 1024px the submit is the action bar's, the view root's last child so that it sticks for the whole page.
          This stop keeps its place in the Tab order: focus passes straight on to the bar's button (A11Y-5). */}
      <span ref={t.barStopRef} role="button" tabIndex={0} aria-label={`Go to ${t.label}`} className="cdx-trade-ticket__bar-stop" onFocus={t.toBar} onClick={t.toBar} />
      {IS_SIM ? <p className="cdx-trade-ticket__note">{ticketNote(asset.symbol)}</p> : null}
    </form>
  );
}

/**
 * The phone and tablet action bar (density R7): the ticket's submit, kept on screen while the page scrolls, with
 * one line of what the trade spends once there is an amount. It submits the ticket's form by id, so blocked,
 * pending and signed-out behave exactly like the ticket's own button. From 1024px it is hidden (the ticket shows
 * its submit). The route renders it as the view root's last child.
 */
export function TradeActionBar({ ticket }: { ticket: TradeTicket }) {
  const t = ticket;
  return (
    <ActionBar phoneOnly label={`Buy or sell $${t.coin.ticker}`} className="cdx-trade-bar">
      <p className="cdx-trade-bar__spend num">{t.spend}</p>
      {/* Out of the natural Tab order: the ticket's stop (TradePanel) leads here, and Tab from here goes on from it. */}
      <Button ref={t.barRef} {...t.submitProps} tabIndex={-1} onKeyDown={t.onBarKey} className="cdx-trade-bar__submit">
        {t.label}
      </Button>
    </ActionBar>
  );
}

// ---------------------------------------------------------------- back to the list

/**
 * Phones and tablets: "‹ Discover" before the title. When the page was opened from Discover in this tab, it goes
 * back in history (Discover keeps its search and place); otherwise it is a plain link. `compact` is the 44px
 * chevron alone on the title's row (its name, "Back to Discover", for screen readers).
 */
export function BackToDiscover({ compact = false }: { compact?: boolean } = {}) {
  return (
    <Link
      to="/discover"
      className={cx("mdx-link mdx-hit cdx-coin-back", compact && "cdx-coin-back--compact")}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        const nav = (window as unknown as { navigation?: { currentEntry?: { index: number }; entries?: () => Array<{ url: string | null }> } }).navigation;
        const index = nav?.currentEntry?.index ?? -1;
        const previous = index > 0 ? nav?.entries?.()[index - 1]?.url : null;
        if (previous && new URL(previous).pathname === "/discover") {
          e.preventDefault();
          window.history.back();
        }
      }}
    >
      <Icon name="chevron-left" />
      {compact ? <span className="sr-only">Back to Discover</span> : "Discover"}
    </Link>
  );
}

// ---------------------------------------------------------------- description

export function LoreEditor({
  coinId,
  lore,
  onDone,
}: {
  coinId: string;
  lore: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(lore);
  const { run, pending } = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(
          "lore",
          () => updateLore({ data: { coinId, lore: text } }),
          "Description updated.",
          { keys: [["coin", coinId]] },
        );
        if (r) onDone();
      }}
      className="flex flex-col"
    >
      <Field label="Description" htmlFor="lore">
        <textarea
          id="lore"
          rows={4}
          maxLength={280}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mdx-input"
        />
      </Field>
      <span className="num mt-1.5 self-end text-caption text-slate">{text.length}/280</span>
      <div className="mdx-sheet-foot mt-4 flex justify-end">
        <Button type="submit" pending={pending === "lore"} pendingLabel="Saving..." className="max-lg:w-full">
          Save description
        </Button>
      </div>
    </form>
  );
}
