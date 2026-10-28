/**
 * The devnet trade ticket (refs/chain/m3-contract.md §2.2 Coin): Buy | Sell through the pump.fun curve, or
 * PumpSwap once the coin graduated (the Worker picks the venue from the coin's state), a live estimate while
 * typing, "Complete the curve" when only dust is left, and the graduation states. The same layout, words and
 * message slot as the test-mode ticket (components/mintdex/coin.tsx TradePanel), so both modes look alike.
 *
 * Owner: app:pages. Every trade runs through lib/chain/client.ts (build, verify before the wallet opens, sign,
 * submit, confirm); the estimate here is display only.
 */
import { API_LIMITS } from "@mintdex/chain-sdk/api";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { big, holdTimeOf } from "../../../lib/chain/adapt";
import {
  curveIn,
  estimateCurveBuy,
  estimateCurveSell,
  estimatePoolBuy,
  estimatePoolSell,
  poolIn,
  type TradeEstimate,
} from "../../../lib/chain/estimate";
import { buy, completeCurve, sell, type TxResult } from "../../../lib/chain/client";
import { useChainConfig, type ChainCoinPage } from "../../../lib/chain/data";
import { CHAIN_COPY, CHAIN_ERRORS, FLOW, WORDS, pct } from "../../../lib/mintdex/copy";
import { IS_MAINNET } from "../../../lib/mintdex/mode";
import { useDisplayQuoteSource } from "../../../lib/chain/quote-data";
import { HIGH_IMPACT } from "../../../lib/mintdex/fees";
import { cleanAmount, parseSol, parseTokens, sol, tokens, usdCompact } from "../../../lib/mintdex/format";
import { levelForMcap, tierForLevel } from "../../../lib/mintdex/tiers";
import { useKeyboardSafe } from "../../mintdex/sheet";
import { Button, Field, FrameMini, Num, SideToggle } from "../../mintdex/ui";
import { FaucetLinks, openWallet, signBlocker, useSiteTransactionHold, useTx, SITE_TRANSACTION_HOLD_NOTICE, type Viewer } from "./tx";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const SLIPPAGE_BPS = API_LIMITS.slippageDefaultBps;
const IMPACT_LABEL = `Price impact (${FLOW.maxSlippage(pct(SLIPPAGE_BPS))})`;
/** Devnet SOL is scarce: small quick amounts. */
const BUY_QUICK = [0.05, 0.1, 0.25, 0.5];
/** Network fee and new-account rent the ticket keeps aside before calling a buy affordable (about 0.005 SOL). */
const BUY_HEADROOM = 5_000_000;

type Message = { kind: "error" | "warning" | "info"; text: ReactNode };

function QuoteRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="h-[22px] text-[13px] leading-[22px]">
      <dt className="text-slate">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-slate">-</span>;

function pctText(v: number) {
  const p = Math.abs(v * 100);
  return `${p >= 10 ? p.toFixed(1) : p.toFixed(2).replace(/0$/, "")}%`;
}

