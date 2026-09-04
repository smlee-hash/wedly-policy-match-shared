"use client";

/**
 * 자금 조달 지도 — 항목 하나를 여는 서랍(승인 미리보기 `openDrawer` 를 옮긴 것).
 *
 * 순서는 **서랍 머리(갈래·종류·마감 딱지) → 답 네 개 → 조건 목록(안내문+판정 줄+조건별 줄) → 원문 링크** 다.
 * 그 아래는 갈래가 갈린다:
 *  · 공고(`kind === "announcement"`) → 「상세·AI 판정 열기」 단추 하나(부모가 목록 보기로 전환한다).
 *  · 상시 상품(`kind === "product"`) → `ProductDetail` 이 **FundingItem 에 실린 값으로만** 그린다.
 *    통로를 새로 파지 않는다(계획서 Task 18 Step 2 — YAGNI).
 *
 * ★서랍은 `DetailPanel` 을 **품지 않는다**(계획서 리뷰 대장 #12 중요). 품었더니 조건 체크리스트가
 *  두 벌 그려지고, 카드 안에 카드가 생기고, 「진단을 실행하면…」처럼 이 자리에 맞지 않는 안내까지
 *  따라 들어왔다. 공고 원문·첨부·AI 상세 판정은 부모 화면(목록 보기)이 맡는다.
 *
 * ★재설계(계약 §G3, 2026-09-04 시안 3 — 「가독성이 너무 떨어져 내용이 전혀 눈에 안 들어온다」 사장님 지적):
 *  낱말(마감·판정·금액·갚기·어디·갈래 소개)은 전부 `funding-map.ts`(G1)의 도우미 함수로 옮겼다 —
 *  이 파일이 문구를 다시 짓지 않는다(계약 낱말 규칙: 기호 ✓/✕/? · D-N · 「외 N곳」 · 「미분류」 ·
 *  「대조 기준」 · 「원문 확인」 금지). 그래서 옛 「한 줄 이유」(item.why) 상자는 뺐다 — 새 판정 줄
 *  (`verdictWords`)이 같은 역할(왜 이 결과인지 한눈에)을 대신하는데, 계약이 서랍에 「유지」할 것으로
 *  콕 집어 적은 목록(원문 링크·「상세·AI 판정 열기」·출처 이름)에 「한 줄 이유」가 없다.
 *  갈래 딱지의 점 색은 `FundingMap.tsx` 의 `GROUP_TONE_TILE`(6색: navy·teal 포함, `Badge` 부품의
 *  5색보다 많다)을 그대로 가져와 쓴다 — 색 표를 다시 베끼지 않는다(다만 module-local 인 `KindChip`
 *  자체는 재사용 못 해 같은 모양의 chip 을 이 파일에도 하나 둔다).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Badge } from "./Badge";
import { SidePanel } from "./SidePanel";
import { cn } from "@wedly/ui-shared/ui/cn";
import { FUNDING_GROUP_META, type FundingGroupTone } from "../funding/funding-group";
import { GROUP_TONE_TILE, conditionRowText } from "./FundingMap";
import {
  amountWords,
  conditionVerdictWord,
  deadlineOfAnnouncement,
  deadlineWords,
  repayWords,
  verdictWords,
  whereWords,
  type FundingItem,
} from "../funding/funding-map";
import { SOURCE_DIRECTORY } from "../funding/source-directory";
import type { ConditionVerdict } from "../engine/structure-types";

/**
 * 상시 상품 수집원 이름표. 열쇠는 **실제 출처 id** 다 — 상품 출처는 게시판 수집원과 이름이 겹치지
 * 않게 전부 `product-` 접두어를 쓴다(`products/registry.ts` 주석 · 계획서 리뷰 대장 #1 치명).
 * 손 등록 명부만 접두어 없이 `manual` 이다(회차에 안 실리는 상수라 겹칠 이름이 없다).
 * 명부에 없는 값은 그대로 보여 준다 — 지어내지 않는다.
 */
const PRODUCT_SOURCE_LABEL: Record<string, string> = {
  "product-kinfa": "서민금융진흥원",
  "product-sbiz": "소상공인시장진흥공단",
  "product-finlife-soho": "금융감독원 금융상품통합비교공시",
  "product-kbank": "케이뱅크",
  "product-hope-return": "희망리턴패키지",
  "product-kosmes": "중소벤처기업진흥공단",
  "product-tips": "TIPS",
  manual: "손 등록 명부",
};

