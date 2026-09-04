import { cn } from "@wedly/ui-shared/ui/cn";

type BadgeVariant =
  | "default"
  | "blue"
  | "green"
  | "red"
  | "yellow"
  | "purple";

type BadgeStrength = "soft" | "outline" | "strong";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  strength?: BadgeStrength;
  className?: string;
}

/**
 * 딱지 표준 「흰 칩 + 색 점」 (2026-08-25 사장님 확정 — 재공모 시안 D)
 * 기본(soft) = 흰 알약 + 테두리 + 의미색 점 + 진한 글자 + shadow-sm.
 * variant="default" 는 점을 그리지 않는다(용량 같은 뜻 없는 딱지에 회색 점이 붙던 것 제거).
 * 워시 기본형(3형태 시안 C)은 「입체적이지 못하다」 지적으로 폐기.
 * 강조(strong)·윤곽(outline)은 점 없이 알약으로 통일 — 채움·테두리는 잉크색(8/25 대비 정비 승계).
 * 점은 글자가 아니라 도형이라 의미색 원색을 쓴다. 노랑만 흰 칩 대비 2.13:1 미달이라 gold-ink.
 * 값의 정본: wedly-design-system 스킬.
 */
const dotStyles: Record<Exclude<BadgeVariant, "default">, string> = {
  blue: "bg-wedly-accent",
  green: "bg-wedly-green",
  red: "bg-wedly-red",
  yellow: "bg-wedly-gold-ink",
  purple: "bg-wedly-purple",
};

const strongStyles: Record<BadgeVariant, string> = {
  default: "bg-wedly-t2 text-white",
  blue: "bg-wedly-accent-ink text-white",
  green: "bg-wedly-green-ink text-white",
  red: "bg-wedly-red-ink text-white",
  yellow: "bg-[#9E5100] text-white",
  purple: "bg-wedly-purple-ink text-white",
};

const outlineStyles: Record<BadgeVariant, string> = {
  default: "border border-wedly-t2 bg-white text-wedly-t2",
  blue: "border border-wedly-accent-ink bg-white text-wedly-accent-ink",
  green: "border border-wedly-green-ink bg-white text-wedly-green-ink",
  red: "border border-wedly-red-ink bg-white text-wedly-red-ink",
  yellow: "border border-[#9E5100] bg-white text-[#9E5100]",
  purple: "border border-wedly-purple-ink bg-white text-wedly-purple-ink",
};

export function Badge({
  children,
  variant = "default",
  strength = "soft",
  className,
}: BadgeProps) {
  if (strength === "soft") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-wedly-bd bg-white px-2.5 py-0.5 text-xs font-medium text-wedly-t1 shadow-sm",
          className
        )}
      >
        {variant !== "default" && (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotStyles[variant])} aria-hidden="true" />
        )}
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        strength === "strong" ? cn("border border-transparent", strongStyles[variant]) : outlineStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
