import { createSbaPageSession, SbaPageEndError } from "./sba-page-session";
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 서울경제진흥원(SBA) 사업신청 > **전체사업**(`Posting.aspx`).
 *
 * 왜 이 게시판인가(2026-09-03 실측): 사이트맵의 「사업신청」 아래 화면은 둘인데
 * `OngoingList.aspx` 는 **지금 접수중인 것만**(표본 9건) 보여 주는 부분집합이고,
 * `Posting.aspx` 가 2017년부터 쌓인 마스터 목록(233쪽·한 쪽 10건)이다. 놓치지 않으려면 이쪽이다.
 *
 * ★기관 이름은 **서울경제진흥원**이다. 2019년에 「서울산업진흥원」에서 바뀌었고 약칭 SBA 만 남았다
 *   (사이트 머리글·바닥글·`<title>` 전부 서울경제진흥원). 출처 id 는 짧은 `sba` 를 그대로 쓰되
 *   **기관명에 옛 이름을 박지 않는다** — 중복 판정 열쇠가 「제목+기관」이라, 기업마당에 지금 이름으로
 *   들어온 같은 공고와 안 묶여 목록에 두 줄로 뜬다(bizbc 에서 겪은 그 갈래).
 *
 * 구조(ASP.NET WebForms GridView):
 * · 행 = `tr.grid_list.tbody` — 한 쪽 10줄
 * · 제목 = `span[id*=new_name_]`. **`<a href>` 가 없다** — 링크는 각 `td` 의
 *   `onClick="location.href='PostingDetail.aspx?p=0&mid=<GUID>'"` 뿐이라 GUID 를 뽑아 조립한다.
 *   같은 GUID 가 숨은 `input[id*=new_displayId_]` 에도 있어 그쪽을 보조로 쓴다.
 * · 접수기간 = `td.date` 안의 `lb_receipt_start_*` · `lb_receipt_end_*` **두 칸** — 시작·끝을 다 준다.
 * · 유형(기업/기업+개인) = `lb_apply_templatename_*`
 *
 * ★붙박이(공지) 줄이 없다 — 표가 유형/사업명/접수일정 세 칸뿐이고 모든 줄이 접수기간을 달고
 *   내려간다(1·2·마지막 쪽 실측). 그래서 koreaexim 식 「1년 넘은 붙박이 버리기」가 필요 없다.
 * ★쪽넘김이 주소가 아니다 — `__doPostBack` POST 다. 회차별 createListSession 이 상태를 보존한다.
 * ★브라우저 UA 가 필요하다(UA 없는 curl 은 HTTP 400/166B). 엔진이 이미 붙이므로 설정은 없다.
 */
const BASE = "https://www.sba.seoul.kr";
const LIST_PATH = "/Pages/BusinessApply/Posting.aspx";
const VIEW_PATH = "/Pages/BusinessApply/PostingDetail.aspx";
/** 첨부(공고문 PDF·신청서 HWP)는 별도 파일 서버에 있다 — 허용 호스트에 없으면 내려받기가 통째로 막힌다. */
const FILE_HOST = "smc.sba.kr";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** onClick 의 `…PostingDetail.aspx?p=0&mid=<GUID>` 에서 열쇠만. 아무 데나 있는 GUID 를 줍지 않는다. */
const MID = /[?&]mid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const YMD = /^(20\d{2})-(\d{2})-(\d{2})$/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다(고정본 20줄에는 한 건도 없다).
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc·geri 주석).
 *   기관이 사람을 뽑는 글(`채용 공고`)만 버리고 `채용 지원사업`은 살린다.
 */
const DROP = /입찰|설문|평가위원|심사위원|합격자|채용\s*(?:공고|안내)/;

