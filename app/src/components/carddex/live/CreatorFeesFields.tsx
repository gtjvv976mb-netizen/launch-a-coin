import { useId, type ReactNode } from "react";
import { Field, Input } from "../../mintdex/ui";
import { decimalText } from "./FeeSplitFields";
import {
  CREATOR_FEES_TITLE, CREATOR_KEEPS_HINT, CREATOR_KEEPS_LABEL, FEE_RATE_HINT, FEE_RATE_LABEL, FEE_RATE_PERMANENT, HOLDERS_HINT, HOLDERS_LABEL,
  HOLDERS_PERMANENT, HOLDERS_WHO_PAYS, type CreatorFeesDraft,
} from "./creator-fees";

/**
 * "Creator fees" in Launch's More options: one choice between two models that can't be combined, "Creator keeps fees"
 * (the default; the optional "Share creator fees" split sits under it as `split`) and "Holders get the fees" (pump.fun
 * holder rewards, permanent). Each model shows only while pump.fun allows it (`holders`); the custom rate field shows
 * only on a custom pair while pump.fun accepts one (`rateMax`). The same look as the fee split and announcement boxes.
 */
export function CreatorFeesFields({ value, onChange, holders, holdersOffered = true, holdersNote = null, rateMax, rateNote = null, rateError, disabled, split }: {
  value: CreatorFeesDraft; onChange(next: CreatorFeesDraft): void;
  /** Holder rewards can be chosen (pump.fun's Global allows them), or this saved launch chose them. */
  holders: boolean;
  /** False when pump.fun is known not to offer holder rewards now: the choice can't be picked again once left. */
  holdersOffered?: boolean;
  /** Why a shown holders choice will be refused (pump.fun switched them off). */
  holdersNote?: string | null;
  /** A plain word about the typed rate: kept unchecked, or not used for this pair. */
  rateNote?: string | null;
  /** The highest custom rate in basis points, or null when no custom rate can be set for this pair. */
  rateMax: number | null;
  rateError: string | null; disabled: boolean;
  /** The "Share creator fees" group, shown under "Creator keeps fees" only. */
  split?: ReactNode;
}) {
  const noteId = useId(), name = useId();
  return <fieldset className="cdx-launch-fees cdx-launch-creator-fees" disabled={disabled} aria-describedby={noteId}>
    <legend className="cdx-launch-fees__title">{CREATOR_FEES_TITLE}</legend>
    {holders ? <div role="radiogroup" aria-label={CREATOR_FEES_TITLE} className="cdx-launch-creator-fees__choices">
      <label className="cdx-live-check cdx-launch-fees__toggle">
        <input id="creator-fees-creator" type="radio" name={name} checked={!value.holders} onChange={() => onChange({ ...value, holders: false })} />
        <span><span className="cdx-launch-fees__title">{CREATOR_KEEPS_LABEL}</span> <span className="cdx-launch-fees__hint">{CREATOR_KEEPS_HINT}</span></span>
      </label>
      <label className="cdx-live-check cdx-launch-fees__toggle">
        <input id="creator-fees-holders" type="radio" name={name} checked={value.holders} disabled={!holdersOffered && !value.holders} onChange={() => onChange({ ...value, holders: true })} />
        <span><span className="cdx-launch-fees__title">{HOLDERS_LABEL}</span> <span className="cdx-launch-fees__hint">{HOLDERS_HINT}</span></span>
      </label>
    </div> : null}
    {holders && holdersNote ? <p className="cdx-launch-note" role="status">{holdersNote}</p> : null}
    {value.holders && holders ? <div className="cdx-launch-note">
      <p><strong>{HOLDERS_PERMANENT}</strong></p>
      <p>{HOLDERS_WHO_PAYS}</p>
    </div> : split}
    {rateMax !== null ? <div className="cdx-launch-creator-fees__rate">
      <Field label={FEE_RATE_LABEL} htmlFor="creator-fee-rate" error={rateError} className="cdx-launch-f">
        <Input id="creator-fee-rate" numeric suffix="%" inputMode="decimal" value={value.rate} onChange={e => onChange({ ...value, rate: decimalText(e.target.value).slice(0, 5) })}
          placeholder="Standard" autoComplete="off" enterKeyHint="next" aria-invalid={rateError ? true : undefined} aria-describedby={`${rateError ? "creator-fee-rate-help " : ""}${noteId}-rate`} />
      </Field>
      <div id={`${noteId}-rate`} className="cdx-launch-note">
        <p>{FEE_RATE_HINT} Up to {(rateMax / 100).toFixed(2)}%.</p>
        {value.rate.trim() ? <p>{FEE_RATE_PERMANENT}</p> : null}
        {rateNote ? <p>{rateNote}</p> : null}
      </div>
    </div> : rateNote ? <p className="cdx-launch-note">{rateNote}</p> : null}
    <p id={noteId} className="sr-only">{value.holders && holders ? HOLDERS_PERMANENT : CREATOR_KEEPS_HINT}</p>
  </fieldset>;
}
