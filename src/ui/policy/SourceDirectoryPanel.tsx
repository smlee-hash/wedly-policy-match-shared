"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Database, Download } from "lucide-react";
import { Badge } from "../Badge";
import type { DirectoryStatus } from "../../funding/source-directory";
import type { DirectoryRow, SourcesSummary } from "./endpoints";

type Status = DirectoryStatus;
export type { DirectoryRow, SourcesSummary };

const STATUS_LABEL: Record<Status, string> = {
  connected: "연결됨", waiting: "대기", candidate: "조사 중", blocked: "차단", error: "오류", excluded: "대상 아님",
};
// 딱지는 표준 Badge(흰 칩+색 점, 2026-08-25 확정). 「대상 아님」은 상태가 아니라 분류라 점 없음(default).
const STATUS_VARIANT: Record<Status, "green" | "yellow" | "blue" | "default" | "red"> = {
  connected: "green", waiting: "yellow", candidate: "blue", blocked: "red", error: "red", excluded: "default",
};

/**
 * 화면 표의 「비고」 칸 — **화면과 파일이 같은 함수를 쓴다.**
 * 따로 쓰면 갈린다: 실제로 파일만 쉼표가 빠져 화면 「최근 회차 1,463건」이 파일에선 「1463건」이었다
 * (2026-09-01 독립 검사). 1,000 미만에서는 두 값이 같아 시험 7건이 그 갈래를 못 잡았다.
 */
const CAP_NOTE = "상한 도달 — 더 있을 수 있음";
const CAP_UNKNOWN_NOTE = "상한 확인 불가";

export function noteTextOf(e: DirectoryRow): string {
  if (e.lastError) return `최근 수집 오류: ${e.lastError}`;
  // note 는 막힌 사유·다음 행동 — 미연결 줄에서만 건수·상한 자리를 차지한다.
  if (e.status !== "connected" && e.note) return e.note;
  const saved = e.lastSaved != null ? `최근 회차 ${e.lastSaved.toLocaleString()}건` : "";
  if (e.hitCap === true) return saved ? `${saved} · ${CAP_NOTE}` : CAP_NOTE;
  if (e.hitCap === null) return saved ? `${saved} · ${CAP_UNKNOWN_NOTE}` : CAP_UNKNOWN_NOTE;
  return saved;
}

/**
 * 화면 전용 — 딱지가 「상한 도달」을 이미 말하므로 글자에서는 그 앞머리를 뗀다.
 * 배포본 눈검토에서 「상한 도달 — 더 있을 수 있음」 옆에 딱지 「상한 도달」이 붙어
 * 같은 말이 두 번 나왔다(시험으로는 안 잡히는 자리라 브라우저로만 보였다).
 * ⚠️ `noteTextOf` 는 손대지 않는다 — 엑셀에는 딱지가 없어 글자 하나로 뜻이 서야 한다.
 */
export function screenNoteOf(e: DirectoryRow): string {
  const full = noteTextOf(e);
  if (e.hitCap !== true || e.lastError) return full;
  return full.replace(/상한 도달 — /, "").replace(/ · $/, "").trim();
}

/** 화면 표와 **같은 순서·같은 값**으로 내보낸다 — 화면과 파일이 다르면 어느 쪽이 맞는지 알 수 없다. */
export function sourceRowsForExcel(entries: DirectoryRow[]): (string | number)[][] {
  return entries.map((e) => [
    e.label,
    STATUS_LABEL[e.status],
    e.count > 0 ? e.count : "-",
    noteTextOf(e),
    e.url,
    e.id ?? "",
  ]);
}

/**
 * 엑셀 시트 이름·머리줄은 **여기 한 벌만** 둔다 — 파일을 실제로 쓰는 일(xlsx 부르기)은
 * 앱이 `features.exportSources` 로 대신 해 준다(이 보관함엔 xlsx 가 없다). 값이 여기 있어야
 * 두 앱이 같은 모양의 파일을 낸다.
 *
 * 주소·수집id 는 화면엔 없지만 파일엔 넣는다 — 사람이 그 사이트를 열어 보거나
 * 개발에 전달할 때 쓰는 값이라, 표에 칸을 더하는 것보다 파일에 담는 편이 낫다.
 */
export const SOURCE_EXCEL_SHEET_NAME = "수집원 현황";
export const SOURCE_EXCEL_HEADERS = ["수집원", "상태", "보유 공고", "비고", "주소", "수집 id"];

/** `정책수집원_현황_YYYYMMDD.xlsx` — 옮기기 전과 같은 이름 규칙. */
export function sourceExcelFileName(now: Date = new Date()): string {
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `정책수집원_현황_${ymd}.xlsx`;
}

