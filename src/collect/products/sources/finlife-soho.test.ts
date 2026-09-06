import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML/JSON 대신 **실사이트 고정본**으로 잰다(2026-09-03 10:20 실측,
 * `https://finlife.fss.or.kr/finlife/ldng/indvlBusi/list.do`) — 지어낸 데이터는 선택자·필드명
 * 오타를 그냥 통과시킨다. 목록 고정본은 국민은행 상품 5건(전체 876행 중 첫 페이지), 상세 고정본은
 * 그중 1번째 행(사장님+ 마이너스통장)의 실제 상세 응답이다.
 */
const listHtml = readFileSync(
  join(__dirname, "../__fixtures__/finlife-list-5rows.html"),
  "utf-8",
);
const detailJsonText = readFileSync(
  join(__dirname, "../__fixtures__/finlife-detail.json"),
  "utf-8",
);
const detailFixture = (JSON.parse(detailJsonText) as { resultZvl: Record<string, unknown> }).resultZvl;

vi.mock("../fetch", () => ({ fetchProductText: vi.fn(), fetchProductWithCookies: vi.fn() }));

import { fetchProductText, fetchProductWithCookies } from "../fetch";
import {
  DETAIL_URL,
  LIST_URL,
  fetchFinlifeDetail,
  fetchFinlifeListRows,
  fetchFinlifeSohoAll,
  finlifeSohoSource,
  mergeFinlifeDetail,
  parseFinlifeList,
  type FinlifeListRow,
} from "./finlife-soho";

const rows = parseFinlifeList(listHtml);

/**
 * listHtml(5건 고정본)의 실제 행(tr.onOffTr)을 반복해 n건짜리 목록 HTML을 만든다 — 상세 실패
 * 「비율」 방어선은 5건 고정본만으로는 20% 단위(1/5)밖에 못 만들어, 10%(1/10) 같은 경계 아래
 * 시나리오를 실사이트 행 내용 그대로 늘려서 검증한다(코덱스 지적 시험 전용, 실제 수집 경로는 안 씀).
 */
function listHtmlWithRowCount(n: number): string {
  const bodyMatch = listHtml.match(/<tbody>([\s\S]*)<\/tbody>/);
  if (!bodyMatch) throw new Error("finlife-list-5rows.html 구조가 바뀌었다 — <tbody> 를 못 찾음");
  const rowBlocks = bodyMatch[1].match(/<tr class="onOffTr"[\s\S]*?<\/tr>/g);
  if (!rowBlocks || rowBlocks.length === 0) throw new Error("finlife-list-5rows.html 에서 행을 못 찾음");
  const picked: string[] = [];
  for (let i = 0; i < n; i++) picked.push(rowBlocks[i % rowBlocks.length]);
  return listHtml.replace(bodyMatch[0], `<tbody>${picked.join("")}</tbody>`);
}

function makeRow(overrides: Partial<FinlifeListRow> = {}): FinlifeListRow {
  return {
    finPrdtNm: "테스트상품",
    finCoNo: "9999999",
    dclsMonth: "202609",
    finPrdtCd: "TESTCD001",
    institution: "국민은행",
    prdtUrl: "https://example.test/product",
    useWay: "일반",
    joinDeny: "제한없음",
    loanType: "신용대출",
    rateType: "변동금리",
    repay: "만기일시상환",
    avgRateText: "1.00%",
    hompUrl: "https://example.test",
    tel: "1234",
    ...overrides,
  };
}

