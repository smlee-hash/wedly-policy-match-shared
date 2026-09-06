import { absolutize, parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 시흥산업진흥원 공지사항.
 *
 * 왜 연결했나(2026-09-05 실측): 목록 GET `cpage` 쪽넘김, 한 쪽 20행.
 * 1쪽 앞 5행은 고정 공지(`tr.back_notice` · 번호칸 「공지」 · `td.f_notice`)라
 * 등록일이 과거다(2026.07.28~2025.09.10).
 * 목록은 등록일만 준다(`td:nth-child(4)` `YYYY.MM.DD`, 마감 칸 없음) —
 * 일반 행도 고정 공지도 「등록일 ~」 개시형. 채용공고는 별도 게시판이라 안 섞인다.
 *
 * ★고정 공지도 **실제 등록일을 그대로** 낸다(2026-09-05 판정). 예전엔 날짜를 비웠는데,
 *  그 탓에 게시판 전체의 날짜 검증을 꺼야 했고(`allowUndatedRows`) 사이트가 작성일 앞에
 *  칸을 하나 더하면 **일반 행 전부의 날짜가 빈 문자열이 돼도 행 수만으로 통과**했다
 *  (적대 리뷰 보통). 옛 등록일의 고정 공지는 저장 규칙(store.ts 의 90일 개시형 마감)이
 *  알아서 처리한다 — 평택 사고의 원인은 「[공지]」 예외 규칙이었지 등록일 자체가 아니다.
 *
 * 상세 href 는 `./noticeView.html?uid=N&…` 상대경로. 호스트는 목록과 같다.
 */
const BASE = "https://www.sida.kr";
const LIST = "/notification/notice.html";
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다.
 * 실측 제목: 「표지모델 모집」·「현장 기동반 신청서」·「지원사업 일정 사전 공고」.
 * 「[안내]」 접두 글은 고정 공지에만 있었고, 그 한 줄은 `신청서$` 로 버린다.
 * ★`채용` 을 통째로 버리면 안 된다 — 고용보조금은 제목에 「채용」을 쓴다(cwip).
 */
const DROP = /표지모델|신청서$|지원사업 일정 사전 공고/;

export function isSidaDropTitle(title: string): boolean {
  return DROP.test(title);
}

/**
 * 맨 위 고정 공지 행인가. **날짜를 비우는 데 쓰지 않는다**(위 주석 참고) —
 * 행의 성격을 알아야 하는 자리(시험·앞으로의 판정)를 위해 남겨 둔 판정기다.
 */
export function isPinnedRow(tr: HTMLElement): boolean {
  const cls = (tr.getAttribute("class") ?? "").split(/\s+/);
  if (cls.includes("back_notice")) return true;
  if (tr.querySelector("td.f_notice")) return true;
  const no = (tr.querySelector("td")?.text ?? "").replace(/\s+/g, " ").trim();
  return no === "공지";
}

export function parseSidaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.tb_st1 > tbody > tr")) {
    const a = tr.querySelector("td:nth-child(2) a");
    const href = (a?.getAttribute("href") ?? "").trim();
    if (!href || href === "#") continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || DROP.test(title)) continue;
    const uid = href.match(/[?&]uid=(\d+)/)?.[1] ?? "";
    const detailUrl = absolutize(href, `${BASE}/notification/`);
    const key = uid || detailUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    /**
     * 등록일은 **`td:nth-child(4)` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    번호칸 + 작성일이 붙는다(hsbiz 실측 함정).
     */
    const dateCell = (tr.querySelector("td:nth-child(4)")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...dateCell.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    // 고정 공지도 자기 등록일을 그대로 낸다 — 비우면 게시판 전체의 날짜 검증을 못 켠다.
    const dateText =
      days.length === 0
        ? ""
        : days.length >= 2
          ? `${days[0]} ~ ${days[1]}`
          : `${days[0]} ~`;
    out.push({
      title,
      detailUrl,
      dateText,
      category: "",
      agency: "시흥산업진흥원",
    });
  }
  return out;
}

export const sidaConfig: BoardConfig = {
  id: "sida",
  label: "시흥산업진흥원",
  agency: "시흥산업진흥원",
  region: "경기",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    url: (p) => `${BASE}${LIST}?keyfield_s=&search_word_s=&cpage=${p}&spage=1`,
    maxPages: 3,
    rowSelector: "table.tb_st1 > tbody > tr",
    fields: {
      title: { selector: "td:nth-child(2) a" },
      detailUrl: { selector: "td:nth-child(2) a", attr: "href" },
      date: { selector: "td:nth-child(4)" },
    },
  },
  customParse: parseSidaList,
  /**
   * ★`allowUndatedRows` 를 켜지 않는다(2026-09-05 판정). 고정 공지도 등록일을 그대로 내므로
   * 모든 행에 날짜가 있고, 검증을 켜 둬야 사이트가 작성일 앞에 칸을 더해 날짜가
   * `td:nth-child(5)` 로 밀렸을 때 「날짜가 있는 행이 부족」이 그 자리에서 끊어 준다.
   */
  expectMinRows: 5,
  /**
   * 첨부는 상세의 `div.dl_st1`(담당부서·문의처·첨부파일 목록 상자) 안에만 있다.
   *
   * 범위를 안 좁히면 쪽 바닥의 「Internet Explorer Update」
   * (`http://windows.microsoft.com/ko-kr/internet-explorer/download-ie`)가 수확기의
   * `/download/i` 에 걸려 **첨부로 저장**된다 — 그 주소는 허용 호스트 밖이라
   * 내려받기 단계가 「허용되지 않은 첨부 주소」로 막고, 진짜 첨부는 하나도 안 남는다
   * (2026-09-06 운영 실측: 첨부 있는 열린 공고 18건 전부 그 모양이었다).
   * 실측 4쪽(uid=1144·1142·1135·1071)에서 이 상자는 쪽마다 정확히 1개고,
   * 그 안의 `<a>` 는 첨부(`a.file_down`)뿐이다.
   */
  attachmentsScopeSelector: "div.dl_st1",
  /** 상자가 사라지면 서식 변경이다 — 실측 4쪽(uid=1144·1142·1135·1071) 전부 이 상자가 1개 있다. */
  attachmentsScopeRequired: true,
  /**
   * 첨부 내려받기는 **1회용 열쇠**가 있어야 한다(2026-09-06 curl 실측, uid=1144):
   * · 맨 GET `/config/download_home.php?filename=…` → 200 인데 내용이
   *   「Undefined variable $ar_chk … 비정상적인 접근입니다」 164바이트
   * · `/js/program.js` 846행 `autoRchk()` 대로 POST `/program_process/ar_code.php`(`ar_create=Y`)
   *   → `{"0":{"id_status":"Y","ar_chk":"6a9c40d550be1JAc"}}`, 그 값을 `&ar_chk=` 로 붙이면
   *   → 200 + `content-disposition: attachment` + HWP 904,704바이트(OLE `d0cf11e0`)
   * 쿠키는 필요 없다(위 실측은 쿠키 없이 성공). 열쇠는 한 번 쓰면 끝이라 첨부마다 새로 받는다.
   */
  attachmentToken: {
    endpoint: "/program_process/ar_code.php",
    method: "POST",
    body: "ar_create=Y",
    param: "ar_chk",
    extract: (text) => {
      try {
        const j = JSON.parse(text) as { "0"?: { ar_chk?: unknown } };
        const v = j?.["0"]?.ar_chk;
        return typeof v === "string" && v ? v : null;
      } catch {
        return null;
      }
    },
  },
};
