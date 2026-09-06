import { parseHtml, type HTMLElement } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * KOTRA(대한무역투자진흥공사) 무역투자24 — 사업신청 공고 **두 목록**(기한사업 + 상시사업).
 *
 * 왜 연결했나: 수출·해외진출 지원사업(무역사절단·수출상담회·해외전시회·지사화·해외마케팅)이
 * 모이는 곳이다. 실측 171건(기한 97 + 상시 74, 2026-09-03)이 **전부 기업이 직접 신청하는 사업**이고,
 * 접수 시작일과 마감일을 목록에서 둘 다 준다 — 등록일만 주는 게시판보다 마감 정리가 정확하다.
 * 상시사업은 마감이 `9999-12-31`(무기한)로 오는데, 그 글자는 날짜로 안 읽혀 「시작일 ~」
 * 개시형으로 넘어간다 — 지어낸 마감일을 붙이지 않는다.
 *
 * ★게시판이 서버 페이지가 아니다. `subList/20000020753` 한 화면 안에서 스크립트가
 *   AJAX 로 목록을 갈아 끼운다(사이트맵에 하위 메뉴가 없는 이유).
 *
 * ★통로 세 개(`selectBmBizAllListAjax` · `selectBmBizRcritYListNewAjax` ·
 *   `selectBmBizTermListNewAjax`)는 **응답이 똑같다**(2026-09-03 실측: 같은 본문을 세 통로에
 *   던지니 카드 10장·사업번호가 글자까지 동일, 다른 것은 숨은 총건수 칸 이름뿐 —
 *   `allTotCnt`/`limtTotCnt`/`allwTotCnt`). 목록을 가르는 것은 통로가 아니라 **`sch_appl_yn`** 이다:
 *   · `sch_appl_yn=N` = **기한사업**(신청기간이 박힌 사업) 97건
 *   · `sch_appl_yn=Y` = **상시사업**(수출24 대행·상담 서비스 등) 74건 — 겹침 0건
 *   그래서 통로 하나(`selectBmBizRcritYListNewAjax`)로 **두 목록을 번갈아** 읽는다.
 *
 * ★쪽넘김은 **홀수=기한 · 짝수=상시**로 번갈아 준다(kita 와 같은 갈래).
 *   한 목록을 몰아 읽으면, 그 목록이 바닥난 자리에서 「신규 0인 쪽 연속 둘」 규칙에 걸려
 *   뒤 목록을 통째로 잃는다. 한 쪽에 100건을 받으므로 실제로는 1·2쪽에서 171건이 다 들어오고
 *   3·4쪽(각 목록 2쪽)이 0행이라 거기서 멈춘다 — 요청 4번.
 *
 * 구조(2026-09-03 실측):
 * · 목록 = **POST** `selectBmBizRcritYListNewAjax.do` — UA·Referer·X-Requested-With 없이도 200
 * · 응답은 HTML 조각. 행 = `div.card`, 제목 = `a.card-tit`, 사업유형 딱지 = `span.card-badge`
 * · 신청기간 = `dt`「신청기간」 다음 `dd`(「YYYY-MM-DD ~ YYYY-MM-DD」)
 * · 상세는 `href` 가 아니라 `onclick`/`href="javascript:fn_selectBizMntInfoDetailNew('…')"` 안에 있다
 * · **`pageSize` 가 그대로 먹는다** — 100 을 주면 한 응답에 97장이 다 온다(실측 292KB).
 *   그래서 쪽을 11번 넘기지 않고 목록마다 한 번에 받는다.
 * · 상세는 GET 그대로 200 + 실제 상세표(사업유형/신청기간/주관부서/문의처) — 스크립트 실행 불필요
 *
 * ★상세 주소의 `cpbizYn` 은 **N 이면 빼고 Y 면 남긴다**(2026-09-03 실측 + 적대 리뷰 지적 ④).
 *   · N 을 빼는 이유: `?dtlBizMntNo=26RP004` 만으로 **200** 이고 응답이 `cpbizYn=N` 판과
 *     **바이트까지 같다**(123,944 = 123,944). 기본값이라 빼도 같은 화면이고, 열쇠가 짧아진다.
 *   · Y 를 남기는 이유: `cpbizYn=Y` 판(125,399바이트)은 **내용이 다르다** — 협업 하위 서비스
 *     목록(「2026 양주시(수출24 글로벌 대행 서비스)」…)이 붙는다. 그걸 빼면 협업사업의 상세를
 *     다른 화면으로 바꿔 읽게 된다. 목록이 Y 라고 알려 준 사업은 Y 로 읽는 쪽이 옳다.
 */
