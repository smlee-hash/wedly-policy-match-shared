import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 경기테크노파크 지원사업 공고 — 성과관리시스템(PMS) 게시판.
 *
 * ★주소가 `www.gtp.or.kr` 이 아니다. 본 누리집 상단 「공고·안내 > 사업공고」 링크가
 *   별도 서브도메인 `pms.gtp.or.kr` 을 새 창으로 연다(조사 일꾼이 본 누리집 HTML 에서 확인).
 *   `www.gtp.or.kr/web/bbs/supportList.jsp`(「지원사업 안내」)도 있으나 그쪽은 사업기간이
 *   「2026년」처럼 연도 단위인 상시 안내 디렉터리라 접수 마감 기준 수집엔 못 쓴다.
 *
 * 구조(2026-09-03 실측):
 * · 목록 GET `?page={쪽}` — 사이트 자체 JS 는 POST 로만 넘기지만 **GET 도 그대로 먹는다**
 *   (page=2 로 GET 했더니 No 1771~1762 로 1쪽과 다른 줄이 왔다). POST 본문보다 단순하고,
 *   엔진이 `url(1)`·`url(2)` 를 견줘 쪽 변수 이름(`page`)을 스스로 알아내 상세 주소에서 떼어 낸다.
 * · 한 쪽 10줄 · 전체 약 179쪽 · charset utf-8(선언·실제 바이트 모두)
 * · 행 `table.t01 tbody tr` — 최초 HTML 응답에 그대로 들어 있다(AJAX 아님)
 * · 제목 `td.subject a` — **화면 글자는 「…「SM...」 로 잘려 있고 전문은 `title` 속성에 있다.**
 * · 상세 주소는 화면의 `No` 칸이 아니라 `onclick="fn_goView('172323')"` 의 번호다
 *   (No=1781 → b_idx=172323). GET `webBusinessView.do?b_idx=172323` 로 200/35KB 확인.
 * · 날짜 = 여섯째 칸 `td.last`(머리글 「접수 기간」) — 「시작 ~ 끝」을 **둘 다** 준다.
 *   등록일만 주는 게시판보다 마감 정리가 정확하다.
 * · 기관 = 다섯째 칸 「주최기관」 — 행마다 다르다(경기 테크노파크·중소벤처기업부·경기도·안산시…).
 *
 * ⚠️ 상세 첨부 칸 선택자는 실제 상세(b_idx=172323 등 10건)를 받아 확인했다 —
 *    `div.txtinfor.mb20` 안에 내려받기 링크 4개. 본문 선택자를 왜 비웠는지는 설정 쪽 주석 참고.
 */
const BASE = "https://pms.gtp.or.kr";
const LIST = "/web/business/webBusinessList.do";
const VIEW = "/web/business/webBusinessView.do";
const B_IDX = /fn_goView\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 공고가 아닌 글. **버릴 것만** 좁게 지정한다.
 *
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(부천 bizbc 에서
 *   「채용 지원사업」 5건이 죽었다). 기관이 사람을 뽑는 글(`직원 채용`·`채용 공고`)만 버린다.
 *
 * 실측(2026-09-03, 1~20쪽에서 뽑은 제목 140종): 이 게시판은 거의 전부가 기업 대상 지원사업이라
 * 아래 낱말에 걸리는 줄이 **한 줄도 없었다.** 그래도 남겨 두는 까닭은 게시판이 나중에 입찰·평가위원
 * 공고를 함께 올리기 시작해도 조용히 섞여 들어오지 않게 하기 위해서다.
 *
 * 「강사 모집」·「DX멘토단(평가단·코칭단) 모집」 두 줄은 **일부러 안 버린다** — 이 저장소의 방침은
 * 「수집은 최대한 넓게, 걸러내기는 회사별 매칭에서」(2026-09-03 사장님 「누락 0」)이고,
 * 멘토단·코칭단은 컨설팅 회사가 실제로 신청하는 자리라 낱말로 버리면 진짜 기회가 함께 죽는다.
 */
const DROP =
  /입찰\s*공고|낙찰|우선협상대상자|설문\s*조사|평가위원|심사위원|외부전문가|전문가\s*풀|합격자|(?:신규|경력|직원)\s*채용|채용\s*공고/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isGtpDropTitle(title: string): boolean {
  return DROP.test(title);
}

