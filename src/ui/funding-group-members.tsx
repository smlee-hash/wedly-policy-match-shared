"use client";

/**
 * 서랍의 「같은 공고 N건(수집원별)」 목록 — `FundingDrawer` 와 ② 매칭 결과의 상세(`ResultDetail`)가 함께 쓴다.
 *
 * ★공개 경로가 아니다. `package.json` exports 에도, `ui/index.ts` 에도 싣지 않는다.
 *  `./ui/FundingDrawer` 는 공개 경로라 거기서 내보내면 ERP 디자인 관문이 「공개 UI 부품」으로 세어
 *  데모 명부에 없다며 막는다(2026-10-07 실측). 꾸러미 안에서만 쓰는 부품이라 따로 뺐다.
 */
import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Badge } from "./Badge";
import { deadlineOfAnnouncement, deadlineWords } from "../funding/funding-map";
import { ANNOUNCEMENT_SOURCE_LABELS } from "../funding/source-labels";

export const LINK_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-wedly-bd bg-white px-3 py-1.5 " +
  "text-wedly-sub font-semibold text-wedly-accent-ink transition-colors duration-150 ease-out " +
  "hover:bg-wedly-bg-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent";

export const PANEL =
  "rounded-xl border border-wedly-bd bg-white p-3 shadow-wedly-resting";

/**
 * 공고 수집원 이름표 — 이름만 담은 표(`source-labels.ts`)에서 읽는다.
 * 수집원 정본 명부(`source-directory.ts`)를 여기서 가져오면 명부 전체(상태·주소·메모)가 브라우저 코드에
 * 실린다(2026-10-05 랩 리뷰 P1). 이름은 시험이 명부와 대조한다.
 * 표에 없는 id 는 그대로 보여 준다 — 지어내지 않는다.
 */
const ANN_SOURCE_LABEL: Readonly<Record<string, string>> = ANNOUNCEMENT_SOURCE_LABELS;

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
export function GroupMembers({
  dedupKey,
  count,
  repId,
  onOpenDetail,
  repLabel = "지도에 실린 줄",
}: {
  dedupKey: string;
  count: number;
  repId: string;
  onOpenDetail?: (announcementId: string) => void;
  /** 대표 줄 이름표 — ② 매칭 결과의 한 목록은 「목록에 실린 줄」로 넘긴다. */
  repLabel?: string;
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
                {m.id === repId && <Badge variant="blue">{repLabel}</Badge>}
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
