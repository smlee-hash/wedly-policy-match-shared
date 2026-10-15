/**
 * 저장된 공고의 첨부 목록을 원문에서 다시 읽는다(2026-10-16 「정책매칭 공고 첨부파일 목록 수집 누락 개선」).
 *
 * 왜 필요한가: 게시판 상세 채움(`fillBoardDetail`)은 본문이 빈 행에만 돈다. 본문이 이미 찬 공고는 첨부 갈고리를
 * 새로 붙여도 다시 읽히지 않아 첨부 목록이 빈 채로 남는다. 여기서는 본문을 건드리지 않고 첨부 목록만 읽어
 * 다섯 갈래로 돌려준다. 저장은 앱이 한다.
 * · found — 첨부 목록(1건 이상)
 * · none — 원문을 확인했는데 첨부가 없다
 * · unavailable — 원문에 첨부가 있지만 받을 길이 없다(사유)
 * · unsupported — 다시 읽지 않는 출처(사유는 `ATTACHMENT_LIST_UNSUPPORTED`)
 * · error — 이번에 못 읽었다(사유). 다음에 다시 본다.
 *
 * ★던지지 않는다. 요청은 그 게시판 설정의 허용 호스트·시간 상한·국내 경유를 그대로 지킨다(`fetchBoardText`).
 */
import { readBoardDetail } from "./detail-fill";
import { allowedHostsOf } from "./engine";
import { absolutize, parseHtml } from "./html";
import { boardProxyUrl } from "./proxy";
import { BOARD_SOURCES, DETAIL_FETCH_BODY_MAX_BYTES, DETAIL_FETCH_TIMEOUT_MS, fetchBoardText } from "./registry";
import { attachmentCollector, cleanAttachmentName } from "./sources/attachment-collect";
import type { BoardConfig, PolicyAttachmentRequest } from "./types";

export type AttachmentListResult =
  | { state: "found"; attachments: PolicyAttachmentRequest[] }
  | { state: "none" }
  | { state: "unavailable"; reason: string }
  | { state: "unsupported" }
  | { state: "error"; reason: string };

/** 원문 화면에 첨부 칸이 아예 없는 출처 — 요청 없이 「없음」. */
export const NO_ATTACHMENT_SOURCES = ["bojo24", "work24"] as const;

/**
 * 다시 읽지 않는 게시판과 사유(2026-10-16 실측). 여기 없는 게시판은 전부 다시 읽는다.
 * 상세를 고치거나 갈고리를 붙이면 여기서 빼고 시험의 목록도 같이 고친다.
 */
export const ATTACHMENT_LIST_UNSUPPORTED: Record<string, string> = {
  semas: "상세가 스크립트로 그리는 화면(SPA)이라 서버에서 첨부 목록을 못 읽음",
  snip: "상세 조달이 빈 글을 돌려줌",
  gjsinbo: "상세 본문부터 못 읽음",
  jcgf: "상세 본문부터 못 읽음",
  gipa: "상세 본문부터 못 읽음",
  bssinbo: "상세 본문부터 못 읽음",
  gwsinbo: "상세 본문부터 못 읽음",
  sese: "상세 본문부터 못 읽음",
  smartfactory: "상세 본문부터 못 읽음",
  icsinbo: "첨부 정보가 화면 속 JSON 칸(file_org)에만 있음 — 내려받기 통로 미확인",
  cnsinbo: "내려받기 주소(fileDown)는 있으나 상세 본문을 못 읽음",
  kibo: "화면에 첨부 파일 이름만 있고 내려받기 주소가 없음",
  kosmes: "첨부 확인이 화면 안 요청(fn_odFileCheck)으로만 열림",
  kicox: "첨부 갈고리 추가 예정",
  kead: "목록 요청이 시간 초과로 끝남",
  ketep: "내려받기 주소의 &para 가 ¶ 로 잘못 풀리는 결함 — 짝 요청(첨부 글자 추출)에서 고침",
  "kocca-finance": "내려받기 주소에 인자가 빠짐 — 짝 요청(첨부 글자 추출)에서 고침",
  hrdk: "내려받기 주소에 인자가 빠짐 — 짝 요청(첨부 글자 추출)에서 고침",
  kofic: "내려받기 주소에 인자가 빠짐 — 짝 요청(첨부 글자 추출)에서 고침",
};

const UNSUPPORTED_IDS = new Set(Object.keys(ATTACHMENT_LIST_UNSUPPORTED));
const NO_ATTACHMENT_IDS = new Set<string>(NO_ATTACHMENT_SOURCES);

/**
 * 다시 읽는 출처 — K-Startup + 지원 안 함에 없는 게시판 전부.
 * 상세를 안 읽는 게시판(`skipDetailFill`)도 뺀다 — 생기면 시험이 「지원 + 지원 안 함 = 전체」에서 걸려 사유를 적게 한다.
 */
export const ATTACHMENT_LIST_SOURCES: readonly string[] = [
  "kstartup",
  ...BOARD_SOURCES.filter((c) => !UNSUPPORTED_IDS.has(c.id) && !c.skipDetailFill).map((c) => c.id),
];

/** 지금 읽을 수 있는 출처 — 국내 경유 설정값이 없으면 경유 전용 게시판을 뺀다(요청해 봐야 실패만 쌓인다). */
export function attachmentListSourceIds(): string[] {
  const proxied = boardProxyUrl() !== null;
  return ATTACHMENT_LIST_SOURCES.filter((id) => {
    if (id === "kstartup") return true;
    const cfg = BOARD_SOURCES.find((c) => c.id === id);
    return !!cfg && (!cfg.requiresProxy || proxied);
  });
}

const BUDGET_GONE = "예산이 끝나 요청하지 않음";

