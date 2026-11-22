"use client";

// 펼친 표 둘 — 공고 하나를 펼친 「업체 표」(정책별 고객사)와 업체 하나를 펼친 「공고 표」(연락 예정 업체·캘린더 고른 업체).
// 읽기·누르기 처리는 보드가 쥐고 이 표들은 받은 값을 그린다(그래서 그려서 잴 수 있다). 표가 갖는 상태는 줄마다 「확인할 것」 펼침뿐이다.
import { useState } from "react";
import { ACTION_COL, DDayBadge, KindChip, ProgressCell } from "./DeadlineBits";
import { CheckList, CheckSummary, DismissControl, FoldGroup, TierCell } from "./TierBits";
import { buttonClass } from "./classes";
import { announcementsFor, dateLabel } from "./deadline-view";
import { amountLabel, dismissedTitle, hiddenHint, partitionLines, unstructuredTitle } from "./tier-view";
import type { CheckField, DeadlineTier } from "../../serve/policy-deadline/tier";
import type { CompanyAnnouncementRow, CompanyMatchRow, DismissReason } from "../../serve/policy-deadline/types";

const TH = "bg-wedly-bg-gray px-2.5 py-2 text-left text-wedly-tablehead font-semibold text-wedly-t2";
const TD = "border-b border-wedly-bd px-2.5 py-2 align-top text-wedly-sub";
// 가로 밀기 상자 — relative 라야 안쪽 절대 위치 글자(「업무 현황」 머리 칸의 sr-only)가 이 상자를 기준으로 잡혀 상자 안에서 잘린다.
// 없으면 문서 전체를 기준으로 표 오른쪽 끝 자리에 놓여 좁은 화면의 문서 폭을 늘렸다(2026-11-16 390px 운영 QA — 문서 폭 932px).
const TABLE_BOX = "relative overflow-x-auto rounded-lg border border-wedly-bd bg-white";

// 펼친 업체 표의 칸 — 맞을 확률 순 표와 「판단 전」·「해당 없음」 묶음 표가 같은 칸·같은 폭을 써서 위아래 줄이 맞는다.
// 마지막 내용 칸(확인할 것)은 폭을 두지 않아 남는 폭을 가져간다(담당 칸이 빠지면 더 넓어진다).
// 「진행상태」 칸은 두지 않는다(2026-11-16 사장님). 엑셀 내려받기 칸은 그대로 둔다.
export function companyColumns(showConsultant = true): { head: string; width: string }[] {
  return [
    { head: "업체명", width: "w-[18%]" },
    ...(showConsultant ? [{ head: "담당", width: "w-[10%]" }] : []),
    { head: "맞을 확률", width: "w-[150px]" },
    { head: "다음 할 일", width: "w-[20%]" },
    { head: "확인할 것", width: "" },
  ];
}

