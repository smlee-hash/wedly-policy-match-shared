import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "node-html-parser";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★실사이트 고정본으로 잰다(2026-09-24 13:00 KST, `GET https://www.seoulshinbo.co.kr/wbase/contents.do?mng_cd=…`
 * 6탭) — PC 표 상품 9개(2346 표 2·4617 1·4763 표 2·5337 한 표 두 열·5388 1·5389 1). 고정본의 함정 둘:
 * BUSI5337 모바일 블록의 옛 금액(「3천만 원」 — PC 표는 5천만원), BUSI2346 첫 표 대상기업 칸 안의 부속 표.
 */
vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import type { NormalizedProduct } from "../types";
import {
  fetchSeoulshinboAll,
  parseSeoulshinbo,
  SEOULSHINBO_TABS,
  SEOULSHINBO_URL,
  seoulshinboSource,
  seoulshinboTabUrl,
} from "./seoulshinbo";

const FIXTURE_DIR = join(__dirname, "../__fixtures__");

/** 탭 고정본 HTML. */
function page(tab: string): string {
  return readFileSync(join(FIXTURE_DIR, `seoulshinbo-${tab}.html`), "utf8");
}

/** 파싱에 쓴 원문 칸(칸 이름 → 값) — raw.fields. */
function fieldsOf(p: NormalizedProduct): Record<string, string> {
  return (p.raw as { fields: Record<string, string> }).fields;
}

/** 공백을 모두 지운다 — 요소 경계에 넣은 공백과 상관없이 글자만 견준다. */
function squash(v: string): string {
  return v.replace(/\s+/g, "");
}

/** 탭 주소마다 htmlOf(탭) 을 돌려주는 가짜 fetchProductText — undefined 면 그 탭 받기 실패. */
function serve(htmlOf: (tab: string) => string | undefined): void {
  vi.mocked(fetchProductText).mockImplementation(async (_source, url) => {
    const tab = SEOULSHINBO_TABS.find((t) => seoulshinboTabUrl(t) === String(url));
    const html = tab === undefined ? undefined : htmlOf(tab);
    if (html === undefined) throw new Error(`HTTP 503 ${String(url)}`);
    return html;
  });
}

beforeEach(() => {
  vi.mocked(fetchProductText).mockReset();
});

describe("parseSeoulshinbo — 6탭 PC 표(실사이트 고정본)", () => {
  it("탭별 상품 수 — 2346·4763 표 2개, 5337 한 표 두 열, 나머지 1개(합 9)", () => {
    const counts = Object.fromEntries(SEOULSHINBO_TABS.map((tab) => [tab, parseSeoulshinbo(page(tab), tab).length]));
    expect(counts).toEqual({ BUSI2346: 2, BUSI4617: 1, BUSI4763: 2, BUSI5337: 2, BUSI5388: 1, BUSI5389: 1 });
  });

  it("★BUSI5337 — 창업자금 특별보증 한도는 PC 표 「5천만원」, 모바일 블록의 「3천만 원」은 읽지 않는다", () => {
    const html = page("BUSI5337");
    expect(html).toContain("3천만"); // 함정이 고정본에 실제로 있다(모바일 블록)
    const rows = parseSeoulshinbo(html, "BUSI5337");
    expect(rows.map((p) => p.sourceId)).toEqual(["창업자금특별보증", "사업장임차자금특별보증"]);
    const startup = rows.find((p) => p.sourceId === "창업자금특별보증");
    expect(startup?.limitText).toContain("5천만원");
    expect(startup?.limitText).not.toContain("3천만");
    expect(startup?.limitMaxWon).toBeGreaterThanOrEqual(50_000_000);
  });

  it("★BUSI2346 — 대상기업 칸 안 부속 표는 상품 열·칸 줄로 읽지 않고 그 칸 글자에만 든다(한도 줄 이름 「보증금액」)", () => {
    const html = page("BUSI2346");
    // 부속 표의 머리 글·줄 이름은 고정본에서 직접 뽑아 견준다(글을 지어 넣지 않는다)
    const inner = parse(html).querySelector("div.info_table_box.for_web table.target-comp-table");
    const innerHeads = (inner?.querySelectorAll("thead th") ?? []).map((th) => squash(th.text)).filter(Boolean);
    const innerLabels = (inner?.querySelectorAll("tbody tr") ?? [])
      .map((tr) => squash(tr.querySelector("td, th")?.text ?? ""))
      .filter(Boolean);
    expect(innerHeads.length).toBeGreaterThan(0);
    expect(innerLabels.length).toBeGreaterThan(0);

    const rows = parseSeoulshinbo(html, "BUSI2346");
    expect(rows).toHaveLength(2);
    for (const p of rows) {
      expect(innerHeads).not.toContain(squash(p.name));
      for (const label of innerLabels) expect(Object.keys(fieldsOf(p))).not.toContain(label);
    }
    const first = rows[0];
    if (!first) throw new Error("BUSI2346 첫 상품이 없다");
    for (const head of innerHeads) expect(squash(first.targetText)).toContain(head);
    expect(fieldsOf(first)["보증금액"]).toBeTruthy();
    expect(first.limitText).toBe(fieldsOf(first)["보증금액"]);
  });

  it("모든 상품 — 보증 갈래·상시·detailUrl 은 그 탭 주소, 기계 조건은 지역 서울뿐이고 대상 글은 humanCheck 한 항목(80자)", () => {
    for (const tab of SEOULSHINBO_TABS) {
      for (const p of parseSeoulshinbo(page(tab), tab)) {
        const f = fieldsOf(p);
        expect(p).toMatchObject({
          source: "product-seoulshinbo",
          sourceId: p.name.replace(/[\s()（）]/g, ""),
          fundingGroup: "guarantee",
          institution: "서울신용보증재단",
          institutionType: "guarantee",
          productType: "guarantee",
          limitText: f["보증한도"] || f["보증금액"] || "",
          rateText: f["대출금리"] ?? "",
          rateMax: null,
          feeText: f["보증료"] ?? "",
          termText: f["보증기간"] ?? "",
          channel: f["보증상대처"] || "서울신용보증재단 지점·모바일 앱",
          detailUrl: seoulshinboTabUrl(tab),
          deadlineText: "상시",
        });
        // 대상 글 = 대상기업(+ 보증조건) — 표마다 대상기업 줄이 있다
        expect(f["대상기업"]).toBeTruthy();
        expect(p.targetText).toBe(f["보증조건"] ? `${f["대상기업"]} / 보증조건: ${f["보증조건"]}` : f["대상기업"]);
        expect(p.targetRules).toEqual({ region: ["서울"], humanCheck: [p.targetText.slice(0, 80)] });
      }
    }
  });
});

