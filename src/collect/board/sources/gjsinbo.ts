import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 광주신용보증재단 새소식(notification1).
 *
 * 왜 연결했나(2026-09-03 실측): 사이트 GNB 에 「지원사업」 전용 게시판이 없다.
 * 알림마당 하위는 새소식/채무조정/보도자료/카드뉴스/매각·입찰 5개뿐이고, 온라인 보증신청은
 * 통합포털(untact.koreg.or.kr, 보증드림)로 빠져 있다. 가장 가까운 새소식 1·2쪽 40건 중
 * 지원사업은 「2025 서구 소상공인 특례보증 지원사업」 1건 — 밀도는 낮지만 여기 말고 안 실리는 글이다.
 *
 * 구조: `div.bbs-basic-list div.rows a.row`. 제목은 `div.row-title`, 상세는 href
 * `/index?d=notification1&action=view&bbs_id=1&data_id={ID}`.
 * 쪽넘김은 `?search_page=n` GET. 한 쪽 20건 · 총 192건/약 10쪽. `maxPages: 5`.
 * 목록은 **등록일만** 준다(`ul li:nth-child(3)` 「작성일 : YYYY.MM.DD」) — pipa 와 같이 「등록일 ~」 개시형.
 *
 * 브라우저 UA 없이도 200(실측 58,889바이트). 엔진이 이미 UA 를 붙인다.
 */
const BASE = "https://www.gjsinbo.or.kr";
const LIST = "/index";
const DATA_ID = /[?&]data_id=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다.
 * 실측 제목: 합격자·설문조사·안내 동영상·채용시험·필기시험·공개채용·통합채용·임원 선임·화재.
 * ★`채용` 을 통째로 버리면 안 된다 — 「채용 지원사업」이 죽는다(bizbc.ts 주석).
 */
const DROP =
  /설문조사|안내\s*동영상|화재|입찰|합격자|채용시험|필기시험|공개채용|통합채용|선임공고|임원.{0,12}선임|기간제\s*계약직|면접전형|면접시험|면접심사|서류전형|이사장\s*채용|이사장채용|(?:신규|경력|직원)\s*채용\s*(?:공고|안내|시험)|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isGjsinboDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim.ts 방식).
 * 실측 1·2쪽에는 붙박이 표시가 없다 — class 에 notice 가 생기면 같은 갈래로 건넌다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseGjsinboList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(html).querySelectorAll("div.bbs-basic-list div.rows a.row")) {
    const href = (a.getAttribute("href") ?? "").trim();
    const id = href.match(DATA_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a.querySelector("div.row-title")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`ul li:nth-child(3)` 칸을 직접** 집는다(「작성일 : YYYY.MM.DD」).
     * ⚠️ 행 전체 글자(`a.text`)에서 찾으면 안 된다 — 번호 칸 「192」 + 「2026.07.10」이
     *    「1922026.07.10」으로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (a.querySelector("ul li:nth-child(3)")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.includes("작성일") ? dateCell.match(YMD) : null;
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    const pinned = (a.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(id);
    out.push({
      title,
      // ★쪽 번호(search_page)는 주소에 넣지 않는다. 주소가 곧 중복 판정 열쇠(sourceId)다.
      detailUrl: `${BASE}${LIST}?d=notification1&action=view&bbs_id=1&data_id=${id}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "광주신용보증재단",
    });
  }
  return out;
}

export const gjsinboConfig: BoardConfig = {
  id: "gjsinbo",
  label: "광주신용보증재단",
  agency: "광주신용보증재단",
  region: "광주",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?d=notification1&search_page=${p}&bbs_id=1`,
    maxPages: 5,
    rowSelector: "div.bbs-basic-list div.rows a.row",
    fields: {
      title: { selector: "div.row-title" },
      detailUrl: { attr: "href" },
      date: { selector: "ul li:nth-child(3)" },
    },
  },
  customParse: parseGjsinboList,
  /**
   * 상세 실측(2026-09-03 `data_id=4366`·`4847`): 본문은 `div.cont_box`, 첨부는 `div.download_files`
   * (`index?d=lib&action=download&id=`). 특례보증 글은 본문이 이미지 한 장뿐이었다.
   */
  detailContentSelector: "div.cont_box",
  attachmentsScopeSelector: "div.download_files",
  /**
   * 한 쪽 20건이지만 거르개 뒤 실측 4건. 0행이면 서식 변경이므로 2로 둔다.
   * (20의 절반=10 이면 검증이 거르개 결과를 서식 붕괴로 오인한다.)
   */
  expectMinRows: 2,
  /**
   * 목록 행 안에 첨부 종류 아이콘(`list_icon_pdf.png`·`list_icon_hwp.png`)이 섞여 있다.
   * heuristic 이 아이콘 경로를 공고로·파일 이름을 제목으로 저장하지 않게 끈다.
   */
  skipHeuristic: true,
};
