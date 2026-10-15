// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 3건(사장님 누락 0 지시)
import { decodeHtmlEntities, parseHtml } from "../html";
import type { BoardConfig, BoardFetchInit, BoardRow, PolicyAttachmentRequest } from "../types";
import { attachmentCollector, cleanAttachmentName } from "./attachment-collect";

const VID = /[?&]vid=(\d+)/;
const RANGE = /20\d{2}-\d{2}-\d{2}\s*~\s*20\d{2}-\d{2}-\d{2}/;
// 구직자 대상 행사는 기업 진단에 무관(적대 리뷰). 「채용 지원사업」(기업 대상)을 지우지 않게 좁게 잡는다.
const DROP = /채용행사|채용박람회|구직자/;

/** 경북경제진흥원(워드프레스 MangBoard 갤러리) — title 속성이 제목, .gallery-date 가 정확한 신청기간. */
export function parseGepaList(html: string): BoardRow[] {
  const titles = new Map<string, string>();
  const dates = new Map<string, string>();
  for (const a of parseHtml(html).querySelectorAll('a[href*="vid="]')) {
    const href = decodeHtmlEntities(a.getAttribute("href") ?? "");
    const m = href.match(VID);
    if (!m) continue;
    const t = (a.getAttribute("title") ?? "").replace(/\s+/g, " ").trim();
    if (t && !titles.has(m[1])) titles.set(m[1], t);
    const dm = (a.text ?? "").match(RANGE);
    if (dm && !dates.has(m[1])) dates.set(m[1], dm[0].replace(/\s+/g, "").replace("~", " ~ "));
  }
  const out: BoardRow[] = [];
  for (const [vid, title] of titles) {
    if (DROP.test(title)) continue;
    out.push({
      title,
      detailUrl: `https://www.gepa.kr/?page_id=36&stype1=type1&vid=${vid}`,
      dateText: dates.get(vid) ?? "",
    });
  }
  return out;
}

const GEPA_AJAX = "https://www.gepa.kr/wp-admin/admin-ajax.php";
const GEPA_FILE = "https://www.gepa.kr/wp-content/plugins/mangboard/includes/mb-file.php";

/**
 * 경북경제진흥원 첨부 — 링크가 `sendBoardFileData(번호,'이름')` 스크립트라 화면에 주소가 없다(2026-10-16 고정본 실측).
 * 브라우저처럼 첨부마다 `admin-ajax.php` 에 form POST 를 1번 보내 받은 `file_path` 로 내려받기 주소를 만든다.
 * ★하나라도 실패하거나 응답이 이상하면 던진다 — 반쪽 목록을 저장하면 빠진 첨부가 「없음」으로 굳는다.
 */
export async function gepaDetailAttachments(
  pageHtml: string,
  fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
): Promise<PolicyAttachmentRequest[]> {
  const root = parseHtml(pageHtml);
  const links = root.querySelectorAll("a.file-download[onclick]");
  if (links.length === 0) return [];
  const boardName = pageHtml.match(/mb_options\["board_name"\]\s*=\s*"([^"]*)"/)?.[1] ?? "";
  const nonce = new URLSearchParams(pageHtml.match(/mb_options\["nonce"\]\s*=\s*"([^"]*)"/)?.[1] ?? "");
  const hidden = (n: string) => root.querySelector(`input[name="${n}"]`)?.getAttribute("value") ?? "";
  const val = (n: string) => nonce.get(n) ?? hidden(n);
  const nv = val("mb_nonce_value");
  const nt = val("mb_nonce_time");
  const wv = val("wp_nonce_value");
  const lang = val("lang") || "ko_KR";
  if (!boardName || !nv || !nt || !wv) throw new Error("경북경제진흥원 첨부 요청 열쇠(nonce)가 화면에 없음");
  const c = attachmentCollector();
  for (const a of links) {
    const m = (a.getAttribute("onclick") ?? "").match(/sendBoardFileData\(\s*(\d+)\s*,\s*'([^']*)'\s*\)/);
    if (!m) throw new Error("경북경제진흥원 첨부 링크 모양이 바뀜");
    const body = new URLSearchParams([
      ["mode", "file"],
      ["board_action", "file_download"],
      ["board_name", boardName],
      ["file_pid", m[1]],
      ["file_name", m[2]],
      ["mb_nonce_value", nv],
      ["mb_nonce_time", nt],
      ["wp_nonce_value", wv],
      ["lang", lang],
      ["action", "skin_mb_board"],
      ["admin_page", "false"],
      ["hybrid_app", ""],
    ]).toString();
    // form 머리글을 직접 적는다 — 안 적으면 fetch 가 text/plain 으로 보내 PHP 가 본문을 못 읽는다(types.ts 주석).
    const res = JSON.parse(
      await fetchText(GEPA_AJAX, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body,
      }),
    ) as { state?: string; data?: { file_path?: unknown } } | null;
    const fp = res?.data?.file_path;
    if (res?.state !== "success" || typeof fp !== "string" || !/^[A-Za-z0-9%._~-]+$/.test(fp)) {
      throw new Error("경북경제진흥원 첨부 주소 응답이 이상함");
    }
    c.add(cleanAttachmentName(m[2]), `${GEPA_FILE}?path=${fp}&file_name=${encodeURIComponent(m[2])}&type=download`);
  }
  return c.list;
}

export const gepaConfig: BoardConfig = {
  id: "gepa",
  label: "경상북도경제진흥원",
  agency: "경상북도경제진흥원",
  region: "경북",
  baseUrl: "https://www.gepa.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.gepa.kr/?page_id=36&mode=list&board_page=${p}&stype1=type1`,
    // 2026-09-02 30쪽 탐침: 상한 밖 살아 있는 2026년 지원사업 11건
    maxPages: 35,
    rowSelector: 'a[href*="vid="]',
    fields: {
      title: { attr: "title" },
      detailUrl: { attr: "href" },
      date: {},
    },
  },
  customParse: (html) => parseGepaList(html),
  detailContentSelector: "#madang01_board",
  expectMinRows: 5,
  detailAttachmentsAsync: ({ pageHtml, fetchText }) => gepaDetailAttachments(pageHtml, fetchText),
};
