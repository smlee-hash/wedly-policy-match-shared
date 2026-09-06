// 범용 게시판 수집기 — 출처별 설정과 추출 결과의 계약.
import type { NormalizedAnnouncement, PolicyAttachment } from "../../engine/types";

/**
 * 목록·상세 요청을 기본값(헤더 없는 GET)과 다르게 보낼 때 쓴다.
 * · `POST` — 목록이 JSON API 인 출처(스마트공장·창조경제혁신센터·사회적기업진흥원)
 * · `GET` + `headers` — 헤더를 봐야 본문을 주는 출처. 국방기술진흥연구소는 `Referer` 가 없으면
 *   상세 주소가 어떤 인자를 줘도 **똑같은 44,029바이트 껍데기**를 돌려준다(2026-09-02 실측:
 *   인자 3가지 + POST 까지 전부 같은 바이트 수, Referer 를 붙이자 57,513바이트에 첨부가 나왔다).
 */
export type BoardFetchInit = {
  method: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string;
};

/**
 * 첨부 한 건 + **그 첨부를 받는 방법**. 공용 꾸러미의 `PolicyAttachment` 는 `{name,url,kind}` 뿐이라
 * 여기서 선택 필드로 넓힌다(꾸러미를 고치면 ERP·일루아 두 앱 핀을 함께 올려야 한다).
 *
 * 왜 필요한가(2026-09-06 실측 3곳): 첨부를 **POST 로만** 주는 게시판이 있다.
 * · 한국산업인력공단 `POST /cms/download/downloadFile2.hrd` body `attachSeq2=<base64>`
 *   → 200 + HWP 89,088바이트. GET 으로는 안 온다.
 * · 영화진흥위원회 `POST /kofic/business/comm/file/downloadFile.do` body `fileUrl`·`fileNm`·`dnFileName`
 *   → 200 + PDF 130,996바이트. 정적 경로 GET 은 404.
 * · 여성기업종합지원센터 `POST /front/fms/FileDown.do` body `_csrf`·`atchFileId`·`fileSn`
 *   → 200 + HWP 330,240바이트(세션 쿠키 필요 — `BoardAttachmentSession.csrf` 참고).
 * 이 필드가 없으면 세 곳의 첨부가 전부 「읽지 못한 첨부」로 적히고 7일 도장이 찍힌다.
 *
 * ★값은 DB(`PolicyAnnouncement.attachments` JSON)에 그대로 저장돼 내려받기 단계가 다시 읽는다.
 *  그래서 **요청마다 새로 받아야 하는 값(CSRF 토큰·1회용 열쇠)은 여기 담지 않는다** — 그것은
 *  `attachmentSession.csrf`·`attachmentToken` 처럼 내려받는 순간에 만드는 감싸개 몫이다.
 */
export type PolicyAttachmentRequest = PolicyAttachment & {
  /** 적으면 첫 요청만 이 방법으로 보낸다. 리다이렉트 홉은 언제나 GET(본문 없이). */
  method?: "POST";
  /** `application/x-www-form-urlencoded` 본문. 값은 반드시 미리 인코딩해 둔다. */
  body?: string;
  /** 덧붙일 머리글. `content-type` 을 안 적으면 POST 에 form 형식이 기본으로 붙는다. */
  headers?: Record<string, string>;
};

