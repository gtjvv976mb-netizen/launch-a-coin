/**
 * Coin page pieces (/coin/$id): the market strip (market cap, price, 24h volume, holders and the bonding curve),
 * the market-cap chart, the trade ticket, the activity table, the card's facts and the coin's details.
 * Layout lives in routes/coin/$id.tsx and styles/screens/coin.css: from 1024px everything shows at once (card |
 * market and chart and activity | ticket and details); 768 to 1023 keeps the card beside one tabbed pane; phones
 * show one ?tab= section at a time.
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
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";

import {
  claimFaucet,
  reportCoin,
  tradeCoin,
  updateLore,
} from "../../lib/mintdex/api";
import { FAUCET_AMOUNT, TOKEN_UNIT, TRADE_FEE_BPS } from "../../lib/mintdex/constants";
import {
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
import { marketCapText, marketCapWatch, quoteNumber } from "../../lib/carddex/quote-display";
import { formatQuoteAmount, parseQuoteAmount, quoteMetrics } from "../../lib/carddex/quote-simulation";
import type { CoinDetail, CoinPage, TradeRow } from "../../lib/mintdex/types";
import { CardBack, CardCase, View3DButton, useView3DGestures, type Card3DHandle } from "./card3d";
import { useClaimable } from "./cases";
import { prefersReducedMotion, useAction, useLoaderViewport, useNow } from "./hooks";
import { useMe, useRequireMe } from "./session";
import { useKeyboardSafe } from "./sheet";
import {
  BotTag,
  ShareButton,
  SimTag,
  coinShare,
} from "./trust";
import {
  Address,
  Badge,
  Button,
  Change,
  CurveTrack,
  Field,
  FrameMini,
  Icon,
  KpiGroup,
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

// ---------------------------------------------------------------- layout band

/** The coin page's three arrangements: phone tabs (under 768), the card beside one tabbed pane, everything (1024+). */
export type CoinBand = "phone" | "tablet" | "wide";

function bandOf(width: number): CoinBand {
  return width >= 1024 ? "wide" : width >= 768 ? "tablet" : "phone";
}

/**
 * Which arrangement the window is in. The first frame uses the root loader's viewport (the same value on the
 * server and the hydrating client, so no mismatch); the media queries take over after mount. Layout itself is
 * CSS: this only decides the tab options and where the tab panel role goes.
 */
export function useCoinBand(): CoinBand {
  const vp = useLoaderViewport();
  const [band, setBand] = useState<CoinBand>(() => (vp ? bandOf(vp.w) : "wide"));
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const tablet = window.matchMedia("(min-width: 768px)");
    const sync = () => setBand(wide.matches ? "wide" : tablet.matches ? "tablet" : "phone");
    sync();
    wide.addEventListener("change", sync);
    tablet.addEventListener("change", sync);
    return () => {
      wide.removeEventListener("change", sync);
      tablet.removeEventListener("change", sync);
    };
  }, []);
  return band;
}

// ---------------------------------------------------------------- formatting