/** 업체 한 줄 — 「확인할 것」을 펼쳤는지는 줄마다 갖는다(다른 줄을 펼쳐도 그대로). */
function CompanyLine({
  row,
  busyKey,
  bucketKey,
  showConsultant,
  canProgress,
  onDetail,
  onProgress,
  onDismiss,
}: {
  row: CompanyMatchRow;
  busyKey: string;
  bucketKey: string;
  showConsultant: boolean;
  canProgress: boolean;
  onDetail?: (row: CompanyMatchRow, field?: CheckField) => void;
  onProgress: (row: CompanyMatchRow) => void;
  onDismiss?: (row: CompanyMatchRow, reason: DismissReason | null) => void | Promise<unknown>;
}) {
  const [checkOpen, setCheckOpen] = useState(false);
  // 「업무 현황에 추가」와 「해당 없음」은 같은 업체·공고를 누르므로 바쁜 값이 같다.
  const busy = busyKey === `${row.customerKey}|${bucketKey}`;
  const dismiss = onDismiss ? (reason: DismissReason | null) => onDismiss(row, reason) : undefined;
  return (
    <tr>
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
      <td className={TD}>
        <TierCell tier={row.tier} unstructured={row.unstructured} tierReason={row.tierReason} />
      </td>
      <td className={`${TD} break-keep text-wedly-t1`}>{row.nextAction}</td>
      <td className={TD}>
        <CheckSummary
          checkItems={row.checkItems}
          checkCount={row.checkCount}
          open={checkOpen}
          onToggle={row.checkCount > 0 ? () => setCheckOpen((v) => !v) : undefined}
        />
        {checkOpen && (
          <div className="mt-2">
            <CheckList items={row.checkItems} onField={onDetail ? (field) => onDetail(row, field) : undefined} />
          </div>
        )}
      </td>
      <td className={`${TD} text-right`}>
        <div className="flex flex-col items-end gap-1.5">
          {row.dismissed ? (
            <DismissControl dismissed={row.dismissed} busy={busy} onDismiss={dismiss} />
          ) : (
            <>
              <ProgressCell inProgress={!!row.progress} busy={busy} canProgress={canProgress} onProgress={() => onProgress(row)} />
              <DismissControl dismissed={null} busy={busy} onDismiss={dismiss} />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * 공고 하나의 업체 표 — 맞을 확률 순(받은 순서 그대로)으로 줄마다 단계 딱지·근거·다음 할 일·확인할 것을 보인다.
 * 상호명을 누르면 업체 상세(`onDetail` 이 있을 때만 단추, 없으면 글자). 「판단 전」·「해당 없음」 묶음도 같은 표 모양이다.
 */
export function CompanyTable({
  rows,
  busyKey,
  bucketKey,
  showConsultant = true,
  canProgress = true,
  onDetail,
  onProgress,
  onDismiss,
}: {
  rows: CompanyMatchRow[];
  busyKey: string;
  bucketKey: string;
  showConsultant?: boolean;
  /** 끄면 「업무 현황에 추가」 단추를 그리지 않는다(업무 현황을 만들 권한이 없는 사람). 기본은 켬. */
  canProgress?: boolean;
  /** 상호명은 칸 없이, 확인할 것의 업체 항목 이름은 그 칸(`field`)과 함께 부른다. */
  onDetail?: (row: CompanyMatchRow, field?: CheckField) => void;
  onProgress: (row: CompanyMatchRow) => void;
  /** 없으면 「해당 없음」 단추를 그리지 않는다(남긴 기록은 그대로 보인다). reason 이 null 이면 되돌리기. */
  onDismiss?: (row: CompanyMatchRow, reason: DismissReason | null) => void | Promise<unknown>;
}) {
  const cols = companyColumns(showConsultant);
  return (
    <div className={TABLE_BOX}>
      <table className="w-full min-w-[820px] table-fixed border-collapse [&_tr:last-child>td]:border-b-0">
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
            <CompanyLine
              key={row.customerKey}
              row={row}
              busyKey={busyKey}
              bucketKey={bucketKey}
              showConsultant={showConsultant}
              canProgress={canProgress}
              onDetail={onDetail}
              onProgress={onProgress}
              onDismiss={onDismiss}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 업체 하나를 펼쳐 읽은 공고의 읽기 상태 — rows 는 서버가 세운 순서(맞을 확률 순·마감 순), dismissed 는 「해당 없음」 줄(마감 가까운 순). */
export type CompanyState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; rows: CompanyAnnouncementRow[]; dismissed: CompanyAnnouncementRow[] };

// 펼친 공고 표의 칸 — 맞을 확률 순 표와 「판단 전」·「해당 없음」 묶음 표가 같은 칸·같은 폭을 써서 위아래 줄이 맞는다.
// 공고명은 폭을 두지 않아 남는 폭을 가져가고(920px 에서 180px 넘게), 마지막은 업무 현황 칸(ACTION_COL)이다.
// 마감 칸(딱지 56px + 날짜 11px 글자)은 140px 이면 한 줄에 들어간다. 「종류」·「확인할 조건」 칸은 두지 않는다 — 종류는 공고명 아래 줄, 확인할 것은 한 칸이 맡는다.
const CONTACT_COLUMNS: { head: string; width: string }[] = [
  { head: "공고명", width: "" },
  { head: "마감", width: "w-[140px]" },
  { head: "맞을 확률", width: "w-[140px]" },
  { head: "다음 할 일", width: "w-[15%]" },
  { head: "확인할 것", width: "w-[18%]" },
];

/** 공고 한 줄 — 「확인할 것」을 펼쳤는지는 줄마다 갖는다. 펼치면 바로 아래에 표 폭 전체 줄이 하나 더 붙는다. */
function AnnouncementLine({
  a,
  busy,
  canProgress,
  onProgress,
  onField,
  onDismiss,
}: {
  a: CompanyAnnouncementRow;
  busy: boolean;
  canProgress: boolean;
  onProgress: (announcement: CompanyAnnouncementRow) => void;
  onField?: (field: CheckField) => void;
  onDismiss?: (announcement: CompanyAnnouncementRow, reason: DismissReason | null) => void | Promise<unknown>;
}) {
  const [checkOpen, setCheckOpen] = useState(false);
  const title = a.title || "이름 없는 공고";
  const amount = amountLabel(a.amountMaxWon);
  const dismiss = onDismiss ? (reason: DismissReason | null) => onDismiss(a, reason) : undefined;
  return (
    <>
      <tr>
        <td className={TD}>
          {a.url ? (
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-wedly-navy hover:underline">{title}</a>
          ) : (
            <span className="font-semibold text-wedly-navy">{title}</span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-wedly-hint text-wedly-t2">
            <KindChip category={a.category} />
            {a.agency && <span>{a.agency}</span>}
            {amount && <span>{`지원 금액 ${amount}`}</span>}
          </span>
        </td>
        <td className={`${TD} whitespace-nowrap`}>
          <span className="inline-flex items-center gap-1.5">
            <DDayBadge dDay={a.dDay} />
            {a.applyEnd && <span className="text-wedly-hint text-wedly-t2">{dateLabel(a.applyEnd)}</span>}
          </span>
        </td>
        <td className={TD}>
          <TierCell tier={a.tier} unstructured={a.unstructured} tierReason={a.tierReason} />
        </td>
        <td className={`${TD} break-keep text-wedly-t1`}>{a.nextAction}</td>
        <td className={TD}>
          <CheckSummary
            checkItems={a.checkItems}
            checkCount={a.checkCount}
            open={checkOpen}
            onToggle={a.checkCount > 0 ? () => setCheckOpen((v) => !v) : undefined}
          />
        </td>
        <td className={`${TD} text-right`}>
          <div className="flex flex-col items-end gap-1.5">
            {a.dismissed ? (
              <DismissControl dismissed={a.dismissed} busy={busy} onDismiss={dismiss} />
            ) : (
              <>
                <ProgressCell inProgress={!!a.progress} busy={busy} canProgress={canProgress} onProgress={() => onProgress(a)} />
                <DismissControl dismissed={null} busy={busy} onDismiss={dismiss} />
              </>
            )}
          </div>
        </td>
      </tr>
      {/* 연락 예정 표는 칸이 좁아 좁은 칸 안에 목록을 넣지 않고 표 폭 전체를 쓴다. */}
      {checkOpen && (
        <tr>
          <td colSpan={CONTACT_COLUMNS.length + 1} className={`${TD} bg-wedly-bg-page`}>
            <CheckList items={a.checkItems} onField={onField} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * 업체 하나의 공고 표 — 받은 순서 그대로(맞을 확률 순·마감 순) 줄마다 마감·단계 딱지와 근거·다음 할 일·확인할 것·업무 현황을 보인다.
 * 공고명 아래에 종류·기관·지원 금액을 두고, 「해당 없음」 줄은 사유 기록과 「되돌리기」만 보인다(`onDismiss` 가 없으면 기록만).
 * 「판단 전」·「해당 없음」 묶음도 같은 표 모양이다.
 */
export function ContactAnnouncementTable({
  rows,
  customerKey,
  busyKey,
  canProgress = true,
  onProgress,
  onField,
  onDismiss,
}: {
  rows: CompanyAnnouncementRow[];
  customerKey: string;
  busyKey: string;
  /** 끄면 「업무 현황에 추가」 단추를 그리지 않는다(업무 현황을 만들 권한이 없는 사람). 기본은 켬. */
  canProgress?: boolean;
  onProgress: (announcement: CompanyAnnouncementRow) => void;
  /** 확인할 것의 업체 항목 이름을 누르면 그 칸(`field`)을 부른다. 없으면 이름은 글자다. */
  onField?: (field: CheckField) => void;
  /** 없으면 「해당 없음」 단추를 그리지 않는다(남긴 기록은 그대로 보인다). reason 이 null 이면 되돌리기. */
  onDismiss?: (announcement: CompanyAnnouncementRow, reason: DismissReason | null) => void | Promise<unknown>;
}) {
  return (
    <div className={TABLE_BOX}>
      <table className="w-full min-w-[920px] table-fixed border-collapse lg:min-w-[840px] [&_tr:last-child>td]:border-b-0">
        <colgroup>
          {CONTACT_COLUMNS.map((c) => <col key={c.head} className={c.width} />)}
          <col className={ACTION_COL} />
        </colgroup>
        <thead className="text-wedly-tablehead">
          <tr>
            {CONTACT_COLUMNS.map((c) => <th key={c.head} className={TH}>{c.head}</th>)}
            <th className={TH}><span className="sr-only">업무 현황</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <AnnouncementLine
              key={a.bucketKey}
              a={a}
              busy={busyKey === `${customerKey}|${a.bucketKey}`}
              canProgress={canProgress}
              onProgress={onProgress}
              onField={onField}
              onDismiss={onDismiss}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 펼친 업체의 안쪽 — 읽는 중 · 오류(다시 불러오기) · 「업체 상세 열기」 · 맞을 확률 순 공고 표 · 고르지 않은 단계라 숨긴 공고 수 ·
 * 「판단 전」·「해당 없음」 접힌 묶음. 종류 거르기(kind)에 맞는 공고만 보이고, 고른 단계(tiers)에 없는 공고는 숨기고 몇 건인지만 알린다.
 * 연락 예정 업체 목록의 펼친 줄과 캘린더의 「고른 업체」 판이 같은 안쪽을 쓴다.
 */
export function CompanyAnnouncementsPanel({
  state,
  kind,
  customerKey,
  busyKey,
  tiers,
  canProgress = true,
  onProgress,
  onField,
  onDismiss,
  onOpenCompany,
  onRetry,
}: {
  state: CompanyState | undefined;
  kind: string;
  customerKey: string;
  busyKey: string;
  /** 고른 맞을 확률 단계 — 이 밖의 단계 공고는 표에서 숨긴다. */
  tiers: readonly DeadlineTier[];
  /** 끄면 「업무 현황에 추가」 단추를 그리지 않는다(업무 현황을 만들 권한이 없는 사람). 기본은 켬. */
  canProgress?: boolean;
  onProgress: (announcement: CompanyAnnouncementRow) => void;
  /** 확인할 것의 업체 항목 이름을 누르면 그 칸(`field`)을 부른다. 없으면 이름은 글자다. */
  onField?: (field: CheckField) => void;
  /** 없으면 「해당 없음」 단추를 그리지 않는다(남긴 기록은 그대로 보인다). reason 이 null 이면 되돌리기. */
  onDismiss?: (announcement: CompanyAnnouncementRow, reason: DismissReason | null) => void;
  /** 있으면 표 위에 「업체 상세 열기」 단추를 그린다 — 칸 없이 그 업체 상세를 연다. */
  onOpenCompany?: () => void;
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
  const rows = announcementsFor(state.rows, kind);
  const parts = partitionLines(rows, tiers);
  const dismissed = [...parts.dismissed, ...announcementsFor(state.dismissed, kind)];
  const hint = hiddenHint(parts.hidden, "공고");
  const table = (list: CompanyAnnouncementRow[]) => (
    <ContactAnnouncementTable
      rows={list}
      customerKey={customerKey}
      busyKey={busyKey}
      canProgress={canProgress}
      onProgress={onProgress}
      onField={onField}
      onDismiss={onDismiss}
    />
  );
  return (
    <>
      {onOpenCompany && (
        <div className="mb-2 flex justify-end">
          <button type="button" className={buttonClass("secondary", "xs")} onClick={onOpenCompany}>업체 상세 열기</button>
        </div>
      )}
      {parts.main.length > 0 && table(parts.main)}
      {hint && <p className="mt-2 text-wedly-hint text-wedly-t2">{hint}</p>}
      {parts.unstructured.length > 0 && (
        <div className="mt-2.5">
          <FoldGroup key="unstructured" title={unstructuredTitle(parts.unstructured.length, "공고")} defaultOpen={parts.main.length === 0}>
            {table(parts.unstructured)}
          </FoldGroup>
        </div>
      )}
      {dismissed.length > 0 && (
        <div className="mt-2.5">
          <FoldGroup key="dismissed" title={dismissedTitle(dismissed.length, "공고")}>
            {table(dismissed)}
          </FoldGroup>
        </div>
      )}
      {rows.length === 0 && dismissed.length === 0 && <p className="py-2 text-wedly-sub text-wedly-t2">지금 거르기 조건에서 맞는 공고가 없습니다.</p>}
    </>
  );
}
