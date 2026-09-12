import { attachmentKindOf } from "../../../engine/types";
import { decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardRow, PolicyAttachmentRequest } from "../types";
import { isImageAttachment } from "./attachment-skip";

/**
 * 한국콘텐츠진흥원 금융지원 공개 게시판(알림마당 > 금융지원, B0158960 / menuNo=204392).
 *
 * 공개 목록·상세·첨부 POST 가 키 없이 200 이다. data.go.kr 금융지원정보 API 승인은
 * 이 연결이 주장하지 않는다. 지원사업공고(kocca, pims/menuNo=204104)와는 다른 판이다.
 *
 * 구조: `div.board_list01 table tbody tr`. 칸은 data-label(제목·분류·접수시작일·접수마감일).
 * 상세 신원은 숫자 글번호 + menuNo 만. 원문 href 의 pageIndex·검색 인자는 버린다.
 * 등록일 칸은 접수기간이 아니다. 끝난 글도 남긴다 — 상태 판정은 엔진이 한다.
 *
 * 첨부: `fileDown(atchFileId,fileSn,bbsId)` → 고정 창구
 * `POST /common/cmm/fms/FileDown.do` (폼 action 을 그대로 쓰지 않는다).
 */
const HOST = "www.kocca.kr";
const BASE = `https://${HOST}`;
const BBS = "B0158960";
const MENU = "204392";
const LIST = `/kocca/bbs/list/${BBS}.do`;
const VIEW = `/kocca/bbs/view/${BBS}`;
const DOWNLOAD = "/common/cmm/fms/FileDown.do";
const ROW = "div.board_list01 table tbody tr";
const VIEW_PATH = new RegExp(`^/kocca/bbs/view/${BBS}/(\\d+)\\.do$`);
const FILE_DOWN = /fileDown\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/;
const ATTACH_LINKS = ".board_view01 .file .file_list a[onclick]";

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function recordIdOf(href: string): string {
  const raw = decodeHtmlEntities((href ?? "").trim());
  if (!raw || /^(?:javascript:|mailto:|#)/i.test(raw)) return "";
  try {
    if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) {
      const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      if (u.hostname !== HOST) return "";
      return u.pathname.match(VIEW_PATH)?.[1] ?? "";
    }
  } catch {
    return "";
  }
  const path = raw.split("#")[0].split("?")[0];
  return path.match(VIEW_PATH)?.[1] ?? "";
}

/** 칸 글자가 달력 날짜일 때만 YYYY-MM-DD. 못 읽으면 빈 문자열 — 오늘·등록일로 메우지 않는다. */
function validYmd(text: string): string {
  const t = collapse(text);
  const m = t.match(/^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const probe = new Date(utc);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return "";
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dateRange(start: string, end: string): string {
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~`;
  return end;
}

function cell(tr: { querySelector: (s: string) => { text?: string } | null }, label: string): string {
  return collapse(tr.querySelector(`td[data-label="${label}"]`)?.text ?? "");
}

function attachmentName(el: { text?: string; getAttribute: (n: string) => string | undefined }): string {
  const text = collapse(el.text ?? "");
  const title = collapse(el.getAttribute("title") ?? "").replace(/\s*파일\s*다운로드\s*$/u, "").trim();
  return text || title;
}

export function parseKoccaFinanceList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector('td[data-label="제목"] a');
    const id = recordIdOf(a?.getAttribute("href") ?? "");
    if (!id || seen.has(id)) continue;
    const title = collapse(a?.text ?? "");
    if (!title) continue;
    seen.add(id);
    const start = validYmd(cell(tr, "접수시작일"));
    const end = validYmd(cell(tr, "접수마감일"));
    out.push({
      title,
      detailUrl: `${BASE}${VIEW}/${id}.do?menuNo=${MENU}`,
      dateText: dateRange(start, end),
      category: cell(tr, "분류"),
      agency: "한국콘텐츠진흥원",
    });
  }
  return out;
}

export function koccaFinanceDetailAttachments(html: string): PolicyAttachmentRequest[] {
  const url = `${BASE}${DOWNLOAD}`;
  const out: PolicyAttachmentRequest[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(html).querySelectorAll(ATTACH_LINKS)) {
    const call = `${a.getAttribute("onclick") ?? ""}`;
    const m = call.match(FILE_DOWN);
    if (!m) continue;
    const [, atchFileId, fileSn, bbsId] = m;
    if (!atchFileId || !fileSn) continue;
    const key = `${atchFileId}#${fileSn}`;
    if (seen.has(key)) continue;
    const name = attachmentName(a);
    if (!name || isImageAttachment(name)) continue;
    seen.add(key);
    out.push({
      name,
      url,
      kind: attachmentKindOf(name, url),
      method: "POST",
      body: new URLSearchParams({ atchFileId, fileSn, bbsId, menuNo: MENU }).toString(),
    });
  }
  return out;
}

export const koccaFinanceConfig: BoardConfig = {
  id: "kocca-finance",
  label: "한국콘텐츠진흥원 금융지원",
  agency: "한국콘텐츠진흥원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?menuNo=${MENU}&pageIndex=${p}`,
    // 공개 목록 292건·30쪽. 재개형 전체 쪽 엔진은 별도 작업 — 임시 한도는 엔진 상한과 같다.
    maxPages: 40,
    rowSelector: ROW,
    fields: {
      title: { selector: 'td[data-label="제목"] a' },
      detailUrl: { selector: 'td[data-label="제목"] a', attr: "href" },
      date: { selector: 'td[data-label="접수시작일"]' },
      category: { selector: 'td[data-label="분류"]' },
    },
  },
  customParse: parseKoccaFinanceList,
  skipHeuristic: true,
  expectMinRows: 2,
  // 2021년 마지막 2건은 접수기간이 실제로 공란이다. 원문 날짜를 보존한다.
  allowUndatedRows: true,
  detailContentSelector: ".board_view01 .board_cont",
  detailAttachments: ({ html, pageHtml }) => koccaFinanceDetailAttachments(pageHtml || html),
  attachmentSession: { referer: "detail" },
};