/** "2m ago" becomes "2m" in dense tables. */
function ago(ms: number, now?: number) {
  return timeAgo(ms, now).replace(/ ago$/, "");
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * An amount in a quote asset for balances and table columns: two fixed decimals so the points line up ("0.30",
 * "122.78"), "<0.01" for dust, compact from 10K ("12.4K"). A real zero is "0.00". Takes the quote's atoms.
 */
export function quoteFixed(atoms: number | string, key?: string | null): string {
  const value = Number(atoms) / 10 ** getPairAsset(key).decimals;
  if (!Number.isFinite(value)) return "—";
  const size = Math.abs(value);
  if (size === 0) return "0.00";
  if (size < 0.01) return "<0.01";
  if (size >= 10_000) return COMPACT.format(size);
  return size.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

/** A handle, then the "bot" tag for a demo bot and "you" for the viewer. Truncates the handle, never the tags. */
function Handle({ handle, bot, you, className = "" }: { handle: string; bot?: boolean; you?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <span className="truncate">{atName(handle)}</span>
      {bot ? <BotTag /> : null}
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

/** The coin's figures, as type in one divided container: the market cap leads (30px) with its 24h change. */
function marketItems(coin: CoinDetail, lead: boolean): StatItem[] {
  const native = coin.mcapUsd == null;
  const items: StatItem[] = [
    {
      label: "Price",
      value: <PriceFigure value={coin.priceQuote ?? coin.priceSol ?? 0} />,
      unit: coin.quoteSymbol,
    },
    { label: "Volume 24h", value: quoteFixed(coin.volume24hQuote, coin.quoteAssetKey), unit: coin.quoteSymbol },
    { label: "Holders", value: coin.holders.toLocaleString("en-US") },
  ];
  if (!lead) return items;
  return [
    {
      label: "Market cap",
      value: native ? quoteNumber(coin.mcapQuote, true) : marketCapText(coin, false),
      unit: native ? coin.quoteSymbol : undefined,
      watch: marketCapWatch(coin),
      change: (
        <span className="cdx-coin-screen__chg">
          <Change v={coin.change24h} pill />
          <span aria-hidden="true">24h</span>
        </span>
      ),
    },
    ...items,
  ];
}

/**
 * The market strip under the title: market cap (the page's one lead figure), price, 24h volume, holders and the
 * bonding curve, in one surface split by hairlines. Phones keep the market cap and the curve here; the other
 * three move into the Chart section (CoinFigures).
 */
export function CoinMarket({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  return (
    <section className={cx("cdx-coin-screen__market", className)} aria-label={`${coin.name} market`}>
      <KpiGroup items={marketItems(coin, true)} lead />
      {/* The curve cell reads like its neighbours (label, figure, note) over the gold track; the track's own
          progressbar carries the same words for screen readers, so the visible copy is hidden from them. */}
      <div className="cdx-coin-screen__curve">
        <p className="mdx-kpi__label" aria-hidden="true">Bonding curve</p>
        <p className="mdx-kpi__value" aria-hidden="true">
          {coin.graduated ? (
            <span className="num">Graduated</span>
          ) : Number.isFinite(coin.curveProgress) ? (
            <>
              <span className="num">{Math.round(Math.min(1, Math.max(0, coin.curveProgress)) * 100)}%</span>
              <span className="cdx-coin-screen__curvenote">to graduation</span>
            </>
          ) : (
            <span className="mdx-dash">{"—"}</span>
          )}
        </p>
        <CurveTrack progress={coin.curveProgress} graduated={coin.graduated} />
      </div>
    </section>
  );
}

/** Phones: price, 24h volume and holders at the top of the Chart section. */
export function CoinFigures({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  return <KpiGroup items={marketItems(coin, false)} className={cx("cdx-coin-screen__figures", className)} />;
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
 * About the coin: its description, the facts people look up (pair, quote asset, address, quote mint), what the
 * bonding curve means, the coin's own links and the owner's Edit description (or Report for everyone else).
 */
export function CoinAbout({
  page,
  onEdit,
  className = "",
}: {
  page: CoinPage;
  onEdit: () => void;
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
      <p className={cx("cdx-coin-about__lore", !coin.lore && "text-slate")}>
        {coin.lore || "The creator has not added a description."}
      </p>
      <dl className="cdx-coin-facts">
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
              className="mdx-link mdx-hit"
              href={`https://solscan.io/token/${asset.mint}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${asset.symbol} quote mint on Solscan (opens in a new tab)`}
            >
              <span className="num">{asset.mint.slice(0, 4)}…{asset.mint.slice(-4)}</span> <Icon name="external" size={12} />
            </a>
          </dd>
        </div>
      </dl>
      <div className="cdx-coin-about__addr">
        {/* In test mode the address is a test key that was never deployed (decision C6): the row says so. */}
        {coin.mintAddress ? <Address address={coin.mintAddress} row label /> : <p className="text-body text-slate">No on-chain address in the demo.</p>}
      </div>
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
  const vp = useLoaderViewport();
  const [ref, size] = useSize<HTMLDivElement>(
    vp && vp.w < 1024 ? { width: Math.max(240, vp.w - 64), height: 200 } : { width: 480, height: 260 },
  );
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
  function onKey(event: React.KeyboardEvent<SVGSVGElement>) {
    if (!points.length || !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? points.length - 1
      : at == null ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, at + (event.key === "ArrowLeft" ? -1 : 1)));
    setActive(next);
  }

  const readout = selected
    ? `${fullFigure(selected.v)} after a ${selected.side} on ${utcStamp(selected.t)}.`
    : "";
  const summary = last
    ? `Market cap after each trade ${def.key === "all" ? "since launch" : def.words.replace(/^in /, "over ")}: ${points.length} ${points.length === 1 ? "trade" : "trades"}, latest ${fullFigure(last.v)}. Left and right arrow keys step through the trades.`
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
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            tabIndex={0}
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
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{readout}</span>
    </section>
  );
}

// ---------------------------------------------------------------- activity

/** How many trades the list shows at first and adds with each "Show older trades". */
const TRADE_BATCH = 40;

/**
 * Activity: the latest trades as a table (Time · Trader · amount · Market cap), newest first, in a pane that
 * scrolls with a sticky header row. Buys read "+0.30" in green and sells "−0.30" in red (the sign carries it).
 * Rows hold still under the pointer, with focus inside, or while paused; a trade that lands with a poll washes in
 * once and screen readers hear "1 new trade". "Show older trades" adds the next 40 and moves focus to the first.
 */
export function TradesList({
  trades,
  count,
  pane,
  className = "",
}: {
  trades: TradeRow[];
  count: number;
  pane?: string;
  className?: string;
}) {
  const me = useMe();
  const all = useMemo(() => [...trades].reverse(), [trades]);
  const live = useLiveList(all, (t) => t.id, ["trade", "trades"]);
  const [limit, setLimit] = useState(TRADE_BATCH);
  const rows = live.shown.slice(0, limit);
  const now = useNow();
  const total = Math.max(count, trades.length);
  const symbol = rows[0]?.quoteSymbol ?? trades[0]?.quoteSymbol ?? "SOL";
  const native = rows[0]?.mcapUsd == null && rows.length > 0;
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const headingId = useId();
  function more() {
    const first = limit;
    setLimit((n) => n + TRADE_BATCH);
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-row="${first}"]`)?.focus());
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
              <Button
                variant="ghost"
                size="sm"
                aria-label={live.paused ? "Resume live updates" : "Pause live updates"}
                onClick={() => live.setPaused(!live.paused)}
              >
                <Icon name={live.paused ? "play" : "pause"} />
                {live.paused ? "Resume" : "Pause"}
              </Button>
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
                <th scope="col" className="cdx-trades__n">{symbol}</th>
                <th scope="col" className="cdx-trades__n cdx-trades__mcap">Market cap</th>
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {rows.map((t, i) => (
                <tr
                  key={t.id}
                  data-row={i}
                  tabIndex={i === limit - TRADE_BATCH && i > 0 ? -1 : undefined}
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
          {rows.length < live.shown.length ? (
            <div className="cdx-trades__more">
              <Button variant="outline" onClick={more}>Show older trades</Button>
            </div>
          ) : total > all.length ? (
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

/** The ticket's foot: what this trade is and is not. */
const TICKET_NOTE = IS_SIM ? "Test SOL on a simulated curve. Nothing is sent on chain." : "";

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
 * The trade ticket: Buy | Sell, the amount with its unit, quick amounts (0.1 / 0.5 / 1 / 5, or 25% / 50% / 75% /
 * Max of what you hold), the live quote (you receive, price impact, the trading fee, max slippage, market cap
 * after), one message line and one primary button. Signed out, the button opens the demo and then places this
 * trade. `hideQuick`, `hideAfter` and `compact` are kept for older callers and no longer change the ticket.
 */
export function TradePanel({
  page,
  pane,
  className = "",
}: {
  page: CoinPage;
  hideQuick?: boolean;
  hideAfter?: boolean;
  compact?: boolean;
  pane?: string;
  className?: string;
}) {
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
  const headingId = useId();
  // Phones: the button stays above the on-screen keyboard while the amount has focus (P1-5).
  useKeyboardSafe(formRef);
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
    // The toast confirms the fill; on a failure the reason is in the slot right above the button.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function blocked() {
    setAttempted(true);
    // Move focus to the reason, so it is read and seen (P1-9 step 2).
    requestAnimationFrame(() => msgRef.current?.focus());
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

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className={cx("cdx-trade-ticket", className)}
      aria-labelledby={headingId}
      data-pane={pane}
      noValidate
    >
      <h2 id={headingId} className="sr-only">Trade ${coin.ticker}</h2>
      <SideToggle
        side={side}
        onChange={(s) => {
          setSide(s);
          edit("");
        }}
      />

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
              <>Test balance <span className="num text-ink">{quoteFixed(walletQuote, asset.key)}</span> {asset.symbol}</>
            ) : (
              <>Held <span className="num text-ink">{tokens(holding)}</span></>
            )}
          </span>
        }
      >
        <div className="relative">
          <input
            ref={inputRef}
            id="trade-amt"
            // Where focus lands when a ticket control leaves with its action (quick chips that hide): focusNear.
            data-focus-home
            aria-labelledby="trade-amt-label trade-amt-unit"
            aria-describedby="trade-amt-balance trade-msg"
            aria-invalid={invalid || undefined}
            inputMode="decimal"
            enterKeyHint="go"
            autoComplete="off"
            value={input}
            onChange={(e) => edit(cleanAmount(e.target.value, side === "buy" ? asset.decimals : 6))}
            placeholder="0.00"
            className="mdx-input num cdx-trade-ticket__input"
            style={{ paddingRight: suffix.length > 4 ? 104 : 64 }}
          />
          <span id="trade-amt-unit" className="cdx-trade-ticket__unit">
            {suffix}
          </span>
        </div>
      </Field>

      <div className="cdx-trade-ticket__quick" role="group" aria-label="Quick amounts">
        {quick.map((q) => (
          <Button
            key={q.label}
            variant="chip"
            size="sm"
            className="num"
            disabled={!q.value}
            aria-label={q.aria}
            onClick={() => edit(q.value)}
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
              <Num size="sm" unit={asset.symbol}>{fmt((quote as SellQuote).solOut)}</Num>
            )
          ) : (
            EMPTY
          )}
        </QuoteRow>
        <QuoteRow label="Price impact">
          {quote?.ok ? (
            // A size, never signed: a sell moves the price down, but the impact reads the same way.
            <span className={cx("num text-body", highImpact ? "text-down" : "text-ink")}>{pctText(impact)}</span>
          ) : (
            EMPTY
          )}
        </QuoteRow>
        {TRADE_FEE_LINES.map((line) => (
          <QuoteRow key={line.key} label={`Trading fee ${pct(line.bps)}`}>
            {quote?.ok ? (
              <Num size="sm" unit={asset.symbol}>{fmt(Math.round((quote.fee * line.bps) / TRADE_FEE_BPS))}</Num>
            ) : (
              EMPTY
            )}
          </QuoteRow>
        ))}
        <QuoteRow label="Max slippage">
          <span className="num text-body text-ink">{pct(MAX_SLIPPAGE_BPS)}</span>
        </QuoteRow>
        <QuoteRow label="Market cap after">
          {quote?.ok ? <Num size="sm">{marketCapText({ ...afterMetrics, quoteAssetKey: asset.key })}</Num> : EMPTY}
        </QuoteRow>
      </dl>
      <p className="sr-only" role="status">{summary}</p>

      {/* The one message slot (P1-9): errors (alert) and the impact warning. Empty, it takes no room. */}
      <div id="trade-msg" ref={msgRef} tabIndex={-1} className="cdx-trade-ticket__msg">
        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} data-kind={message.kind}>
            {message.kind === "warning" ? <Icon name="warning" /> : null}
            <span>{message.text}</span>
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        block
        disabled={!!me && !ready}
        pending={pending === "trade"}
        pendingLabel="Filling..."
        feedback={feedback("trade")}
        successLabel={side === "buy" ? "Bought" : "Sold"}
        onBlocked={blocked}
      >
        {label}
      </Button>
      {TICKET_NOTE ? <p className="cdx-trade-ticket__note">{TICKET_NOTE}</p> : null}
    </form>
  );
}

// ---------------------------------------------------------------- back to the list

/**
 * Phones and tablets: "‹ Discover" above the title. When the page was opened from Discover in this tab, it goes
 * back in history (Discover keeps its search and place); otherwise it is a plain link.
 */
export function BackToDiscover() {
  return (
    <Link
      to="/discover"
      className="mdx-link mdx-hit cdx-coin-back"
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
      Discover
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