const BASE = "https://www.kotra.or.kr";
/** 목록 통로 하나로 두 목록을 다 받는다(위 주석 ★ — 통로 셋의 응답이 같다). */
const LIST_AJAX = `${BASE}/module/subhome/bizAply/selectBmBizRcritYListNewAjax.do`;
/** 상세 화면. 목록의 onclick 이 이 주소를 문자열로 들고 있다. */
const DETAIL = `${BASE}/subList/20000020753/subhome/bizAply/selectBizMntInfoDetail.do`;
/** 한 쪽 건수 — `pageSize` 가 실제로 먹어서 100 으로 받는다. `startCount` 계산의 밑수이기도 하다. */
const PER_PAGE = 100;
/** 홀수 쪽 = 기한사업(N) · 짝수 쪽 = 상시사업(Y). 순서가 곧 번갈아 읽는 순서다. */
const APPL_YN = ["N", "Y"] as const;

/** 엔진 쪽 번호 → 「어느 목록의 몇 쪽」. 시험이 사상을 그대로 잴 수 있게 내보낸다. */
export function kotraTargetOf(p: number): { applYn: string; kind: "기한사업" | "상시사업"; page: number } {
  const i = Math.max(1, Math.floor(p)) - 1;
  const applYn = APPL_YN[i % APPL_YN.length];
  return { applYn, kind: applYn === "N" ? "기한사업" : "상시사업", page: Math.floor(i / APPL_YN.length) + 1 };
}

/** 사업번호(연도2 + 사업유형2 + 영숫자4). 예: 26PC001·26CN0ML·26TF00H. */
const BIZ_NO = /dtlBizMntNo=([A-Za-z0-9]+)/;
/** 협업사업 여부. Y 면 상세 화면 내용이 달라져 주소에 남긴다(위 주석 ★). */
const CPBIZ = /cpbizYn=([YN])/;
const YMD = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;

/**
 * 지원사업이 아닌 글. **버릴 것만** 좁게 적는다.
 *
 * 실측 20건(1·2쪽)에는 버릴 것이 **한 건도 없다** — 이 통로는 애초에 기업이 신청하는
 * 사업만 싣는다. 그래도 거르개를 두는 건, 나중에 같은 통로에 조달·채용 글이 섞여 들어와도
 * 목록이 오염되지 않게 하기 위해서다.
 *
 * ★`채용` 을 통째로 버리면 안 된다(bizbc 주석의 그 함정) — 고용보조금·채용대행 사업은
 *   제목에 「채용」을 쓴다. 기관이 사람을 뽑는 글(`직원 채용 공고`)만 좁게 버린다.
 * ★`행사 안내`·`설명회` 도 버리지 않는다 — 이 게시판은 상담회·전시회·로드쇼가 본체라
 *   그 낱말을 버리면 목록이 통째로 사라진다.
 * ★`설문` 을 통째로 버리지 않는다(2026-09-03 상시목록에서 드러남) — 「(수출24) 소비자 트렌드
 *   설문 조사」는 기업이 신청하는 **시장조사 서비스**(주관부서 해외진출상담센터·신청가능)인데
 *   낱말 하나로 버려지고 있었다. 기관이 제 고객에게 묻는 「만족도 조사」·「설문조사 참여 요청」만 버린다.
 */
const DROP =
  /입찰|만족도\s*(?:설문)?\s*조사|설문\s*조사\s*(?:참여|협조|안내|응답|요청)|평가위원|외부전문가|전문가\s*풀|우선협상대상자|제안발표|합격자\s*발표|(?:신규|경력|직원)\s*채용\s*(?:공고|안내)|채용\s*공고/;

/**
 * ★거르개보다 **먼저** 보는 구제 규칙(2026-09-03 적대 리뷰 지적 ⑦).
 * 「해외 공공조달 **입찰 지원사업 참여기업 모집**」·「**만족도 조사 지원사업 신청기업 모집**」처럼
 * 버릴 낱말이 **사업 이름 안에** 든 진짜 모집 공고가 있다. 「지원사업·참여기업·신청기업…」 같은
 * **사업 표식**과 「모집·신청·접수·공모」가 함께 있으면 거르지 않는다.
 * 표식 없는 「고객 설문조사 응답 요청」·「평가위원 모집 공고」는 그대로 걸린다.
 */
