/**
 * Coin page pieces (spec 8.3): the object column caption, the market column (stats, chart, trades)
 * and the action column (token Buy | Sell ticket, then creator-card ownership).
 * Layout lives in routes/coin/$id.tsx; every block here carries its own mobile plinth so the route
 * can reorder blocks on phones with `display: contents` wrappers.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";

import {
  claimFaucet,
  reportCoin,
  tradeCoin,
  updateLore,
} from "../../lib/mintdex/api";
import { FAUCET_AMOUNT, TOKEN_UNIT, TRADE_FEE_BPS } from "../../lib/mintdex/constants";
import {
  FLOW,
  MODE_COPY,
  REPORT_REASONS,
  WORDS,
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
  priceText,
  sol,
  timeAgo,
  tokens,
  usdCompact,
} from "../../lib/mintdex/format";
import { getCardDesign } from "../../lib/carddex/designs";
import { getPairAsset } from "../../lib/carddex/pairs";
import { marketCapText, marketCapWatch, quoteAtoms, quoteNumber } from "../../lib/carddex/quote-display";
import { formatQuoteAmount, parseQuoteAmount, quoteMetrics } from "../../lib/carddex/quote-simulation";
import { aggregateCandles, candleInterval, candleIntervalLabel } from "../../lib/carddex/candles";
import "../../carddex-chart.css";
import { PageControls, usePageCapacity } from "../carddex/Viewport";
import type { CoinDetail, CoinPage, TradeRow } from "../../lib/mintdex/types";
import { CardBack, CardCase, View3DButton, useView3DGestures, type Card3DHandle } from "./card3d";
import { useClaimable } from "./cases";
import { MintCard } from "./MintCard";
import { prefersReducedMotion, useAction, useLoaderViewport, useNow } from "./hooks";
import { useMe, useRequireMe, useSessionUi } from "./session";
import { useKeyboardSafe } from "./sheet";
import {
  BotTag,
  ShareButton,
  coinShare,
} from "./trust";
import {
  Address,
  Button,
  Change,
  Field,
  FitList,
  FrameMini,
  LivePause,
  Modal,
  Num,
  SectionHead,
  SideToggle,
  Tabs,
  TextLink,
  useLiveList,
  useSize,
} from "./ui";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- formatting

/** "0.000000478": SOL per coin without trailing zeros. */
function priceSolText(p: number) {
  const t = priceText(p);
  return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
}

/** "2m ago" becomes "2m" in dense tables. */
function ago(ms: number, now?: number) {
  return timeAgo(ms, now).replace(/ ago$/, "");
}

/** A handle, then the "bot" tag when it belongs to a demo bot (backlog P0-6). Truncates the handle, never the tag. */
function Handle({ handle, bot, className = "" }: { handle: string; bot?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <span className="truncate">{atName(handle)}</span>
      {bot ? <BotTag /> : null}
    </span>
  );
}

// ---------------------------------------------------------------- header and stats (middle column)

/**
 * Width of the hero figure in em: Instrument Sans at width 85 sets tabular figures at 0.538em, the
 * comma and period at 0.239em and the dollar sign at 0.498em, less the hero's -0.01em tracking.
 */
function heroEm(text: string) {
  let em = 0;
  for (const ch of text) em += ch === "," || ch === "." ? 0.239 : ch === "$" ? 0.498 : 0.538;
  return em - 0.01 * text.length;
}

/*
 * In the three-column layout the header row is one 56px line, and at 1280 the middle column is only
 * about 400px wide. The hero yields first: it never takes more than the header width less a reserve
 * for the title block, the two 20px gaps and the 24h change pill (256px under a 460px header, where the
 * tier tag drops the word "design", else 296px), and never drops under 30px.
 */
const HERO_FIT =
  "xl:text-[length:min(clamp(32px,5.6vh,44px),max(30px,calc((100cqw_-_var(--hero-reserve))_/_var(--hero-em))))]!";

