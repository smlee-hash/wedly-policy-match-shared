import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 제주신용보증재단 교육ㆍ컨설팅 > 창업(모집공고, bo_table=2_3_1_1).
 *
 * 왜 연결했나(2026-09-03 실측): 이 기관은 신용보증재단이라 GNB 에 「지원사업」 메뉴가 없다.
 * 기업이 신청하는 글은 업무안내 > 교육ㆍ컨설팅 하위(bo_table=2_3_1_1)에 있다.
 * 알림마당 > 공지사항(bo_table=5_1_1_1)은 최신 15건이 전부 채용·합격자·임용이라 붙이면 안 된다.
 *
 * ★힌트 도메인 jejusinbo.or.kr 는 틀림. 공식은 jcgf.or.kr (Jeju Credit Guarantee Foundation).
 *
 * 구조: `table tbody tr.bg`. 제목 `td.subject a` href
 * `/bbs/board.php?bo_table=2_3_1_1&wr_id={wr_id}` — 2쪽부터는 `&page=2` 가 붙는다.
 * **wr_id 만** 써서 주소를 조립한다. 쪽 번호가 sourceId 에 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
 * 쪽넘김은 `?page=n` GET. 한 쪽 15건 · 전체 약 7쪽. charset utf-8.
 * 목록은 **접수기간 시작·끝** 을 준다(`td.subject` 다음 td 「접수기간 : YYYY-MM-DD ~ YYYY-MM-DD」).
 * 교육기간 날짜는 마감이 아니라서 넣지 않는다.
 *
 * ★브라우저 UA 위장은 불필요하다(실측 HTTP 200). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://jcgf.or.kr";
const LIST = "/bbs/board.php";
const BOARD = "2_3_1_1";
const WR_ID = /[?&]wr_id=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
const ROW = "table tbody tr.bg";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 공지사항 게시판 실측: 채용공고·합격자·임용·이사 공개모집·필기시험·서류전형.
 * 이 창업 모집 게시판 1·2쪽에는 DROP 후보가 없었다.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc.ts 주석).
 * ★`면접`·`인사` 를 통째로 버리면 「면접 교육」·「인사노무 교육」이 죽는다.
 */
const DROP =
  /입찰|설문|합격자|임용|용역|평가위원|필기시험|서류전형|통합채용|이사\s*공개모집|일자리목표공시제|채용시험|공개채용|면접전형|면접시험/;
const DROP_STAFF =
  /(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isJcgfDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 실측 1·2쪽에는 붙박이 칸이 없다(`td.num` 이 103…89 / 88…73).
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

function ymdList(chunk: string): string[] {
  return [...chunk.matchAll(YMD)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
}

/** 접수기간 칸만. 행 전체 글자에서 찾으면 번호·인원과 날짜가 붙는다(hsbiz 실측 함정). */
function applyPeriodOf(cell: string): { dateText: string; start: string } {
  const compact = cell.replace(/\s+/g, " ").trim();
  const rec = compact.match(/접수기간\s*[:：]\s*(.+?)(?=교육기간|$)/);
  const days = ymdList(rec?.[1] ?? "");
  if (days.length >= 2) return { dateText: `${days[0]} ~ ${days[1]}`, start: days[0] };
  if (days.length === 1) return { dateText: `${days[0]} ~`, start: days[0] };
  return { dateText: "", start: "" };
}

export function parseJcgfList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.subject a");
    const id = (a?.getAttribute("href") ?? "").match(WR_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isJcgfDropTitle(title)) continue;
    /**
     * 접수기간은 **제목 칸 다음 td 를 직접** 집는다(번호|제목|접수/교육기간|상태|신청|인원).
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 「103」 + 「2026-08-27」이
     *    「1032026-08-27」로 붙는다. 교육기간 날짜는 마감이 아니라서 버린다.
     */
    const tds = tr.querySelectorAll("td");
    const subjectIdx = tds.findIndex((td) => (td.getAttribute("class") ?? "").split(/\s+/).includes("subject"));
    const period = applyPeriodOf(subjectIdx >= 0 ? (tds[subjectIdx + 1]?.text ?? "") : "");
    const num = (tr.querySelector("td.num")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = num === "공지" || (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && period.start && now - Date.parse(`${period.start}T00:00:00Z`) > PINNED_MAX_AGE_MS) {
      seen.add(id);
      continue;
    }
    seen.add(id);
    out.push({
      title,
      // ★page 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${LIST}?bo_table=${BOARD}&wr_id=${id}`,
      dateText: period.dateText,
      category: "",
      agency: "제주신용보증재단",
    });
  }
  return out;
}

export const jcgfConfig: BoardConfig = {
  id: "jcgf",
  label: "제주신용보증재단",
  agency: "제주신용보증재단",
  region: "제주",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bo_table=${BOARD}&page=${p}`,
    maxPages: 7,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.subject + td" },
    },
  },
  customParse: parseJcgfList,
  /**
   * 상세 실측(2026-09-03 wr_id=129): 본문은 `#writeContents`(이미지 공고 1장).
   * 첨부 칸 `#view_file_download_area` 는 이 글에선 비어 있으나 칸은 있다 —
   * 범위를 안 적으면 바닥 배너 이미지를 첨부처럼 수확한다.
   */
  detailContentSelector: "#writeContents",
  attachmentsScopeSelector: "#view_file_download_area",
  // 한 쪽 15건. 거르개 뒤에도 실측 15건이 남는다. 절반(7) 미만이면 서식 변경.
  expectMinRows: 7,
};
