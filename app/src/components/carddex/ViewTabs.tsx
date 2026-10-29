import type { KeyboardEvent, ReactNode } from "react";

/** panel: the id of the element this tab shows, when each tab has its own mounted panel. disabled: the tab
 * cannot be chosen right now (arrow keys skip it). */
export type ViewTab = { id: string; label: ReactNode; selected: boolean; onSelect: () => void; panel?: string; disabled?: boolean };

/**
 * Tab and panel ids for a tab row (A11Y-10): pass the same `idBase` (from useId) to the row and to the panel.
 * Tabs get `${idBase}-tab-${id}`; by default every tab controls one shared panel, `${idBase}-panel`, which shows
 * whichever tab is selected.
 */
export const tabDomId = (idBase: string, id: string | number) => `${idBase}-tab-${id}`;
export const tabPanelDomId = (idBase: string) => `${idBase}-panel`;
export const tabPanelProps = (idBase: string, selected: string | number) => ({
  role: "tabpanel" as const,
  id: tabPanelDomId(idBase),
  "aria-labelledby": tabDomId(idBase, selected),
});

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
export function ViewTabs({ label, tabs, className = "", idBase }: { label: string; tabs: ViewTab[]; className?: string; idBase?: string }) {
  const anySelected = tabs.some((t) => t.selected);
  return (
    <div role="tablist" aria-label={label} className={className} onKeyDown={tabKeys}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={idBase ? tabDomId(idBase, t.id) : undefined}
          aria-controls={t.panel ?? (idBase ? tabPanelDomId(idBase) : undefined)}
          aria-selected={t.selected}
          tabIndex={t.selected || (!anySelected && i === 0) ? 0 : -1}
          disabled={t.disabled}
          onClick={t.onSelect}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
