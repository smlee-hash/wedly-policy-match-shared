"use client";

// 펼친 표 둘 — 공고 하나를 펼친 「업체 표」(정책별 고객사)와 업체 하나를 펼친 「공고 표」(연락 예정 업체·캘린더 고른 업체).
// 상태는 갖지 않는다 — 읽기·누르기 처리는 보드가 쥐고 이 표들은 받은 값을 그리기만 한다(그래서 그려서 잴 수 있다).
import { ACTION_COL, CheckCell, DDayBadge, KindChip, ProgressCell } from "./DeadlineBits";
import { buttonClass } from "./classes";
import { announcementsFor, conditionColumns, dateLabel } from "./deadline-view";
import type { CompanyAnnouncementRow, CompanyMatchRow } from "../../serve/policy-deadline/types";

const TH = "bg-wedly-bg-gray px-2.5 py-2 text-left text-wedly-tablehead font-semibold text-wedly-t2";
const TD = "border-b border-wedly-bd px-2.5 py-2 align-top text-wedly-sub";
// 가로 밀기 상자 — relative 라야 안쪽 절대 위치 글자(「업무 현황」 머리 칸의 sr-only)가 이 상자를 기준으로 잡혀 상자 안에서 잘린다.
// 없으면 문서 전체를 기준으로 표 오른쪽 끝 자리에 놓여 좁은 화면의 문서 폭을 늘렸다(2026-11-16 390px 운영 QA — 문서 폭 932px).
const TABLE_BOX = "relative overflow-x-auto rounded-lg border border-wedly-bd bg-white";

/** 펼친 표의 조건 칸 — 「확인할 조건」 하나뿐이다. 「맞은 조건」 칸은 두지 않는다(2026-11-16 사장님 — 맞음·확인 필요로 이미 나뉜다). */
export type ConditionColumns = { check: boolean };

// 펼친 업체 표의 칸 — 맞음·확인 필요 두 표가 같은 칸·같은 폭을 써서 위아래 줄이 맞는다.
// 마지막 내용 칸은 폭을 두지 않아 남는 폭을 가져간다(조건 칸이 빠지면 담당이 넓어진다).
// 「진행상태」 칸은 두지 않는다(2026-11-16 사장님). 엑셀 내려받기 칸은 그대로 둔다.
export function companyColumns(columns: ConditionColumns, showConsultant = true): { head: string; width: string }[] {
  const cols = [
    { head: "업체명", width: "w-[22%]" },
    ...(showConsultant ? [{ head: "담당", width: "w-[11%]" }] : []),
    ...(columns.check ? [{ head: "확인할 조건", width: "" }] : []),
  ];
  cols[cols.length - 1] = { ...cols[cols.length - 1], width: "" };
  return cols;
}

