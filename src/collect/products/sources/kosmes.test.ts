import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-03 10:21 실측,
 * `https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI004M0.do` 외 7곳 중 2곳을 저장).
 * 실측 결과 구조가 계획서 힌트("p.title-blue-20 이 자금명")와 달랐다 — 실제 파일이 정본이라
 * `dl.box-con`(dt=자금명, dd ul.bulit-text>li=필드) 기준으로 다시 확인했다(kosmes.ts 머리말 참고).
 */
const html004 = readFileSync(join(__dirname, "../__fixtures__/kosmes-SHSBI004M0.html"), "utf-8");
const html012 = readFileSync(join(__dirname, "../__fixtures__/kosmes-SHSBI012M0.html"), "utf-8");

vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { fetchKosmesAll, kosmesSource, parseKosmes } from "./kosmes";

const rows004 = parseKosmes(html004, "SHSBI004M0");
const rows012 = parseKosmes(html012, "SHSBI012M0");

describe("parseKosmes — SHSBI004M0(창업기반지원·개발기술사업화, 실사이트 고정본)", () => {
  it("융자조건 절의 dl.box-con 3건만 자금으로 남는다 — 단축키 목록 모달은 걸러진다", () => {
    expect(rows004).toHaveLength(3);
    expect(rows004.map((r) => r.name)).toEqual([
      "창업기반지원자금(일반)",
      "창업기반지원자금 (청년전용창업자금)",
      "개발기술사업화자금",
    ]);
  });

  it("출처·기관·기관형태·탭 상세주소·targetRules 는 3건 전부 같다", () => {
    for (const r of rows004) {
      expect(r.source).toBe("product-kosmes");
      expect(r.institution).toBe("중소벤처기업진흥공단");
      expect(r.institutionType).toBe("policy");
      expect(r.deadlineText).toBe("상시");
      expect(r.detailUrl).toBe("https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI004M0.do");
      expect(r.targetRules).toEqual({ scale: ["중소기업"] });
      expect(r.applyUrl).toBe("");
    }
  });

  it("★탭 상세주소는 게시판 수집기 id(kosmes) 와 겹치지 않는 접두어 product- 다", () => {
    expect(rows004[0].source).not.toBe("kosmes");
    expect(rows004[0].source.startsWith("product-")).toBe(true);
  });

  it("융자상담처 문단을 채널로 그대로 쓴다(두 탭 공통 문장)", () => {
    expect(rows004.every((r) => r.channel === "더욱 자세한 상담은 전국에 위치한 중진공 각 지역본(지)부로 문의하여 주시기 바랍니다.")).toBe(true);
  });

  it("청년전용창업자금 — 한도·금리·기간·갈래·방식이 계획서 지정값(정정 포함)과 같다", () => {
    const r = rows004.find((x) => x.name === "창업기반지원자금 (청년전용창업자금)");
    expect(r).toBeTruthy();
    expect(r).toMatchObject({
      limitText: "기업당 최대 1억원 이내 (제조업 및 중점지원분야 영위기업은 2억원 이내)",
      // extractAmount 는 "최대 1억원"만 잡지만(트리거 낱말이 "2억원" 앞엔 없다), 문장 전체를 다시
      // 훑어 트리거 없는 "2억원"까지 찾아 더 큰 값을 상한으로 쓴다(kosmes.ts limitFrom 참고).
      limitMaxWon: 200_000_000,
      rateText: "2.5% (고정금리)",
      rateMin: 2.5,
      termText: "- (직접대출, 시설) 10년 이내 (거치기간 : 담보 4년 이내, 신용 3년 이내) - (직접대출, 운전) 6년 이내 (거치기간 : 3년 이내)",
      productType: "direct-loan",
      fundingGroup: "policy",
      sourceId: "SHSBI004M0|창업기반지원자금청년전용창업자금",
    });
    expect(r?.termText).toContain("10년 이내");
  });

  it("창업기반지원자금(일반) — 한도 문장에 큰 단위가 여럿이라도 원문을 그대로 두고, 트리거 없는 상한도 잡는다", () => {
    const r = rows004.find((x) => x.name === "창업기반지원자금(일반)");
    expect(r?.limitText).toBe(
      "- (직접·대리대출) 연간 60억원 이내 (운전자금은 연간 5억원 이내) - (성장공유형) 융자계획 공고 Ⅱ. 공통사항 융자방식 참조 - (투자조건부) 융자계획 공고 Ⅱ. 공통사항 융자방식 참조",
    );
    expect(r?.limitMaxWon).toBe(6_000_000_000); // 연간 60억원
    expect(r?.fundingGroup).toBe("policy");
    expect(r?.productType).toBe("direct-loan"); // 융자방식이 "직접·대리대출…" 로 시작 — 직접대출 낱말이 없어 방식은 모름 취급
  });

  it("★「기준금리 대비 가산·차감」류(%p)는 절대금리가 아니라 rateMin 을 비운다 — 값을 지어내지 않는다", () => {
    const general = rows004.find((x) => x.name === "창업기반지원자금(일반)");
    const tech = rows004.find((x) => x.name === "개발기술사업화자금");
    expect(general?.rateMin).toBeNull();
    expect(tech?.rateMin).toBeNull();
    expect(general?.rateText).toContain("0.3%p");
    expect(general?.rateText).not.toBe(""); // 원문은 버리지 않는다
  });

  it("raw 에 탭·자금명·다섯 필드 원문을 그대로 남긴다", () => {
    const r = rows004.find((x) => x.name === "창업기반지원자금 (청년전용창업자금)");
    expect(r?.raw).toMatchObject({
      탭: "SHSBI004M0",
      자금명: "창업기반지원자금 (청년전용창업자금)",
      융자방식: "직접대출",
      대출한도: "기업당 최대 1억원 이내 (제조업 및 중점지원분야 영위기업은 2억원 이내)",
      대출금리: "2.5% (고정금리)",
    });
  });

  it("sourceId 는 탭|자금명(공백·괄호 제거) 이고 3건 모두 겹치지 않는다", () => {
    expect(new Set(rows004.map((r) => r.sourceId)).size).toBe(3);
    expect(rows004.every((r) => r.sourceId.startsWith("SHSBI004M0|"))).toBe(true);
  });
});