/** Header row of the middle column: name, ticker and design | market cap hero and 24h change. */
export function CoinHeader({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  const design = getCardDesign(coin.cardTemplate);
  const hero = coin.mcapUsd == null ? quoteNumber(coin.mcapQuote, true) : marketCapText(coin, false);
  return (
    <header
      className={cx(
        "@container flex flex-wrap items-end justify-between gap-x-5 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0 xl:flex-1">
        {/* Share (P1-12) follows the name: the 28px circle sits inside the title's line box, so nothing moves,
            and a long name truncates before it. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="mdx-h1 -mb-1 min-w-0 truncate pb-1">{coin.name}</h1>
          <ShareButton {...coinShare(coin)} label={`Share ${coin.name}`} />
        </div>
        {/* One line, always: the tier name gives way (ellipsis) before the row could wrap. 19px tall like every
            other header context line (the 17px frame mini centers in it), so the h1 sits at the same y as theirs. */}
        <div className="mt-1 flex h-[19px] min-w-0 items-center gap-3 whitespace-nowrap text-[13px] leading-[17px] text-slate">
          <span className="flex-none">${coin.ticker}</span>
          <span className="hidden min-w-0 items-center gap-1.5 font-medium text-ink lg:inline-flex">
            <FrameMini level={coin.level} />
            <span className="min-w-0 truncate">
              {design.name}
            </span>
          </span>
        </div>
      </div>
      <div className="flex flex-none items-end gap-5">
        <div
          className="flex flex-col items-start [--hero-reserve:296px] @max-[460px]:[--hero-reserve:256px]"
          style={{ "--hero-em": heroEm(hero).toFixed(3) } as CSSProperties}
        >
          <Num size="hero" unit={coin.mcapUsd == null ? coin.quoteSymbol : undefined} watch={marketCapWatch(coin)} odo className={HERO_FIT}>
            {hero}
          </Num>
          <span className="mt-0.5 text-[12px] font-medium leading-none text-slate">Market cap</span>
        </div>
        <div className="flex flex-col items-start pb-px">
          <Change v={coin.change24h} pill className="text-[13px]" />
          <span className="mt-1 text-[12px] font-medium leading-none text-slate">24h</span>
        </div>
      </div>
    </header>
  );
}

/** Price, volume, holders and card fees (all time). Four up when the column is wide enough, else two up. */
export function CoinStats({
  coin,
  pane,
  className = "",
}: {
  coin: CoinDetail;
  /** Phones: the coin page section this block belongs to (data-pane, P1-5). */
  pane?: string;
  className?: string;
}) {
  const items: Array<{
    key: string;
    label: ReactNode;
    value: string;
    unit?: string;
    watch?: number;
    tick?: boolean;
  }> = [
    { key: "price", label: `Price (${coin.quoteSymbol ?? "SOL"})`, value: priceSolText(coin.priceQuote ?? coin.priceSol ?? 0), watch: coin.priceQuote ?? coin.priceSol ?? 0, tick: true },
    { key: "volume", label: "Volume", value: quoteAtoms(coin.volumeQuote ?? coin.volume ?? 0, coin.quoteAssetKey, true), unit: coin.quoteSymbol ?? "SOL" },
    { key: "holders", label: "Holders", value: coin.holders.toLocaleString("en-US") },
    { key: "trades", label: "Token trades", value: coin.trades.toLocaleString("en-US") },
  ];
  return (
    <div className={cx("@container", className)} data-pane={pane}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @min-[360px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] @min-[360px]:gap-y-0">
        {items.map((it) => (
          <div key={it.key} className="min-w-0">
            <dt className="mdx-micro truncate">{it.label}</dt>
            <dd className="mt-1 truncate">
              {/* The price rolls digit by digit (M19); the rest keep their flash. */}
              <Num size="md" unit={it.unit} watch={it.watch} odo={it.tick}>
                {it.value}
              </Num>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- object column caption

/**
 * "No. 004  Launched by @handle" (plus the "bot" tag for a demo bot launcher) over the tier chip
 * "Nova design, 3 of 14" (on the design's tint).
 */
export function CaptionTop({
  coin,
  chip = true,
  chipTitle,
  className = "",
}: {
  coin: CoinDetail;
  /** The design chip under the line (off where the same chip is right above, the phone hero). */
  chip?: boolean;
  /** A hover note on the design chip (devnet: what a design means). */
  chipTitle?: string;
  className?: string;
}) {
  const design = getCardDesign(coin.cardTemplate);
  return (
    <div className={cx("min-w-0", className)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="mdx-plate flex-none text-[15px] leading-[1.3] text-slate">
          {dexNo(coin.dexNo)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[1.45] text-slate">
          <span className="truncate">Launched by {atName(coin.creatorHandle)}</span>
          {coin.creatorIsBot ? <BotTag /> : null}
        </span>
      </div>
      {chip ? (
        <p className="mt-3 inline-flex rounded-chip border border-hairline bg-sheet px-2.5 py-1.5 text-[12px] font-medium text-ink" title={chipTitle}>
          {design.name}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Phones (P1-5): the compact hero above the section tabs. A 112px card in its tray (tap it for the Card
 * section) beside the name, Share, ticker, market cap and 24h change, and the design chip ("Nova design, 3 of
 * 14"). The address row is in the Card section.
 */
export function CoinPhoneHero({
  coin,
  onCard,
  ref,
  className = "",
}: {
  coin: CoinDetail;
  onCard: () => void;
  ref?: Ref<HTMLElement>;
  className?: string;
}) {
  return (
    <section ref={ref} aria-label={`${coin.name} at a glance`} className={cx("grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4", className)}>
      <button
        type="button"
        onClick={onCard}
        aria-label={`Show the ${coin.name} card`}
        className="mdx-pocket block w-[112px] rounded-[5.04%/3.61%]"
      >
        <MintCard card={coin} depth="table" idle="float" className="mdx-card3d--hero" priority sizes={COIN_CARD_SIZES} />
      </button>
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="mdx-h1 -mb-1 min-w-0 truncate pb-1">{coin.name}</h1>
          <ShareButton {...coinShare(coin)} label={`Share ${coin.name}`} />
        </div>
        <span className="mt-0.5 text-[13px] leading-[17px] text-slate">${coin.ticker}</span>
        <Num size="hero" unit={coin.mcapUsd == null ? coin.quoteSymbol : undefined} watch={marketCapWatch(coin)} tick className="mt-2.5 text-[28px]!">
          {coin.mcapUsd == null ? quoteNumber(coin.mcapQuote, true) : marketCapText(coin, false)}
        </Num>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[12px] font-medium leading-none text-slate">Market cap</span>
          <Change v={coin.change24h} pill className="text-[13px]" />
        </div>
        {/* The design, not the address (the address stays under the case and in Share). */}
        <PhoneHeroDesign coin={coin} />
      </div>
    </section>
  );
}

/** The phone hero's design chip ("Nova design, 3 of 14"), landing with the card's Ascend burst. */
export function PhoneHeroDesign({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  const design = getCardDesign(coin.cardTemplate);
  return <span className={cx("mt-3 inline-flex max-w-full self-start truncate rounded-chip border border-hairline px-2.5 py-1 text-[12px] font-medium text-ink", className)}>{design.name}</span>;
}

/**
 * Phones (P1-5): the top of the Card section. The full-size card in its tray, then its caption (No., launcher,
 * selected design) followed by creator-card ownership.
 */
export function CoinCardPane({
  coin,
  latestTradeId,
  className = "",
}: {
  coin: CoinDetail;
  latestTradeId?: string | number | null;
  className?: string;
}) {
  return (
    <section aria-label={`The ${coin.name} card`} data-pane="card" className={cx("flex flex-col", className)}>
      <CoinCase coin={coin} latestTradeId={latestTradeId} phone className="mx-auto mt-2 w-[min(260px,74vw)]" />
      <CaptionTop coin={coin} chip={false} className="mt-6" />
      <DesignProgress coin={coin} className="mt-3" />
    </section>
  );
}


/**
 * The next design is close (L10): within 10% of its market cap threshold, the case rim pulses in that design's
 * ring color. Real data only; never for a kept design or at the top.
 */
export function nearNextOf(coin: CoinDetail): { ring: string } | null {
  return null;
}

/**
 * The design the page's companions show (chip, progress, toasts): it trails a rise in `level` until the card's
 * Ascend bursts (whenRevealed, at most 1.5s; at once under calm or with no card on screen), so they all land
 * on the burst. A lower level shows at once.
 */
export function useRevealedLevel(dexNo: number, level: number) {
  return level;
}

/**
 * The coin's card in its labeled collector case on desktop and in the phone Card section. The compact
 * desktop overview uses the same clear rim without its header. The case unboxes on client navigation,
 * breathes and peeks, and jolts on each new live token trade. `back` (an unverified devnet card mint) shows the printed back,
 * with no case and no flip.
 */
export function CoinCase({
  coin,
  latestTradeId,
  back,
  phone = false,
  compact = false,
  priority = false,
  className = "",
}: {
  coin: CoinDetail;
  latestTradeId?: string | number | null;
  /** The card back's title (why the art is not shown), instead of the case. */
  back?: string;
  phone?: boolean;
  compact?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<Card3DHandle | null>(null);
  useClaimable(coin.id, el, handle);
  // The external 3D button and a long press open the same cased object.
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
        <>
          <CardCase
            ref={handle}
            card={coin}
            variant={compact ? "holder" : "labeled"}
            controls={compact ? "none" : "row"}
            nearNext={nearNextOf(coin)}
            priority={priority}
            sizes={phone ? "(max-width: 1023px) 240px, 300px" : COIN_CARD_SIZES}
            extraControl={<View3DButton item={{ id: coin.id, card: coin, cased: true }} className="mdx-v3dbtn--case" />}
          />
        </>
      )}
    </div>
  );
}

/**
 * The desktop object: a labeled collector case at xl and a compact clear holder from 1024 to 1279px.
 * Its width accounts for the complete enclosure and the external control row.
 */
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
        {back ? (
          <CardBack title={back} />
        ) : (
          <CoinCase coin={coin} latestTradeId={latestTradeId} compact priority />
        )}
      </div>
      <div className="hidden xl:block xl:w-[min(100cqw,calc((100cqh_-_60px)*112/173.683))]">
        <CoinCase coin={coin} latestTradeId={latestTradeId} back={back} priority />
      </div>
    </>
  );
}

/**
 * The coin page's card as an img sizes value: the 112px hero on phones (CoinHero), and the desktop card (96px
 * from 1024, then its column up to 264, 300 and 340px). Hidden desktop cards use the phone-sized source.
 */
export const COIN_CARD_SIZES =
  "(max-width: 1023px) 112px, (max-width: 1279px) 96px, (max-width: 1439px) 264px, (max-width: 1679px) 300px, 340px";

/** The selected print is permanent and independent of token performance. */
export function DesignProgress({ coin, className = "" }: { coin: CoinDetail; className?: string }) {
  const design = getCardDesign(coin.cardTemplate);
  return (
    <p className={cx("text-[13px] leading-[1.5] text-slate", className)}>
      <span className="font-medium text-ink">{design.name}.</span> Chosen by the creator. This card keeps its design.
    </p>
  );
}

/**
 * The caption details: (No., launched by and tier tag when the card is not right above), design
 * progress, the copyable address, graduation, links and the owner's Edit description.
 */
export function CoinDetails({
  coin,
  isOwner,
  onEdit,
  pane,
  className = "",
}: {
  coin: CoinDetail;
  isOwner: boolean;
  onEdit: () => void;
  pane?: string;
  className?: string;
}) {
  const require = useRequireMe();
  const [reportOpen, setReportOpen] = useState(false);
  return (
    <div className={cx("min-w-0", className)} data-pane={pane}>
      {/* Phones show the caption and progress in the Card section (CoinCardPane) and the design chip in the hero
          (CoinPhoneHero); desktop shows them here, under the ledge. The address row shows at every width. */}
      <CaptionTop coin={coin} className="mb-2 hidden lg:block" />
      <DesignProgress coin={coin} className="max-lg:hidden" />
      {/* In test mode the address is a test key that was never deployed (decision C6): the row says so. */}
      {coin.mintAddress ? <Address address={coin.mintAddress} row label className="mt-3 max-lg:mt-0" /> : <p className="mt-3 text-[12px] leading-5 text-slate max-lg:mt-0">No on-chain address in this local demo.</p>}
      {coin.graduated && (
        <p className="mt-2 text-[13px] font-medium leading-[1.45] text-ink max-lg:mt-0">
          {MODE_COPY.curveComplete}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] leading-5 max-lg:gap-x-6 max-lg:first:mt-0">
        {coin.website && (
          <TextLink href={coin.website} target="_blank" rel="noopener noreferrer nofollow">
            Website
          </TextLink>
        )}
        {coin.xUrl && (
          <TextLink href={coin.xUrl} target="_blank" rel="noopener noreferrer nofollow">
            X profile
          </TextLink>
        )}
        {isOwner ? (
          <TextLink onClick={onEdit}>Edit description</TextLink>
        ) : (
          <TextLink
            className="text-slate"
            onClick={() => require(() => setReportOpen(true), "Enter Launch a Card to report a card.")}
          >
            Report
          </TextLink>
        )}
      </div>
      <ReportDialog coin={coin} open={reportOpen} onOpenChange={setReportOpen} />
    </div>
  );
}

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
          <legend className="text-[15px] leading-[1.5] text-slate">
            What breaks the{" "}
            <TextLink to="/legal" search={{ tab: "terms" }} onClick={() => onOpenChange(false)}>
              content rules
            </TextLink>
            ?
          </legend>
          <div className="mt-3 flex flex-col">
            {REPORT_REASONS.map((r) => (
              <label
                key={r.value}
                className="mdx-row -mx-2 flex h-10 cursor-pointer items-center gap-3 px-2 text-[15px] text-ink hover:bg-tint max-lg:h-11"
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
          <Button
            type="submit"
            block
            disabled={!reason}
            pending={pending === "report"}
            pendingLabel="Sending..."
          >
            Send report
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- chart

const RANGES = [
  { key: "1h", label: "1H", ms: 3600_000 },
  { key: "6h", label: "6H", ms: 6 * 3600_000 },
  { key: "1d", label: "1D", ms: 24 * 3600_000 },
  { key: "all", label: "All", ms: Number.POSITIVE_INFINITY },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];
const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.key as RangeKey, label: r.label }));

function niceStep(span: number, count: number) {
  const raw = span / count;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** Actual post-trade observations, aggregated to OHLC. Empty time buckets remain gaps. */
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
  const quoteNative = currentUsd == null;
  const currentValue = currentUsd ?? currentQuote ?? 0;
  const quoteSymbol = getPairAsset(quoteAssetKey).symbol;
  const chartFigure = (value: number) => quoteNative ? quoteNumber(value, true) : usdCompact(value);
  const [range, setRange] = useState<RangeKey>("all");
  const [hover, setHover] = useState<number | null>(null);
  // Server and first client frame use the same observation clock.
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const vp = useLoaderViewport();
  const [ref, size] = useSize<HTMLDivElement>(
    vp && vp.w < 1024 ? { width: Math.max(200, vp.w - 64), height: 240 } : { width: 560, height: 240 },
  );
  const newestTrade = trades.reduce((latest, trade) => Math.max(latest, trade.id), 0);
  const seenTrade = useRef(newestTrade);
  const [ping, setPing] = useState<number | null>(null);
  useEffect(() => {
    if (!newestTrade || newestTrade === seenTrade.current) return;
    seenTrade.current = newestTrade;
    if (!prefersReducedMotion()) setPing(newestTrade);
  }, [newestTrade]);

  const samples = useMemo(() => trades.flatMap((trade) => {
    // A quote-native sample must never fall back to an unrelated USD number, or vice versa.
    const value = quoteNative ? trade.mcapQuote : trade.mcapUsd;
    return value != null && Number.isFinite(value) && value >= 0 && Number.isFinite(trade.createdAt)
      ? [{ t: trade.createdAt, v: value, sequence: trade.id }] : [];
  }), [trades, quoteNative]);
  const lastT = samples.reduce((latest, sample) => Math.max(latest, sample.t), createdAt);
  const firstT = samples.reduce((first, sample) => Math.min(first, sample.t), lastT);
  const now = Math.max(clock ?? lastT, lastT);
  const rangeMs = RANGES.find((option) => option.key === range)!.ms;
  const from = Number.isFinite(rangeMs) ? Math.max(createdAt, now - rangeMs) : firstT;
  const W = Math.max(200, Math.round(size.width));
  const H = Math.max(160, Math.round(size.height));
  const padL = 4, padR = 62, padT = 24, padB = 26;
  const plotWidth = W - padL - padR;
  const interval = candleInterval(Math.max(1_000, now - from), Math.max(18, Math.floor(plotWidth / 9)));
  const candles = useMemo(() => aggregateCandles(samples, { from, to: now, interval }), [samples, from, now, interval]);
  const t0 = Math.floor(from / interval) * interval;
  const t1 = Math.max(t0 + interval * 2, Math.ceil((now + 1) / interval) * interval);
  const bounds = candles.flatMap((candle) => [candle.low, candle.high]);
  if (Number.isFinite(currentValue) && currentValue >= 0) bounds.push(currentValue);
  let vMin = bounds.length ? Math.min(...bounds) : 0;
  let vMax = bounds.length ? Math.max(...bounds) : 1;
  const valuePadding = Math.max((vMax - vMin) * .12, vMax * .025, vMax === 0 ? 1 : Number.MIN_VALUE);
  vMin = Math.max(0, vMin - valuePadding);
  vMax += valuePadding;
  const x = (time: number) => padL + ((time - t0) / Math.max(1, t1 - t0)) * plotWidth;
  const candleX = (time: number) => x(time + interval / 2);
  const y = (value: number) => padT + (1 - (value - vMin) / (vMax - vMin || 1)) * (H - padT - padB);
  const step = niceStep(vMax - vMin, 4);
  const ticks: number[] = [];
  for (let value = Math.ceil(vMin / step) * step; value <= vMax && ticks.length < 8; value += step) ticks.push(value);
  const selected = candles.find((candle) => candle.t === hover);
  const bodyWidth = Math.max(2, Math.min(11, interval / (t1 - t0) * plotWidth * .65));
  const intervalText = candleIntervalLabel(interval);
  const isTruncated = (tradeCount ?? trades.length) > trades.length;
  const timeLabel = (time: number) => {
    const date = new Date(time);
    return t1 - t0 >= 86_400_000
      ? `${date.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]}`
      : `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}${interval < 60_000 ? `:${String(date.getUTCSeconds()).padStart(2, "0")}` : ""}`;
  };
  const timeTicks = [t0, t0 + (t1 - t0) / 2, t1];
  const selectedTime = selected ? new Date(selected.firstAt).toISOString().slice(0, interval < 60_000 ? 19 : 16).replace("T", " ") : "";

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * W;
    let closest = candles[0];
    for (const candle of candles) {
      if (!closest || Math.abs(candleX(candle.t) - px) < Math.abs(candleX(closest.t) - px)) closest = candle;
    }
    if (closest) setHover(closest.t);
  }

  function onKey(event: React.KeyboardEvent<SVGSVGElement>) {
    if (!candles.length || !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") { setHover(null); return; }
    const index = candles.findIndex((candle) => candle.t === hover);
    const next = event.key === "Home" ? 0 : event.key === "End" ? candles.length - 1
      : index === -1 ? candles.length - 1
      : Math.max(0, Math.min(candles.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
    setHover(candles[next].t);
  }

  const description = selected
    ? `${selectedTime} UTC. Open ${chartFigure(selected.open)}, high ${chartFigure(selected.high)}, low ${chartFigure(selected.low)}, close ${chartFigure(selected.close)}${quoteNative ? ` ${quoteSymbol}` : ""}.`
    : `${intervalText} market-cap candles from observed trades${quoteNative ? `, in ${quoteSymbol}` : ""}. Left and right arrow keys inspect candles. Gaps have no observed trades.`;

  return (
    <section className={cx("cdx-candles flex flex-col", className)} aria-label="Market cap candlestick chart" data-pane={pane}>
      <SectionHead
        title={quoteNative ? `Market cap · ${quoteSymbol}` : "Market cap"}
        right={<Tabs size="sm" label="Chart range" value={range} options={RANGE_OPTIONS}
          onChange={(next) => { setRange(next); setHover(null); }} />}
      />
      <div ref={ref} className="cdx-candles__plot relative mt-2 h-[240px] lg:h-[260px] xl:mt-1 xl:h-auto xl:min-h-0 xl:flex-1">
        {!candles.length ? (
          <div className="absolute inset-0 grid place-items-center rounded-row border border-dashed border-hairline px-6 text-center">
            <p className="max-w-[270px] text-pretty text-[13px] leading-[1.45] text-slate">
              {samples.length ? "No trades in this range. Choose a wider view." : "The first token trade will begin this chart."}
            </p>
          </div>
        ) : (
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}
            className="cdx-candles__svg absolute inset-0 block touch-pan-y select-none"
            onPointerMove={onMove} onPointerDown={onMove}
            onPointerLeave={(event) => { if (event.pointerType !== "touch") setHover(null); }}
            onKeyDown={onKey} onBlur={() => setHover(null)} tabIndex={0} role="img"
            aria-label={`Market cap candlesticks, current ${chartFigure(currentValue)}${quoteNative ? ` ${quoteSymbol}` : ""}`}>
            <desc>{description}</desc>
            {ticks.map((value) => (
              <g key={value}>
                <line x1={padL} x2={W - padR} y1={Math.round(y(value)) + .5} y2={Math.round(y(value)) + .5}
                  className="stroke-hairline" strokeOpacity={.65} strokeWidth={1} />
                <text x={W - padR + 8} y={y(value) + 4} className="num fill-slate" fontSize={10}>{chartFigure(value)}</text>
              </g>
            ))}
            {Number.isFinite(currentValue) && currentValue >= 0 ? (
              <line x1={padL} x2={W - padR} y1={y(currentValue)} y2={y(currentValue)}
                className="stroke-slate" strokeWidth={1} strokeDasharray="3 4" strokeOpacity={.45} />
            ) : null}
            {candles.map((candle, index) => {
              const center = candleX(candle.t);
              const flat = candle.close === candle.open;
              const color = flat ? "var(--color-slate)" : candle.close > candle.open ? "var(--color-up)" : "var(--color-down)";
              const latest = index === candles.length - 1;
              return (
                <g key={candle.t} data-candle="" data-direction={flat ? "flat" : candle.close > candle.open ? "up" : "down"}
                  className={latest && ping != null ? "cdx-candles__new" : undefined}
                  style={{ color, opacity: selected && selected.t !== candle.t ? .55 : 1 }}>
                  <line x1={center} x2={center} y1={y(candle.high)} y2={y(candle.low)}
                    stroke="currentColor" strokeWidth={1.3} />
                  {flat ? <line x1={center - bodyWidth / 2} x2={center + bodyWidth / 2} y1={y(candle.open)} y2={y(candle.open)}
                    stroke="currentColor" strokeWidth={1.8} />
                    : <rect x={center - bodyWidth / 2} y={Math.min(y(candle.open), y(candle.close))}
                      width={bodyWidth} height={Math.max(1.5, Math.abs(y(candle.close) - y(candle.open)))}
                      rx={.6} fill="currentColor" />}
                </g>
              );
            })}
            {timeTicks.map((time, index) => (
              <text key={index} x={x(time)} y={H - 5} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"}
                className="num fill-slate" fontSize={10}>{timeLabel(time)}</text>
            ))}
            {selected ? <line x1={candleX(selected.t)} x2={candleX(selected.t)} y1={padT} y2={H - padB}
              className="stroke-ink" strokeWidth={1} strokeOpacity={.4} strokeDasharray="2 3" /> : null}
          </svg>
        )}
        {selected ? (
          <div className="cdx-candles__tooltip" aria-hidden="true">
            <span className="cdx-candles__time">{selectedTime} UTC</span>
            <div className="cdx-candles__values">
              {([["O", selected.open], ["H", selected.high], ["L", selected.low], ["C", selected.close]] as const).map(([label, value]) => (
                <span key={label}><small>{label}</small><b className="num">{chartFigure(value)}</b></span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <p className="cdx-candles__note mt-1 flex-none text-[11px] leading-4 text-slate">
        {candles.length ? `${intervalText} candles · UTC${isTruncated ? ` · latest ${trades.length} trades` : ""}${samples.length === 1 ? " · one observed trade" : ""}` : "Observed trades only"}
        {quoteNative ? ` · demo ${quoteSymbol}` : MODE_COPY.usdNote ? ` · ${MODE_COPY.usdNote}` : ""}
      </p>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{selected ? description : ""}</span>
    </section>
  );
}

// ---------------------------------------------------------------- trades

/**
 * Time | Trader | SOL | Market cap. On phones the number columns are as narrow as their figures, so the trader
 * (the column people read) keeps its handle whole at 375; under 360 the market cap column gives way. SOL is
 * 52px (a "+123.45" is 49px) and market cap 68px, the width of its one-line "Market cap" label (62px).
 */
const TRADE_COLS =
  "grid grid-cols-[34px_minmax(0,1fr)_52px_68px] items-center gap-1.5 max-[359px]:grid-cols-[34px_minmax(0,1fr)_64px] sm:grid-cols-[56px_minmax(0,1fr)_88px_88px] sm:gap-2";

/**
 * Dense table, 34px rows with rule dividers, fitted to the height on desktop (10 rows on phones). Rows
 * cascade in on mount; a trade that lands with a poll enters with the sky wash and pings the live dot.
 * The rows stay square (rounded-none) so the rule dividers run straight edge to edge.
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
  const all = useMemo(() => [...trades].reverse().slice(0, 40), [trades]);
  // Live list (P1-17): rows hold still under the pointer, with focus inside, or while paused; a trade that
  // lands with a poll enters with the sky wash, and screen readers hear "1 new trade".
  const live = useLiveList(all, (t) => t.id, ["trade", "trades"]);
  const rows = live.shown;
  const grid = usePageCapacity({rowHeight:36,minWidth:10000,maxColumns:1,maxRows:20});
  const [pageIndex,setPageIndex] = useState(0);
  const pages = Math.max(1,Math.ceil(rows.length/grid.count));
  const page = Math.min(pageIndex,pages-1);
  const fresh = live.fresh;
  const now = useNow();
  const total = Math.max(count, trades.length);
  const fixedRows = { "--rows-h": `${Math.min(rows.length, 10) * 34}px` } as CSSProperties;
  return (
    <section className={cx("flex flex-col", className)} aria-label="Recent trades" data-pane={pane}>
      <SectionHead
        title="Recent trades"
        live={rows[0]?.id}
        livePaused={live.paused}
        right={
          // No count before the first trade: the empty line below says it.
          total > 0 ? (
            <span className="inline-flex items-baseline gap-4">
              <span className="text-slate">
                <span className="num">{total.toLocaleString("en-US")}</span>{" "}
                {total === 1 ? "trade" : "trades"}
              </span>
              {rows.length ? <LivePause paused={live.paused} onChange={live.setPaused} /> : null}
            </span>
          ) : undefined
        }
      />
      <p className="sr-only" role="status" aria-live="polite">
        {live.said}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] leading-[1.45] text-slate">No trades yet. Be the first.</p>
      ) : (
        <>
          {rows[0]?.mcapUsd == null ? <p className="mt-1 text-[11px] leading-4 text-slate">Amounts and market cap in {rows[0]?.quoteSymbol}.</p> : null}
          <div
            className={cx(
              TRADE_COLS,
              "mt-1 h-6 flex-none border-b border-hairline text-[12px] font-medium text-slate",
            )}
          >
            <span>Time</span>
            <span>Trader</span>
            <span className="truncate text-right">{rows[0]?.quoteSymbol ?? "SOL"}</span>
            <span className="whitespace-nowrap text-right max-[359px]:hidden">Market cap</span>
          </div>
          <div ref={grid.ref} className="cdx-trades-page">
            {rows.slice(page*grid.count,(page+1)*grid.count).map(t=>(

                <div
                  key={t.id}
                  data-new={fresh.has(t.id) || undefined}
                  className={cx(TRADE_COLS, "mdx-row h-[34px] rounded-none text-[13px]")}
                >
                  <span className="num text-[13px] text-slate" suppressHydrationWarning>
                    {ago(t.createdAt, now)}
                  </span>
                  <Handle handle={t.handle} bot={t.isBot} className="text-ink" />
                  <span
                    className={cx(
                      "num text-right text-[14px]",
                      t.side === "buy" ? "text-up" : "text-down",
                    )}
                  >
                    {t.side === "buy" ? "+" : "-"}
                    {quoteAtoms(t.quoteAmount ?? t.sol ?? 0, t.quoteAssetKey, true)}
                  </span>
                  <span className="num whitespace-nowrap text-right text-[14px] text-ink max-[359px]:hidden">
                    {t.mcapUsd == null ? quoteNumber(t.mcapQuote, true) : marketCapText(t)}
                  </span>
                </div>
            ))}
          </div>
          <PageControls page={page} pages={pages} onPage={setPageIndex} label={`${rows.length} recent trades`} />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- action column

/** Exact heights the first two collapse steps give back: quick amounts (8 + 32) and one 22px quote row. */
const QUICK_H = 40;
const AFTER_H = 22;

/** The token trade ticket and creator-card ownership share the action column. */
export function ActionColumn({ page, className = "" }: { page: CoinPage; className?: string }) {
  return (
    <div className={cx("cdx-coin-actions contents lg:flex lg:min-h-0 lg:flex-col lg:gap-6 lg:overflow-y-auto lg:bg-plinth mdx-aside lg:px-5 lg:py-6 short:gap-5 short:p-4", className)}>
      <TradePanel page={page} pane="trade" className="order-3 rounded-panel bg-plinth p-4 lg:order-none lg:flex-none lg:rounded-none lg:bg-transparent lg:p-0" />
      <DeedPanel page={page} pane="card" className="order-5 rounded-panel bg-plinth p-4 lg:order-none lg:rounded-none lg:bg-transparent lg:p-0" />
    </div>
  );
}

// ---------------------------------------------------------------- trade ticket

type Quote = BuyQuote | SellQuote;

/** One trade quote row: label, dotted leader, figure (the .mdx-leaders definition list). */
function QuoteRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="h-[22px] text-[13px] leading-[22px]">
      <dt className="text-slate">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-slate">-</span>;

/** The ticket's one message slot (P1-9 step 9): generic, so wallet errors can use it on devnet. */
type TicketMessage = { kind: "error" | "warning" | "info"; text: ReactNode; plain: string };

/** "12.4%": an impact or slippage figure for a sentence. */
function pctText(v: number) {
  const p = Math.abs(v * 100);
  return `${p >= 10 ? p.toFixed(1) : p.toFixed(2).replace(/0$/, "")}%`;
}

/**
 * The slippage limit, folded into an existing quote row (P1-9 step 4). The fee row's own words ("Fee 1% (half to
 * the fee vault)") already fill the 288px ticket, so the limit sits with the price impact it bounds; no new row.
 */
const IMPACT_LABEL = `Price impact (${FLOW.maxSlippage(pct(MAX_SLIPPAGE_BPS))})`;
/** Labels of the fee line items (P1-9 step 8). Test mode has one line; devnet adds pump.fun's own fee. */
const FEE_LINE_LABEL: Record<string, string> = { trade: WORDS.tradeFeeLabel };

/** A summary of the quote for screen readers, debounced so typing does not chatter (P1-9 step 3). */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function TradePanel({
  page,
  hideQuick = false,
  hideAfter = false,
  compact = false,
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
  const { openEnter } = useSessionUi();
  const { run, pending, feedback, errorOf, reset } = useAction();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [ticketStep,setTicketStep] = useState("amount");
  const [input, setInput] = useState("");
  // A blocked submit with nothing typed asks for an amount; typing clears it.
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Phones: Buy stays above the on-screen keyboard while the amount has focus (P1-5).
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
    const plain = asset.key === "sol" ? notEnoughSentence(me, now) : `Not enough demo ${asset.symbol}. Your balance is ${fmt(walletQuote)} ${asset.symbol}.`;
    blocker = {
      kind: "error",
      plain,
      text: me.canFaucet && asset.key === "sol" ? (
        <>
          {FLOW.notEnough}.{" "}
          <button
            type="button"
            className="mdx-link mdx-hit text-[13px]"
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
    const t = holding > 0 ? `More than you hold (${tokens(holding)}).` : `You hold no $${coin.ticker} yet.`;
    blocker = { kind: "error", text: t, plain: t };
  } else if (!quote && attempted && me) {
    blocker = { kind: "error", text: "Enter an amount.", plain: "Enter an amount." };
  }

  // The server's answer to the last try (until the amount changes), then any blocker, then the warning, then the
  // contextual note: one slot, one line.
  const serverError = errorOf("trade");
  const message: TicketMessage | null = serverError
    ? { kind: "error", text: serverError, plain: serverError }
    : blocker
      ? blocker
      : highImpact
        ? { kind: "warning", text: FLOW.highImpact(side, pctText(impact)), plain: FLOW.highImpact(side, pctText(impact)) }
        : null;
  const invalid = message?.kind === "error";

  const summary = useDebounced(
    quote?.ok
      ? `You receive ${
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
          : // What the wallet received, after the fee, in the quote's own format ("You receive 0.491 SOL"), so
            // the toast, the quote and the wallet agree (P0-8).
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

    } else {
      // The reason is in the slot right above the button.
      inputRef.current?.focus();
    }
  }

  function blocked() {
    setAttempted(true);
    // Move focus to the reason, so it is read and seen (P1-9 step 2).
    requestAnimationFrame(() => msgRef.current?.focus());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (compact && ticketStep === "amount") {setTicketStep("review");return;}
    if (!me) {
      const intent = quote?.ok
        ? side === "buy"
          ? `Enter and buy ${input} ${asset.symbol} of $${coin.ticker}`
          : `Enter and sell $${coin.ticker}`
        : "Enter Launch a Card";
      require(
        quote?.ok ? doTrade : () => inputRef.current?.focus(),
        "Pick a handle to trade.",
        intent,
      );
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
      className={cx("flex flex-col", compact && "cdx-trade-ticket", className)}
      data-ticket-step={ticketStep}
      aria-label={`Trade $${coin.ticker}`}
      data-pane={pane}
      noValidate
    >
      {compact ? <div className="cdx-view-tabs" aria-label="Trade steps"><button type="button" aria-pressed={ticketStep==="amount"} onClick={()=>setTicketStep("amount")}>Amount</button><button type="button" aria-pressed={ticketStep==="review"} onClick={()=>setTicketStep("review")}>Review trade</button></div> : null}
      <div className="cdx-trade-ticket__amount">
      <SideToggle
        side={side}
        onChange={(s) => {
          setSide(s);
          edit("");
        }}
      />

      {/* The input is named by its visible label and unit ("You pay SOL", "You sell $GLORB") and
          described by the balance beside the label and the message slot, by id, so the placeholder never
          stands in. */}
      <Field
        className="mt-4"
        label={<span id="trade-amt-label">{side === "buy" ? "You pay" : "You sell"}</span>}
        htmlFor="trade-amt"
        right={
          <span id="trade-amt-balance">
            {side === "buy" ? (
              me ? (
                <>
                  Demo <span className="num">{fmt(walletQuote)}</span> {asset.symbol}
                </>
              ) : (
                // Signed out there is no wallet yet (P0-5): say how to get one, not "Wallet 0.00".
                <button
                  type="button"
                  className="mdx-link mdx-hit text-[12px]"
                  onClick={() => openEnter("Pick a handle to trade.")}
                >
                  Enter for demo {asset.symbol}
                </button>
              )
            ) : (
              <>
                Held <span className="num">{tokens(holding)}</span>
              </>
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
            placeholder="0.0"
            className="mdx-input num h-12 text-[20px]"
            style={{ paddingRight: suffix.length > 4 ? 104 : 56 }}
          />
          <span
            id="trade-amt-unit"
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-slate"
          >
            {suffix}
          </span>
        </div>
      </Field>

      {!hideQuick && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <Button
              key={q.label}
              variant="chip"
              size="sm"
              className="num px-0 text-[14px]"
              disabled={!q.value}
              aria-label={q.aria}
              onClick={() => edit(q.value)}
            >
              {q.label}
            </Button>
          ))}
        </div>
      )}

      {compact ? <Button type="button" block className="mt-4" onClick={()=>setTicketStep("review")}>Review {side}</Button> : null}
      </div>
      <div className="cdx-trade-ticket__review">
      {compact ? <p className="text-[13px] text-slate">{side==="buy"?"Buy":"Sell"} · {input || "0"} {suffix}</p> : null}
      <dl className="mdx-leaders mt-4">
        <QuoteRow label="You receive">
          {quote?.ok ? (
            side === "buy" ? (
              <Num size="sm" unit={`$${coin.ticker}`}>
                {tokens((quote as BuyQuote).tokensOut)}
              </Num>
            ) : (
              <Num size="sm" unit={asset.symbol}>
                {fmt((quote as SellQuote).solOut)}
              </Num>
            )
          ) : (
            EMPTY
          )}
        </QuoteRow>
        <QuoteRow label={IMPACT_LABEL}>
          {quote?.ok ? (
            <span className={cx("num text-[14px]", highImpact ? "text-down" : "text-ink")}>
              {/* A size, never signed: a sell moves the price down, but the impact reads the same way. */}
              {Math.abs(impact * 100).toFixed(2)}%
            </span>
          ) : (
            EMPTY
          )}
        </QuoteRow>
        {TRADE_FEE_LINES.map((line) => (
          <QuoteRow key={line.key} label={FEE_LINE_LABEL[line.key] ?? WORDS.tradeFeeLabel}>
            {quote?.ok ? (
              <Num size="sm" unit={asset.symbol}>
                {fmt(Math.round((quote.fee * line.bps) / TRADE_FEE_BPS))}
              </Num>
            ) : (
              EMPTY
            )}
          </QuoteRow>
        ))}
        {!hideAfter && (
          <QuoteRow label="Market cap after">
            <Num size="sm">{marketCapText({...afterMetrics, quoteAssetKey:asset.key})}</Num>
          </QuoteRow>
        )}
      </dl>
      <p className="sr-only" role="status">
        {summary}
      </p>

      {/* The one message slot (P1-9): errors (alert) and the impact warning. Empty, it takes no
          room; the column's collapse ladder absorbs the line when it shows. */}
      <div
        id="trade-msg"
        ref={msgRef}
        tabIndex={-1}
        className={cx("outline-none", message && "mt-3")}
      >
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={cx(
              "min-h-5 text-[13px] leading-5",
              message.kind === "error" ? "text-down" : message.kind === "warning" ? "font-medium text-ink" : "text-ink",
            )}
          >
            {message.text}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        block
        variant={me ? side : "primary"}
        className="mt-3"
        disabled={!!me && !ready}
        pending={pending === "trade"}
        pendingLabel="Filling..."
        feedback={feedback("trade")}
        successLabel={side === "buy" ? "Bought" : "Sold"}
        onBlocked={blocked}
      >
        {label}
      </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- the creator's NFT card

export function DeedPanel({
  page, pane, className = "",
}: {
  page: CoinPage;
  pane?: string;
  className?: string;
}) {
  const { coin, viewer } = page;
  const design = getCardDesign(coin.cardTemplate);
  const asset = getPairAsset(coin.quoteAssetKey);
  return (
    <section data-pane={pane} className={className} aria-label="NFT card ownership">
      <SectionHead title="The creator's card" right={<span className="mdx-micro text-ink">1 / 1</span>} />
      <dl className="mt-3 space-y-2 text-[13px] leading-[1.5]">
        <div className="flex items-start justify-between gap-3"><dt className="text-slate">Owner</dt><dd className="min-w-0 text-right font-medium text-ink"><Handle handle={coin.ownerHandle} bot={coin.ownerIsBot} />{viewer?.isOwner ? <span className="ml-1.5 text-slate">(you)</span> : null}</dd></div>
        <div className="flex items-start justify-between gap-3"><dt className="text-slate">Design</dt><dd className="min-w-0 text-right font-medium text-ink">{design.name}</dd></div>
        <div className="flex items-start justify-between gap-3"><dt className="text-slate">Edition</dt><dd className="text-ink">One of one</dd></div>
        <div className="flex items-start justify-between gap-3"><dt className="text-slate">Trading pair</dt><dd className="text-right font-medium text-ink">{coin.tradingPair ?? `${coin.ticker} / ${asset.symbol}`}</dd></div>
        <div className="flex items-start justify-between gap-3"><dt className="text-slate">Quote asset</dt><dd className="min-w-0 text-right font-medium text-ink">{asset.name}</dd></div>
        {asset.issuer ? <div className="flex items-start justify-between gap-3"><dt className="text-slate">Issuer</dt><dd className="text-right text-ink">{asset.issuer}</dd></div> : null}
        <div className="flex items-start justify-between gap-3"><dt className="text-slate">Quote mint</dt><dd className="min-w-0 text-right"><a className="mdx-link break-all" href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer" aria-label={`View ${asset.symbol} quote mint on Solscan`}>{asset.mint.slice(0,6)}…{asset.mint.slice(-6)} ↗</a></dd></div>
      </dl>
      <p className="mt-4 border-t border-hairline pt-3 text-pretty text-[13px] leading-[1.5] text-slate">The token trades. Its creator holds a separate collectible card with the design chosen at launch.</p>
      {asset.kind === "stock" ? <p className="mt-2 text-[12px] leading-[1.5] text-slate">Paired with a tokenized stock asset. Your token does not represent company shares.</p> : null}
      <p className="mt-2 text-[12px] leading-[1.5] text-slate">{MODE_COPY.guideNote}</p>
    </section>
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
      <span className="num mt-1.5 self-end text-[12px] text-slate">{text.length}/280</span>
      <div className="mdx-sheet-foot mt-4 flex justify-end">
        <Button type="submit" pending={pending === "lore"} pendingLabel="Saving..." className="max-lg:w-full">
          Save description
        </Button>
      </div>
    </form>
  );
}
