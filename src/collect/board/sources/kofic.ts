import { attachmentKindOf } from "@/lib/policy-match/types";
import { parseHtml } from "../html";
import { isImageAttachment } from "./attachment-skip";
import type { BoardConfig, BoardRow, PolicyAttachmentRequest } from "../types";

/**
 * 영화진흥위원회(KOFIC) 공지사항 — `selectBoardList.do?boardNumber=4`.
 *
 * 왜 연결했나(2026-09-06 실측): robots 가 `allow: /` 로 전면 허용이고 서버 렌더라 기술 장벽이 없다.
 * 다만 이 판은 **공지사항 한 판**이라 채용·상영 라인업·심사 결과·교육생 모집이 대부분이고,
 * 기업(영화 제작사)이 신청할 수 있는 글은 최근 30일 19건 중 1~2건이다 — 거르개가 본체다.
 * ※한계: 기업마당(bizinfo) 미러 여부는 미확인이다(검색 통로가 인자를 무시해 제목 대조를 못 했다).
 *
 * 구조: 목록 `table.bbs_ltype tbody tr` 15행/쪽. 제목 `td.subject a` 의 href 는 `#none` 이고
 * `onclick="fn_goDetailPage(75180 , '10031001' , '')"` 첫 숫자가 글번호다. 분류 `td:nth-child(2)`,
 * 날짜 `td.date`(`2026.09.04`). 쪽넘김은 화면상 POST 지만 **GET `&curPage=N` 도 통한다**(2쪽 실측 200).
 * 접수기간 칸이 없어 마감은 본문·첨부에서 뽑는다 — 그래서 「등록일 ~」 개시형으로 낸다.
 *
 * 상세는 `selectBoardDetail.do?boardNumber=4&boardSeqNumber=<번호>` GET 200.
 * 본문 `div.bbs_view_cont`(포스터 그림만인 건이 흔하다 — 그래서 첨부 글자가 사실상 필수).
 * 첨부는 **POST 전용**: `fn_fileDownload('<순번>','<디렉터리>','<저장이름>','<원본이름>')` →
 * `POST /kofic/business/comm/file/downloadFile.do` body `fileUrl`·`fileNm`·`dnFileName`
 * → 200 + PDF 130,996바이트(쿠키·로그인 불필요). 정적 경로 GET 은 404 다.
 */
const BASE = "https://www.kofic.or.kr";
const LIST = "/kofic/business/board/selectBoardList.do";
const DETAIL = "/kofic/business/board/selectBoardDetail.do";
const DOWNLOAD = "/kofic/business/comm/file/downloadFile.do";
const BOARD_NUMBER = 4;
const ROW = "table.bbs_ltype tbody tr";
const GO_DETAIL = /fn_goDetailPage\(\s*'?(\d+)'?/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
/** `fn_fileDownload('1','/kofic/uploadFile/attachFile/202609','8123….pdf','참가자 모집공고 ….pdf')` */
const FILE_DOWNLOAD =
  /fn_fileDownload\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/;

/**
 * 기업 대상 지원사업이 아닌 글. **버릴 것만** 지정한다. 실측 1·2쪽 30건에서 나온 다섯 갈래다
 * (2026-09-06 정찰 `filterNeeded`): ①채용 ②상영 라인업·영화제 ③심사·선정 결과
 * ④교육생 모집(한국영화아카데미·KAFA — 개인 대상) ⑤시스템/점검 작업·사칭·공시송달·제보 접수.
 * 2026-09-06 독립 리뷰로 「점검 작업」·「선발 결과」·「실태조사」를 더했다 — 2쪽 고정본에 실물이 있다.
 *
 * ★`모집` 을 통째로 버리면 안 된다 — 남는 유일한 갈래가 「참가자 모집」·「참가기업 모집」이다
 *  (실측 1쪽 「2026 KOFIC x VIPO Producers Exchange @Tokyo 참가자 모집」).
 */
const DROP =
  /공개채용|채용\s*(?:공고|재공고|안내)|최종\s*합격자|합격자\s*발표|면접|상영\s*(?:라인업|프로그램)|영화제\s*안내|심사\s*결과|대상작\s*결과|선정\s*결과|교육생\s*모집|영화아카데미|KAFA|시스템\s*점검|점검\s*작업|사칭|공시송달|제보\s*접수|선발\s*결과|실태조사/;

/** 목록 분류 칸이 이 값이면 제목을 보지 않고 버린다(실측 값: 일반·채용). */
const DROP_CATEGORY = new Set(["채용"]);

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isKoficDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseKoficList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td.subject a");
    const call = `${a?.getAttribute("onclick") ?? ""} ${a?.getAttribute("href") ?? ""}`;
    const seq = call.match(GO_DETAIL)?.[1] ?? "";
    if (!seq || seen.has(seq)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isKoficDropTitle(title)) continue;
    const category = (tr.querySelector("td:nth-child(2)")?.text ?? "").replace(/\s+/g, " ").trim();
    if (DROP_CATEGORY.has(category)) continue;
    seen.add(seq);
    /**
     * 작성일은 **`td.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 번호 칸과 붙어 「12026.09.04」가 된다(hsbiz 실측 함정).
     */
    const d = (tr.querySelector("td.date")?.text ?? "").replace(/\s+/g, " ").trim().match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    out.push({
      title,
      detailUrl: `${BASE}${DETAIL}?boardNumber=${BOARD_NUMBER}&boardSeqNumber=${seq}`,
      // 접수기간 칸이 없다 — 「등록일 ~」 개시형(kodma·sida 와 같다). 마감은 본문·첨부에서 뽑힌다.
      dateText: ymd ? `${ymd} ~` : "",
      category,
      agency: "영화진흥위원회",
    });
  }
  return out;
}