export function isSbaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/** "2026-08-26" 처럼 이미 하이픈 형식인 칸만 받는다. 빈 칸·다른 글자는 빈 문자열. */
function ymd(cell: string | undefined): string {
  const m = (cell ?? "").replace(/\s+/g, " ").trim().match(YMD);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

export function parseSbaRaw(html: string, _page = 1): BoardRow[] {
  const root = parseHtml(html);

  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of root.querySelectorAll("tr.grid_list.tbody")) {
    /**
     * 상세 열쇠(GUID)는 `td` 의 onClick 에서 뽑는다. `<a href>` 가 없어 이 길뿐이다.
     * 숨은 `new_displayId_` 입력에도 같은 값이 있어 보조로 쓴다 — 둘 다 없으면 담지 않는다.
     */
    const onclick = tr.querySelector("td[onclick]")?.getAttribute("onclick") ?? "";
    const hidden = (tr.querySelector("input[id*='new_displayId_']")?.getAttribute("value") ?? "").trim();
    const mid = onclick.match(MID)?.[1] ?? (GUID.test(hidden) ? hidden : "");
    if (!mid || seen.has(mid)) continue;

    const title = (tr.querySelector("span[id*='new_name_']")?.text ?? "").replace(/\s+/g, " ").trim();
    // 마지막 쪽(233쪽)에 제목·날짜가 통째로 빈 줄이 실제로 있다(실측) — 그런 줄은 담지 않는다.
    if (!title) continue;
    seen.add(mid);

    /**
     * 접수기간은 **칸(span) 단위**로 읽는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 정규식으로 찾으면 안 된다 — 유형·담당자·전화번호 칸이
     *    띄어쓰기 없이 이어 붙어 날짜 경계가 깨진다(hsbiz 실측 함정).
     */
    const start = ymd(tr.querySelector("td.date span[id*='lb_receipt_start_']")?.text);
    const end = ymd(tr.querySelector("td.date span[id*='lb_receipt_end_']")?.text);
    const dateText = start && end ? `${start} ~ ${end}` : start ? `${start} ~` : end;

    out.push({
      title,
      // ★쪽 번호를 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${VIEW_PATH}?p=0&mid=${mid}`,
      dateText,
      category: (tr.querySelector("span[id*='lb_apply_templatename_']")?.text ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      agency: "서울경제진흥원",
    });
  }
  return out;
}

export function parseSbaList(html: string, page = 1): BoardRow[] {
  return parseSbaRaw(html, page).filter(r => !isSbaDropTitle(r.title));
}

export const sbaConfig: BoardConfig = {
  id: "sba",
  label: "서울경제진흥원(SBA)",
  agency: "서울경제진흥원",
  region: "서울",
  baseUrl: `${BASE}/`,
  // 첨부는 `https://smc.sba.kr/AttachFiles/...` 로 나간다(실측 공고문 PDF·신청서 HWP).
  // 여기 안 적으면 첨부 허용 호스트 명부에도 안 들어가 공고문을 한 장도 못 읽는다.
  allowedHosts: [FILE_HOST],
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호는 init 의 포스트백 본문이 나른다.
    url: () => `${BASE}${LIST_PATH}`,
    // 최신 회차는 10쪽, 과거 쪽은 이어 읽기 장부가 계속 수집한다.
    maxPages: 10,
    rowSelector: "tr.grid_list.tbody",
    fields: {
      title: { selector: "span[id*='new_name_']" },
      detailUrl: { selector: "td[onclick]", attr: "onclick", regex: "mid=([0-9a-fA-F-]{36})" },
      date: { selector: "td.date" },
      category: { selector: "span[id*='lb_apply_templatename_']" },
    },
  },
  createListSession: createSbaPageSession,
  isListEndError: (error) => error instanceof SbaPageEndError,
  customParse: parseSbaList,
  validationParse: parseSbaRaw,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(ccei 와 같은 갈래).
   *
   * 상세 본문(`#new_ntxt_description`)은 있긴 하지만 **표지 요약**이다 — 2026-09-03 표본 30건
   * 실측: 길이 0~1,985자(가운데값 약 700), **200자 미만이 5건**, 「모집대상/지원대상/신청자격」
   * 문단이 있는 것은 **절반인 15건**뿐이고 대부분 「※자세한 사항은 첨부파일 참조」로 끝난다.
   * 그 요약을 `targetText` 에 채우면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""`
   * 조건에서 이 공고를 **영영 건너뛰어** 진짜 자격조건이 든 공고문 PDF 를 한 번도 안 읽는다.
   * 선택자를 비우면 첨부만 수확돼 다음 단계가 공고문에서 본문을 채운다(실측: 공고문 PDF
   * 196KB·`%PDF-1.6` 정상 내려받기, 행마다 첨부 2~3개).
   */
  // 첨부는 이 표 안에만 있다(실측: 상세 페이지 전체에서 파일 링크 2개, 둘 다 이 표 안).
  attachmentsScopeSelector: "table.info_table",
  /**
   * 추측 단계를 끈다. 이 목록에는 **상세로 가는 `<a href>` 가 아예 없어서**(전부 onClick)
   * 추측이 찾을 수 있는 링크는 머리글·바닥글의 메뉴뿐이다 — 그걸 공고로 저장하면
   * 다음 회차에도 지워지지 않는다(한국수출입은행 실측 30줄).
   */
  skipHeuristic: true,
  // 한 쪽 10건. 절반 아래로 떨어지면 서식이 바뀐 것으로 본다.
  expectMinRows: 5,
};
