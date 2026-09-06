// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 2건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 전주정보문화산업진흥원 사업공고.
 *
 * 왜 연결했나(2026-09-01 실측): 이 게시판 **1쪽 9건**을 기업마당·보조금24 포함 우리 DB 와
 * 제목으로 대조했더니 **겹침 0건**이었다 — 통합 수집원으로는 한 건도 안 들어온다.
 * (「전체 9건」이 아니다 — 아래 쪽넘김 설명대로 81쪽·약 729건이 있다.)
 *
 * 구조: 표 한 장에 `번호 | 접수상태 | 제목 | 시작일 | 마감일 | 남은날 | 조회수`.
 * 번호는 `th.mnom` 이고 제목은 `td.left` 라, 날짜 칸만 `td.mview` 다.
 * **시작일·마감일을 둘 다 준다** — 마감 정리가 정확해진다.
 * 쪽넘김은 `pno=n`(2026-09-01 실측). `page`·`pageNo`·`p`·`startPage`·`offset` 은
 * 전부 안 먹고 1쪽을 그대로 돌려준다. caption `사업공고 리스트 (1/81)` — **81쪽·1쪽 9건**.
 * 살아 있는 공고(`span.ing` 접수중)는 1쪽에 2건뿐이고 2~5쪽은 0건이라는
 * 스냅샷이 있었으나, 2026-09-03 감시 장치 실측 상한 밖 2건이 있어 `maxPages: 10` 까지 판다.
 * 81쪽 전부가 아니다.
 * 루트 도메인이 `/2025/` 하위로 넘어가므로 주소에 그 경로가 들어간다.
 */
const BASE = "https://www.jica.or.kr/2025";
const NO = /[?&]no=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버린다.
 * 실측 추가: 「카페 위탁운영업체 선정 모집」 2건 — 용역 발주지 지원사업이 아니다.
 */
const DROP = /입찰|계약\s*체결|낙찰|청렴|설문|정기\s*총회|이사회|카페\s*위탁운영/;
const DROP_STAFF = /(?:신규|경력|직원)\s*채용|채용\s*공고/;

const ymd = (s: string): string => {
  const m = s.match(YMD);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
};

export function parseJicaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("tbody tr")) {
    const a = tr.querySelector('a[href*="mode=view"]');
    const no = (a?.getAttribute("href") ?? "").match(NO)?.[1] ?? "";
    if (!no || seen.has(no)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title) || DROP_STAFF.test(title)) continue;
    seen.add(no);
    /**
     * 접수일·마감일은 **`td.mview` 위치**로 집는다(첫 칸=접수일, 둘째=마감일).
     * ⚠️ 「날짜가 든 td 를 순서대로 두 개」는 이 저장소가 이미 두 번 데인 함정이다(hsbiz).
     *    칸 순서가 현황|제목|접수일|마감일|D-Day|조회수 라 제목이 접수일보다 앞이고,
     *    이 게시판 제목은 `[공고 제2026-066호]` 처럼 숫자를 단다. 제목에 날짜가 붙는 순간
     *    그 값이 접수일로 들어간다. 번호는 `th` 라 `td` 목록에 안 들어오고, 제목은 `td.left`
     *    라 `mview` 가 없다.
     */
    const mviews = tr.querySelectorAll("td.mview");
    const start = ymd((mviews[0]?.text ?? "").trim());
    const end = ymd((mviews[1]?.text ?? "").trim());
    /**
     * 사이트가 찍어 주는 접수상태. 이걸 안 보면 아래 함정에 빠진다.
     * ⚠️ 글자를 그대로 대면 안 된다(적대 리뷰 코덱스) — 「접수 중」처럼 사이 공백이 들어가거나
     *    「진행중」으로 문구가 바뀌면 `open=false` 가 되어, 마감일 없는 공고가 개시일만 안고
     *    저장 즉시 90일 마감 경로로 들어간다. 공백을 지우고 세 표기를 다 받는다.
     *    (상세 화면은 같은 상태를 `span.view_ing` 「진행」으로 쓴다 — 표기가 실제로 갈린다.)
     */
    const state = (tr.querySelector("span.ing")?.text ?? "").replace(/\s+/g, "");
    const open = /접수중|진행중|진행/.test(state);
    /**
     * ★마감일이 없는데 시작일만 「2026-08-10 ~」로 넘기면 안 된다(cwip 치명2).
     * 그 모양은 등록일만 주는 게시판과 똑같아서 저장 쪽 「개시 90일 자동 마감」에 그대로 걸린다.
     * 창원 실측: 244건을 그 규칙에 통과시키면 **열림 3 · 닫힘 241**. 사이트가 「접수중」이라고
     * 말하는데 우리가 끄는 셈이라, 그럴 땐 **날짜를 아예 비운다.**
     */
    const dateText =
      start && end ? `${start} ~ ${end}`
      : start ? (open ? "" : `${start} ~`)
      : "";
    out.push({
      title,
      detailUrl: `${BASE}/inner.php?sMenu=A1000&mode=view&no=${no}`,
      dateText,
      category: "",
      // 화성(hsbiz)·부천(bizbc)은 남의 공고를 옮겨 실어 행의 작성자 칸을 읽는다.
      // 이 게시판은 작성자 칸이 HTML 에서 아예 주석 처리돼 있다(`<!--th scope="col">작성자</th-->`)
      // — 행에서 읽을 방법이 없으므로 기관명을 못 박는 게 맞다.
      agency: "전주정보문화산업진흥원",
    });
  }
  return out;
}

