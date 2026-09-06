// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 36건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 화성산업진흥원 공지사항.
 *
 * 왜 연결했나(2026-09-01 실측): 최신 공고 10건을 기업마당·보조금24를 포함한 우리 DB 전체와
 * 제목으로 대조했더니 **겹침 0건**이었다 — 통합 수집원으로는 이 기관 공고가 하나도 안 들어온다.
 *
 * 구조: 전자정부 표준프레임워크 게시판. 제목이 `<a href>` 가 아니라
 * `<button onclick="fn_search_detail('<nttId>')">` 라서 주소를 손으로 조립한다.
 * 쪽넘김은 폼이 POST 로 되어 있지만 `?pageIndex=n` GET 도 그대로 먹는다(1·2쪽 서로 다른 10건 실측).
 * 목록은 **등록일만** 준다 — cba 와 같이 「등록일 ~」 개시형으로 넣어 시작일로만 읽히게 하고,
 * 마감 정리는 저장 쪽의 「등록 90일」·「날짜 없음」 규칙에 맡긴다.
 */
const BASE = "https://www.hsbiz.or.kr";
const BBS = "BBSMSTR_000000000040";
const NTT_ID = /fn_search_detail\(\s*'([A-Za-z0-9]+)'\s*\)/;
const YMD = /\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/;

/**
 * ★허용목록(KEEP)을 없앴다(적대 리뷰 중요 · 실측 100건).
 * 「모집|공고|신청…」 중 하나가 없으면 버리게 했더니 이 게시판에 흔한 「~ 안내」형 지원사업이
 * 통째로 죽었다: 「경기도 유망중소기업 **인증사업 안내**」(WEDLY 핵심 분야) ·
 * 「2026 화성시 해외전시 단체관 안내」 · 「전시회 출품 및 엑스포 참가 사업 안내」 ·
 * 「ESG 경영 온라인 진단 컨설팅 참여 안내」 · 「노사 상생·협력 우수기업 영상물 제작·홍보 사업 안내」.
 * 「단 1건도 놓치면 안 된다」가 대전제라, 이제 **버릴 것만 지정**한다(아래 DROP).
 */
/**
 * 사업주와 무관한 글. 이 게시판은 시청·가족센터·대학 글이 함께 올라온다 —
 * 10쪽 실측에서 「1인가구 페스타」·「화성 기후탐사대」·「연지곤지 통장 참여자」·「재능기부자」·
 * 「경영대학원 신입생」이 섞여 들어왔다.
 */
const DROP =
  /탐사대|화성탐사|페스타|가족센터|입찰|설문|축제|봉사|강좌|사진전|통장|재능기부|대학원|신입생|학기|장학|시민기자|어린이|청소년|동아리|서포터즈|마음안심|심리지원|헌혈/
  // 인력·용역 — 창원(cwip)은 같은 것을 버리는데 여기만 담고 있었다(적대 리뷰 중요).
  // 「평가위원 모집」·「전문가 풀 모집」·「우선협상대상자 공고」는 기업이 신청할 지원사업이 아니다.
  // `채용` 은 통째로 버리지 않는다 — 「채용 지원사업」은 고용보조금이다.
  ;
const DROP_STAFF = /평가위원|외부전문가|전문가\s*풀|우선협상대상자|제안발표|(?:신규|경력|직원)\s*채용|채용\s*공고/;

export function parseHsbizList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("tbody tr")) {
    const btn = tr.querySelector("button[onclick]");
    const nttId = (btn?.getAttribute("onclick") ?? "").match(NTT_ID)?.[1] ?? "";
    if (!nttId || seen.has(nttId)) continue;
    // ⚠️ 「새글」 딱지를 먼저 떼려면 **trim 이 앞**이어야 한다 — 공백을 남긴 채 `/새글$/` 을 대면
    //    끝이 안 맞아 안 지워진다(적대 리뷰 사소). 지금은 선택자가 딱지 바깥이라 안 터지지만,
    //    선택자가 어긋나 button 글자로 떨어지면 제목이 「… 공고 새글」이 된다.
    const title = (tr.querySelector(".board__subject-text")?.text ?? btn?.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*새글$/, "")
      .trim();
    if (!title || DROP.test(title) || DROP_STAFF.test(title)) continue;
    seen.add(nttId);
    /**
     * 등록일은 **그 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)는 안 된다 — 칸이 띄어쓰기 없이 이어 붙어 조회수 「71」 + 「2026-08-31」이
     *    「712026-08-31」이 되고 낱말 경계가 깨진다(실측).
     * ⚠️ 「날짜가 든 첫 칸」도 안 된다(적대 리뷰 중요) — 칸 순서가 `번호|제목|작성자|조회수|등록일|첨부`라
     *    **제목이 등록일보다 앞이다.** 제목에 「(2026.1.26)」처럼 날짜를 붙이는 관행이 이미 있어,
     *    그 순간 마감일이 개시일로 들어가 자동 마감 시점이 통째로 밀린다.
     *    다행히 표가 `data-cell-header="등록일"` 과 `class="board__table--date"` 를 둘 다 준다.
     */
    const dateCell =
      tr.querySelector('td[data-cell-header="등록일"]') ?? tr.querySelector("td.board__table--date");
    const d = (dateCell?.text ?? "").trim().match(YMD);
    out.push({
      title,
      detailUrl: `${BASE}/bbs/${BBS}/view.do?nttId=${nttId}`,
      dateText: d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")} ~` : "",
      category: "",
      // 이 게시판은 경기도·중기부·KOTRA 공고를 그대로 옮겨 싣는다(실측). 기관을 「화성산업진흥원」으로
      // 못 박으면 중복 판정 열쇠(제목+기관)가 달라져, 기업마당에 원 기관명으로 든 같은 공고와
      // 안 묶여 목록에 두 줄로 뜬다(적대 리뷰 중요). 「작성자」 칸에 실제 부서·기관이 있다.
      agency:
        (tr.querySelector('td[data-cell-header="작성자"]')?.text ?? tr.querySelector("td.writer")?.text ?? "")
          .replace(/\s+/g, " ")
          .trim() || "화성산업진흥원",
    });
  }
  return out;
}

export const hsbizConfig: BoardConfig = {
  id: "hsbiz",
  label: "화성산업진흥원",
  agency: "화성산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/bbs/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}/bbs/${BBS}/list.do?pageIndex=${p}`,
    maxPages: 20,
    rowSelector: "tbody tr",
    fields: {
      title: { selector: ".board__subject-text" },
      detailUrl: { selector: "button[onclick]", attr: "onclick", regex: "fn_search_detail\\(\\s*'([A-Za-z0-9]+)'\\s*\\)" },
      date: {},
    },
  },
  customParse: parseHsbizList,
  // 상세 본문 — board-view__contents-inner 가 실제 글(618자), 바깥 box·header 는 제목·조회수까지 섞인다.
  detailContentSelector: "div.board-view__contents-inner",
  // 제목 거르개를 지난 뒤 한 쪽에 몇 건만 남을 수 있다. 0행이면 서식 변경이므로 2로 둔다.
  expectMinRows: 2,
};