/** 목록에서 뽑은 공고 한 줄(정규화 전). 상세(자격조건)는 아직 안 읽는다. */
export interface BoardRow {
  title: string;
  detailUrl: string;   // 절대 주소로 정규화된 상세 링크
  dateText: string;    // 게시일/마감일 원문(파싱은 정규화 때)
  category?: string;
  agency?: string;     // 행마다 수행기관이 다를 때(E4). 없으면 cfg.agency
  /**
   * 행마다 지역이 갈릴 때. 없으면 `cfg.region`.
   *
   * 왜 필요한가(2026-09-06 적대 리뷰): 시청 포털은 **남의 공고를 그대로 옮겨 싣는다** —
   * 순천시기업지원포털 1쪽의 과반이 `[중소벤처기업부]`·`[전남TP]` 머리표를 단 재게시다.
   * 그 줄에 출처의 지역(전남·경기)을 그대로 박으면 **전국 사업이 그 지역 기업에게만 추천되고**
   * 다른 지역 기업은 같은 공고를 놓친다. 전국 기관은 `""`(지역 없음)으로 둔다 — mss 와 같은 값.
   */
  region?: string;
  /**
   * 목록이 자격 요약을 짧게 실어 줄 때(창조경제혁신센터 `ELIGIBILITY` = 「예비창업자, 7년이내 기업」).
   * ★`targetText` 가 아니라 여기 담는다 — `targetText` 를 채우면 뒷단계의 **첨부 본문 뽑기**가
   *   `targetText === ""` 조건에서 그 공고를 영영 건너뛴다(적대 리뷰 지적). `summary` 는 저장되고
   *   조건 추출(`buildRuleStructure`)에도 함께 들어가므로 자격 정보를 잃지 않으면서 첨부 길도 열어 둔다.
   */
  summary?: string;
  /** 목록이 자격조건 요약을 직접 실어 줄 때(소진공처럼 상세가 스크립트 화면이라 lazy 채움이 불가한 출처). */
  targetText?: string;
}

/** 한 필드를 뽑는 규칙. selector 우선, 없으면 attr/regex 보조. */
export interface FieldRule {
  selector?: string;        // node-html-parser querySelector (행 기준 상대)
  attr?: string;            // 값 대신 속성(href 등)
  regex?: string;           // 텍스트에서 정규식 첫 그룹
}

export type ExtractLayerName = "feed" | "selector" | "heuristic" | "selfheal" | "render";

/**
 * 첨부 내려받기에 **세션이 필요한 게시판**(그누보드 등)을 여는 열쇠.
 *
 * 왜 필요한가(2026-09-06 curl 실측):
 * · 세종TP `bbs/download.php?bo_table=business01&wr_id=1985&no=0` 는 그냥 부르면
 *   **200 + text/html 3,947바이트**(「잘못된 접근입니다」 안내 화면)를 준다. Referer 만 붙여도 같다(4,088바이트).
 *   **상세를 한 번 GET 해 받은 쿠키**(PHPSESSID 등 3개)를 실으면 그제야
 *   `content-disposition: attachment` + HWP 78,848바이트(OLE `d0cf11e0`)가 온다.
 * · 한국사회적기업진흥원 `cmmn/download.do?idx=…` 는 반대다 — 쿠키 없이 **Referer 만** 붙이면
 *   200 + PDF 771,077바이트, 안 붙이면 `<script>alert('…` 91바이트다.
 * 그래서 두 손잡이를 따로 둔다. 받은 글이 HTML 이면 뒷단계가 「읽지 못한 첨부」로 적고
 * 7일 도장을 찍어 버리므로, 이 옵션이 없으면 그 게시판은 영영 첨부 본문이 빈다.
 */
export type BoardAttachmentSession = {
  /**
   * 첨부 요청에 붙일 `Referer`. `"detail"` 이면 **그 공고의 상세 주소**를 쓴다
   * (그 밖의 값은 적은 글자 그대로). 상세 주소가 명부의 허용 호스트가 아니면 안 붙인다.
   */
  referer?: "detail" | string;
  /**
   * 첨부를 받기 **전에** 상세 주소를 한 번 GET 해 `set-cookie` 를 모은다.
   * 쿠키는 **공고 한 줄에 한 번만** 데우고 그 줄의 첨부들이 함께 쓴다 —
   * 첨부마다 데우면 상세 요청이 첨부 수만큼 늘어난다.
   */
  warmup?: "detail";
  /**
   * 데우기로 받은 **상세 HTML 에서 1회용 CSRF 토큰을 뽑아** POST 첨부 본문 끝에 붙인다.
   * `warmup: "detail"` 과 **함께**일 때만 돈다(토큰과 쿠키가 한 세션에서 나와야 짝이 맞는다).
   *
   * 왜 저장해 두면 안 되나(2026-09-06 여성기업종합지원센터 실측): 내려받기 POST
   * `/front/fms/FileDown.do` 는 `_csrf` 값을 요구하는데, 그 값은 상세 HTML 의
   * `<input id="hdCsrfTk">` 에 있고 쿠키 항아리에는 **JSESSIONID 하나뿐**이다(`cj.txt`) —
   * 토큰이 세션에 매여 있다는 뜻이라, 수확 때 저장해 둔 값은 다음 회차의 새 세션에서 안 통한다.
   * 그래서 쿠키를 받은 **그 응답 글자**에서 함께 뽑는다.
   */
  csrf?: {
    /**
     * 상세 HTML 에서 **값과 변수 이름을 함께** 꺼낸다. 이름을 안 주면 `field` 를 쓴다.
     * 못 꺼내면 `null` — 그러면 그 줄의 첨부 요청이 전부 **통로 탓 오류**로 떨어진다(1시간 뒤 재시도).
     * 조용히 토큰 없이 보내지 않는다: 여성기업센터는 토큰이 없으면 **200 이 아니라 404 + 95바이트
     * HTML** 을 주는데(2026-09-06 실측), 그건 「파일 형식 실패」로 분류돼 7일 도장이 찍힌다.
     */
    extract: (html: string) => { token: string; field?: string } | null;
    /** `extract` 가 이름을 안 줬을 때 쓸 변수 이름. 예: `"_csrf"`. */
    field: string;
  };
};

