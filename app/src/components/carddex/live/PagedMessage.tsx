/**
 * A status or error message, whole. It used to split long provider messages into 180-character pages; an error is
 * never cut mid-sentence now (code-06): it wraps, and the pane around it scrolls when it must. The name and props
 * stay, so every caller keeps working.
 */
export function PagedMessage({ text, alert = false }: { text: string; alert?: boolean }) {
  return <div className="cdx-paged-message" data-kind={alert ? "error" : "status"}>
    <p role={alert ? "alert" : "status"} className={alert ? "cdx-live-error" : undefined}>{text}</p>
  </div>;
}