/**
 * 상세의 첨부를 **POST 요청으로** 만든다. 정적 경로 GET 은 404 라 주소만으로는 못 받는다(실측).
 *
 * ★한 공고의 첨부들이 **같은 주소**를 쓴다(내려받기 창구가 하나고 본문만 다르다) —
 *  실측한 요청 그대로가 아니면 서버가 어떻게 받을지 알 수 없어 일부러 그대로 둔다.
 */
export function koficDetailAttachments(html: string): PolicyAttachmentRequest[] {
  const url = `${BASE}${DOWNLOAD}`;
  const out: PolicyAttachmentRequest[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(html).querySelectorAll("dl.bbs_view a.file")) {
    const call = `${a.getAttribute("onclick") ?? ""} ${a.getAttribute("href") ?? ""}`;
    const m = call.match(FILE_DOWNLOAD);
    if (!m) continue;
    const [, , fileUrl, fileNm, realName] = m;
    if (!fileUrl || !fileNm || seen.has(fileNm)) continue;
    // 화면 글자는 원본 이름과 같지만, 인자 쪽이 더 믿을 만하다(그림 대체글자가 섞이지 않는다).
    const name = (realName || a.text || fileNm).replace(/\s+/g, " ").trim();
    // 그림은 담지 않는다 — 글자가 0인데 개수 상한을 차지해 공고문(pdf·hwp)을 밀어낸다.
    if (isImageAttachment(name) || isImageAttachment(fileNm)) continue;
    seen.add(fileNm);
    out.push({
      name,
      url,
      // ★형식은 **저장 이름**으로 가린다 — 원본 이름에 점이 여럿이면(`… v1.2 안내.pdf`) 헷갈린다.
      kind: attachmentKindOf(fileNm, url),
      method: "POST",
      body:
        `fileUrl=${encodeURIComponent(fileUrl)}` +
        `&fileNm=${encodeURIComponent(fileNm)}` +
        `&dnFileName=${encodeURIComponent(name)}`,
    });
  }
  return out;
}

export const koficConfig: BoardConfig = {
  id: "kofic",
  label: "영화진흥위원회",
  agency: "영화진흥위원회",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?boardNumber=${BOARD_NUMBER}&curPage=${p}`,
    // 총 161쪽이지만 최근 30일이 1~2쪽이면 다 들어온다(거르개 뒤 월 1~3건).
    maxPages: 2,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "onclick", regex: "fn_goDetailPage\\(\\s*'?(\\d+)'?" },
      date: { selector: "td.date" },
      category: { selector: "td:nth-child(2)" },
    },
  },
  customParse: parseKoficList,
  /**
   * ★추측 단계를 끈다. 제목 링크가 전부 `href="#none"` 이라 추측 단계가 `a[href]` 를 긁으면
   * 메뉴·배너가 공고로 저장되고, 거르개를 지나친 채용·상영 글이 그대로 남는다(kodma 와 같은 갈래).
   */
  skipHeuristic: true,
  /**
   * 거르개가 세서 실측 1쪽 15행 중 **2건**만 남는다(2026-09-06). 그래서 1 로 둔다 —
   * 서식이 바뀌어 0건이 되면 검증의 「행 0개」가 그 자리에서 끊는다.
   */
  expectMinRows: 1,
  detailContentSelector: "div.bbs_view_cont",
  detailAttachments: ({ html }) => koficDetailAttachments(html),
};