describe("parseKosmes — SHSBI012M0(재해·긴급경영안정, 실사이트 고정본)", () => {
  it("융자조건 절의 dl.box-con 2건만 자금으로 남는다 — 비교시점 표·단축키 목록은 걸러진다", () => {
    expect(rows012).toHaveLength(2);
    expect(rows012.map((r) => r.name)).toEqual(["긴급경영안정자금 (재해중소기업지원)", "긴급경영안정자금 (일시적경영애로)"]);
  });

  it("재해 자금 2건 모두 fundingGroup 은 urgent(계획서 지정값)", () => {
    expect(rows012.every((r) => r.fundingGroup === "urgent")).toBe(true);
  });

  it("긴급경영안정자금(재해중소기업지원) — 「N%(고정)」도 절대금리로 잡는다(금리 낱말이 숫자 뒤에 와도)", () => {
    const r = rows012.find((x) => x.name === "긴급경영안정자금 (재해중소기업지원)");
    expect(r).toMatchObject({
      limitText: "(직접대출, 운전) 피해금액 이내에서 최대 10억원(3년간 15억원 이내)",
      rateText: "(직접대출, 운전) 1.9%(고정)",
      rateMin: 1.9,
      productType: "direct-loan",
      detailUrl: "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI012M0.do",
      source: "product-kosmes",
    });
  });

  it("긴급경영안정자금(일시적경영애로) — 「+0.5%p」는 기준금리 대비 가산폭이라 rateMin 을 비운다", () => {
    const r = rows012.find((x) => x.name === "긴급경영안정자금 (일시적경영애로)");
    expect(r?.rateText).toBe("정책자금 기준금리(변동) + 0.5%p");
    expect(r?.rateMin).toBeNull();
    expect(r?.limitText).toBe("(직접대출, 운전) 10억원 이내(3년간 15억원 이내)");
  });

  it("sourceId 는 탭이 다르면 같은 이름이어도 겹치지 않는다(004 청년전용창업자금과 별개 명부)", () => {
    expect(rows012.every((r) => r.sourceId.startsWith("SHSBI012M0|"))).toBe(true);
    const all = new Set([...rows004.map((r) => r.sourceId), ...rows012.map((r) => r.sourceId)]);
    expect(all.size).toBe(rows004.length + rows012.length);
  });
});

describe("parseKosmes — fundingGroup 은 재창업·재도전·긴급·재해류만 urgent, 나머지는 policy", () => {
  it("★재창업자금(SHSBI008M0 실사이트 실측)도 urgent — 재도전과 같은 재기 취지", () => {
    const html =
      '<dl class="box-con"><dt>재창업자금</dt><dd><ul class="bulit-text">' +
      "<li>대출한도 : 기업당 최대 3억원</li></ul></dd></dl>";
    const rows = parseKosmes(html, "SHSBI008M0");
    expect(rows).toHaveLength(1);
    expect(rows[0].fundingGroup).toBe("urgent");
  });

  it("일반 자금명(창업·기술·수출 등)은 policy", () => {
    const html =
      '<dl class="box-con"><dt>내수기업수출기업화</dt><dd><ul class="bulit-text">' +
      "<li>대출한도 : 기업당 최대 5억원</li></ul></dd></dl>";
    const rows = parseKosmes(html, "SHSBI006M0");
    expect(rows[0].fundingGroup).toBe("policy");
  });
});