describe("parseFinlifeList — 목록 5건 실사이트 고정본(tr.onOffTr)", () => {
  it("5건을 읽고, 첫 행(사장님+ 마이너스통장)은 계획서가 요구하는 모양 그대로다", () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      finPrdtNm: "사장님+ 마이너스통장",
      finCoNo: "0010927",
      dclsMonth: "202608",
      finPrdtCd: "2532P0200151",
      institution: "국민은행",
      prdtUrl: "https://obiz.kbstar.com/quics?page=C016280",
      useWay: "일반",
      joinDeny: "제한없음",
      loanType: "신용대출",
      rateType: "변동금리",
      repay: "만기일시상환",
      hompUrl: "http://www.kbstar.com",
      tel: "15889999",
    });
  });

  it("5건 모두 국민은행·같은 홈페이지·같은 대표번호지만 상품명·가입대상은 행마다 다르다", () => {
    expect(rows.every((r) => r.institution === "국민은행")).toBe(true);
    expect(rows.every((r) => r.hompUrl === "http://www.kbstar.com")).toBe(true);
    expect(rows.every((r) => r.tel === "15889999")).toBe(true);
    expect(new Set(rows.map((r) => r.finPrdtNm)).size).toBe(5);
    expect(rows.some((r) => r.joinDeny === "온라인셀러")).toBe(true);
    expect(rows.some((r) => r.joinDeny === "제한없음")).toBe(true);
  });

  it("평균금리(td 9번째) 를 avgRateText 로 담아 둔다 — 상세 실패 때 정직한 대체값의 재료", () => {
    expect(rows[0].avgRateText).toBe("0.04%");
    expect(rows[4].avgRateText).toBe("0.08%");
  });

  it("★필수 식별자(data-finPrdtCd 등)가 없는 행은 건너뛴다 — 반쪽 행을 상품으로 만들지 않는다", () => {
    const broken = listHtml.replace(
      'data-finPrdtCd="2532P0200151"',
      'data-finPrdtCd=""',
    );
    expect(parseFinlifeList(broken)).toHaveLength(4);
  });

  it("★칸 구조가 바뀌어 td 가 10개 미만인 행은 건너뛴다", () => {
    // 첫 행에서만 칸 2개(자금용도·가입대상)를 지워 9개로 — 그 행만 빠지고 나머지 4건은 그대로.
    const broken = listHtml.replace(/<td>일반<\/td>\s*<td>제한없음<\/td>/, "");
    expect(parseFinlifeList(broken)).toHaveLength(4);
  });

  it("행이 하나도 없으면 빈 배열(지어내지 않는다)", () => {
    expect(parseFinlifeList("<html><body>결과 없음</body></html>")).toEqual([]);
  });
});

