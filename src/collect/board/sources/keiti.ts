import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 한국환경산업기술원 공지/공고(알림·지식마당 > 공지/공고 > 전체, `cbIdx=277`).
 *
 * 왜 「전체」인가(2026-09-03 실측): 이 판은 딱지(공지·채용·입찰·공시송달)로 갈라져 있고
 * **기업이 신청하는 글은 전부 「공지」 딱지에 들어 있다**(미래환경산업육성융자 지원사업·
 * 녹색자산유동화증권 이차보전 지원사업·COP31 참여기업 모집·ESG 교육생 모집).
 * 그런데 「공지」만 골라 받는 주소(`&searchExt1=24000100`)를 쓰면 **딱지가 새로 생겼을 때
 * 통째로 못 본다.** 사장님 기준은 「값어치로 빼지 말고 전부 붙이고 걸러내기는 매칭이 한다」라
 * 넓은 「전체」를 받고 아래에서 **버릴 것만** 지운다.
 *
 * 구조: `ul.list.col5 > li` 안에 `a[href*=bcIdx]` 하나, 그 안에 `span.cateName`(딱지)·
 * `span.date`(등록일)·`span.subject`(제목)·`span.text`(본문 미리보기)가 나란히 있다.
 * 쪽넘김은 `&pageIndex=n` GET · 한 쪽 10건 · 전체 약 751쪽 · charset utf-8.
 * 목록은 **등록일만** 준다 — pipa·geri 와 같이 「등록일 ~」 개시형.
 *
 * ★붙박이(고정) 공지가 없다 — 1·2쪽 20건이 날짜 내림차순이고 겹치는 글이 0건이다(실측).
 *   그래서 kbiz·geri 처럼 「붙박이는 날짜를 비운다」 갈래를 두지 않는다.
 * ★기관을 제목 앞 대괄호에서 뽑지 않는다 — 이 판의 대괄호는 남의 기관이 아니라 주제 딱지라
 *   (`[기술평가결과]`·`[ESG공시 규제 대응]`·`[온라인 상담]`) 뽑으면 기관 이름이 망가진다(kbiz 와 반대).
 */
const BASE = "https://www.keiti.re.kr";
const LIST = "/site/keiti/ex/board/List.do";
const VIEW = "/site/keiti/ex/board/View.do";
const CB = "277";
const BC = /[?&]bcIdx=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 칸 딱지(`span.cateName`)만으로 버리는 갈래.
 * 실측 근거(2026-09-03, 딱지별 목록을 직접 받아 셈):
 * · `입찰` 30건 전부 「[기술평가결과] … 용역 기술평가 결과 알림」 — 기관이 발주한 조달 건이다.
 * · `채용` 30건 전부 기술원 신규직원·기간제·청년인턴 채용과 친인척 채용인원 공개.
 * · `공시송달` 10건 전부 제재처분 사전통지·행정 공시.
 * ★제목의 낱말 「채용」은 **안 버린다**(아래 DROP 에 없다) — 「청년 채용 지원금」 같은
 *   고용보조금이 죽는다(bizbc 주석). 버리는 건 게시판이 스스로 「채용」으로 분류한 자기 채용글뿐이다.
 */
const DROP_CATE = new Set(["입찰", "채용", "공시송달"]);

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측 제목: 「신기술인증 및 기술검증 신청내용 공고 [금호건설(주)]」(남이 인증을 신청했다는 알림),
 * 「[기술평가결과]… 알림」(조달 결과), 「… 개인정보 제3자 제공 알림」, 「[행사취소 안내]…」,
 * 「중소기업기술마켓 카드뉴스 제 4호」, 「… 국민평가단 모집 안내」, 「… 필기시험 원서접수 안내」.
 * ★교육생·수강생 모집, 설명회·세미나 참가, 시상 공모처럼 **기업이 신청할 수 있는 글은 남긴다** —
 *   걸러내기는 회사별 매칭이 한다(2026-09-03 사장님 「누락 없이 수집」).
 */
const DROP =
  /신청내용\s*공고|기술평가\s*결과|개인정보\s*제3자|행사\s*취소|카드뉴스|평가위원|평가단\s*모집|합격자|입찰\s*공고|수요조사|설문조사|필기시험|자격시험|공시송달/;

export function isKeitiDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function isKeitiDropCategory(cate: string): boolean {
  return DROP_CATE.has(cate.replace(/\s+/g, " ").trim());
}

