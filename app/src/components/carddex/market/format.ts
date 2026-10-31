/** Figures on a coin's market panels. Every function takes a real number; callers show a dash for null. */

const sig = (value: number, digits: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: digits }).format(value);

/** A price, which for a fresh pump.fun coin is a millionth of a dollar: four significant digits, never rounded to 0. */
export function priceFigure(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return sig(value, 4);
}
export const usdPrice = (value: number) => `$${priceFigure(value)}`;

/** Dollars in a stat: "$2.67K", "$1.20M", "$84", "$0.92". */
export function usdShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(abs >= 1e5 ? 0 : abs >= 1e4 ? 1 : 2)}K`;
  if (abs >= 1) return `$${value.toFixed(abs >= 100 ? 0 : 2)}`;
  return `$${value.toFixed(2)}`;
}

/** A count of tokens: "12.4M", "830K", "1,204". */
export function amountShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  if (abs >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return sig(value, 3);
}

/** A share of supply: "12.4%", "0.82%", "<0.01%". */
export function shareText(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 0.01) return "<0.01%";
  return `${pct.toFixed(pct >= 10 ? 1 : 2)}%`;
}

export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** "12s", "4m", "3h", "2d": the age of a trade, kept short for a table column. */
export function ageShort(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
