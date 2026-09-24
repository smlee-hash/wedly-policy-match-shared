import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "node-html-parser";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 네트워크 없이 고정본만 쓴다(설계 공통 규칙 9)
vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { extractRate } from "../../../funding/amount-rate-extract";
import type { NormalizedProduct } from "../types";
import { GCGF_URL, fetchGcgfAll, gcgfSource, parseGcgf } from "./gcgf";

const FIXTURE_DIR = join(__dirname, "../__fixtures__");
/** 2026-09-24 실측 고정본 — 특례보증 쪽(mi=1051). */
const HTML = readFileSync(join(FIXTURE_DIR, "gcgf-products-1051.html"), "utf8");

function byName(name: string): NormalizedProduct {
  const p = parseGcgf(HTML).find((q) => q.name === name);
  if (!p) throw new Error(`고정본에서 「${name}」을 못 읽었다`);
  return p;
}

/** raw 의 칸 사전(상품명 + 칸 이름→값). */
function fieldsOf(p: NormalizedProduct): Record<string, string> {
  return (p.raw as { fields: Record<string, string> }).fields;
}

beforeEach(() => {
  vi.mocked(fetchProductText).mockReset();
});

describe("parseGcgf — 특례보증 한 쪽(실사이트 고정본)", () => {
  it("상자 9개 → 상품 7개 — 기후위기 대응 특별보증(menu00·menu02)은 첫 것만, 표 없는 소상공인지원자금(menu05)은 빠진다", () => {
    expect(parse(HTML).querySelectorAll("div.menuBox")).toHaveLength(9);
    const rows = parseGcgf(HTML);
    expect(rows.map((p) => p.name)).toEqual([
      "경기도 중소기업 기후위기 대응 특별보증",
      "경기 관광사업자 위기극복 특별자금지원 특례보증",
      "시군(추천) 특례보증",
      "시군추천 소상공인 특례보증",
      "콘텐츠기업 지원 특례보증",
      "경기도 사회적경제기업 특례보증",
      "창업실패자 재도전 희망특례보증",
    ]);
    expect(rows.map((p) => p.name)).not.toContain("경기도 소상공인지원자금");
    // sourceId 는 이름에서 공백·괄호를 지운 값 — 「시군(추천)」과 「시군추천 소상공인」은 겹치지 않는다
    expect(rows.map((p) => p.sourceId)).toEqual([
      "경기도중소기업기후위기대응특별보증",
      "경기관광사업자위기극복특별자금지원특례보증",
      "시군추천특례보증",
      "시군추천소상공인특례보증",
      "콘텐츠기업지원특례보증",
      "경기도사회적경제기업특례보증",
      "창업실패자재도전희망특례보증",
    ]);
    expect(rows.map((p) => p.detailUrl)).toEqual(
      ["menu00", "menu03", "menu06", "menu07", "menu08", "menu09", "menu10"].map((id) => `${GCGF_URL}#${id}`),
    );
  });

  it("★기후위기 대응 특별보증 — 보증료율 「연 0.8%」, 한도는 맨 앞 5억원(뒤 소상공인 1억원은 숫자로 안 씀), 창구는 신청방법+대출은행", () => {
    const p = byName("경기도 중소기업 기후위기 대응 특별보증");
    expect(p.feeText).toBe("연 0.8%");
    expect(p.limitText).toBe(
      "(소기업) 업체당 최대 5억원 이내 (운전자금, 시설자금) (소상공인) 업체당 최대 1억원 이내 (운전자금) 보증 여부 및 금액은 심사를 통해 결정됩니다.",
    );
    expect(p.limitMaxWon).toBe(500_000_000);
    expect(p.termText).toBe("5년(2년 거치 3년 매월 원금 균등분할상환)");
    expect(p.channel).toBe(
      "신청: 재단 홈페이지 또는 콜센터(1577-5900)를 통한 예약 상담 신청 / 은행: 농협은행(경기도 내 영업점), 신한은행, 우리은행, SC제일은행, 국민은행, 하나은행, 기업은행",
    );
  });

  it("★기후위기 대응 특별보증 — 첫 표의 바깥 줄만 칸으로: 부속 표 글은 칸 글자에 들고 caption 은 빠진다, 뒤 세부 요건 표는 안 읽는다", () => {
    const p = byName("경기도 중소기업 기후위기 대응 특별보증");
    // 부속 표의 머리(지원대상·세부내용·은행…)와 세부 요건 표(태양광 설치기업…)는 칸 이름이 아니다
    expect(Object.keys(fieldsOf(p))).toEqual([
      "상품명", "지원대상", "지원한도", "신청방법", "대출은행", "대출금리", "대출기간", "보증비율", "보증료율",
    ]);
    expect(p.targetText).toMatch(/^경기도 내 사업자등록 후 정상 조업 중인 다음 기업으로 /);
    expect(p.targetText).toContain("경기RE100 산업단지 등 참여기업");
    expect(p.targetText).not.toContain("정보를 포함한 표입니다");
    // 대출금리 칸의 은행별 금리 부속 표도 같다 — 글은 들고 caption 은 빠진다
    expect(p.rateText).toContain("농협은행 MOR 6개월 + 1.45%p");
    expect(p.rateText).not.toContain("알수 있는 표");
  });

  it("관광사업자 특례보증 — 한도는 맨 앞 「본 특례보증 1억원」(※업체당 8억원·괄호 속 조건부 금액은 숫자로 안 씀)", () => {
    expect(byName("경기 관광사업자 위기극복 특별자금지원 특례보증")).toMatchObject({
      limitText: "본 특례보증 1억원 이내 (소상공인심사 5천만원 이내) ※업체당 8억원 이내(소상공인 심사1억원 이내)",
      limitMaxWon: 100_000_000,
      feeText: "1% (5년간 경기도 전액지원, 고객부담 無)",
      channel: "신청: 대면접수 또는 경기신용보증재단 이지원(Easy One)앱 / 은행: 국민, 기업, 농협, 신한, 우리, 하나",
    });
  });

  it("융자금리 줄 — 시군(추천) 특례보증은 금리 글을 융자금리에서 읽고, 신청방법 줄이 없어 창구는 은행만", () => {
    expect(byName("시군(추천) 특례보증")).toMatchObject({
      targetText: "사업장 소재지 시군이 추천한 중소기업",
      limitText: "업체당 3억원 이내 (시군별 상이)",
      limitMaxWon: 300_000_000,
      rateText: "자금종류, 기업 신용도 등에 따라 다름",
      feeText: "기업의 신용도에 따라 차등적용",
      termText: "",
      channel: "은행: 전 은행",
    });
  });

  it("금리 줄이 없는 표 — 콘텐츠기업 지원 특례보증은 금리 빈 값/null", () => {
    expect(byName("콘텐츠기업 지원 특례보증")).toMatchObject({
      limitText: "업체당 5억원 이내",
      limitMaxWon: 500_000_000,
      rateText: "",
      rateMin: null,
      feeText: "최종 산출보증료율에서 0.2% 차감",
      channel: "은행: 전 은행",
    });
  });

  it("창업실패자 재도전 희망특례보증 — 지원대상 칸 부속 표(신용회복 절차 진행자…)의 줄은 칸 이름이 아니다", () => {
    const fields = fieldsOf(byName("창업실패자 재도전 희망특례보증"));
    expect(Object.keys(fields)).toEqual(["상품명", "지원대상", "지원한도", "대출은행", "대출기간", "대출금리", "보증료율"]);
    expect(fields["지원대상"]).toContain("소액채무기업");
    expect(fields["지원대상"]).not.toContain("알수 있는 표");
  });

  it("모든 상품 — 보증 갈래·상시·경기신용보증재단, 기계 조건은 지역 경기뿐이고 대상 글은 humanCheck 한 항목(80자)", () => {
    const rows = parseGcgf(HTML);
    expect(rows).toHaveLength(7);
    for (const p of rows) {
      expect(p).toMatchObject({
        source: "product-gcgf",
        fundingGroup: "guarantee",
        institution: "경기신용보증재단",
        institutionType: "guarantee",
        productType: "guarantee",
        deadlineText: "상시",
        applyUrl: "",
        rateMax: null,
      });
      expect(p.targetText).not.toBe("");
      expect(p.targetText).toBe((p.raw as { fields: Record<string, string> }).fields["지원대상"]); // 자르지 않는다(공용 리뷰 P2)
      expect(p.targetRules).toEqual({ region: ["경기"], humanCheck: [p.targetText.slice(0, 80)] });
      expect(p.rateMin).toBe(extractRate(p.rateText).rateMin);
      expect(p.feeText).not.toBe("");
      // 고정본은 전부 대출은행 줄이 있다 — 신청방법 줄은 있는 상품만
      expect(p.channel).toMatch(/^(신청: .+ \/ )?은행: .+$/);
      expect((p.raw as { url: string }).url).toBe(p.detailUrl);
    }
  });

  it("표 없는 상자·이름 없는 상자는 상품이 아니다 — 첫 이름 다음에 다른 이름이 먼저 오면 뒤 절의 표를 붙이지 않는다", () => {
    const html = `
      <div class="menuBox" id="menu01"><h3 class="tit1">단추뿐</h3><div class="btns"><a href="#">이동</a></div></div>
      <div class="menuBox" id="menu02"><h3 class="tit1">표 없는 첫 절</h3><h3 class="tit1">둘째 절</h3>
        <table><tbody><tr><th>지원대상</th><td>도내 중소기업</td></tr></tbody></table></div>
      <div class="menuBox" id="menu03"><table><tbody><tr><th>지원대상</th><td>이름 없는 표</td></tr></tbody></table></div>`;
    expect(parseGcgf(html)).toEqual([]);
  });

  it("신청방법·대출은행 줄이 둘 다 없으면 창구는 「경기신용보증재단 지점」, 지원대상이 비면 「읽지 못함」 확인 항목, 칸 이름 공백은 지워 맞춘다", () => {
    const html = `<div class="menuBox" id="menu04"><h3 class="tit1">가상 특례보증</h3>
      <table><thead><tr><th>구분</th><th>내용</th></tr></thead>
      <tbody><tr><th>지원 한도</th><td>업체당 2억원 이내</td></tr></tbody></table></div>`;
    const [p] = parseGcgf(html);
    expect(p).toMatchObject({
      sourceId: "가상특례보증",
      targetText: "",
      limitText: "업체당 2억원 이내",
      limitMaxWon: 200_000_000,
      channel: "경기신용보증재단 지점",
      detailUrl: `${GCGF_URL}#menu04`,
    });
    // 대상 글을 못 읽으면 지역만 남아 「맞음」이 되던 것을 막는다(공용 리뷰 P1)
    expect(p?.targetRules.region).toEqual(["경기"]);
    expect(p?.targetRules.humanCheck?.[0]).toContain("읽지 못");
  });
});

