import { attachmentKindOf } from "@/lib/policy-match/types";
import { parseHtml, type HTMLElement } from "../html";
import { isImageAttachment } from "./attachment-skip";
import type { BoardConfig, BoardRow, PolicyAttachmentRequest } from "../types";

/**
 * (재)여성기업종합지원센터 Wbiz 사업공고 — `notice/bizNew.do?bbsId=BBS_0002`.
 *
 * 왜 연결했나(2026-09-06 실측): 여성기업·여성 창업보육센터(BI) 공고가 여기에만 실린다.
 * 기업 대상 비율이 0.9 로 명부에서 가장 높은 축이고, 1쪽 9행 · 마지막 쪽 20 으로 누적 약 180건이다.
 * ※한계: 기업마당 제목 대조는 못 했다(검색 통로가 HTTP 500). 형제 기관인 한국여성경제인협회
 *   (kwbiz.or.kr)와는 별개 기관이라 겹침은 저장 쪽 `dedupKey` 가 접는다.
 *
 * 함정 셋(전부 실측):
 * ① **기본 진입 주소가 `searchOp8=recruiting`** 이라 1건만 나온다 — `searchOp8=`(빈값)으로 열어야 전체다.
 * ② 상세 링크가 href 에 없다 — `onclick="fnViewDetail('1042')"` 의 nttId 로 주소를 조립한다.
 * ③ 첨부가 **세션 + CSRF POST** 다: `fnCommonDownFile(atchFileId, fileSn, …)` 가
 *    `POST /front/fms/FileDown.do` 로 `_csrf`·`atchFileId`·`fileSn` 을 보낸다. 상세를 먼저 GET 해
 *    JSESSIONID 를 받고 **그 쪽의 `#hdCsrfTk`** 를 `_csrf` 로 실으면 200 + HWP 330,240바이트가 온다.
 *    토큰은 세션에 매여 있어(쿠키가 JSESSIONID 하나뿐) 저장해 두면 다음 회차에 안 통한다 —
 *    그래서 `attachmentSession.csrf` 가 **데우기 응답에서** 뽑아 본문에 붙인다.
 *
 * 구조: 목록 `ul.business_list > li`. 제목 `span.tit`, 상태·분류 `span.type i`
 * (`i.ing` 모집중 / `i.end2` 모집마감 + `i.blue` 지원사업 / `i.green` BI입주기업 / 교육·행사 / 시설대관),
 * 신청기간 `dl.i1 > dd`(`2026.08.10 (월) 09:00 ~ 2026.08.27 (목) 18:00까지`).
 * 등록일 칸은 목록·상세 어디에도 없다 — 신청기간이 유일한 날짜다.
 * 본문이 **포스터 그림 한 장뿐**인 건이 흔해(nttId=1042 실측) 첨부 글자가 사실상 필수다.
 */
const BASE = "https://www.wbiz.or.kr";
const LIST = "/notice/bizNew.do";
const DETAIL = "/notice/bizNewDetail.do";
const BBS_ID = "BBS_0002";
const ROW = "ul.business_list > li";
const VIEW = /fnViewDetail\(\s*'(\d+)'\s*\)/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
/** `fnCommonDownFile('FILE_000000000002454','1','','1042')` — 첫 둘만 내려받기에 쓴다. */
const DOWN_FILE = /fnCommonDownFile\(\s*'([^']*)'\s*,\s*'([^']*)'/;
/** 상세 쪽의 CSRF 토큰. **값**은 `#hdCsrfTk`, **변수 이름**은 `#hdCsrfNm` 에 따로 있다. */
const CSRF_TOKEN = /id="hdCsrfTk"[^>]*\svalue="([^"]+)"/;
const CSRF_NAME = /id="hdCsrfNm"[^>]*\svalue="([^"]+)"/;
/** 이름 칸이 사라진 날의 예비값. 실측값도 `_csrf` 다. */
const CSRF_FIELD = "_csrf";

