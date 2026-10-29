import type { ReactNode } from "react";

import { Button, Modal } from "./ui";

// ---------------------------------------------------------------- confirm dialog

/**
 * A one-page question: the consequence in one or two sentences, then [cancel] [confirm] on the right. tone "danger"
 * (a choice that cannot be undone) draws the confirm in the negative recipe and puts focus on the cancel, so Enter
 * never takes the irreversible answer by accident.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  pending = false,
  pendingLabel,
  tone = "primary",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  tone?: "primary" | "danger";
  onConfirm: () => void;
}) {
  const danger = tone === "danger";
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="cdx-confirm">
        <div className="cdx-overlay-copy">{children}</div>
        <div className="cdx-overlay-actions mdx-sheet-foot">
          <Button variant="outline" data-autofocus={danger || undefined} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            pending={pending}
            pendingLabel={pendingLabel}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
