import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "../../../lib/carddex/live/market";
import { priceFigure, usdShort } from "./format";

/*
 * The coin's candlestick chart (TradingView's lightweight-charts, Apache-2.0, its attribution kept): price candles over
 * a volume histogram, in US dollars. Client only and lazy-loaded by CoinMarket.tsx, so its canvas never runs on the
 * server and its code loads only on a coin page. Colours come from the theme tokens. The legend above the plot reads
 * the candle under the pointer, or the newest one.
 */

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** A token colour at an alpha step, for the volume bars ("#8cc79a" -> "rgb(140 199 154 / 0.4)"). */
function withAlpha(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

export default function PriceChart({ candles, resetKey }: { candles: Candle[]; resetKey: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fitted = useRef<string | null>(null);
  const volumeColors = useRef({ up: "", down: "" });
  const [hover, setHover] = useState<Candle | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const up = token("--color-up") || "#8cc79a", down = token("--color-down") || "#f78c8c";
    const slate = token("--color-slate"), hairline = token("--color-hairline");
    const api = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: slate, fontFamily: token("--font-sans"), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: withAlpha(hairline, 0.6) }, horzLines: { color: withAlpha(hairline, 0.6) } },
      rightPriceScale: { borderColor: hairline },
      timeScale: { borderColor: hairline, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => `$${priceFigure(p)}` },
    });
    const candlesSeries = api.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
      priceFormat: { type: "custom", formatter: (p: number) => `$${priceFigure(p)}`, minMove: 1e-12 },
    });
    candlesSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });
    const volumeSeries = api.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const onMove = (param: MouseEventParams) => {
      const bar = param.time ? (param.seriesData.get(candlesSeries) as { open: number; high: number; low: number; close: number } | undefined) : undefined;
      const vol = param.time ? (param.seriesData.get(volumeSeries) as { value: number } | undefined) : undefined;
      setHover(bar && param.time ? { t: Number(param.time), o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: vol?.value ?? 0 } : null);
    };
    api.subscribeCrosshairMove(onMove);
    chart.current = api; price.current = candlesSeries; volume.current = volumeSeries;
    volumeColors.current = { up: withAlpha(up, 0.45), down: withAlpha(down, 0.45) };
    return () => {
      api.unsubscribeCrosshairMove(onMove);
      api.remove();
      chart.current = null; price.current = null; volume.current = null; fitted.current = null;
    };
  }, []);

  useEffect(() => {
    const api = chart.current, p = price.current, v = volume.current;
    if (!api || !p || !v) return;
    const colors = volumeColors.current;
    p.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    v.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, value: c.v, color: c.c >= c.o ? colors.up : colors.down })));
    // A new range starts zoomed to fit; a refresh of the same range keeps the visitor's zoom and scroll.
    if (fitted.current !== resetKey && candles.length) {
      api.timeScale().fitContent();
      fitted.current = resetKey;
    }
  }, [candles, resetKey]);

  const shown = hover ?? candles[candles.length - 1] ?? null;
  const dir = shown ? (shown.c >= shown.o ? "up" : "down") : undefined;
  return (
    <div className="cdx-pchart">
      <p className="cdx-pchart__legend num" aria-hidden="true" data-dir={dir}>
        {shown ? (
          <>
            <span>O <b>${priceFigure(shown.o)}</b></span>
            <span>H <b>${priceFigure(shown.h)}</b></span>
            <span>L <b>${priceFigure(shown.l)}</b></span>
            <span>C <b>${priceFigure(shown.c)}</b></span>
            <span>Vol <b>{usdShort(shown.v)}</b></span>
          </>
        ) : null}
      </p>
      <div ref={host} className="cdx-pchart__plot" />
    </div>
  );
}
