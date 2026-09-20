"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "@wedly/ui-shared/ui/useAnchoredPosition";
import type { AnchoredPosition } from "@wedly/ui-shared/ui/anchoredPosition";
import { cn } from "@wedly/ui-shared/ui/cn";
import {
  nextIndex,
  typeAheadIndex,
  appendTypeAhead,
  isTypeAheadChar,
  initialHighlight,
  typeAheadStart,
  TYPE_AHEAD_RESET_MS,
  type OpenIntent,
  isTypeAheadActive,
} from "./selectKeyboard";
import { planGroupedOptions, splitGroupHeader } from "./selectGrouping";

export interface CustomSelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  className?: string;
  /**
   * **안쪽 여는 단추**에 붙일 클래스 — 겉 `div` 로만 가는 `className` 으로는 못 주는 자리다
   * (2026-09-04 자금 조달 지도 조작줄).
   *
   * ★왜 부품 기본 높이를 안 바꾸나: 이 부품을 ERP 43개 화면과 일루아 2개 화면이 쓴다(실측).
   *  기본을 `py-2.5`(42px)에서 정본 계단 `h-9`(36px)로 내리면 그 화면들이 전부 함께 바뀌는데,
   *  그건 승인된 범위가 아니다. 그래서 **부르는 쪽에서만** 높이를 준다.
   *  부품 전체를 정본 높이로 수렴시키는 일은 **별도 승인이 필요한 후속**이다.
   *
   * ★높이뿐 아니라 **글자 크기**도 이 길로 간다(2026-09-04 확인, 독립 검사 지적 ④).
   *  `cn`(`@wedly/ui-shared/src/ui/cn.ts`)이 WEDLY 글자 여섯 층을 「글자 크기」 무리로 등록해 두어
   *  `text-wedly-sub` 가 들어오면 아래 `BASE_CONTROL` 의 `text-sm` 을 **지운다** — 조작줄에서
   *  이 부품만 14px 이라 혼자 컸던 것을 부품 기본을 건드리지 않고 고칠 수 있었다.
   *  실제로 지워지는지는 `customSelect-render.test.tsx` 가 그려 낸 클래스에서 잰다.
   *
   * 값을 안 주면 `cn` 을 아예 안 태워 지금까지와 **글자 하나 같은** 클래스가 나간다(기본 불변).
   */
  controlClassName?: string;
  disabled?: boolean;
  /**
   * 여는 단추의 id. **바깥 `<label htmlFor>` 이 이 칸을 가리키게 하려면 필요하다**
   * (2026-08-28 적대적 리뷰: `<select>` 를 이 부품으로 바꾼 자리에서 라벨이 가리킬 곳을
   * 잃어, 라벨 글자를 눌러도 안 열리고 읽어 주는 장치는 이름 없는 칸으로 읽었다).
   */
  id?: string;
  /** 눈에 보이는 라벨을 못 붙이는 자리용 이름. */
  "aria-label"?: string;
  autoFocus?: boolean;
  /** 주면 여는 단추 title을 이 값으로 덮는다. 안 주면 선택된 라벨(없으면 없음). */
  title?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLButtonElement>) => void;
}

/**
 * 목록 위 휠 굴림을 목록 자신이 직접 처리한다(2026-09-15, 독립 리뷰 잔여 위험 ②를 운영 실측으로 확인).
 *
 * Radix 모달의 스크롤 잠금(react-remove-scroll)은 body 로 포털된 이 목록을 「바깥」으로 보고
 * 그 위의 휠 이벤트를 **크기와 관계없이 전부** 취소한다(운영 실측: deltaY 10~100 전부
 * defaultPrevented — 사유 9개 목록은 여유 94px 인데 8·9번째 항목에 못 내려간다).
 * 그래서 굴릴 수 있는 만큼은 여기서 직접 옮기고 기본 동작을 막는다 — 잠금 장치가 뒤에서
 * 취소해도 이미 옮긴 뒤라 결과가 같다. 끝에 닿아 더 못 옮기면 손대지 않아(기본 동작 유지)
 * 모달 밖에서는 종전처럼 바깥 화면으로 굴림이 이어진다. 가로 휠·확대(ctrl)는 건드리지 않는다.
 * 「옮겼는지」는 계산값이 아니라 실제 scrollTop 변화로 잰다 — scrollHeight·clientHeight 는
 * 정수인데 scrollTop 은 화면 배율에 따라 소수가 되어 계산값과 어긋날 수 있다(리뷰 D1).
 */
