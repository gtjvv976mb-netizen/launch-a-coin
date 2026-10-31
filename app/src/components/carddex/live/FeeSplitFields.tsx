import { useId, useState } from "react";
import { Field, Input } from "../../mintdex/ui";
import {
  checkFeeSplit, FEE_SPLIT_DEFAULT, FEE_SPLIT_FREE, FEE_SPLIT_PERMANENT, FEE_SPLIT_STEP, FEE_SPLIT_WALLETS, feeSplitTotal, firstFeeSplitRows,
  formatShare, MAX_FEE_RECIPIENTS, type FeeSplitCheck, type FeeSplitDraft,
} from "./fee-split";

/** A typed decimal as digits and one kind of point: a comma (the only separator on comma-locale decimal keypads) reads as ".". */
export const decimalText = (value: string) => value.replace(/,/g, ".").replace(/[^0-9.]/g, "");

/** The id of the first field in the group that needs something, for the form's focus order (null when all pass). */
export function firstFeeSplitField(check: FeeSplitCheck): string | null {
  const row = check.rows.findIndex(entry => entry.wallet || entry.percent);
  if (row >= 0) return check.rows[row].wallet ? `fee-wallet-${row}` : `fee-share-${row}`;
  return check.total ? check.rows.length ? `fee-share-0` : "fee-split-on" : null;
}

/**
 * "Share creator fees" in Launch's More options: off by default (pump.fun's default, the creator keeps 100%). On, rows
 * of a Solana wallet and its percent (up to MAX_FEE_RECIPIENTS), the first prefilled with the connected wallet, and a
 * live total that must read 100%. Each error sits under its own field and is tied to it; the group's total error and
 * the permanence note follow the rows. The split itself is set after the card by its own approval.
 */
export function FeeSplitFields({ value, onChange, connected, disabled, showErrors }: {
  value: FeeSplitDraft; onChange(next: FeeSplitDraft): void; connected: string | null; disabled: boolean; showErrors: boolean;
}) {
  const noteId = useId();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const check = checkFeeSplit(value.rows), total = feeSplitTotal(value.rows);
  const shown = (id: string, text: string) => showErrors || (!!touched[id] && text.trim() !== "");
  const update = (index: number, field: "wallet" | "percent", text: string) =>
    onChange({ ...value, rows: value.rows.map((row, i) => i === index ? { ...row, [field]: text } : row) });
  const toggle = (on: boolean) => onChange({ on, rows: on && !value.rows.length ? firstFeeSplitRows(connected) : value.rows });
  const add = () => {
    if (value.rows.length >= MAX_FEE_RECIPIENTS) return;
    onChange({ ...value, rows: [...value.rows, { wallet: "", percent: "" }] });
    requestAnimationFrame(() => document.getElementById(`fee-wallet-${value.rows.length}`)?.focus());
  };
  const remove = (index: number) => {
    const rows = value.rows.filter((_, i) => i !== index);
    onChange({ on: rows.length > 0 && value.on, rows });
    requestAnimationFrame(() => document.getElementById(rows.length ? `fee-wallet-${Math.min(index, rows.length - 1)}` : "fee-split-on")?.focus());
  };
  const totalShown = value.on && check.total && (showErrors || value.rows.some(row => row.percent.trim()));
  return <fieldset className="cdx-launch-fees" disabled={disabled} aria-describedby={noteId}>
    <legend className="sr-only">Share creator fees</legend>
    <label className="cdx-live-check cdx-launch-fees__toggle">
      <input id="fee-split-on" type="checkbox" checked={value.on} onChange={e => toggle(e.target.checked)} />
      <span><span className="cdx-launch-fees__title">Share creator fees</span> <span className="cdx-launch-fees__hint">Up to {MAX_FEE_RECIPIENTS} wallets, set after your card.</span></span>
    </label>
    {value.on ? <>
      <ol className="cdx-launch-fees__rows" aria-label="Fee split recipients">
        {value.rows.map((row, index) => {
          const walletId = `fee-wallet-${index}`, shareId = `fee-share-${index}`;
          const walletMsg = check.rows[index].wallet && shown(walletId, row.wallet) ? check.rows[index].wallet : null;
          const shareMsg = check.rows[index].percent && shown(shareId, row.percent) ? check.rows[index].percent : null;
          return <li key={index} className="cdx-launch-fees__row">
            <Field label={`Wallet ${index + 1}`} htmlFor={walletId} error={walletMsg} className="cdx-launch-f cdx-launch-fees__wallet">
              <Input id={walletId} value={row.wallet} onChange={e => update(index, "wallet", e.target.value.trim())} onBlur={() => setTouched(t => ({ ...t, [walletId]: true }))}
                placeholder="Solana wallet address" autoComplete="off" spellCheck={false} enterKeyHint="next"
                aria-invalid={walletMsg ? true : undefined} aria-describedby={walletMsg ? `${walletId}-help` : undefined} className="cdx-live-address" />
            </Field>
            <Field label={`Share ${index + 1}`} htmlFor={shareId} error={shareMsg} className="cdx-launch-f cdx-launch-fees__share">
              <Input id={shareId} numeric suffix="%" inputMode="decimal" value={row.percent} onChange={e => update(index, "percent", decimalText(e.target.value).slice(0, 6))}
                onBlur={() => setTouched(t => ({ ...t, [shareId]: true }))} placeholder="0" autoComplete="off" enterKeyHint="next"
                aria-invalid={shareMsg ? true : undefined} aria-describedby={shareMsg ? `${shareId}-help` : totalShown ? "fee-split-total" : undefined} />
            </Field>
            <button type="button" className="mdx-link mdx-hit cdx-launch-fees__remove" aria-label={`Remove wallet ${index + 1}`} onClick={() => remove(index)}>Remove</button>
          </li>;
        })}
      </ol>
      <div className="cdx-launch-fees__foot">
        {value.rows.length < MAX_FEE_RECIPIENTS ? <button type="button" className="mdx-link mdx-hit" onClick={add}>Add recipient</button> : <span className="cdx-launch-fees__hint">{MAX_FEE_RECIPIENTS} wallets is the most</span>}
        <p className="cdx-launch-fees__total" data-ok={total === 10_000 || undefined} aria-live="polite">Total <span className="num">{formatShare(total)}</span></p>
      </div>
    </> : null}
    <div id={noteId} className="cdx-launch-note">
      {value.on ? <>
        {/* Not an alert: it changes on every keystroke, and the Total line above is already announced politely. */}
        {totalShown ? <p id="fee-split-total" className="cdx-launch-note__error">{check.total}</p> : null}
        <p>{FEE_SPLIT_PERMANENT}</p>
        <p>{FEE_SPLIT_FREE}</p>
        <p>{FEE_SPLIT_STEP}</p>
      </> : <p className="sr-only">{FEE_SPLIT_DEFAULT}</p>}
    </div>
  </fieldset>;
}
