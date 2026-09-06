import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 정보통신산업진흥원(NIPA) 주요사업 > 지원분야 > **사업공고**(`bbsNo=4&tab=2`).
 *
 * ★탭을 정확히 골라야 한다 — 같은 화면의 다른 탭은 「사업소개」(tab=1)·「공지사항」(bbsNo=1)이고,
 *   입찰공고(`/home/2-3/8731`)·채용공고(`/home/2-4`)는 **아예 다른 게시판**이라 여기 안 섞인다.
 *   실측 1·2쪽 20건이 전부 기업 대상 모집공고였다(2026-09-03).
 *
 * 구조: `div.bdWrap.gonggo table.tbgg tbody tr` — 한 줄이 4칸이다.
 *   ① 상태뱃지(`div.point b` 「D-14」/「종료」) ② 제목+신청기간(`td.tl`) ③ 담당자 이름 ④ 등록일.
 * 제목은 `td.tl` 안의 `<a href="./nttDetail?...&nttNo=16900">`.
 * 쪽넘김은 `?curPage=n` GET(실측: `curPage=1` 이 첫 쪽과 같은 110,892바이트). 한 쪽 10건 · 전체 209쪽.
 * 목록이 **신청기간을 통째로** 준다 — 「2026-08-18 14:00 ~ 2026-09-17 15:00」.
 *
 * ★브라우저 UA 위장은 불필요하다(실측: UA 없는 curl 도 HTTP 200 / 같은 바이트).
 *
 * ★상세 본문은 `label.cont_align`(실측 1,530자 — 목적·모집대상·지원내용이 다 들어 있다).
 *   본문까지 비워 두면 `fetchDetailAndFill` 이 「본문도 첨부도 없음」으로 판단해 아무것도 저장하지
 *   않는다 — kbiz·geri 처럼 「첨부 길을 열려고 본문을 비우는」 수를 여기서는 쓰면 안 된다.
 *
 * ★첨부(2026-09-03 고침): 링크가 `/comm/getFile?srvcId=...&fileTy=ATTACH` 라 **주소에 확장자도
 *   `download` 글자도 없어서** 공용 수확기가 한 건도 못 집었다. 이제 수확기가 `fileTy=ATTACH` 를
 *   첨부 표식으로 안다 — 실측 상세 1건(nttNo=16900)에서 4건(hwp 3 + zip 1)을 집고 실제로
 *   내려받아 공고문 전문을 읽었다. 형식은 링크 글자의 파일 이름에서 잡힌다(주소엔 확장자가 없다).
 */