export function scrollListboxByWheel(event: WheelEvent): void {
  const ul = event.currentTarget as HTMLUListElement | null;
  if (!ul || event.ctrlKey || event.deltaY === 0) return;
  const step = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? ul.clientHeight : 1;
  const before = ul.scrollTop;
  ul.scrollTop = before + event.deltaY * step; // 브라우저가 0~최대로 알아서 자른다
  if (Math.abs(ul.scrollTop - before) < 1) return; // 못 옮겼다 — 기본 동작(바깥 굴림)을 둔다
  event.preventDefault();
}

/**
 * 열린 목록(`ul[role=listbox]`) 자체. `document.body` 로 포털되어 나가므로 **여는 단추가 어디에
 * 있든** 화면 맨 위층에 뜬다.
 *
 * ★`pointerEvents: "auto"` 를 명시하는 이유(2026-09-15, 컨설팅 업무 현황 「사유」 칸 실측):
 *  ERP 는 이 부품을 Radix `Dialog`(모달) 안에서도 쓴다. Radix 모달은 열려 있는 동안
 *  `body { pointer-events: none }` 을 걸고 자기 내용 상자에만 `pointer-events: auto` 를 준다.
 *  이 목록은 body 바로 아래로 포털되어 그 `none` 을 **상속**하므로, 눈에는 보이는데 누르면
 *  클릭이 목록을 통과해 아래 모달 본문에 떨어지고(`elementFromPoint` 실측), 바깥 클릭 처리기가
 *  목록을 닫아 버린다 — 「사유를 고를 수 없다」(NO. 기한 설정 후 사유 선택 불가, 2026-09-15).
 *  모달 밖에서는 body 가 `auto` 라 이 값이 있으나 없으나 같다(기본 불변).
 *  선택 자체는 React 트리 기준으로 모달 안이므로(포털이어도 React 이벤트는 트리를 따른다)
 *  Radix 의 「바깥 누름」 판정에 걸리지 않는다 — 그래서 여기 한 줄로 끝난다.
 */
