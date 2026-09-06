import { prisma } from "@/lib/prisma";
import { buildRuleStructure } from "@/lib/policy-match/rule-structure";
import { classifyWedlyCategory } from "@/lib/policy-match/wedly-category";
import { attachmentKindOf, dedupKeyOf, parseApplyPeriod, type PolicyAttachment } from "@/lib/policy-match/types";
import { asPolicyAttachments } from "@/lib/policy-match/attachment-text";
import { fundingFieldsOf } from "@/lib/services/policy-match/store";
import type { Prisma } from "@prisma/client";
import { fetchBoardDetail } from "./engine";
import { encodeAttachmentHref } from "./attachment-url";
import { absolutize, decodeHtmlEntities, normalizeDateText, parseHtml } from "./html";
import { BOARD_SOURCES, fetchBoardText, DETAIL_FETCH_TIMEOUT_MS, DETAIL_FETCH_BODY_MAX_BYTES } from "./registry";
import { isTruncatedTitle, upgradeTruncatedTitle } from "./title-upgrade";
import type { BoardConfig, BoardFetchInit, PolicyAttachmentRequest } from "./types";

const FILE_HREF = /\.(pdf|hwp|hwpx|zip)(?:$|[?#])/i;
const EMBEDDED_FILE = /["']([^"']+\.(?:pdf|hwp|hwpx|zip)(?:\?[^"']*)?)["']/gi;
// eGov 표준 게시판(경북TP 등)의 첨부 — 내려받기 함수가 onclick 에 있는 곳도, href 에 있는 곳도
// 있다(경기도경제과학진흥원은 `href="javascript:fn_egov_downFile(…)"` — 2026-09-03 실측 첨부 0건).
const EGOV_DOWN = /fn_egov_downFile\(\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*\)/;
// 서울TP(intcms) 첨부 — onclick("경로",'번호') → 경로?attachNo=번호 (script-validation.js 정의, 실검증 200).
const STP_DOWN = /attachfileDownload\(\s*['"]([^'"]+)['"]\s*,\s*['"](\d+)['"]\s*\)/;
/**
 * 서울신용보증재단 — `href="javascript:common.download(<글번호>,'<일련번호>')"`.
 * 실주소는 `/download/{bno}/{serial}.do?mng_cd={게시판코드}` (`/js/common/common.js` 339행).
 * ★게시판 코드가 없으면 **HTTP 400**, 틀리면 안내 화면으로 넘어간다(2026-09-03 실측).
 *   코드는 쪽 머리글의 `var mng_cd = "STRY9788"` 에만 있어 **쪽 전체 HTML**에서 찾는다.
 */
const SSB_DOWN = /common\.download\(\s*['"]?(\d+)['"]?\s*,\s*['"]([\w-]+)['"]\s*\)/;
const SSB_MNG_CD = /\bmng_cd\s*=\s*['"]([A-Za-z0-9_-]+)['"]/;
/**
 * 인천테크노파크 — `javascript:fncFileDownload('bbs','<저장이름>')`
 * → `/common/COM_FILEDOWN.ASP?a=bbs&b=<저장이름>` (`/script/tools_window.js` 244행 · 실호출 200).
 * 함수 이름에 「Download」가 들어 있어 옛 코드는 이 `javascript:` 글자를 통째로 주소로 저장했다.
 */
const ITP_DOWN = /fncFileDownload\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/;
/**
 * 한국산업기술기획평가원 — `onclick="f_bsnsAncmFileDownload('<열쇠1>','<열쇠2>')"`
 * → `/fileDownLoad.do?atchFileId=..&orgEdmsId=..&fileCrtSe=NA1001&menuId=02000000`
 * (`/js/common/keit_common.js` 2022행의 `cf_fileDownload`). ★`menuId` 를 빼면 404 다(실측).
 */
const KEIT_DOWN = /f_bsnsAncmFileDownload\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/;
const KEIT_MENU_ID = "02000000";
/**
 * 한국에너지공단 신·재생에너지센터 — `href="javascript:file_down('<글번호>','<일련번호>','notice')"`
 * → `/biz/file/File_down.do?no=..&gubun=..&kinds=..`(상세 쪽 스크립트 정의 그대로).
 * 2026-09-06 실측: GET 200 + `Content-disposition: attachment` + HWP 123,904바이트(쿠키 없이).
 *
 * ★함수 이름(`file_down`)이 너무 흔해서 **이 사이트에서만** 푼다. 다른 게시판에도 같은 이름의
 *  함수가 있는데 인자 뜻이 다르면 엉뚱한 주소가 첨부로 저장되고, 그 줄은 다음 회차에도
 *  안 지워진다(수출입은행 실측과 같은 갈래). 호스트를 못 박는 것이 가장 싼 울타리다.
 */
const KNREC_DOWN = /file_down\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/;
const KNREC_HOST = "www.knrec.or.kr";
/**
 * IRIS 범부처통합연구지원시스템 —
 * `href="javascript:f_bsnsAncm_downloadAtchFile('<atchDocId>','<atchFileId>','<파일명>','<바이트>')"`
 * → `/comm/file/fileDownload.do?atchDocId=..&atchFileId=..`
 * (상세 HTML 인라인 `f_bsnsAncm_downloadAtchFile` 안 `downloadUrl` · 2026-09-06 curl 실측
 *  200 + `content-disposition: attachment` + hwpx 134,364바이트, 쿠키·로그인 불필요).
 * ★두 열쇠는 Base64 라 `+`·`/`·`=` 가 들어 있다 — 반드시 인코딩해야 서버가 같은 값으로 받는다.
 * 이 규칙이 없으면 `javascript:` 의사링크라 수확기가 통째로 건너뛰어 첨부가 0건이 된다.
 * ★세 번째 인자(파일 이름)까지 받아 둔다 — 그 이름이 아래 `EMBEDDED_FILE` 갈래에 **한 번 더**
 *  걸려 유령 첨부를 만드는 것을 막는 데 쓴다(적대 리뷰 낮음). 이름에 따옴표가 섞여 셋째 조각을
 *  못 읽어도 앞 두 열쇠는 그대로 잡히도록 **선택 그룹**으로 둔다.
 */
const IRIS_DOWN = /f_bsnsAncm_downloadAtchFile\(\s*'([^']+)'\s*,\s*'([^']+)'\s*(?:,\s*'([^']*)')?/;
/** 위 규칙이 이미 집은 파일 이름을 `EMBEDDED_FILE` 후보에서 빼기 위한 호스트 한정. */
const IRIS_HOST = "www.iris.go.kr";
/**
 * 산업통상자원부 — `href="javascript:location.href='/attach/down/…'"`.
 * 안쪽 주소만 풀어 쓴다. **아무 `location.href` 나 받지 않는다** — 목록·다음글 이동 링크까지
 * 첨부로 저장되기 때문이다. 내려받기처럼 생긴 경로일 때만 인정한다.
 * ⚠️ 이 주소는 지금 302 → `/error/500` 이라 실제로는 못 받는다(2026-09-03 실측). 주소는 남기고,
 *    실패는 내려받기 단계(`fetchAttachmentTexts`)가 「못 읽은 첨부」로 기록한다.
 */
const JS_LOCATION = /location\.href\s*=\s*['"]([^'"]+)['"]/;
const DOWNLOADISH_PATH = /\/attach\/|\/down(?:load)?[\/?]|download|filedown/i;
/**
 * 시흥산업진흥원 등 — `href="#void" onclick="autoRchk('/config/download_home.php?…')"`.
 *
 * ★따옴표 종류별로 「이스케이프 아닌 같은 따옴표까지」 잡는다 — `[^'"]+` 로 두면
 *  `autoRchk("…filename=O\"Brien.hwp")` 에서 `\"` 를 문자열 끝으로 오인해
 *  `…filename=O\` 까지만 주소로 저장한다(2026-09-06 독립 리뷰 8번).
 * 진짜 주소는 onclick 안에만 있고 href 는 `#void` 라, 옛 코드는 이 링크를 아예 못 봤다.
 * 그러고는 같은 쪽 바닥의 「Internet Explorer Update」
 * (`http://windows.microsoft.com/ko-kr/internet-explorer/download-ie`)가 `/download/i` 에 걸려
 * **그 남의 링크만 첨부로 저장**됐다(2026-09-06 실측 — 그래서 열린 공고 18건이 전부
 * 「허용되지 않은 첨부 주소」였다). 범위 제한(`attachmentsScopeSelector`)과 함께 막는다.
 *
 * ★`location.href` 갈래와 같은 울타리를 친다 — 같은 사이트 안의 내려받기꼴 경로만 받는다.
 *  함수 이름 하나만 믿고 아무 글자나 주소로 저장하면 남의 링크가 화면에 남는다.
 */
const AUTO_RCHK = /autoRchk\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/;
/** JS 문자열 이스케이프를 푼다(`\"`→`"`, `\'`→`'`, `\\`→`\`). */
const JS_UNESCAPE = /\\(.)/g;
/**
 * 확장자도 `download` 글자도 없는 첨부 주소. NIPA `/comm/getFile?…&fileTy=ATTACH` 가 이 갈래다
 * (2026-09-03 실측: 공용 수확기가 한 건도 못 집었다 · 실호출 200 / 9.6MB hwp).
 */
const EXTLESS_ATTACH_HREF = /[?&]fileTy=ATTACH(?:&|$)/i;
/**
 * 「이름.pdf(304.2KB)내려받기」 꼬리를 지워야 형식 판정이 pdf/hwp 로 잡힌다(적대 리뷰).
 * 실측 서식 넷을 모두 받는다 — 소괄호 `(304.2KB)` · 대괄호 `[47.9 KB]`·`[112128 byte]`(산업부·
 * 경기도경제과학진흥원) · 이름표가 붙은 `(파일크기: 9 MB )`(NIPA) ·
 * **`B` 를 뺀 `(88.9K)`**(의정부시 기업지원센터, 2026-09-06 실측 — 이게 안 지워져서 이름이
 * 「… .pdf (88.9K)」로 남고 형식이 `pdf` 가 아니라 `etc` 로 잡혔다).
 *
 * ★**이름 끝에서만** 지운다(2026-09-06 적대 리뷰). 앵커가 없으면 이름 한가운데 든 괄호
 *  (「… 4K 영상 제작(4K) 지원사업.hwp」)까지 지워져 **파일 이름이 달라진다.**
 *  꼬리 낱말(내려받기·다운로드)을 먼저 떼야 그 앞의 크기 표기가 끝에 온다 — 아래 `push` 의 순서.
 */
const SIZE_TAIL = /\s*[([]\s*(?:파일\s*크기\s*[::]\s*)?\d+(?:[.,]\d+)?\s*(?:[KMG]?B|[KMG]|bytes?)\s*[)\]]\s*$/i;
const ACTION_TAIL = /(내려받기|다운로드|바로보기)\s*$/;

function pathTail(url: string): string {
  try {
    const p = new URL(url).pathname;
    const last = p.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || url;
  } catch {
    return url.split("?")[0]?.split("/").pop() || url;
  }
}

/**
 * 상세 HTML 에서 첨부 링크를 수확한다. 절대화·중복 제거.
 *
 * @param html 첨부를 찾을 HTML. `attachmentsScopeSelector` 로 좁힌 조각일 수 있다.
 * @param baseUrl 상대주소를 풀 기준 주소(수집기 `baseUrl`).
 * @param pageHtml **쪽 전체** HTML. 범위를 좁히면 머리글에만 있는 값(서울신용보증재단의
 *   게시판 코드 `var mng_cd`)이 사라져 첨부 주소를 조립하지 못한다 — 그 값만 여기서 읽는다.
 *   안 넘기면 `html` 을 그대로 쓴다(옛 호출부 호환).
 * @param charset 게시판 글자 인코딩. `euc-kr` 이면 주소 안의 날 한글을 **euc-kr 바이트로**
 *   퍼센트 인코딩한다 — 표준(`new URL`)이 쓰는 UTF-8 로는 파일을 못 받는 서버가 있다
 *   (`attachment-url.ts` 의 충북TP 실측). 안 넘기면 예전 그대로(UTF-8).
 */
export function harvestBoardAttachments(
  html: string,
  baseUrl: string,
  pageHtml: string = html,
  charset?: BoardConfig["charset"],
  pageUrl?: string,
): PolicyAttachment[] {
  const root = parseHtml(html);
  const out: PolicyAttachment[] = [];
  const seen = new Set<string>();
  /**
   * 스크립트가 넘겨준 상대경로는 **상세 문서 주소** 기준으로 푼다(2026-09-06 독립 리뷰 7번).
   * `/notification/noticeView.html` 에서 `autoRchk("downloads/a.hwp")` 는 브라우저가
   * `/notification/downloads/a.hwp` 로 여는데, 게시판 루트(`baseUrl`)로 풀면 `/downloads/a.hwp` 가 돼 404 다.
   * 상세 주소가 없으면(옛 호출부·시험) 예전대로 `baseUrl`.
   */
  const docBase = pageUrl && /^https?:\/\//i.test(pageUrl) ? pageUrl : baseUrl;
  // ── P2 w5 ── 파일 끝 상수 블록 참조. 세 번째 인자(정적 경로)를 첨부로 잡으면 안 되는 호스트.
  const skipEmbedded = p2w5SkipsEmbeddedFiles(baseUrl);
  const push = (name: string, href: string, base: string = baseUrl) => {
    // ★인코딩은 **절대화 전에** 한다 — `new URL()` 에 날 한글을 넣으면 그 자리에서 UTF-8 로
    //  굳어 버려 되돌릴 수 없다(euc-kr 인지 utf-8 인지 되짚어 맞히는 길밖에 안 남는다).
    const url = absolutize(encodeAttachmentHref(decodeHtmlEntities(href), charset), base);
    if (!url || seen.has(url)) return;
    seen.add(url);
    // ★꼬리 낱말 → 크기 표기 순서다(SIZE_TAIL 이 끝에서만 지우므로 앞 낱말을 먼저 떼야 한다).
    const n = name.replace(/\s+/g, " ").replace(ACTION_TAIL, "").replace(SIZE_TAIL, "").trim() || pathTail(url);
    out.push({ name: n, url, kind: attachmentKindOf(n, url) });
  };
  // 게시판 코드는 쪽마다 하나다 — 링크마다 다시 찾지 않는다.
  //   인라인 `var mng_cd` 가 없으면 상세 주소의 ?mng_cd= 로 대신한다(코덱스 지적 2026-09-03 — 스크립트가 바깥 파일로 옮겨도 첨부를 잃지 않게).
  /**
   * IRIS 첨부 함수가 인자로 들고 있는 **파일 이름**. 아래 `EMBEDDED_FILE` 갈래가 같은 글자를
   * 주소로 착각해 유령 첨부를 만드는 것을 막는다 — 이름에 `/` 가 들어가면
   * (「UI/UX 설계 지침.hwpx」) 그 갈래의 「경로 구분자가 있어야 주소」 조건을 통과해
   * `https://www.iris.go.kr/UI/UX 설계 지침.hwpx` 라는 없는 주소가 첨부로 저장된다.
   */
  const irisFileNames = new Set<string>();
  const isIrisHost = (() => {
    try {
      return new URL(baseUrl).host === IRIS_HOST;
    } catch {
      return false;
    }
  })();
  const ssbMngCd = SSB_DOWN.test(html)
    ? (pageHtml.match(SSB_MNG_CD)?.[1] ?? mngCdFromUrl(baseUrl))
    : "";
  // `file_down(…)` 갈래는 이 호스트에서만 푼다(위 KNREC_DOWN 주석) — 링크마다 다시 재지 않는다.
  const knrecHost = hostOf(baseUrl) === KNREC_HOST;
  for (const a of root.querySelectorAll("a")) {
    const onclick = a.getAttribute("onclick") ?? "";
    const href = a.getAttribute("href") ?? "";
    // 링크 글자가 그림뿐인 곳(인천TP)은 title 속성이 진짜 파일 이름을 들고 있다.
    const label = a.text.trim() || (a.getAttribute("title") ?? "");
    // 내려받기 함수는 게시판마다 onclick 에도, href="javascript:…" 에도 있다 — 둘 다 본다.
    const call = `${onclick} ${href}`;
    const eg = call.match(EGOV_DOWN);
    if (eg) {
      push(label, `/cmm/fms/FileDown.do?atchFileId=${encodeURIComponent(eg[1])}&fileSn=${eg[2]}`);
      continue;
    }
    const stp = call.match(STP_DOWN);
    if (stp) {
      push(label, `${stp[1]}?attachNo=${stp[2]}`);
      continue;
    }
    const ssb = call.match(SSB_DOWN);
    if (ssb) {
      // 게시판 코드를 못 읽으면 만들어 봐야 400 이다 — 헛주소를 저장하지 않는다.
      if (ssbMngCd) push(label, `/download/${ssb[1]}/${ssb[2]}.do?mng_cd=${encodeURIComponent(ssbMngCd)}`);
      continue;
    }
    const itp = call.match(ITP_DOWN);
    if (itp) {
      push(label, `/common/COM_FILEDOWN.ASP?a=${encodeURIComponent(itp[1])}&b=${encodeURIComponent(itp[2])}`);
      continue;
    }
    const keit = call.match(KEIT_DOWN);
    if (keit) {
      push(
        label,
        `/fileDownLoad.do?atchFileId=${encodeURIComponent(keit[1])}&orgEdmsId=${encodeURIComponent(keit[2])}` +
          `&fileCrtSe=NA1001&menuId=${KEIT_MENU_ID}`,
      );
      continue;
    }
    if (knrecHost) {
      const kn = call.match(KNREC_DOWN);
      if (kn) {
        push(label, `/biz/file/File_down.do?no=${kn[1]}&gubun=${kn[2]}&kinds=${encodeURIComponent(kn[3])}`);
        continue;
      }
    }
    const iris = call.match(IRIS_DOWN);
    if (iris) {
      push(
        label,
        `/comm/file/fileDownload.do?atchDocId=${encodeURIComponent(iris[1])}` +
          `&atchFileId=${encodeURIComponent(iris[2])}`,
      );
      if (iris[3]) irisFileNames.add(iris[3]);
      continue;
    }
    // ── P2 w5 ── 첨부 주소가 JS 함수 인자 안에만 있는 게시판 3곳(파일 끝 상수 블록 · 호스트 한정).
    const w5 = p2w5AttachmentHref(call, baseUrl);
    if (w5) {
      push(label.replace(P2W5_COUNT_TAIL, "").trim(), w5);
      continue;
    }
    const rchk = call.match(AUTO_RCHK);
    if (rchk) {
      const path = (rchk[1] ?? rchk[2] ?? "").replace(JS_UNESCAPE, "$1");
      if (DOWNLOADISH_PATH.test(path) && sameSite(path, docBase)) push(label, path, docBase);
      continue;
    }
    const loc = href.match(JS_LOCATION);
    if (loc) {
      // 같은 사이트 안의 내려받기꼴 경로만 — 바깥 주소를 첨부로 저장하면 화면에 남의 링크가 뜬다(코덱스 지적 2026-09-03).
      if (DOWNLOADISH_PATH.test(loc[1]) && sameSite(loc[1], baseUrl)) push(label, loc[1]);
      continue;
    }
    // 메인비즈 — 주소에 확장자가 없고 이름이 `?filename=` 안에 있다(파일 끝 상수 블록 참고).
    const mainbizName = mainbizAttachmentName(href, baseUrl);
    if (mainbizName) {
      push(mainbizName, href);
      continue;
    }
    if (!FILE_HREF.test(href) && !/download/i.test(href) && !EXTLESS_ATTACH_HREF.test(href)) continue;
    // `javascript:` 로 시작하는 의사링크는 주소가 아니다 — 함수 이름에 「Download」가 들어 있으면
    // 옛 코드가 그 글자를 통째로 저장했다(인천TP 실측).
    if (/^\s*javascript:/i.test(href)) continue;
    push(label, href);
  }
  for (const m of html.matchAll(EMBEDDED_FILE)) {
    if (skipEmbedded) continue; // ── P2 w5 ── 위 `skipEmbedded` 주석 참조.
    // 경로 구분자가 없으면 주소가 아니라 스크립트 안 「파일명」이다 — 가짜 URL 저장 방지(적대 리뷰, gepa).
    // ⚠️이 갈래는 상대경로를 아직 **게시판 뿌리**(`baseUrl`) 기준으로 푼다 — `autoRchk` 처럼 상세 문서
    //  기준으로 바꾸면 30여 게시판의 저장된 주소가 한꺼번에 달라져, 실물 확인 없이는 손대지 않는다.
    //  같은 파일이 두 갈래에 다 걸리면 줄이 둘로 늘 수 있다(2026-09-06 독립 리뷰 7번 범위 밖).
    if (!m[1].includes("/")) continue;
    // IRIS 첨부 함수가 이미 집은 파일 이름은 주소가 아니다(위 irisFileNames 주석).
    if (isIrisHost && irisFileNames.has(m[1])) continue;
    push("", m[1]);
  }
  // 공고문·모집요강을 앞으로 — 첨부에서 본문을 뽑는 단계는 앞 파일부터 읽으므로, 접수 매뉴얼·서식이 먼저 오면
  // 자격조건이 든 공고문을 못 읽는다(KEIT 실측: 공고문이 9번째, 코덱스 지적 2026-09-03). 같은 등급 안에서는 원래 순서.
  const rank = (a: PolicyAttachment) => (ANNOUNCEMENT_DOC.test(a.name) ? 0 : 1);
  return out.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a);
}

/**
 * 상세 쪽에서 온전한 제목을 집어 목록의 잘린 제목을 승격한다. 승격 못 하면 목록 제목 그대로.
 *
 * ★실패는 전부 「목록 제목 그대로」로 떨어진다 — 설정 없음·선택자 0건·접두어 관계 아님.
 *  상세 선택자가 틀린 날 엉뚱한 글자로 제목을 덮으면 잘린 제목보다 훨씬 나쁘기 때문이다
 *  (판정은 `upgradeTruncatedTitle` 한 곳에서만).
 */
function upgradedTitleOf(cfg: BoardConfig, pageHtml: string, listTitle: string): string {
  if (!cfg.detailTitle) return listTitle;
  try {
    // ★`.text` 가 이미 실체 참조를 풀어 준다 — 목록 파서와 **같이 한 번만** 푼다.
    //  여기서 또 풀면 「&amp;lt;」 처럼 원래 글자에 있던 표기가 태그로 둔갑한다(독립 검사 지적).
    const raw = parseHtml(pageHtml).querySelector(cfg.detailTitle.selector)?.text ?? "";
    const stripped = cfg.detailTitle.strip ? raw.replace(cfg.detailTitle.strip, "") : raw;
    return upgradeTruncatedTitle(listTitle, stripped) ?? listTitle;
  } catch {
    // 선택자가 깨져도 상세 채움 자체는 계속돼야 한다 — 본문·첨부는 이미 손에 있다.
    return listTitle;
  }
}

/**
 * 제목이 올라갔을 때 함께 고쳐야 하는 칸들.
 *
 * ★`dedupKey` 를 같이 안 고치면 기업마당의 같은 공고와 영영 안 묶인다.
 * ★제목이 **아직 잘려 있으면** 줄마다 유일한 임시 열쇠를 준다 — 앞 20자가 같은 서로 다른
 *  공고들이 한 열쇠로 뭉쳐 결과 목록에서 한 줄로 접히는 것을 막는다(title-upgrade 주석).
 *  임시 열쇠는 `sourceId` 가 있을 때만 만들 수 있다. 없으면 열쇠를 아예 안 건드린다 —
 *  저장 단계(store)가 이미 같은 규칙으로 넣어 뒀다.
 */
function titleFieldsOf(
  cfg: BoardConfig,
  row: BoardDetailFillRow,
  title: string,
): Prisma.PolicyAnnouncementUncheckedUpdateInput {
  // 소관기관은 행에 없으면 출처 기본값 — 빈 문자열로 열쇠를 만들면 기관이 빠진 열쇠가 된다.
  const agency = row.agency ?? cfg.agency;
  const data: Prisma.PolicyAnnouncementUncheckedUpdateInput = {
    title,
    wedlyCategory: classifyWedlyCategory(title, row.summary ?? ""),
  };
  const stillCut = !!cfg.detailTitle && isTruncatedTitle(title);
  if (stillCut) {
    if (row.sourceId) data.dedupKey = `${dedupKeyOf({ title, agency })}#${row.sourceId}`;
  } else {
    data.dedupKey = dedupKeyOf({ title, agency });
  }
  /**
   * ★온전한 제목을 처음 보는 자리에서 한 번 더 거른다(독립 검사 지적 8).
   * 목록 제목이 잘려 오면 목록 거르개가 뒷글자(「… 선정 결과 발표」)를 못 봐 그냥 통과한다.
   * 지우지 않고 닫는다 — 지운 줄은 다음 회차에 그대로 다시 들어온다.
   */
  if (cfg.detailTitle?.drop?.test(title)) {
    data.status = "closed";
    console.log("[policy-board] 승격된 제목이 거르개에 걸려 닫음", cfg.id, title);
  }
  return data;
}

/**
 * 상세에만 있는 **접수기간 칸**을 읽는다(`BoardConfig.detailApplyPeriod`).
 * 설정이 없거나 시작·끝을 둘 다 못 읽으면 `null` — 그러면 목록에서 온 날짜를 그대로 둔다.
 *
 * ★`strip` 을 적은 출처는 **그 정규식에 걸리는 조각만** 본다. 메인비즈는 같은 상자에
 *  「작성일 : 2026.09.04」·「조회 : 23」·「진행상태 : 진행중」이 나란히 있어서, 울타리가 없으면
 *  이웃 칸을 기간으로 오독할 길이 열린다.
 */
export function detailApplyPeriodOf(
  cfg: BoardConfig,
  pageHtml: string,
): { text: string; start: Date; end: Date } | null {
  const rule = cfg.detailApplyPeriod;
  if (!rule) return null;
  try {
    for (const el of parseHtml(pageHtml).querySelectorAll(rule.selector)) {
      const raw = el.text.replace(/\s+/g, " ").trim();
      if (!raw) continue;
      if (rule.strip && !rule.strip.test(raw)) continue;
      const text = normalizeDateText((rule.strip ? raw.replace(rule.strip, "") : raw).trim());
      const { start, end } = parseApplyPeriod(text);
      // 시작·끝이 **둘 다** 나올 때만 쓴다 — 반쪽짜리로 목록 값을 덮으면 더 나빠진다.
      if (start && end) return { text, start, end };
    }
  } catch {
    // 선택자가 깨져도 상세 채움 자체는 계속돼야 한다 — 본문·첨부는 이미 손에 있다.
    return null;
  }
  return null;
}

/**
 * 상세에서 읽은 접수기간으로 고칠 칸들.
 * `status` 판정 기준은 저장 단계(`store.ts` 의 `closed`)와 **같다** — 마감이 지났으면 닫는다.
 * (그 판정은 upsert 안에 인라인으로 있어 export 가 없다. 기준이 갈리지 않게 한 줄로 맞춘다.)
 */
function periodFieldsOf(
  period: { text: string; start: Date; end: Date },
  now: Date,
): Prisma.PolicyAnnouncementUncheckedUpdateInput {
  return {
    applyStart: period.start,
    applyEnd: period.end,
    applyPeriodText: period.text,
    status: period.end.getTime() < now.getTime() ? "closed" : "open",
  };
}

/** 상세 주소의 ?mng_cd= (서울신보). 없거나 주소가 아니면 빈 문자열. */
function mngCdFromUrl(url: string): string {
  try {
    return new URL(url).searchParams.get("mng_cd") ?? "";
  } catch {
    return "";
  }
}

/** 주소의 호스트. 주소가 아니면 빈 문자열(출처 전용 첨부 갈래를 그 사이트로만 가두는 데 쓴다). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** 상대 경로거나, 절대 주소면 baseUrl 과 같은 호스트일 때만 true. */
function sameSite(href: string, baseUrl: string): boolean {
  if (!/^https?:\/\//i.test(href.trim())) return !/^\/\//.test(href.trim());
  try {
    return new URL(href).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

/** 첨부 이름이 공고문·모집요강·안내문이면 우선 읽을 파일. 서식·매뉴얼·양식은 뒤로. */
const ANNOUNCEMENT_DOC = /공고문|공고\b|공고\s*\(|모집\s*요강|모집요강|안내문|시행\s*계획|사업\s*계획서?(?!\s*양식)|공고\s*\d|공고$/;

export type BoardDetailFillRow = {
  id: string;
  source: string;
  url: string;
  targetText: string;
  /** 무료 추출 재계산에 쓴다 — 없으면 본문만으로 추출(구 호출부 호환). */
  title?: string;
  summary?: string;
  /** 소관기관 — 제목 앞머리 광역이 기관과 어긋날 때 판정용 지역 조건을 만들지 않는 데 쓴다. */
  agency?: string;
  /** 중복 판정 열쇠(게시판은 상세 주소). 제목이 아직 잘린 동안 줄마다 유일한 임시 열쇠를 만드는 데만 쓴다. */
  sourceId?: string;
  /**
   * 저장돼 있던 첨부(재수확 전 값 · Prisma `attachments` 칸 그대로). 새로 수확한 목록과
   * 달라졌는지 비교해 `attachmentFillTriedAt` 도장을 지울지 정하는 데만 쓴다.
   * 안 넘기면(구 호출부) 비교 근거가 없어 도장을 그대로 둔다.
   */
  attachments?: unknown;
};

/**
 * 새로 수확한 첨부와 저장돼 있던 첨부(`row.attachments`)가 다른지 — 순서는 안 본다.
 *
 * ★열쇠는 **주소 + 본문**이다(2026-09-06 독립 리뷰 「중요」). POST 로만 주는 게시판
 *  (산업인력공단·영화진흥위·여성기업센터)은 내려받기 창구가 하나뿐이라 **파일이 바뀌어도 주소는 그대로**다 —
 *  주소만 보면 첨부가 통째로 갈렸는데도 「같다」로 읽혀, 옛 실패에서 찍힌 7일 도장이 안 지워진다.
 *  GET 첨부는 본문이 없어 예전과 글자 단위로 같은 판정이다.
 * ★caller 가 이전 값을 안 넘기면(undefined) 비교할 근거가 없다 — 모르는 것을 「바뀌었다」로
 *  단정해 도장을 매번 지우면 재시도 간격을 두는 의미가 없어진다(원래 있던 것과 같은 「모르면
 *  안 건드린다」 원칙 — 위 `funding.fundingGroup` 주석과 같은 이유).
 */
function attachmentRequestKey(a: PolicyAttachmentRequest): string {
  return `${a.url}\n${a.body ?? ""}`;
}

function attachmentRequestsChanged(prevRaw: unknown, next: PolicyAttachmentRequest[]): boolean {
  if (prevRaw === undefined) return false;
  const prev = new Set(asPolicyAttachments(prevRaw).map(attachmentRequestKey));
  const nextKeys = new Set(next.map(attachmentRequestKey));
  if (prev.size !== nextKeys.size) return true;
  for (const k of nextKeys) if (!prev.has(k)) return true;
  return false;
}

/**
 * `title-only` — 본문도 첨부도 없지만 **제목만** 올라간 경우(2026-09-05 독립 검사 지적 1).
 * 예전엔 빈 본문 관문에서 먼저 돌아가 버려 승격이 영영 일어나지 않았다.
 * 세는 자리에서는 `empty` 와 같이 「본문 못 채움」으로 취급하되 로그에서는 구분한다.
 */
export type BoardDetailFillResult = "filled" | "title-only" | "empty" | "error";

/**
 * 게시판 공고의 빈 자격조건 본문을 상세 페이지에서 lazy 로 채운다.
 * 게시판이 아니거나 이미 차 있으면 empty. 오류는 throw 하지 않고 error.
 * 본문이 비어도 첨부가 있으면 저장하고 filled.
 */
export async function fillBoardDetail(
  row: BoardDetailFillRow,
  /**
   * `onlyIfEmpty` — 「아직 본문이 빈 행」일 때만 쓴다. 수집 꼬리 단계처럼 **미리 뽑아 둔 목록**을
   * 들고 도는 쪽에서 켠다: 뽑고 나서 쓰기까지 사이에 남이 더 새 내용으로 채웠으면 옛 내용으로
   * 덮어 버리기 때문이다. 사람이 진단·열람으로 부를 때는 **다시 읽어 덮는 것이 목적**이라 끄고 쓴다.
   */
  /**
   * `signal` — 바깥에서 건 **예산** 표식(수집 꼬리의 4분 예산). 상세 요청의 자체 시간 상한과
   * 함께 걸려 먼저 끝나는 쪽이 끊는다. 안 끊으면 한 행이 자물쇠보다 오래 붙잡는다(독립 리뷰 5번).
   */
  opts: { onlyIfEmpty?: boolean; signal?: AbortSignal } = {},
): Promise<BoardDetailFillResult> {
  try {
    if ((row.targetText ?? "").trim()) return "empty";
    const cfg = BOARD_SOURCES.find((c) => c.id === row.source);
    if (!cfg || !row.url) return "empty";
    // 상세 페이지에만 상·하한을 20MB·30초로 넉넉히 준다 — 목록 페이지(표 몇 줄)는 그대로 좁게
    // 둬야 게시판 30여 곳 전체 요청이 느려지지 않는다(fable 리뷰 중요3).
    const detailLimits = { timeoutMs: DETAIL_FETCH_TIMEOUT_MS, maxBytes: DETAIL_FETCH_BODY_MAX_BYTES, signal: opts.signal };
    const boundFetch = (u: string, init?: BoardFetchInit) => fetchBoardText(u, cfg.charset, cfg, init, detailLimits);
    let text: string;
    let harvestHtml: string;
    /** 범위를 좁혀도 쪽 머리글의 값을 읽어야 하는 게시판이 있다 — 쪽 전체를 따로 들고 간다. */
    let pageHtml: string;
    if (cfg.detailFetch) {
      const contentHtml = await cfg.detailFetch(row.url, boundFetch);
      /**
       * ★상세를 **직접 조달하는** 출처가 빈 글을 돌려주면 조용히 넘기지 않는다(2026-09-06 독립 리뷰 4번).
       * 아산 헬스케어스파는 본문·첨부가 `var r_data = {…}` 라는 스크립트 덩어리 안에만 있어서,
       * 그 이름이 바뀌면 **첨부 0건·본문 0자**가 되고 예전 코드는 그걸 `empty`(= 채울 게 없음)로
       * 돌려 아무 소리도 안 냈다. 아래 `attachmentsScopeRequired` 갈래와 같은 자리·같은 처리다 —
       * 실패로 돌려 다음 재시도에 남기고 로그로 알린다.
       */
      if (!contentHtml.trim()) {
        console.warn("[policy-detail] 상세 조달이 빈 글을 돌려줌", cfg.id, row.url);
        return "error";
      }
      const raw = parseHtml(contentHtml).text.trim();
      text = raw.length > 20_000 ? `${raw.slice(0, 20_000)}\n[상세 잘림]` : raw;
      harvestHtml = contentHtml;
      pageHtml = contentHtml;
    } else {
      const html = await fetchBoardText(row.url, cfg.charset, cfg, undefined, detailLimits);
      text = await fetchBoardDetail(cfg, row.url, { fetchText: async () => html });
      harvestHtml = html;
      pageHtml = html;
      if (cfg.attachmentsScopeSelector) {
        const scoped = parseHtml(html)
          .querySelectorAll(cfg.attachmentsScopeSelector)
          .map((el) => el.outerHTML)
          .join("\n");
        /**
         * ★한 조각도 안 잡히면 **첨부 0건으로 조용히 끝내지 않는다**(2026-09-06 독립 리뷰 2번).
         * 사이트가 상자 이름을 바꾸면(`dl_st1`→`dl_st2`) 아무 소리 없이 첨부가 사라지고,
         * 본문 선택자도 없는 게시판(시흥·충북TP)은 그대로 빈 결과로 끝나 구조화가 첨부의
         * 존재조차 모른 채 제목만으로 판정을 굳힌다. 실패로 돌려 다음 재시도에 남긴다.
         *
         * ★단 **`attachmentsScopeRequired` 를 켠 게시판에서만** 그렇게 한다(2026-09-06 판정).
         *  범위 선택자를 쓰는 게시판이 60곳인데 그중 42곳은 본문 선택자도 있다 —
         *  「첨부가 없으면 상자 자체가 사라지는」 사이트라면 첨부 없는 공고가 본문을 잘 받아 놓고도
         *  버려져 7일마다 헛돈다. 실물로 「첨부가 없어도 상자는 있다」를 확인한 곳만 켠다.
         */
        if (!scoped && cfg.attachmentsScopeRequired) {
          console.warn("[policy-detail] 첨부 영역 선택자 미적중", cfg.id, row.url);
          return "error";
        }
        harvestHtml = scoped;
      }
    }
    /**
     * ★목록이 잘라 보낸 제목을 상세의 온전한 제목으로 승격한다(안양 20자, 2026-09-05).
     * 아래 `title` 하나를 갈래·한도·조건 추출이 **다 같이** 쓴다 — 갈리면 같은 공고가
     * 자리마다 다른 제목으로 판정된다. 승격이 안 되면(설정 없음·접두어 관계 아님) 목록 값 그대로다.
     *
     * ★★반드시 **빈 본문 관문보다 앞**에서 계산한다(2026-09-05 독립 검사 지적 1).
     *  안양은 본문(`div.bbs_memo`)이 한 줄뿐이거나 아예 없고 첨부도 없는 상세가 있다 —
     *  관문 뒤에 두면 그런 줄은 매 회차 `empty` 로 돌아가 **제목이 영영 안 올라간다.**
     */
    const title = upgradedTitleOf(cfg, pageHtml, row.title ?? "");
    const promoted = title !== (row.title ?? "");
    /**
     * ★첨부를 **수집기가 직접 만드는** 출처는 공용 수확기를 쓰지 않는다(2026-09-06).
     * 산업인력공단·영화진흥위·여성기업센터는 첨부가 POST 라 `<a href>` 에 주소가 아예 없다 —
     * 공용 수확기가 만들어 낼 수 있는 것은 GET 주소뿐이라 여기서 갈래를 나눈다.
     *
     * ★상세에만 있는 접수기간 칸(`detailApplyPeriod`)도 **제목 승격과 같은 자리**에서 읽는다
     *  — 빈 본문 관문 뒤에 두면 본문·첨부가 없는 상세(메인비즈는 본문이 공고 이미지뿐)에서
     *  기간이 영영 안 채워진다(제목 승격이 같은 이유로 여기 있다).
     */
    const period = detailApplyPeriodOf(cfg, pageHtml);
    const periodFields = period ? periodFieldsOf(period, new Date()) : null;
    const attachments: PolicyAttachmentRequest[] = cfg.detailAttachments
      ? cfg.detailAttachments({ html: harvestHtml, pageHtml, detailUrl: row.url, baseUrl: cfg.baseUrl })
      : harvestBoardAttachments(harvestHtml, cfg.baseUrl, pageHtml, cfg.charset, row.url);
    if (!text.trim() && attachments.length === 0) {
      if (!promoted && !periodFields) return "empty";
      // 본문·첨부는 못 얻었지만 제목이 올랐거나 접수기간을 읽었다 — 그 칸들만 고치고 끝낸다.
      // `targetText` 를 안 쓰므로 「아직 빈 행」 울타리가 필요 없다(남의 본문을 덮지 않는다).
      await prisma.policyAnnouncement.update({
        where: { id: row.id },
        // 제목 거르개(`detailTitle.drop`)가 닫은 status 가 기간 판정보다 뒤에 온다 —
        // 「지원사업이 아니다」는 판정이 마감일보다 세다.
        data: { ...(periodFields ?? {}), ...(promoted ? titleFieldsOf(cfg, row, title) : {}) },
      });
      return "title-only";
    }
    // 본문이 이제야 채워졌으니 무료 추출도 다시 — 안 하면 「제목+요약」짜리 조건이 영구히 남아
    // 추천(3차)에서 조건 있는 공고가 「조건 0개」로 잘못 정렬된다(적대 리뷰 2026-08-29 중요6).
    const data: Prisma.PolicyAnnouncementUncheckedUpdateInput = {
      targetText: text,
      attachments: attachments as unknown as Prisma.InputJsonValue,
      ruleStructure: buildRuleStructure(text, row.summary ?? "", title, row.agency ?? "") as unknown as Prisma.InputJsonValue,
    };
    // ★첨부 주소가 실제로 바뀌었으면 도장(attachmentFillTriedAt)도 지운다 — 안 지우면 옛 실패에서
    //  찍힌 도장(7일) 탓에 방금 고친 새 주소를 바로 못 내려받는다(2026-09-06 충북TP 실측 — 인코딩을
    //  고쳐 배포해도 사람이 도장을 손으로 지워야 했다). 같으면 건드리지 않는다(불필요한 재시도 방지).
    if (attachmentRequestsChanged(row.attachments, attachments)) {
      data.attachmentFillTriedAt = null;
    }
    // 제목이 실제로 올라갔을 때만 쓴다 — 안 그러면 매 회차 같은 값을 쓰느라 갱신 대상이 넓어진다.
    // 상세에서 읽은 접수기간 — 제목 칸보다 **먼저** 얹는다. 제목 거르개가 닫은 status 가
    // 마감일 판정보다 세다(「지원사업이 아니다」가 「아직 안 끝났다」를 이긴다).
    if (periodFields) Object.assign(data, periodFields);
    if (promoted) Object.assign(data, titleFieldsOf(cfg, row, title));
    // ★갈래·한도·금리도 여기서 다시 뽑는다 — 저장 때(store.upsertAnnouncements)는 게시판 공고의
    //  본문이 비어 있어 「제목+요약」만 보고 뽑았다. 여기서 안 하면 본문이 이제야 찬 공고가 영영
    //  한도·금리 빈칸으로 남아 자금 조달 지도에서 「공고 확인」만 뜬다(설계 2026-09-03 §3).
    //  저장 때와 **같은 함수**를 쓴다 — 규칙이 갈리면 같은 공고가 자리마다 다른 갈래가 된다.
    const funding = fundingFieldsOf({
      title,
      summary: row.summary ?? "",
      agency: row.agency ?? "",
      targetText: text,
      wedlyCategory: classifyWedlyCategory(title, row.summary ?? ""),
    });
    // ⚠️못 뽑은 칸은 **아예 안 싣는다.** 갈래는 본문이 아니라 제목·요약·기관으로 정해지는데,
    //  호출부마다 넘겨 주는 칸이 다를 수 있다 — 구조화 단계(structurize.ts)도 2026-09-03 부터는 소관기관을
    //  넘기지만(Task 4-c), 이 방어는 다른 호출부·옛 실행체를 위해 그대로 둔다.
    //  그 자리에서 나온 「못 잡음」으로 저장된 갈래를 ""로 덮으면 그 공고가 지도에서 통째로 사라진다
    //  (같은 파일 위쪽 「빈 본문으로 덮지 않는다」와 같은 이유).
    if (funding.fundingGroup) data.fundingGroup = funding.fundingGroup;
    // 글자와 숫자는 한 쌍이다 — 따로 쓰면 「최대 5,000만원인데 정렬용 숫자는 옛 1억」이 된다.
    if (funding.amountText) {
      data.amountText = funding.amountText;
      data.amountMaxWon = funding.amountMaxWon;
    }
    if (funding.rateText) {
      data.rateText = funding.rateText;
      data.rateMin = funding.rateMin;
    }
    if (opts.onlyIfEmpty) {
      // 뽑을 때와 **같은 조건**으로 쓴다 — 그사이 남이 채웠으면 0행이 되어 조용히 넘어간다.
      const w = await prisma.policyAnnouncement.updateMany({ where: { id: row.id, targetText: "" }, data });
      if (w.count === 0) return "empty";
    } else {
      await prisma.policyAnnouncement.update({ where: { id: row.id }, data });
    }
    return "filled";
  } catch (e) {
    // 오류를 **객체째** 찍지 않는다 — 어떤 오류는 `input` 같은 속성에 원본 설정값(프록시 주소의
    // 비밀번호 등)을 달고 오고, console 이 그걸 통째로 펼쳐 로그에 남긴다(2026-08-28 실측).
    console.warn("[policy-board] 상세 채움 실패", row.id, e instanceof Error ? e.message : String(e));
    return "error";
  }
}

// ── P2 w4 · 메인비즈 첨부 ─────────────────────────────────────────────
/**
 * 메인비즈협회 첨부 — 주소 끝에 확장자가 없고 **이름이 쿼리 안에** 있다.
 *   `/lib/file_down_new.asp?filename=%5BWORLD%2DOKTA%5D+2026+…%2Ehwp&furl=16&fgbn=0`
 *
 * 왜 갈래가 따로 필요한가(2026-09-06 고정본 실측): 확장자가 `%2Ehwp` 로 퍼센트 인코딩돼 있어
 * `FILE_HREF`(주소 끝 `.hwp`)에 안 걸리고, 경로 글자가 `file_down_new` 라 `/download/i` 에도
 * 안 걸린다. 그래서 이 게시판은 첨부가 **한 건도** 안 잡혔다 — 본문은 공고 이미지뿐이라
 * 열린 공고가 전부 조건 0개로 남았다.
 *
 * ★**호스트를 `www.mainbiz.or.kr` 로 못 박는다.** `file_down_new.asp` 같은 흔한 이름을
 *  전 게시판에 열어 주면 다른 사이트의 안 받아지는 링크까지 첨부로 저장된다.
 * ★이름은 `filename` 값을 그대로 쓴다(URLSearchParams 가 `+`→공백까지 풀어 준다) —
 *  주소에서 뽑으면 `file_down_new.asp` 가 이름이 되어 형식 판정이 `etc` 로 떨어진다.
 * ★저장되는 **주소는 원문 그대로**다. 이름이 쿼리스트링에 들어가는 구조라 인코딩을 보존해야
 *  받아진다(`+` 를 `%20` 으로 재해석하면 안 된다 — 조사 실측 2,184,192바이트 hwp).
 */
const MAINBIZ_ATTACH_HOST = "www.mainbiz.or.kr";
const MAINBIZ_ATTACH_PATH = /\/lib\/file_down_new\.asp$/i;

export function mainbizAttachmentName(href: string, base: string): string | null {
  if (!href || !/file_down_new\.asp/i.test(href)) return null;
  try {
    const u = new URL(decodeHtmlEntities(href), base);
    if (u.host !== MAINBIZ_ATTACH_HOST) return null;
    if (!MAINBIZ_ATTACH_PATH.test(u.pathname)) return null;
    const name = (u.searchParams.get("filename") ?? "").replace(/\s+/g, " ").trim();
    return name || null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ── P2 w5 ── 첨부 주소가 **JS 함수 인자 안에만** 있는 게시판 3곳 (2026-09-06 실측)
 *
 * 왜 파일 맨 끝에 모아 두나: 위쪽 상수 블록은 물결마다 여러 일꾼이 동시에 손대는 자리라
 * 병합 충돌이 난다. 갈래를 여기 한 덩어리로 모으면 충돌이 이 블록 안에서만 생긴다.
 *
 * 왜 **호스트 한정**인가: 함수 이름 하나만 믿고 아무 게시판에서나 받으면, 이름이 겹치는
 * 다른 사이트에서 엉뚱한 글자가 첨부 주소로 저장된다(`AUTO_RCHK` 주석의 시흥 사고와 같은 갈래).
 * ───────────────────────────────────────────────────────────────────────────── */

/** 첨부 이름 뒤에 붙는 내려받기 횟수(순천 「(다운로드 3 회)」). 크기 표기가 아니라 따로 지운다. */
const P2W5_COUNT_TAIL = /\(\s*다운로드\s*\d+\s*회\s*\)\s*$/;

/**
 * 주소에 끼어드는 `;jsessionid=…`(순천 URL 리라이트) — 저장하면 남의 죽은 세션을 물고 다닌다.
 * ★`/` 도 끝으로 본다(2026-09-06 적대 리뷰): 세션이 경로 **중간** 조각에 붙는 서버 설정이면
 *  `[^?&#]*` 는 뒤 경로까지 통째로 삼켜 주소가 잘린다.
 */
const P2W5_JSESSIONID = /;jsessionid=[^?&#/]*/i;

type P2W5DownloadRule = {
  /** 이 갈래를 쓸 게시판 호스트(수집기 `baseUrl` 기준). */
  host: string;
  re: RegExp;
  /** 뽑은 조각으로 실제 내려받기 주소를 만든다. 못 만들면 null. */
  build: (m: RegExpMatchArray) => string | null;
};

const P2W5_DOWNLOADS: P2W5DownloadRule[] = [
  /**
   * 익산시 사회적경제지원센터 — `<a href="javascript:;" onclick="file_download('<주소>')">`.
   * 인자가 이미 절대주소다. 옛 코드는 `javascript:` href 를 건너뛰어 **첨부 0건**이었다.
   */
  { host: "www.ikse.or.kr", re: /file_download\(\s*['"]([^'"]+)['"]\s*\)/, build: (m) => m[1] },
  /**
   * 순천시기업지원포털 — `href="javascript:Jnit_boardDownload('<주소>','<집계주소>','<번호>')"`.
   * 첫 인자가 진짜 파일 주소이고, `;jsessionid=…` 가 박혀 오므로 지운다.
   * 실측: 세션 없는 맨 주소
   * `…/board/file/bbs_0000000000011603/236/FILE_000001000078317/2026070815552016150`
   * 가 그대로 200 + `Content-Disposition: attachment` 로 파일을 준다(쿠키·Referer 불필요).
   */
  {
    host: "www.suncheon.go.kr",
    re: /Jnit_boardDownload\(\s*['"]([^'"]+)['"]/,
    build: (m) => m[1].replace(P2W5_JSESSIONID, "") || null,
  },
  /**
   * 수원도시재단 — `onclick="fn_getFile('file','<열쇠>','<정적경로>')"`.
   * ★**두 번째 인자(열쇠)** 로 조립한 `…/contest/fileDown.do?ACV_FIL_KEY=<열쇠>` 만 실측으로
   *  200 + `Content-Disposition` 을 준다(쿠키 불필요). 세 번째 인자인 정적 경로
   *  (`/sscf2019_files/contest/…hwp`)는 **파일을 주는지 확인되지 않았다** — 그래서
   *  `P2W5_SKIP_EMBEDDED` 로 그 호스트에서는 「따옴표 안 파일 주소」 갈래를 아예 끈다.
   */
  {
    host: "sscf2016.or.kr",
    re: /fn_getFile\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]\s*,/,
    build: (m) => `/contest/fileDown.do?ACV_FIL_KEY=${encodeURIComponent(m[1])}`,
  },
];

/**
 * 그 호스트에서는 `EMBEDDED_FILE`(따옴표 안 `.pdf`·`.hwp` 주소) 갈래를 쓰지 않는다.
 * 수원도시재단은 같은 `onclick` 안에 **확인되지 않은 정적 경로**가 함께 들어 있어, 켜 두면
 * 한 파일이 두 줄(확인된 통로 + 가짜일 수 있는 경로)로 저장된다.
 */
const P2W5_SKIP_EMBEDDED = new Set(["sscf2016.or.kr"]);

function p2w5HostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "";
  }
}

/** 시험이 갈래를 글자만으로 잴 수 있게 내보낸다. */
export function p2w5SkipsEmbeddedFiles(baseUrl: string): boolean {
  return P2W5_SKIP_EMBEDDED.has(p2w5HostOf(baseUrl));
}

/**
 * `onclick`/`href` 글자에서 이 세 게시판의 첨부 주소를 꺼낸다. 해당 호스트가 아니면 늘 null.
 * 만든 주소가 **같은 사이트**가 아니면(바깥 주소) 담지 않는다 — `JS_LOCATION` 갈래와 같은 울타리.
 */
export function p2w5AttachmentHref(call: string, baseUrl: string): string | null {
  const host = p2w5HostOf(baseUrl);
  if (!host) return null;
  for (const rule of P2W5_DOWNLOADS) {
    if (rule.host !== host) continue;
    const m = call.match(rule.re);
    if (!m) continue;
    const url = rule.build(m);
    if (url && sameSite(url, baseUrl)) return url;
  }
  return null;
}