export interface BoardConfig {
  id: string;               // "tp-busan" → PolicyAnnouncement.source
  label: string;            // "부산테크노파크"
  agency: string;
  region: string;
  baseUrl: string;          // 상대 링크를 절대화할 기준
  /** baseUrl 호스트 외 상세 주소에 허용할 호스트. */
  allowedHosts?: string[];
  charset?: "utf-8" | "euc-kr";
  feed?: { url: (page: number) => string; kind: "rss" | "json"; itemPath?: string;
           map: { title: string; link: string; date: string; category?: string } };
  list: {
    url: (page: number) => string;
    maxPages: number;
    /** 목록이 POST(JSON API)일 때 — 없으면 GET(기존 동작). */
    init?: (page: number) => BoardFetchInit;
    rowSelector: string;    // 목록 행
    fields: { title: FieldRule; detailUrl: FieldRule; date: FieldRule; category?: FieldRule };
  };
  detailContentSelector?: string;
  /**
   * 목록이 **서버에서 제목을 잘라 보내는** 게시판(안양산업진흥원 20자)용 — 상세의 온전한
   * 제목으로 `title`·`dedupKey` 를 바꾼다. 안 적으면 제목은 목록 값 그대로(기존 동작).
   *
   * `selector` 는 상세 쪽에서 제목을 집는 선택자, `strip` 은 그 글자 앞뒤에 붙는 장식을 떼는
   * 정규식이다(안양: `[사업안내] - ` 접두). 승격은 **접두어 관계일 때만** 일어난다 —
   * 판정은 `title-upgrade.ts` 의 `upgradeTruncatedTitle` 한 곳에서만 한다.
   */
  detailTitle?: {
    selector: string;
    strip?: RegExp;
    /**
     * 승격된 **온전한 제목**이 이 정규식에 걸리면 그 줄을 `closed` 로 저장한다.
     * 목록 제목이 20자에서 잘려 오면 목록 단계 거르개(customParse 의 DROP)가 뒷글자를 못 봐서
     * 「… 선정 결과 발표」 같은 글이 그대로 통과한다 — 온전한 제목을 처음 보는 이 자리가
     * 마지막 기회다. 지우지 않고 닫는 이유: 지운 줄은 다음 회차에 다시 들어온다.
     */
    drop?: RegExp;
  };
  /**
   * **접수기간이 상세에만 구조화된 칸으로 있는** 게시판. 켜면 상세를 여는 자리에서
   * 그 칸을 읽어 `applyStart`·`applyEnd`·`applyPeriodText`·`status` 를 고친다.
   *
   * 왜 필요한가(2026-09-06 메인비즈 실측): 목록은 **등록일만** 주고
   * (`td.date` 「2026.09.04」), 상세 머리에만
   * `<span class="each">기간 : <span>2026-09-04 ~ 2026-09-09</span></span>` 이 있다.
   * · 그 머리를 `detailContentSelector` 로 잡으면 「작성일 : … 조회 : …」이 본문 행세를 해
   *   `targetText` 가 차 버리고, 뒷단계의 **첨부에서 본문 뽑기**(`targetText === ""` 조건)가
   *   그 공고를 영영 건너뛴다(cbtp 주석과 같은 갈래).
   * · 저장 단계의 본문 마감 규칙(`store.ts` → `body-deadline.ts`)도 못 읽는다 —
   *   그 규칙의 라벨 목록(접수기간·신청기간·모집기간·공모기간)에 이 사이트의 라벨 「기간」이 없다.
   * 그래서 등록일 개시형(90일 규칙)으로만 남아, 9월 9일에 끝난 공고가 12월까지 「모집중」이었다.
   *
   * `selector` 는 기간이 적힌 조각들(여러 개여도 된다), `strip` 은 라벨을 떼는 정규식이다.
   * ★`strip` 을 적으면 **그 정규식에 걸리는 조각만** 본다 — 같은 상자의 「작성일 : 2026.09.04」
   *  같은 이웃 칸을 기간으로 오독하지 않게 하는 울타리다.
   * 판정은 공용 파서(`parseApplyPeriod`) 하나로만 한다 — 시작·끝이 **둘 다** 나올 때만 쓰고,
   * 못 읽으면 목록에서 온 날짜를 그대로 둔다(값을 지어내지 않는다).
   */
  detailApplyPeriod?: { selector: string; strip?: RegExp };
  /**
   * 첨부 수확 범위를 이 선택자 안으로 제한한다. 안 적으면 상세 전체에서 수확(기존 동작).
   * 인천 비즈OK 처럼 공고 밖 상단·바닥글에 사이트 매뉴얼 PDF 가 있는 화면에서 오염을 막는다(적대 리뷰).
   */
  attachmentsScopeSelector?: string;
  /**
   * 상세에서 첨부 목록을 **수집기가 직접 만든다**. 적으면 공용 수확기
   * (`harvestBoardAttachments`) 결과를 **대신한다**(합치지 않는다).
   *
   * 왜 필요한가(2026-09-06): 공용 수확기는 `<a href>`·`onclick` 에서 **GET 주소**를 만들어 낸다.
   * 산업인력공단·영화진흥위·여성기업센터는 첨부가 POST 라 주소만으로는 못 받는다 —
   * 그 세 곳은 상세 HTML 을 직접 읽어 `method`·`body` 까지 채운 첨부 객체를 만든다.
   *
   * @param html 첨부를 찾을 조각(`attachmentsScopeSelector` 가 있으면 그 조각, 없으면 상세 전체)
   * @param pageHtml 쪽 전체 HTML(머리글에만 있는 값이 필요할 때)
   * @param detailUrl 그 공고의 상세 주소 · @param baseUrl 상대 주소를 풀 기준
   */
  detailAttachments?: (args: {
    html: string;
    pageHtml: string;
    detailUrl: string;
    baseUrl: string;
  }) => PolicyAttachmentRequest[];
  /**
   * 첨부를 받을 때 상세 세션(쿠키)·`Referer` 가 필요한 게시판. 안 적으면 예전대로 맨 GET 이다.
   * 두 갈래(`sync.fillBodiesFromAttachments`·`structurize.ensureAttachmentText`)가
   * **같은 도우미**(`board/attachment-session.ts`)를 써서 한쪽만 세션을 타는 일이 없게 한다.
   */
  attachmentSession?: BoardAttachmentSession;
  /**
   * 상세 본문을 직접 조달하는 출처(상세가 SPA 라 GET+선택자가 불가능하고 본문은 JSON API 로만 올 때).
   * 반환은 본문 HTML(없으면 ""). 요청은 반드시 인자로 받은 fetchText 로만 한다 — 허용 호스트 검사가 유지된다.
   */
  detailFetch?: (
    detailUrl: string,
    fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
  ) => Promise<string>;
  /**
   * 첨부를 내려받기 **전에 1회용 열쇠를 발급받아야** 하는 게시판. 안 적으면 예전대로 맨 GET 이다.
   * 두 갈래(`sync.fillBodiesFromAttachments`·`structurize.ensureAttachmentText`)가
   * **같은 한 줄 훅**(`board/attachment-fetch.ts`)을 써서 한쪽만 열쇠를 타는 일이 없게 한다.
   */
  attachmentToken?: BoardAttachmentToken;
  /**
   * 켜면 `attachmentsScopeSelector` 가 **한 조각도 안 잡힐 때** 경고하고 상세 채움을 실패로 돌린다
   * (첨부 0건으로 조용히 끝내지 않는다). 안 켜면 예전대로 0건.
   *
   * ★실물로 「**첨부가 없는 상세에도 그 상자는 있다**」를 확인한 게시판에만 켠다. 안 그러면
   *  첨부 없는 공고가 매번 실패로 돌아가 본문을 받아 놓고도 버려지고 7일마다 헛돈다.
   *  지금 켠 곳: 시흥(`div.dl_st1` 4쪽 실측) · 충북TP(`ul.attach` 4건 실측) ·
   *  안양(`ul.list-group` — 고정본 `aca-detail-noattach.html` 에도 있다).
   */
  attachmentsScopeRequired?: true;
  /** 절대화 직후 상세 URL 에서 지울 쿼리 키(페이지 번호 등). */
  dropUrlParams?: string[];
  customParse?: (html: string, page: number) => BoardRow[];
  render?: boolean;         // ④ 필요 시에만
  /**
   * 국내 IP 로만 열리는 곳(전북TP 실측: 해외에서 443·80 둘 다 타임아웃, 국내 0.25초 응답).
   * `POLICY_BOARD_PROXY_URL` 이 없으면 수집 목록에서 빠진다 — 켜 두면 매 회차 실패 알림만 쌓인다.
   */
  requiresProxy?: true;
  /** 검증 관문 기대치. 목록 1쪽 최소 행 수(이보다 적으면 표식 소실 의심). */
  expectMinRows?: number;
  /**
   * 「신규 0인 쪽이 연속 몇이면 멈출까」. 기본 2.
   *
   * ★분류·부서를 **한 쪽씩 번갈아** 도는 출처(안양 8분류)는 이 값을 한 바퀴 길이만큼 올린다.
   *  기본 2 는 「이 분류가 바닥났다」와 「전체가 끝났다」를 구분하지 못해서, 작은 분류 둘이
   *  나란히 오면 그 자리에서 끊겨 **뒤 분류가 통째로 안 들어온다**(2026-09-05 독립 검사 지적).
   */
  emptyStreakStop?: number;
  /**
   * 상세 본문을 **원리적으로 못 읽는** 출처(성남산업진흥원: 상세 링크가 로그인 화면이다).
   * 켜면 `fillEmptyBodies` 가 이 출처를 아예 뽑지 않는다.
   *
   * 왜 필요한가(적대 리뷰 지적): 그 단계는 「본문이 빈 공고」를 **최근 것부터 정해진 수만큼**
   * 가져다 채운다. 영영 안 채워지는 출처를 그대로 두면 그 줄들이 매 회차 자리를 차지해
   * **다른 출처의 빈 본문이 영영 차례를 못 받는다.** 요청을 안 보내는 것만으로는 못 막는다.
   */
  skipDetailFill?: true;
  /**
   * 켜면 selector(customParse) 단계가 실패해도 heuristic 추측 단계로 내려가지 않는다.
   * 목록 행에 첨부 파일 링크가 섞인 게시판(한국수출입은행)은 heuristic 이 파일 링크를 공고로,
   * 파일 이름을 제목으로 저장한다(2026-09-02 실측 30줄) — 그 줄은 다음 회차에 지워지지 않는다.
   * 기본은 끔 — 광주TP 처럼 구조가 바뀌면 heuristic 이 마지막 방어선인 게시판이 있다(적대 리뷰).
   */
  skipHeuristic?: true;
  /**
   * 상세 주소에 쪽 변수를 남긴다. 서울신보는 상세가 `pageIndex` 없이는 HTTP 500 이라(2026-09-03 실측)
   * 파서가 pageIndex=1 로 못 박아 내보내는데, 엔진이 그 변수를 「쪽 번호」로 알아내 지워 버리면 저장된
   * 주소가 500 이 된다. 값을 고정으로 박은 파서만 켠다 — 쪽마다 값이 갈리면 같은 공고가 쪽수만큼 중복된다.
   */
  keepPagingParamsInDetail?: true;
  /**
   * **마감일이 첨부 안에만 있는** 게시판. 켜면 저장 단계(store)의 90일 규칙이
   * 「첨부를 한 번도 안 읽어 본 줄」을 닫지 않는다.
   *
   * 왜 필요한가(2026-09-06 원주미래산업진흥원 실측): 이 게시판은 목록이 **등록일만** 주고
   * 상세 본문은 공고문을 통째로 그림(base64)으로 올려 글자가 0이다 — 마감은 첨부 PDF 에만 있다.
   * 그런데 게시판 13건 중 7건이 등록일 기준 90일이 지나 있어, 저장 규칙이 **첫 저장에서 바로**
   * `closed` 로 넣는다. 닫힌 줄은 첨부 본문 채움 줄서기(`status: "open"` 만 고른다)에 못 들어가므로
   * **첨부를 영영 안 읽고**, 그래서 마감도 자격조건도 영영 0이 된다 — 닫혔기 때문에 못 읽고,
   * 못 읽었기 때문에 계속 닫혀 있는 맞물림이다.
   *
   * ★유예는 **첨부를 한 번 읽기 전까지만**이다. 첨부 시도 도장(`attachmentFillTriedAt`)이 찍히면
   *  그 뒤로는 예전 규칙 그대로다 — 첨부에서 마감을 못 찾은 줄까지 영원히 열어 두면
   *  「영구 모집중」이 도로 생긴다(독립 검사 4차에서 70건이었던 그 문제).
   */
  deadlineInAttachments?: true;
  /**
   * 날짜 없는 행이 대부분인 쪽도 통과시킨다. 중소벤처24 는 접수중 1,630건 중 997건이 「예산 소진시까지」
   * ·「상시 접수」라 접수기간이 아예 없고(2026-09-03 실측), 그 줄만 모인 쪽에서 「날짜가 있는 행이 부족」
   * 검증이 수집을 끊어 어떤 정렬로도 담을 수 없었다. 원천이 상태(접수중)를 따로 주는 게시판만 켠다.
   */
  allowUndatedRows?: true;
}

