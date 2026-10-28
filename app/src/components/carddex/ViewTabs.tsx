import type { KeyboardEvent, ReactNode } from "react";

export type ViewTab = { id: string; label: ReactNode; selected: boolean; onSelect: () => void };

/**
 * Arrow keys, Home and End for a row of role="tab" buttons (automatic activation). Only the selected tab is in
 * the Tab order, so one Tab press moves past the whole row.
 */
export function tabKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0 || tabs.length < 2) return;
  e.preventDefault();
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
}

/** Panel switching as an ARIA tab list (A11Y-10): the label is read, and each option says "tab, selected". */
export function ViewTabs({ label, tabs, className = "" }: { label: string; tabs: ViewTab[]; className?: string }) {
  const anySelected = tabs.some((t) => t.selected);
  return (
    <div role="tablist" aria-label={label} className={className} onKeyDown={tabKeys}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.selected}
          tabIndex={t.selected || (!anySelected && i === 0) ? 0 : -1}
          onClick={t.onSelect}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
