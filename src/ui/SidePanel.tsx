"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@wedly/ui-shared/ui/cn";

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
  /**
   * 참이면 뒤 배경을 어둡게 덮지 않고, 뒤쪽을 계속 누를 수 있게 둔다.
   * 목록을 보면서 상세를 읽어야 하는 화면에서 쓴다. 기본은 거짓(지금까지의 동작 그대로).
   */
  inline?: boolean;
}

export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  widthClass = "sm:max-w-lg",
  inline = false,
}: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  /**
   * 초점 가둠 — Tab 이 패널 안에서만 돈다.
   *
   * 왜 필요한가: 이 패널은 `aria-modal="true"` 라고 스스로 밝히는데, 실제로는 Tab 을 몇 번 누르면
   * 뒤쪽 목록으로 초점이 새어 나갔다. 읽어 주는 도구는 「뒤는 없는 셈」이라 안내하는데 키보드는
   * 뒤로 가 버리니, 눈으로 못 보는 사용자가 지금 어디에 있는지 알 수 없게 된다.
   *
   * ★ **더하기만 한다** — Esc·덮개 클릭·초점 이동 등 기존 동작은 그대로다.
   * ★ 덮개 없는 모드(inline)는 「뒤쪽을 계속 쓰라」고 만든 모드라 가두지 않는다.
   */
  useEffect(() => {
    if (!open || inline) return;
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const list = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && root.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open, inline]);

  if (!open) return null;

  return (
    <div className={cn("fixed inset-0 z-50 flex justify-end", inline && "pointer-events-none")}>
      {/* Backdrop — 덮개 없는 모드에서는 아예 그리지 않는다(뒤쪽을 계속 쓸 수 있게) */}
      {!inline && (
        <div
          className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={inline ? undefined : "true"}
        aria-labelledby={title ? "side-panel-title" : undefined}
        aria-describedby={description ? "side-panel-description" : undefined}
        className={cn(
          "pointer-events-auto relative z-10 flex flex-col w-full bg-white shadow-2xl border-l border-wedly-bd",
          "animate-in slide-in-from-right duration-300",
          widthClass,
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-wedly-bd shrink-0">
            <div className="flex flex-col gap-1 min-w-0">
              {title && (
                <h2 id="side-panel-title" className="text-wedly-section font-semibold text-wedly-t1 truncate">
                  {title}
                </h2>
              )}
              {description && (
                <p id="side-panel-description" className="text-wedly-sub text-wedly-t2">
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

        {/* Body — ★ p-4 를 바꾸면 API 현황판 서랍이 깨진다: 그쪽이 -m-4 로 이 여백을 상쇄해
            구분선을 양끝까지 긋는다(ApiStatusBoard.tsx 서랍 본문). 여백을 조정하려면 그쪽도 함께. */}
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