describe("mergeFinlifeDetail — 목록+상세 합치기(실사이트 고정본, 계획서 Task 10 지정 값)", () => {
  it("상세가 있으면 계획서가 못박은 값 그대로 NormalizedProduct 를 만든다", () => {
    const product = mergeFinlifeDetail(rows[0], detailFixture);
    expect(product).toMatchObject({
      source: "product-finlife-soho",
      sourceId: "0010927|2532P0200151",
      institution: "국민은행",
      institutionType: "bank",
      fundingGroup: "bank",
      productType: "overdraft", // 이름에 마이너스통장
      limitText: "최대 1억원",
      limitMaxWon: 100_000_000,
      rateText: "연 3.61%~8.94%",
      rateMin: 3.61,
      rateMax: 8.94,
      termText: "1년 (최장 5년까지 1년단위 연장)",
      targetText: "카드사 가맹대금을 KB계좌로 입금받는 개인사업자",
      channel: "스마트폰",
      applyUrl: "https://obiz.kbstar.com/quics?page=C016280",
      detailUrl: "https://finlife.fss.or.kr/finlife/ldng/indvlBusi/list.do?menuNo=700072",
      deadlineText: "상시",
      targetRules: { isCorporation: false },
    });
  });

  it("신용등급 구간 금리(val1Grad1~3)·신용평가사(cbName) 를 raw 에 보존한다", () => {
    const product = mergeFinlifeDetail(rows[0], detailFixture);
    expect(product.raw).toMatchObject({
      val1Grad1: "4.53",
      val1Grad2: "5.33",
      val1Grad3: "6.61",
      cbName: "KCB,NICE",
    });
  });

  it("★실사이트 실측(2026-09-03)에서 확인된 값 — limitText 안의 <br> 도 nbsp 처럼 공백으로 푼다", () => {
    // 실측: "KB매출더하기론" 상세가 "…합계액 이내&nbsp;<br>&nbsp;※ 1개월…" 형태로 <br> 를 그대로 심어 준다.
    const detail = {
      ...detailFixture,
      loanLimitDetl: "차주가&nbsp;이용신청한&nbsp;한도&nbsp;이내<br>※&nbsp;단서조항",
    };
    const product = mergeFinlifeDetail(rows[0], detail);
    expect(product.limitText).toBe("차주가 이용신청한 한도 이내 ※ 단서조항");
    expect(product.limitText).not.toContain("<br>");
  });

  it("detailUrl 은 상세 URL(ujson)이 아니라 목록 화면 주소로 고정된다", () => {
    const product = mergeFinlifeDetail(rows[0], detailFixture);
    expect(product.detailUrl).toBe(LIST_URL);
    expect(product.detailUrl).not.toContain("selectOneIndvlBusi");
  });

  describe("상세 조회 실패 — 목록 값만으로 정직하게(값을 지어내지 않는다)", () => {
    it("limitText 는 빈 값, rateText 는 목록 평균금리로 「평균 N%」, rateMin/Max 는 null", () => {
      const product = mergeFinlifeDetail(rows[0], null);
      expect(product.limitText).toBe("");
      expect(product.limitMaxWon).toBeNull();
      expect(product.rateText).toBe("평균 0.04%");
      expect(product.rateMin).toBeNull();
      expect(product.rateMax).toBeNull();
    });

    it("그래도 출처·기관·갈래·법인여부 조건·신청주소는 목록 값으로 채워진다", () => {
      const product = mergeFinlifeDetail(rows[0], null);
      expect(product.source).toBe("product-finlife-soho");
      expect(product.sourceId).toBe("0010927|2532P0200151");
      expect(product.fundingGroup).toBe("bank");
      expect(product.targetRules).toEqual({ isCorporation: false });
      expect(product.applyUrl).toBe("https://obiz.kbstar.com/quics?page=C016280");
    });

    // ★상세 실패분 보존(설계 2026-09-03 §3 개정, 코덱스 지적): 이 빈 값들이 저장소(product-store)로
    // 그대로 올라가면 기존에 있던 한도·금리를 빈 값으로 덮어써 버린다 — keepExisting 표식을 붙여
    // 저장소가 "본 것"으로만 처리하고 기존 칸을 지키게 한다.
    it("★keepExisting:true 를 붙인다 — 저장 단계가 기존 한도·금리를 빈 값으로 안 덮도록", () => {
      const product = mergeFinlifeDetail(rows[0], null);
      expect(product.keepExisting).toBe(true);
    });
  });

  it("상세가 있으면 keepExisting 을 안 붙인다 — 정상 값이라 갱신해도 된다", () => {
    const product = mergeFinlifeDetail(rows[0], detailFixture);
    expect(product.keepExisting).toBeUndefined();
  });

  describe("기관 형태 분류 — institutionType(계획서 지정: 저축은행/캐피탈·커머셜/인터넷은행/그 밖 은행)", () => {
    it.each([
      ["SBI저축은행", "savings-bank"],
      ["OK저축은행", "savings-bank"],
      ["현대캐피탈", "capital"],
      ["롯데커머셜", "capital"],
      ["케이뱅크", "internet-bank"],
      ["카카오뱅크", "internet-bank"],
      ["토스뱅크", "internet-bank"],
      ["국민은행", "bank"],
      ["신한은행", "bank"],
    ] as const)("%s → %s", (institution, expected) => {
      const product = mergeFinlifeDetail(makeRow({ institution }), null);
      expect(product.institutionType).toBe(expected);
      expect(product.fundingGroup).toBe("bank"); // 은행 계열은 전부 fundingGroup=bank(BANK_TYPES)
    });
  });

  describe("상품 형태 분류 — productType(계획서 지정 우선순위: 이름의 마이너스통장 > 신용대출 > 담보 > 보증)", () => {
    it.each([
      ["마이너스통장 상품명", "신용대출", "overdraft"],
      ["일반 대출상품", "신용대출", "credit"],
      ["일반 대출상품", "담보대출", "secured"],
      ["일반 대출상품", "보증대출", "guarantee-backed"],
      ["일반 대출상품", "담보대출, 보증대출, 신용대출", "credit"], // 신용대출이 섞이면 credit 우선
      ["일반 대출상품", "담보대출, 보증대출", "secured"], // 신용 없이 담보+보증이면 담보 우선
      ["일반 대출상품", "전세자금대출", ""], // 아무 키워드도 없으면 빈 값(지어내지 않는다)
    ] as const)("이름 %s · 대출종류 %s → %s", (finPrdtNm, loanType, expected) => {
      const product = mergeFinlifeDetail(makeRow({ finPrdtNm, loanType }), null);
      expect(product.productType).toBe(expected);
    });
  });
});