export function SourceDirectoryTable({ entries }: { entries: DirectoryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-wedly-tablehead">
          <tr className="border-b border-wedly-bd text-left text-wedly-muted">
            <th className="py-2 pr-3 font-medium">수집원</th>
            <th className="py-2 pr-3 font-medium">상태</th>
            <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">보유 공고</th>
            <th className="py-2 pr-3 font-medium">비고</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.label}-${e.url}`} className="border-b border-wedly-bd/60">
              <td className="py-2 pr-3 break-keep min-w-0">
                <a href={e.url} target="_blank" rel="noreferrer" className="text-wedly-t1 hover:underline">{e.label}</a>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-wedly-t1">
                {e.count > 0 ? e.count.toLocaleString() : "-"}
              </td>
              {/*
                딱지와 글자가 **같은 말을 두 번** 하지 않게 나눈다(배포본 눈검토에서 잡음).
                딱지가 「상한 도달」을 맡고, 글자는 그 뒤에 올 설명만 맡는다.
                ★`noteTextOf` 자체는 줄이지 않는다 — 엑셀에는 딱지가 없어서 글자 하나로
                뜻이 서야 하고, 그 글자가 곧 화면 표와 같은 값이어야 한다(sourceRowsForExcel 주석).
                그래서 화면에서만 앞머리를 떼어 낸다.
              */}
              <td className={`py-2 pr-3 break-keep ${e.hitCap === true && !e.lastError ? "text-wedly-orange" : "text-wedly-t2"}`}>
                <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
                  {e.hitCap === true && !e.lastError ? (
                    <Badge variant="yellow">상한 도달</Badge>
                  ) : null}
                  <span>{screenNoteOf(e)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PanelProps {
  /** 수집원 현황을 받아 올 통로(`GET`). 앱마다 주소가 다르다. */
  endpoint: string;
  /**
   * 엑셀 내려받기 — **없으면 단추 자체를 안 그린다.** 이 보관함엔 xlsx 가 없어서
   * 파일 쓰기는 앱이 한다(ERP 는 `downloadSheet`).
   */
  onExport?: (rows: DirectoryRow[], fileName: string) => Promise<void>;
  /** 오른쪽 단추 줄에 덧붙일 조각(랩: 「빠진 수집원 신고」). */
  actions?: ReactNode;
  /** 표 위 요약 카드 자리(랩: StatCard 4개). 현황을 받아 온 뒤에만 그린다. */
  header?: (summary: SourcesSummary) => ReactNode;
  /**
   * 단추 줄 오른쪽 여백. ERP 는 `pr-14` — 화면 오른쪽 아래 떠 있는 잠금 단추가
   * 단추의 모서리를 덮어 엉뚱한 것이 눌리던 자리다(2026-09-01 독립 검사 실측).
   */
  trailingPaddingClass?: string;
  /**
   * 첫 그림부터 펼쳐 둘지. **기본은 접힘**(ERP `/policy-match` 는 이 판이 화면 맨 아래
   * 한 구역이라 접혀 있는 편이 맞다 — 동작 그대로).
   * 랩(`wedly-policy-lab`)의 `/sources` 는 이 판 하나가 곧 화면이라, 접혀 있으면
   * 머리줄만 보이고 **요약 카드·「빠진 수집원 신고」 단추가 통째로 안 보였다**
   * (2026-09-07 실측 결함 · 승인 시안은 펼친 표). 접혀 있으면 현황을 받아오지도 않는다.
   */
  defaultOpen?: boolean;
}

export default function SourceDirectoryPanel({
  endpoint, onExport, actions, header, trailingPaddingClass = "", defaultOpen = false,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [summary, setSummary] = useState<SourcesSummary | null>(null);
  const [error, setError] = useState("");
  /** 내려받기 실패를 사람에게 알린다 — 조용히 삼키면 「눌렀는데 아무 일도 안 일어남」만 남는다
   *  (2026-09-01 독립 검사 지적). 엑셀 부품을 누를 때 받아오는 구조라 통신이 흔들리면 실제로 난다. */
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    if (!open || rows.length > 0) return;
    fetch(endpoint)
      .then((r) => r.json())
      .then((b) => { if (b.success) { setRows(b.data.entries); setSummary(b.data.summary); setError(""); } else setError(b.error?.message ?? "불러오지 못했습니다"); })
      .catch(() => setError("불러오지 못했습니다"));
  }, [endpoint, open, rows.length]);

  return (
    <section className="mt-6 rounded-2xl border border-wedly-bd bg-white shadow-wedly-resting">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-wedly-muted" /> : <ChevronRight className="h-4 w-4 text-wedly-muted" />}
        <Database className="h-4 w-4 text-wedly-accent" />
        <span className="font-semibold text-wedly-t1">수집원 현황</span>
        {summary && (
          <span className="ml-2 text-xs text-wedly-t2">
            연결 {summary.connected} · 대기 {summary.waiting} · 오류 {summary.error} · 대상 아님 {summary.excluded}
            {summary.candidate > 0 && ` · 조사 중 ${summary.candidate}`}
            {summary.blocked > 0 && ` · 차단 ${summary.blocked}`}
            {summary.lastRanAt && ` · 마지막 수집 ${new Date(summary.lastRanAt).toLocaleString("ko-KR")}`}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-wedly-bd/60 px-4 py-3">
          {error ? (
            <p className="text-sm text-wedly-red">{error}</p>
          ) : (
            <>
              {header && summary && <div className="mb-3">{header(summary)}</div>}
              {(onExport || actions) && (
                // 오른쪽 여백은 앱이 정한다 — ERP 는 `pr-14`(위 주석의 잠금 단추 자리).
                <div className={`mb-2 flex items-center justify-end gap-3 ${trailingPaddingClass}`}>
                  {downloadError && <span className="text-wedly-sub text-wedly-red">{downloadError}</span>}
                  {onExport && (
                    <button
                      type="button"
                      onClick={() => {
                        setDownloadError("");
                        onExport(rows, sourceExcelFileName()).catch(() =>
                          setDownloadError("내려받기에 실패했습니다 — 잠시 뒤 다시 눌러 주세요"),
                        );
                      }}
                      disabled={rows.length === 0}
                      className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-wedly-bd bg-white px-3 text-wedly-sub text-wedly-t2 transition-colors duration-150 ease-out hover:bg-wedly-bg-gray focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wedly-accent disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      엑셀 내려받기
                    </button>
                  )}
                  {actions}
                </div>
              )}
              <SourceDirectoryTable entries={rows} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
