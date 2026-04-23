"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";

export default function Modal({ isOpen, onClose, title, children, footer, size = "md", closeOnOverlay = true, closeOnEscape = true, showCloseButton = true, className }) {
  const sizes = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", full: "max-w-4xl" };

  useEffect(() => {
    if (isOpen) { document.body.style.overflow = "hidden"; } else { document.body.style.overflow = ""; }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => { if (e.key === "Escape" && isOpen && closeOnEscape) onClose(); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeOnOverlay ? onClose : undefined} />
      <div className={cn("relative w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg animate-slide-up", sizes[size], className)}>
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <h2 className="text-[14px] font-medium text-[var(--color-text-main)]">{title}</h2>
            {showCloseButton && (
              <button onClick={onClose} className="p-1.5 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-bg-alt)] hover:text-[var(--color-text-main)] transition-colors">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>
        )}
        <div className="p-5 max-h-[calc(85vh-100px)] overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--color-border)]">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title = "Confirm", message, confirmText = "Confirm", cancelText = "Cancel", variant = "danger", loading = false }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={loading}>{cancelText}</Button><Button variant={variant} onClick={onConfirm} loading={loading}>{confirmText}</Button></>}>
      <p className="text-[13px] text-[var(--color-text-muted)]">{message}</p>
    </Modal>
  );
}
