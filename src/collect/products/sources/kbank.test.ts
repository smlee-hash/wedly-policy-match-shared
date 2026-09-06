import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-03 10:13 실측,
 * `https://www.kbanknow.com/web/product/loan/soho-loan-custom-inquiry`) — 지어낸 JSON-LD 는
 * 선택자·키 오타를 그냥 통과시킨다.
 */
const html = readFileSync(join(__dirname, "../__fixtures__/kbank-soho.html"), "utf-8");

vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { fetchKbankAll, kbankSource, parseKbank } from "./kbank";

const PAGE_URL = "https://www.kbanknow.com/web/product/loan/soho-loan-custom-inquiry";

const rows = parseKbank(html);

describe("parseKbank — 케이뱅크 사장님대출 맞춤조회 ld+json 읽기(실사이트 고정본 3건)", () => {
  it("상품 3건 — 신용대출·보증서대출·온택트 보증서대출", () => {
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(["사장님 신용대출", "사장님 보증서대출", "사장님 온택트 보증서대출"]);
  });

  it("출처·기관·기관형태·갈래·채널·상세주소·마감은 3건 전부 같다", () => {
    for (const r of rows) {
      expect(r.source).toBe("product-kbank");
      expect(r.institution).toBe("케이뱅크");
      expect(r.institutionType).toBe("internet-bank");
      expect(r.fundingGroup).toBe("bank");
      expect(r.channel).toBe("케이뱅크 앱");
      expect(r.detailUrl).toBe(PAGE_URL);
      expect(r.deadlineText).toBe("상시");
      expect(r.applyUrl).toBe(PAGE_URL);
    }
  });

  it("첫 건(사장님 신용대출) — 금리·기간·대상·한도·조건이 실측값과 같다", () => {
    const r = rows[0];
    expect(r).toMatchObject({
      name: "사장님 신용대출",
      sourceId: "사장님신용대출",
      productType: "credit",
      rateText: "연 3.97%~5.90%",
      rateMin: 3.97,
      rateMax: 5.9,
      // ★F2① — 한도산정기준 원문은 서술형이라 숫자가 없지만, 같은 노드의 amount.maxValue(3억)가
      // 실제 상한이다(고정본 실측) — limitMaxWon 을 null 로 두던 옛 기대값은 그 필드를 놓친 버그였다.
      limitText:
        "최대 3억원 · 개인의 신용상태에 따라 차등 적용되며, 보유 중인 케이뱅크 대출 또는 타 금융기관 대출(단기, 장기 카드대출 등 포함)에 따라 한도가 차등 부여",
      limitMaxWon: 300_000_000,
      termText: "만기일시상환: 1년 단위, 최대 10년까지 연장 가능\n원리금균등분할상환: 1,2,3년 중 택 1",
      targetRules: { isCorporation: false },
    });
    expect(r.targetText).toBe(
      "단독명의 개인사업자로 휴∙폐업 없이 현재 3개월 이상 연속된 매출 발생 · 만 19세 이상 내국인 · " +
        "케이뱅크 내부 심사기준을 충족하는 고객 · 연체, 부도 등 신용도판단정보가 등록되지 않은 고객 · " +
        "회생, 파산, 면책 등을 신청하거나 확정된 사실이 없는 고객 · 케이뱅크에 손실을 끼친 이력 및 금융 사기와 사고 이력이 없는 고객 · " +
        "사업장이 현재 운영 중이며, 취급 불가 업종(도박, 유흥, 오락, 점술 등)에 해당되지 않는 고객 · " +
        "대출 신청일 기준 사업자등록증이 있으며 휴·폐업 상태가 아닌 개인사업자 · 사업장에 법인 또는 공동대표가 등재되지 않는 개인 기업 고객",
    );
  });

  it("이름에 「보증서」가 있으면 productType 은 guarantee-backed, 없으면 credit — 2건 대 1건", () => {
    const credit = rows.filter((r) => r.productType === "credit");
    const guaranteeBacked = rows.filter((r) => r.productType === "guarantee-backed");
    expect(credit.map((r) => r.name)).toEqual(["사장님 신용대출"]);
    expect(guaranteeBacked.map((r) => r.name).sort()).toEqual(["사장님 보증서대출", "사장님 온택트 보증서대출"].sort());
  });

  it("보증서대출 2건의 금리·기간·한도도 실측값과 같다", () => {
    const guarantee = rows.find((r) => r.name === "사장님 보증서대출");
    expect(guarantee).toMatchObject({
      rateText: "연 1.81%~4.91%",
      rateMin: 1.81,
      rateMax: 4.91,
      termText: "", // loanTerm 자체가 없다(실측) — 지어내지 않고 빈 값
      // ★F2① — amount.maxValue(1억)를 이제 읽는다(고정본 실측). 옛 null 기대값은 버그를 그대로 굳힌 것.
      limitText: "최대 1억원 · 신용보증재단의 심사를 통해 결정되며 보증서대출 최대한도는 보증상품 종류에 따라 상이",
      limitMaxWon: 100_000_000,
    });

    const ontact = rows.find((r) => r.name === "사장님 온택트 보증서대출");
    expect(ontact).toMatchObject({
      rateText: "연 3.97%~4.52%",
      rateMin: 3.97,
      rateMax: 4.52,
      termText: "5년(1년거치, 4년 원금균등분할상환)",
      // ★F2① — amount.maxValue(3천만)를 이제 읽는다(고정본 실측).
      limitText: "최대 3,000만원 · 신용보증재단의 심사를 통해 결정되며 보증서대출 최대한도는 보증상품 종류에 따라 상이",
      limitMaxWon: 30_000_000,
    });
  });

  it("신청가능조건에 「법인 … 등재되지 않는」 문구가 있는 3건 모두 targetRules:{isCorporation:false}", () => {
    expect(rows.every((r) => r.targetRules.isCorporation === false)).toBe(true);
  });

  it("sourceId 는 이름에서 공백만 지운 값이고, 3건 모두 겹치지 않는다", () => {
    expect(rows.map((r) => r.sourceId)).toEqual(["사장님신용대출", "사장님보증서대출", "사장님온택트보증서대출"]);
    expect(new Set(rows.map((r) => r.sourceId)).size).toBe(3);
  });

  it("raw 에 원본 ld+json 노드를 그대로 남긴다(사람이 뒤에 대조할 수 있게)", () => {
    const r = rows[0];
    expect(r.raw).toMatchObject({ "@type": "FinancialProduct", name: "사장님 신용대출" });
  });

  it("★JSON-LD 가 아닌 script(WebSite 등)는 재료로 쓰지 않는다 — 여전히 3건", () => {
    expect((html.match(/<script type="application\/ld\+json">/g) ?? []).length).toBe(2);
  });

  it("★interestRate 가 없는 부모 FinancialProduct(「사장님대출 맞춤조회」)는 상품으로 세지 않는다", () => {
    expect(rows.some((r) => r.name === "사장님대출 맞춤조회")).toBe(false);
  });

  it("★amount(MonetaryAmount) 의 maxValue 가 있으면 limitMaxWon 을 원 단위로 채우고 limitText 앞에 「최대 N」을 붙인다(F2① — 고정본 실측: 3건 모두 있음)", () => {
    const credit = rows.find((r) => r.name === "사장님 신용대출")!;
    expect(credit.limitMaxWon).toBe(300_000_000);
    expect(credit.limitText.startsWith("최대 3억원")).toBe(true);

    const guarantee = rows.find((r) => r.name === "사장님 보증서대출")!;
    expect(guarantee.limitMaxWon).toBe(100_000_000);
    expect(guarantee.limitText.startsWith("최대 1억원")).toBe(true);

    const ontact = rows.find((r) => r.name === "사장님 온택트 보증서대출")!;
    expect(ontact.limitMaxWon).toBe(30_000_000);
    expect(ontact.limitText.startsWith("최대 3,000만원")).toBe(true);
  });
});