export function parseGtpList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.t01 tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 6) continue; // 머리글·「자료가 없습니다」 줄
    const a = tr.querySelector("td.subject a");
    const bIdx = (a?.getAttribute("onclick") ?? "").match(B_IDX)?.[1] ?? "";
    if (!bIdx || seen.has(bIdx)) continue;
    // 화면 글자는 잘려 있다(「…「SM...」). 전문은 title 속성 — 잘린 제목을 저장하면
    // 중복 판정 열쇠(제목+기관)가 갈려 기업마당의 같은 공고와 안 묶인다.
    const title = (a?.getAttribute("title") || a?.text || "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;

    /**
     * 접수기간 칸 — 「2026-09-01 09:00 <br>~ 2026-09-21 17:00」.
     * ⚠️ 반드시 **칸(td.last) 단위**로 읽는다. 행 전체 글자(`tr.text`)에서 정규식으로 찾으면
     *    앞의 No 칸(1781)과 띄어쓰기 없이 붙어 「17812026-09-01」 이 되어 날짜를 못 읽는다(화성 실측 함정).
     */
    const period = (tr.querySelector("td.last")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...period.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );

    /**
     * ★접수가 끝난 줄은 날짜 대신 「마감」 한 낱말만 온다 — **그 줄은 아예 안 담는다.**
     *
     * 실측(2026-09-03): 1~20쪽 151줄 중 **112줄이 「마감」**이고, 4~40쪽은 한 줄도 남지 않는다.
     * 날짜를 비운 채 저장하면 저장 쪽 `undatedStale` 규칙이 「처음 본 날부터 90일」을 세기 때문에
     * **이미 끝난 공고 112건이 석 달 동안 「모집중」으로 되살아난다.**
     * 게다가 검증 관문은 「날짜 있는 행이 30% 이상」을 요구해서, 빈 날짜 줄을 담으면 합산 검증이
     * 통째로 미끄러져 이 게시판의 살아 있는 공고까지 한 건도 안 들어온다.
     * 열려 있던 줄이 나중에 「마감」으로 바뀌면 여기서 빠지고, 목록에서 사라진 공고는
     * 저장 쪽 `markStaleClosed` 가 닫는다.
     */
    if (days.length < 2) continue;

    seen.add(bIdx);
    out.push({
      title,
      // 쪽 번호를 붙이지 않는다 — sourceId 가 곧 상세 주소라, 쪽이 섞이면 같은 글이 쪽마다 다른 줄이 된다.
      detailUrl: `${BASE}${VIEW}?b_idx=${bIdx}`,
      dateText: `${days[0]} ~ ${days[1]}`,
      category: (tds[2]?.text ?? "").replace(/\s+/g, " ").trim(),
      /**
       * 주최기관 칸. 기관을 「경기테크노파크」로 못 박으면 중복 판정 열쇠(제목+기관)가 달라져,
       * 기업마당에 원 기관명(중소벤처기업부·경기도·안산시…)으로 든 같은 공고와 안 묶여
       * 목록에 두 줄로 뜬다(부천 bizbc 에서 겪은 그 갈래).
       * 비어 있으면 넘기지 않고 엔진이 설정의 `agency` 로 채우게 둔다.
       */
      agency: (tds[4]?.text ?? "").replace(/\s+/g, " ").trim() || undefined,
    });
  }
  return out;
}

export const gtpConfig: BoardConfig = {
  id: "gtp",
  label: "경기테크노파크",
  agency: "경기테크노파크",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?page=${p}`,
    // 실측 1·2쪽은 10줄 모두 접수중, 3쪽 9줄, **4쪽부터 40쪽까지 접수중인 줄이 한 줄도 없다**
    // (37쪽을 전부 받아 세어 확인). 접수중인 공고는 앞쪽에만 모이므로 엔진이 빈 쪽 둘에서 멈춰도
    // 잃는 공고가 없다 — 실제 왕복은 다섯 번쯤이고, 10 은 공고가 몰릴 때의 여유다.
    maxPages: 10,
    rowSelector: "table.t01 tbody tr",
    fields: {
      title: { selector: "td.subject a", attr: "title" },
      detailUrl: { selector: "td.subject a", attr: "onclick", regex: "fn_goView\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "td.last" },
    },
  },
  customParse: parseGtpList,
  /**
   * ★`detailContentSelector` 를 **일부러 안 적는다**(창조경제혁신센터 ccei 와 같은 까닭).
   *
   * 상세 본문 칸은 `div.txtcontent` 인데, 실측 10건을 재 보니 글자 수가 0·4·115·198·200·221·354·995 로
   * 대부분 표지문 길이고 **10건 중 2건은 글자가 「신청하기」 넉 자뿐**이다(공고문을 그림으로 붙인 화면).
   * 그 넉 자를 `targetText` 에 저장하면 뒷단계의 「첨부에서 본문 뽑기」가 `targetText === ""` 인 줄만
   * 처리하기 때문에 그 공고는 **첨부 공고문의 진짜 자격조건을 영영 못 읽는다.**
   * 선택자를 비우면 `targetText` 가 빈 채로 남고 첨부만 수확돼, 다음 단계가 공고문(pdf·hwp·hwpx)에서
   * 본문을 뽑아 채운다 — 실측 10건 모두 첨부가 있었고 9건은 뽑을 수 있는 형식이었다.
   */
  // 첨부 칸만. 상세에는 이 밖에도 배너·바닥글 링크가 있어 범위를 좁힌다(인천 비즈OK 오염 사례).
  // 실측: 이 선택자 안에 내려받기 링크 4개(공고문 pdf·서식 hwp·hwpx)가 정확히 들어온다.
  attachmentsScopeSelector: "div.txtinfor.mb20",
  /**
   * ★추측(heuristic) 단계를 끈다. 이 게시판은 끝난 공고가 날짜 대신 「마감」으로만 오는데,
   * 추측 단계는 그 사정을 모르고 **날짜 없는 줄까지 그대로 담는다** — 실측 151줄 중 112줄이
   * 날짜 없이 저장돼 석 달간 「모집중」이 된다. 구조가 바뀌면 조용히 틀린 자료를 쌓는 것보다
   * 실패로 알리는 편이 낫다.
   */
  skipHeuristic: true,
  /**
   * 1쪽에서 이만큼도 안 나오면 서식이 바뀐 것으로 본다.
   * 한 쪽 10줄이지만 「마감」 줄을 버리므로 남는 수가 들쭉날쭉하다 — 절반(5)으로 두면
   * 마감이 몰린 달에 헛경보가 나고 그 회차 수집이 통째로 실패한다(그게 곧 누락이다).
   * 3 이면 구조가 깨진 경우(0~2줄)는 여전히 잡는다.
   */
  expectMinRows: 3,
};