export function ChainTradePanel({
  page,
  viewer,
  holding,
  balance,
  hideQuick = false,
  hideAfter = false,
  onQuote,
  pane,
  className = "",
}: {
  page: ChainCoinPage;
  viewer: Viewer;
  /** The viewer's tokens of this coin (base units); 0n when unknown or none. */
  holding: bigint;
  /** The viewer's lamports; null while unknown. */
  balance: number | null;
  hideQuick?: boolean;
  /** Leave out the market cap after and venue rows (the desktop collapse ladder). */
  hideAfter?: boolean;
  /** Told when the ticket starts or stops showing an estimate (its quote rows come and go with it). */
  onQuote?: (quoted: boolean) => void;
  pane?: string;
  className?: string;
}) {
  const { detail, coin, perLamport } = page;
  const mint = detail.mint;
  const tx = useTx();
  const siteHold = useSiteTransactionHold();
  const config = useChainConfig();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("");
  // "Max" sells the exact holding (no float rounding on the way back to base units).
  const [maxPicked, setMaxPicked] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useKeyboardSafe(formRef);

  const curve = detail.curve;
  const pool = detail.pool;
  const onPool = detail.graduated && !!pool;
  // The curve sold out but the pool does not exist yet: the crank migrates it within a minute.
  const graduating = !onPool && !!curve?.complete;
  const dust =
    !!curve && !curve.complete && !onPool && big(curve.realTokenReserves) < big(API_LIMITS.dustTokenThreshold);
  const holdingNum = Number(holding);

  const amount = side === "buy" ? (input ? parseSol(input) : NaN) : maxPicked ? holdingNum : input ? parseTokens(input) : NaN;
  const quoteSource = useDisplayQuoteSource(onPool ? "pool" : "curve", mint, Number.isFinite(amount) && amount > 0 && !graduating);
  const est = useMemo<TradeEstimate | null>(() => {
    if (IS_MAINNET) {
      if (!quoteSource) return null;
      const { fees } = quoteSource;
      if (quoteSource.venue === "pool") {
        return side === "buy" ? estimatePoolBuy(quoteSource.reserves, amount, fees) : estimatePoolSell(quoteSource.reserves, amount, fees);
      }
      return side === "buy" ? estimateCurveBuy(quoteSource.reserves, amount, fees) : estimateCurveSell(quoteSource.reserves, amount, fees);
    }
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (onPool && pool) {
      const p = poolIn(pool);
      return side === "buy" ? estimatePoolBuy(p, amount) : estimatePoolSell(p, amount);
    }
    if (!curve) return null;
    const c = curveIn(curve);
    return side === "buy" ? estimateCurveBuy(c, amount) : estimateCurveSell(c, amount);
  }, [amount, side, onPool, pool, curve, quoteSource]);

  const feeLabel = IS_MAINNET && quoteSource
    ? `Fee ${pct(Number(quoteSource.fees.lpFeeBps + quoteSource.fees.protocolFeeBps + quoteSource.fees.creatorFeeBps))} (${pct(Number(quoteSource.fees.creatorFeeBps))} to the fee vault)`
    : WORDS.tradeFeeLabel;
  const quoted = !!est;
  useEffect(() => {
    onQuote?.(quoted);
  }, [quoted, onQuote]);

  const afterUsd = est ? est.mcapAfterLamports * perLamport : coin.mcapUsd;
  const afterLevel = est ? levelForMcap(afterUsd) : 0;
  const reaches = side === "buy" && afterLevel > coin.level ? tierForLevel(afterLevel) : null;
  const highImpact = !!est && Math.abs(est.impact) > HIGH_IMPACT;

  // What blocks the trade, in the order the ticket says it (the sim ticket's order, P1-9).
  let blocker: Message | null = null;
  const network = signBlocker(viewer);
  if (siteHold) blocker = { kind: "info", text: SITE_TRANSACTION_HOLD_NOTICE };
  else if (network) blocker = { kind: "error", text: network };
  else if (graduating)
    // The curve sold out and the pool is not there yet (the crank migrates within a minute, m3-contract §5.4).
    blocker = { kind: "info", text: CHAIN_ERRORS.CURVE_COMPLETE };
  else if (side === "buy" && est && balance != null && est.sol + BUY_HEADROOM > balance)
    blocker = {
      kind: "error",
      text: (
        <>
          {FLOW.notEnough} (wallet <span className="num">{sol(balance, 3)}</span>). <FaucetLinks lead={false} />
        </>
      ),
    };
  else if (side === "sell" && Number.isFinite(amount) && amount > 0 && amount > holdingNum)
    blocker = {
      kind: "error",
      text: holdingNum > 0 ? `More than you hold (${tokens(holdingNum)}).` : `You hold no $${coin.ticker} yet.`,
    };
  else if (Number.isFinite(amount) && amount > 0 && !est)
    blocker = IS_MAINNET && !quoteSource
      ? { kind: "info", text: "Current trading fees could not be loaded. Try again shortly." }
      : { kind: "error", text: "Enter a smaller amount." };
  else if (!est && attempted && viewer.connected) blocker = { kind: "error", text: "Enter an amount." };

  const txError = tx.error("trade") ?? tx.error("complete");
  const txNote = tx.note("trade") ?? tx.note("complete");
  const message: Message | null = txError
    ? { kind: "error", text: txError }
    : txNote
      ? { kind: "warning", text: txNote }
      : blocker
        ? blocker
        : highImpact
          ? { kind: "warning", text: FLOW.highImpact(side, pctText(est!.impact)) }
          : reaches
            ? {
                kind: "info",
                text: (
                  <span className="inline-flex items-center gap-2">
                    <FrameMini level={reaches.level} />
                    This buy reaches the {reaches.name} line. It unlocks once it holds {holdTimeOf(config?.evolve.holdSlots)}.
                  </span>
                ),
              }
            : dust
              ? {
                  kind: "info",
                  text: (
                    <>
                      {big(curve!.realTokenReserves) >= 1_000_000n ? (
                        <>
                          Only <span className="num">{tokens(Number(big(curve!.realTokenReserves)))}</span> ${coin.ticker} left on
                          the curve.
                        </>
                      ) : (
                        <>Less than one ${coin.ticker} left on the curve.</>
                      )}{" "}
                      <button
                        type="button"
                        className="mdx-link mdx-hit text-[13px]"
                        disabled={siteHold || !!tx.busy}
                        onClick={() => void doComplete()}
                      >
                        {tx.pending("complete") ? tx.label("complete") : "Complete the curve"}
                      </button>
                    </>
                  ),
                }
              : null;
  const invalid = message?.kind === "error";
  const ready = viewer.connected && !!est && !blocker && !tx.busy;

  function edit(next: string) {
    setInput(next);
    setMaxPicked(false);
    setAttempted(false);
    tx.reset("trade");
    tx.reset("complete");
  }

  async function doTrade() {
    if (siteHold) return;
    if (!est) {
      inputRef.current?.focus();
      return;
    }
    const opts = { keys: [["coin", mint], ["home"], ["market"]], mints: [mint] };
    let r: TxResult | null;
    if (side === "buy") {
      const spend = BigInt(Math.floor(amount));
      r = await tx.run("trade", (onStep) => buy({ mint, solLamports: spend, slippageBps: SLIPPAGE_BPS }, onStep), {
        ...opts,
        success: (res) => {
          const got = Number(big(res.summary.tokensIn ?? String(est.tokens)));
          return `Bought ${tokens(got)} $${coin.ticker} for ${sol(Number(spend))} SOL.`;
        },
      });
    } else {
      const amountUnits = maxPicked ? holding : BigInt(Math.floor(amount));
      r = await tx.run("trade", (onStep) => sell({ mint, tokenAmount: amountUnits, slippageBps: SLIPPAGE_BPS }, onStep), {
        ...opts,
        success: (res) => {
          const got = Number(big(res.summary.expectedSolInLamports || String(est.sol)));
          return `Sold ${tokens(Number(amountUnits))} $${coin.ticker} for about ${sol(got)} SOL.`;
        },
      });
    }
    if (r) {
      setInput("");
      setMaxPicked(false);
      setAttempted(false);
    } else inputRef.current?.focus();
  }

  async function doComplete() {
    if (siteHold) return;
    if (!viewer.connected) {
      openWallet();
      return;
    }
    await tx.run("complete", (onStep) => completeCurve({ mint, slippageBps: SLIPPAGE_BPS }, onStep), {
      keys: [["coin", mint], ["home"], ["market"]],
      mints: [mint],
      success: `You completed the $${coin.ticker} curve. It moves to PumpSwap within a minute.`,
    });
  }

  function blocked() {
    setAttempted(true);
    requestAnimationFrame(() => msgRef.current?.focus());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (siteHold) return;
    if (!viewer.connected) {
      openWallet();
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
      ? BUY_QUICK.map((v) => ({ label: String(v), aria: `${v} SOL`, value: String(v), max: false }))
      : [0.25, 0.5, 0.75, 1].map((f) => {
          const part = (holdingNum * f) / 1e6;
          return {
            label: f === 1 ? "Max" : `${f * 100}%`,
            aria: f === 1 ? "All you hold" : `${f * 100}% of what you hold`,
            value: holdingNum <= 0 ? "" : f === 1 ? String(holdingNum / 1e6) : String(part >= 1 ? Math.floor(part) : Math.floor(part * 100) / 100),
            max: f === 1,
          };
        });

  const label = siteHold ? "Trading paused" : !viewer.connected ? CHAIN_COPY.connectToTrade : `${side === "buy" ? "Buy" : "Sell"} $${coin.ticker}`;
  const suffix = side === "buy" ? "SOL" : `$${coin.ticker}`;
  const venue = onPool
    ? "PumpSwap pool"
    : graduating
      ? "Moving to PumpSwap"
      : `pump.fun curve, ${Math.round(coin.curveProgress * 100)}% sold`;

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className={cx("flex flex-col", className)}
      aria-label={`Trade $${coin.ticker}`}
      data-pane={pane}
      noValidate
    >
      <SideToggle
        side={side}
        onChange={(s) => {
          setSide(s);
          edit("");
        }}
      />

      <Field
        className="mt-4"
        label={<span id="trade-amt-label">{side === "buy" ? "You pay" : "You sell"}</span>}
        htmlFor="trade-amt"
        right={
          // Signed out: nothing here, the one Connect is the button below.
          viewer.connected ? (
            <span id="trade-amt-balance">
              {side === "buy" ? (
                balance != null ? (
                  <>
                    Wallet <span className="num">{sol(balance, 2)}</span> SOL
                  </>
                ) : (
                  "Wallet"
                )
              ) : (
                <>
                  Held <span className="num">{tokens(holdingNum)}</span>
                </>
              )}
            </span>
          ) : undefined
        }
      >
        <div className="relative">
          <input
            ref={inputRef}
            id="trade-amt"
            data-focus-home
            aria-labelledby="trade-amt-label trade-amt-unit"
            aria-describedby={viewer.connected ? "trade-amt-balance trade-msg" : "trade-msg"}
            aria-invalid={invalid || undefined}
            inputMode="decimal"
            enterKeyHint="go"
            autoComplete="off"
            value={input}
            onChange={(e) => edit(cleanAmount(e.target.value, side === "buy" ? 9 : 6))}
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

      {/* Quick amounts once a wallet is connected: signed out, the one next step is Connect (typing an amount
          still shows the estimate). */}
      {!hideQuick && viewer.connected && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <Button
              key={q.label}
              variant="chip"
              size="sm"
              className="num px-0 text-[14px]"
              disabled={!q.value}
              aria-label={q.aria}
              onClick={() => {
                edit(q.value);
                if (q.max) setMaxPicked(true);
              }}
            >
              {q.label}
            </Button>
          ))}
        </div>
      )}

      {/* The quote rows come with an amount; the fee row is always there (the fee disclosure). */}
      <dl className="mdx-leaders mt-4">
        {est ? (
          <>
            <QuoteRow label="You receive">
              {side === "buy" ? (
                <Num size="sm" unit={`$${coin.ticker}`}>
                  {tokens(est.tokens)}
                </Num>
              ) : (
                <Num size="sm" unit="SOL">
                  {sol(est.sol)}
                </Num>
              )}
            </QuoteRow>
            <QuoteRow label={IMPACT_LABEL}>
              <span className={cx("num text-[14px]", highImpact ? "text-down" : "text-ink")}>
                {Math.abs(est.impact * 100).toFixed(2)}%
              </span>
            </QuoteRow>
          </>
        ) : null}
        <QuoteRow label={feeLabel}>
          {est ? (
            <Num size="sm" unit="SOL">
              {sol(est.fee)}
            </Num>
          ) : (
            EMPTY
          )}
        </QuoteRow>
        {est && !hideAfter && (
          <>
            <QuoteRow label="Market cap after">
              <Num size="sm">{usdCompact(afterUsd)}</Num>
            </QuoteRow>
            <QuoteRow label="Venue">
              <span className="text-[13px] text-ink">{venue}</span>
            </QuoteRow>
          </>
        )}
      </dl>

      <div id="trade-msg" ref={msgRef} tabIndex={-1} className={cx("outline-none", message && "mt-3")}>
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
        variant={viewer.connected ? side : "primary"}
        className="mt-3"
        disabled={siteHold || (viewer.connected && !ready)}
        aria-describedby="trade-msg"
        pending={tx.pending("trade")}
        pendingLabel={tx.label("trade")}
        feedback={tx.feedback("trade")}
        successLabel={side === "buy" ? "Bought" : "Sold"}
        onBlocked={blocked}
      >
        {label}
      </Button>
    </form>
  );
}
