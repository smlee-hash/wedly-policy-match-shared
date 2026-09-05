import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildFundingMap as buildWithLoaders,
  PRODUCT_SELECT,
  type BuildFundingMapOptions,
  type FundingMapLoaders,
} from "./funding-map-build";
import type { BusinessProfile } from "../engine/match-engine";
import { usedProfileSummary } from "../engine/profile-summary";
import type { FundingGroup } from "../funding/funding-group";
import type { FundingItem } from "../funding/funding-map";
import { MANUAL_PRODUCTS } from "../funding/products/sources/manual";

/**
 * 흉내 낸 자료 읽기 — ERP 에서는 `vi.mock("./open-announcements")` 와 `vi.mock("@/lib/prisma")` 로
 * 통로를 가로챘다. 이 보관함에는 Prisma 가 없고 읽기가 **인자**라(설계서 §2-a) 가짜 loaders 를 넘긴다.
 *
 * 두 흉내 함수의 **이름과 쓰는 법**(mockResolvedValue · toHaveBeenCalledWith)은 그대로 뒀다 —
 * 그래야 아래 시험 본문(기대 결과)이 ERP 원본과 한 글자도 안 달라진다.
 */
const loadOpenAnnouncements = vi.fn();
const productFindMany = vi.fn();

/**
 * 앱이 낼 loader 를 시험 안에서 그대로 흉내 낸다. 상품 쪽은 ERP loader 와 **같은 조회 모양**
 * (`where: { active: true }` · `select: PRODUCT_SELECT`)으로 부른다 — 그래야
 * 「어떤 조회로 불렸나」를 재는 단언이 예전 뜻 그대로 남고, 내보낸 select 가 실제로 쓰이는지도 함께 걸린다.
 */
const LOADERS: FundingMapLoaders = {
  loadAnnouncements: (now) => loadOpenAnnouncements(now),
  loadProducts: () => productFindMany({ where: { active: true }, select: PRODUCT_SELECT }),
};

/**
 * 시험 본문은 예전처럼 인자를 셋까지만 넘긴다 — 넷째(loaders)는 이 감싸는 함수가 채운다.
 * 90 군데 호출을 고치는 대신 여기 한 줄로 끝내야 「흉내 방식만 바뀌었다」가 눈으로 확인된다.
 */
const buildFundingMap = (profile: BusinessProfile, now?: Date, opts?: BuildFundingMapOptions) =>
  buildWithLoaders(profile, now, opts, LOADERS);

/** 손 등록 명부는 회차에 없어 조립이 상수로 직접 합친다 — 아무 것도 안 넣어도 지도에 이만큼은 실린다. */
const MANUAL_N = MANUAL_PRODUCTS.length;

/** 기준 시각 = 한국시간 2026-09-03 10:00 (funding-map.test.ts 와 같은 자리). */
const NOW = new Date("2026-09-03T10:00:00+09:00");
const DAY = 86_400_000;
const kstEnd = (ymd: string) => new Date(`${ymd}T23:59:59+09:00`);

const EMPTY_RULE = {
  conditions: [] as unknown[],
  humanCheck: [] as string[],
  benefitSummary: "",
  supportAmountText: "",
  aiSummary: { purpose: "", target: "", scale: "", scaleItems: [] },
  documents: [] as string[],
  verified: false,
};

const ann = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  source: "bizinfo",
  title: "2026년 소상공인 지원사업 모집 공고",
  agency: "중소벤처기업부",
  region: "",
  wedlyCategory: "무상지원금",
  dedupKey: "",
  applyStart: null,
  applyEnd: kstEnd("2026-09-30"),
  applyPeriodText: "",
  url: "https://bizinfo.go.kr/a1",
  structure: null,
  ruleStructure: EMPTY_RULE,
  structureStatus: "pending",
  fundingGroup: "grant",
  amountText: "최대 1억원",
  amountMaxWon: BigInt(100_000_000),
  rateText: "",
  rateMin: null,
  firstSeenAt: new Date(NOW.getTime() - 30 * DAY),
  ...over,
});

const prod = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  source: "product-kbank",
  fundingGroup: "bank",
  institution: "케이뱅크",
  institutionType: "internet-bank",
  name: "사장님 신용대출",
  productType: "credit",
  targetText: "사업자등록 6개월 이상 개인사업자",
  targetRules: {} as unknown,
  limitText: "최대 1억원",
  limitMaxWon: BigInt(100_000_000),
  rateText: "연 3.97%~5.90%",
  rateMin: 3.97,
  rateMax: 5.9,
  feeText: "",
  termText: "5년",
  channel: "케이뱅크 앱",
  applyUrl: "https://kbanknow.com/apply",
  detailUrl: "https://kbanknow.com/soho",
  deadlineText: "상시",
  raw: {},
  firstSeenAt: new Date(NOW.getTime() - 10 * DAY),
  lastSeenAt: NOW,
  ...over,
});

type Blocks = Array<{ group: FundingGroup; items: FundingItem[]; excludedItems?: FundingItem[] }>;

/**
 * 응답에 **실린** 항목 전부 = 정상 목록(`items`) + 안 맞음 목록(`excludedItems`, `includeExcluded`
 * 를 켰을 때만 있다).
 *
 * ★두 자리가 갈렸다(코덱스 11차 #2, 2026-09-04) — 예전엔 안 맞음도 `items` 에 섞여 왔다.
 *  아래 시험 중 「그 줄 자체」(판정·대표 고르기·묶음 번호)를 재는 것들은 `includeExcluded:true` 로
 *  켠 뒤 이 도우미로 줄을 찾는다. 「화면 정상 목록에 있나」를 재는 자리는 `shownOf` 를 쓴다.
 */
const itemsOf = (blocks: Blocks): FundingItem[] => blocks.flatMap((b) => [...b.items, ...(b.excludedItems ?? [])]);
/** 정상 목록(`items`)만 — 안 맞음이 화면 목록에 안 섞이는지를 재는 자리. */
const shownOf = (blocks: Blocks): FundingItem[] => blocks.flatMap((b) => b.items);
const byId = (blocks: Blocks, id: string) => itemsOf(blocks).find((x) => x.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  loadOpenAnnouncements.mockResolvedValue([]);
  productFindMany.mockResolvedValue([]);
});

