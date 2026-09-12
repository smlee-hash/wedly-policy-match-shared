import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));
vi.mock("../../attachment-text", () => ({ fetchAttachmentTexts: vi.fn() }));
import { fetchProductText } from "../fetch";
import { fetchAttachmentTexts } from "../../attachment-text";
import { fetchTipsAll, parseTips, tipsSource, TIPS_DETAIL_URL } from "./tips";
const html = readFileSync(join(__dirname, "../__fixtures__/tips-official-plan.html"), "utf8");
const plan = readFileSync(join(__dirname, "../__fixtures__/tips-official-plan.txt"), "utf8");
const oldHtml = readFileSync(join(__dirname, "../__fixtures__/tips-about.html"), "utf8");
const success = () => ({ text: plan, readFiles: ["plan.pdf"], failedFiles: [] as string[], skippedFiles: [] as string[], proxyFailed: false });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(fetchProductText).mockResolvedValue(html); vi.mocked(fetchAttachmentTexts).mockResolvedValue(success()); });
describe("TIPS 공식 2026 수정 공고", () => {
  it("공식 문서의 네 출연 트랙을 별개 한도와 기간으로 읽는다", () => {
    const rows = parseTips(plan);
    expect(rows.map(p => p.limitMaxWon)).toEqual([800_000_000, 1_500_000_000, 150_000_000, 150_000_000]);
    expect(rows.map(p => p.termText)).toEqual(["최대 2년(24개월)", "최대 3년(36개월)", "최대 10개월", "최대 10개월"]);
    expect(new Set(rows.map(p => p.sourceId)).size).toBe(4);
    expect(rows[0].sourceId).toBe("TIPS민간투자주도형기술창업지원");
    for (const row of rows) {
      expect(row).toMatchObject({ source: "product-tips", fundingGroup: "grant", institutionType: "policy", productType: "grant", rateMin: null, rateMax: null, detailUrl: TIPS_DETAIL_URL });
      expect(row.rateText).not.toMatch(/지분|이자|금리/);
      expect(row.deadlineText).not.toMatch(/상시|현재 접수/);
    }
  });
  it("조건부 업력과 운영사 투자·추천 조건을 보존한다", () => {
    const [general, deep] = parseTips(plan);
    expect(general.targetRules.bizAgeMaxYears).toBeUndefined();
    expect(general.targetRules.humanCheck?.join(" ")).toMatch(/7년.*신산업.*10년/);
    expect(general.targetRules.humanCheck?.join(" ")).toMatch(/수도권 2억원.*비수도권 1억원.*추천/);
    expect(deep.targetRules.humanCheck?.join(" ")).toMatch(/완료.*후속투자 5억원.*추천/);
  });
  it("비R&D의 총 자기부담 30%와 현금 10%를 혼동하지 않는다", () => {
    for (const row of parseTips(plan).slice(2)) {
      expect(row.targetRules.humanCheck?.join(" ")).toContain("자기부담 총 사업비의 30% 이상");
      expect(row.targetRules.humanCheck?.join(" ")).toContain("2026년 팁스 R&D 선정기업은 2027년부터 신청 가능");
      expect(row.limitText).toContain("합계 최대 3억원");
      expect(row.deadlineText).toContain("1분기");
    }
  });
  it("입력 문서의 바뀐 지원액을 읽고 예전 값을 조용히 돌려주지 않는다", () => {
    const next = plan.replaceAll("최대 8억원", "최대 9억원");
    expect(parseTips(next)[0].limitMaxWon).toBe(900_000_000);
  });
  it.each([
    ["빈 본문", ""], ["옛 소개 페이지", oldHtml],
    ["일반트랙 절 없음", plan.replace("(1) 팁스R&D 일반트랙", "삭제된 절")],
    ["비R&D 절 없음", plan.replace("(4) 팁스 비R&D 연계사업", "삭제된 절")],
    ["일반트랙 금액 없음", plan.replaceAll("최대 8억원", "금액 미정")],
    ["연계 금액 없음", plan.replaceAll("각 최대 1.5억원", "각 금액 미정")],
    ["연계 제한 없음", plan.replaceAll("2026년 팁스 R&D 선정기업은 2027년부터 신청 가능", "제한 미확인")],
  ])("%s이면 추정한 조건을 반환하지 않는다", (_, text) => { expect(() => parseTips(text)).toThrow(/TIPS:/); });
});
describe("현재 공고와 연결된 PDF를 매번 받는다", () => {
  it("안전한 공통 내려받기로 실제 공고의 PDF를 받고 네 트랙을 돌려준다", async () => {
    expect(await fetchTipsAll()).toHaveLength(4);
    expect(fetchProductText).toHaveBeenCalledWith({ id: "product-tips", baseUrl: "https://www.mss.go.kr/" }, TIPS_DETAIL_URL);
    const [attachments, options] = vi.mocked(fetchAttachmentTexts).mock.calls[0];
    expect(attachments).toHaveLength(1);
    const u = new URL(attachments[0].url);
    expect(u.origin).toBe("https://www.mss.go.kr");
    expect(u.pathname).toBe("/common/board/Download.do");
    expect(u.searchParams.get("bcIdx")).toBe("1066440");
    expect(options).toMatchObject({ maxFiles: 1, maxBytes: 5000000, totalCharCap: 60000, timeoutMs: 30000 });
    expect(tipsSource.fetchAll).toBe(fetchTipsAll);
  });
  it("PDF 파일명이 바뀌면 현재 HTML 링크를 따라간다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue('<a href="/common/board/Download.do?bcIdx=1066440&amp;cbIdx=310&amp;streFileNm=new-plan.pdf">지원계획.pdf</a>');
    await fetchTipsAll();
    expect(vi.mocked(fetchAttachmentTexts).mock.calls[0][0][0].url).toContain("new-plan.pdf");
  });
  it.each([
    '<p>첨부 없음</p>',
    '<a href="https://evil.example/common/board/Download.do?streFileNm=plan.pdf">계획.pdf</a>',
    '<a href="https://www.mss.go.kr/wrong.do?streFileNm=plan.pdf">계획.pdf</a>',
    '<a href="/common/board/Download.do?streFileNm=related.zip">참고.zip</a>',
  ])("잘못된 PDF 주소는 요청 전에 거부한다", async bad => {
    vi.mocked(fetchProductText).mockResolvedValue(bad);
    await expect(fetchTipsAll()).rejects.toThrow(/TIPS:/);
    expect(fetchAttachmentTexts).not.toHaveBeenCalled();
  });
  it.each(["failed", "skipped", "empty", "proxy"])("%s 첨부를 고정본으로 대체하지 않는다", async kind => {
    const response = success();
    if (kind === "failed") response.failedFiles = ["plan.pdf"];
    if (kind === "skipped") response.skippedFiles = ["plan.pdf"];
    if (kind === "empty") { response.text = ""; response.readFiles = []; }
    if (kind === "proxy") response.proxyFailed = true;
    vi.mocked(fetchAttachmentTexts).mockResolvedValue(response);
    await expect(fetchTipsAll()).rejects.toThrow(/TIPS:/);
  });
  it("공고 페이지가 실패하면 다른 사이트나 고정본을 쓰지 않는다", async () => {
    vi.mocked(fetchProductText).mockRejectedValue(new Error("official unavailable"));
    await expect(fetchTipsAll()).rejects.toThrow("official unavailable");
    expect(fetchAttachmentTexts).not.toHaveBeenCalled();
  });
});

it("조건부 업력만으로 TIPS 신청 자격을 맞음으로 판정하지 않는다", async () => {
  const { rulesToConditions } = await import("../../../funding/products/rules-to-conditions");
  const { checkCondition } = await import("../../../engine/match-engine");
  const { fitVerdictOf } = await import("../../../engine/recommend-score");
  const products = parseTips(readFileSync(join(__dirname, "../__fixtures__/tips-official-plan.txt"), "utf-8"));
  for (const product of products) {
    const checks = rulesToConditions(product.targetRules, product.targetText).map(c => checkCondition(c, { foundedDate: "2018-01-01" }, new Date("2026-09-13")));
    expect(fitVerdictOf(checks)).toBe("unverified");
  }
  expect(products[0].targetText).toContain("60%");
  expect(products[0].targetText).toContain("20억원 미만");
  expect(products[1].targetText).toContain("퇴직연금");
  expect(products[2].targetText).toContain("체납");
  expect(products[2].targetText).toContain("환수금");
  expect(products[3].targetText).toContain("글로벌 창업");
  expect(products[2].targetText).not.toContain("글로벌 창업");
  expect(products[3].targetText).not.toContain("창업사업화 지원사업");
});
