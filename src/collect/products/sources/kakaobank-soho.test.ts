import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-06 실측,
 * `https://www.kakaobank.com/products/sohoLoans` · 200 / 77,831바이트) — 지어낸 HTML 은
 * 선택자 오타를 그냥 통과시킨다.
 */
const html = readFileSync(join(__dirname, "../__fixtures__/kakaobank-soho.html"), "utf-8");

vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import {
  fetchKakaobankSohoAll,
  kakaobankSohoSource,
  parseKakaobankSoho,
  rateHeadline,
  rateMaxOf,
  sectionText,
  summaryValue,
} from "./kakaobank-soho";

const PAGE_URL = "https://www.kakaobank.com/products/sohoLoans";
const one = parseKakaobankSoho(html)!;

describe("parseKakaobankSoho — 카카오뱅크 개인사업자 신용대출(실사이트 고정본 1건)", () => {
  it("상품명·출처·기관·갈래·마감이 실측값과 같다", () => {
    expect(one).not.toBeNull();
    expect(one).toMatchObject({
      source: "product-kakaobank-soho",
      sourceId: "카카오뱅크개인사업자신용대출",
      name: "카카오뱅크 개인사업자 신용대출",
      institution: "카카오뱅크",
      institutionType: "internet-bank",
      fundingGroup: "bank",
      productType: "credit",
      deadlineText: "상시",
      applyUrl: PAGE_URL,
      detailUrl: PAGE_URL,
    });
  });

  it("★가입대상 — 실측 조건 글이 그대로 들어온다(취급 금지업종까지)", () => {
    expect(one.targetText).toContain("사업자등록 후 영업중인 개인사업자");
    expect(one.targetText).toContain("사업자등록 상태가 휴폐업이 아닌 경우");
    expect(one.targetText).toContain("만 19세 이상 내국인");
    expect(one.targetText).toContain("회생, 파산, 면책");
    expect(one.targetText).toContain("카지노 운영업");
    // 다음 소제목(대출종류)까지 넘어가면 토막을 못 끊은 것이다
    expect(one.targetText).not.toContain("한 번에 대출금을 받아");
    // ★화면에 안 보이는 표 설명(caption)이 앞에 붙으면 안 된다
    expect(one.targetText).not.toContain("표로");
    expect(one.targetText.startsWith("사업등록증이 있는 개인사업자")).toBe(true);
  });

  it("★한도 — 「최대 3억원」으로 **시작**한다(카드가 한 줄로 잘라도 금액이 안 사라진다)", () => {
    expect(one.limitText.startsWith("최대 3억원")).toBe(true);
    expect(one.limitText).toContain("최소 대출신청 가능금액은 100만원");
    expect(one.limitMaxWon).toBe(300_000_000);
    // ★화면에 안 보이는 표 설명(caption)이 앞에 붙으면 금액이 잘려 사라진다
    expect(one.limitText).not.toContain("표로");
    expect(one.limitText).not.toContain("에 대한 안내");
  });

  it("★금리 — 구간과 기준일을 원문 그대로 남기고 숫자 두 개를 뽑는다(날마다 바뀌는 값)", () => {
    expect(one.rateText).toBe("연 3.351%~14.219% (2026.09.06 기준)");
    expect(one.rateMin).toBe(3.351);
    expect(one.rateMax).toBe(14.219);
  });

  it("대출기간·중도상환해약금이 실측 글과 같다", () => {
    expect(one.termText).toContain("만기일시상환");
    expect(one.termText).toContain("원금균등분할상환");
    expect(one.termText).not.toContain("표로");
    expect(one.feeText).toBe("중도상환해약금 면제");
  });

  it("★개인사업자 전용이라 법인 아님 조건을 싣는다", () => {
    expect(one.targetRules).toEqual({ isCorporation: false });
  });

  it("★신청 창구는 비운다 — 이 화면에 「어디서 신청하는지」가 글자로 없다(지어내지 않는다)", () => {
    expect(one.channel).toBe("");
    expect(html).not.toContain("카카오뱅크 앱");
  });
});

describe("토막 자르기·요약 읽기 도우미", () => {
  it("sectionText 는 없는 소제목에 빈 글자를 준다 — 지어내지 않는다", () => {
    expect(sectionText("<strong>대출한도</strong><p>최대 3억원</p>", "대출한도")).toBe("최대 3억원");
    expect(sectionText("<strong>대출한도</strong><p>최대 3억원</p>", "우대금리")).toBe("");
  });

  it("sectionText 는 다음 소제목에서 멈춘다", () => {
    expect(sectionText("<strong>가입대상</strong><p>가</p><strong>대출한도</strong><p>나</p>", "가입대상")).toBe("가");
  });

  it("summaryValue 는 상단 요약에서 이름표를 뗀 값을 준다", () => {
    expect(summaryValue(html, "최대한도")).toBe("3억원");
    expect(summaryValue(html, "중도상환해약금")).toBe("면제");
    expect(summaryValue(html, "없는이름표")).toBe("");
  });

  it("★rateHeadline 은 우대금리 목록이 아니라 상품 금리 구간을 집는다", () => {
    const whole = "∙ 개인사업자 신용대출 : 연 3.351% ~ 14.219% (2026.09.06 기준) … 우대금리 연 0.20% 연 0.2%";
    expect(rateHeadline(whole)).toBe("연 3.351% ~ 14.219%");
    expect(rateHeadline("연 5.5%")).toBe("연 5.5%");
    expect(rateHeadline("금리 정보 없음")).toBe("");
  });

  it("★rateHeadline 은 표가 문장보다 앞에 와도 가산금리를 상품 금리로 착각하지 않는다", () => {
    const reversed =
      "종류 기준금리 가산금리 개인사업자 신용대출 연 3.224% (금융채3개월) 연 0.663% ~ 10.448% " +
      "∙ 개인사업자 신용대출 : 연 3.351% ~ 14.219% (2026.09.06 기준)";
    expect(rateHeadline(reversed)).toBe("연 3.351% ~ 14.219%");
  });

  it("앞 20자에 기준·가산·연체금리가 있으면 그 구간은 상품 금리가 아니다", () => {
    expect(rateHeadline("가산금리 연 0.663% ~ 10.448%")).toBe("");
    expect(rateHeadline("연체금리 연 3% ~ 15%")).toBe("");
  });

  it("rateMaxOf 는 구간이 아니면 null", () => {
    expect(rateMaxOf("연 3.351%~14.219%")).toBe(14.219);
    expect(rateMaxOf("연 3.351%")).toBeNull();
    expect(rateMaxOf("")).toBeNull();
  });
});