describe("한도 숫자 — 맨 앞 대표 한도만(괄호·※·단서의 조건부 금액은 숫자로 안 씀, 2026-09-24 실사이트 대조)", () => {
  const byName = (tab: string, name: string) => parseSeoulshinbo(page(tab), tab).find((p) => p.name === name);

  it("지능형 모바일 자동심사 — 「3천만원 이내(기보증금액 포함 5천만원 이내)」는 3천만원", () => {
    expect(byName("BUSI2346", "지능형 모바일 자동심사 특별보증")?.limitMaxWon).toBe(30_000_000);
  });

  it("장애인기업 — 「1억원 이내 … ※ 단, 업력 3개월 미만 최대 2천만원」은 1억원", () => {
    expect(byName("BUSI5388", "장애인기업 특별보증")?.limitMaxWon).toBe(100_000_000);
  });

  it("미래 유망기업 — 금액 하나뿐이면 그대로(8억원)", () => {
    expect(byName("BUSI4617", "미래 유망기업 성장지원 보증")?.limitMaxWon).toBe(800_000_000);
  });
});

describe("fetchSeoulshinboAll — 탭 6개를 순서대로, 반쪽 응답은 던진다", () => {
  it("6탭을 순서대로 GET 해 9건 — 이름 중복 없고 전부 지역 서울", async () => {
    serve(page);
    const rows = await fetchSeoulshinboAll();
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((p) => p.sourceId)).size).toBe(9);
    for (const p of rows) expect(p.targetRules.region).toEqual(["서울"]);
    const calls = vi.mocked(fetchProductText).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(SEOULSHINBO_TABS.map((tab) => seoulshinboTabUrl(tab)));
    for (const c of calls) expect(c[2]).toEqual({ method: "GET" });
  });

  it("합쳐 6건 미만이면 던진다", async () => {
    serve(() => page("BUSI5337")); // 탭마다 같은 두 상품 — 이름 중복을 지우면 2건
    await expect(fetchSeoulshinboAll()).rejects.toThrow(/2건뿐/);
  });

  it("탭 하나라도 못 받으면 던진다", async () => {
    serve((tab) => (tab === "BUSI4763" ? undefined : page(tab)));
    await expect(fetchSeoulshinboAll()).rejects.toThrow(/HTTP 503/);
  });

  it("상품을 하나도 못 읽은 탭이 있으면 던진다 — 나머지로 6건을 넘겨도 그 탭 상품을 빠뜨린 채 저장하지 않는다", async () => {
    serve((tab) => (tab === "BUSI5389" ? "<html><body><p>점검 중입니다</p></body></html>" : page(tab)));
    await expect(fetchSeoulshinboAll()).rejects.toThrow(/BUSI5389/);
  });

  it("명부 모양 — id·대표 주소(첫 탭)·fetchAll", () => {
    expect(SEOULSHINBO_URL).toBe("https://www.seoulshinbo.co.kr/wbase/contents.do?mng_cd=BUSI2346");
    expect(seoulshinboSource).toMatchObject({ id: "product-seoulshinbo", url: SEOULSHINBO_URL, fetchAll: fetchSeoulshinboAll });
  });
});
