/** Figures on a coin's market panels. Every function takes a real number; callers show a dash for null. */

const sig = (value: number, digits: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: digits }).format(value);

/** A price, which for a fresh pump.fun coin is a millionth of a dollar: four significant digits, never rounded to 0. */
export function priceFigure(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return sig(value, 4);
}
export const usdPrice = (value: number) => `$${priceFigure(value)}`;

/** Picks the unit after rounding, so 999,999 reads "1.00M" (never "1000K") and 99,960 reads "100K" (never "100.0K"). */
function scaled(value: number, units: [number, string][], decimals: (abs: number) => number): string | null {
  const abs = Math.abs(value);
  for (let i = 0; i < units.length; i++) {
    const [size, suffix] = units[i];
    if (abs < size * 0.9995 && i < units.length - 1) continue;
    let n = abs / size, d = decimals(n), text = n.toFixed(d);
    if (Number(text) >= 1000 && i > 0) { const [up, upSuffix] = units[i - 1]; n = abs / up; d = decimals(n); return `${value < 0 ? "-" : ""}${n.toFixed(d)}${upSuffix}`; }
    // Rounding up into the next decimal band ("99.96" -> "100.0") takes that band's decimals.
    if (decimals(Number(text)) !== d) { d = decimals(Number(text)); text = n.toFixed(d); }
    return `${value < 0 ? "-" : ""}${text}${suffix}`;
  }
  return null;
}
const SHORT_UNITS: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];

/** Dollars in a stat or a row: "$2.67K", "$1.20M", "$84", "$0.92", "<$0.01". */
export function usdShort(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return "$0";
  if (abs < 0.01) return value < 0 ? "-<$0.01" : "<$0.01";
  if (abs < 999.5) return `${value < 0 ? "-" : ""}$${abs.toFixed(abs >= 99.5 ? 0 : 2)}`;
  const text = scaled(abs, SHORT_UNITS, (n) => (n >= 100 ? 0 : n >= 10 ? 1 : 2))!;
  return `${value < 0 ? "-" : ""}$${text}`;
}

/** A count of tokens: "12.4M", "830K", "1,204". */
export function amountShort(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs < 1) return sig(value, 3);
  if (abs < 9999.5) return value.toLocaleString("en-US", { maximumFractionDigits: abs >= 100 ? 0 : 2 });
  return `${value < 0 ? "-" : ""}${scaled(abs, SHORT_UNITS, (n) => (n >= 100 ? 0 : n >= 10 ? 1 : 2))}`;
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

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
/**
 * A chart axis price: four significant digits, and a tiny price's leading zeros counted in a subscript, as trading
 * charts write them ("0.0₅2674" is 0.000002674), so neighbouring ticks never read the same.
 */
export function axisPrice(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1) return value.toFixed(abs >= 1000 ? 0 : 2);
  // toExponential rounds first, so a mantissa that rounds up to 10 moves the exponent (never a price ten times off).
  const [mantissa, exponent] = abs.toExponential(3).split("e");
  const e = Number(exponent);
  if (e >= -3) return `${value < 0 ? "-" : ""}${Number(abs.toPrecision(4)).toFixed(3 - e)}`;
  const zeros = -e - 1;
  return `${value < 0 ? "-" : ""}0.0${String(zeros).split("").map((d) => SUBSCRIPT[Number(d)]).join("")}${mantissa.replace(".", "")}`;
}