const RESCUE_SUBJECT = /지원\s*사업|참여\s*기업|신청\s*기업|참가\s*기업|참여\s*기관|지원\s*금|육성\s*사업|참가\s*업체/;
const RESCUE_ACTION = /모집|신청|접수|공모|참가/;
const RESCUE_NEVER = /용역|입찰\s*참가|채용|직원|근로자|위촉|공개\s*모집/;

/** 버릴 낱말이 있어도 「지원사업 + 모집」이면 살린다. */
export function isKotraRescued(title: string): boolean {
  // 낱말이 있어도 조달·채용 글이면 구제하지 않는다 — 「지원사업 운영 용역 입찰 참가 신청 공고」·「지원사업 담당 직원 채용 공고」(코덱스 지적 2026-09-03).
  if (RESCUE_NEVER.test(title)) return false;
  return RESCUE_SUBJECT.test(title) && RESCUE_ACTION.test(title);
}

export function isKotraDropTitle(title: string): boolean {
  if (isKotraRescued(title)) return false;
  return DROP.test(title);
}

/**
 * ★원문이 `<dl …>` 을 **`</dl>` 이 아니라 `<dl>` 로 닫는다**(실측: 한 쪽에 20군데).
 *
 * 그대로 파싱하면 첫 카드가 뒤의 아홉 장을 통째로 품어 버린다(실측: `cards[0]` 안에
 * `div.card` 가 9개). 그래도 「카드마다 첫 번째 값」만 집으면 우연히 결과는 맞지만,
 * **신청기간 칸이 없는 카드가 다음 카드의 신청기간을 집는** 조용한 오염이 남는다.
 * 그래서 읽기 전에 닫는 태그만 바로잡는다. 원문이 고쳐지면 이 치환은 그냥 안 걸린다.
 */
function repairStrayDl(html: string): string {
  return html.replace(/<dl>(\s*)<\/div>/g, "</dl>$1</div>");
}

/**
 * `dt` 이름으로 짝지어진 `dd` 값을 집는다 — **칸 단위로만** 읽는다.
 * 행 전체 글자에서 정규식으로 날짜를 찾으면 신청기간·개최기간 중 어느 쪽이 걸릴지
 * 순서 운에 맡기게 되고(런던 전시회는 개최가 2027년이다), 칸이 붙어 「712026-09-01」처럼
 * 깨지기도 한다(hsbiz 실측 함정).
 */
