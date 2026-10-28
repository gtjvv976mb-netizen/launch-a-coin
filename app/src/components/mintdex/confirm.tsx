import type { ReactNode } from "react";

import { Button, Modal } from "./ui";

// ---------------------------------------------------------------- confirm dialog

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  pending = false,
  pendingLabel,
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
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="cdx-confirm-copy text-pretty text-[15px] leading-[1.5] text-slate">
        {children}
      </div>
      <div className="cdx-confirm-actions mdx-sheet-foot flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </Button>
        <Button pending={pending} pendingLabel={pendingLabel} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