export function CustomSelectListbox({
  menuRef,
  id,
  pos,
  children,
  onPressInside,
}: {
  menuRef: React.Ref<HTMLUListElement>;
  id: string;
  pos: AnchoredPosition;
  children: React.ReactNode;
  onPressInside?: () => void;
}) {
  const ulRef = useRef<HTMLUListElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLUListElement | null) => {
      ulRef.current = node;
      if (typeof menuRef === "function") menuRef(node);
      else if (menuRef) (menuRef as React.MutableRefObject<HTMLUListElement | null>).current = node;
    },
    [menuRef],
  );
  useEffect(() => {
    const ul = ulRef.current;
    if (!ul) return;
    ul.addEventListener("wheel", scrollListboxByWheel, { passive: false });
    return () => ul.removeEventListener("wheel", scrollListboxByWheel);
  }, []);
  return (
    <ul
      ref={setRefs}
      id={id}
      role="listbox"
      style={{
        position: "fixed",
        pointerEvents: "auto",
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        ...(pos.placement === "down" ? { top: pos.top } : { bottom: pos.bottom }),
      }}
      className="z-[100] bg-white border border-wedly-bd rounded-xl shadow-lg overflow-auto py-1"
      onMouseDown={(event) => {
        // 목록이 포커스를 빼앗으면 부모 onBlur가 편집기를 먼저 내려 클릭 선택이 죽는다.
        event.preventDefault();
        onPressInside?.();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        onPressInside?.();
      }}
    >
      {children}
    </ul>
  );
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "선택해 주세요",
  className = "",
  controlClassName = "",
  disabled = false,
  id,
  "aria-label": ariaLabel,
  autoFocus,
  title,
  onClick,
  onKeyDown,
  onBlur,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  // 키보드가 가리키는 항목(-1 = 없음). 마우스로 열 때는 -1이라 겉모습이 종전과 같다.
  const [highlight, setHighlight] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const pos = useAnchoredPosition(isOpen, triggerRef);
  const menuId = useId();
  // 타자 검색 버퍼와 마지막 입력 시각(렌더와 무관해 ref로 둔다).
  const typeBufRef = useRef("");
  const typeAtRef = useRef(0);
  // 직전 조작이 키보드였는지. 마우스 hover로 하이라이트가 바뀔 때는 목록을 따라 스크롤하지 않는다
  // (커서 밑에서 항목이 움직이는 종전에 없던 현상을 막는다).
  const kbNavRef = useRef(false);
  // 목록 안을 누르는 동안 blur가 새면 부모 편집기가 먼저 내려간다. 그 구간만 콜백을 막는다.
  const listboxPointerRef = useRef(false);
  const isOptionDisabled = (index: number) => !!options[index]?.disabled;

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;
  const optionId = (index: number) => `${menuId}-opt-${index}`;
  const menuMounted = isOpen && pos !== null;

  // 닫을 때의 뒷정리(하이라이트·타자 버퍼 비우기)를 한 곳에 모은다 —
  // 바깥 클릭·Escape·선택 등 어떤 경로로 닫혀도 같은 상태로 돌아간다.
  const closeMenu = useCallback(() => {
    listboxPointerRef.current = false;
    setIsOpen(false);
    setHighlight(-1);
    typeBufRef.current = "";
    typeAtRef.current = 0;
  }, []);

  const handleSelect = useCallback(
    (index: number) => {
      if (disabled) return;
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      closeMenu();
    },
    [disabled, options, onChange, closeMenu]
  );

  const openMenu = (intent: OpenIntent) => {
    const selectedIndex = options.findIndex((o) => o.value === value);
    setHighlight(initialHighlight(intent, options.length, selectedIndex, isOptionDisabled));
    setIsOpen(true);
    typeBufRef.current = "";
    typeAtRef.current = 0;
  };

  const runTypeAhead = (char: string) => {
    const now = Date.now();
    const buffer = appendTypeAhead(typeBufRef.current, char, now - typeAtRef.current, TYPE_AHEAD_RESET_MS);
    typeBufRef.current = buffer;
    typeAtRef.current = now;
    const found = typeAheadIndex(options, buffer, typeAheadStart(buffer, highlight, options.length), isOptionDisabled);
    if (found >= 0) setHighlight(found);
  };

  // 목록이 열린 동안 키보드 조작은 전부 trigger 버튼에서 받는다.
  // 포커스는 버튼에 그대로 두고 aria-activedescendant로 "지금 가리키는 항목"을 알린다.
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (disabled) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    kbNavRef.current = true;
    const { key } = e;
    const selectedIndex = options.findIndex((o) => o.value === value);

    if (!isOpen) {
      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
        // preventDefault로 브라우저가 keydown 뒤에 click을 또 쏘는 걸 막는다(열자마자 닫히는 것 방지).
        e.preventDefault();
        openMenu(key === "ArrowDown" ? "first" : key === "ArrowUp" ? "last" : "selected");
      }
      return;
    }

    switch (key) {
      case "Escape":
        closeMenu();
        triggerRef.current?.focus();
        return;
      case "Tab":
        // preventDefault 없음 — 다음 요소로 넘어가는 기본 동작은 그대로 둔다.
        closeMenu();
        return;
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => nextIndex(h, options.length, 1, isOptionDisabled));
        return;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => nextIndex(h, options.length, -1, isOptionDisabled));
        return;
      case "Home":
        e.preventDefault();
        setHighlight(initialHighlight("first", options.length, selectedIndex, isOptionDisabled));
        return;
      case "End":
        e.preventDefault();
        setHighlight(initialHighlight("last", options.length, selectedIndex, isOptionDisabled));
        return;
      case "Enter":
        e.preventDefault();
        if (highlight >= 0 && options[highlight]) handleSelect(highlight);
        else closeMenu();
        triggerRef.current?.focus();
        return;
      case " ":
        e.preventDefault();
        // 타자 검색 중이면 공백은 라벨의 일부("통합 DB 관리")로 본다. 아니면 선택.
        if (isTypeAheadActive(typeBufRef.current, Date.now() - typeAtRef.current)) {
          runTypeAhead(" ");
        } else {
          if (highlight >= 0 && options[highlight]) handleSelect(highlight);
          else closeMenu();
          triggerRef.current?.focus();
        }
        return;
    }

    // 한글 등 조합 입력 중에는 눌린 물리 키(예: "d")가 오므로 타자 검색에 넣지 않는다 —
    // 넣으면 엉뚱한 항목으로 튄다. 조합이 끝난 글자는 조합 플래그가 꺼진 뒤 들어온다.
    if (!(e.nativeEvent as KeyboardEvent).isComposing && isTypeAheadChar(key)) {
      e.preventDefault();
      runTypeAhead(key);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) {
        listboxPointerRef.current = true;
        return;
      }
      closeMenu();
    }
    function handlePointerRelease() {
      listboxPointerRef.current = false;
    }
    document.addEventListener("mousedown", handleClickOutside);
    // 자식이 버블링을 막거나 누른 채 창을 떠나도 다음 blur를 가로채지 않는다.
    document.addEventListener("mouseup", handlePointerRelease, true);
    document.addEventListener("pointerup", handlePointerRelease, true);
    document.addEventListener("pointercancel", handlePointerRelease, true);
    window.addEventListener("blur", handlePointerRelease);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("mouseup", handlePointerRelease, true);
      document.removeEventListener("pointerup", handlePointerRelease, true);
      document.removeEventListener("pointercancel", handlePointerRelease, true);
      window.removeEventListener("blur", handlePointerRelease);
    };
  }, [isOpen, closeMenu]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) closeMenu();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, closeMenu]);

  // 키보드로 가리킨 항목이 목록 밖으로 나가지 않게 따라 스크롤한다(마우스 hover 때는 하지 않는다).
  // menuMounted(불린)를 의존성으로 써서 스크롤·리사이즈로 pos가 새로 계산돼도 다시 돌지 않게 한다.
  useEffect(() => {
    if (!menuMounted || highlight < 0 || !kbNavRef.current) return;
    document.getElementById(`${menuId}-opt-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [menuMounted, highlight, menuId]);

  const renderOption = (option: CustomSelectOption, index: number) => {
    const isSelected = option.value === value;
    const isHighlighted = index === highlight;
    const optionDisabled = !!option.disabled;
    // 2단 소제목(분야 | 섹션) 아래 항목만: 들여쓰고 앞에 표식(•)을 둬 "그 탭 안의 선택 항목"으로 보이게 한다.
    // 다른 드롭다운(2단 소제목 아님)은 종전 그대로.
    const nested = !!(option.group && splitGroupHeader(option.group));
    return (
      <li
        key={option.value}
        id={optionId(index)}
        role="option"
        aria-selected={isSelected}
        aria-disabled={optionDisabled ? true : undefined}
        tabIndex={-1}
        onClick={() => handleSelect(index)}
        onMouseEnter={() => {
          if (optionDisabled) return;
          kbNavRef.current = false;
          setHighlight(index);
        }}
        className={
          optionDisabled
            ? `${nested ? "pl-7 pr-3" : "px-3"} py-2 text-sm text-wedly-muted cursor-not-allowed transition-colors`
            : `${nested ? "pl-7 pr-3" : "px-3"} py-2 text-sm cursor-pointer transition-colors ${
                isSelected
                  ? "font-bold text-wedly-accent-ink bg-wedly-bg-blue"
                  : isHighlighted
                    ? "bg-wedly-bg-blue text-wedly-accent-ink"
                    : "text-wedly-t1 hover:bg-wedly-bg-blue hover:text-wedly-accent-ink"
              }`
        }
      >
        <span className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 truncate min-w-0">
            {nested && <span className="text-wedly-muted/50 text-[11px] flex-shrink-0" aria-hidden>•</span>}
            <span className="truncate">{option.label}</span>
          </span>
          {isSelected && (
            <svg className="w-4 h-4 text-wedly-accent-ink flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      </li>
    );
  };

  const renderOptions = () => {
    const hasGroups = options.some((o) => o.group);
    // index는 항상 options 배열 기준이다(그룹 머리글 li가 끼어들어도 id·하이라이트가 어긋나지 않게).
    if (!hasGroups) return options.map((option, index) => renderOption(option, index));
    // planGroupedOptions가 그룹 라벨마다 헤더를 한 번만 낸다(같은 라벨이 흩어져 나와도 중복 헤더·중복 key 없음).
    return planGroupedOptions(options).map((row) => {
      if (row.kind !== "header") return renderOption(options[row.index], row.index);
      // "메인 | 서브"(분야 | 섹션) 꼴이면 두 층으로: 메인 섹션은 크고 진한 브랜드색, 서브 탭은 작고 흐리게 —
      // 섹션 안의 탭이라는 위계를 눈에 보이게. 그 꼴이 아니면(다른 드롭다운) 종전 헤더 그대로.
      const two = splitGroupHeader(row.label);
      return two ? (
        <li key={`group-${row.label}`} role="presentation" className="px-3 pt-2.5 pb-1 flex items-baseline gap-1.5 select-none">
          <span className="text-[12.5px] font-bold text-wedly-navy tracking-tight">{two.main}</span>
          <span className="text-[11px] text-wedly-muted/50">|</span>
          <span className="text-[10.5px] font-medium text-wedly-muted tracking-wide">{two.sub}</span>
        </li>
      ) : (
        <li key={`group-${row.label}`} role="presentation" className="px-3 pt-2.5 pb-1 text-[10px] font-bold text-wedly-muted uppercase tracking-wider select-none">
          {row.label}
        </li>
      );
    });
  };

  /**
   * 여는 단추의 클래스. `controlClassName` 이 **빈 값이면 옛 문자열을 그대로** 내보낸다 —
   * `cn`(tailwind-merge)을 태우면 `bg-white`/`bg-wedly-bg-gray` 처럼 원래 둘 다 나가던 짝에서
   * 앞엣것이 지워져 다른 화면의 결과 글자가 달라질 수 있다. 값이 올 때만 합쳐서
   * `py-2.5` 같은 옛 값이 새 `h-9`·`py-0` 에 확실히 지게 만든다(문자열 이어붙이기로는 못 이긴다 —
   * 어느 쪽이 이길지는 클래스 차례가 아니라 Tailwind 가 만든 CSS 차례가 정한다).
   */
  const BASE_CONTROL =
    `w-full text-left appearance-none px-3 py-2.5 pr-8 text-sm border border-wedly-bd rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent transition-colors ${
      disabled ? "opacity-50 cursor-not-allowed bg-wedly-bg-gray" : "cursor-pointer hover:border-wedly-accent/50"
    } ${selectedOption ? "text-wedly-t1" : "text-wedly-muted"}`;
  const controlClass = controlClassName ? cn(BASE_CONTROL, controlClassName) : BASE_CONTROL;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        aria-label={ariaLabel}
        type="button"
        autoFocus={autoFocus}
        title={title !== undefined ? title : selectedOption ? displayLabel : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (disabled) return;
          if (isOpen) closeMenu();
          // 마우스로 열 때는 하이라이트를 두지 않는다(-1) — 겉모습이 종전과 완전히 같게.
          else setIsOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
        onBlur={(event) => {
          if (listboxPointerRef.current) {
            listboxPointerRef.current = false;
            triggerRef.current?.focus();
            return;
          }
          const next = event.relatedTarget as Node | null;
          if (next && (menuRef.current?.contains(next) || triggerRef.current?.contains(next))) {
            triggerRef.current?.focus();
            return;
          }
          closeMenu();
          onBlur?.(event);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-activedescendant={isOpen && highlight >= 0 ? optionId(highlight) : undefined}
        className={controlClass}
      >
        <span className="block truncate">{displayLabel}</span>
      </button>
      <svg
        className={`w-3.5 h-3.5 text-wedly-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none transition-transform ${isOpen ? "rotate-180" : ""}`}
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      {isOpen && pos && createPortal(
        <CustomSelectListbox
          menuRef={menuRef}
          id={menuId}
          pos={pos}
          onPressInside={() => {
            listboxPointerRef.current = true;
          }}
        >
          {renderOptions()}
          {options.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-wedly-muted text-center">옵션이 없습니다</li>
          )}
        </CustomSelectListbox>,
        document.body,
      )}
    </div>
  );
}