export async function readAttachmentList(
  row: { source: string; url: string; sourceId?: string },
  opts: { signal?: AbortSignal } = {},
): Promise<AttachmentListResult> {
  try {
    if (NO_ATTACHMENT_IDS.has(row.source)) return { state: "none" };
    if (row.source === "kstartup") return await readKstartup(row, opts.signal);
    const cfg = BOARD_SOURCES.find((c) => c.id === row.source);
    if (!cfg || UNSUPPORTED_IDS.has(cfg.id) || cfg.skipDetailFill) return { state: "unsupported" };
    if (opts.signal?.aborted) return { state: "error", reason: BUDGET_GONE };
    const problem = boardUrlProblem(cfg, row.url);
    if (problem) return { state: "error", reason: problem };
    if (cfg.requiresProxy && boardProxyUrl() === null) {
      return { state: "error", reason: "국내 경유 설정값이 없어 요청하지 않음" };
    }
    const read = await readBoardDetail(cfg, row.url, { signal: opts.signal });
    if (read.kind === "fail") return { state: "error", reason: read.reason };
    const att = read.attachments;
    if ("error" in att) return { state: "error", reason: cap(`첨부 갈고리 실패: ${att.error}`) };
    if ("unavailable" in att) return { state: "unavailable", reason: cap(att.unavailable) };
    if (att.list.length > 0) return { state: "found", attachments: att.list };
    if (read.text.trim()) return { state: "none" };
    // 본문도 첨부도 없으면 사이트가 빈 화면을 줬을 수 있다 — 「없음」으로 굳히지 않는다.
    return { state: "error", reason: "본문도 첨부도 없음 — 빈 화면일 수 있어 「없음」으로 단정하지 않음" };
  } catch (e) {
    // 오류를 객체째 남기지 않는다(detail-fill 바깥 catch 와 같은 이유).
    return { state: "error", reason: cap(e instanceof Error ? e.message : String(e)) || "알 수 없는 오류" };
  }
}

/** 사유는 앱이 저장한다 — 길이를 묶는다. */
function cap(s: string): string {
  return s.trim().slice(0, 300);
}

/** 요청 전에 거르는 상세 주소 문제. 없으면 null. */
function boardUrlProblem(cfg: BoardConfig, url: string): string | null {
  if (!url.trim()) return "상세 주소가 비어 있음";
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "상세 주소를 읽을 수 없음";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "상세 주소가 http(s) 가 아님";
  if (!allowedHostsOf(cfg).includes(u.host)) return "상세 주소가 이 게시판 호스트가 아님";
  return null;
}

// ── K-Startup ──────────────────────────────────────────────────────────
// 게시판 명부에 없는 출처라 요청 전용 설정을 둔다. 저장된 주소(공공데이터 API 의 detl_pg_url)는 비거나
// 다른 곳일 수 있어 요청하지 않는다 — 정본은 공고 번호다(`sources/kstartup.ts` 의 sourceId = pbanc_sn).

const KS_BASE = "https://www.k-startup.go.kr/";

function ksViewUrl(no: string): string {
  return `${KS_BASE}web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${no}`;
}

const KS_CFG: BoardConfig = {
  id: "kstartup",
  label: "K-Startup",
  agency: "",
  region: "",
  baseUrl: KS_BASE,
  charset: "utf-8",
  list: { url: () => KS_BASE, maxPages: 1, rowSelector: "", fields: { title: {}, detailUrl: {}, date: {} } },
};

/** 공고 번호 — 저장된 공고 번호가 숫자면 그것, 아니면 K-Startup 주소의 pbancSn. 둘 다 없으면 null. */
function kstartupNumberOf(row: { url: string; sourceId?: string }): string | null {
  const id = (row.sourceId ?? "").trim();
  if (/^\d+$/.test(id)) return id;
  try {
    const u = new URL(row.url);
    const host = u.hostname.toLowerCase();
    if ((u.protocol === "https:" || u.protocol === "http:") && (host === "www.k-startup.go.kr" || host === "k-startup.go.kr")) {
      const n = u.searchParams.get("pbancSn") ?? "";
      if (/^\d+$/.test(n)) return n;
    }
  } catch {
    // 주소가 아니면 번호도 없다.
  }
  return null;
}

async function readKstartup(row: { url: string; sourceId?: string }, signal?: AbortSignal): Promise<AttachmentListResult> {
  const no = kstartupNumberOf(row);
  if (!no) return { state: "unavailable", reason: "K-Startup 공고 번호가 없어 원문 주소를 만들 수 없음" };
  if (signal?.aborted) return { state: "error", reason: BUDGET_GONE };
  const html = await fetchBoardText(ksViewUrl(no), "utf-8", KS_CFG, undefined, {
    timeoutMs: DETAIL_FETCH_TIMEOUT_MS,
    maxBytes: DETAIL_FETCH_BODY_MAX_BYTES,
    signal,
  });
  const root = parseHtml(html);
  // 없는 번호·점검 화면에는 제목 칸이 없다 — 「없음」으로 단정하지 않는다.
  if (!root.querySelector("#scrTitle")) return { state: "error", reason: "K-Startup 공고 화면이 아님(제목 칸 없음)" };
  const c = attachmentCollector();
  // 파일 이름 단추(a.file_bg)와 같은 줄의 내려받기 단추 주소를 짝짓는다(2026-10-16 고정본 4개 실측).
  for (const a of root.querySelectorAll("div.board_file a.file_bg")) {
    const href = a.parentNode?.querySelector('a.btn_down[href^="/afile/fileDownload/"]')?.getAttribute("href") ?? "";
    if (href) c.add(cleanAttachmentName(a.text), absolutize(href, KS_BASE));
  }
  return c.list.length > 0 ? { state: "found", attachments: c.list } : { state: "none" };
}