describe("자금 조달 지도 조립 — 두 표를 한 모양으로", () => {
  it("공고와 상품이 각자의 갈래 칸에 실린다 — id 접두어로 어느 표에서 왔는지 남는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([ann()]);
    productFindMany.mockResolvedValue([prod()]);

    const data = await buildFundingMap({}, NOW);

    expect(loadOpenAnnouncements).toHaveBeenCalledWith(NOW);
    expect(productFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
    const grant = data.groups.find((b) => b.group === "grant")!;
    const bank = data.groups.find((b) => b.group === "bank")!;
    expect(grant.items.map((x) => x.id)).toEqual(["a:a1"]);
    expect(bank.items.map((x) => x.id)).toEqual(["p:p1"]);
    expect(grant.items[0]).toMatchObject({
      kind: "announcement", refId: "a1", where: "중소벤처기업부", url: "https://bizinfo.go.kr/a1",
      amountText: "최대 1억원", source: "bizinfo", targetText: "",
    });
    expect(grant.items[0].deadline).toMatchObject({ kind: "date", date: "2026-09-30", dDay: 27 });
    expect(bank.items[0]).toMatchObject({
      kind: "product", refId: "p1", where: "케이뱅크 앱", url: "https://kbanknow.com/soho",
      applyUrl: "https://kbanknow.com/apply", rateText: "연 3.97%~5.90%", rateMin: 3.97,
      targetText: "사업자등록 6개월 이상 개인사업자", source: "product-kbank",
    });
    expect(bank.items[0].deadline.kind).toBe("always");
    expect(data.generatedAt).toBe(NOW.toISOString());
  });

  it("BigInt 한도는 Number 로 바꿔 싣는다 — 그대로 두면 응답을 만들다 500 이 난다", async () => {
    loadOpenAnnouncements.mockResolvedValue([ann()]);
    productFindMany.mockResolvedValue([prod()]);

    const data = await buildFundingMap({}, NOW);

    const all = itemsOf(data.groups);
    expect(all.every((x) => x.amountMaxWon === null || typeof x.amountMaxWon === "number")).toBe(true);
    expect(byId(data.groups, "a:a1")!.amountMaxWon).toBe(100_000_000);
    expect(byId(data.groups, "p:p1")!.amountMaxWon).toBe(100_000_000);
    expect(() => JSON.stringify(data)).not.toThrow();
  });

  it("한도를 모르면 null 로 둔다 — 0 으로 지어내지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([ann({ amountMaxWon: null, amountText: "" })]);
    productFindMany.mockResolvedValue([prod({ limitMaxWon: null, limitText: "" })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountMaxWon).toBeNull();
    expect(byId(data.groups, "p:p1")!.amountMaxWon).toBeNull();
  });

  /**
   * ★2026-09-03 독립 화면 검사 후속(금감원 자료 실측 6건 — 「500억원 이하」·「동일인당 최대 220억원」 등) —
   *  상시 상품(kind "product")의 한도가 100억을 넘으면 정렬 숫자(amountMaxWon)를 비운다. 공고에 이미
   *  있는 100억 상한 규칙(`amount-rate-extract.ts` 의 `PER_COMPANY_REQUIRED_WON`)과 같은 취지 —
   *  글자(amountText)는 원문 그대로 두고 숫자만 정렬·「가장 큰 한도」 집계에서 뺀다.
   */
  it("상시 상품 한도가 100억을 넘으면 정렬 숫자를 비운다 — 글자는 원문 그대로(독립 검사 후속)", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([
      prod({ id: "p-over", limitText: "최대 500억원", limitMaxWon: BigInt(50_000_000_000) }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:p-over")!;
    expect(item.amountMaxWon).toBeNull();
    expect(item.amountText).toBe("최대 500억원");
  });

  it("상시 상품 한도가 100억 이하면 그대로 둔다 — 50억은 100억 상한에 안 걸린다", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([
      prod({ id: "p-under", limitText: "최대 50억원", limitMaxWon: BigInt(5_000_000_000) }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:p-under")!;
    expect(item.amountMaxWon).toBe(5_000_000_000);
    expect(item.amountText).toBe("최대 50억원");
  });

  /**
   * ★2026-09-03 코덱스 적대 리뷰 반영 — 100억 상한이 「기업당·업체당·동일인당…」 같은 한 곳당 표시가
   *  붙은 값까지 무조건 지웠다. 「동일인당 최대 220억원」은 기업 한 곳이 실제로 받는 유효 한도인데
   *  정렬 숫자가 사라져 50억짜리 상품보다 뒤로 밀리고 글자(220억원)와 정렬이 어긋났다. 공고 쪽
   *  표지 목록(`amount-rate-extract.ts` 의 `PER_COMPANY_RE`, "동일인당"도 "인당"으로 걸린다)을
   *  그대로 가져다 써서, 표시가 있으면 100억을 넘어도 남긴다 — 표시가 없는 「500억원 이하」(바로 위
   *  시험)는 여전히 지운다.
   */
  it("100억을 넘어도 기업당 표시가 있으면 정렬 숫자를 남긴다 — 「동일인당 최대 220억원」(코덱스 리뷰 반영)", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([
      prod({ id: "p-percompany", limitText: "동일인당 최대 220억원", limitMaxWon: BigInt(22_000_000_000) }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:p-percompany")!;
    expect(item.amountMaxWon).toBe(22_000_000_000);
    expect(item.amountText).toBe("동일인당 최대 220억원");
  });

  /**
   * ★코덱스 12차 #2(2026-09-04) — 100억 초과 상품의 판정이 「글 **전체**에서 기업당류 표지를 찾는다」
   *  였다. 공고 쪽 추출기(`extractAmount`)는 표지를 **같은 절 안에서만** 찾는데(11차 #8 구두점 경계)
   *  이쪽은 그 규칙을 안 써서, 「사업자당 한도 5억원; 전체 한도 300억원」처럼 앞 절에만 표지가 있는
   *  글이 300억을 기업 한 곳 한도로 통과시켰다. 이제 **추출기를 그대로 재사용**해 — 추출기가 뽑은
   *  숫자가 저장된 한도와 같을 때만 남긴다(글자 amountText 는 어느 쪽이든 원문 그대로).
   */
  it("100억 초과 상품은 공고 추출기와 같은 규칙으로만 남긴다 — 앞 절 표지가 뒤 금액을 못 살린다(12차 #2)", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([
      prod({
        id: "p-clause",
        limitText: "사업자당 한도 5억원; 전체 한도 300억원",
        limitMaxWon: BigInt(30_000_000_000),
      }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:p-clause")!;
    expect(item.amountMaxWon, "추출기는 이 글에서 5억만 인정한다 — 300억과 안 맞으면 비운다").toBeNull();
    expect(item.amountText, "글자는 원문 그대로").toBe("사업자당 한도 5억원; 전체 한도 300억원");
  });

  /**
   * ★코덱스 13차 #4(2026-09-04) — 12차 #2 는 「추출기가 뽑은 숫자 === 저장된 한도」로 못 박았는데,
   *  「기업당 운전자금 최대 100억원, 시설자금 최대 200억원」처럼 자금 종류별로 한도가 갈리는 글에서는
   *  추출기가 표지(「기업당」)와 같은 절에 있는 100억만 인정한다(200억 쪽 절엔 표지가 없다). 그러면
   *  두 값이 안 맞아 200억이 통째로 버려졌다 — 표지로 검증된 큰 금액(100억 이상)이 그 글에 실제로
   *  있으면 저장된 한도를 그대로 살린다.
   */
  it("100억 초과 상품은 재추출 값이 100억 이상이면 살린다 — 「기업당 운전 100억, 시설 200억」(13차 #4)", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([
      prod({
        id: "p-two",
        limitText: "기업당 운전자금 최대 100억원, 시설자금 최대 200억원",
        limitMaxWon: BigInt(20_000_000_000),
      }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:p-two")!;
    expect(item.amountMaxWon, "표지로 검증된 100억이 있으니 저장된 200억을 살린다").toBe(20_000_000_000);
    expect(item.amountText, "글자는 원문 그대로").toBe("기업당 운전자금 최대 100억원, 시설자금 최대 200억원");
  });

  it("「500억원 이하」처럼 표지가 아예 없는 글도 그대로 비운다(12차 #2)", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([
      prod({ id: "p-ceil", limitText: "500억원 이하", limitMaxWon: BigInt(50_000_000_000) }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:p-ceil")!;
    expect(item.amountMaxWon).toBeNull();
    expect(item.amountText).toBe("500억원 이하");
  });

  it("갈래를 못 붙인 공고도 지도에서 사라지지 않는다 — grant 칸에 싣되 미분류 표식·한 줄 이유 앞머리", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "u1", title: "2026년 우수기업 현판 수여식 안내", agency: "한국산업단지공단", wedlyCategory: "", fundingGroup: "", amountText: "", amountMaxWon: null }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "a:u1")!;
    expect(item.group).toBe("grant");
    expect(item.unclassified).toBe(true);
    expect(item.why.startsWith("갈래 미분류 · ")).toBe(true);
    expect(data.unclassified).toBe(1);
  });

  it("미분류 줄은 「안 갚아도 되는 돈」 집계에서 빠진다 — 없는 무상 지원금을 부풀리지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      // G3②(2026-09-03 코덱스 2차 리뷰): glanceOf 의 grantFit·grantMaxWon 은 이제 fitVerdict "fit" 만
      // 센다 — 조건 0개(예전 EMPTY_RULE 기본값)면 unverified 라 집계에서 빠지므로, 실질 조건(업력)
      // 하나로 채워 g1 이 진짜 "fit" 이 되게 한다.
      ann({
        id: "g1",
        amountMaxWon: BigInt(50_000_000),
        ruleStructure: { ...EMPTY_RULE, conditions: [{ key: "businessAgeMaxYears", op: "lte", value: 10, rawText: "업력 10년 이하", machineReadable: true }] },
      }),
      ann({ id: "u1", title: "2026년 우수기업 현판 수여식 안내", agency: "한국산업단지공단", wedlyCategory: "", fundingGroup: "", amountMaxWon: BigInt(900_000_000) }),
    ]);
    const data = await buildFundingMap({ foundedDate: "2020-01-01" }, NOW); // 업력 조건이 pass 하려면 프로필에 설립일이 있어야 한다
    expect(data.glance.grantFit).toBe(1);
    expect(data.glance.grantMaxWon).toBe(50_000_000);
    expect(data.glance.open).toBe(2 + MANUAL_N); // 열린 건수에는 그대로 센다(사라지면 누락) + 손 등록 상시 상품
  });

  it("무상 갈래에 이자 글이 비면 「무상」 — 미분류 줄에는 붙이지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "g1", rateText: "" }),
      ann({ id: "u1", title: "2026년 우수기업 현판 수여식 안내", agency: "한국산업단지공단", wedlyCategory: "", fundingGroup: "", rateText: "" }),
      ann({ id: "p2", fundingGroup: "policy", rateText: "" }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:g1")!.rateText).toBe("무상");
    expect(byId(data.groups, "a:u1")!.rateText).toBe("");
    expect(byId(data.groups, "a:p2")!.rateText).toBe("");
  });

  it("공고 칸이 비면 AI 구조의 지원금액 표현으로 채운다", async () => {
    // ★amountMaxWon 을 비운다 — 숫자 칸이 있으면 그쪽이 앞면 글자를 정한다(아래 「단위를 통일한다」 시험).
    loadOpenAnnouncements.mockResolvedValue([
      ann({ amountText: "", amountMaxWon: null, structureStatus: "done", structure: { ...EMPTY_RULE, supportAmountText: "기업당 3천만원" } }),
    ]);
    const data = await buildFundingMap({}, NOW);
    // ★기대값 변경(2026-09-03 독립 검사 D): 숫자 칸이 없는 글자도 단위 토큰(천만·백만·천)을 원으로
    //   환산해 `formatWon` 표기로 통일한다 — 숫자 칸이 있는 줄이 이미 「3,000만원」으로 적히므로,
    //   같은 금액이 표에서 「3천만원」과 「3,000만원」 두 모양으로 갈리지 않게 한다.
    expect(byId(data.groups, "a:a1")!.amountText).toBe("기업당 3,000만원");
  });

  it("앞면 「얼마」 글자는 40자에서 자른다 — AI 구조화 문장이 통째로 실려 표 줄이 5줄로 늘던 QA 15c 지적", async () => {
    // 실제로 표에 실렸던 문장(배포본 캡처 15c-table-sorted-by-amount.png)
    const 긴문장 =
      "중소기업 개발생산판로 맞춤형 지원 중소기업 창안개발, 제품생산, 판로개척 지원 사업비 지원 시군 소재 연매출 120억원 이하 중소기업";
    loadOpenAnnouncements.mockResolvedValue([
      ann({ amountText: "", amountMaxWon: null, structureStatus: "done", structure: { ...EMPTY_RULE, supportAmountText: 긴문장 } }),
    ]);
    productFindMany.mockResolvedValue([prod({ id: "pl", limitText: 긴문장 })]);

    const data = await buildFundingMap({}, NOW);
    const 공고 = byId(data.groups, "a:a1")!.amountText;
    expect(공고.length, "앞 40자 + …").toBe(41);
    expect(공고).toBe(`${긴문장.slice(0, 40)}…`);
    /**
     * ★기대값 변경(2026-09-03 코덱스 적대 리뷰 #3 높음) — 예전엔 상품 한도 글자도 41자였다.
     *   상품(FinanceProduct)에는 공고와 달리 **원문을 다시 볼 상세 화면이 없어**, 서버가 자르면
     *   그 순간 원본이 어디에도 남지 않는다. 이제 서버는 안 자르고 화면이 두 줄에서 끊는다
     *   (전체는 `title` 로 읽는다 — 그려서 재는 시험 ⑩-f).
     */
    expect(byId(data.groups, "p:pl")!.amountText, "상품은 자르지 않는다").toBe(긴문장);
  });

  it("숫자 칸(amountMaxWon)이 있으면 앞면 「얼마」의 단위를 통일한다 — 「70,000천원」이 「7,000만원」으로", async () => {
    /**
     * 독립 검사 C: 원문 단위가 그대로 실려 같은 금액이 「최대 70,000천원」·「최대 1,200백만원」·
     * 「최대 7천만원」 세 가지로 섞여 보였다(배포본 캡처 `10-amount-unit-inconsistency.png`).
     * 숫자 칸이 있으면 낱말만 원문에서 가져오고 금액은 `formatWon` 하나로 적는다.
     */
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "a1", amountText: "최대 70,000천원", amountMaxWon: BigInt(70_000_000) }),
    ]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountText).toBe("최대 7,000만원");
  });

  it("낱말은 원문에서 가져온다 — 「업체당 1,200백만원」은 「업체당 12억원」", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "a1", amountText: "업체당 1,200백만원", amountMaxWon: BigInt(1_200_000_000) }),
    ]);
    productFindMany.mockResolvedValue([prod({ id: "pk", limitText: "한도 500,000천원", limitMaxWon: BigInt(500_000_000) })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountText).toBe("업체당 12억원");
    // ★기대값 변경(2026-09-03 독립 검사 D): 상품 한도 글자도 **단위만** 통일한다.
    //   문장은 그대로 두고 「500,000천원」 같은 단위 토큰만 원으로 환산해 다시 적는다 —
    //   같은 표에서 「최대 1,000만원」과 「한도 500,000천원」이 섞이면 자릿수 감이 어긋난다.
    //   (자르는 것은 여전히 안 한다 — 코덱스 #3 은 문장을 잃지 말라는 것이지 단위를 두라는 게 아니다.)
    expect(byId(data.groups, "p:pk")!.amountText).toBe("한도 5억원");
  });

  it("원문에 낱말이 없으면 「최대」를 쓴다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "a1", amountText: "지원 규모 150,000천원 이내", amountMaxWon: BigInt(150_000_000) }),
    ]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({}, NOW);
    // ★기대값 변경(코덱스 #4 중간): 억 단위 소수 반올림(「1.5억원」)을 버리고 만원까지 정확히 적는다.
    //   반올림은 없는 한도를 만든다 — 근거는 funding-map.test.ts 의 formatWon 시험 주석.
    expect(byId(data.groups, "a:a1")!.amountText).toBe("최대 1억 5,000만원");
  });

  it("숫자 칸이 없고 규칙 글자가 40자를 넘으면 더 짧은 AI 구조화 문장을 쓴다 — 서랍의 잘린 문장(독립 검사 D)", async () => {
    // 배포본 캡처 `07-drawer-from-table.png`: 서랍의 「얼마」가 40자에서 잘린 공고 문장이었고,
    // 같은 공고의 상세 화면(AI 구조화)은 「월1만원(12개월)」이라 두 화면이 달랐다.
    const 긴문장 = "영세 소상공인 노란우산 가입지원 도내 연매출 3억원 이하 소상공인 신규가입자에게 월 1만원씩 12개월 지원";
    loadOpenAnnouncements.mockResolvedValue([
      ann({
        id: "a1",
        amountText: 긴문장,
        amountMaxWon: null,
        structureStatus: "done",
        structure: { ...EMPTY_RULE, supportAmountText: "월1만원(12개월)" },
      }),
    ]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountText).toBe("월1만원(12개월)");
  });

  it("AI 문장이 더 길면 규칙 글자를 그대로 자른다 — 짧다고 아무 문장이나 바꿔치지 않는다", async () => {
    const 긴문장 = "영세 소상공인 노란우산 가입지원 도내 연매출 3억원 이하 소상공인 신규가입자에게 월 1만원씩 12개월 지원";
    loadOpenAnnouncements.mockResolvedValue([
      ann({
        id: "a1",
        amountText: 긴문장,
        amountMaxWon: null,
        structureStatus: "done",
        structure: { ...EMPTY_RULE, supportAmountText: `${긴문장} 및 부대비용 일체` },
      }),
    ]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountText).toBe(`${긴문장.slice(0, 40)}…`);
  });

  it("40자 이하인 짧은 값은 그대로 둔다 — 멀쩡한 금액에 …를 붙이지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([ann({ amountText: "최대 1억원" })]);
    productFindMany.mockResolvedValue([prod({ id: "ps", limitText: "최대 1억원" })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountText).toBe("최대 1억원");
    expect(byId(data.groups, "p:ps")!.amountText).toBe("최대 1억원");
  });

  it("상품 대상 규칙을 프로필과 대조한다 — 어긋나면 「안 맞음」이 되고 이유가 남는다", async () => {
    productFindMany.mockResolvedValue([
      prod({ id: "p9", targetRules: { creditScoreMin: 700 } }),
    ]);
    // ★재설계 계약 G1①(2026-09-04) — 기본(includeExcluded:false)은 안 맞음을 지도에서 뺀다. 이
    //  시험은 판정 로직 자체(fitVerdict·fit[0]·why)를 재는 자리라 안 맞음도 보이게 켜야 항목을 볼 수 있다.
    const data = await buildFundingMap({ creditScore: 600 }, NOW, { filters: { includeExcluded: true } });
    const item = byId(data.groups, "p:p9")!;
    expect(item.fitVerdict).toBe("excluded");
    expect(item.fit[0]).toMatchObject({ verdict: "fail" });
    expect(item.fit[0].label).toContain("신용점수 하한");
    expect(item.why).toContain("대상 아님");
  });

  it("신용점수를 안 적었으면 「확인 필요」로 남고 판정을 막지 않는다", async () => {
    productFindMany.mockResolvedValue([prod({ id: "p9", targetRules: { creditScoreMin: 700 } })]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:p9")!;
    expect(item.fitVerdict).toBe("unverified");
    expect(item.fit[0].verdict).toBe("unknown");
  });

  /**
   * ★코덱스 2차 #6(2026-09-04) — 예전엔 **비어 있는 칸 7종을 전부** 실어 보냈다. 그러면 지금 결과에
   *  신용점수를 보는 조건이 하나도 없어도 「신용점수를 입력해 주세요 · 입력하면 조건을 더 정확하게
   *  맞춰 볼 수 있어요」라고 시킨다 — 채워도 아무 판정이 안 바뀌는데 시키는 **근거 없는 안내**다.
   *  이제 서버가 「이번 결과의 기계 대조 조건이 실제로 읽는 항목」만 남겨 보낸다.
   */
  it("빈칸 힌트는 이번 결과의 조건이 **실제로 쓰는 항목만** 남긴다 — 차례는 그대로(코덱스 2차 #6)", async () => {
    // 손 등록 명부에 업력 조건(businessAgeMaxYears)이 하나 있어, 아무 것도 안 실어도 「설립일」은 늘 쓰인다.
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([]);
    const 기본 = await buildFundingMap({}, NOW);
    expect(기본.profileGaps, "결과가 안 쓰는 항목까지 전부 나열한다").toEqual(["설립일"]);

    // 신용점수·직원 수를 보는 조건이 결과에 있으면 그 둘이 더해진다 — 차례는 profileGapsOf 그대로다
    productFindMany.mockResolvedValue([prod({ id: "p9", targetRules: { creditScoreMin: 700, employeesMax: 10 } })]);
    const 쓰는것 = await buildFundingMap({}, NOW);
    expect(쓰는것.profileGaps).toEqual(["신용점수", "설립일", "직원 수"]);

    // 채워 두면 빈 칸이 아니라 힌트에서 빠진다
    const 채움 = await buildFundingMap({ creditScore: 800, employeeCount: 3, foundedDate: "2020-01-01" }, NOW);
    expect(채움.profileGaps).toEqual([]);
  });

  /**
   * ★코덱스 3차 #C(2026-09-04) — 「조건을 맞춰 보지 않은 목록입니다」라고 **단정해도 되는 근거**.
   *
   *  앞선 두 판(요약 길이 → `evaluatedConditions` 판정 수)은 둘 다 근사치였다: 판정 엔진이
   *  「이 조건을 회사 정보와 견줘 봤다」를 기록하지 않아 어떤 셈도 사실을 못 말한다. 그래서 셈을
   *  정교하게 만드는 대신 **확실히 아는 것 하나**만 싣는다 — 회사 정보 자체가 비었는가.
   */
  it("profileEmpty — 회사 정보가 통째로 비었을 때만 참이다", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([prod({ id: "p9", targetRules: { creditScoreMin: 700 } })]);

    expect((await buildFundingMap({}, NOW)).profileEmpty, "빈 프로필인데 거짓이다").toBe(true);
    expect((await buildFundingMap({ region: "서울" }, NOW)).profileEmpty).toBe(false);
    // 「값이 없다」와 「빈 문자열」은 같게 본다 — 통로가 안 채운 칸을 ""로 보내기도 한다
    expect((await buildFundingMap({ region: "", industry: "" }, NOW)).profileEmpty).toBe(true);
  });

  it("false·0 은 **채워진 값**이다 — 체납 없음·직원 0명을 「정보 없음」으로 세지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([]);
    expect((await buildFundingMap({ taxDelinquent: false }, NOW)).profileEmpty).toBe(false);
    expect((await buildFundingMap({ employeeCount: 0 }, NOW)).profileEmpty).toBe(false);
    expect((await buildFundingMap({ hasExistingLoan: false }, NOW)).profileEmpty).toBe(false);
  });

  /**
   * ★뿌리 원인 그 자체(코덱스 2차 #1 → 3차 #3·#6) — `usedProfileSummary` 는 `companyScale`·
   *  `hasCert`·`hasPatent` 를 **아예 요약하지 않는다**. 그 셋만 채운 회사는 요약이 빈 배열이다.
   *  그 자리에서 화면이 「조건을 맞춰 보지 않은 목록」이라 말하면 거짓이다 — `profileEmpty` 는
   *  거짓이라 화면이 **아무 말도 하지 않는다**(이 시험이 그 계약을 못 박는다).
   */
  it("요약이 비어도 회사 정보는 있다 — 그 회사에는 profileEmpty 가 거짓이다", async () => {
    const 규모만: BusinessProfile = { companyScale: "중소기업" };
    expect(usedProfileSummary(규모만), "요약은 기업 규모를 안 담는다").toEqual([]);

    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([prod({ id: "ps", targetRules: { scale: ["중소기업"] } })]);
    const data = await buildFundingMap(규모만, NOW);
    expect(data.profileEmpty, "요약이 비었다고 정보가 없다고 말한다").toBe(false);
    expect(shownOf(data.groups).find((it) => it.id === "p:ps")!.fit[0].verdict).toBe("pass");
  });

  /**
   * ★코덱스 3차 #B1(2026-09-04) — 빈칸 힌트를 **겹친 상품을 접은 뒤** 목록으로 세면, 접힌 쌍둥이
   *  상품이 들고 있던 조건이 통째로 사라진다. 접기는 「같은 사업을 두 줄로 안 보여 주기」일 뿐
   *  그 줄에서 판정이 안 돌았다는 뜻이 아니다.
   */
  it("접힌 쌍둥이 상품의 조건도 빈칸 힌트에 센다 — 접기 전 목록으로 센다(3차 #B1)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "f1", title: "소공인특화자금", agency: "중소벤처기업진흥공단", dedupKey: "소공인특화자금|중소벤처기업진흥공단", fundingGroup: "policy" }),
    ]);
    // 같은 이름·같은 기관이라 이 상품 줄은 공고에 접힌다. 신용점수 조건은 이 줄에만 있다.
    productFindMany.mockResolvedValue([
      prod({ id: "pf1", name: "소공인특화자금", institution: "중소벤처기업진흥공단", fundingGroup: "policy", targetRules: { creditScoreMin: 700 } }),
    ]);
    // 설립일은 손 등록 명부 몫이라 채워서 지운다 — 남는 것은 접힌 줄이 만든 힌트뿐이다.
    const data = await buildFundingMap({ foundedDate: "2020-01-01" }, NOW);
    expect(byId(data.groups, "p:pf1"), "이 시험은 실제로 접힌 자리를 잰다").toBeUndefined();
    expect(data.profileGaps, "접힌 상품의 조건을 통째로 잃었다").toEqual(["신용점수"]);
  });

  /**
   * ★코덱스 3차 #B2(2026-09-04) — 다섯 조건(`companyScale`·`noTaxDelinquency`·`certRequired`·
   *  `patentRequired`·`isCorporation`)이 빈칸 안내에서 빠져 있었다. 「짝지을 이름이 없다」던 것은
   *  `profileGapsOf` 쪽 누락이었다 — 채우면 판정이 실제로 갈리는 칸들이다.
   */
  it("기업 규모·법인 여부도 빈칸 안내에 나온다 — 채우면 판정이 갈린다(3차 #B2)", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([prod({ id: "ps", targetRules: { scale: ["중소기업"], isCorporation: true } })]);
    const data = await buildFundingMap({ foundedDate: "2020-01-01" }, NOW);
    expect(data.profileGaps).toEqual(["기업 규모", "사업자번호"]);

    // 채우면 힌트에서 빠진다 — 「입력해 주세요」가 사라지는 자리가 실제로 있다
    const 채움 = await buildFundingMap({ foundedDate: "2020-01-01", companyScale: "중소기업", bizno: "1018147521" }, NOW);
    expect(채움.profileGaps).toEqual([]);
  });

  it("체납·인증·특허 조건도 빈칸 안내에 나온다(3차 #B2)", async () => {
    const 세조건 = {
      ...EMPTY_RULE,
      conditions: [
        { key: "noTaxDelinquency", op: "eq", value: true, rawText: "국세·지방세 체납 없을 것", machineReadable: true },
        { key: "certRequired", op: "eq", value: true, rawText: "벤처기업 인증 보유", machineReadable: true },
        { key: "patentRequired", op: "eq", value: true, rawText: "특허 보유", machineReadable: true },
      ],
    };
    loadOpenAnnouncements.mockResolvedValue([ann({ ruleStructure: 세조건 })]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({ foundedDate: "2020-01-01" }, NOW);
    expect(data.profileGaps).toEqual(["체납 여부", "인증 보유", "특허 보유"]);

    const 채움 = await buildFundingMap(
      { foundedDate: "2020-01-01", taxDelinquent: false, hasCert: true, hasPatent: false },
      NOW,
    );
    expect(채움.profileGaps).toEqual([]);
  });

  it("적혀 있지만 못 읽는 사업자번호는 「빈 칸」이 아니다 — 입력해 달라고 시키지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([]);
    productFindMany.mockResolvedValue([prod({ id: "ps", targetRules: { isCorporation: true } })]);
    // 가운데 두 자리 89 — 법인·개인을 못 가르는 번호다. 그래도 사람이 적어 둔 값이라 빈 칸이 아니다.
    const data = await buildFundingMap({ foundedDate: "2020-01-01", bizno: "1018947521" }, NOW);
    expect(data.profileGaps, "적어 둔 칸을 다시 입력하라고 시킨다").toEqual([]);
  });

  it("기계로 못 읽는 조건(machineReadable:false)은 그 항목을 쓴다고 치지 않는다", async () => {
    const 서울조건 = (machineReadable: boolean) => ({
      ...EMPTY_RULE,
      conditions: [{ key: "region", op: "in", value: ["서울"], rawText: "서울 소재", machineReadable }],
    });
    productFindMany.mockResolvedValue([]);

    loadOpenAnnouncements.mockResolvedValue([ann({ ruleStructure: 서울조건(false) })]);
    const 사람확인 = await buildFundingMap({ foundedDate: "2020-01-01" }, NOW);
    expect(사람확인.profileGaps, "소재지를 채워도 이 조건은 안 달라진다").toEqual([]);

    loadOpenAnnouncements.mockResolvedValue([ann({ ruleStructure: 서울조건(true) })]);
    const 기계대조 = await buildFundingMap({ foundedDate: "2020-01-01" }, NOW);
    expect(기계대조.profileGaps).toEqual(["소재지"]);
  });

  it("같은 사업이 공고와 상품에 겹치면 공고 줄만 남기고 상품 줄은 접는다 — 접은 상품 번호를 공고에 남긴다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "d1", title: "소공인특화자금", agency: "중소벤처기업진흥공단", dedupKey: "소공인특화자금|중소벤처기업진흥공단", fundingGroup: "policy" }),
    ]);
    productFindMany.mockResolvedValue([
      prod({ id: "pd1", name: "소공인특화자금", institution: "중소벤처기업진흥공단", fundingGroup: "policy" }),
      prod({ id: "pd2", name: "다른 상품", institution: "중소벤처기업진흥공단" }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:pd1")).toBeUndefined();
    expect(byId(data.groups, "a:d1")!.relatedProductId).toBe("pd1");
    expect(byId(data.groups, "p:pd2")).toBeDefined();
  });

  /**
   * ★코덱스 13차 #5(2026-09-04) — 발 hint 의 「전체 K건」이 **쌍둥이 상품을 접기 전** 개수였다.
   *  같은 사업이 공고와 상시 상품에 겹쳐 상품 줄이 접히면 그 줄은 지도·표 어디에도 없는데, 「전체」
   *  에는 그대로 세어져 사람이 「어딘가에 한 건 더 있다」고 읽었다(묶기(dedupKey)는 이미 접은 뒤로
   *  세고 있어 같은 잣대가 아니었다).
   */
  it("totals.all 은 쌍둥이 상품을 접은 뒤 개수다 — 접힌 상품 1건은 「전체」에도 안 센다(13차 #5)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "t1", title: "소공인특화자금", agency: "중소벤처기업진흥공단", dedupKey: "소공인특화자금|중소벤처기업진흥공단", fundingGroup: "policy" }),
    ]);
    productFindMany.mockResolvedValue([
      prod({ id: "pt1", name: "소공인특화자금", institution: "중소벤처기업진흥공단", fundingGroup: "policy" }),
    ]);
    const data = await buildFundingMap({}, NOW);
    // 접혔다는 증거 — 상품 줄은 사라지고 번호가 공고에 남는다
    expect(byId(data.groups, "p:pt1")).toBeUndefined();
    expect(byId(data.groups, "a:t1")!.relatedProductId).toBe("pt1");
    // 공고 1건 + 손 등록 상시 상품 = 전체. 접힌 상품(pt1)은 어디에도 없으므로 세지 않는다.
    expect(data.totals).toEqual({ all: 1 + MANUAL_N, filtered: 1 + MANUAL_N });
  });

  it("칩으로 공고가 걸러진 자리에서는 같은 이름의 상품을 접지 않는다 — 맞는 상품까지 잃으면 안 된다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({
        id: "d2", title: "소공인특화자금", agency: "중소벤처기업진흥공단", fundingGroup: "policy", region: "부산",
        ruleStructure: { ...EMPTY_RULE, conditions: [{ key: "region", op: "in", value: ["부산"], rawText: "부산 소재", machineReadable: true }] },
      }),
    ]);
    // ★재설계 계약 G1①(2026-09-04) — 옛 fitOnly(맞는 것만 좁히기, fit 만 남기고 unverified 도 뺌)는
    // 없어졌다. pd3 에 서울 소재 조건을 단 것은 이제 fitOnly 를 만족시키기 위해서가 아니라, 이
    // 시험이 원래 재려던 것(칩으로 걸러진 자리의 상품이 안 접힌다)과 무관하게 살아 있는지만 본다 —
    // 기본(includeExcluded:false)이 이미 안 맞음(d2)만 뺀다.
    productFindMany.mockResolvedValue([
      prod({ id: "pd3", name: "소공인특화자금", institution: "중소벤처기업진흥공단", fundingGroup: "policy", targetRules: { region: ["서울"] } }),
    ]);
    const data = await buildFundingMap({ region: "서울" }, NOW);
    expect(byId(data.groups, "a:d2")).toBeUndefined(); // 타지역 공고는 기본 필터로 빠졌다(안 맞음)
    expect(byId(data.groups, "p:pd3")).toBeDefined();  // 상품은 살아 있어야 한다
  });

  // ★제목을 고쳤다(독립 검사 ①, 2026-09-04) — 4칸은 이제 **칩 앞에서** 센다(칩을 켠 전후가 같은지는
  //  아래 「칩을 켜도 한눈에 4칸은 안 바뀐다」가 잰다). 이 시험이 재는 것은 「안 맞음이 4칸에서 빠진다」다.
  it("칩(필터)·정렬·상위 N 을 서버에서 적용한다 — 한눈에 4칸은 안 맞음을 뺀 건수", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "ok", fundingGroup: "policy", region: "서울", ruleStructure: { ...EMPTY_RULE, conditions: [{ key: "region", op: "in", value: ["서울"], rawText: "서울 소재", machineReadable: true }] } }),
      ann({ id: "no", fundingGroup: "policy", region: "부산", ruleStructure: { ...EMPTY_RULE, conditions: [{ key: "region", op: "in", value: ["부산"], rawText: "부산 소재", machineReadable: true }] } }),
      // G3①(2026-09-03 코덱스 2차 리뷰): fitOnly 는 이제 fit 만 남긴다 — 조건 없는 「plain」은 이제
      // unverified 로 걸러진다. 서울 소재 조건 하나로 채워 진짜 "fit" 으로 만들어야
      // truncated(topN) 검증에 쓸 두 번째 살아남는 항목이 생긴다.
      ann({ id: "plain", fundingGroup: "policy", region: "서울", ruleStructure: { ...EMPTY_RULE, conditions: [{ key: "region", op: "in", value: ["서울"], rawText: "서울 소재", machineReadable: true }] } }),
    ]);
    // ★재설계 계약 G1①(2026-09-04) — 옛 fitOnly 는 없어졌다. topN 만 넘기면 기본
    // (includeExcluded:false)이 안 맞음(no)만 뺀다 — ok·plain 은 둘 다 fit 이라 policy.total 은 그대로 2.
    const data = await buildFundingMap({ region: "서울" }, NOW, { topN: 1 });
    const policy = data.groups.find((b) => b.group === "policy")!;
    expect(policy.total).toBe(2); // 안 맞음 1건은 기본 필터로 빠졌다
    expect(policy.items).toHaveLength(1);
    expect(policy.truncated).toBe(true);
    expect(policy.items[0].id).toBe("a:ok"); // "ok"·"plain" 동점 — 정렬 안정성으로 원래(먼저 온) 순서 유지
    // 손 등록 상시 상품 5건은 대조 규칙이 비어 있어(targetRules:{}) unverified 다 — 옛 fitOnly 라면
    // 전부 걸러졌지만, 새 기본은 안 맞음(excluded)만 빼므로 unverified·fit 은 전부 「열림」에 남는다.
    expect(data.glance.open).toBe(2 + MANUAL_N);
  });

  it("정렬을 이자 낮은 순으로 바꾸면 갈래 안 차례가 바뀐다", async () => {
    productFindMany.mockResolvedValue([
      prod({ id: "hi", rateMin: 9.9 }),
      prod({ id: "lo", rateMin: 2.1 }),
    ]);
    const data = await buildFundingMap({}, NOW, { sort: "rate" });
    const bank = data.groups.find((b) => b.group === "bank")!;
    expect(bank.items.map((x) => x.id)).toEqual(["p:lo", "p:hi"]);
  });

  it("72시간 안에 처음 본 항목은 새 것으로 표시한다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "new", firstSeenAt: new Date(NOW.getTime() - 10 * 3_600_000) }),
      ann({ id: "old", firstSeenAt: new Date(NOW.getTime() - 10 * DAY) }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:new")!.isNew).toBe(true);
    expect(byId(data.groups, "a:old")!.isNew).toBe(false);
  });

  it("상품 갈래 칸이 이상하면 기관 성격으로 다시 붙인다 — 은행 상품이 미분류로 새지 않는다", async () => {
    productFindMany.mockResolvedValue([prod({ id: "bad", fundingGroup: "" })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:bad")!.group).toBe("bank");
    expect(data.unclassified).toBe(0);
  });
  it("접수가 아직 시작 안 한 공고는 「N일 뒤 접수」 — 「지금 신청 가능」에서 뺀다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "up", applyStart: new Date(NOW.getTime() + 5 * DAY), applyEnd: kstEnd("2026-12-31") }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "a:up")!;
    expect(item.deadline.kind).toBe("upcoming");
    expect(item.deadline.dDay).toBe(5);
    expect(item.deadline.text).toBe("5일 뒤 접수");
    expect(data.glance.open).toBe(MANUAL_N); // 접수 예정 공고는 「지금 신청 가능」이 아니다

    const openOnly = await buildFundingMap({}, NOW, { filters: { openOnly: true } });
    expect(byId(openOnly.groups, "a:up")).toBeUndefined();
  });

  it("손 등록 명부는 회차에 없어 지도가 상수로 직접 합친다 — 출처 manual·번호 p:manual:", async () => {
    const data = await buildFundingMap({}, NOW);
    const manual = itemsOf(data.groups).filter((x) => x.source === "manual");
    expect(manual).toHaveLength(MANUAL_N);
    expect(manual.every((x) => x.kind === "product" && x.id.startsWith("p:manual:"))).toBe(true);

    const angel = byId(data.groups, "p:manual:angel-matching-fund")!;
    expect(angel).toMatchObject({ group: "invest", title: "엔젤투자매칭펀드", agency: "한국벤처투자(KVIC)" });
    expect(angel.deadline.kind).toBe("always");
    expect(angel.isNew).toBe(false); // 상수라 「처음 본 날」이 없다 — 새 것으로 지어내지 않는다
    expect(angel.fit).toHaveLength(1); // 업력 7년 이하 — 기계 조건 한 개
    expect(byId(data.groups, "p:manual:kodit-guarantee-window")!.group).toBe("guarantee");
    expect(() => JSON.stringify(data)).not.toThrow();
  });

  it("손 등록 줄도 같은 사업의 공고가 있으면 접힌다 — DB 상품과 접기 규칙이 같다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "kg", title: "신용보증기금 보증 창구", agency: "신용보증기금", fundingGroup: "guarantee" }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:manual:kodit-guarantee-window")).toBeUndefined();
    expect(byId(data.groups, "a:kg")!.relatedProductId).toBe("manual:kodit-guarantee-window");
    expect(byId(data.groups, "p:manual:kibo-guarantee-window")).toBeDefined(); // 나머지는 그대로
  });

  it("수집기가 같은 상품을 이미 받아 왔으면 손 등록 줄은 싣지 않는다 — 한 사업이 두 줄로 보이지 않게", async () => {
    productFindMany.mockResolvedValue([
      prod({ id: "dup", name: "엔젤투자매칭펀드", institution: "한국벤처투자(KVIC)", fundingGroup: "invest" }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:manual:angel-matching-fund")).toBeUndefined();
    expect(byId(data.groups, "p:dup")).toBeDefined();
    expect(itemsOf(data.groups).filter((x) => x.source === "manual")).toHaveLength(MANUAL_N - 1);
  });

  it("기계로 못 재는 필수조건 원문도 체크리스트에 「확인 필요」로 실린다 — 조용히 「맞음」이 되지 않게", async () => {
    productFindMany.mockResolvedValue([
      prod({
        id: "hc",
        targetText: "폐업(예정) 소상공인",
        targetRules: { humanCheck: ["폐업(예정) 소상공인", "운영사 추천 필요"] },
      }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const item = byId(data.groups, "p:hc")!;
    expect(item.humanCheck).toBe(2);
    expect(item.fitVerdict).toBe("unverified"); // 근거 없이 「맞음」으로 올라가지 않는다
    expect(item.fit.map((f) => f.label)).toEqual(["기타 폐업(예정) 소상공인", "기타 운영사 추천 필요"]);
    expect(item.fit.every((f) => f.verdict === "unknown")).toBe(true);
    expect(item.why).toContain("확인 필요");
  });

  it("거르기 전 전체와 거른 뒤 건수를 함께 준다 — 화면 발 hint 가 「표시/조건에 맞는/전체」를 말한다", async () => {
    const region = (sido: string) => ({
      ...EMPTY_RULE,
      conditions: [{ key: "region", op: "in", value: [sido], rawText: `${sido} 소재`, machineReadable: true }],
    });
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "ok", fundingGroup: "policy", region: "서울", ruleStructure: region("서울") }),
      ann({ id: "no", fundingGroup: "policy", region: "부산", ruleStructure: region("부산") }),
    ]);
    productFindMany.mockResolvedValue([]);

    // ★재설계 계약 G1①(2026-09-04) — 기본(includeExcluded:false)이 이제 안 맞음("no")을 뺀다(예전
    // 기본은 아무것도 안 걸렀다). "no"(부산, 타지역이라 안 맞음) 1건이 필터로 빠져 filtered 는
    // all 보다 1 적다 — "ok"(fit) 1건 + 손 등록 상시 상품(unverified 지만 안 맞음이 아니라 남음).
    const all = await buildFundingMap({ region: "서울" }, NOW);
    expect(all.totals).toEqual({ all: 2 + MANUAL_N, filtered: 1 + MANUAL_N });

    /**
     * ★뜻이 바뀐 기대값(코덱스 11차 #2·#4, 2026-09-04) — 예전엔 includeExcluded:true 가 안 맞음을
     *  **같은 목록에** 되살려 `filtered` 가 `all` 과 같아졌다. 이제 안 맞음은 갈래마다
     *  `excludedItems` 로 따로 실리므로 `filtered`(= 갈래 칸 `total` 의 합, 정상 건수)는 스위치와
     *  무관하게 그대로다. 「안 맞음이 몇 건인가」는 갈래 칸 `excluded` 가 말한다.
     */
    const withExcluded = await buildFundingMap({ region: "서울" }, NOW, { filters: { includeExcluded: true } });
    expect(withExcluded.totals).toEqual({ all: 2 + MANUAL_N, filtered: 1 + MANUAL_N });
    expect(withExcluded.groups.find((b) => b.group === "policy")!.excluded).toBe(1);
    expect(
      withExcluded.groups.find((b) => b.group === "policy")!.excludedItems?.map((x) => x.id),
      "켜면 안 맞음 줄이 별도 목록으로 실린다",
    ).toEqual(["a:no"]);
  });

  /**
   * ★재설계 계약 G1②(2026-09-04) — 갈래 칸의 `excluded` 는 필터 **전** 그 갈래의 안 맞음 개수라
   * 「안 맞아서 뺀 K건 보기」 단추(G2 `groupFooterWords`)가 실제 건수를 받는다. 이 파일
   * (`funding-map-build.ts`)은 G1 소유 목록엔 없지만 `groupBlocks` 의 유일한 실서비스 호출자라
   * `allItems`(필터 전 전체)를 넘겨야 한다 — 안 넘기면 `shown`(이미 필터된 목록) 안에서만 세어
   * `excluded` 가 항상 0 이 된다(통합 단계 G4 에서 발견해 고친 구현 결함 — 이 시험이 없으면
   * 「안 맞아서 뺀 K건 보기」 단추가 배포에서 늘 0건으로 보인다).
   */
  it("갈래 칸의 excluded 는 기본 필터로 화면에서 빠진 항목도 센다 — 「안 맞아서 뺀 K건 보기」 단추 근거", async () => {
    const region = (sido: string) => ({
      ...EMPTY_RULE,
      conditions: [{ key: "region", op: "in", value: [sido], rawText: `${sido} 소재`, machineReadable: true }],
    });
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "ok1", fundingGroup: "policy", region: "서울", ruleStructure: region("서울") }),
      ann({ id: "no1", fundingGroup: "policy", region: "부산", ruleStructure: region("부산") }),
      ann({ id: "no2", fundingGroup: "policy", region: "대구", ruleStructure: region("대구") }),
    ]);
    productFindMany.mockResolvedValue([]);

    const data = await buildFundingMap({ region: "서울" }, NOW); // 기본 includeExcluded:false
    const policy = data.groups.find((b) => b.group === "policy")!;
    expect(policy.total, "화면엔 맞음 1건만 보인다").toBe(1);
    expect(policy.items.map((x) => x.id)).toEqual(["a:ok1"]);
    expect(policy.excluded, "안 맞음 2건은 화면엔 없어도 개수는 남는다").toBe(2);

    // 다른 갈래(grant)는 이 시험에서 항목이 없으니 excluded 도 0 — 단추 자체가 안 뜬다.
    const grant = data.groups.find((b) => b.group === "grant")!;
    expect(grant.excluded).toBe(0);
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 코덱스 11차 대장(2026-09-04) — 「안 맞아서 뺀 항목 보기」를 **서버가 갈래별로 따로 실어 주는**
   * 설계로 바꿨다. 전역 재조회 + 클라이언트 숨김이던 예전 방식이 topN·중복 제거·집계·표를
   * 전부 흔들었다(#2·#4·#5·#15·#16).
   * ────────────────────────────────────────────────────────────────────── */
  const 지역조건 = (sido: string) => ({
    ...EMPTY_RULE,
    conditions: [{ key: "region", op: "in", value: [sido], rawText: `${sido} 소재`, machineReadable: true }],
  });

  it("정상 3·안 맞음 1 에 topN 3 — items 는 정상 3건 그대로, 안 맞음은 excludedItems 로 따로(11차 #2)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "ok1", fundingGroup: "policy", region: "서울", ruleStructure: 지역조건("서울") }),
      ann({ id: "ok2", fundingGroup: "policy", region: "서울", ruleStructure: 지역조건("서울") }),
      ann({ id: "ok3", fundingGroup: "policy", region: "서울", ruleStructure: 지역조건("서울") }),
      ann({ id: "no1", fundingGroup: "policy", region: "부산", ruleStructure: 지역조건("부산") }),
    ]);
    productFindMany.mockResolvedValue([]);

    const data = await buildFundingMap({ region: "서울" }, NOW, {
      topN: 3,
      filters: { includeExcluded: true },
    });
    const policy = data.groups.find((b) => b.group === "policy")!;
    // 예전(한 목록에 섞어 topN)이면 안 맞음이 자리를 차지해 정상 3건이 다 못 실리거나
    // 안 맞음이 응답에서 통째로 사라졌다 — 이제 두 목록이 각자 topN 을 갖는다.
    expect(policy.items.map((x) => x.id)).toEqual(["a:ok1", "a:ok2", "a:ok3"]);
    expect(policy.truncated, "정상은 3건뿐이라 잘린 게 없다").toBe(false);
    expect(policy.excludedItems?.map((x) => x.id)).toEqual(["a:no1"]);
    expect(policy.excluded).toBe(1);
  });

  it("안 맞음 개수도 다른 칩(7일 내 마감)을 통과한 것만 센다(11차 #3)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "no-soon", fundingGroup: "policy", region: "부산", ruleStructure: 지역조건("부산"), applyEnd: kstEnd("2026-09-06") }),
      ann({ id: "no-far", fundingGroup: "policy", region: "부산", ruleStructure: 지역조건("부산"), applyEnd: kstEnd("2026-12-31") }),
    ]);
    productFindMany.mockResolvedValue([]);

    const data = await buildFundingMap({ region: "서울" }, NOW, {
      filters: { soonOnly: true, includeExcluded: true },
    });
    const policy = data.groups.find((b) => b.group === "policy")!;
    expect(policy.excluded, "먼 마감 안 맞음은 「7일 내 마감」 칩에서 빠졌으니 세지 않는다").toBe(1);
    expect(policy.excludedItems?.map((x) => x.id)).toEqual(["a:no-soon"]);
  });

  it("같은 제목·기관의 안 맞음 공고가 있어도 맞는 상품은 그대로 남는다 — 스위치와 무관(11차 #4)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "d4", title: "소공인특화자금", agency: "중소벤처기업진흥공단", fundingGroup: "policy", region: "부산", ruleStructure: 지역조건("부산") }),
    ]);
    productFindMany.mockResolvedValue([
      prod({ id: "pd4", name: "소공인특화자금", institution: "중소벤처기업진흥공단", fundingGroup: "policy", targetRules: { region: ["서울"] } }),
    ]);

    for (const includeExcluded of [false, true]) {
      const data = await buildFundingMap({ region: "서울" }, NOW, { filters: { includeExcluded } });
      const shownIds = shownOf(data.groups).map((x) => x.id);
      expect(shownIds, `includeExcluded=${includeExcluded}`).toContain("p:pd4");
      expect(shownIds, "안 맞음 공고는 정상 목록에 없다").not.toContain("a:d4");
      // 안 맞음 공고는 상품을 접지 못한다 — 접으면 맞는 상품이 안 맞음 목록 뒤로 숨는다
      expect(byId(data.groups, "a:d4")?.relatedProductId).toBeUndefined();
    }
  });

  /**
   * ★코덱스 12차 #5(2026-09-04) — 같은 사업이 공고와 상시 상품 두 곳에 있을 때 공고만 남기는
   *  중복 제거가 **정상 풀에만** 걸려 있었다. 둘 다 안 맞음이면 안 맞음 목록에 같은 사업이 두 줄로
   *  뜨고 「안 맞아서 뺀 K건」도 하나 더 세어졌다 — 사람은 서로 다른 사업으로 읽는다.
   *  접기는 **풀 안에서만** 돈다(정상 풀의 공고가 안 맞음 상품을 삼키거나 그 반대가 되면
   *  맞는 항목이 안 맞음 뒤로 숨는다 — 11차 #4 시험이 그 경계를 지킨다).
   */
  it("안 맞음 풀에도 공고·상품 중복 제거가 걸린다 — 둘 다 안 맞음이면 한 줄·개수도 1(12차 #5)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "d5", title: "소공인특화자금", agency: "중소벤처기업진흥공단", fundingGroup: "policy", region: "부산", ruleStructure: 지역조건("부산") }),
    ]);
    productFindMany.mockResolvedValue([
      prod({ id: "pd5", name: "소공인특화자금", institution: "중소벤처기업진흥공단", fundingGroup: "policy", targetRules: { region: ["부산"] } }),
    ]);

    const data = await buildFundingMap({ region: "서울" }, NOW, { filters: { includeExcluded: true } });
    const policy = data.groups.find((b) => b.group === "policy")!;
    expect(policy.excludedItems?.map((x) => x.id), "공고 줄만 남는다").toEqual(["a:d5"]);
    expect(policy.excluded, "개수도 한 줄로 센다").toBe(1);
    // 접힌 상품 번호는 공고 줄에 남는다 — 숨겨서 잃는 것이 없게(정상 풀과 같은 규칙)
    expect(byId(data.groups, "a:d5")!.relatedProductId).toBe("pd5");
  });

  it("한눈에 4칸은 includeExcluded 를 켜도 정상만 센다(11차 #16)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "ok9", fundingGroup: "policy", region: "서울", ruleStructure: 지역조건("서울") }),
      ann({ id: "no9", fundingGroup: "policy", region: "부산", ruleStructure: 지역조건("부산") }),
    ]);
    productFindMany.mockResolvedValue([]);

    const 기본 = await buildFundingMap({ region: "서울" }, NOW);
    const 켬 = await buildFundingMap({ region: "서울" }, NOW, { filters: { includeExcluded: true } });
    expect(기본.glance.open).toBe(1 + MANUAL_N);
    expect(켬.glance.open, "안 맞음을 실어 보내도 「지금 신청 가능」은 그대로다").toBe(1 + MANUAL_N);
  });

  /**
   * ★코덱스 11차 #12(2026-09-04) — 「사업자당·차주당」은 「기업 한 곳당 한도」를 뜻하는 표지인데
   *  앞면 「얼마」 글자를 짓는 낱말 목록(AMOUNT_WORD_RE)에는 없어, 저장 때 살린 표지가 화면에서
   *  다시 사라졌다(「한도 300억원」). 두 곳이 같은 표지를 봐야 글자와 숫자가 같은 것을 가리킨다.
   */
  it("앞면 「얼마」 글자도 「사업자당」 표지를 남긴다(11차 #12)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "amt", amountText: "사업자당 지원한도 300억원", amountMaxWon: BigInt(30_000_000_000) }),
    ]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:amt")!.amountText).toBe("사업자당 한도 300억원");
  });

  // ── 같은 공고가 수집원 두 곳에서 들어온 자리(2026-09-03 운영 실측: 한도 큰 순 1·2위가
  //    제목·기관·금액까지 똑같은 두 줄이었다 — 「경영안정자금(이자차액보전) 8차」). ──
  const KEY = "2026년중소기업육성자금경영안정자금이자차액보전지원공고8차|경상북도";

  it("같은 공고가 수집원 두 곳에서 들어오면(dedupKey 같음) 한 줄만 싣는다 — 묶은 수·번호를 대표에 남긴다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "b1", source: "bizinfo", dedupKey: KEY }),
      ann({ id: "b2", source: "gb-board", dedupKey: KEY }),
    ]);
    const data = await buildFundingMap({}, NOW);

    const 공고 = itemsOf(data.groups).filter((x) => x.kind === "announcement");
    expect(공고.map((x) => x.id), "두 수집본이 한 줄로 접혀야 한다").toEqual(["a:b1"]);
    expect(공고[0].groupCount).toBe(2);
    expect(공고[0].groupIds).toEqual(["b1", "b2"]);
    // 거르기 전 전체(totals.all)도 묶은 뒤 건수다 — 아니면 화면 발 hint 가 없는 줄까지 센다
    expect(data.totals).toEqual({ all: 1 + MANUAL_N, filtered: 1 + MANUAL_N });

    // 혼자인 줄에는 묶음 표식을 붙이지 않는다 — 「외 0곳」 같은 뜻 없는 딱지가 생긴다
    loadOpenAnnouncements.mockResolvedValue([ann({ id: "solo", dedupKey: KEY })]);
    const 혼자 = await buildFundingMap({}, NOW);
    expect(byId(혼자.groups, "a:solo")!.groupCount).toBeUndefined();
    expect(byId(혼자.groups, "a:solo")!.groupIds).toBeUndefined();

    // 번호는 20개까지만 싣는다(응답 크기) — 묶은 수는 그대로 25 로 적는다
    loadOpenAnnouncements.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ann({ id: `m${String(i).padStart(2, "0")}`, dedupKey: KEY })),
    );
    const 많음 = await buildFundingMap({}, NOW);
    const 대표25 = itemsOf(많음.groups).filter((x) => x.kind === "announcement")[0];
    expect(대표25.groupCount).toBe(25);
    expect(대표25.groupIds).toHaveLength(20);
    expect(대표25.groupIds![0]).toBe("m00");
  });

  it("대표는 판정 → 조건 수 → 마감 → 번호 차례로 고른다", async () => {
    const 지역 = (sido: string) => ({
      ...EMPTY_RULE,
      conditions: [{ key: "region", op: "in", value: [sido], rawText: `${sido} 소재`, machineReadable: true }],
    });
    // 프로필이 비면 둘 다 「확인 필요」로 남는 조건 — 판정을 같게 두고 **조건 수만** 다르게 한다.
    const 모름 = (n: number) => ({
      ...EMPTY_RULE,
      conditions: [
        { key: "creditScoreMin", op: "gte", value: 700, rawText: "신용점수 700 이상", machineReadable: true },
        { key: "employeeMin", op: "gte", value: 5, rawText: "상시근로자 5명 이상", machineReadable: true },
      ].slice(0, n),
    });
    /**
     * 두 수집본을 같은 열쇠로 넣고 살아남은 한 줄(대표)을 돌려준다.
     * ★재설계 계약 G1①(2026-09-04) — 대표 고르기(①)가 「안 맞음이 섞이면 안 맞음이 대표」를 검사하는
     * 자리라, 기본(includeExcluded:false)만 쓰면 그 대표(안 맞음 판정)가 화면에서 곧장 걸러져 묶음이
     * 통째로 사라진다. `includeExcluded:true` 로 안 맞음도 보이게 켜야 대표의 판정을 검사할 수 있다.
     */
    const 대표 = async (rows: Array<Record<string, unknown>>, profile: Record<string, unknown> = {}) => {
      loadOpenAnnouncements.mockResolvedValue(rows.map((o) => ann({ dedupKey: KEY, ...o })));
      const data = await buildFundingMap(profile, NOW, { filters: { includeExcluded: true } });
      const 실린 = itemsOf(data.groups).filter((x) => x.kind === "announcement");
      expect(실린, "묶었으면 한 줄만 남는다").toHaveLength(1);
      return 실린[0];
    };

    /**
     * ① 판정 — **안 맞음이 섞였으면 안 맞음이 대표**, 그 밖에는 맞음 > 확인 필요.
     *
     * ★기대값 변경(2026-09-03 코덱스 적대 리뷰 #1 높음) — 예전엔 첫 줄이 `a:z_unv` 였다.
     *   「안 맞음 + 확인 필요」 묶음에서 확인 필요를 대표로 세우면, 한 수집본에서 **대상이 아님이
     *   증명된** 사업이 조건을 덜 읽은 쌍둥이 뒤에 숨는다. 추천 통로(recommend/route.ts 의
     *   excludedKeys)는 그런 묶음을 통째로 버리는데, 지도만 「확인 필요」로 보여 주면 같은 사업이
     *   두 화면에서 다르게 읽힌다. 지도는 누락 0 이라 버리지는 않고 안 맞음 줄을 대표로 세운다.
     */
    expect((await 대표([{ id: "a_no", ruleStructure: 지역("부산") }, { id: "z_unv" }], { region: "서울" })).id).toBe("a:a_no");
    expect((await 대표([{ id: "a_unv" }, { id: "z_fit", ruleStructure: 지역("서울") }], { region: "서울" })).id).toBe("a:z_fit");

    // ② 조건 수 — 판정이 같으면 더 많이 대조한 수집본
    expect((await 대표([{ id: "a_one", ruleStructure: 모름(1) }, { id: "z_two", ruleStructure: 모름(2) }])).id).toBe("a:z_two");

    // ③ 마감 — 조건 수도 같으면 마감이 가까운 쪽. 마감일이 없는 줄은 뒤로.
    expect((await 대표([{ id: "a_late", applyEnd: kstEnd("2026-12-31") }, { id: "z_soon", applyEnd: kstEnd("2026-09-10") }])).id).toBe("a:z_soon");
    expect((await 대표([{ id: "a_none", applyEnd: null }, { id: "z_dated", applyEnd: kstEnd("2026-12-31") }])).id).toBe("a:z_dated");

    // ④ 번호 — 나머지가 다 같으면 사전순 앞. 묶음 번호도 같은 차례로 실린다.
    const 동률 = await 대표([{ id: "z9" }, { id: "a1" }]);
    expect(동률.id).toBe("a:a1");
    expect(동률.groupIds).toEqual(["a1", "z9"]);
  });

  it("dedupKey 가 빈 두 줄은 그대로 두 줄 — 빈 값끼리 묶이면 다른 공고가 사라진다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "n1", title: "가 공고", dedupKey: "" }),
      ann({ id: "n2", title: "나 공고", dedupKey: "" }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const 공고 = itemsOf(data.groups).filter((x) => x.kind === "announcement");
    expect(공고.map((x) => x.id)).toEqual(["a:n1", "a:n2"]);
    expect(공고.every((x) => x.groupCount === undefined && x.groupIds === undefined)).toBe(true);
    expect(data.totals.all).toBe(2 + MANUAL_N);
  });
  // ── 코덱스 적대 리뷰(2026-09-03) #1 높음 — 묶음 판정은 추천 통로(recommend/route.ts 의 excludedKeys)와 같게 ──
  //   fit 을 무조건 앞세우면 「한 수집본에서 불일치가 증명된 사업」이 빈약한 쌍둥이로 되살아나 맞는 것처럼 보인다.
  it("묶음에 「안 맞음」이 하나라도 있으면 대표도 판정도 「안 맞음」 — fit 쌍둥이가 가리지 못한다", async () => {
    const 지역 = (sido: string) => ({
      ...EMPTY_RULE,
      conditions: [{ key: "region", op: "in", value: [sido], rawText: `${sido} 소재`, machineReadable: true }],
    });
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "a_fit", source: "bizinfo", dedupKey: KEY, ruleStructure: 지역("서울") }),
      ann({ id: "z_no", source: "gb-board", dedupKey: KEY, ruleStructure: 지역("부산") }),
    ]);
    // ★재설계 계약 G1①(2026-09-04) — 대표(z_no)의 판정이 안 맞음이라 기본 필터에서는 곧장 걸러진다.
    // includeExcluded:true 로 켜야 그 대표를 검사할 수 있다.
    const data = await buildFundingMap({ region: "서울" }, NOW, { filters: { includeExcluded: true } });

    const 공고 = itemsOf(data.groups).filter((x) => x.kind === "announcement");
    expect(공고, "묶었으면 한 줄만 남는다").toHaveLength(1);
    expect(공고[0].id, "안 맞음 수집본이 대표").toBe("a:z_no");
    expect(공고[0].fitVerdict).toBe("excluded");
    expect(공고[0].why, "이유도 그 줄의 것").toContain("대상 아님");
    expect(공고[0].groupCount).toBe(2);
    expect(공고[0].groupIds, "번호 차례도 안 맞음 줄이 앞").toEqual(["z_no", "a_fit"]);
  });

  it("안 맞음이 여럿이면 그 안에서 조건 수 → 마감 → 번호 차례로 대표를 고른다", async () => {
    const 부산 = { key: "region", op: "in", value: ["부산"], rawText: "부산 소재", machineReadable: true };
    const 신용 = { key: "creditScoreMin", op: "gte", value: 700, rawText: "신용점수 700 이상", machineReadable: true };
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "a_one", dedupKey: KEY, ruleStructure: { ...EMPTY_RULE, conditions: [부산] } }),
      ann({ id: "z_two", dedupKey: KEY, ruleStructure: { ...EMPTY_RULE, conditions: [부산, 신용] } }),
    ]);
    // ★재설계 계약 G1①(2026-09-04) — 이 묶음은 둘 다 안 맞음이라 기본 필터로는 대표까지 통째로
    // 걸러진다. includeExcluded:true 로 켜야 대표 고르기(조건 수 → 마감 → 번호)를 검사할 수 있다.
    const data = await buildFundingMap({ region: "서울" }, NOW, { filters: { includeExcluded: true } });

    const 공고 = itemsOf(data.groups).filter((x) => x.kind === "announcement");
    expect(공고).toHaveLength(1);
    expect(공고[0].id, "더 많이 대조한 수집본이 대표").toBe("a:z_two");
    expect(공고[0].fitVerdict).toBe("excluded");
  });

  // ── 코덱스 #2 높음 — 묶인 다른 행을 열 길이 없었다. 서랍이 같은 열쇠로 구성원을 다시 묻는다 ──
  it("항목에 dedupKey 를 실어 서랍이 구성원을 다시 물을 수 있게 한다 — 빈 열쇠는 싣지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "b1", source: "bizinfo", dedupKey: KEY }),
      ann({ id: "b2", source: "gb-board", dedupKey: KEY }),
    ]);
    const 묶임 = await buildFundingMap({}, NOW);
    expect(itemsOf(묶임.groups).filter((x) => x.kind === "announcement")[0].dedupKey).toBe(KEY);

    loadOpenAnnouncements.mockResolvedValue([ann({ id: "n1", dedupKey: "" })]);
    const 열쇠없음 = await buildFundingMap({}, NOW);
    expect(byId(열쇠없음.groups, "a:n1")!.dedupKey, "빈 열쇠로는 구성원을 물을 수 없다").toBeUndefined();
  });

  // ── 코덱스 #3 높음 — 상품 한도 글자를 40자로 자르면 원본을 잃는다(서랍에도 원본이 없다) ──
  it("상품 한도 글자(limitText)는 자르지 않는다 — 공고 「얼마」만 40자 상한", async () => {
    const 긴한도 =
      "운전자금 최대 5억원 시설자금 최대 30억원 다만 최근 3개년 평균 매출액의 3분의 1 이내에서 취급기관이 정하는 한도";
    expect(긴한도.length, "40자를 넘는 값이어야 시험이 뜻을 가진다").toBeGreaterThan(40);
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "a1", amountText: 긴한도, amountMaxWon: null }),
    ]);
    productFindMany.mockResolvedValue([prod({ id: "pl", limitText: 긴한도, limitMaxWon: null })]);

    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:pl")!.amountText, "상품은 원본 그대로").toBe(긴한도);
    expect(byId(data.groups, "a:a1")!.amountText, "공고는 40자 + …").toBe(`${긴한도.slice(0, 40)}…`);
  });

  // ── 코덱스 #5 중간 — 낱말 하나만 남겨 「업체당 최대 1억 2천만원」이 「업체당 1.2억원」이 되던 자리 ──
  it("금액 앞 구절을 통째로 남긴다 — 「업체당 최대 1억 2천만원」은 「업체당 최대 1억 2,000만원」", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "a1", amountText: "업체당 최대 1억 2천만원", amountMaxWon: BigInt(120_000_000) }),
    ]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountText).toBe("업체당 최대 1억 2,000만원");
  });

  // ── 코덱스 #6 중간 — 규칙 글자가 40자를 넘는다고 AI 문장으로 무검증 대체하던 자리 ──
  it("AI 문장에 금액 표현이 없으면 대체하지 않는다 — 「교육·컨설팅 지원」으로 바꿔치지 않는다", async () => {
    const 긴문장 =
      "지역 소상공인 경영개선 지원 사업 참여기업에 컨설팅과 교육을 제공하고 소요 비용의 일부를 사업비로 지원합니다";
    expect(긴문장.length).toBeGreaterThan(40);
    loadOpenAnnouncements.mockResolvedValue([
      ann({
        id: "a1",
        amountText: 긴문장,
        amountMaxWon: null,
        structureStatus: "done",
        structure: { ...EMPTY_RULE, supportAmountText: "교육·컨설팅 지원" },
      }),
    ]);
    productFindMany.mockResolvedValue([]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:a1")!.amountText).toBe(`${긴문장.slice(0, 40)}…`);
  });

  // ── 코덱스 #7 낮음 — 「외 N곳」이 행 수라 같은 수집원 두 행도 「외 1곳」이 되던 자리 ──
  it("묶음의 서로 다른 수집원 수를 groupSources 로 싣는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "s1", source: "bizinfo", dedupKey: KEY }),
      ann({ id: "s2", source: "bizinfo", dedupKey: KEY }),
    ]);
    const 한곳 = itemsOf((await buildFundingMap({}, NOW)).groups).filter((x) => x.kind === "announcement")[0];
    expect(한곳.groupCount, "행은 둘").toBe(2);
    expect(한곳.groupSources, "수집원은 하나").toBe(1);

    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "s1", source: "bizinfo", dedupKey: KEY }),
      ann({ id: "s2", source: "gb-board", dedupKey: KEY }),
    ]);
    const 두곳 = itemsOf((await buildFundingMap({}, NOW)).groups).filter((x) => x.kind === "announcement")[0];
    expect(두곳.groupSources).toBe(2);

    loadOpenAnnouncements.mockResolvedValue([ann({ id: "solo", dedupKey: KEY })]);
    const 혼자 = byId((await buildFundingMap({}, NOW)).groups, "a:solo")!;
    expect(혼자.groupSources, "안 묶인 줄엔 아예 없다").toBeUndefined();
  });
});