describe("parseKosmes — 이름이 없거나 융자조건이 없는 dl 은 자금으로 안 만든다", () => {
  it("dt 가 없는 dl.box-con 은 건너뛴다", () => {
    const html = '<dl class="box-con"><dd><ul class="bulit-text"><li>대출한도 : 1억원</li></ul></dd></dl>';
    expect(parseKosmes(html, "SHSBI999M0")).toHaveLength(0);
  });

  it("대출한도·대출기간·대출금리 셋 다 없으면 건너뛴다(단축키 목록·비교시점과 같은 모양)", () => {
    const html =
      '<dl class="box-con"><dt>단축키 목록</dt><dd><ul class="bulit-text"><li>본문으로 이동</li></ul></dd></dl>';
    expect(parseKosmes(html, "SHSBI999M0")).toHaveLength(0);
  });
});

describe("fetchKosmesAll — 탭 8곳 순서대로, 건 사이 300ms, 실패 처리", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fetchProductText).mockReset();
  });

  it("탭 8곳을 SHSBI004~012M0 순서대로 부르고 결과를 합친다", async () => {
    vi.mocked(fetchProductText).mockImplementation(async (_cfg, url: string) => {
      if (url.includes("SHSBI004M0")) return html004;
      if (url.includes("SHSBI012M0")) return html012;
      return "<html></html>"; // 006~011 은 조건 없는 셸로 흉내
    });
    const promise = fetchKosmesAll();
    await vi.runAllTimersAsync();
    const list = await promise;

    expect(fetchProductText).toHaveBeenCalledTimes(8);
    const calledUrls = vi.mocked(fetchProductText).mock.calls.map((c) => c[1]);
    expect(calledUrls).toEqual([
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI004M0.do",
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI006M0.do",
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI007M0.do",
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI008M0.do",
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI009M0.do",
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI010M0.do",
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI011M0.do",
      "https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI012M0.do",
    ]);
    expect(list).toHaveLength(5); // 004 에서 3건 + 012 에서 2건, 나머지 탭은 빈 셸이라 0건
    expect(vi.mocked(fetchProductText).mock.calls[0][0]).toEqual({ id: "product-kosmes", baseUrl: "https://www.kosmes.or.kr" });
  });

  it("★탭 1개만 실패해도 나머지 7곳이 성공했더라도 던진다 — 부분 저장은 실패 탭의 기존 상품을 「이번에 안 보임」으로 비활성화한다(코덱스 지적)", async () => {
    vi.mocked(fetchProductText).mockImplementation(async (_cfg, url: string) => {
      if (url.includes("SHSBI006M0")) throw new Error("network fail");
      if (url.includes("SHSBI004M0")) return html004;
      return "<html></html>";
    });
    const promise = fetchKosmesAll();
    promise.catch(() => {}); // unhandled rejection 경고 방지(아래서 await 로 실제 처리)
    await vi.runAllTimersAsync();
    // 메시지에 어느 탭이 왜 실패했는지 담긴다.
    await expect(promise).rejects.toThrow(/SHSBI006M0/);
    await expect(promise).rejects.toThrow(/network fail/);
  });

  it("★8곳 전부 실패하면 던진다 — 반쪽 응답을 상품으로 저장하지 않는다", async () => {
    vi.mocked(fetchProductText).mockRejectedValue(new Error("network fail"));
    const promise = fetchKosmesAll();
    promise.catch(() => {}); // unhandled rejection 경고 방지(아래서 await 로 실제 처리)
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow();
  });

  it("★전부 200 이어도 자금을 하나도 못 읽으면(선택자 붕괴) 던진다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue("<html><body>개편됨</body></html>");
    const promise = fetchKosmesAll();
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow();
  });
});

describe("kosmesSource — 명부에 실릴 모양(공통 계약)", () => {
  it("id·라벨·주소·fetchAll 이 계획대로다", () => {
    expect(kosmesSource.id).toBe("product-kosmes");
    expect(kosmesSource.label).toBe("중소벤처기업진흥공단 정책자금 융자조건");
    expect(kosmesSource.url).toBe("https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI004M0.do");
    expect(kosmesSource.fetchAll).toBe(fetchKosmesAll);
  });
});
