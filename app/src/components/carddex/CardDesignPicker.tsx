import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { CARD_DESIGNS } from "../../lib/carddex/designs";

import { boundQuoteForDesign, defaultQuoteForDesign } from "../../lib/carddex/pairs";
import { PairBadge } from "./QuoteAssetPicker";

export function CardDesignPicker({
  value,
  onChange,
  className = "",
  quoteAssetKey,
  ticker,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (key: string) => void;
  className?: string;
  quoteAssetKey?: string;
  ticker?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const quoteKey = quoteAssetKey ?? defaultQuoteForDesign(value).key;
  return (
    <div className={`cdx-design-picker ${compact ? "cdx-design-picker--compact" : ""} ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-[13px] font-semibold text-ink">
          Card design
        </label>
        <Link
          to="/levels"
          search={{ design: value, quote: quoteKey }}
          className="mdx-link inline-flex min-h-11 items-center text-[12px]"
        >
          See all {CARD_DESIGNS.length} ↗
        </Link>
      </div>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mdx-input min-h-11 w-full text-[16px]"
      >
        {(
          [
            ["classic", "Trading card classics"],
            ["premium", "Premium collection"],
            ["stocks", "Tokenized-stock paired finishes"],
            ["limited", "Limited editions"],
          ] as const
        ).map(([key, label]) => (
          <optgroup key={key} label={label}>
            {CARD_DESIGNS.filter((d) => d.category === key).map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}{boundQuoteForDesign(d.key) ? ` · ${boundQuoteForDesign(d.key)!.symbol} pair` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {!compact ? <><p className="mt-2 text-[13px] leading-relaxed text-slate">
        One permanent finish. Paired editions select their matching quote asset.
      </p>
      <PairBadge quoteAssetKey={quoteKey} ticker={ticker || "YOUR TOKEN"} compact /></> : null}
    </div>
  );
}