export interface ExtractResult {
  rows: BoardRow[];
  layer: ExtractLayerName;
}

export type NormalizedRow = NormalizedAnnouncement;

/**
 * 첨부 내려받기에 **1회용 열쇠**가 필요한 게시판의 발급 방법.
 *
 * 왜 필요한가(2026-09-06 curl 실측 — 시흥산업진흥원 `uid=1144`):
 * 첨부 주소 `/config/download_home.php?filename=…` 를 그냥 부르면 **200 인데 내용이**
 * 「Undefined variable $ar_chk … 비정상적인 접근입니다」 164바이트다. 사이트 스크립트
 * `/js/program.js` 846행 `autoRchk()` 가 POST `/program_process/ar_code.php`(`ar_create=Y`)로
 * `{"0":{"id_status":"Y","ar_chk":"…"}}` 를 받아 주소에 `&ar_chk=<값>` 을 붙인다.
 * 그대로 하니 200 + `content-disposition: attachment` + HWP 904,704바이트(OLE `d0cf11e0`).
 * 200 + HTML 은 성공처럼 생겨서, 이 옵션이 없으면 뒷단계가 「읽지 못한 첨부」로 적고
 * 7일 도장을 찍는다 — 운영 실측으로 첨부 있는 열린 공고 18건이 전부 그렇게 남아 있었다.
 */
export type BoardAttachmentToken = {
  /** 열쇠 발급처. 상대 경로면 `baseUrl` 기준으로 푼다. 명부의 허용 호스트가 아니면 안 부른다. */
  endpoint: string;
  method: "POST";
  /** 보낼 본문(`application/x-www-form-urlencoded`). 예: `"ar_create=Y"`. */
  body: string;
  /** 받은 열쇠를 첨부 주소에 붙일 때 쓸 변수 이름. 예: `"ar_chk"`. */
  param: string;
  /** 응답 글자에서 열쇠를 꺼낸다. 못 꺼내면 `null` — 그러면 열쇠 없이 예전대로 부른다. */
  extract: (text: string) => string | null;
};
