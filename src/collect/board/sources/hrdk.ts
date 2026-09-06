import { attachmentKindOf } from "@/lib/policy-match/types";
import { decodeHtmlEntities, parseHtml } from "../html";
import { isImageAttachment } from "./attachment-skip";
import type { BoardConfig, BoardRow, PolicyAttachmentRequest } from "../types";

/**
 * 한국산업인력공단(HRDK) 공지사항 — `https://www.hrdkorea.or.kr/3/1/1`.
 *
 * 왜 연결했나(2026-09-06 실측): 사업주 직업능력개발훈련·중소기업 인재 키움·일학습병행·
 * 학습조직화·국가인적자원개발 컨소시엄 계열 공고가 고용24(work24) 밖에서 이 판에만 먼저 뜬다.
 * 총 245건(25쪽 × 10행)·월 5~7건이라 얇지만, 거르개를 붙이면 값어치가 있다.
 * ※한계: 고용24 공고 목록과 제목을 1건씩 대조하지는 않았다 — 게시글 단위 겹침은 미확인이다.
 *
 * 함정 셋(전부 실측):
 * ① **전 페이지 euc-kr**(`charset=euc-kr`) — UTF-8 로 읽으면 제목이 통째로 깨진다.
 * ② 등록일이 **자바 `Date.toString()`** 그대로다(`Wed Sep 02 15:17:41 KST 2026`).
 *    공용 날짜 파서는 `20\d{2}[.\-/]\d{1,2}` 를 찾으므로 이 서식을 한 글자도 못 읽는다.
 * ③ 첨부가 **POST 전용**이다 — `<a href="#" onclick="goDown('<base64>')">` 라 주소가 아예 없고,
 *    `POST /cms/download/downloadFile2.hrd` body `attachSeq2=<base64>` 여야 200 + HWP 89,088바이트가 온다
 *    (세션·쿠키·Referer 불필요, GET 은 안 된다).
 *
 * 구조: 목록 `table.board tbody tr` — td 3개(번호·제목·등록일). 맨 위 고정 공지 한 줄은
 * `<font color="red">[공지]</font>` 이고 같은 글이 아래 일반 행에도 다시 나온다(`k` 로 접힌다).
 * 상세는 같은 주소에 `?k=<ID>` 만 붙는 꼴. 본문 `div.content > div.se-contents`.
 * 쪽넘김 `?pageNo=N` GET, 한 쪽 10행.
 */
const BASE = "https://www.hrdkorea.or.kr";
const BOARD = "/3/1/1";
const ROW = "table.board tbody tr";
const K = /[?&]k=(\d+)/;
/** `goDown('<base64>')` — 따옴표 안이 그대로 `attachSeq2` 값이다. */
const GO_DOWN = /goDown\(\s*['"]([A-Za-z0-9+/=_-]+)['"]\s*\)/;
const DOWNLOAD_PATH = "/cms/download/downloadFile2.hrd";

/**
 * 지원사업이 아닌 글. **버릴 것만** 지정한다 — 허용목록(KEEP)은 「~ 안내」형 지원사업을 죽인다(hsbiz·kodma).
 * 실측 1쪽 11행에서 걸리는 것: 카드뉴스(고정 공지 + 본문) · 명장 선정자 발표 ·
 * 국가자격 우수사례 입상작 발표 · 종합청렴도 평가 개인정보 알림 · 울산 아이디어 공모전.
 *
 * ★`채용` 을 통째로 버리면 안 된다 — 「2026년 채용문화 우수기업 어워즈 **참가기업 모집**」이
 *  이 판의 대표적인 기업 대상 공고다(2026-09-06 실측 1쪽). 기관이 사람을 뽑는 글만 좁게 버린다.
 */
const DROP = /카드뉴스|홍보물|청렴|개인정보\s*(?:제3자|파기|제공|처리방침)|공모전|입상작|선정자\s*발표|합격자/;
const DROP_STAFF = /(?:신규|경력|직원|공개)\s*채용|채용\s*(?:공고|안내)|인재채용/;

/** 시험이 제목 글자만으로 거르개를 잴 수 있게 내보낸다. */
export function isHrdkDropTitle(title: string): boolean {
  return DROP.test(title) || DROP_STAFF.test(title);
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};
/** `Wed Sep 02 15:17:41 KST 2026` — 요일 · 달 · 일 · 시각 · 시간대 · 해. */
const JAVA_DATE = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+\d{1,2}:\d{2}:\d{2}\s+\S+\s+(20\d{2})\b/;

/**
 * 자바 `Date.toString()` 을 `YYYY-MM-DD` 로. 못 읽으면 빈 문자열.
 * ★시간대(`KST`)는 **쓰지 않는다** — 화면에 보이는 날짜를 그대로 옮길 뿐이고, 여기서 시각을
 *  더 다루면 목록 등록일이 서버 시간대에 따라 하루씩 밀린다(다른 수집기와 같은 규칙).
 */
export function parseJavaDate(text: string): string {
  const m = (text ?? "").replace(/\s+/g, " ").match(JAVA_DATE);
  if (!m) return "";
  const month = MONTHS[m[1]];
  if (!month) return "";
  return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
}

export function parseHrdkList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll(ROW)) {
    const a = tr.querySelector("td:nth-child(2) a");
    const href = decodeHtmlEntities((a?.getAttribute("href") ?? "").trim());
    const k = href.match(K)?.[1] ?? "";
    if (!k || seen.has(k)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!title || isHrdkDropTitle(title)) continue;
    /**
     * 등록일은 **`td:nth-child(3)` 칸을 직접** 집는다.
     * ⚠️ 행 전체 글자(`tr.text`)에서 찾으면 안 된다 — 칸이 띄어쓰기 없이 이어 붙어
     *    번호 「245」 + 요일이 「245Wed」가 된다(hsbiz 실측 함정).
     */
    const ymd = parseJavaDate(tr.querySelector("td:nth-child(3)")?.text ?? "");
    seen.add(k);
    out.push({
      // ★쪽 변수(`pageNo`·`searchType`·`searchText`)는 넣지 않는다 — 주소가 곧 중복 판정 열쇠라
      //  쪽마다 다른 줄이 된다(cbtp·sjtp 와 같은 규칙).
      title,
      detailUrl: `${BASE}${BOARD}?k=${k}`,
      dateText: ymd ? `${ymd} ~` : "",
      category: "",
      agency: "한국산업인력공단",
    });
  }
  return out;
}

