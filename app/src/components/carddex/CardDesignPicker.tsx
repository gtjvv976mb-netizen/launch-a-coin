import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { CARD_DESIGNS, getCardDesign } from "../../lib/carddex/designs";

export function CardDesignPicker({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const id = useId();
  const selected = getCardDesign(value);
  return (
    <div className={`cdx-design-picker ${className}`}>
      <label htmlFor={id} className="mb-2 block text-[13px] font-semibold text-ink">
        Card design
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mdx-input min-h-11 w-full text-[16px]"
      >
        {(
          [
            ["classic", "Trading card classics"],
            ["premium", "Premium collection"],
            ["stocks", "Stock-linked editions"],
            ["limited", "Limited editions"],
          ] as const
        ).map(([key, label]) => (
          <optgroup key={key} label={label}>
            {CARD_DESIGNS.filter((d) => d.category === key).map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="mt-2 text-[13px] leading-relaxed text-slate">
        {selected.name} stays with this card. Market cap never changes its design.
      </p>
      {selected.stock && (
        <p className="cdx-stock-reference">
          <span>
            Stock reference <b>{selected.stock.ticker}</b>
          </span>
          <span>
            Reference pair <b>{selected.stock.pair}</b>
          </span>
        </p>
      )}
      <Link
        to="/levels"
        search={{ design: value }}
        className="mdx-link mt-1 inline-flex min-h-11 items-center text-[13px]"
      >
        Explore all {CARD_DESIGNS.length} designs ↗
      </Link>
    </div>
  );
}