/** 공고 하나의 업체 표 — 상호명을 누르면 업체 상세(`onDetail` 이 있을 때만 단추, 없으면 글자). */
export function CompanyTable({
  rows,
  columns,
  busyKey,
  bucketKey,
  showConsultant = true,
  canProgress = true,
  onDetail,
  onProgress,
}: {
  rows: CompanyMatchRow[];
  columns: ConditionColumns;
  busyKey: string;
  bucketKey: string;
  showConsultant?: boolean;
  /** 끄면 「업무 현황에 추가」 단추를 그리지 않는다(업무 현황을 만들 권한이 없는 사람). 기본은 켬. */
  canProgress?: boolean;
  onDetail?: (row: CompanyMatchRow) => void;
  onProgress: (row: CompanyMatchRow) => void;
}) {
  const cols = companyColumns(columns, showConsultant);
  return (
    <div className={TABLE_BOX}>
      <table className="w-full min-w-[760px] table-fixed border-collapse [&_tr:last-child>td]:border-b-0">
        <colgroup>
          {cols.map((c) => <col key={c.head} className={c.width} />)}
          <col className={ACTION_COL} />
        </colgroup>
        <thead className="text-wedly-tablehead">
          <tr>
            {cols.map((c) => <th key={c.head} className={TH}>{c.head}</th>)}
            <th className={TH}><span className="sr-only">업무 현황</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.customerKey}>
              <td className={TD}>
                {onDetail ? (
                  <button
                    type="button"
                    title="업체 상세 열기"
                    onClick={() => onDetail(row)}
                    className="break-keep rounded-sm text-left font-semibold text-wedly-navy underline-offset-2 hover:text-wedly-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wedly-accent"
                  >
                    {row.companyName}
                  </button>
                ) : (
                  <span className="break-keep font-semibold text-wedly-navy">{row.companyName}</span>
                )}
              </td>
              {showConsultant && <td className={TD}>{row.consultant || <span className="text-wedly-red-ink">담당 없음</span>}</td>}
              {columns.check && <td className={TD}><CheckCell toCheck={row.toCheck} gaps={row.gaps} /></td>}
              <td className={`${TD} text-right`}>
                <ProgressCell inProgress={!!row.progress} busy={busyKey === `${row.customerKey}|${bucketKey}`} canProgress={canProgress} onProgress={() => onProgress(row)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 업체 하나를 펼쳐 읽은 공고의 읽기 상태. */
export type CompanyState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; rows: CompanyAnnouncementRow[] };

/** 업체 하나의 공고 표 — 줄마다 공고가 달라 「조건 정리 전」은 그 줄 칸에 짧게 둔다. 공고명이 남는 폭을 가져간다. */
export function ContactAnnouncementTable({
  rows,
  customerKey,
  busyKey,
  canProgress = true,
  onProgress,
}: {
  rows: CompanyAnnouncementRow[];
  customerKey: string;
  busyKey: string;
  /** 끄면 「업무 현황에 추가」 단추를 그리지 않는다(업무 현황을 만들 권한이 없는 사람). 기본은 켬. */
  canProgress?: boolean;
  onProgress: (announcement: CompanyAnnouncementRow) => void;
}) {
  const columns = conditionColumns(rows, true);
  // 마감 칸(딱지 56px + 날짜 11px 글자)은 140px 이면 한 줄에 들어간다. 조건 칸이 하나라 780px 표에서도 공고명이 넉넉하다.
  return (
    <div className={TABLE_BOX}>
      <table className="w-full min-w-[780px] table-fixed border-collapse [&_tr:last-child>td]:border-b-0">
        <colgroup>
          <col />
          <col className="w-[112px]" />
          <col className="w-[140px]" />
          {columns.check && <col className="w-[24%]" />}
          <col className={ACTION_COL} />
        </colgroup>
        <thead className="text-wedly-tablehead">
          <tr>
            <th className={TH}>공고명</th>
            <th className={TH}>종류</th>
            <th className={TH}>마감</th>
            {columns.check && <th className={TH}>확인할 조건</th>}
            <th className={TH}><span className="sr-only">업무 현황</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.bucketKey}>
              <td className={TD}>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-wedly-navy hover:underline">{a.title || "이름 없는 공고"}</a>
                ) : (
                  <span className="font-semibold text-wedly-navy">{a.title || "이름 없는 공고"}</span>
                )}
                {a.agency && <span className="mt-0.5 block text-wedly-hint text-wedly-t2">{a.agency}</span>}
              </td>
              <td className={TD}><KindChip category={a.category} /></td>
              <td className={`${TD} whitespace-nowrap`}>
                <span className="inline-flex items-center gap-1.5">
                  <DDayBadge dDay={a.dDay} />
                  {a.applyEnd && <span className="text-wedly-hint text-wedly-t2">{dateLabel(a.applyEnd)}</span>}
                </span>
              </td>
              {columns.check && <td className={TD}><CheckCell toCheck={a.toCheck} gaps={a.gaps} unstructuredChip /></td>}
              <td className={`${TD} text-right`}>
                <ProgressCell inProgress={!!a.progress} busy={busyKey === `${customerKey}|${a.bucketKey}`} canProgress={canProgress} onProgress={() => onProgress(a)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 펼친 업체의 안쪽 — 읽는 중 · 오류(다시 불러오기) · 공고 표. 종류 거르기(kind)에 맞는 공고만 보인다.
 * 연락 예정 업체 목록의 펼친 줄과 캘린더의 「고른 업체」 판이 같은 안쪽을 쓴다.
 */
export function CompanyAnnouncementsPanel({
  state,
  kind,
  customerKey,
  busyKey,
  canProgress = true,
  onProgress,
  onRetry,
}: {
  state: CompanyState | undefined;
  kind: string;
  customerKey: string;
  busyKey: string;
  /** 끄면 「업무 현황에 추가」 단추를 그리지 않는다(업무 현황을 만들 권한이 없는 사람). 기본은 켬. */
  canProgress?: boolean;
  onProgress: (announcement: CompanyAnnouncementRow) => void;
  onRetry: () => void;
}) {
  if (!state || state.status === "loading") {
    return <p className="py-2 text-wedly-sub text-wedly-muted" role="status">공고를 불러오고 있습니다.</p>;
  }
  if (state.status === "error") {
    return (
      <p className="flex flex-wrap items-center gap-2 py-2 text-wedly-sub text-wedly-red-ink" role="alert">
        {state.message}
        <button type="button" className={buttonClass("secondary", "xs")} onClick={onRetry}>다시 불러오기</button>
      </p>
    );
  }
  return <ContactAnnouncementTable rows={announcementsFor(state.rows, kind)} customerKey={customerKey} busyKey={busyKey} canProgress={canProgress} onProgress={onProgress} />;
}