export const jicaConfig: BoardConfig = {
  id: "jica",
  label: "전주정보문화산업진흥원",
  agency: "전주정보문화산업진흥원",
  region: "전북",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    /**
     * 쪽넘김은 pno. 81쪽 중 10쪽까지 판다.
     * 처음엔 3쪽이었는데 적대 리뷰(코덱스)가 짚었다 — 「2~5쪽에 접수중이 없더라」는 **한 번의
     * 스냅샷**이라, 신규 글이 쌓여 장기 접수 공고가 4쪽 뒤로 밀리면 그 공고는 영영 안 잡히고
     * 이미 저장된 것도 갱신이 끊겨 stale 마감된다. 이 게시판은 **마감일을 직접 주므로**
     * 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다(markExpiredClosed 가 닫는다) — 깊이의
     * 대가가 없다. 10은 SHALLOW_MAX(7)를 넘으므로 deep-paging 허용목록에 둔다.
     */
    url: (p) => `${BASE}/inner.php?sMenu=A1000&pno=${p}`,
    maxPages: 10,
    rowSelector: "tbody tr",
    fields: {
      title: { selector: 'a[href*="mode=view"]' },
      detailUrl: { selector: 'a[href*="mode=view"]', attr: "href" },
      date: { selector: "td.mview" },
    },
  },
  customParse: parseJicaList,
  /**
   * 상세 본문. 이게 없으면 상세를 받아 와도 자격조건이 **영영 빈 문자열**로 남아,
   * 공고가 계속 「확인 필요」인 채 회차마다 같은 상세를 다시 요청한다(적대 리뷰 코덱스).
   * 실측: 본문은 `div.substance > div.smartOutput` 안에 있다. 바깥 `.substance` 는
   * 「본문 내용」이라는 숨김 제목까지 함께 물어 오므로 안쪽 `.smartOutput` 을 집는다.
   */
  detailContentSelector: "div.smartOutput",
  /**
   * 첨부 수확 범위. **이 게시판은 본문이 대개 이미지라 글자가 0자다** —
   * 실측 5건 중 3건(no=810·804·840)이 본문 0자였고, 다섯 건 모두 첨부는 2~3개 있었다.
   * 즉 자격조건은 사실상 첨부에서만 나온다(창원 cwip 과 같은 사정).
   * 범위를 안 적으면 상세 전체에서 긁어 왼쪽 메뉴·바닥글 링크까지 섞이므로(인천 비즈OK 실측)
   * 첨부 목록 컨테이너 `.allfile` 안으로 제한한다.
   */
  attachmentsScopeSelector: ".allfile",
  expectMinRows: 3,
};