/**
 * 지원사업이 아닌 분류. 실측 분류 넷 중 **시설대관**(`searchOp6=14`, 예: nttId=890 「대관안내」 상시모집)만 버린다 —
 * 지원사업·BI입주기업·교육·행사는 전부 (예비)창업자·여성기업 대상이라 남긴다(정찰 `filterNeeded`).
 */
const DROP_CATEGORY = /시설\s*대관/;
/** 제목만 봐도 대관인 글(분류 칸이 비어 오는 날의 예비 그물). */
const DROP_TITLE = /대관\s*(?:안내|신청|공고)/;

/** 시험이 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isWbizDropRow(title: string, category: string): boolean {
  return DROP_CATEGORY.test(category) || DROP_TITLE.test(title);
}

/** 상태 딱지(모집중·모집마감)를 뺀 **분야** 딱지만. 실측 분야 딱지는 `i.blue`·`i.green` 등 색 이름이다. */
function categoryOf(li: HTMLElement): string {
  const labels = li
    .querySelectorAll("span.type i")
    .map((i) => ({ cls: (i.getAttribute("class") ?? "").trim(), text: (i.text ?? "").replace(/\s+/g, " ").trim() }))
    .filter((x) => x.text && !/^(ing|end|end2)$/.test(x.cls));
  return labels.map((x) => x.text).join(" ");
}

export function parseWbizList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const li of parseHtml(html).querySelectorAll(ROW)) {
    const a = li.querySelector("a");
    const call = `${a?.getAttribute("onclick") ?? ""} ${a?.getAttribute("href") ?? ""}`;
    const nttId = call.match(VIEW)?.[1] ?? "";
    if (!nttId || seen.has(nttId)) continue;
    const title = (li.querySelector("span.tit")?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const category = categoryOf(li);
    if (isWbizDropRow(title, category)) continue;
    seen.add(nttId);
    /**
     * 신청기간은 **`dl.i1 > dd` 칸을 직접** 집는다.
     * ⚠️ 줄 전체 글자(`li.text`)에서 찾으면 안 된다 — 제목의 「(~8. 27.)」 같은 꼬리가 섞인다.
     * ★상시모집·기간 미기재 줄은 그대로 빈 문자열이다(실측 9행 중 2행). 지어내지 않는다 —
     *  저장 쪽이 「개시일 90일」 규칙으로 처리하고, 마감은 본문·첨부에서 다시 뽑힌다.
     */
    const period = (li.querySelector("dl.i1 > dd")?.text ?? "").replace(/\s+/g, " ").trim();
    const days = [...period.matchAll(YMD)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
    const dateText = days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      // ★쪽 변수(`pageIndex`)는 넣지 않는다 — 주소가 곧 중복 판정 열쇠라 쪽마다 다른 줄이 된다.
      title,
      detailUrl: `${BASE}${DETAIL}?bbsId=${BBS_ID}&nttId=${nttId}`,
      dateText,
      category,
      agency: "여성기업종합지원센터",
    });
  }
  return out;
}

/**
 * 상세의 첨부를 **POST 요청으로** 만든다. `_csrf` 는 **여기서 넣지 않는다** —
 * 세션마다 새로 받아야 하는 값이라 `attachmentSession.csrf` 가 내려받는 순간에 붙인다.
 */
export function wbizDetailAttachments(html: string): PolicyAttachmentRequest[] {
  const url = `${BASE}/front/fms/FileDown.do`;
  const out: PolicyAttachmentRequest[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(html).querySelectorAll("div.fileAdd a")) {
    const call = `${a.getAttribute("onclick") ?? ""} ${a.getAttribute("href") ?? ""}`;
    const m = call.match(DOWN_FILE);
    if (!m) continue;
    const [, atchFileId, fileSn] = m;
    if (!atchFileId || !fileSn) continue;
    const key = `${atchFileId}#${fileSn}`;
    if (seen.has(key)) continue;
    const name = (a.text ?? "").replace(/\s+/g, " ").trim() || `첨부-${fileSn}`;
    // 그림은 담지 않는다 — nttId=1042 는 첨부 2개 중 하나가 `도보조금 지원사업_JPG.jpg` 다(실측).
    if (isImageAttachment(name)) continue;
    seen.add(key);
    out.push({
      name,
      url,
      kind: attachmentKindOf(name, url),
      method: "POST",
      body: `atchFileId=${encodeURIComponent(atchFileId)}&fileSn=${encodeURIComponent(fileSn)}`,
    });
  }
  return out;
}

