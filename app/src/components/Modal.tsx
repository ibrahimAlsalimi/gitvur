import { type ReactNode, useEffect, useId, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  className?: string;
  children: ReactNode;
}

/** A native modal dialog (focus trap and Esc come from the browser) with a titled header. */
export function Modal({ open, onClose, title, className = "", children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <div className="dialog-inner">
        <div className="dialog-header">
          <h2 className="dialog-title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  );
}
