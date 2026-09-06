import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-03 10:13 실측,
 * `https://ols.semas.or.kr/ols/man/SMAN018M/page.do`) — 지어낸 HTML 은 선택자 오타를 그냥 통과시킨다.
 */
const html = readFileSync(join(__dirname, "../__fixtures__/sbiz-loan-conditions.html"), "utf-8");

vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { fetchSbizAll, parseSbiz, sbizSource, SBIZ_DETAIL_URL } from "./sbiz";

const rows = parseSbiz(html);

describe("parseSbiz — 소진공 대출조건 표 2개 읽기(실사이트 고정본 13행)", () => {
  it("직접대출 6건 + 대리대출 7건 = 13건", () => {
    expect(rows).toHaveLength(13);
  });

  it("첫 표는 direct-loan · 둘째 표는 agency-loan — 채널 문구도 표마다 다르다", () => {
    const direct = rows.filter((r) => r.productType === "direct-loan");
    const agency = rows.filter((r) => r.productType === "agency-loan");
    expect(direct).toHaveLength(6);
    expect(agency).toHaveLength(7);
    expect(direct.every((r) => r.channel === "소진공 정책자금 누리집(ols.semas.or.kr)")).toBe(true);
    expect(agency.every((r) => r.channel === "소진공 확인서 → 취급 은행")).toBe(true);
  });

  it("출처·기관·기관형태·마감·상세주소·targetRules 는 13건 전부 같다", () => {
    for (const r of rows) {
      expect(r.source).toBe("product-sbiz");
      expect(r.institution).toBe("소상공인시장진흥공단");
      expect(r.institutionType).toBe("policy");
      expect(r.deadlineText).toBe("상시");
      expect(r.detailUrl).toBe(SBIZ_DETAIL_URL);
      expect(r.targetRules).toEqual({ scale: ["소상공인"] });
    }
  });

  it("혁신성장촉진자금 — 신청요건·대출기간을 읽고, 한도가 여럿이면 가장 큰 값을 상한으로 둔다", () => {
    const r = rows.find((x) => x.name === "혁신성장촉진자금");
    expect(r).toMatchObject({
      fundingGroup: "policy",
      targetText:
        "(혁신형) 수출, 2년 연속 매출 10% 이상 신장, 스마트 공장 도입, 강한소상공인·로컬크리에이터, 소상공인 졸업후보기업, 직접대출 성실상환 (일반형) 스마트기술, 백년소상공인, 사회연대경제조직, 신사업창업사관학교 수료생",
      termText: "(운전) 5년 (비거치 또는 거치 2년 이내) (시설) 8년 (비거치 또는 거치 3년 이내)",
      limitText: "(일반형) 운전 1억원,시설 5억원 (혁신형) 운전 2억원,시설 10억원",
      limitMaxWon: 1_000_000_000, // 혁신형 시설 10억원이 가장 크다
      rateText: "기준금리+0.4%P",
      rateMin: null,
    });
  });

  it("한도가 하나뿐인 줄은 그 값을 그대로 원으로 환산한다", () => {
    const r = rows.find((x) => x.name === "일시적경영애로자금");
    expect(r).toMatchObject({ limitText: "7천만원", limitMaxWon: 70_000_000, fundingGroup: "policy" });
  });

  it("한도가 여럿(일반형·희망형·도약형)이어도 원문은 그대로, 상한만 가장 큰 값", () => {
    const r = rows.find((x) => x.name === "재도전특별자금");
    expect(r).toMatchObject({
      limitText: "(일반형) 7천만원 (희망형) 1억원 (도약형) 2억원",
      limitMaxWon: 200_000_000,
      fundingGroup: "urgent", // 재도전
    });
  });

  it("금리 칸은 전부 「기준금리+가산폭」류라 절대 금리를 모른다 — 원문을 그대로 보여주고 rateMin 은 비운다", () => {
    expect(rows.every((r) => r.rateMin === null)).toBe(true);
    expect(rows.every((r) => r.rateText.length > 0)).toBe(true); // 빈 값 없음 — 원문을 버리지 않는다
    const gojeong = rows.find((x) => x.name === "대환대출");
    expect(gojeong?.rateText).toBe("고정금리(4.5%P)");
    const gasan = rows.find((x) => x.name === "재도전특별자금");
    expect(gasan?.rateText).toBe("기준금리+가산금리 *가산금리는 유형별 상이"); // 숫자가 없어도 지어내지 않는다
  });

  it("이름에 긴급·재도전·취약이 있으면 urgent, 그 밖은 policy — urgent 는 정확히 4건", () => {
    const urgentNames = rows.filter((r) => r.fundingGroup === "urgent").map((r) => r.name).sort();
    expect(urgentNames).toEqual(
      [
        "긴급경영안정자금 (일시적 경영애로)",
        "긴급경영안정자금 (재해피해)",
        "신용취약소상공인자금",
        "재도전특별자금",
      ].sort(),
    );
    expect(rows.filter((r) => r.fundingGroup === "policy")).toHaveLength(9);
  });

  it("자금명에 괄호·공백이 있어도 sourceId 는 공백·괄호를 지운 값이고, 13건 모두 겹치지 않는다", () => {
    const jaehae = rows.find((r) => r.name === "긴급경영안정자금 (재해피해)");
    const ilsi = rows.find((r) => r.name === "긴급경영안정자금 (일시적 경영애로)");
    expect(jaehae?.sourceId).toBe("긴급경영안정자금재해피해");
    expect(ilsi?.sourceId).toBe("긴급경영안정자금일시적경영애로");
    expect(new Set(rows.map((r) => r.sourceId)).size).toBe(13);
  });

  it("raw 에 5칸 원문을 그대로 남긴다", () => {
    const r = rows.find((x) => x.name === "소공인특화자금");
    expect(r?.raw).toMatchObject({
      자금명: "소공인특화자금",
      신청요건: "제조업을 영위하는 상시근로자수 10인 미만의 소공인",
      대출기간: "(운전) 5년(거치 2년) (시설) 8년(거치 3년)",
      대출한도: "(운전) 1억원 (시설) 5억원",
      대출금리: "기준금리+0.6%P",
    });
  });

  it("★칸이 5개보다 적은 안내 행(colspan)은 건너뛴다 — 13건 그대로", () => {
    // 두 tbody 중 첫 번째 여는 태그 뒤에만 안내 행을 심는다(고정본에 <tbody> 가 표당 하나씩 정확히 2개뿐).
    expect((html.match(/<tbody>/g) ?? []).length).toBe(2);
    const withNotice = html.replace("<tbody>", '<tbody><tr><td colspan="5">공지사항을 확인하세요</td></tr>');
    expect(parseSbiz(withNotice)).toHaveLength(13);
  });

  it("★표 자체가 없으면(사이트 개편) 그 표는 조용히 0건 — 있는 표만큼만 읽는다", () => {
    const onlyDirectTable = html.slice(0, html.indexOf("2026년 정책자금 대리대출"));
    expect(parseSbiz(onlyDirectTable)).toHaveLength(6);
  });
});

