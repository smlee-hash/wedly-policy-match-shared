"use client";

// 통합 상세창 「추천 정책」의 펼침 요약 — 줄을 누르면 그 줄 바로 아래에 펼쳐지는 짧은 상세(`ResultOneList layout="inline"` 의 renderDetail).
// 좁은 자리라 한 열이다: 얼마까지 · 갚아야 하나(또는 이자) · 언제까지 · 어디에 신청, 그다음 조건 목록(맞음/직접 확인), 맨 아래 「공고 상세 열기」.
// 낱말은 전부 기존 도우미(`funding-map.ts` 의 amountWords·repayWords·deadlineWords·whereWords·verdictWords·conditionVerdictWord,
// `FundingMap.tsx` 의 conditionRowText, `result-one-list.ts` 의 ddayBadgeOf)를 그대로 쓴다 — 이 파일이 문구를 다시 짓지 않는다.
// 값이 없는 칸(금액·마감·기관 미기재)은 줄 자체를 그리지 않는다.
// 수집원 수는 드러내지 않는다(`whereWords(item)` — 수집원 자료는 관리자 서랍에서만).
import {
  amountWords, conditionVerdictWord, deadlineWords, repayWords, verdictWords, whereWords,
  type FundingItem,
} from "../../funding/funding-map";
import type { ConditionVerdict } from "../../engine/structure-types";
import { Badge } from "../Badge";
import { conditionRowText } from "../FundingMap";
import { ddayBadgeOf } from "./result-one-list";

/** 조건 한 줄(pass/fail/unknown) → Badge 톤. */
const COND_BADGE: Record<ConditionVerdict, "green" | "red" | "yellow"> = { pass: "green", fail: "red", unknown: "yellow" };

const OPEN_BTN =
  "inline-flex h-9 w-full items-center justify-center rounded-[10px] bg-wedly-accent px-4 text-wedly-sub font-semibold " +
  "text-white transition-colors hover:bg-wedly-accent-hover focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-wedly-accent focus-visible:ring-offset-2";

/** 요약 한 칸 — 값이 없으면 `null`(줄을 안 그린다). */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="w-20 shrink-0 text-wedly-hint text-wedly-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-keep text-wedly-sub font-semibold text-wedly-t1 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function InlineFundingSummary({ item, onOpen, now }: {
  item: FundingItem;
  /** 「공고 상세 열기」 — 어디로 열지(상세 화면 또는 서랍)는 부르는 쪽이 정한다(`openTargetOf`). */
  onOpen: (item: FundingItem) => void;
  /** 마감 계산 기준 시각 — 생략하면 지금. 시험이 고정값을 넣는다. */
  now?: Date;
}) {
  const at = now ?? new Date();
  const amount = item.amountText?.trim() ? amountWords(item) : "";
  const repay = repayWords(item);
  const dead = deadlineWords(item.deadline, at);
  const deadlineKnown = item.deadline.kind !== "unknown";
  const dday = ddayBadgeOf(item);
  const where = item.where?.trim() || item.agency?.trim() ? whereWords(item) : "";
  const isAnnouncement = item.kind === "announcement";

  return (
    <div data-area="inline-summary" className="min-w-0 space-y-3">
      <dl className="min-w-0 space-y-2">
        {amount && <Row label="얼마까지">{amount}</Row>}
        <Row label={repay.label}>{repay.value}</Row>
        {deadlineKnown && (
          <Row label="언제까지">
            {dead.long}
            {dday && (
              <span
                className={`ml-2 text-wedly-hint font-semibold tabular-nums ${dday.hot ? "text-wedly-red-ink" : "text-wedly-t2"}`}
              >
                {dday.text}
              </span>
            )}
          </Row>
        )}
        {where && <Row label="어디에 신청">{where}</Row>}
      </dl>

      <div className="min-w-0">
        <p className="mb-1.5 break-keep text-wedly-hint text-wedly-muted">이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과</p>
        <p className="mb-1.5 break-keep text-wedly-sub text-wedly-t2">{verdictWords(item.fit)}</p>
        {item.fit.length > 0 && (
          <ul className="flex list-none flex-col gap-1.5">
            {item.fit.map((f, i) => (
              <li key={`${f.label}-${i}`} className="flex min-w-0 items-start gap-2 rounded-lg bg-wedly-bg-gray px-2.5 py-1.5">
                <Badge variant={COND_BADGE[f.verdict]} className="mt-0.5 shrink-0">
                  {conditionVerdictWord(f.verdict)}
                </Badge>
                <span className="min-w-0 break-keep text-wedly-sub text-wedly-t1 [overflow-wrap:anywhere]">{conditionRowText(f)}</span>
              </li>
            ))}
          </ul>
        )}
        {item.humanCheck > 0 && (
          <p className="mt-1.5 break-keep text-wedly-hint text-wedly-muted">
            사람이 직접 확인할 조건 {item.humanCheck}건은 기계가 판정하지 않았습니다.
          </p>
        )}
      </div>

      <button type="button" data-open-detail={item.id} onClick={() => onOpen(item)} className={OPEN_BTN}>
        {isAnnouncement ? "공고 상세 열기" : "상품 자세히 보기"}
      </button>
    </div>
  );
}
