import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { validateRows } from "../validate";
import { harvestBoardAttachments } from "../detail-fill";
import { isKotraDropTitle, parseKotraList, kotraConfig, kotraTargetOf, isKotraRescued } from "./kotra";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `selectBmBizRcritYListNewAjax.do` POST 응답 원문(pageSize=100).
 * · `kotra-list.html`    = 엔진 1쪽 = **기한사업**(`sch_appl_yn=N`) 97건
 * · `kotra-list-p2.html` = 엔진 2쪽 = **상시사업**(`sch_appl_yn=Y`) 74건
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kotra-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kotra-list-p2.html"), "utf-8");
/** 기한사업(엔진 1쪽). */
const rows = parseKotraList(listHtml);
/** 상시사업(엔진 2쪽). */
const rowsP2 = parseKotraList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("KOTRA 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("기한사업 목록(1쪽)을 한 번에 97건 읽고 첫 행이 맞다 — pageSize=100 이 실제로 먹는다", () => {
    expect(rows).toHaveLength(97);
    expect(rows[0]).toMatchObject({
      title: "2026 멕시코 경제사절단",
      detailUrl:
        "https://www.kotra.or.kr/subList/20000020753/subhome/bizAply/selectBizMntInfoDetail.do?dtlBizMntNo=26CN0O6",
      dateText: "2026-08-27 ~ 2026-09-03",
      category: "상담회",
    });
  });

  it("★날짜는 「신청기간」 칸이다 — 「개최기간」을 쓰면 이미 끝난 모집이 계속 열려 있다", () => {
    // 같은 카드 안에 두 기간이 나란히 있다. 행 전체 글자에서 정규식으로 첫 날짜를 집으면
    // 어느 쪽이 걸릴지 순서 운에 맡기게 된다 — dt/dd 칸 단위로만 읽는다.
    // 가장 센 증거: 런던 전시회는 개최가 **2027년**이다. 개최기간을 쓰면 2027년까지 모집중이 된다.
    const london = combined.find((r) => r.title.includes("런던 교육장비"))!;
    expect(london.dateText).toBe("2026-08-20 ~ 2026-09-04");
    expect(london.dateText).not.toContain("2027");
  });

  it("기한사업은 접수 시작일과 마감일을 둘 다 싣는다 — 97건 전부 「시작 ~ 끝」", () => {
    const bad = rows.filter((r) => !/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText));
    expect(bad.map((r) => `${r.title}=${r.dateText}`)).toEqual([]);
  });

  it("★상세 주소는 onclick 이 아니라 조립한 정규 주소다 — 쪽 번호·원문 잔재가 섞이지 않는다", () => {
    // 원문 href 는 `...selectBizMntInfoDetail.do?&dtlBizMntNo=…`(물음표 뒤에 & 가 붙어 있다).
    // 그대로 쓰면 같은 글이 쪽마다·회차마다 다른 열쇠로 저장될 수 있다.
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kotra\.or\.kr\/subList\/20000020753\/subhome\/bizAply\/selectBizMntInfoDetail\.do\?dtlBizMntNo=[A-Za-z0-9]+(?:&cpbizYn=Y)?$/,
      );
      expect(r.detailUrl).not.toContain("javascript:");
      expect(r.detailUrl).not.toMatch(/[?&](page|pageNo|startCount)=/);
    }
  });

  /**
   * ★`cpbizYn`(협업사업 여부)은 **N 이면 빼고 Y 면 남긴다**(2026-09-03 적대 리뷰 지적 ④).
   * · N: `?dtlBizMntNo=26RP004` 만으로 200 이고 `cpbizYn=N` 판과 **바이트까지 같다**(123,944).
   * · Y: 125,399바이트로 **내용이 다르다**(협업 하위 서비스 목록이 붙는다). 빼면 다른 화면을 읽는다.
   */
  it("★cpbizYn 은 Y 만 남기고 N 은 뺀다 — 협업사업 상세를 다른 화면으로 바꾸지 않는다", () => {
    const y = rowsP2.filter((r) => r.detailUrl.endsWith("&cpbizYn=Y"));
    // 고정본에 Y 인 줄이 실제로 3건 있다(없으면 이 시험은 아무것도 안 재는 글이다).
    expect(y).toHaveLength(3);
    expect(y.map((r) => r.detailUrl.split("do?")[1]).sort()).toEqual([
      "dtlBizMntNo=23MA002&cpbizYn=Y",
      "dtlBizMntNo=24RP01A&cpbizYn=Y",
      "dtlBizMntNo=26PC00R&cpbizYn=Y",
    ]);
    // N 인 줄은 값 없이 짧은 열쇠 하나로 통일된다.
    expect(combined.filter((r) => r.detailUrl.includes("cpbizYn=N"))).toHaveLength(0);
    expect(rows[0].detailUrl.endsWith("dtlBizMntNo=26CN0O6")).toBe(true);
    /**
     * ★`dropUrlParams` 로 지우면 안 된다 — 그 장치는 값을 가리지 않아 **Y 까지** 떨어뜨린다.
     */
    expect(kotraConfig.dropUrlParams).toBeUndefined();
  });

  it("기한 97 + 상시 74 를 합쳐도 상세 열쇠 중복이 0 — 두 목록은 겹치지 않는다", () => {
    expect(combined).toHaveLength(171);
    expect(new Set(combined.map((r) => r.detailUrl)).size).toBe(171);
  });

  /** ★2026-09-03 새로 켠 상시사업 목록(`sch_appl_yn=Y`) — 기한사업만 볼 때는 통째로 빠져 있었다. */
  it("상시사업 목록(2쪽) 74건을 읽고 첫 행이 맞다", () => {
    expect(rowsP2).toHaveLength(74);
    expect(rowsP2[0]).toMatchObject({
      title: "(수출24) 바이어 트래킹 서비스(BTS)",
      detailUrl:
        "https://www.kotra.or.kr/subList/20000020753/subhome/bizAply/selectBizMntInfoDetail.do?dtlBizMntNo=23RP040",
      dateText: "2023-09-06 ~",
      category: "시장조사 및 파트너 지원",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  /**
   * ★상시사업의 마감은 원문이 `9999-12-31`(무기한)로 준다. 그 글자는 날짜로 안 읽히므로
   * 「시작일 ~」 개시형으로 넘어간다 — 지어낸 마감일을 붙이지도, 오늘 날짜로 닫지도 않는다.
   */
  it("★무기한(9999-12-31) 마감은 개시형으로 넘긴다 — 날짜를 지어내지 않는다", () => {
    expect(listP2Html).toContain("9999-12-31");
    const bts = rowsP2.find((r) => r.title.includes("바이어 트래킹"))!;
    expect(bts.dateText).toBe("2023-09-06 ~");
    expect(bts.dateText).not.toContain("9999");
    // 무기한이 아닌 상시 줄은 그대로 「시작 ~ 끝」이다(47건).
    expect(rowsP2.filter((r) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText)).length).toBe(47);
  });

  it("★「설문」 낱말 하나로 상시 서비스를 버리지 않는다 — 수출24 시장조사 서비스가 죽던 자리", () => {
    expect(listP2Html).toContain("소비자 트렌드 설문 조사");
    expect(rowsP2.some((r) => r.title.includes("소비자 트렌드 설문 조사"))).toBe(true);
    expect(isKotraDropTitle("(수출24) 소비자 트렌드 설문 조사")).toBe(false);
    // 기관이 제 고객에게 묻는 설문은 그대로 버린다.
    expect(isKotraDropTitle("2026년 상반기 고객만족도 설문조사")).toBe(true);
    expect(isKotraDropTitle("수출기업 설문조사 참여 요청")).toBe(true);
  });

  it("★기관을 「주관부서」로 못 박지 않는다 — 부서명은 KOTRA 안의 팀 이름이다", () => {
    // 실측 주관부서: 「소재부품장비팀」·「KOTRA아카데미」·「기획총괄실」…
    // 이것을 agency 로 실으면 중복 열쇠(제목|기관)가 팀마다 갈려, 기업마당에 「KOTRA」로 든
    // 같은 공고와 안 묶이고 목록에 두 줄로 뜬다(부천 bizbc 에서 겪은 그 갈래의 반대 경우).
    expect(combined.every((r) => r.agency === undefined)).toBe(true);
    expect(kotraConfig.agency).toBe("KOTRA");
  });

  it("사업유형 딱지를 category 로 싣는다", () => {
    expect(rows.map((r) => r.category)).toContain("교육");
    expect(rows.map((r) => r.category)).toContain("전시회");
    expect(rowsP2.map((r) => r.category)).toContain("시장조사 및 파트너 지원");
    expect(combined.every((r) => (r.category ?? "").length > 0)).toBe(true);
  });

  it("DROP 은 「버릴 것만」 좁게 — 실측 171건은 한 건도 안 버린다", () => {
    expect(combined.every((r) => !isKotraDropTitle(r.title))).toBe(true);
    expect(isKotraDropTitle("2026년 사무용품 구매 입찰 공고")).toBe(true);
    expect(isKotraDropTitle("용역 제안서 평가위원 모집 공고")).toBe(true);
    expect(isKotraDropTitle("신규직원 채용 공고")).toBe(true);
    expect(isKotraDropTitle("2026년 상반기 고객만족도 설문조사")).toBe(true);
    expect(isKotraDropTitle("2026년 무역인턴 최종 합격자 발표")).toBe(true);
  });

  it("★「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isKotraDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isKotraDropTitle("2026 해외무역관 채용대행 서비스 신청기업 모집")).toBe(false);
  });

  it("제목·열쇠가 없는 카드는 버린다 — 빈 껍데기를 한 줄로 세지 않는다", () => {
    expect(parseKotraList('<div class="card"><div class="card-inner"></div></div>')).toEqual([]);
    expect(parseKotraList("차단 안내문")).toEqual([]);
  });

  it("같은 사업번호가 한 응답에 두 번 오면 한 줄만 남긴다", () => {
    const doubled = listHtml + listHtml;
    expect(parseKotraList(doubled)).toHaveLength(97);
  });
});

