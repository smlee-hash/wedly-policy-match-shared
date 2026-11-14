"use client";

// 펼친 표 둘 — 공고 하나를 펼친 「업체 표」(정책별 고객사)와 업체 하나를 펼친 「공고 표」(연락 예정 업체·캘린더 고른 업체).
// 상태는 갖지 않는다 — 읽기·누르기 처리는 보드가 쥐고 이 표들은 받은 값을 그리기만 한다(그래서 그려서 잴 수 있다).
import { ACTION_COL, CheckCell, DDayBadge, FitCell, KindChip, ProgressCell } from "./DeadlineBits";
import { buttonClass } from "./classes";
import { announcementsFor, conditionColumns, dateLabel } from "./deadline-view";
import type { CompanyAnnouncementRow, CompanyMatchRow } from "../../serve/policy-deadline/types";

const TH = "bg-wedly-bg-gray px-2.5 py-2 text-left text-wedly-tablehead font-semibold text-wedly-t2";
const TD = "border-b border-wedly-bd px-2.5 py-2 align-top text-wedly-sub";

export type ConditionColumns = { fit: boolean; check: boolean };

// 펼친 업체 표의 칸 — 맞음·확인 필요 두 표가 같은 칸·같은 폭을 써서 위아래 줄이 맞는다.
// 마지막 내용 칸은 폭을 두지 않아 남는 폭을 가져간다(조건 칸이 빠지면 진행상태가 넓어진다).
// 앞 칸 % 합을 64%로 둬 두 조건 칸이 다 나와도 「확인할 조건」이 「업무 현황」 칸(148px)을 빼고 넉넉히 남는다.
export function companyColumns(columns: ConditionColumns, showConsultant = true): { head: string; width: string }[] {
  const cols = [
    { head: "업체명", width: "w-[22%]" },
    ...(showConsultant ? [{ head: "담당", width: "w-[11%]" }] : []),
    { head: "진행상태", width: "w-[13%]" },
    ...(columns.fit ? [{ head: "맞은 조건", width: "w-[18%]" }] : []),
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
  onDetail,
  onProgress,
}: {
  rows: CompanyMatchRow[];
  columns: ConditionColumns;
  busyKey: string;
  bucketKey: string;
  showConsultant?: boolean;
  onDetail?: (row: CompanyMatchRow) => void;
  onProgress: (row: CompanyMatchRow) => void;
}) {
  const cols = companyColumns(columns, showConsultant);
  return (
    <div className="overflow-x-auto rounded-lg border border-wedly-bd bg-white">
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
              <td className={TD}>{row.statusText}</td>
              {columns.fit && <td className={TD}><FitCell labels={row.fitLabels} /></td>}
              {columns.check && <td className={TD}><CheckCell toCheck={row.toCheck} gaps={row.gaps} /></td>}
              <td className={`${TD} text-right`}>
                <ProgressCell inProgress={!!row.progress} busy={busyKey === `${row.customerKey}|${bucketKey}`} onProgress={() => onProgress(row)} />
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
  onProgress,
}: {
  rows: CompanyAnnouncementRow[];
  customerKey: string;
  busyKey: string;
  onProgress: (announcement: CompanyAnnouncementRow) => void;
}) {
  const columns = conditionColumns(rows, true);
  return (
    <div className="overflow-x-auto rounded-lg border border-wedly-bd bg-white">
      <table className="w-full min-w-[760px] table-fixed border-collapse [&_tr:last-child>td]:border-b-0">
        <colgroup>
          <col />
          <col className="w-[112px]" />
          <col className="w-[160px]" />
          {columns.fit && <col className="w-[20%]" />}
          {columns.check && <col className="w-[24%]" />}
          <col className={ACTION_COL} />
        </colgroup>
        <thead className="text-wedly-tablehead">
          <tr>
            <th className={TH}>공고명</th>
            <th className={TH}>종류</th>
            <th className={TH}>마감</th>
            {columns.fit && <th className={TH}>맞은 조건</th>}
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
              {columns.fit && <td className={TD}><FitCell labels={a.fitLabels} /></td>}
              {columns.check && <td className={TD}><CheckCell toCheck={a.toCheck} gaps={a.gaps} unstructuredChip /></td>}
              <td className={`${TD} text-right`}>
                <ProgressCell inProgress={!!a.progress} busy={busyKey === `${customerKey}|${a.bucketKey}`} onProgress={() => onProgress(a)} />
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
  onProgress,
  onRetry,
}: {
  state: CompanyState | undefined;
  kind: string;
  customerKey: string;
  busyKey: string;
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
  return <ContactAnnouncementTable rows={announcementsFor(state.rows, kind)} customerKey={customerKey} busyKey={busyKey} onProgress={onProgress} />;
}
