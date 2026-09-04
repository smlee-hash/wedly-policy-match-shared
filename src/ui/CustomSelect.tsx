"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "@wedly/ui-shared/ui/useAnchoredPosition";
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

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;
  const optionId = (index: number) => `${menuId}-opt-${index}`;
  const menuMounted = isOpen && pos !== null;

  // 닫을 때의 뒷정리(하이라이트·타자 버퍼 비우기)를 한 곳에 모은다 —
  // 바깥 클릭·Escape·선택 등 어떤 경로로 닫혀도 같은 상태로 돌아간다.
  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setHighlight(-1);
    typeBufRef.current = "";
    typeAtRef.current = 0;
  }, []);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      closeMenu();
    },
    [onChange, closeMenu]
  );

  const openMenu = (intent: OpenIntent) => {
    const selectedIndex = options.findIndex((o) => o.value === value);
    setHighlight(initialHighlight(intent, options.length, selectedIndex));
    setIsOpen(true);
    typeBufRef.current = "";
    typeAtRef.current = 0;
  };

  const runTypeAhead = (char: string) => {
    const now = Date.now();
    const buffer = appendTypeAhead(typeBufRef.current, char, now - typeAtRef.current, TYPE_AHEAD_RESET_MS);
    typeBufRef.current = buffer;
    typeAtRef.current = now;
    const found = typeAheadIndex(options, buffer, typeAheadStart(buffer, highlight, options.length));
    if (found >= 0) setHighlight(found);
  };

  // 목록이 열린 동안 키보드 조작은 전부 trigger 버튼에서 받는다.
  // 포커스는 버튼에 그대로 두고 aria-activedescendant로 "지금 가리키는 항목"을 알린다.
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    kbNavRef.current = true;
    const { key } = e;

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
        setHighlight((h) => nextIndex(h, options.length, 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => nextIndex(h, options.length, -1));
        return;
      case "Home":
        e.preventDefault();
        if (options.length > 0) setHighlight(0);
        return;
      case "End":
        e.preventDefault();
        if (options.length > 0) setHighlight(options.length - 1);
        return;
      case "Enter":
        e.preventDefault();
        if (highlight >= 0 && options[highlight]) handleSelect(options[highlight].value);
        else closeMenu();
        triggerRef.current?.focus();
        return;
      case " ":
        e.preventDefault();
        // 타자 검색 중이면 공백은 라벨의 일부("통합 DB 관리")로 본다. 아니면 선택.
        if (isTypeAheadActive(typeBufRef.current, Date.now() - typeAtRef.current)) {
          runTypeAhead(" ");
        } else {
          if (highlight >= 0 && options[highlight]) handleSelect(options[highlight].value);
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
      if (menuRef.current?.contains(t)) return;
      closeMenu();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, closeMenu]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
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
    // 2단 소제목(분야 | 섹션) 아래 항목만: 들여쓰고 앞에 표식(•)을 둬 "그 탭 안의 선택 항목"으로 보이게 한다.
    // 다른 드롭다운(2단 소제목 아님)은 종전 그대로.
    const nested = !!(option.group && splitGroupHeader(option.group));
    return (
      <li
        key={option.value}
        id={optionId(index)}
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
        onClick={() => handleSelect(option.value)}
        onMouseEnter={() => {
          kbNavRef.current = false;
          setHighlight(index);
        }}
        className={`${nested ? "pl-7 pr-3" : "px-3"} py-2 text-sm cursor-pointer transition-colors ${
          isSelected
            ? "font-bold text-wedly-accent-ink bg-wedly-bg-blue"
            : isHighlighted
              ? "bg-wedly-bg-blue text-wedly-accent-ink"
              : "text-wedly-t1 hover:bg-wedly-bg-blue hover:text-wedly-accent-ink"
        }`}
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
        title={selectedOption ? displayLabel : undefined}
        onClick={() => {
          if (disabled) return;
          if (isOpen) closeMenu();
          // 마우스로 열 때는 하이라이트를 두지 않는다(-1) — 겉모습이 종전과 완전히 같게.
          else setIsOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
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
        <ul
          ref={menuRef}
          id={menuId}
          role="listbox"
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            ...(pos.placement === "down" ? { top: pos.top } : { bottom: pos.bottom }),
          }}
          className="z-[100] bg-white border border-wedly-bd rounded-xl shadow-lg overflow-auto py-1"
        >
          {renderOptions()}
          {options.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-wedly-muted text-center">옵션이 없습니다</li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}