let fetchTextMock: ReturnType<typeof vi.fn>;
let fetchCookiesMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchTextMock = vi.mocked(fetchProductText);
  fetchCookiesMock = vi.mocked(fetchProductWithCookies);
  fetchTextMock.mockReset();
  fetchCookiesMock.mockReset();
});
afterEach(() => {
  fetchTextMock.mockReset();
  fetchCookiesMock.mockReset();
});

describe("fetchFinlifeListRows — ① GET 쿠키 → ② 같은 쿠키+Referer 로 POST 폼(계획서 Task 10 FORM)", () => {
  it("쿠키를 먼저 받고, 그 쿠키·Referer 를 실어 목록 POST 를 보낸다", async () => {
    fetchCookiesMock.mockResolvedValue({ text: "<html>빈 쉘</html>", cookie: "WMONID=abc123" });
    fetchTextMock.mockResolvedValue(listHtml);

    const { rows: out, cookie } = await fetchFinlifeListRows();

    expect(cookie).toBe("WMONID=abc123");
    expect(out).toHaveLength(5);

    expect(fetchCookiesMock).toHaveBeenCalledTimes(1);
    const [cfg1, url1] = fetchCookiesMock.mock.calls[0];
    expect(cfg1).toMatchObject({ id: "product-finlife-soho", baseUrl: "https://finlife.fss.or.kr" });
    expect(url1).toBe(LIST_URL);

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    const [cfg2, url2, init2, limits2] = fetchTextMock.mock.calls[0] as [
      unknown,
      string,
      { method: string; headers: Record<string, string>; body: string },
      { timeoutMs: number; maxBytes: number },
    ];
    expect(cfg2).toMatchObject({ id: "product-finlife-soho" });
    expect(url2).toBe(LIST_URL);
    expect(init2.method).toBe("POST");
    expect(init2.headers.Cookie).toBe("WMONID=abc123");
    expect(init2.headers.Referer).toBe(LIST_URL);
    expect(init2.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(limits2).toEqual({ timeoutMs: 60_000, maxBytes: 4_000_000 });

    // 계획서 Task 10 FORM 글자 그대로 — areaType 만 01~17 전 지역으로 채운 값(계획서 표의 "01,…,17").
    expect(init2.body).toBe(
      "pageType=ajax&menuNo=700072&pageIndex=1&pageSize=1000&pageUnit=1000&useWay=1,2,3,4,5,9&finPrdtType=1" +
        "&joinDeny=1,2,3,4,5,6,7,8&loanLimit=1,2,3,4,5,6&loanType=1,2,3&lendRateType=1,2&rpayType=1,2,3,4" +
        "&areaType=01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17" +
        "&topFinGrpNo=020000,030200,030300,050000&joinWay=1,2,3,4,5,9&menuId=2000152" +
        "&BLTN_ID=BB000000000000000134",
    );
  });

  it("응답에 행이 하나도 없으면(개편) 빈 배열을 그대로 돌려준다 — 임계값 판단은 호출자(fetchFinlifeSohoAll) 몫", () => {
    fetchCookiesMock.mockResolvedValue({ text: "", cookie: "" });
    fetchTextMock.mockResolvedValue("<html>결과 없음</html>");
    return expect(fetchFinlifeListRows()).resolves.toEqual({ rows: [], cookie: "" });
  });
});

describe("fetchFinlifeDetail — 행 하나의 상세(selectOneIndvlBusi.ujson)", () => {
  it("dclsMonth·finCoNo·finPrdtCd·finPrdtType=1 을 폼으로 실어 보내고 resultZvl 을 돌려준다", async () => {
    fetchTextMock.mockResolvedValue(detailJsonText);

    const detail = await fetchFinlifeDetail(rows[0], "WMONID=abc123");

    expect(detail).toMatchObject({ loanLimitDetl: "최대&nbsp;1억원", lendRateMin: "3.61" });
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    const [cfg, url, init] = fetchTextMock.mock.calls[0] as [
      unknown,
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(cfg).toMatchObject({ id: "product-finlife-soho" });
    expect(url).toBe(DETAIL_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Cookie).toBe("WMONID=abc123");
    expect(init.headers.Referer).toBe(LIST_URL);
    expect(init.body).toBe("dclsMonth=202608&finCoNo=0010927&finPrdtCd=2532P0200151&finPrdtType=1");
  });

  it("★네트워크 오류는 던지지 않고 null 로 — 실패 건은 목록 값만으로 살아남는다", async () => {
    fetchTextMock.mockRejectedValue(new Error("HTTP 500"));
    await expect(fetchFinlifeDetail(rows[0], "cookie")).resolves.toBeNull();
  });

  it("★JSON 이 깨지거나 resultZvl 이 없어도 null(지어내지 않는다)", async () => {
    fetchTextMock.mockResolvedValueOnce("이 페이지를 표시할 수 없습니다");
    await expect(fetchFinlifeDetail(rows[0], "cookie")).resolves.toBeNull();
    fetchTextMock.mockResolvedValueOnce('{"ok":true}');
    await expect(fetchFinlifeDetail(rows[0], "cookie")).resolves.toBeNull();
  });
});

describe("fetchFinlifeSohoAll — 조립: 목록 → (동시 4·건 사이 150ms) 상세 병합", () => {
  it("★목록이 500건 미만이면(기본 임계값) 반쪽 응답으로 보고 던진다 — 실제 고정본(5건)으로 방어선을 확인", async () => {
    fetchCookiesMock.mockResolvedValue({ text: "", cookie: "WMONID=abc" });
    fetchTextMock.mockResolvedValue(listHtml); // 실사이트 고정본 = 5건뿐
    await expect(fetchFinlifeSohoAll()).rejects.toThrow();
  });

  it("성공 경로: 5건 전부 상세를 합쳐 NormalizedProduct 5건을 돌려준다(시험은 임계값·속도만 완화)", async () => {
    fetchCookiesMock.mockResolvedValue({ text: "", cookie: "WMONID=abc" });
    fetchTextMock.mockImplementation(async (_cfg, url) => {
      if (url === LIST_URL) return listHtml;
      if (url === DETAIL_URL) return detailJsonText;
      throw new Error(`예상 못 한 주소: ${url}`);
    });

    const list = await fetchFinlifeSohoAll({ minRows: 3, concurrency: 2, staggerMs: 0 });

    expect(list).toHaveLength(5);
    expect(list.every((p) => p.source === "product-finlife-soho")).toBe(true);
    expect(list.every((p) => p.fundingGroup === "bank")).toBe(true);
    // 상세 POST 는 행마다 한 번씩(목록 1회 + 상세 5회 = fetchProductText 6회)
    expect(fetchTextMock).toHaveBeenCalledTimes(6);
  });

  it("일부 행의 상세 조회가 실패해도 전체가 죽지 않고, 그 행만 목록 값 대체가 적용된다", async () => {
    fetchCookiesMock.mockResolvedValue({ text: "", cookie: "WMONID=abc" });
    let detailCalls = 0;
    fetchTextMock.mockImplementation(async (_cfg, url) => {
      if (url === LIST_URL) return listHtml;
      if (url === DETAIL_URL) {
        detailCalls += 1;
        if (detailCalls === 1) throw new Error("타임아웃");
        return detailJsonText;
      }
      throw new Error(`예상 못 한 주소: ${url}`);
    });

    const list = await fetchFinlifeSohoAll({ minRows: 3, concurrency: 2, staggerMs: 0 });

    expect(list).toHaveLength(5);
    const failed = list.find((p) => p.rateText.startsWith("평균"));
    expect(failed).toBeDefined();
    expect(failed?.limitText).toBe("");
  });

  it("★상세 조회가 전부(100%) 실패하면 던진다 — 한도·금리를 빈 값으로 덮은 반쪽 상품 5건을 저장하지 않는다(코덱스 지적)", async () => {
    fetchCookiesMock.mockResolvedValue({ text: "", cookie: "WMONID=abc" });
    fetchTextMock.mockImplementation(async (_cfg, url) => {
      if (url === LIST_URL) return listHtml;
      if (url === DETAIL_URL) throw new Error("타임아웃");
      throw new Error(`예상 못 한 주소: ${url}`);
    });

    const promise = fetchFinlifeSohoAll({ minRows: 3, concurrency: 2, staggerMs: 0 });
    promise.catch(() => {}); // unhandled rejection 경고 방지(아래서 await 로 실제 처리)
    // 메시지에 실패 건수·비율이 담긴다.
    await expect(promise).rejects.toThrow(/5\/5건/);
    await expect(promise).rejects.toThrow(/100%/);
  });

  it("상세 실패가 10%(20% 경계 미만)면 던지지 않고 반환한다 — 실패한 1건만 목록 값 대체", async () => {
    fetchCookiesMock.mockResolvedValue({ text: "", cookie: "WMONID=abc" });
    const tenRowHtml = listHtmlWithRowCount(10);
    let detailCalls = 0;
    fetchTextMock.mockImplementation(async (_cfg, url) => {
      if (url === LIST_URL) return tenRowHtml;
      if (url === DETAIL_URL) {
        detailCalls += 1;
        if (detailCalls === 1) throw new Error("타임아웃"); // 10건 중 1건 실패 = 10%
        return detailJsonText;
      }
      throw new Error(`예상 못 한 주소: ${url}`);
    });

    // concurrency 1 로 처리 순서를 고정해, 실패가 정확히 1건만 나오게 한다.
    const list = await fetchFinlifeSohoAll({ minRows: 3, concurrency: 1, staggerMs: 0 });

    expect(list).toHaveLength(10);
    const failedRows = list.filter((p) => p.rateText.startsWith("평균"));
    expect(failedRows).toHaveLength(1);
  });
});

describe("finlifeSohoSource — 명부에 실릴 모양(공통 계약: 접두어 product-)", () => {
  it("id·라벨·주소·fetchAll 이 계획대로다", () => {
    expect(finlifeSohoSource.id).toBe("product-finlife-soho");
    expect(finlifeSohoSource.label).toContain("금감원");
    expect(finlifeSohoSource.url).toBe(LIST_URL);
    expect(finlifeSohoSource.fetchAll).toBe(fetchFinlifeSohoAll);
  });
});
