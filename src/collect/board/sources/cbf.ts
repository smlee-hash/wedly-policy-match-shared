import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 춘천바이오산업진흥원 사업공고(알림마당 > 사업공고, `bcd=01_05_02_00_00`).
 *
 * 구조: `table.table_basic tbody tr`. 제목은 `td.title a`, 상세는
 * `bbs_read.php?groupid=1&bcd=…&bn={bn}&pg={쪽}` **상대** href.
 * 쪽넘김은 `?pg=n` GET · 한 쪽 10건 · 전체 약 90쪽 · utf-8.
 * 목록은 **등록일만** 준다(`td.date` 「2026-08-06」) — geri·pipa 와 같이 「등록일 ~」 개시형.
 * (접수기간은 상세에만 있다 — 아래 `detailContentSelector` 참고.)
 *
 * ★브라우저 UA 위장은 불필요하다(조사 실측: UA 없는 curl 도 HTTP 200). 엔진이 이미 UA 를 붙인다.
 *
 * ★상세 주소에서 `pg` 를 **떼고** 저장한다. 주소가 곧 중복 판정 열쇠(sourceId)라
 *   그대로 두면 같은 글이 1쪽·2쪽에서 다른 줄로 저장된다.
 */
const BASE = "https://www.cbf.or.kr";
const DIR = "/twb_bbs";
const LIST = `${DIR}/bbs_list.php`;
const VIEW = `${DIR}/bbs_read.php`;
const BCD = "01_05_02_00_00";
const BN = /[?&]bn=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 고정본 1·2쪽 20건은 전부 지원사업이라 한 줄도 안 걸린다 — 나중에 섞여 들어올
 * 용역 입찰·평가위원 모집·채용 공고를 막는 그물이다.
 * ★`채용` 을 통째로 버리면 안 된다 — 이 게시판의 간판 사업이 「고용활성화 지원」이고
 *   제목에 「채용」을 쓴다(bizbc 주석과 같은 갈래).
 */
const DROP = /입찰|설문|평가위원|심사위원|합격자|채용\s*공고/;

export function isCbfDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 붙박이 공지 중 **1년 넘게 붙어 있는 것은 버린다**(koreaexim·geri 방식).
 * 붙박이는 날짜를 비워 저장하는데, 그러면 처음 본 날부터 90일간 「모집중」이 된다.
 */
const PINNED_MAX_AGE_MS = 365 * 24 * 3600_000;

export function parseCbfList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.table_basic tbody tr")) {
    const a = tr.querySelector("td.title a");
    const bn = (a?.getAttribute("href") ?? "").match(BN)?.[1] ?? "";
    if (!bn || seen.has(bn)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸 「891」 + 「2026-08-06」이
     *    「8912026-08-06」으로 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    // 붙박이 공지는 번호 칸이 숫자가 아니라 「공지」다(twb_bbs 공통 서식).
    const num = (tr.querySelector("td.number")?.text ?? "").replace(/\s+/g, " ").trim();
    const pinned = (num !== "" && !/^\d+$/.test(num))
      || (tr.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    // 오래 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다.
    if (pinned && ymd && now - Date.parse(`${ymd}T00:00:00Z`) > PINNED_MAX_AGE_MS) continue;
    seen.add(bn);
    out.push({
      title,
      detailUrl: `${BASE}${VIEW}?groupid=1&bcd=${BCD}&bn=${bn}`,
      dateText: pinned || !ymd ? "" : `${ymd} ~`,
      category: "",
      agency: "춘천바이오산업진흥원",
    });
  }
  return out;
}

export const cbfConfig: BoardConfig = {
  id: "cbf",
  label: "춘천바이오산업진흥원",
  agency: "춘천바이오산업진흥원",
  region: "강원",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bcd=${BCD}&pg=${p}`,
    maxPages: 10,
    rowSelector: "table.table_basic tbody tr",
    fields: {
      title: { selector: "td.title a" },
      detailUrl: { selector: "td.title a", attr: "href" },
      date: { selector: "td.date" },
    },
  },
  customParse: parseCbfList,
  /**
   * ★본문 상자는 `div.context` 가 아니라 **`div.business_info`** 를 집는다.
   * 실측(bn=984·982·980·976 넷 다): `div.context` 는 공고 이미지 한 장뿐이라 **글자 0자**이고,
   * 쓸 수 있는 글자는 `div.business_info` 의 「접수기간 2026-07-08 ~ 2026-07-23 / 담당자 …」뿐이다.
   *
   * ★첨부에서 본문을 뽑는 뒷단계에 기대지 않는 이유(실측): 첨부 링크가
   *   `href="javascript:opendownload('01_05_02_00_00', 982, 0)"` 라 진짜 주소가 아니다.
   *   그 함수가 만드는 실주소(`bbs_download.php?bcd=…&bn=…&num=…`)를 직접 불러 보면
   *   **Referer 가 없으면 38바이트짜리 안내문**(`<script>location.href='/';</script>`)만 오고,
   *   상세 페이지를 Referer 로 붙여야 PDF 가 온다. 내려받기 단계는 Referer 를 안 보내므로
   *   이 게시판 첨부는 지금 구조로는 못 읽는다 — 그래서 본문 칸을 비워 두는 대신
   *   실제로 있는 글자(접수기간·담당자)를 채운다.
   */
  detailContentSelector: "div.business_info",
  /** 첨부는 `div.file_wrap` 안에만 있다 — 위쪽 메뉴·바닥글의 파일 링크가 섞이지 않게 범위를 못 박는다. */
  attachmentsScopeSelector: "div.file_wrap",
  // 한 쪽 10건(실측 1·2쪽 모두 10). 절반인 5 밑으로 떨어지면 서식 변경을 의심한다.
  expectMinRows: 5,
};