export function parseKeitiList(html: string, _page = 1): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll("ul.list.col5 > li")) {
    const a = li.querySelector("a[href*='bcIdx=']");
    const idx = (a?.getAttribute("href") ?? "").match(BC)?.[1] ?? "";
    if (!idx || seen.has(idx)) continue;
    if (isKeitiDropCategory(li.querySelector("span.cateName")?.text ?? "")) continue;
    const title = (li.querySelector("span.subject")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    /**
     * 등록일은 **`span.date` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 딱지 「공지」 + 날짜 + 제목이
     *    「공지 2026-09-01 제42회…」로 한 덩어리가 된다(hsbiz 실측 함정과 같은 갈래).
     */
    const dateCell = (li.querySelector("span.date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    const ymd = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
    seen.add(idx);
    out.push({
      title,
      // ★pageIndex 는 넣지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)라 쪽마다 다른 줄이 된다.
      //   onclick="doBbsContentFView('40954')" 는 보조일 뿐이고 href 만으로 상세가 열린다(실측 200).
      detailUrl: `${BASE}${VIEW}?cbIdx=${CB}&bcIdx=${idx}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "한국환경산업기술원",
    });
  }
  return out;
}

export const keitiConfig: BoardConfig = {
  id: "keiti",
  label: "한국환경산업기술원",
  agency: "한국환경산업기술원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?cbIdx=${CB}&pageIndex=${p}`,
    /**
     * ★8쪽이 아니라 12쪽인 이유(2026-09-03 실측 쪽별 남김 수):
     * 1쪽 3 · 2쪽 2 · 3쪽 6 · 4쪽 4 · 5쪽 2 · 6쪽 2 · 7쪽 1 · **8쪽 0** · 9쪽 8 · 10쪽 6 · 11쪽 3 · 12쪽 4.
     * 8쪽은 조달 기술평가결과 9건 + 인증 신청알림 1건이라 통째로 걸러져 0줄이 되는데,
     * 상한을 8로 두면 거기서 끝나 **9~12쪽에 살아 있는 공고 21건을 통째로 잃는다**
     * (「상한 밖에 살아 있는 공고가 있으면 상한을 올린다」 — 2026-09-03 사장님 누락 0 지시).
     * 빈 쪽 하나로는 안 멈춘다(엔진의 연속 2쪽 규칙)라 12쪽까지 실제로 다 읽힌다 — 실측 41건.
     */
    maxPages: 12,
    rowSelector: "ul.list.col5 > li",
    fields: {
      title: { selector: "span.subject" },
      detailUrl: { selector: "a[href*='bcIdx=']", attr: "href" },
      date: { selector: "span.date" },
    },
  },
  customParse: parseKeitiList,
  /**
   * ★`detailContentSelector`(`dl.view div.content`)를 **일부러 안 적는다.**
   * 실측 본문 길이: 융자 지원사업 공고 136자(「붙임과 같이 공고하니…」), 녹색자산유동화증권 0자.
   * 진짜 자격조건은 첨부 공고문(pdf·hwp) 안에 있다. 그 한 줄을 `targetText` 에 채우면
   * 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""` 조건에서 이 공고를 영영 건너뛴다
   * (kbiz·geri 와 같은 갈래). 선택자를 비워 첨부 길을 열어 둔다.
   * 첨부는 본문과 다른 상자(`div.info` 안 `a.attachment`)에 있어 범위를 그쪽으로 못 박는다.
   */
  attachmentsScopeSelector: "div.info",
  /**
   * ★추측(heuristic) 단계를 끈다.
   * 이 판은 10줄 중 5~7줄이 조달·인증 알림이라, 거르개를 지나 남는 줄이 기대치보다 적은 주에
   * 추측 단계로 내려가면 **거르개를 통째로 지나친 「[기술평가결과]…」 같은 글이 그대로 저장된다**
   * — 그 줄은 다음 회차에 지워지지 않는다(수출입은행에서 겪은 갈래).
   * 서식이 바뀌면 0행이 되어 「행 0개」로 잡히므로 마지막 방어선을 잃지도 않는다.
   */
  skipHeuristic: true,
  // 1쪽 10건에서 조달·인증 알림을 걸러내면 실측 3건(2쪽은 2건). 0행이면 서식 변경.
  expectMinRows: 2,
};
