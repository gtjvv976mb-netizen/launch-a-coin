import { LAMPORTS, TOKEN_UNIT } from "./constants";

export function sol(lamports: number, digits?: number) {
  const v = lamports / LAMPORTS;
  const d = digits ?? (Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 3);
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Lamports as SOL without trailing zeros: 20_000_000 -> "0.02", 2_000_000_000 -> "2" (at most `max` decimals). */
export function solPlain(lamports: number, max = 4) {
  return String(Number((lamports / LAMPORTS).toFixed(max)));
}

export function usdCompact(usd: number) {
  // Promote values that would round up to the next unit, so $999,700 reads "$1M" (not "$1000K") and $999.70 reads "$1K".
  if (usd >= 999_500) return `$${(usd / 1_000_000).toFixed(usd >= 10_000_000 ? 1 : 2).replace(/\.0+$/, "")}M`;
  if (usd >= 999.5) return `$${(usd / 1_000).toFixed(usd >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `$${usd.toFixed(0)}`;
}

const USD_FULL = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$71,771": whole dollars with separators (the Coin page hero, spec 3.3). */
export function usdFull(usd: number) {
  return USD_FULL.format(Math.round(usd));
}

export function tokens(units: number) {
  const v = units / TOKEN_UNIT;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function pct(v: number) {
  const s = (v * 100).toFixed(Math.abs(v) >= 1 ? 0 : 1);
  return `${v >= 0 ? "+" : ""}${s}%`;
}

export function priceText(p: number) {
  if (p === 0) return "0";
  if (p >= 0.01) return p.toFixed(4);
  const e = Math.floor(Math.log10(p));
  return p.toFixed(Math.min(12, -e + 3));
}

export function timeAgo(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * How a player is named in a row: "@ana" for a handle. On devnet a wallet without a MintDex handle goes by its
 * short address ("BiHs...dFtQ"), which takes no "@".
 */
export function atName(handle: string) {
  return handle.includes("...") ? handle : `@${handle}`;
}

export function dexNo(n: number) {
  return `No. ${String(n).padStart(3, "0")}`;
}

/**
 * What an amount field keeps of what was typed or pasted: digits and ONE decimal point, with at most `decimals`
 * digits after it (SOL has 9, tokens 6). "1.571.6" becomes "1.5716", "2..5" becomes "2.5".
 */
export function cleanAmount(raw: string, decimals = 9) {
  const t = raw.replace(/[^0-9.]/g, "");
  const dot = t.indexOf(".");
  if (dot < 0) return t;
  return `${t.slice(0, dot)}.${t.slice(dot + 1).replace(/\./g, "").slice(0, decimals)}`;
}

/** Parse a user-typed SOL amount into lamports (NaN when invalid). */
export function parseSol(input: string) {
  const t = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * LAMPORTS);
}

export function parseTokens(input: string) {
  const t = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * TOKEN_UNIT);
}

/** "in 3h" / "in 12m" until a timestamp (at least "in 1m"). */
export function untilText(ms: number, now = Date.now()) {
  const mins = Math.max(1, Math.ceil((ms - now) / 60_000));
  return mins >= 60 ? `in ${Math.ceil(mins / 60)}h` : `in ${mins}m`;
}