describe("fetchSbizAll — 실제 수집 배선", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });
  afterEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("고정 주소로 글을 받아 parseSbiz 로 13건을 만든다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(html);
    const list = await fetchSbizAll();
    expect(list).toHaveLength(13);
    expect(fetchProductText).toHaveBeenCalledWith(
      { id: "product-sbiz", baseUrl: "https://ols.semas.or.kr" },
      SBIZ_DETAIL_URL,
    );
  });

  it("★8건 미만이면 반쪽 응답으로 보고 던진다 — 빈 껍데기를 상품으로 저장하지 않는다", async () => {
    const thin =
      "<table><tbody>" +
      "<tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td></tr>".repeat(3) +
      "</tbody></table>";
    vi.mocked(fetchProductText).mockResolvedValue(thin);
    await expect(fetchSbizAll()).rejects.toThrow();
  });
});

describe("sbizSource — 명부에 실릴 모양(공통 계약)", () => {
  it("id·라벨·주소·fetchAll 이 계획대로다", () => {
    expect(sbizSource.id).toBe("product-sbiz");
    expect(sbizSource.label).toBe("소상공인시장진흥공단 정책자금 대출조건");
    expect(sbizSource.url).toBe("https://ols.semas.or.kr/ols/man/SMAN018M/page.do");
    expect(sbizSource.fetchAll).toBe(fetchSbizAll);
  });
});
