import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 창원산업진흥원 사업신청 목록.
 *
 * 왜 연결했나(2026-09-01 실측): 최신 공고 10건을 기업마당·보조금24 포함 우리 DB 전체와
 * 제목으로 대조했더니 **겹침 2/10** 이었다 — 나머지 8건은 어디로도 안 들어온다.
 * (수출 표준화 지원사업 · 플랫폼기반 시뮬레이션 기술 지원 · Buy R&D 기술이전 등)
 *
 * 구조: 표가 아니라 `div.card_wrap` 카드 목록. **드물게도 신청기간을 목록에서 준다**
 * (`2026-08-10~2026-12-31` 또는 마감 미정인 `2026-02-10~`). 등록일만 주는 게시판보다 좋다.
 * 상세 화면은 본문이 PDF 뷰어라 글자가 거의 없다 — 조건은 첨부에서 뽑는다(첨부 범위만 지정).
 */
const BASE = "https://www.cwip.or.kr/application";
const AB_ID = /application_view\.php\?ab_id=(\d+)/;
const YMD = /(20\d{2})-(\d{2})-(\d{2})/g;

/**
 * 지원사업이 아닌 글.
 * ★`채용` 을 통째로 버리면 안 된다(적대 리뷰 중요) — 고용보조금은 제목에 「채용」을 쓴다.
 *   실측에서 「방위산업 중소기업 신규직원 **채용 지원사업** 참여기업 모집」 등 5건이 죽었다.
 *   기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 좁게 버리고 `채용 지원`은 살린다.
 */
const DROP = /외부전문가|평가위원|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고|입찰|용역\s*(?:입찰|공고)|청렴|설문/;

export function parseCwipList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const card of parseHtml(html).querySelectorAll("div.card_wrap")) {
    const a = card.querySelector('a[href*="application_view.php"]');
    const href = a?.getAttribute("href") ?? "";
    const id = href.match(AB_ID)?.[1] ?? "";
    if (!id || seen.has(id)) continue;
    const title = (a?.getAttribute("title") ?? a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    seen.add(id);
    // 신청기간 칸 — 「시작~끝」 또는 끝이 없는 「시작~」. 날짜를 순서대로 뽑아 그대로 잇는다.
    const period = (card.querySelector("div.card_date")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...period.matchAll(YMD)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
    // 사이트가 찍어 주는 접수상태(신청중/종료). 이걸 안 보면 아래 함정에 빠진다.
    const state = (card.querySelector("div.card_state")?.text ?? "").replace(/\s+/g, " ").trim();
    const open = state.includes("신청중");
    /**
     * ★마감일이 없는데 시작일만 「2026-02-10 ~」로 넘기면 안 된다(적대 리뷰 치명2).
     * 그 모양은 등록일만 주는 게시판과 똑같아서 저장 쪽 「개시 90일 자동 마감」에 그대로 걸린다.
     * 실측: 244건을 그 규칙에 통과시키면 **열림 3 · 닫힘 241** 이 되고, 이 수집원을 연결한
     * 근거였던 공고 5건(수출 표준화·플랫폼기반 시뮬레이션·창창 멘토단·Buy R&D 기술이전·
     * 마이스터센터)이 전부 저장 즉시 마감으로 들어갔다.
     * 사이트가 「신청중」이라고 말하는데 우리가 끄는 셈이라, 그럴 땐 **날짜를 아예 비운다** —
     * 그러면 처음 본 날 기준 90일 규칙(undatedStale)만 걸려 그동안은 모집중으로 남는다.
     */
    const dateText =
      days.length >= 2 ? `${days[0]} ~ ${days[1]}`
      : days.length === 1 ? (open ? "" : `${days[0]} ~`)
      : "";
    out.push({
      title,
      detailUrl: `${BASE}/application_view.php?ab_id=${id}`,
      dateText,
      category: (card.querySelector("div.card_cate")?.text ?? "").replace(/\s+/g, " ").trim(),
      agency: "창원산업진흥원",
    });
  }
  return out;
}

export const cwipConfig: BoardConfig = {
  id: "cwip",
  label: "창원산업진흥원",
  agency: "창원산업진흥원",
  region: "경남",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}/application_list.php?page=${p}`,
    maxPages: 10,
    rowSelector: "div.card_wrap",
    fields: {
      title: { selector: 'a[href*="application_view.php"]' },
      detailUrl: { selector: 'a[href*="application_view.php"]', attr: "href" },
      date: { selector: "div.card_date" },
      category: { selector: "div.card_cate" },
    },
  },
  customParse: parseCwipList,
  // 상세는 PDF 뷰어라 읽을 글자가 거의 없다 — 조건은 첨부에서 뽑는다.
  // ★실제 태그는 `<ul class="file_list_wrap">` 다(적대 리뷰 치명1 · 상세 8건 실측).
  //   `div.file_list_wrap` 로 적었더니 0개를 잡아 **첨부가 하나도 안 들어오고**, 본문 선택자도 없어
  //   모든 창원 공고가 조건 없이 「확인 필요」로 남았다. 태그를 안 박고 클래스로만 잡는다.
  attachmentsScopeSelector: ".file_list_wrap",
  expectMinRows: 5,
};