const BASE = "https://www.nipa.kr";
const LIST = "/home/bsnsAll/0/nttList";
const VIEW = "/home/bsnsAll/0/nttDetail";
const BBS = "4";
const TAB = "2";
const ROW = "div.bdWrap.gonggo table.tbgg tbody tr";
const NTT_NO = /[?&]nttNo=(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 지정한다.
 * 실측 1·2쪽 20건에는 **한 줄도 걸리지 않는다** — 그래도 남겨 두는 까닭은 이 게시판이 나중에
 * 입찰·평가위원 공고를 함께 올리기 시작해도 조용히 섞여 들어오지 않게 하기 위해서다(gtp 방식).
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(bizbc 주석).
 */
const DROP =
  /입찰\s*공고|낙찰|우선협상대상자|설문\s*조사|설문조사|평가위원|심사위원|외부전문가|전문가\s*풀|합격자|(?:신규|경력|직원)\s*채용|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isNipaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 개시형(「YYYY-MM-DD ~」)으로 떨어진 줄이 **1년 넘게 묵었으면 아예 안 담는다**(koreaexim 방식).
 * 끝날짜가 없으면 저장 쪽 `undatedStale` 이 「처음 본 날부터 90일」을 세기 때문에,
 * 오래된 글이 석 달 동안 「모집중」으로 되살아난다.
 * 신청기간이 온전한 줄(끝날짜가 있는 줄)은 아무리 오래돼도 그대로 담는다 — 마감 판정은 저장 쪽 몫이다.
 */
const OPEN_ENDED_MAX_AGE_MS = 365 * 24 * 3600_000;

/** 칸 글자에서 YYYY-MM-DD 만 뽑아 0채움한다. 시각(14:00)은 애초에 안 걸린다. */
function daysIn(cellText: string): string[] {
  return [...cellText.matchAll(YMD)].map(
    (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
  );
}

export function parseNipaList(html: string, _page = 1, now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 4) continue; // 머리글·「자료가 없습니다」 줄
    const a = tr.querySelector("td.tl a");
    const no = (a?.getAttribute("href") ?? "").match(NTT_NO)?.[1] ?? "";
    if (!no || seen.has(no)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;

    /**
     * 신청기간은 **`td.tl` 안의 `span.bco` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 정규식으로 찾으면 안 된다 — 앞 칸의 상태뱃지 「D-14」와
     *    붙어 「D-142026-08-18」이 되고, 담당자 이름·조회수까지 딸려 온다(화성 실측 함정).
     * ⚠️ 시각(`14:00`)을 남기면 `parseApplyPeriod` 의 「YYYY-MM-DD ~ YYYY-MM-DD」가 안 맞아
     *    신청기간이 통째로 비고, 뒤이은 단일 날짜 되떨어짐도 날짜가 둘이라 안 걸린다.
     */
    const period = (tr.querySelector("td.tl span.bco")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = daysIn(period);
    // 마지막 칸이 등록일이다(「2026-08-18」). 신청기간이 「예산 소진 시」처럼 날짜를 안 줄 때만 쓴다.
    const regCell = (tds[tds.length - 1]?.querySelector("span.bco")?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();

    let dateText = "";
    if (days.length >= 2) {
      dateText = `${days[0]} ~ ${days[1]}`;
    } else {
      const start = days[0] ?? daysIn(regCell)[0] ?? "";
      if (start) {
        if (now - Date.parse(`${start}T00:00:00Z`) > OPEN_ENDED_MAX_AGE_MS) continue;
        dateText = `${start} ~`;
      }
    }

    seen.add(no);
    out.push({
      title,
      /**
       * ★`curPage` 를 넣지 않는다 — 상세 주소가 곧 중복 판정 열쇠(sourceId)라,
       *   쪽이 섞이면 같은 글이 쪽마다 다른 줄로 저장된다.
       * `bsnsDtlsIemNo=`(빈 값)는 사이트가 스스로 붙이는 모양 그대로 둔다 — 값이 늘 비어 있어
       * 줄마다 달라지지 않는다(빼도 같은 154,214바이트 상세가 온다. 실측).
       */
      detailUrl: `${BASE}${VIEW}?tab=${TAB}&bbsNo=${BBS}&bsnsDtlsIemNo=&nttNo=${no}`,
      dateText,
      /**
       * 기관·분류는 넘기지 않는다. 3번째 칸은 **담당자 이름**(「이종석」)이지 기관이 아니고,
       * 분류(`[사업화]`)는 원문에서 주석 처리돼 화면에 안 나온다. 엔진이 설정의 `agency` 로 채운다.
       */
    });
  }
  return out;
}

export const nipaConfig: BoardConfig = {
  id: "nipa",
  label: "정보통신산업진흥원(NIPA)",
  agency: "정보통신산업진흥원",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?bbsNo=${BBS}&tab=${TAB}&curPage=${p}`,
    maxPages: 8,
    rowSelector: ROW,
    fields: {
      title: { selector: "td.tl a" },
      detailUrl: { selector: "td.tl a", attr: "href" },
      date: { selector: "td.tl span.bco" },
    },
  },
  customParse: parseNipaList,
  /**
   * ★여기서는 본문 선택자를 **반드시** 적는다(kbiz·geri 와 정반대인 이유는 파일 머리 주석 참고).
   * 첨부(`/comm/getFile?...`)는 주소에 확장자가 없어 공용 수확기가 못 보고, 본문까지 비우면
   * 이 게시판은 자격조건을 영영 한 글자도 못 받는다.
   */
  detailContentSelector: "label.cont_align",
  /** 첨부는 공고 표(`table.tb05`) 안에만 있다 — 바깥 만족도조사·바닥글 링크를 안 줍게 범위를 좁힌다. */
  attachmentsScopeSelector: "table.tb05",
  // 한 쪽 10건 고정이고 실측 10건이 전부 남았다. 절반인 5로 둔다 — 0행이면 서식 변경.
  expectMinRows: 5,
};