/**
 * 상세 HTML 에서 CSRF 토큰과 그 변수 이름. 값이 없으면 null —
 * 부르는 쪽(`attachment-session`)이 통로 탓 오류로 던져 1시간 뒤 다시 본다.
 *
 * ★이름도 **HTML 에서 읽는다**. `/js/common.js` 1061~1062행이
 * `$("#hdCsrfNm").val()` 로 이름을, `$("#hdCsrfTk").val()` 로 값을 읽어 보낸다 —
 * 사이트가 이름을 바꾸면(`_csrf` → 다른 이름) 값만 맞아도 거부당한다.
 */
export function wbizCsrfToken(html: string): { token: string; field?: string } | null {
  const token = (html ?? "").match(CSRF_TOKEN)?.[1]?.trim();
  if (!token) return null;
  const field = (html ?? "").match(CSRF_NAME)?.[1]?.trim();
  return field ? { token, field } : { token };
}

export const wbizConfig: BoardConfig = {
  id: "wbiz",
  label: "여성기업종합지원센터",
  agency: "여성기업종합지원센터",
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // ★`searchOp8=` 를 **빈값으로 반드시** 붙인다 — 빼면 사이트가 `recruiting` 으로 되돌려 1건만 준다(실측).
    url: (p) => `${BASE}${LIST}?bbsId=${BBS_ID}&pageIndex=${p}&searchOp8=`,
    // 누적 약 180건(마지막 쪽 20)이라 앞 3쪽이면 최근 몇 달을 덮는다.
    maxPages: 3,
    rowSelector: ROW,
    fields: {
      title: { selector: "span.tit" },
      detailUrl: { selector: "a", attr: "onclick", regex: "fnViewDetail\\(\\s*'(\\d+)'\\s*\\)" },
      date: { selector: "dl.i1 > dd" },
    },
  },
  customParse: parseWbizList,
  /**
   * ★추측 단계를 끈다. 목록 링크가 전부 `href="javascript:void(0);"` 라 추측 단계가
   * `a[href]` 를 긁으면 메뉴가 공고로 저장된다(kodma 와 같은 갈래).
   */
  skipHeuristic: true,
  // 실측 1쪽 9행(시설대관 0건). 절반 아래로 떨어지면 서식 변경이다.
  expectMinRows: 4,
  detailContentSelector: "div.board_view div.con",
  detailAttachments: ({ html }) => wbizDetailAttachments(html),
  /**
   * 첨부는 상세 세션(JSESSIONID) + 그 쪽의 CSRF 토큰이 있어야 온다(2026-09-06 curl 실측):
   * 쿠키단지로 상세를 받고 `#hdCsrfTk` 를 `#hdCsrfNm`(=`_csrf`) 이름으로 POST →
   * 200 + `content-disposition: attachment` + HWP 330,240바이트(`Hangul (Korean) Word Processor File 5.x`).
   *
   * ★셋 다 실측으로 갈랐다(2026-09-06 이 맥에서 curl):
   * · 토큰 없이(세션만) → **404 + 95바이트 HTML** · 토큰만(세션 없이) → **404 + 95바이트 HTML**
   * · 토큰은 **1회용이 아니다** — 같은 세션·같은 토큰으로 `fileSn=1,2,1` 을 연속 POST 해
   *   셋 다 200(330,240 / 255,992 / 330,240바이트)이었다. 그래서 데우기는 **줄마다 한 번**이면 되고,
   *   첨부마다 다시 데우는 옵션은 두지 않는다(요청 수가 두 배가 될 뿐이다).
   */
  attachmentSession: {
    warmup: "detail",
    referer: "detail",
    csrf: { extract: wbizCsrfToken, field: CSRF_FIELD },
  },
};