/** 조건 한 줄(pass/fail/unknown) → Badge 톤. 서랍만 쓰는 값이라 FundingMap.tsx 의 같은 표와 따로 둔다. */
const COND_BADGE: Record<ConditionVerdict, "green" | "red" | "yellow"> = { pass: "green", fail: "red", unknown: "yellow" };

const LINK_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-wedly-bd bg-white px-3 py-1.5 " +
  "text-wedly-sub font-semibold text-wedly-accent-ink transition-colors duration-150 ease-out " +
  "hover:bg-wedly-bg-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

const ANSWER_BOX = "rounded-xl border border-wedly-bd bg-wedly-bg-gray px-3 py-2";
const PANEL =
  "rounded-xl border border-wedly-bd bg-white p-3 shadow-wedly-resting";

/**
 * 마감 딱지 색 — 카드·표의 `DeadChip`(`FundingMap.tsx`, module-local이라 못 가져다 쓴다)과 같은 토큰.
 * `deadlineWords` 의 tone("red"|"green"|"plain")과 짝짓는다.
 */
const DEAD_CHIP_BASE = "shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-wedly-hint tabular-nums";
const DEAD_CHIP_TONE: Record<"red" | "green" | "plain", string> = {
  red: "border-wedly-bd-red bg-wedly-bg-red font-semibold text-wedly-red-ink",
  green: "border-wedly-bd-green bg-white text-wedly-green-ink",
  plain: "border-wedly-bd bg-white text-wedly-t2",
};

/**
 * 갈래 딱지 — 흰 칩 + 색 점(계약 낱말 규칙: 딱지는 흰 칩+색 점, `FundingMap.tsx` 의 `KindChip` 과
 * 같은 모양). `Badge` 부품은 5색(blue·green·red·yellow·purple)뿐이라 6갈래 중 navy(bank)·teal(invest)
 * 를 못 낸다 — 그 파일이 이미 만든 `GROUP_TONE_TILE` 점 색 표를 그대로 가져와 여기서 다시 그린다
 * (색 표 재사용이지 문구 재작성이 아니라 계약의 「화면 안에서 문구 재작성 금지」에 걸리지 않는다).
 */
function DotChip({ tone, children }: { tone?: FundingGroupTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-wedly-bd bg-white px-2.5 py-0.5 text-wedly-hint font-medium text-wedly-t1 shadow-sm">
      {tone && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", GROUP_TONE_TILE[tone].dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** 공고 서랍의 발 — 원문·첨부·AI 상세 판정은 상세 화면 몫이라는 안내와 그리로 가는 단추. */
function AnnouncementDetailLink({ item, onOpenDetail }: { item: FundingItem; onOpenDetail?: (id: string) => void }) {
  return (
    <div className={PANEL}>
      <h3 className="text-wedly-sub font-semibold text-wedly-t1">공고 원문 · 첨부 · AI 상세 판정</h3>
      <p className="mt-1 break-keep text-wedly-sub text-wedly-t2">
        위 조건 목록이 이 공고의 판정 결과입니다. 원문·첨부와 AI 상세 판정은 상세 화면에서 봅니다.
      </p>
      {onOpenDetail ? (
        <button type="button" className={cn(LINK_BTN, "mt-2")} onClick={() => onOpenDetail(item.refId)}>
          상세·AI 판정 열기
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        // 갈 곳이 없으면 단추를 그리지 않는다 — 눌러도 아무 일도 안 하는 단추를 두지 않는다.
        <p className="mt-2 break-keep text-wedly-hint text-wedly-muted">
          「전체 공고 탐색」에서 이 공고를 열면 원문·첨부를 볼 수 있습니다.
        </p>
      )}
    </div>
  );
}

function ProductDetail({ item }: { item: FundingItem }) {
  const rows: Array<[string, string]> = [
    ["취급기관", item.agency || "—"],
    ["신청처", item.where || "—"],
    ["접수기간", item.deadline.text || "상시"],
    ["출처", PRODUCT_SOURCE_LABEL[item.source] ?? item.source],
  ];
  return (
    <div className={PANEL}>
      <h3 className="text-wedly-sub font-semibold text-wedly-t1">상품 정보</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-wedly-sub">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="whitespace-nowrap text-wedly-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-keep text-wedly-t1">{v}</dd>
          </div>
        ))}
      </dl>
      {item.targetText ? (
        <div className="mt-3 rounded-lg bg-wedly-bg-gray px-3 py-2">
          <p className="text-wedly-label text-wedly-muted">대상 원문</p>
          <p className="mt-0.5 break-keep whitespace-pre-line text-wedly-sub text-wedly-t2">{item.targetText}</p>
        </div>
      ) : (
        <p className="mt-3 break-keep text-wedly-hint text-wedly-muted">
          대상 원문이 수집되지 않았습니다 — 위 「원문 열기」에서 확인해 주세요.
        </p>
      )}
    </div>
  );
}

