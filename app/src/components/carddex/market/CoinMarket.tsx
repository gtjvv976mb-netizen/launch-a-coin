import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { Change, CurveTrack, Icon, KpiGroup, Num, SectionHead, Skeleton, Tabs } from "../../mintdex/ui";
import { geckoCandlesQuery, geckoPoolLookupQuery, geckoPoolQuery, geckoTradesQuery } from "../../../lib/carddex/live/gecko";
import { CHART_RANGE_LABEL, CHART_RANGES, coinMarketQuery, combineMarket, type ChartRange, type CoinMarket } from "../../../lib/carddex/live/market";
import type { PairAsset } from "../../../lib/carddex/pairs";
import { ageShort, amountShort, priceFigure, shareText, shortAddress, usdPrice, usdShort } from "./format";

/*
 * A launched coin's market, in four parts the coin page places: the price panel beside the card (price, market cap,
 * 24-hour stats, holders, the bonding curve), the candlestick chart, recent trades and the largest holders. The Solana
 * half comes from the site (coinMarketQuery, every 15 seconds), the GeckoTerminal half straight from GeckoTerminal in
 * the browser (gecko.ts, every 30 to 60 seconds); both poll only while the tab is visible. A figure a source did not
 * give is a dash, never a zero. Styles: styles/screens/coin.css (.cdx-mkt*).
 */

const PriceChart = lazy(() => import("./PriceChart"));

const solscanAccount = (address: string) => `https://solscan.io/account/${address}`;
const solscanTx = (signature: string) => `https://solscan.io/tx/${signature}`;

/** A clock for "updated 12s ago" and the trades' ages: ticks every 5 seconds on the client only. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The coin's market as the page shows it: undefined until either half has answered; `failed` once both have failed with
 * nothing to show. `pool` is the pool the chart follows.
 */
export function useCoinMarket(mint: string): { data: CoinMarket | undefined; failed: boolean; pool: string | null } {
  const chain = useQuery(coinMarketQuery(mint));
  const chainPool = chain.data?.pool ?? null;
  // GeckoTerminal's own record of the pool, only when the site could not read the curve.
  const lookup = useQuery(geckoPoolLookupQuery(mint, !chainPool && (chain.isError || (chain.isSuccess && !chainPool))));
  const pool = chainPool ?? lookup.data ?? null;
  const stats = useQuery(geckoPoolQuery(pool, mint));
  const trades = useQuery(geckoTradesQuery(pool, mint));
  const answered = chain.data !== undefined || stats.data !== undefined || trades.data !== undefined;
  const geckoStale = (stats.isError && stats.data !== undefined) || (trades.isError && trades.data !== undefined);
  const data = answered ? combineMarket(mint, chain.data, stats.data, trades.data, geckoStale) : undefined;
  const failed = !answered && chain.isError && (!pool || (stats.isError && trades.isError)) && !lookup.isFetching;
  return { data, failed, pool };
}

function External({ href, children, label }: { href: string; children: ReactNode; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="cdx-mkt__link" aria-label={`${label} (opens in a new tab)`}>
      {children}
    </a>
  );
}

// ---------------------------------------------------------------- the price panel