describe("KOTRA 설정", () => {
  it("쪽 번호는 주소가 아니라 POST 본문이 나른다 — 주소는 쪽과 무관하게 같다", () => {
    expect(kotraConfig.list.url(1)).toBe(kotraConfig.list.url(2));
    expect(kotraConfig.list.url(1)).toBe(
      "https://www.kotra.or.kr/module/subhome/bizAply/selectBmBizRcritYListNewAjax.do",
    );
    expect(kotraConfig.list.init?.(2)).toMatchObject({ method: "POST" });
  });

  it("★pageNo 와 startCount 를 함께 보낸다 — startCount 를 빼면 항상 1쪽이 돌아온다(실측)", () => {
    const b1 = kotraConfig.list.init!(1).body ?? "";
    const b5 = kotraConfig.list.init!(5).body ?? "";
    expect(b1).toContain("pageNo=1");
    expect(b1).toContain("startCount=0");
    // 5쪽 = 기한사업의 3쪽(홀수 = 기한) → pageNo=3 · startCount=200
    expect(b5).toContain("pageNo=3");
    expect(b5).toContain("startCount=200");
  });

  it("★빈 값이라도 필드 자체는 보낸다 — query·collection·sch_biz_name 이 없으면 500 이다(실측)", () => {
    const b = kotraConfig.list.init!(1).body ?? "";
    for (const k of ["query=", "collection=business_application", "sch_biz_name=", "pageSize=100", "listCount=100"]) {
      expect(b).toContain(k);
    }
  });

  /**
   * ★2026-09-03 「누락 0」 — 목록이 둘이다. 홀수 쪽 = 기한사업(N) · 짝수 쪽 = 상시사업(Y).
   * 한 목록을 몰아 읽으면 그 목록이 바닥난 자리에서 「신규 0인 쪽 연속 둘」 규칙에 걸려
   * 뒤 목록을 통째로 잃는다(kita 에서 겪은 그 갈래).
   */
  it("두 목록을 번갈아 부른다 — 쪽 번호 → 목록·쪽 사상", () => {
    const table: Array<[number, string, string, number]> = [
      [1, "N", "기한사업", 1], [2, "Y", "상시사업", 1],
      [3, "N", "기한사업", 2], [4, "Y", "상시사업", 2],
      [7, "N", "기한사업", 4], [8, "Y", "상시사업", 4],
    ];
    for (const [p, applYn, kind, page] of table) {
      expect({ p, ...kotraTargetOf(p) }).toMatchObject({ p, applYn, kind, page });
      expect(kotraConfig.list.init!(p).body).toContain(`sch_appl_yn=${applYn}`);
      expect(kotraConfig.list.init!(p).body).toContain(`pageNo=${page}`);
    }
  });

  it("상한 8쪽 안에 두 목록이 각각 4쪽씩 들어간다 — 한 쪽 100건이라 실측 171건은 1·2쪽에서 끝난다", () => {
    expect(kotraConfig.list.maxPages).toBe(8);
    const kinds = new Set<string>();
    for (let p = 1; p <= kotraConfig.list.maxPages; p++) kinds.add(kotraTargetOf(p).kind);
    expect([...kinds]).toEqual(["기한사업", "상시사업"]);
    expect(kotraTargetOf(8).page * 100).toBeGreaterThanOrEqual(97);
  });

  /**
   * ★엔진은 쪽 번호 변수를 `init` 본문의 「달라지는 열쇠」로 알아낸다(pagingParamsOf).
   * 깊이 파는 게시판이 그걸 못 찾으면 상세 주소의 쪽 번호를 못 지운다(deep-paging.test).
   */
  it("★쪽마다 본문이 실제로 달라진다 — 엔진이 쪽 변수를 찾아낼 수 있다", () => {
    const b1 = new URLSearchParams(kotraConfig.list.init!(1).body ?? "");
    const b2 = new URLSearchParams(kotraConfig.list.init!(2).body ?? "");
    const moving = [...b1.keys()].filter((k) => b2.has(k) && b1.get(k) !== b2.get(k));
    expect(moving).toEqual(["sch_appl_yn"]);
    expect(kotraConfig.list.url(1)).toBe(kotraConfig.list.url(2));
  });

  /**
   * ★`startCount` 를 100씩 건너뛰는 설계의 안전장치(2026-09-03 적대 리뷰 지적 ③).
   * 서버가 `pageSize=100` 을 무시하고 10건만 주면 2쪽부터 **90건씩 조용히 건너뛴다.**
   * 그래서 첫 쪽이 10건뿐이면 출처 전체가 **실패**하도록 문턱을 50으로 올렸다 —
   * 조용한 누락 대신 시끄러운 실패로 드러낸다.
   */
  it("★한 쪽에 10건만 오면 출처 전체가 실패한다 — 90건씩 건너뛰는 걸 조용히 두지 않는다", () => {
    expect(kotraConfig.expectMinRows).toBe(20);
    const ctx = { expectMinRows: kotraConfig.expectMinRows, prevCount: 0 };
    // pageSize 가 무시된 모양(10건)
    const short = validateRows(rows.slice(0, 10), ctx);
    expect(short.ok).toBe(false);
    expect(short.reason).toContain("기대");
    // 실제 응답(97건·74건)은 그대로 통과한다.
    expect(validateRows(rows, ctx).ok).toBe(true);
    expect(validateRows(rowsP2, ctx).ok).toBe(true);
  });

  it("id·이름·지역이 맞고 상세 호스트가 baseUrl 과 같아 허용 호스트 검사를 통과한다", () => {
    expect(kotraConfig.id).toBe("kotra");
    expect(kotraConfig.label).toBe("KOTRA 사업공고");
    expect(kotraConfig.region).toBe("전국");
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(kotraConfig.baseUrl).host);
  });

  it("heuristic 을 끄지 않는다 — 목록 행에 첨부 링크가 없어 추측이 쓰레기를 낳지 않는다", () => {
    expect(kotraConfig.skipHeuristic).toBeUndefined();
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseKotraList(listHtml.replaceAll('class="card"', 'class="card-x"'))).toHaveLength(0);
  });

  it("제목 칸(a.card-tit)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKotraList(listHtml.replaceAll('class="card-tit"', 'class="card-tit-x"'))).toHaveLength(0);
  });

  it("사업번호가 사라지면 그 줄을 버린다(주소를 지어내지 않는다)", () => {
    expect(parseKotraList(listHtml.replaceAll("dtlBizMntNo=", "dtlBizMntNoX="))).toHaveLength(0);
  });

  it("★신청기간 칸 이름이 바뀌면 날짜를 **비운다**(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseKotraList(listHtml.replaceAll("<dt>신청기간</dt>", "<dt>신청기간X</dt>"));
    expect(broken).toHaveLength(97);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });

  it("★첫 카드의 신청기간 칸 **하나만** 없애도 옆 카드 날짜를 훔쳐오지 않는다 — 닫는 태그 고치기가 실제로 일한다", () => {
    // 원문은 `<dl …>` 을 `</dl>` 이 아니라 `<dl>` 로 닫는다(한 쪽에 20군데). 고치지 않고 파싱하면
    // 첫 카드가 나머지 아홉 장을 통째로 품어, 칸이 없는 카드가 **다음 카드의 신청기간**을 집는다.
    // 실측(닫는 태그 안 고쳤을 때): 1행이 2행의 「2026-08-18 ~ 2026-09-02」을 그대로 가져갔다.
    const oneCellGone = listHtml.replace("<dt>신청기간</dt>", "<dt>신청기간X</dt>");
    const broken = parseKotraList(oneCellGone);
    expect(broken).toHaveLength(97);
    expect(broken[0].dateText).toBe("");
    expect(broken[0].dateText).not.toBe(rows[1].dateText);
    // 나머지 아홉 줄은 제 날짜를 그대로 지킨다.
    expect(broken.slice(1).map((r) => r.dateText)).toEqual(rows.slice(1).map((r) => r.dateText));
  });

  it("사업유형 딱지가 사라지면 분류를 비운다", () => {
    const broken = parseKotraList(listHtml.replaceAll('class="card-badge"', 'class="card-badge-x"'));
    expect(broken).toHaveLength(97);
    expect(broken.every((r) => r.category === "")).toBe(true);
  });
});