/**
 * 공고 수집원 이름표 — **수집원 정본 명부**(`source-directory.ts`)에서 만든다.
 * 손으로 표를 또 베끼면 명부가 바뀔 때 여기만 옛 이름으로 남는다(이름표가 실제 쓰임과 어긋나던 전례).
 * 명부에 없는 id 는 그대로 보여 준다 — 지어내지 않는다.
 */
const ANN_SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  SOURCE_DIRECTORY.filter((x) => x.id).map((x) => [x.id as string, x.label]),
);

/** 구성원 한 줄 — 통로(`GET /api/policy-match/announcements?dedupKey=`)가 주는 칸 중 쓰는 것만. */
interface MemberRow {
  id: string;
  source: string;
  title: string;
  applyStart: string | null;
  applyEnd: string | null;
  applyPeriodText: string;
  url: string;
}

/** 통로 응답 한 줄이 우리가 쓸 모양인지 — 모르는 값이 오면 그 줄만 버린다(화면이 죽지 않게). */
function toMember(v: unknown): MemberRow | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    source: typeof r.source === "string" ? r.source : "",
    title: typeof r.title === "string" ? r.title : "",
    applyStart: typeof r.applyStart === "string" ? r.applyStart : null,
    applyEnd: typeof r.applyEnd === "string" ? r.applyEnd : null,
    applyPeriodText: typeof r.applyPeriodText === "string" ? r.applyPeriodText : "",
    url: typeof r.url === "string" ? r.url : "",
  };
}

