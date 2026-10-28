/** Exact quote parsing for real funds. No simulated reserve math or floating-point rounding. */
export function parseLiveAmount(value: string, decimals: number): string | null {
  const input = value.trim();
  if (!input) return "0";
  if (input.length > 100 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
  const [whole = "0", fraction = ""] = input.split(".");
  if (fraction.length > decimals) return null;
  const amount = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return amount <= 18_446_744_073_709_551_615n ? amount.toString() : null;
}
export function formatLiveAmount(amount: string | number, decimals: number): string {
  const atoms = BigInt(amount);
  const scale = 10n ** BigInt(decimals);
  const whole = atoms / scale, fraction = (atoms % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
