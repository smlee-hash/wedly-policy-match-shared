import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 전북신용보증재단 공지사항(소식안내 > 새소식, MENU_000000000000090).
 *
 * 왜 연결했나(2026-09-03 실측): 힌트 도메인 jbsinbo.or.kr 는 DNS 미등록(curl exit 6).
 * 실제는 www.jbcredit.or.kr. GNB 의 「지원사업」(MENU_068)은 리두드림 금융교육 소개 페이지로
 * 리다이렉트되어 전용 게시판이 없다. 지원사업 공고는 공지사항에 섞여 올라온다.
 *
 * 구조: `table.bbs_list tbody tr`(번호|제목|첨부|작성자|작성일|조회). 제목 `td.title > a`
 * href `/site/menu/MENU_000000000000090/board/view/NTT_{6자리}`.
 * 쪽넘김은 `?pageIndex=n` GET. 한 쪽 10건(+붙박이 3) · 전체 약 18쪽. `maxPages: 8`.
 * 목록은 **등록일만** 준다(`td.m_grey` 두 번째 — 첫 `td.line.m_grey` 는 작성자) —
 * pipa 와 같이 「등록일 ~」 개시형.
 *
 * ⚠️ 목록 행 `td.pc` 에 `/site/resource/file/FILE_…` 첨부 링크가 섞인다 — heuristic 을
 *    끄지 않으면 파일 링크를 공고로 저장한다(한국수출입은행에서 겪음).
 *
 * 브라우저 UA 없이도 200(실측). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.jbcredit.or.kr";
const MENU = "MENU_000000000000090";
const LIST = `/site/menu/${MENU}/board/list`;
const VIEW = `/site/menu/${MENU}/board/view`;
const ASSETS = "%2Fassets%2Fsite%2FLET";
const NTT = /\/view\/(NTT_\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "table.bbs_list tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 금고 지정·재무감사·설문/실태/고객만족도·경영평가·개인정보 제3자·영업점 이전·
 * 시스템 개선·서비스 중단·브로커 주의·업무제안 공모·컨설턴트 모집·면접전형·피싱 사기.
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」이 죽는다(bizbc.ts 주석).
 */
const DROP =
  /금고\s*지정|재무감사|설문조사|실태조사|고객만족도|경영평가|개인정보\s*제3자|영업점\s*이전|시스템\s*개선|서비스\s*중단|브로커|업무제안\s*공모|컨설턴트\s*모집|면접전형|입찰|합격자|평가위원|사기|피싱|사칭/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;
/**
 * 실측한 청탁금지법 선물 안내만 제외한다. 카드뉴스 형식의 지원사업은 보존한다.
 */
const DROP_ADMIN = /청탁금지법\s*선물/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isJbsinboDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title) || DROP_ADMIN.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 * 실측 붙박이 「신용보증 상담예약제」(2024-07-12)가 이 갈래에 걸린다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

type JbsinboRaw = { id: string; title: string; ymd: string; pinned: boolean };

function jbsinboRawRows(html: string): JbsinboRaw[] {
  const out: JbsinboRaw[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.title > a") ?? tr.querySelector("td.title a");
    const href = (a?.getAttribute("href") ?? "").trim();
    const id = href.match(NTT)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    // 붙박이 행의 「공지」 딱지(span.blind · i.notice)는 제목에 넣지 않는다.
    a?.querySelector("span.blind")?.remove();
    a?.querySelector("i.notice")?.remove();
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    /**
     * 등록일은 **두 번째 `td.m_grey` 칸을 직접** 집는다.
     * 첫 `td.line.m_grey` 는 작성자명, 그다음 `td.m_grey` 가 작성일이다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「177」 + 「2026-09-02」가
     *    「1772026-09-02」로 붙는다(hsbiz 실측 함정).
     */
    const greys = tr.querySelectorAll("td.m_grey");
    const dateCell = (greys[1]?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const numText = (tr.querySelector("td.pc")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = numText === "공지" || !!tr.querySelector("i.notice");
    seen.add(id);
    out.push({ id, title, ymd, pinned });
  }
  return out;
}

function jbsinboRow(raw: JbsinboRaw, dateText: string): BoardRow {
  return {
    title: raw.title,
    // ★pageIndex 는 쪽 번호라 주소에 넣으면 같은 글이 쪽마다 다른 줄로 저장된다.
    detailUrl: `${BASE}${VIEW}/${raw.id}`,
    dateText,
    category: "",
    agency: "전북신용보증재단",
  };
}

/** 거르개 전 원본. 붙박이도 실제 등록일을 남긴다. */
export function parseJbsinboValidationList(html: string, _page = 1): BoardRow[] {
  return jbsinboRawRows(html).map((raw) => jbsinboRow(raw, raw.ymd ? `${raw.ymd} ~` : ""));
}

export function parseJbsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  for (const raw of jbsinboRawRows(html)) {
    if (isJbsinboDropTitle(raw.title)) continue;
    if (raw.pinned && raw.ymd && now - Date.parse(`${raw.ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    out.push(jbsinboRow(raw, raw.pinned || !raw.ymd ? "" : `${raw.ymd} ~`));
  }
  return out;
}

export const jbsinboConfig: BoardConfig = {
  id: "jbsinbo",
  label: "전북신용보증재단",
  agency: "전북신용보증재단",
  region: "전북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?site_assets=${ASSETS}&pageIndex=${p}`,
    maxPages: 8,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.title > a" },
      detailUrl: { selector: "td.title > a", attr: "href" },
      date: { selector: "td.m_grey" },
    },
  },
  customParse: parseJbsinboList,
  validationParse: parseJbsinboValidationList,
  /**
   * 상세 GET 실측(NTT_005546, 2026-09-03): 본문은 `#writeContents`(ck-content, 지원사업 안내 문단).
   * 첨부는 본문과 다른 칸 `td.file`(`/site/resource/file/FILE_…` · hwp).
   */
  detailContentSelector: "#writeContents",
  attachmentsScopeSelector: "td.file",
  /**
   * 최소 행은 거르개 전 원본(validationParse)에 적용한다. DROP·카드뉴스 뒤 정책 행이
   * 1건이어도 원본 13행(중복 NTT 제외)이 살아 있으면 서식이 멀쩡하다. 원본 0행이면
   * 서식 변경이므로 2 로 둔다 — 1은 검사를 끈 것과 같다.
   */
  expectMinRows: 2,
  /**
   * 목록 행에 첨부 파일 링크가 섞여 있다. heuristic 이 파일 링크를 공고로,
   * 파일 이름을 제목으로 저장한다 — 오류가 틀린 저장보다 낫다.
   */
  skipHeuristic: true,
};
