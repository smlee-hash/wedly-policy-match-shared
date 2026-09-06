import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 부산경제진흥원 지원사업안내.
 *
 * 왜 연결했나(2026-09-03 실측): 「지원사업안내」가 대상군별 5개 병렬 게시판이다
 * (소상공인 1502 · 산업인력 1504 · 지역기업 1505 · 유망산업 1506 · 청년 1670).
 * idx 가 서로 안 겹치는 독립 목록이라 전량 수집하려면 다섯 주소를 다 훑어야 한다.
 * 공고/공지사항(no=1508)은 입찰·포럼개최·사칭주의가 섞이고 최신순도 아니라 안 붙인다.
 *
 * 구조: `table.skin_01 tbody tr`. 제목 `td.title a[href]`.
 * 상세 원문은 `pageIndex`·`state`·`items` 를 달고 있어 그대로 쓰면 같은 글이 쪽마다
 * 다른 줄로 저장된다 — `no`+`idx`+`view=view` 만 남긴다.
 * 쪽넘김은 화면엔 `onclick=linkPage(N)` 이지만 GET `?pageIndex=n` 이 먹는다(1·2쪽 첫 제목 다름 실측).
 * 한 쪽 10건 · 지역기업만 약 47쪽. charset 은 응답 헤더 UTF-8(html meta 에는 charset 없음).
 * 목록은 **등록일만** 준다 — kbiz 와 같이 「등록일 ~」 개시형.
 *
 * 엔진 쪽수 상한은 10. url(1)·url(2) 는 같은 게시판(1505)의 1·2쪽이라
 * `pagingParamsOf` 가 `pageIndex` 만 집어 `no` 를 상세에서 떼지 않는다.
 * 3쪽부터는 나머지 4개 게시판을 2쪽씩 이어서 훑는다.
 *
 * 상세 실측(`/kor/view.do?no=1505&idx=19470&view=view`): 본문 `dd.cont`(527자),
 * 첨부 `dd.file-item` 의 `onclick=downFile(n)` — 공용 수확기는 eGov/서울TP 만 알아
 * 이 클릭은 못 줍는다. 본문 길을 연다.
 */
const BASE = "https://bepa.kr";
const LIST = "/kor/view.do";
/** 지역기업을 앞에 둔다 — url(1)·url(2) 가 pageIndex 만 달라지게. 1508(일반 공지)은 제외. */
const BOARDS = [1505, 1502, 1504, 1506, 1670] as const;
const PAGES_PER_BOARD = 2;
const IDX = /[?&]idx=(\d+)/;
const NO = /[?&]no=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const ROW = "table.skin_01 tbody tr";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 평가위원 후보자 · 용역 입찰 · 임시직 채용공고 · 최종합격자 · 서류전형/면접전형 ·
 * 포럼 개최 · 금고 지정 · 명함 사칭 · 사기범죄.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 * ★`평가` 를 통째로 버리면 안 된다 — 「가치평가 지원사업」 갈래가 죽는다(cistep).
 */
const DROP =
  /입찰|설문|평가위원|서류전형|면접전형|합격자|사칭|포럼\s*개최|금고\s*지정|사기범죄/;
const DROP_STAFF = /(?:신규|경력|직원|임시직)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/** 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim 과 같은 갈래). */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function isBepaDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*새글$/i, "")
    .trim();
}

function listUrl(p: number): string {
  const i = Math.min(Math.max(0, Math.floor((p - 1) / PAGES_PER_BOARD)), BOARDS.length - 1);
  const page = ((p - 1) % PAGES_PER_BOARD) + 1;
  return `${BASE}${LIST}?no=${BOARDS[i]}&pageIndex=${page}`;
}

export function parseBepaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.title a");
    const href = a?.getAttribute("href") ?? "";
    const idx = href.match(IDX)?.[1] ?? "";
    const no = href.match(NO)?.[1] ?? "";
    if (!idx || !no) continue;
    const key = `${no}-${idx}`;
    if (seen.has(key)) continue;
    const title = cleanTitle(a?.text ?? "");
    if (!title || isBepaDropTitle(title)) continue;
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「2987」 + 「2026-09-02」가
     *    「29872026-09-02」로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = /공지/.test((tr.querySelector("td.num")?.text ?? "").replace(/\s+/g, " ").trim());
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(key);
    out.push({
      title,
      // ★pageIndex·state·items 는 상세를 여는 데 필요 없다. pageIndex 는 쪽마다 바뀌고
      //   state 는 ing↔end 로 바뀌므로 주소에 넣으면 같은 공고가 두 줄로 저장된다.
      detailUrl: `${BASE}${LIST}?no=${no}&idx=${idx}&view=view`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: (tr.querySelector("td.orgNm")?.text ?? "").replace(/\s+/g, " ").trim() || "부산경제진흥원",
    });
  }
  return out;
}

export const bepaConfig: BoardConfig = {
  id: "bepa",
  label: "부산경제진흥원",
  agency: "부산경제진흥원",
  region: "부산",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: listUrl,
    maxPages: 10,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.title a" },
      detailUrl: { selector: "td.title a", attr: "href", regex: "idx=(\\d+)" },
      date: { selector: "td.date" },
    },
  },
  customParse: parseBepaList,
  /**
   * 상세 실측(idx=19470, 2026-09-03): 본문 `dd.cont`. 첨부는 `dd.file-item` 안
   * `onclick=downFile(n)` 이라 공용 수확기가 못 줍는다 — 본문 길을 연다.
   */
  detailContentSelector: "dd.cont",
  attachmentsScopeSelector: "dd.file-item",
  // 한 쪽 10줄에서 거르개를 지나면 절반 근처가 남는다. 0행이면 서식 변경.
  expectMinRows: 5,
};
