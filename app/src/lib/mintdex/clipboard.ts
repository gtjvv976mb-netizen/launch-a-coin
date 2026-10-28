// Copy text that always works or says why (backlog P1-26). Client only; no React.
//
// 1. The async Clipboard API (needs a secure context and, in some embeds, a permission).
// 2. The old hidden textarea + execCommand("copy") path, which still works over plain HTTP and in most
//    embeds and in-app browsers that block the Clipboard API.
// 3. Neither worked: the caller shows the text selected in a field and asks for Ctrl or Cmd+C.

export type CopyResult = "copied" | "blocked";

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  // Off screen, not display:none (a hidden field cannot be selected); 16px so iOS does not zoom.
  ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;";
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}

export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // Blocked (NotAllowedError, an embed, a permission prompt dismissed): try the old path.
  }
  return legacyCopy(text) ? "copied" : "blocked";
}

/** "Cmd" on Apple devices, "Ctrl" elsewhere, for the manual copy hint. */
export function copyKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "Cmd" : "Ctrl";
}
