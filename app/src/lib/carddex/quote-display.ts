import { usdCompact, usdFull } from "../mintdex/format";
import { getPairAsset } from "./pairs";

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

/**
 * An upper limit in a quote asset, shown so that typing it back is always allowed: rounded down (never up) to two
 * decimals, or to two significant digits below 0.01, with grouped digits and never compact ("27,781.12", "10.10").
 * Takes the quote's atoms.
 */
export function quoteCap(atoms: number | string, key?: string | null): string {
  const decimals = getPairAsset(key).decimals;
  const value = Number(atoms);
  if (!Number.isFinite(value) || value <= 0) return "0";
  const raw = BigInt(Math.floor(value));
  const unit = 10n ** BigInt(decimals);
  // Two decimals; under 0.01, enough decimals for two significant digits (within the asset's own decimals).
  const places = raw * 100n < unit ? Math.min(decimals, decimals - raw.toString().length + 2) : Math.min(2, decimals);
  const kept = raw / 10n ** BigInt(decimals - places);
  const step = 10n ** BigInt(places);
  const whole = new Intl.NumberFormat("en-US").format(kept / step);
  return places ? `${whole}.${(kept % step).toString().padStart(places, "0")}` : whole;
}

export function quoteNumber(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < .00001) return value.toPrecision(3);
  return new Intl.NumberFormat("en-US", compact
    ? {notation:"compact",maximumFractionDigits:2}
    : {maximumFractionDigits:Math.abs(value)<1?8:4}).format(value);
}

export function quoteAtoms(atoms: number | string, key?: string | null, compact = false): string {
  const decimals = getPairAsset(key).decimals;
  if (typeof atoms === "number" || compact) return quoteNumber(Number(atoms) / 10 ** decimals, compact);
  if (!/^-?\d+$/.test(atoms)) return "—";
  const raw = BigInt(atoms), negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const unit = 10n ** BigInt(decimals);
  const places = Math.min(decimals, absolute < unit ? 8 : 4);
  const scale = 10n ** BigInt(decimals - places);
  const rounded = (absolute + scale / 2n) / scale;
  const outputUnit = 10n ** BigInt(places);
  const whole = new Intl.NumberFormat("en-US").format(rounded / outputUnit);
  const fraction = (rounded % outputUnit).toString().padStart(places, "0").replace(/0+$/, "");
  return `${negative && rounded > 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

type Valuation = {mcapUsd?: number | null; mcapQuote?: number; quoteAssetKey?: string | null};
export function marketCapText(coin: Valuation, compact = true): string {
  if (coin.mcapUsd != null) return compact ? usdCompact(coin.mcapUsd) : usdFull(coin.mcapUsd);
  if (coin.mcapQuote == null) return "—";
  return `${quoteNumber(coin.mcapQuote, compact)} ${getPairAsset(coin.quoteAssetKey).symbol}`;
}

export function marketCapWatch(coin: Valuation): number {
  return coin.mcapUsd ?? coin.mcapQuote ?? 0;
}