/**
 * 상세의 첨부를 **POST 요청으로** 만든다. 공용 수확기는 이 모양을 만들어 낼 수 없다 —
 * `href` 는 `#` 이고 진짜 값은 `onclick="goDown('<base64>')"` 안에만 있다.
 *
 * ★한 공고의 첨부들이 **같은 주소**를 쓴다(내려받기 창구가 하나고 본문만 다르다).
 *  일부러 그렇게 둔다 — 실측한 요청 그대로가 아니면 서버가 어떻게 받을지 알 수 없다.
 */
export function hrdkDetailAttachments(html: string): PolicyAttachmentRequest[] {
  const url = `${BASE}${DOWNLOAD_PATH}`;
  const out: PolicyAttachmentRequest[] = [];
  const seen = new Set<string>();
  for (const a of parseHtml(html).querySelectorAll("div.file_ a")) {
    const call = `${a.getAttribute("onclick") ?? ""} ${a.getAttribute("href") ?? ""}`;
    const seq = call.match(GO_DOWN)?.[1];
    if (!seq || seen.has(seq)) continue;
    const name = (a.text ?? "").replace(/\s+/g, " ").trim() || `첨부-${seq}`;
    // 그림은 담지 않는다 — 글자가 0인데 개수 상한을 차지해 공고문(hwp)을 밀어낸다.
    if (isImageAttachment(name)) continue;
    seen.add(seq);
    out.push({
      name,
      url,
      kind: attachmentKindOf(name, url),
      method: "POST",
      // ★값을 반드시 인코딩한다 — base64 의 `+` 를 날 것으로 보내면 서버가 **빈칸**으로 되돌려
      //  엉뚱한 열쇠가 된다(form 제출 규칙). 브라우저가 `form.submit()` 으로 보내는 모양과 같다.
      body: `attachSeq2=${encodeURIComponent(seq)}`,
    });
  }
  return out;
}

export const hrdkConfig: BoardConfig = {
  id: "hrdk",
  label: "한국산업인력공단",
  agency: "한국산업인력공단",
  region: "전국",
  baseUrl: `${BASE}/`,
  /** ★전 페이지 euc-kr(실측). 빼면 제목·본문·첨부 이름이 전부 깨진 글자로 저장된다. */
  charset: "euc-kr",
  list: {
    url: (p) => `${BASE}${BOARD}?pageNo=${p}`,
    // 총 25쪽인데 월 5~7건이라 앞 2쪽이면 최근 두 달을 덮는다(cbf·kodma 와 같은 판단).
    maxPages: 2,
    rowSelector: ROW,
    fields: {
      title: { selector: "td:nth-child(2) a" },
      detailUrl: { selector: "td:nth-child(2) a", attr: "href" },
      date: { selector: "td:nth-child(3)" },
    },
  },
  customParse: parseHrdkList,
  /**
   * ★추측 단계를 끈다. 이 판은 왼쪽 메뉴에 `/3/1/2/4` 꼴 링크가 수십 개라, 추측 단계가
   * `a[href]` 를 긁으면 메뉴가 공고로 저장된다 — 그 줄은 다음 회차에 지워지지 않는다(kodma 와 같은 갈래).
   */
  skipHeuristic: true,
  // 실측 1쪽 11행(고정 공지 1 포함)에서 거르개 뒤 5건. 0~2행이면 서식 변경이다.
  expectMinRows: 3,
  detailContentSelector: "div.content > div.se-contents",
  /**
   * 첨부는 머리표(`div.file_`) 안에만 있다 — 범위는 `attachmentsScopeSelector` 가 아니라
   * 이 손잡이 **안에서** 좁힌다. 공용 수확기를 안 쓰므로 조각을 미리 잘라 넘길 이유가 없고,
   * 자른 조각에 선택자를 다시 걸면 조각의 뿌리가 곧 `div.file_` 라 규칙이 헷갈린다.
   */
  detailAttachments: ({ html }) => hrdkDetailAttachments(html),
  // 2026-09-06 실측: 미국(Railway) 차단·서울 경유 200 — 국내 경유 전용
  requiresProxy: true,
};
