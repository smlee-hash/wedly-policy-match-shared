"use client";

// 행을 누르면 열리는 상세 서랍 — 넓은 화면(>820px)은 오른쪽에서, 820px 이하는 아래에서 올라온다.
// 열고 닫는 값은 부모가 쥔다. 닫는 길은 셋: 「닫기」 단추 · Esc · 바깥(어두운 바탕) 누르기.
import { useEffect, useRef, type ReactNode } from "react";

/** Esc 를 누르면 닫는 키 손잡이 — 브라우저 없이도 잴 수 있게 따로 뗀다. */
export function drawerKeyHandler(onClose: () => void): (e: { key: string }) => void {
  return (e) => {
    if (e.key === "Escape") onClose();
  };
}

const BTN_CLOSE =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-[10px] border border-wedly-bd bg-white px-4 text-xs " +
  "font-semibold text-wedly-t1 transition-colors hover:bg-wedly-bg-gray focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2";

/**
 * 창 모양 — 기본이 좁은 화면(아래에서 올라오는 창), 821px 부터 오른쪽 서랍으로 바뀐다.
 * 올라오는 움직임도 화면 폭별로 따로 준다(둘을 한꺼번에 주면 넓은 화면에서 비스듬히 들어온다).
 */
export const DRAWER_PANEL_CLASS =
  "relative z-10 flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-wedly-bd bg-white shadow-2xl " +
  "animate-in duration-300 focus:outline-none max-[820px]:slide-in-from-bottom " +
  "min-[821px]:slide-in-from-right min-[821px]:h-full min-[821px]:max-h-none min-[821px]:w-[440px] " +
  "min-[821px]:max-w-full min-[821px]:rounded-none min-[821px]:border-y-0 min-[821px]:border-r-0";

interface Props {
  open: boolean;
  /** 서랍 머리에 보일 공고 이름. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function ResultDrawer({ open, title, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = drawerKeyHandler(onClose);
    document.addEventListener("keydown", onKey);
    // 열리면 초점을 창으로 — 키보드로 연 사람이 뒤 화면에 남지 않게 한다.
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div data-area="detail-drawer" className="fixed inset-0 z-50 flex items-end justify-end min-[821px]:items-stretch">
      <div data-drawer="backdrop" className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={DRAWER_PANEL_CLASS}>
        <div className="flex shrink-0 items-start gap-3 border-b border-wedly-bd px-4 py-3">
          <h2 className="line-clamp-2 min-w-0 flex-1 break-keep text-wedly-section font-semibold text-wedly-t1">{title}</h2>
          <button type="button" onClick={onClose} className={BTN_CLOSE}>
            닫기
          </button>
        </div>
        <div data-drawer="body" className="min-h-0 flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