/** ISO 글자 → 날짜. 이상한 값이면 null(없는 것과 같게 다룬다 — 지어낸 날짜를 그리지 않는다). */
function dateOf(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * 구성원의 마감 글자 — 지도·표·서랍이 **같은 계산**(`deadlineOfAnnouncement`)과 **같은 낱말**
 * (`deadlineWords`)을 쓴다. `applyStart` 까지 넘긴다: 접수 전이면 마감이 넉넉해도 「N일 뒤 접수」여야
 * 한다(지도와 같은 규칙).
 *
 * ★재설계(계약 §G3, 2026-09-04) — 예전엔 `deadlineLabel`(D-N 표기가 남아 있던 옛 함수)을 썼다.
 *  계약의 공통 낱말 규칙이 D-N 을 어디서도 금지해, 이 작은 보조 목록도 `deadlineWords` 로 바꾼다.
 */
function memberWhen(m: MemberRow, now: Date): string {
  return deadlineWords(
    deadlineOfAnnouncement(dateOf(m.applyEnd), m.applyPeriodText, now, dateOf(m.applyStart)),
    now,
  ).chip;
}

/**
 * 「같은 공고 N건(수집원별)」 — 묶여서 지도에 안 보이게 된 다른 수집본을 여는 자리
 * (2026-09-03 코덱스 적대 리뷰 #2 높음: 묶인 다른 행을 열 길이 아예 없었다).
 *
 * 통로는 탐색 목록이 쓰던 것을 **그대로** 쓴다(`ResultList` 의 `loadMembers` 와 같은 주소·같은 규칙) —
 * 새 통로를 파면 두 화면이 다른 구성원을 보여 준다. `status=open` 은 지도가 접수중 공고만 다루기 때문이다.
 *
 * ★훅은 이 부품 안에만 둔다. `FundingDrawer` 는 `item` 이 없으면 먼저 빠져나가는데(조기 반환),
 *  그 위아래로 훅이 갈리면 화면이 통째로 죽는다(빌드·시험이 전부 초록이라 못 잡는 자리).
 */
function GroupMembers({
  dedupKey,
  count,
  repId,
  onOpenDetail,
}: {
  dedupKey: string;
  count: number;
  repId: string;
  onOpenDetail?: (announcementId: string) => void;
}) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setFailed(false);
    const qs = new URLSearchParams({ dedupKey, status: "open" });
    fetch(`/api/policy-match/announcements?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j?.success || !Array.isArray(j.data)) {
          setFailed(true);
          return;
        }
        setRows((j.data as unknown[]).map(toMember).filter((x): x is MemberRow => x !== null));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [dedupKey]);

  const now = new Date();
  return (
    <div className={PANEL}>
      <h3 className="text-wedly-sub font-semibold text-wedly-t1">같은 공고 {count}건(수집원별)</h3>
      <p className="mt-1 break-keep text-wedly-hint text-wedly-muted">
        같은 사업이 여러 수집원에 올라와 지도에는 한 줄로 묶었습니다. 아래에서 수집원별 원문을 볼 수 있습니다.
      </p>
      {rows === null && !failed && (
        <p className="mt-2 break-keep text-wedly-sub text-wedly-t2">불러오는 중…</p>
      )}
      {failed && (
        <p className="mt-2 break-keep text-wedly-sub text-wedly-t2">
          묶인 공고를 불러오지 못했습니다 — 잠시 뒤 다시 열어 주세요.
        </p>
      )}
      {rows !== null && !failed && rows.length === 0 && (
        <p className="mt-2 break-keep text-wedly-sub text-wedly-t2">
          지금 접수중인 수집본이 이 줄 하나뿐입니다.
        </p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="mt-2 flex list-none flex-col gap-1.5">
          {rows.map((m, i) => (
            <li key={m.id} className="rounded-lg bg-wedly-bg-gray px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {/* 순번 — 제목까지 똑같은 묶음에서 유일한 구별 단서다(탐색 목록과 같은 규칙). */}
                <Badge variant="default" className="tabular-nums">{i + 1}</Badge>
                <Badge variant="default">{ANN_SOURCE_LABEL[m.source] ?? m.source ?? "출처 미상"}</Badge>
                {m.id === repId && <Badge variant="blue">지도에 실린 줄</Badge>}
                <span className="ml-auto shrink-0 tabular-nums text-wedly-hint text-wedly-t2">
                  {memberWhen(m, now)}
                </span>
              </div>
              {m.title && (
                <p className="mt-1 min-w-0 break-keep text-wedly-sub text-wedly-t1">{m.title}</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {m.url && (
                  <a href={m.url} target="_blank" rel="noreferrer" className={LINK_BTN}>
                    원문 열기
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
                {onOpenDetail && (
                  <button type="button" className={LINK_BTN} onClick={() => onOpenDetail(m.id)}>
                    이 행 상세 열기
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * el.scrollHeight 가 el.clientHeight 보다(오차 1px) 크면 두 줄(line-clamp-2)에서 실제로 넘쳤다는 뜻,
 * **또는** el.scrollWidth 가 el.clientWidth 보다(오차 1px) 크면 가로로 잘렸다는 뜻 — 둘 중 하나라도
 * 넘치면 넘친 것. 순수 비교만 떼어 둔다.
 *
 * ★2026-09-03 코덱스 7차 지적 5 — 세로만 봤다. 공백 없는 긴 값(주소·URL 같은 한 덩어리)은 `break-keep`
 *  때문에 줄이 안 바뀌고 **가로로** 잘리는데(두 줄을 안 넘으니 scrollHeight 는 그대로) 단추가 안 떴다.
 *
 * ★이 저장소엔 jsdom·@testing-library/react 가 없다(2026-09-03 실측 — `vitest.config.ts` 의
 *  `test.environment` 가 `"node"` 로 고정, `node_modules` 에도 미설치. 이 폴더의 다른 그려서-재는
 *  시험도 전부 `renderToStaticMarkup` 만 쓰는 이유가 같은 사유라고 파일 맨 위에 적혀 있다).
 *  `renderToStaticMarkup` 은 이펙트를 안 돌리고 ref 도 안 붙여, 아래 `useLayoutEffect`+
 *  `ResizeObserver` 자체는 그 시험 방식으로 못 잰다 — 그래서 실제 넘침 판정의 **순수 비교 규칙만**
 *  이렇게 따로 빼 시험한다(`isTileOverflowing` 을 이름표로 내보냄). 컴포넌트가 브라우저에서 실제로
 *  이 규칙대로 여닫히는지는 별도 브라우저 확인이 필요하다.
 */
export function isTileOverflowing(el: {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

/**
 * 「전체 보기/접기」 단추를 보일지 — 펼쳐 있거나 지금 넘치거나 단추가 초점을 갖고 있으면 보인다.
 *
 * ★2026-09-03 독립 화면 검사 B(배포본 실측: scrollHeight==clientHeight·scrollWidth==clientWidth 인데도
 *  단추가 남아 눌러도 아무 일이 없었다) — 한 번 넘친 적이 있으면 계속 기억하던 `everOverflowed` 를
 *  없앴다. 창을 넓혀 실제로 더는 안 넘치면 `overflowing` 이 `measure()` 로 매번 다시 재져 스스로
 *  false 로 되돌아오므로 별도 기억이 필요 없다. 접었다 펼 때 단추가 한 프레임 사라져 초점을 잃던
 *  문제(everOverflowed 를 만든 원래 이유)는 AnswerTile 의 측정을 `useLayoutEffect` 에 두는 것으로
 *  막는다 — 화면이 그려지기 전에 동기적으로 다시 재므로, 여전히 넘치는 상태(대개 그렇다)라면 같은
 *  커밋 안에서 `overflowing` 이 다시 true 로 잡혀 단추가 사라지는 프레임 자체가 없다.
 *
 * ★2026-09-03 코덱스 적대 리뷰 반영 — 위 방어는 "여전히 넘치는 상태(대개 그렇다)"를 전제한다. 펼친 뒤
 *  **창을 넓히고** 「접기」를 누르면 실제로는 더는 안 넘쳐 같은 커밋에서 `overflowing` 이 false 로
 *  남는다 — `expanded` 도 false 가 된 직후라 단추가 그 자리에서 사라지고, 그 단추에 있던 키보드 초점이
 *  문서(body)로 튄다. `focusHeld` 를 더해 **단추가 초점을 가진 동안**은 계속 남긴다 — 초점을 잃는
 *  순간(`onBlur`) 사라지므로 옛 `everOverflowed` 처럼 영구히 남지도 않는다.
 *  순수 규칙만 떼어 시험한다(isTileOverflowing 과 같은 사유).
 */
export function shouldShowExpandButton(s: { expanded: boolean; overflowing: boolean; focusHeld: boolean }): boolean {
  return s.expanded || s.overflowing || s.focusHeld;
}

/**
 * 단추가 지금 「키보드 초점」(:focus-visible)을 가졌는지 — 마우스 클릭 초점은 아니다.
 *
 * ★2026-09-03 코덱스 10차 지적 3(재설계 구현으로 후속) — `focusHeld` 를 `onFocus` 에서 조건 없이
 *  true 로 세웠더니, 마우스로 「전체 보기」를 눌러 펼친 뒤 다른 곳을 클릭하기 전까지 죽은(다시 안
 *  넘치는) 「접기」 단추가 계속 남았다. 키보드 탐색(Tab)일 때만 남기고, 마우스 클릭 초점은 남기지
 *  않는다 — 그래야 클릭 한 번으로 펼쳤다 접은 뒤 단추가 조용히 사라진다.
 *  `:focus-visible` 을 못 재는 환경(구형 브라우저 · `matches` 예외)은 예전처럼 유지(true)한다 —
 *  지원 안 되는 환경에서 초점을 잃는 것이 단추가 계속 남는 것보다 나쁘다.
 *  순수 규칙만 떼어 시험한다(isTileOverflowing 과 같은 사유 — 이 저장소엔 jsdom 이 없어 실제
 *  `:focus-visible` 매치는 `renderToStaticMarkup` 으로 못 잰다).
 */
export function isFocusVisible(el: { matches: (selector: string) => boolean }): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * 답 타일 값 줄의 줄바꿈 규칙 — 순수 함수로 뗀다(isTileOverflowing·shouldShowExpandButton 과 같은 사유).
 *
 * ★2026-09-03 독립 화면 검사 C(배포본 실측: 타일 테두리 밖 5px) — 공백 없는 긴 값(전화번호·URL 같은
 *  한 덩어리)은 펼쳐도 `break-keep` 때문에 어절 경계가 없어 줄이 안 바뀌고 가로로 삐져나왔다. 그래서
 *  펼친 상태를 `break-all` 로 바꿨었는데, 그러면 **짧은 낱말도** 글자 중간에서 끊긴다.
 *
 * ★2026-09-04 5차 독립 화면 검사 지적 2(재설계 §G3) — 배포본 실측: 펼친 타일에서 「한도는」·
 *  「1차년도」 같은 흔한 낱말이 글자 중간에서 끊겨 WEDLY 어절 규칙(break-keep)을 어겼다. `break-all`
 *  대신 `break-keep` + `[overflow-wrap:anywhere]` 로 바꾼다 — 어절은 그대로 지키되, 공백이 없어
 *  어절 경계 자체가 없는 긴 덩어리(전화번호·URL)만 어디서든 끊는다(`overflow-wrap: anywhere` 는
 *  `break-keep` 이 지키는 「줄바꿈 기회가 있으면 어절에서만 끊는다」와 달리, 그런 기회가 없을 때
 *  최후 수단으로 아무 데서나 끊어 컨테이너 밖으로 못 삐져나가게 한다 — 두 속성을 함께 주면 어절이
 *  있는 한 어절에서 끊고, 없을 때만 강제로 끊는다).
 */
export function tileValueClass(expanded: boolean): string {
  const base = "mt-0.5 text-wedly-value font-semibold tabular-nums text-wedly-t1";
  return expanded ? `${base} break-keep [overflow-wrap:anywhere]` : `${base} line-clamp-2 break-keep`;
}

/**
 * 답 네 개(얼마까지·이자(또는 갚아야 하나)·언제까지·어디에 신청) 타일 하나. 두 줄에서 끊고
 * (line-clamp-2) 전체는 title(hover)로 읽었는데, 휴대전화엔 hover 가 없고 상품엔 상세 화면이 따로
 * 없어 긴 한도 원문을 볼 길이 없었다(2026-09-03 코덱스 적대 리뷰 지적 6). 값이 실제로 두 줄을 넘쳐
 * 잘렸을 때만 「전체 보기」 단추를 두고, 누르면 line-clamp-2 를 풀어 전문을 보인다(다시 누르면 「접기」).
 *
 * ★훅은 이 부품 안에만 둔다 — `GroupMembers` 와 같은 이유(`FundingDrawer` 의 조기 반환).
 *  부모가 `key={`${item.id}-${label}`}` 로 마운트하므로, 다른 항목으로 넘어가면 새로 마운트돼
 *  펼침·넘침 상태가 저절로 초기화된다(접힌 채로 시작해 마운트 직후 다시 잰다).
 */
function AnswerTile({ label, value }: { label: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  // 단추가 지금 "키보드" 초점을 갖고 있는가 — onFocus/onBlur 로만 바뀐다(isFocusVisible 주석 참고).
  const [focusHeld, setFocusHeld] = useState(false);
  const valueRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    // 펼친 상태에선 line-clamp 가 풀려 넘침이 항상 false 로 재진다 — 접힌 상태에서만 잰다.
    if (expanded) return;
    const el = valueRef.current;
    if (!el) return;
    // 매번 다시 잰 값을 그대로 쓴다 — 넓어져 더는 안 넘치면 곧바로 false 로 되돌아온다(독립 검사 B).
    const measure = () => setOverflowing(isTileOverflowing(el));
    measure();
    // ResizeObserver 가 없는 환경(구형 브라우저·이 저장소의 노드 시험 환경)에서는 마운트 때 한 번만 잰다.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, expanded]);

  const showExpandButton = shouldShowExpandButton({ expanded, overflowing, focusHeld });

  return (
    <div className={ANSWER_BOX}>
      <p className="text-wedly-label text-wedly-muted">{label}</p>
      <p ref={valueRef} className={tileValueClass(expanded)} title={value}>
        {value}
      </p>
      {showExpandButton && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          onFocus={(e) => setFocusHeld(isFocusVisible(e.currentTarget))}
          onBlur={() => setFocusHeld(false)}
          className="mt-0.5 text-xs text-wedly-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent"
        >
          {expanded ? "접기" : "전체 보기"}
        </button>
      )}
    </div>
  );
}

interface Props {
  item: FundingItem | null;
  onClose: () => void;
  /** 공고의 상세·AI 판정 화면을 여는 손잡이(부모가 목록 보기로 전환한다). 없으면 단추를 안 그린다. */
  onOpenDetail?: (announcementId: string) => void;
  /** 마감 계산 기준 시각 — 생략하면 지금(new Date()). 시험이 고정값을 넣는다(FundingMap 과 같은 규칙). */
  now?: Date;
}

export default function FundingDrawer({ item, onClose, onOpenDetail, now }: Props) {
  if (!item) return null;
  const effectiveNow = now ?? new Date();
  const meta = FUNDING_GROUP_META[item.group];
  const dead = deadlineWords(item.deadline, effectiveNow);
  const repay = repayWords(item);
  const kindLabel = item.kind === "announcement" ? "공고" : "상시 상품";
  const answers: Array<[string, string]> = [
    ["얼마까지", amountWords(item)],
    [repay.label, repay.value],
    ["언제까지", dead.long],
    ["어디에 신청", whereWords(item)],
  ];

  return (
    <SidePanel open onClose={onClose} title={item.title} widthClass="sm:max-w-3xl">
      <div className="flex flex-col gap-3">
        {/* 서랍 머리 — 갈래 딱지(흰 칩+색 점) · 종류(공고/상시 상품) · 마감 딱지(계약 §G3). */}
        <div className="flex flex-wrap items-center gap-2">
          <DotChip tone={meta.tone}>{meta.name}</DotChip>
          <Badge variant="default">{kindLabel}</Badge>
          <span className={cn(DEAD_CHIP_BASE, DEAD_CHIP_TONE[dead.tone])}>{dead.chip}</span>
        </div>

        {/* 답 네 개 — 미리보기 `.qs`. 카드 앞면·표의 같은 답과 같은 도우미(amountWords·repayWords·
            deadlineWords·whereWords)를 쓴다 — 어디서나 같은 값이 같은 글자로 읽힌다. */}
        <div className="grid grid-cols-2 items-start gap-2 lg:grid-cols-4">
          {answers.map(([k, v]) => (
            <AnswerTile key={`${item.id}-${k}`} label={k} value={v} />
          ))}
        </div>

        {/* 조건 목록 — 안내 문장 + 판정 줄(verdictWords) + 조건별 [딱지] label — note(기호 없음, 계약 §G3). */}
        <div>
          <p className="mb-1.5 text-wedly-label text-wedly-muted">이 사업장 정보와 공고 조건을 하나씩 맞춰 본 결과</p>
          <p className="mb-1.5 break-keep text-wedly-sub text-wedly-t2">{verdictWords(item.fit)}</p>
          {item.fit.length > 0 && (
            <ul className="flex list-none flex-col gap-1.5">
              {item.fit.map((f, i) => (
                <li key={`${f.label}-${i}`} className="flex items-start gap-2 rounded-lg bg-wedly-bg-gray px-2.5 py-1.5">
                  <Badge variant={COND_BADGE[f.verdict]} className="mt-0.5 shrink-0">
                    {conditionVerdictWord(f.verdict)}
                  </Badge>
                  <span className="min-w-0 break-keep text-wedly-sub text-wedly-t1">{conditionRowText(f)}</span>
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

        {/* 원문·신청처 */}
        {(item.url || item.applyUrl) && (
          <div className="flex flex-wrap gap-2">
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className={LINK_BTN}>
                원문 열기
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            {item.applyUrl && item.applyUrl !== item.url && (
              <a href={item.applyUrl} target="_blank" rel="noreferrer" className={LINK_BTN}>
                신청처 열기
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        )}

        {item.kind === "announcement" ? (
          <AnnouncementDetailLink item={item} onOpenDetail={onOpenDetail} />
        ) : (
          <ProductDetail item={item} />
        )}

        {/* 묶인 다른 수집본(코덱스 #2) — 열쇠가 있어야 물을 수 있어 둘 다 있을 때만 그린다.
            서버는 묶을 때 둘을 함께 싣는다(빈 열쇠로는 애초에 묶지 않는다). */}
        {item.kind === "announcement" && (item.groupCount ?? 0) >= 2 && item.dedupKey && (
          <GroupMembers
            dedupKey={item.dedupKey}
            count={item.groupCount ?? 0}
            repId={item.refId}
            onOpenDetail={onOpenDetail}
          />
        )}
      </div>
    </SidePanel>
  );
}