/** ★상세 본문·첨부 자리 — 고정본 `selectBizMntInfoDetail.do?dtlBizMntNo=26CN0O6` 으로 잰다. */
describe("상세 본문·첨부 자리", () => {
  const detail = readFileSync(join(__dirname, "../__fixtures__/kotra-detail.html"), "utf-8");
  const doc = parseHtml(detail);

  it("본문 선택자가 상세표와 사업설명을 함께 집는다", () => {
    expect(kotraConfig.detailContentSelector).toBe("div.bizForm");
    const body = doc.querySelectorAll(kotraConfig.detailContentSelector!);
    expect(body).toHaveLength(1);
    const text = body[0].text.replace(/\s+/g, " ").trim();
    expect(text.length).toBeGreaterThan(400);
    expect(text).toContain("사업유형");
    expect(text).toContain("신청기간");
    expect(text).toContain("주관부서");
  });

  it("★첨부 범위를 좁히지 않는다 — 첨부표 링크는 공용 수확기가 못 보는 fileDown.do 꼴이다", () => {
    expect(kotraConfig.attachmentsScopeSelector).toBeUndefined();
    // 증거 ①: 첨부표 안 링크는 확장자도 「download」도 없어 수확기 규칙에 안 걸린다 → 0건.
    const scope = doc.querySelectorAll("div.nAddFileTable").map((el) => el.outerHTML).join("\n");
    expect(scope).toContain("fileDown.do");
    expect(harvestBoardAttachments(scope, kotraConfig.baseUrl)).toEqual([]);
    // 증거 ②: 범위를 안 주면 상세 전체에서 공고문 PDF 직접 경로가 잡힌다.
    const whole = harvestBoardAttachments(detail, kotraConfig.baseUrl);
    expect(whole.length).toBeGreaterThan(0);
    expect(whole.some((a) => /^https:\/\/www\.kotra\.or\.kr\/upload\/.+\.pdf$/.test(a.url))).toBe(true);
  });
});