/**
 * 배포본을 실제로 눌러 본 독립 검사(2026-09-04)가 「숫자의 뜻」에서 잡아낸 세 건 — 셋 다 화면에서
 * 재현된 것이고, 셋 다 **어느 목록을 세는가**가 원인이었다. 화면은 서버가 준 수를 그대로 찍으므로
 * 이 시험들이 조립(서버)에서 못 박는다.
 */
describe("숫자의 뜻 — 독립 검사 ①②③(2026-09-04)", () => {
  /**
   * ① 「7일 안에 마감되는 것만」을 켜면 「지금 신청 가능」이 3,392 → 195 로 바뀌어 옆 칸(「7일 안에
   *   마감」 195)과 **같은 수**가 됐다. 두 칸이 같은 수를 말하면 4칸이 아무 뜻이 없다.
   *   4칸은 칩을 거치기 전 목록으로 센다 — 화면 부품 주석의 계약(「서버가 전체 자료로 센 값」)이 이것이다.
   */
  it("칩을 켜도 한눈에 4칸은 안 바뀐다 — 목록만 좁혀진다(독립 검사 ①)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "far", fundingGroup: "policy", applyEnd: kstEnd("2026-12-31"), rateMin: 3.5 }),
      ann({ id: "soon", fundingGroup: "policy", applyEnd: kstEnd("2026-09-06"), rateMin: 4.5 }),
    ]);
    const 기본 = await buildFundingMap({}, NOW);
    const 임박만 = await buildFundingMap({}, NOW, { filters: { soonOnly: true } });
    const 열린것만 = await buildFundingMap({}, NOW, { filters: { openOnly: true } });

    expect(기본.glance.open).toBe(2 + MANUAL_N);
    expect(기본.glance.soon).toBe(1);
    expect(임박만.glance, "칩을 켜도 4칸은 그대로다").toEqual(기본.glance);
    expect(열린것만.glance).toEqual(기본.glance);
    // 「지금 신청 가능」이 옆 칸과 같아지는 것이 그 버그의 모양이었다.
    expect(임박만.glance.open).not.toBe(임박만.glance.soon);
    // 목록은 실제로 좁혀졌다 — 칩이 아무 일도 안 하게 된 것이 아니다.
    expect(임박만.totals.filtered).toBe(1);
    expect(기본.totals.filtered).toBe(2 + MANUAL_N);
  });

  /**
   * ② 숫자 카드 「안 갚아도 되는 돈 0건」 바로 40px 아래 갈래 카드 「안 갚아도 되는 돈 6,287건」.
   *   타일은 맞음(fit)만, 갈래 카드는 그 갈래 정상 전체를 세고 있었다 — 상담사는 0건을 「이 회사는
   *   받을 게 없다」로 읽는다. 「가장 낮은 이자」가 「—」인데 대출 갈래엔 479건이 있던 모순도 같은 원인.
   */
  it("타일 숫자 = 갈래 카드 딱지 합 · 최저 이자도 같은 모집단(독립 검사 ②)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      // 조건이 없어 전부 「확인 필요」다 — 예전 기준(맞음만)이라면 타일이 0건·「—」를 말했다.
      ann({ id: "g1", amountMaxWon: BigInt(30_000_000) }),
      ann({ id: "g2", amountMaxWon: BigInt(50_000_000) }),
      ann({ id: "p1", fundingGroup: "policy", rateMin: 2.4 }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const grant = data.groups.find((b) => b.group === "grant")!;

    expect(grant.total, "무상 갈래 카드 딱지").toBe(2);
    expect(data.glance.grantFit, "타일과 딱지가 같은 수").toBe(grant.total);
    expect(data.glance.grantMaxWon).toBe(50_000_000);
    expect(data.glance.minRate, "화면에 「—」로 뜨던 자리").toBe(2.4);

    // 장부가 맞는지 — 갈래 딱지 합 + 「종류 미확인」 = 조립이 내는 「조건에 맞는 N건」.
    const 딱지합 = data.groups.reduce((s, b) => s + b.total, 0);
    expect(딱지합 + data.unclassified).toBe(data.totals.filtered);
  });

  /**
   * ③ 「7일 안에 마감되는 것만」을 켠 화면에서 어떤 갈래 카드에 딱지 「181건」 + 본문 「지금 조건에
   *   맞는 항목이 없습니다」 + 발치 「이 갈래 181건 중 0건만 보여 드림」이 **동시에** 떴다. 그 갈래
   *   줄이 전부 「종류 미확인」이라 화면이 맨 아래 블록으로 옮겼는데 셈은 옮긴 것을 그대로 셌다.
   */
  it("미확인만 있는 갈래는 딱지가 0 — 줄은 실려서 「종류 미확인」 블록으로 간다(독립 검사 ③)", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "u1", title: "2026년 우수기업 현판 수여식 안내", agency: "한국산업단지공단", wedlyCategory: "", fundingGroup: "", amountText: "", amountMaxWon: null }),
      ann({ id: "u2", title: "2026년 기업인 간담회 개최 알림", agency: "한국산업단지공단", wedlyCategory: "", fundingGroup: "", amountText: "", amountMaxWon: null }),
    ]);
    const data = await buildFundingMap({}, NOW);
    const grant = data.groups.find((b) => b.group === "grant")!;

    expect(data.unclassified, "두 줄 다 종류를 못 갈랐다").toBe(2);
    expect(grant.total, "카드에 남는 줄이 없으니 딱지도 0").toBe(0);
    expect(grant.fit + grant.unverified + grant.soon).toBe(0);
    expect(data.glance.grantFit).toBe(0);
    // 그래도 줄은 실려 있어야 한다 — 「종류 미확인」 블록은 갈래 칸 items 에서 모아 온다.
    expect(grant.items.map((x) => x.id)).toEqual(["a:u1", "a:u2"]);
    // 「조건에 맞는 N건」은 미확인도 센다 — 화면에 그려지는 줄이다.
    expect(data.totals.filtered).toBe(2 + MANUAL_N);
  });
});