describe("fetchKakaobankSohoAll — 반쪽 응답을 저장하지 않는다", () => {
  beforeEach(() => vi.mocked(fetchProductText).mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("고정본을 주면 1건을 만든다 — 상품 화면 한 곳만 부른다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(html);
    const list = await fetchKakaobankSohoAll();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("카카오뱅크 개인사업자 신용대출");
    expect(vi.mocked(fetchProductText)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchProductText).mock.calls[0][1]).toBe(PAGE_URL);
  });

  it("상품명을 못 읽으면 던진다 — 빈 카드를 저장하지 않는다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue("<html><body>차단 안내</body></html>");
    await expect(fetchKakaobankSohoAll()).rejects.toThrow("상품명을 못 읽었다");
  });

  it("가입대상·금리가 비면 던진다(반쪽 응답)", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(html.replaceAll("금리정보", "금리안내"));
    await expect(fetchKakaobankSohoAll()).rejects.toThrow("반쪽 응답");
  });
});

describe("수집원 등록 모양", () => {
  it("id 는 접두어 product- 를 쓴다 — 게시판 이름과 겹치면 회차가 한쪽을 건너뛴다", () => {
    expect(kakaobankSohoSource.id).toBe("product-kakaobank-soho");
    expect(kakaobankSohoSource.id.startsWith("product-")).toBe(true);
    expect(kakaobankSohoSource.url).toBe(PAGE_URL);
    expect(typeof kakaobankSohoSource.fetchAll).toBe("function");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("상품명 선택자가 한 글자 틀리면 아무것도 못 만든다", () => {
    expect(parseKakaobankSoho(html.replaceAll('class="gray"', 'class="grey"'))).toBeNull();
  });

  it("본문 아코디언 이름이 바뀌면 대상·한도·기간이 통째로 빈다", () => {
    const broken = parseKakaobankSoho(html.replaceAll('class="board_item"', 'class="board_item2"'))!;
    expect(broken.name).toBe("카카오뱅크 개인사업자 신용대출");
    expect(broken.targetText).toBe("");
    expect(broken.limitText).toBe("");
    expect(broken.limitMaxWon).toBeNull();
    expect(broken.rateText).toBe("");
    expect(broken.rateMin).toBeNull();
  });

  it("★실제 화면에서 금리 문장과 표 순서를 뒤집어도 상품 금리를 집는다", () => {
    const headline =
      "<p>∙ 개인사업자 신용대출 : 연 <span>3.351</span>% ~ <span>14.219</span>% (<span >2026.09.06</span> 기준)</p>";
    expect(html.includes(headline)).toBe(true);
    const at = html.indexOf(headline);
    const tableEnd = html.indexOf("</table>", at) + "</table>".length;
    const swapped =
      html.slice(0, at) + html.slice(at + headline.length, tableEnd) + headline + html.slice(tableEnd);
    const moved = parseKakaobankSoho(swapped)!;
    expect(moved.rateText).toBe("연 3.351%~14.219% (2026.09.06 기준)");
    expect(moved.rateMin).toBe(3.351);
    expect(moved.rateMax).toBe(14.219);
  });

  it("★표 설명(caption) 건너뛰기를 지우면 한도 글이 설명 문장으로 시작한다", () => {
    // caption 을 눈에 보이는 태그로 바꿔 「안 걷어냈을 때」를 흉내낸다 — 그러면 금액이 뒤로 밀린다.
    const kept = parseKakaobankSoho(
      html.replaceAll("<caption class=\"caption_g\">", "<p>").replaceAll("</caption>", "</p>"),
    )!;
    expect(kept.limitText).toContain("표로");
    expect(kept.limitText.startsWith("최대 3억원")).toBe(true);
  });

  it("소제목 글자가 바뀌면 그 토막만 빈다 — 옆 토막을 잘못 집지 않는다", () => {
    const broken = parseKakaobankSoho(html.replace("<strong>대출한도</strong>", "<strong>한도안내</strong>"))!;
    expect(broken.limitText).toBe("");
    expect(broken.limitMaxWon).toBeNull();
    expect(broken.targetText).toContain("사업자등록 후 영업중인 개인사업자");
  });
});