describe("★대상 글 — 자르지 않고, 못 읽으면 「맞음」이 안 나오게(공용 리뷰 P1·P2)", () => {
  it("창업실패자 재도전 — 600자 뒤의 채무·재창업 요건까지 대상 글에 남는다", () => {
    const t = byName("창업실패자 재도전 희망특례보증").targetText;
    expect(t.length).toBeGreaterThan(600);
    expect(t).toContain("재창업");
  });

  it("menu09 첫 표의 tbody 가 빠지면 그 상품은 humanCheck 「읽지 못함」 + keepExisting", () => {
    const i = HTML.indexOf('id="menu09"');
    const j = HTML.indexOf("<tbody>", i);
    const k = HTML.indexOf("</tbody>", j) + "</tbody>".length;
    const broken = HTML.slice(0, j) + HTML.slice(k);
    const p = parseGcgf(broken).find((q) => q.name === "경기도 사회적경제기업 특례보증");
    expect(p).toBeDefined();
    expect(p?.targetText).toBe("");
    expect(p?.targetRules.humanCheck?.[0]).toContain("읽지 못");
    expect(p?.keepExisting).toBe(true);
  });
});

describe("fetchGcgfAll — 한 쪽 GET, 반쪽 응답은 던진다", () => {
  it("특례보증 쪽을 한 번 GET 해 7건", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(HTML);
    expect(await fetchGcgfAll()).toHaveLength(7);
    expect(vi.mocked(fetchProductText).mock.calls.map((c) => [c[1], c[2]])).toEqual([[GCGF_URL, { method: "GET" }]]);
  });

  it("5건 미만이면 던진다 — menu06 앞에서 끊긴 반쪽 응답은 2건(기후위기·관광)", async () => {
    const cut = HTML.indexOf('<div class="menuBox" id="menu06">');
    expect(cut).toBeGreaterThan(0);
    vi.mocked(fetchProductText).mockResolvedValue(HTML.slice(0, cut));
    await expect(fetchGcgfAll()).rejects.toThrow("2건뿐");
  });

  it("못 받으면 그대로 던진다", async () => {
    vi.mocked(fetchProductText).mockRejectedValue(new Error("HTTP 503"));
    await expect(fetchGcgfAll()).rejects.toThrow("HTTP 503");
  });

  it("명부 모양 — id·대표 주소(특례보증 쪽)·fetchAll", () => {
    expect(gcgfSource.id).toBe("product-gcgf");
    expect(gcgfSource.url).toBe(GCGF_URL);
    expect(gcgfSource.fetchAll).toBe(fetchGcgfAll);
  });
});