/** Where each figure came from, said only for the figures the page has. */
function sourceLine(data: CoinMarket): string {
  const chain = [data.priceSource === "chain" ? "price" : null, data.progress !== null ? "curve" : null, data.holders !== null ? "holders" : null].filter(Boolean) as string[];
  const gecko = [data.priceSource === "geckoterminal" ? "price" : null, data.volumeUsd24h !== null ? "volume" : null, data.change.h24 !== null ? "change" : null, data.trades !== null ? "trades" : null].filter(Boolean) as string[];
  const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]);
  const parts = [chain.length ? `${list(chain)} from Solana` : null, gecko.length ? `${list(gecko)} from GeckoTerminal` : null].filter(Boolean) as string[];
  if (!parts.length) return "";
  const text = parts.join("; ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

export function MarketPanel({ mint, pair, data, failed }: { mint: string; pair: Readonly<PairAsset>; data: CoinMarket | undefined; failed: boolean }) {
  const now = useNow();
  const graduated = data?.status === "migrated" || data?.status === "complete";
  const h24 = data?.change.h24;
  const tx = data?.txns24h;
  const holderValue = data?.holderCount != null ? `${data.holderCount.toLocaleString("en-US")}${data.holderCountCapped ? "+" : ""}` : null;
  return (
    <div className="cdx-mkt" aria-busy={!data && !failed ? true : undefined}>
      <div className="cdx-mkt__price">
        <p className="cdx-mkt__label">Price</p>
        <div className="cdx-mkt__figure">
          {data?.priceUsd != null ? (
            <Num size="hero" watch={data.priceUsd} flashKey={mint}>{usdPrice(data.priceUsd)}</Num>
          ) : data ? (
            <span className="mdx-dash text-figure" aria-label="Not available">{"—"}</span>
          ) : (
            <Skeleton className="h-9 w-40 rounded-row" />
          )}
          {h24 != null ? <Change v={h24 / 100} pill /> : null}
        </div>
        {data?.priceQuote != null ? (
          <p className="cdx-mkt__quote num">
            {priceFigure(data.priceQuote)} {pair.symbol}
          </p>
        ) : null}
      </div>
      <KpiGroup
        cols={2}
        size="lg"
        className="cdx-mkt__kpis"
        items={[
          {
            label: "Market cap",
            value: data?.marketCapUsd != null ? usdShort(data.marketCapUsd) : null,
            sub: data?.marketCapQuote != null ? `${amountShort(data.marketCapQuote)} ${pair.symbol}` : undefined,
          },
          {
            label: "24h volume",
            value: data?.volumeUsd24h != null ? usdShort(data.volumeUsd24h) : null,
            sub: tx ? `${tx.buys.toLocaleString("en-US")} buys · ${tx.sells.toLocaleString("en-US")} sells` : undefined,
          },
          {
            label: "Holders",
            value: holderValue,
            sub: data?.curveShare != null && !graduated ? `${shareText(data.curveShare)} still on the curve` : undefined,
          },
          {
            label: graduated ? "Liquidity" : "Curve reserves",
            value: data?.reservesUsd != null ? usdShort(data.reservesUsd) : null,
            sub: data?.reservesQuote != null ? `${amountShort(data.reservesQuote)} ${pair.symbol}` : undefined,
          },
        ]}
      />
      <CurveTrack
        progress={data?.progress ?? null}
        graduated={graduated}
        label="Bonding curve"
        note={data?.status === "migrated" ? "Graduated to PumpSwap" : data?.status === "complete" ? "Full: moving to PumpSwap" : undefined}
      />
      <dl className="cdx-mkt__changes">
        {(["m5", "h1", "h6", "h24"] as const).map((key) => (
          <div key={key}>
            <dt>{{ m5: "5m", h1: "1h", h6: "6h", h24: "24h" }[key]}</dt>
            <dd>
              {data?.change[key] != null ? (
                <Change v={data.change[key]! / 100} period={`in ${{ m5: "5 minutes", h1: "1 hour", h6: "6 hours", h24: "24 hours" }[key]}`} />
              ) : (
                <span className="mdx-dash" aria-label="Not available">{"—"}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="cdx-mkt__source">
        {failed && !data
          ? "Market data is unavailable right now. It will try again shortly."
          : data
            ? <>{data.asOf !== null ? <>Updated {ageShort(data.asOf, Math.max(now, data.asOf))} ago{data.stale ? " (some figures are older than usual)" : ""}. </> : null}{sourceLine(data)}</>
            : "Reading the market…"}
      </p>
      {/* Screen readers hear only a change of state (loading, unavailable), never the ticking age. */}
      <p className="sr-only" role="status">{failed && !data ? "Market data is unavailable right now." : data ? "" : "Reading the market."}</p>
    </div>
  );
}

// ---------------------------------------------------------------- the chart

export function ChartSection({ mint, name, pool, waiting }: { mint: string; name: string; pool: string | null; waiting: boolean }) {
  const [range, setRange] = useState<ChartRange>("5m");
  // The canvas chart draws in the browser only; the server and the first paint keep its frame.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const base = geckoCandlesQuery(pool, mint, range);
  const query = useQuery({ ...base, enabled: mounted && base.enabled });
  const candles = query.data ?? [];
  const last = candles[candles.length - 1];
  const high = candles.length ? Math.max(...candles.map((c) => c.h)) : null;
  const low = candles.length ? Math.min(...candles.map((c) => c.l)) : null;
  return (
    <section className="cdx-mkt-panel mdx-plinth" aria-labelledby="coin-chart-head">
      <SectionHead
        title={<span id="coin-chart-head">Price chart</span>}
        right={
          <Tabs
            size="sm"
            label="Candle size"
            value={range}
            onChange={setRange}
            options={CHART_RANGES.map((r) => ({ value: r, label: <><span aria-hidden="true">{r}</span><span className="sr-only">{CHART_RANGE_LABEL[r]} candles</span></> }))}
          />
        }
      />
      <div className="cdx-mkt-chart">
        {!mounted || waiting || (pool !== null && query.isPending) ? (
          <Skeleton className="cdx-mkt-chart__skeleton rounded-row" />
        ) : candles.length ? (
          <Suspense fallback={<Skeleton className="cdx-mkt-chart__skeleton rounded-row" />}>
            <PriceChart candles={candles} resetKey={`${mint}:${range}`} />
          </Suspense>
        ) : (
          <div className="cdx-mkt-chart__empty">
            <p>{query.isError || pool === null ? "The chart is unavailable right now. It will try again shortly." : "No trades in this range yet. The chart fills in as people buy and sell."}</p>
          </div>
        )}
      </div>
      {last && high !== null && low !== null ? (
        <p className="sr-only">
          {name} in {CHART_RANGE_LABEL[range]} candles: last close {usdPrice(last.c)}, high {usdPrice(high)}, low {usdPrice(low)} across {candles.length} candles.
        </p>
      ) : null}
      <p className="cdx-mkt__source">Candles in US dollars from GeckoTerminal, about a minute behind the chain. Drag or pinch to zoom.</p>
    </section>
  );
}

// ---------------------------------------------------------------- trades and holders

export function TradesSection({ data, pair, failed }: { data: CoinMarket | undefined; pair: Readonly<PairAsset>; failed: boolean }) {
  const now = useNow();
  const trades = data?.trades;
  return (
    <section className="cdx-mkt-panel mdx-plinth" aria-labelledby="coin-trades-head">
      <SectionHead title={<span id="coin-trades-head">Recent trades</span>} right={trades?.length ? `Last ${trades.length}` : undefined} />
      {trades?.length ? (
        <div className="cdx-mkt-table__scroll">
          <table className="cdx-mkt-table">
            <thead>
              <tr>
                <th scope="col">Age</th>
                <th scope="col">Side</th>
                <th scope="col" className="cdx-mkt-table__n">Value</th>
                <th scope="col" className="cdx-mkt-table__n">Tokens</th>
                <th scope="col">Trader</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={`${t.tx}:${t.wallet}:${t.tokens}`}>
                  <td className="num text-slate"><time dateTime={new Date(t.at).toISOString()}>{ageShort(t.at, Math.max(now, t.at))}</time></td>
                  <td className="cdx-mkt-table__side" data-dir={t.kind === "buy" ? "up" : "down"}>{t.kind === "buy" ? "Buy" : "Sell"}</td>
                  <td className="cdx-mkt-table__n num">
                    {t.usd != null ? usdShort(t.usd) : `${amountShort(t.quote)} ${pair.symbol}`}
                  </td>
                  <td className="cdx-mkt-table__n num">{amountShort(t.tokens)}</td>
                  <td>
                    <External href={solscanTx(t.tx)} label={`${t.kind === "buy" ? "Buy" : "Sell"} by ${shortAddress(t.wallet)} on Solscan`}>
                      <span className="num">{shortAddress(t.wallet)}</span>
                      <Icon name="external" size={12} />
                    </External>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cdx-mkt__empty">
          {!data && !failed ? "Loading trades…" : trades ? "No trades in the last 24 hours." : "Trades are unavailable right now."}
        </p>
      )}
    </section>
  );
}

export function HoldersSection({ data, failed }: { data: CoinMarket | undefined; failed: boolean }) {
  const holders = data?.holders;
  return (
    <section className="cdx-mkt-panel mdx-plinth" aria-labelledby="coin-holders-head">
      <SectionHead
        title={<span id="coin-holders-head">Top holders</span>}
        right={data?.holderCount != null ? `${data.holderCount.toLocaleString("en-US")}${data.holderCountCapped ? "+" : ""} in all` : undefined}
      />
      {holders?.length ? (
        <ol className="cdx-mkt-holders">
          {holders.map((h, i) => (
            <li key={h.owner}>
              <span className="cdx-mkt-holders__rank num">{i + 1}</span>
              <span className="cdx-mkt-holders__who">
                <External href={solscanAccount(h.owner)} label={`Holder ${shortAddress(h.owner)} on Solscan`}>
                  <span className="num">{shortAddress(h.owner)}</span>
                  <Icon name="external" size={12} />
                </External>
                {h.creator ? <span className="cdx-mkt-holders__tag">Creator</span> : null}
              </span>
              <span className="cdx-mkt-holders__share num">{shareText(h.share)}</span>
              <span className="cdx-mkt-holders__bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(1, h.share * 100))}%` }} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="cdx-mkt__empty">
          {!data && !failed ? "Loading holders…" : holders ? "No wallet holds this coin yet besides the curve." : "Holders are unavailable right now."}
        </p>
      )}
      {data?.curveShare != null && data.status !== "migrated" ? (
        <p className="cdx-mkt__source">The bonding curve holds {shareText(data.curveShare)} of the supply and is not counted as a holder.</p>
      ) : null}
    </section>
  );
}