/**
 * ★2026-09-05 브라우저 재검사 — 지도 타일 「가장 낮은 이자」가 「연 0%」로 떴다. 은행 상품이 하한
 *  미기재 자리에 0 을 저장한 것이 원인이고(「중고차할부」 rateText 「연 0.00%~17.90%」 rateMin 0,
 *  「재고금융」 「연 0.00%」 rateMin 0 — `rateMin === 0` 인 12건 전부 bank·guarantee 갈래),
 *  정작 진짜 무이자 공고(「청년창업자금 무이자 대출지원」)는 rateMin 이 비어 타일에 안 잡혔다.
 */
describe("이자 하한 — 미기재 0 을 미상으로(2026-09-05 재검사)", () => {
  it("상품 rateMin 0 · 「연 0.00%~17.90%」 → 하한은 미상, 글자는 「연 최대 17.90%」", async () => {
    productFindMany.mockResolvedValue([prod({ id: "car", name: "중고차할부", rateText: "연 0.00%~17.90%", rateMin: 0 })]);
    const data = await buildFundingMap({}, NOW);
    const it0 = byId(data.groups, "p:car")!;
    expect(it0.rateMin, "0 은 「이자가 없다」가 아니라 「안 적혔다」였다").toBeNull();
    expect(it0.rateText).toBe("연 최대 17.90%");
  });

  it("상품 rateMin 0 · 「연 0.00%」뿐이면 글자도 비운다 — 무이자 상품으로 읽히지 않게", async () => {
    productFindMany.mockResolvedValue([prod({ id: "stock", name: "재고금융", rateText: "연 0.00%", rateMin: 0 })]);
    const data = await buildFundingMap({}, NOW);
    const it0 = byId(data.groups, "p:stock")!;
    expect(it0.rateMin).toBeNull();
    expect(it0.rateText).toBe("");
  });

  /** 「이자 낮은 순」 1등이 「청년전용 보증부월세 대출」이던 뿌리 — 숫자 칸만 0 이고 글자엔 1.3% 가 적혀 있었다. */
  it("숫자 칸이 0 이어도 글자에 이자가 적혀 있으면 그 값을 쓴다 — 「(보증금)연1.3%」", async () => {
    productFindMany.mockResolvedValue([prod({ id: "rent", name: "청년전용 보증부월세 대출", rateText: "(보증금)연1.3%", rateMin: 0 })]);
    const data = await buildFundingMap({}, NOW);
    const it0 = byId(data.groups, "p:rent")!;
    expect(it0.rateMin).toBe(1.3);
    expect(it0.rateText, "「연 0…」 꼴이 아닌 문장은 손대지 않는다").toBe("(보증금)연1.3%");
  });

  it("글이 무이자라고 말하면 0 은 그대로 0 — 상품 글자도 안 건드린다", async () => {
    productFindMany.mockResolvedValue([prod({ id: "free", name: "무이자 할부", rateText: "무이자", rateMin: 0 })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:free")).toMatchObject({ rateMin: 0, rateText: "무이자" });
  });

  it("멀쩡한 상품(연 3.97%~5.90% · 3.97)은 글자도 숫자도 그대로", async () => {
    productFindMany.mockResolvedValue([prod()]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:p1")).toMatchObject({ rateMin: 3.97, rateText: "연 3.97%~5.90%" });
  });

  it("공고 제목이 무이자를 말하는데 이자 칸이 비면 「무이자」·0 으로 싣는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "gw", fundingGroup: "policy", title: "[강원] 2026년 청년창업자금 무이자 대출지원 사업시행 변경 공고", rateText: "", rateMin: null }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:gw")).toMatchObject({ rateMin: 0, rateText: "무이자" });
    expect(data.glance.minRate, "타일이 진짜 무이자를 집는다").toBe(0);
  });

  it("공고 rateMin 0 인데 무이자라는 말이 없으면 미상 — 타일이 「연 0%」로 뜨지 않는다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "z", fundingGroup: "policy", title: "2026년 중소기업 운전자금 융자 공고", rateText: "연 0.00%~4.5%", rateMin: 0 }),
      ann({ id: "ok", fundingGroup: "policy", title: "2026년 시설자금 융자 공고", rateText: "연 2.4%", rateMin: 2.4 }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:z")!.rateMin).toBeNull();
    // ★코덱스 반려 [d] — 글자 손질은 공고에도 적용된다(예전엔 상품에서만 했다).
    expect(byId(data.groups, "a:z")!.rateText, "「연 0.00%~4.5%」를 그대로 두면 화면이 무이자로 읽는다").toBe("연 최대 4.5%");
    expect(data.glance.minRate, "예전엔 0 이 이겨 「연 0%」로 떴다").toBe(2.4);
  });

  /** ★코덱스 반려 [c] — 수집기가 **일부러 비운**(null) 상품은 글자에서 다시 뽑지 않는다. */
  it("[c] 저장값이 null 인 상품은 글자에 이자가 있어도 미상 그대로 — 「보증금 이자 연 1.3%」", async () => {
    productFindMany.mockResolvedValue([prod({ id: "keep", rateText: "보증금 이자 연 1.3%", rateMin: null })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:keep")).toMatchObject({ rateMin: null, rateText: "보증금 이자 연 1.3%" });
  });

  /** ★코덱스 반려 [d] — 꼬리(「(신용등급별)」)는 원문 공백째로 남긴다. 자르면 단서가 사라진다. */
  it("[d] 「연 0.00%~17.90% (신용등급별)」 → 「연 최대 17.90% (신용등급별)」", async () => {
    productFindMany.mockResolvedValue([prod({ id: "grade", rateText: "연 0.00%~17.90% (신용등급별)", rateMin: 0 })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:grade")).toMatchObject({ rateMin: null, rateText: "연 최대 17.90% (신용등급별)" });
  });

  /**
   * ★코덱스 반려 [e] — 예전엔 **저장값이 null 일 때만** 「무이자」를 채웠다. 제목만 무이자를 말하고
   *  저장값이 0 이면 하한은 0 인데 글자가 비어 카드가 「공고 확인」이 됐다.
   */
  it("[e] 제목이 무이자·저장값 0·글자 빈 공고 → 0 · 「무이자」", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "y", fundingGroup: "policy", title: "청년창업 무이자 대출", rateText: "", rateMin: 0 }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:y")).toMatchObject({ rateMin: 0, rateText: "무이자" });
    expect(data.glance.minRate).toBe(0);
  });

  /** ★코덱스 반려 [b] 를 상품 갈래에서 — 저장값이 비어도 글자가 무이자면 0 이고, 글자는 그대로 남는다. */
  it("[b] 상품 저장값 null · 글자 「무이자」 → 0 · 「무이자」", async () => {
    productFindMany.mockResolvedValue([prod({ id: "nofee", rateText: "무이자", rateMin: null })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:nofee")).toMatchObject({ rateMin: 0, rateText: "무이자" });
  });

  /** ★코덱스 반려 [a] 를 조립에서 — 「대출금리 0%~17.9%」는 무이자가 아니라 하한 미기재다. */
  it("[a] 상품 「대출금리 0%~17.9%」·0 → 미상(무이자로 안 센다)", async () => {
    productFindMany.mockResolvedValue([prod({ id: "range", rateText: "대출금리 0%~17.9%", rateMin: 0 })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:range")!.rateMin, "「금리 0%」를 무이자로 세던 옛 규칙이면 0 이 된다").toBeNull();
    expect(byId(data.groups, "p:range")!.rateText, "실측 두 꼴이 아닌 문장은 원문 그대로 둔다(2차 #4·#5)").toBe("대출금리 0%~17.9%");
    expect(data.glance.minRate).toBeNull();
  });

  /** ★코덱스 2차 [6] — 상품도 **이름**을 무이자 근거로 본다(공고가 제목을 보는 것과 같은 자리). */
  it("[6] 이름이 무이자·이자 칸이 빈 상품 → 0 · 「무이자」", async () => {
    productFindMany.mockResolvedValue([
      prod({ id: "yfree", name: "청년창업 무이자 대출", rateText: "", rateMin: null }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:yfree")).toMatchObject({ rateMin: 0, rateText: "무이자" });
    expect(data.glance.minRate).toBe(0);
  });

  /** ★코덱스 2차 [7] — 재추출은 저장값이 **정확히 0** 일 때만. 음수는 자료가 깨졌다는 신호라 미상으로 둔다. */
  it("[7] 저장값이 음수면 글자에서 다시 뽑지 않는다 — 「(보증금)연1.3%」·-1 → 미상", async () => {
    productFindMany.mockResolvedValue([prod({ id: "neg", rateText: "(보증금)연1.3%", rateMin: -1 })]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "p:neg")).toMatchObject({ rateMin: null, rateText: "(보증금)연1.3%" });
  });

  /** ★코덱스 2차 [9] — 공백만 든 이자 칸은 「글자가 있다」가 아니다. 턴 뒤에 빈 것을 판정한다. */
  it("[9] 이자 칸이 공백뿐이고 제목이 무이자면 「무이자」로 채운다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "sp", fundingGroup: "policy", title: "청년창업 무이자 대출", rateText: "   ", rateMin: null }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:sp")).toMatchObject({ rateMin: 0, rateText: "무이자" });
  });

  /** ★코덱스 2차 [2] 를 조립에서 — 제목에 무이자가 들어도 저장된 실제 금리가 이긴다. */
  it("[2] 제목이 무이자여도 저장된 금리(2.5)가 이긴다 — 타일이 0 으로 안 떨어진다", async () => {
    loadOpenAnnouncements.mockResolvedValue([
      ann({ id: "chg", fundingGroup: "policy", title: "청년 무이자 대출 변경 공고", rateText: "연 2.5%", rateMin: 2.5 }),
    ]);
    const data = await buildFundingMap({}, NOW);
    expect(byId(data.groups, "a:chg")).toMatchObject({ rateMin: 2.5, rateText: "연 2.5%" });
    expect(data.glance.minRate).toBe(2.5);
  });
});
