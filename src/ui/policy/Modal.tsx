"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@wedly/ui-shared/ui/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  widthClass = "max-w-lg",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        aria-describedby={description ? "modal-description" : undefined}
        className={cn(
          "relative z-10 w-full bg-white rounded-2xl shadow-2xl border border-wedly-bd",
          "max-h-[85vh] overflow-hidden flex flex-col",
          widthClass,
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-wedly-bd shrink-0">
            <div className="flex flex-col gap-1 min-w-0">
              {title && (
                <h2 id="modal-title" className="text-wedly-section font-semibold text-wedly-t1 truncate">
                  {title}
                </h2>
              )}
              {description && (
                <p id="modal-description" className="text-wedly-sub text-wedly-t2">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className={cn(
                "shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg",
                "text-wedly-muted hover:text-wedly-t1 hover:bg-wedly-bg-gray",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent",
              )}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 px-6 py-4 border-t border-wedly-bd">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
