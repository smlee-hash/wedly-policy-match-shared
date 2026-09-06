// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 38건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 평택산업진흥원 공지사항.
 *
 * 왜 연결했나(2026-09-01 실측): 최신 공고를 기업마당·보조금24 포함 우리 DB 와 제목으로
 * 대조했더니 **겹침 0/6** 이었다 — 통합 수집원으로는 한 건도 안 들어온다.
 *
 * 구조: 표가 아니라 `ul.table` 안의 `li.tr`(부천 bizbc 와 같음). `li.tr.thead` 는 머리줄이라
 * 반드시 건넌다. 제목이 `<a href>` 가 아니라
 * `<a onclick="fn_goView('번호', 'notice')">` 라서 상세 주소를 손으로 조립한다.
 * 따옴표 안에 공백이 섞이는 경우가 있다(`'1103 '`) — 숫자만 뽑는다.
 * 쪽넘김은 `?page=n` GET. `pageIndex`·`pageNo` 는 안 먹는다. 총 109건 / 11쪽.
 * 등록일 내림차순이라 새 글은 앞쪽에 온다 — `maxPages: 15` 는 최근 150건.
 * 목록은 **등록일만** 준다 — hsbiz 와 같이 「등록일 ~」 개시형으로 넣어 시작일로만 읽히게 하고,
 * 마감 정리는 저장 쪽의 「등록 90일」·「날짜 없음」 규칙에 맡긴다.
 * ⚠️ 고정 공지(id 851·962·1103)가 모든 쪽에 반복되고, 1쪽은 공지+본문에 같은 id 가
 *    두 줄이다. `seen` Set 중복 제거가 필수(엔진도 쪽 사이에서 detailUrl 로 한 번 더 거른다).
 */
const BASE = "https://www.pipabiz.or.kr";
const LIST = "/web/contents/notice.do";
const ID = /fn_goView\(\s*'(\d+)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz).
 * 실측 제목으로 좁힌다(2026-09-01 1·2쪽):
 *   제안서 평가위원회 결과공고 · 제안서 평가위원 모집 · 제안서 평가결과 공고(7건) — 용역 발주
 *   한경국립대학교 경영대학원 최고경영자과정 — 대학원 과정
 *   공공기관 임직원 사칭 사기피해 예방주의 — 안내문
 *   통합 설명회 안내책자 자료 · 참여기관별 발표자료 — 자료 게시
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 *
 * ★적대 리뷰(코덱스) 반영 2건:
 * ① `대학원` 을 통째로 버리면 **「대학원생 창업지원사업」·「산학협력대학원 기술사업화 지원사업」**
 *    같은 진짜 신청 가능 사업이 죽는다. 실측에 있던 건 「경영대학원 최고경영자과정」 하나뿐이라
 *    그 형태로만 좁힌다. (`디지털 특성화대학` 은 원래도 `대학원` 이 아니라 살아 있었다.)
 * ② 용역 발주를 `제안서 평가` 로만 걸렀더니 **평가 단계가 아닌 발주 공고**
 *    (「… 위탁 용역 입찰 공고」)가 그대로 통과한다. 다른 수집기(jica·cwip·hsbiz)가 전부 버리는
 *    `입찰`·`낙찰`·`위탁 운영` 갈래를 같은 기준으로 더한다.
 */
const DROP =
  /제안서\s*평가|경영대학원|최고경영자|사칭|사기피해|예방주의|안내책자|발표자료|입찰|낙찰|계약\s*체결|위탁\s*운영|청렴|설문/;

/**
 * 거르개를 시험에서 **제목 글자만으로** 잴 수 있게 내보낸다.
 * 고정본에 없는 제목(「대학원생 창업지원사업」처럼 앞으로 올라올 수 있는 글)은
 * HTML 을 지어내지 않고는 파서로 못 재는데, 지어낸 HTML 로 재는 것이 바로
 * 창원 첨부 선택자 오타를 통과시킨 방식이다. 판정만 따로 내보내 그 함정을 피한다.
 */
export function isPipaDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parsePipaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll("ul.table li.tr")) {
    const cls = (li.getAttribute("class") ?? "").split(/\s+/);
    if (cls.includes("thead")) continue;
    const a = li.querySelector("div.board_tit a");
    const id = (a?.getAttribute("onclick") ?? "").match(ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(id);
    /**
     * 등록일은 **그 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`li.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     * 조회수 + 날짜가 붙고 `\b` 경계가 깨진다(hsbiz 실측 함정).
     */
    const dateCell = (li.querySelector("div.board_date")?.text ?? "").replace(/\s+/g, " ").trim();
    const d = dateCell.match(YMD);
    /**
     * ★고정 공지는 **등록일을 개시일로 넘기면 안 된다**(적대 리뷰 코덱스 「치명」 · 실측 확인).
     *
     * 저장 쪽 `openStartExpired` 는 「마감일 없음 + 개시일이 90일 초과」면 저장 시점에 닫는다.
     * 그 규칙에는 빠져나갈 구멍이 둘 있는데 고정 공지가 **둘 다 못 쓴다**:
     *   ⓐ `PINNED_NOTICE = /^\s*[[［【(]\s*공지\s*[\]］】)]/` 는 제목이 「[공지]」로 시작해야 한다.
     *      이 게시판의 고정 공지는 제목이 「**[모집]** 2026년 제조 AI …」다 — 안 걸린다.
     *   ⓑ `hasFutureDateInText` 는 본문·요약을 보는데, 처음 저장할 땐 상세를 아직 안 읽어 비어 있다.
     * 실측: 그 공지의 등록일이 2026-05-06 이라 2026-09-01 기준 **118일** — 90일을 넘겨
     * **사이트에서는 맨 위에 고정돼 모집 중인데 우리 DB 에는 처음부터 마감으로** 들어간다.
     * 창원(cwip)에서 244건 중 241건이 저장 즉시 마감됐던 것과 똑같은 갈래다.
     *
     * → 사이트가 「공지」로 고정해 둔 행은 **날짜를 비운다.** 그러면 개시일 규칙 대신
     *   `undatedStale`(처음 본 날 기준 90일)이 걸려, 고정돼 있는 동안은 모집중으로 남는다.
     */
    const pinned = (li.querySelector("div.board_num")?.getAttribute("class") ?? "").split(/\s+/).includes("notice");
    out.push({
      title,
      detailUrl: `${BASE}${LIST}?schM=view&page=1&viewCount=10&id=${id}&notice=notice`,
      dateText: pinned || !d ? "" : `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")} ~`,
      category: "",
      agency: "평택산업진흥원",
    });
  }
  return out;
}

export const pipaConfig: BoardConfig = {
  id: "pipa",
  label: "평택산업진흥원",
  agency: "평택산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?page=${p}`,
    maxPages: 15,
    rowSelector: "ul.table li.tr",
    fields: {
      title: { selector: "div.board_tit a" },
      detailUrl: { selector: "div.board_tit a", attr: "onclick", regex: "fn_goView\\(\\s*'(\\d+)" },
      date: { selector: "div.board_date" },
    },
  },
  customParse: parsePipaList,
  detailContentSelector: "div.detail_contents",
  attachmentsScopeSelector: ".file_attachments-wrap",
  // 제목 거르개를 지난 뒤 한 쪽에 몇 건만 남을 수 있다. 0행이면 서식 변경이므로 2로 둔다.
  expectMinRows: 2,
};
