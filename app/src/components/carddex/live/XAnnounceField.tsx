import { X_ANNOUNCE_HINT, X_ANNOUNCE_LABEL } from "../../../lib/carddex/live/x-announce";

/**
 * "Announce my coin on @launchacard" in Launch's More options: off by default, offered only while announcements are
 * on (CARDDEX_X_AUTOPOST). Ticked, the launch is saved with the request and @launchacard posts it once its card is
 * confirmed. The same look as "Share creator fees" above it.
 */
export function XAnnounceField({ checked, onChange, disabled }: { checked: boolean; onChange(next: boolean): void; disabled: boolean }) {
  return <div className="cdx-launch-fees">
    <label className="cdx-live-check cdx-launch-fees__toggle">
      <input id="x-announce" type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span><span className="cdx-launch-fees__title">{X_ANNOUNCE_LABEL}</span> <span className="cdx-launch-fees__hint">{X_ANNOUNCE_HINT}</span></span>
    </label>
  </div>;
}