describe("fetchKbankAll — 실제 수집 배선", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });
  afterEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("고정 주소로 글을 받아 parseKbank 로 3건을 만든다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(html);
    const list = await fetchKbankAll();
    expect(list).toHaveLength(3);
    expect(fetchProductText).toHaveBeenCalledWith({ id: "product-kbank", baseUrl: "https://www.kbanknow.com" }, PAGE_URL);
  });

  it("★2건 미만이면 반쪽 응답으로 보고 던진다 — 빈 껍데기를 상품으로 저장하지 않는다", async () => {
    const thin = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "FinancialProduct",
          name: "단독 상품",
          interestRate: { "@type": "QuantitativeValue", description: "연 5%" },
        },
      ],
    })}</script>`;
    vi.mocked(fetchProductText).mockResolvedValue(thin);
    await expect(fetchKbankAll()).rejects.toThrow();
  });

  it("★JSON.parse 가 깨지는 ld+json 블록은 조용히 건너뛴다(사이트 오류로 전체를 던지지 않는다)", () => {
    const broken = `<script type="application/ld+json">{ 이건 JSON 이 아님 }</script>`;
    expect(parseKbank(broken)).toEqual([]);
  });
});

describe("kbankSource — 명부에 실릴 모양(공통 계약)", () => {
  it("id·라벨·주소·fetchAll 이 계획대로다", () => {
    expect(kbankSource.id).toBe("product-kbank");
    expect(kbankSource.label).toBe("케이뱅크 사장님대출 맞춤조회");
    expect(kbankSource.url).toBe(PAGE_URL);
    expect(kbankSource.fetchAll).toBe(fetchKbankAll);
  });
});