function cellByLabel(card: HTMLElement, label: string): string {
  for (const dl of card.querySelectorAll("dl")) {
    let current = "";
    for (const node of dl.childNodes as unknown as HTMLElement[]) {
      const tag = (node.rawTagName ?? "").toLowerCase();
      if (tag === "dt") current = node.text.replace(/\s+/g, " ").trim();
      else if (tag === "dd" && current === label) return node.text.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

export function parseKotraList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const card of parseHtml(repairStrayDl(html)).querySelectorAll("div.card")) {
    const a = card.querySelector("a.card-tit");
    // 상세 주소가 href 가 아니라 `fn_selectBizMntInfoDetailNew('…')` 문자열 안에 있다.
    // href·onclick 어느 쪽에 실려도 읽히게 둘 다 본다(원문은 지금 href 에 넣는다).
    const link = `${a?.getAttribute("href") ?? ""} ${a?.getAttribute("onclick") ?? ""}`;
    const bizNo = link.match(BIZ_NO)?.[1] ?? "";
    if (!bizNo || seen.has(bizNo)) continue;
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    // ★`DROP.test` 를 직접 부르지 않는다 — 구제 규칙을 지나쳐 「입찰 지원사업 참여기업 모집」이
    //   다시 죽는다. 시험이 재는 함수와 같은 길로 판정한다.
    if (!title || isKotraDropTitle(title)) continue;
    seen.add(bizNo);
    // 원문 href 는 `…selectBizMntInfoDetail.do?&dtlBizMntNo=…&cpbizYn=N`(물음표 뒤에 & 가 붙어 있다).
    // 그대로 쓰지 않고 정규 주소로 조립한다 — 열쇠(sourceId)가 원문 잔재나 쪽 번호로 갈리면
    // 같은 글이 쪽마다·회차마다 다른 줄로 저장된다.
    // `cpbizYn` 은 **Y 일 때만** 싣는다(위 주석 ★) — N 은 기본값이라 빼도 같은 화면이다.
    const cpbiz = link.match(CPBIZ)?.[1] ?? "N";
    // 「신청기간」 칸만 읽는다. 「개최기간」은 행사가 열리는 날이라 접수 마감과 다르다
    // (실측: 런던 교육장비 전시회 신청 2026-09-04 마감 / 개최 2027-01-20).
    const period = cellByLabel(card, "신청기간");
    const days = [...period.matchAll(YMD)].map(
      (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
    );
    const dateText = days.length >= 2 ? `${days[0]} ~ ${days[1]}` : days.length === 1 ? `${days[0]} ~` : "";
    out.push({
      title,
      detailUrl: `${DETAIL}?dtlBizMntNo=${bizNo}${cpbiz === "Y" ? "&cpbizYn=Y" : ""}`,
      dateText,
      // 사업유형 딱지(상담회·전시회·교육·마케팅…). 화면 분류에만 쓴다.
      category: (card.querySelector("span.card-badge")?.text ?? "").replace(/\s+/g, " ").trim(),
      /**
       * ★`주관부서`(소재부품장비팀·KOTRA아카데미·기획총괄실…)를 **agency 로 싣지 않는다.**
       * 그것은 KOTRA 안의 팀 이름이지 별개 기관이 아니다. 팀명을 기관으로 박으면
       * 중복 열쇠(제목|기관)가 팀마다 갈려, 기업마당에 「KOTRA」로 든 같은 공고와 안 묶이고
       * 목록에 두 줄로 뜬다.
       */
    });
  }
  return out;
}

export const kotraConfig: BoardConfig = {
  id: "kotra",
  label: "KOTRA 사업공고",
  agency: "KOTRA",
  /**
   * 지자체 위탁 사업(양주시·포천시…)이 섞여 있지만 지역을 그 시·군으로 못 박지 않는다 —
   * 그것은 「사업을 맡긴 곳」이지 「신청 자격 지역」이 아니고, 대부분은 전국 수출기업 대상이다.
   * 이 저장소의 우선순위는 「단 1건도 놓치지 않기」라 넓게 두는 쪽을 고른다(ccei 와 같은 판단).
   */
  region: "전국",
  baseUrl: `${BASE}/`,
  charset: "utf-8",
  list: {
    // POST 라 주소는 쪽과 무관하게 같다 — 쪽 번호도, 어느 목록인지도 init 의 본문이 나른다.
    url: () => LIST_AJAX,
    /**
     * 목록 둘 × 4쪽 = 8. 한 쪽에 100건이라 실측(기한 97 · 상시 74)은 1·2쪽에서 다 들어오고,
     * 3·4쪽이 0행이라 엔진이 거기서 멈춘다 — 상한은 사업이 늘어날 때를 위한 여유다.
     * ★8 밑으로 내리면 `deep-paging.test.ts` 의 「허용 목록은 실제로 깊이 판다」에 걸린다.
     */
    maxPages: 8,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      /**
       * ★`pageNo` 만 바꾸고 `startCount` 를 안 주면 **항상 1쪽이 돌아온다**(최초 삽질로 확인).
       * ★`query`·`collection`·`sch_biz_name` 은 빈 값이라도 **필드 자체가 있어야 한다** —
       *   빼면 500 이다(실측). 화면 폼(`searchDtlFrm`)을 그대로 직렬화한 모양이다.
       * ★`sch_appl_yn` 이 목록을 가른다 — `N`=기한사업 · `Y`=상시사업. 홀짝으로 번갈아 넣는다.
       */
      body: (() => {
        const t = kotraTargetOf(p);
        return [
          `pageNo=${t.page}`,
          `pageSize=${PER_PAGE}`,
          `listCount=${PER_PAGE}`,
          "query=",
          "collection=business_application",
          "sch_biz_name=",
          `sch_appl_yn=${t.applYn}`,
          "sch_nation_cd=Y",
          `startCount=${(t.page - 1) * PER_PAGE}`,
        ].join("&");
      })(),
    }),
    // customParse 가 읽는다. 선택자 갈래는 customParse 가 없을 때만 보는 값이라 실제 모양을 적어 둔다.
    rowSelector: "div.card",
    fields: {
      title: { selector: "a.card-tit" },
      detailUrl: { selector: "a.card-tit", attr: "href", regex: "dtlBizMntNo=([A-Za-z0-9]+)" },
      date: { selector: "dl.card-meta-data" },
      category: { selector: "span.card-badge" },
    },
  },
  customParse: parseKotraList,
  /**
   * 상세 본문 — 표(사업유형·모집회원구분·개최기간·신청기간·사업진행장소·주관부서·문의처)와
   * 사업설명을 함께 품은 칸이다(실측 591~770자, 표본 4건).
   *
   * ★`div.nBizCont` 만 집지 않는다 — 사업설명만 126~356자라 표의 사업유형·주관부서가 통째로 빠진다.
   * ★비워 두지도 않는다(ccei 는 비웠다). 여기 첨부표 링크는 `fileDown.do?storFileId=…` 꼴이라
   *   공용 첨부 수확기의 규칙(확장자·「download」)에 안 걸리고, 잡히는 건 본문 PDF 뿐인데
   *   그마저 **그림 한 장짜리 PDF**(실측 1쪽·193KB)라 글자가 안 나온다. 본문을 비워 두면
   *   「첨부에서 본문 뽑기」가 회차마다 그 그림 PDF 를 헛되이 내려받고 이 출처는 영영 빈칸으로 남는다.
   */
  detailContentSelector: "div.bizForm",
  /**
   * 첨부 범위는 **일부러 안 좁힌다.**
   * 첨부표(`div.nAddFileTable`)로 좁히면 수확 결과가 0건이다(위 이유). 범위를 안 주면
   * 상세 전체에서 공고문 PDF 직접 경로(`/upload/…/BM….pdf`, 실측 200·application/pdf)와
   * 뷰어 주소가 잡힌다. 표본 4건 모두 잡히는 링크는 이 둘뿐이라 머리글·바닥글 오염도 없다.
   */
  // attachmentsScopeSelector: (없음 — 위 주석 참고)
  /**
   * ★`dropUrlParams` 를 쓰지 않는다. 그 장치는 값을 가리지 않고 통째로 지워서
   * **Y 인 협업사업까지** 열쇠에서 떨어뜨린다(적대 리뷰 지적 ④). N 을 빼는 일은 값을 보는
   * customParse 가 한다. 선택자 단계로 내려가면 원문의 `cpbizYn=N` 이 열쇠에 남지만,
   * 그건 customParse 가 죽었을 때뿐이고 그 회차는 감시 장치가 따로 잡는다.
   */
  /**
   * ★50 — 여기만은 **높게** 둔다(다른 출처와 반대다).
   * 이유(2026-09-03 적대 리뷰 지적 ③): 우리는 `pageSize=100` 을 믿고 `startCount` 를 100씩
   * 건너뛴다. 서버가 언젠가 `pageSize` 를 무시하고 10건만 주면 2쪽부터 **90건씩 조용히 건너뛴다**
   * (그 구멍은 아무 데도 안 찍힌다). 첫 쪽이 10건뿐이면 여기서 **출처 전체가 실패**하게 만들어
   * 조용한 누락 대신 시끄러운 실패로 드러낸다.
   * ⚠️ 「응답 건수를 보고 다음 startCount 를 정하기」는 못 한다 — `list.init` 은 쪽 번호만 받는
   *    **순수 함수**라 앞 응답을 볼 수 없고(engine.selectorExtract), 모듈 변수로 기억하면
   *    회차·시험 사이에 값이 새어 순서에 따라 결과가 달라진다. 그래서 이 관문으로 막는다.
   * ★`skipHeuristic` 은 켜지 않는다 — 목록 행에 첨부 파일 링크가 없어 추측 단계가 쓰레기를
   *   낳지 않고(모든 링크가 `javascript:` 라 상세주소 검증에서 걸러진다), 구조가 바뀌면
   *   추측이 마지막 방어선이다(types.ts 주석).
   */
  // 서버가 pageSize=100 을 무시해 10건만 주면 startCount 가 90건씩 건너뛴다 — 10건 응답은 반드시 실패시키되(20>10),
  // 기한사업이 비수기에 줄어도 출처 전체가 죽지 않게 50 대신 20 (2026-09-03).
  expectMinRows: 20,
};
