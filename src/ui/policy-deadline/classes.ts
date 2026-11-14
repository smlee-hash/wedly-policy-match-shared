// 단추·카드 클래스 글자 — ERP `components/ui/Button.tsx`·`Card.tsx` 의 클래스를 **글자 그대로** 옮겼다.
//
// 왜 부품이 아니라 클래스 글자인가: ERP 단추·카드는 다른 화면 수십 곳이 쓰는 앱 부품이라 공용으로 올리지 않는다
// (계획서 「검토한 다른 안」). 이 폴더는 쓰는 클래스 글자만 같게 옮겨, 두 앱에서 같은 모양이 나오게 한다.
// 이 폴더에서 쓰는 변형만 옮겼다: 단추 primary·secondary × xs·sm, 카드 section(여백 none·sm·md·lg)·bezel(이중 베젤).
// ERP 원본이 바뀌면 classes.test.ts 가 글자 그대로 적어 둔 값과 어긋나므로 이 파일과 시험을 함께 고친다.
import { cn } from "@wedly/ui-shared/ui/cn";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "xs" | "sm";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-wedly-accent text-white hover:bg-wedly-accent-hover active:bg-wedly-accent-active",
  secondary: "bg-white text-wedly-t1 border border-wedly-bd hover:bg-wedly-bg-gray active:bg-wedly-bg-sidebar",
};

// 굵기를 크기별로 둔다 — 작은 단추까지 700 이면 표가 굵은 글자로 뒤덮인다(ERP 와 같은 이유).
const BUTTON_SIZE: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs font-medium gap-1",
  sm: "h-8 px-3 text-sm font-bold gap-1.5",
};

/** `<button className={buttonClass("primary", "xs")}>` — ERP `<Button variant size>` 와 같은 클래스. */
export function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return cn(
    "inline-flex items-center justify-center rounded-wedly-btn transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent focus-visible:ring-offset-2",
    "disabled:opacity-50 disabled:pointer-events-none",
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    className,
  );
}

export type CardPadding = "none" | "sm" | "md" | "lg";

const CARD_PADDING: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

/**
 * 구역 카드(`<Card variant="section">`) — 흰 바탕·테두리·층 그림자 한 겹.
 * 여백 0 이면 내용을 둥근 모서리에 맞춰 자른다(안에 sticky 가 없을 때만 — `clip={false}` 로 끈다).
 */
export function sectionCardClass(padding: CardPadding, className?: string, clip = true): string {
  return cn(
    "border border-wedly-bd bg-white",
    "rounded-wedly-card shadow-wedly-resting",
    padding === "none" && clip && "overflow-hidden",
    CARD_PADDING[padding],
    className,
  );
}

/** 이중 베젤 카드(`<Card>` 기본)의 바깥 겹 — 연파랑 셸. `className` 은 이 겹에 붙는다. */
export function bezelShellClass(className?: string): string {
  return cn(
    "flex flex-col rounded-wedly-card border border-wedly-bd bg-wedly-bg-gray p-2",
    "shadow-wedly-resting",
    className,
  );
}

/** 이중 베젤 카드의 안쪽 겹 — 흰 코어. 여백 0 일 때만 둥근 모서리에 맞춰 자른다. */
export function bezelCoreClass(padding: CardPadding, clip = true): string {
  return cn(
    "relative flex-1 rounded-wedly-inner bg-white shadow-sm",
    padding === "none" && clip && "overflow-hidden",
    CARD_PADDING[padding],
  );
}