/** ★2026-09-03 적대 리뷰 지적 ⑦ — 거르개가 진짜 모집 공고를 죽이던 자리. */
describe("거르개가 진짜 모집 공고를 죽이지 않는다", () => {
  it("★버릴 낱말이 사업 이름 안에 든 모집 공고는 살린다", () => {
    expect(isKotraDropTitle("해외 공공조달 입찰 지원사업 참여기업 모집")).toBe(false);
    expect(isKotraDropTitle("만족도 조사 지원사업 신청기업 모집")).toBe(false);
    expect(isKotraDropTitle("(수출24) 소비자 트렌드 설문 조사")).toBe(false);
  });

  it("★기관이 제 고객에게 묻는 설문은 그대로 버린다 — 「응답 요청」도 잡는다", () => {
    expect(isKotraDropTitle("고객 설문조사 응답 요청")).toBe(true);
    expect(isKotraDropTitle("2026년 상반기 고객만족도 설문조사")).toBe(true);
    expect(isKotraDropTitle("수출기업 설문조사 참여 협조 안내")).toBe(true);
  });

  it("사업 표식이 없으면 그대로 버린다 — 구제 규칙이 거르개를 무력화하지 않는다", () => {
    expect(isKotraDropTitle("2026년 사무용품 구매 입찰 공고")).toBe(true);
    expect(isKotraDropTitle("용역 제안서 평가위원 모집 공고")).toBe(true);
    expect(isKotraDropTitle("신규직원 채용 공고")).toBe(true);
  });

  it("파서도 같은 길로 판정한다 — 고정본 행 수가 안 흔들린다", () => {
    expect(rows).toHaveLength(97);
    expect(rowsP2).toHaveLength(74);
  });
});

describe("구제 규칙은 조달·채용 글을 살리지 않는다(코덱스 지적 2026-09-03)", () => {
  it("낱말이 겹쳐도 용역·입찰 참가·채용 글은 구제되지 않고, 진짜 지원사업은 구제된다", () => {
    expect(isKotraRescued("지원사업 운영 용역 입찰 참가 신청 공고")).toBe(false);
    expect(isKotraRescued("지원사업 담당 직원 채용 공고 접수 안내")).toBe(false);
    expect(isKotraRescued("2026 해외 공공조달 입찰 지원사업 참여기업 모집")).toBe(true);
    expect(isKotraRescued("소비자 설문 조사 지원사업 신청기업 모집")).toBe(true);
  });
});
