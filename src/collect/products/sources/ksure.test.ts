import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-24 13:00 KST GET 원본 —
 * `https://www.ksure.or.kr/rh-kr/index.do`, 상세 `…/rh-kr/cntnts/i-165/dir.do`). 첫 화면에는
 * 「>신용보증<」 글자가 4번·같은 링크가 두 번 나오고, 같은 사업안내 메뉴에 보험 묶음이 나란히 있다 —
 * 지어낸 표본은 이 함정을 놓친다.
 */
vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { fetchKsureAll, KSURE_INDEX_URL, ksureSource, parseKsureDetail, parseKsureList } from "./ksure";

const fixture = (name: string) => readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
const indexHtml = fixture("ksure-index.html");
const detailHtml = fixture("ksure-detail-i165.html");

/** 고정본 「신용보증」 묶음의 하위 5개(메뉴 순서). */
const NAMES = [
  "수출신용보증(선적전)",
  "수출신용보증(다이렉트-선적전)",
  "수출신용보증(선적후)",
  "수출신용보증(매입)",
  "수출신용보증(포괄매입)",
];
const PATHS = ["i-165", "i-775", "i-169", "i-175", "i-180"].map((id) => `/rh-kr/cntnts/${id}/dir.do`);
const DETAIL_URLS = PATHS.map((path) => `https://www.ksure.or.kr${path}`);

/** 목록 주소면 첫 화면 고정본, 그 밖은 `detail(주소)` — 상세 고정본은 i-165 한 장뿐이라 다섯 상품에 돌려 쓴다. */
function serve({ index = indexHtml, detail = (_url: string) => detailHtml } = {}) {
  vi.mocked(fetchProductText).mockImplementation(async (_source, url) =>
    String(url) === KSURE_INDEX_URL ? index : detail(String(url)),
  );
}

describe("parseKsureList — 사업안내 메뉴의 「신용보증」 묶음만(실사이트 고정본)", () => {
  const items = parseKsureList(indexHtml);

  it("수출신용보증 5개를 메뉴 순서대로 — 두 번 나온 링크는 한 번만", () => {
    expect(items.map((i) => i.name)).toEqual(NAMES);
    expect(items.map((i) => i.path)).toEqual(PATHS);
  });

  it("★보험 묶음(단기성·중장기성·환변동·수입보험) 상품은 0건", () => {
    expect(items.filter((i) => i.name.includes("보험"))).toEqual([]);
  });
});

describe("parseKsureDetail — 제도개요 본문(실사이트 고정본 i-165)", () => {
  const text = parseKsureDetail(detailHtml);

  it("div.ctn 의 대상 글 — 「연대보증」이 들어 있고 머리 제목 「제도개요」는 뗀다", () => {
    expect(text).toContain("연대보증");
    expect(text).not.toMatch(/^제도개요/);
    expect(text).toMatch(/^중소/); // 고정본 첫 문장 「중소·중견기업이 수출물품을 …」
  });

  it("★끝 안내문(notice_box 「본 안내는 무역보험 …」)은 넣지 않는다", () => {
    expect(text).not.toContain("본 안내는 무역보험");
  });

  it("공백은 한 칸, 길이는 최대 600자", () => {
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).not.toMatch(/\s{2}|[\t\n\r]/);
    expect(text).toBe(text.trim());
  });

  it("★닫히지 않은 <span> 이 있는 쪽(고정본 i-175 수출신용보증(매입), 2026-09-24 실측)도 본문을 읽는다", () => {
    // 이 쪽은 HTML 해석기가 트리를 잘못 세워 div.ctn 을 못 찾는다 — 실사이트 5개 중 2개가 빈 값이었다
    const t = parseKsureDetail(fixture("ksure-detail-i175.html"));
    expect(t).toMatch(/^수출자가 수출계약에 따라/);
    expect(t).toContain("연대보증");
    expect(t).not.toContain("본 안내는 무역보험");
  });
});

describe("fetchKsureAll — 첫 화면 한 번 + 상세 한 건씩(fetch 모의)", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("5건 — 보증 갈래·기관·창구·상시, 한도·금리 빈 값/null, 대상 글은 humanCheck 한 항목뿐(지역 조건 없음)", async () => {
    serve();
    const rows = await fetchKsureAll();
    expect(rows.map((p) => p.name)).toEqual(NAMES);
    expect(rows.map((p) => p.sourceId)).toEqual([
      "수출신용보증선적전",
      "수출신용보증다이렉트-선적전",
      "수출신용보증선적후",
      "수출신용보증매입",
      "수출신용보증포괄매입",
    ]);
    expect(rows.map((p) => p.detailUrl)).toEqual(DETAIL_URLS);
    for (const p of rows) {
      expect(p).toMatchObject({
        source: "product-ksure",
        fundingGroup: "guarantee",
        institution: "한국무역보험공사",
        institutionType: "guarantee",
        productType: "guarantee",
        limitText: "",
        limitMaxWon: null,
        rateText: "",
        rateMin: null,
        rateMax: null,
        channel: "K-SURE 영업점·K-SURE ON",
        deadlineText: "상시",
      });
      expect(p.targetText).toContain("연대보증");
      // 기계 조건 없이 humanCheck 한 항목뿐 — 대상 글만으로 「맞음」이 나오지 않는다
      expect(p.targetRules).toEqual({ humanCheck: [p.targetText.slice(0, 80)] });
      expect(p.keepExisting).toBeUndefined();
    }
  });

  it("상세는 한 번에 하나씩, 목록 순서대로 받는다(동시 요청 금지)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(fetchProductText).mockImplementation(async (_source, url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return String(url) === KSURE_INDEX_URL ? indexHtml : detailHtml;
    });
    await fetchKsureAll();
    expect(maxInFlight).toBe(1);
    const calls = vi.mocked(fetchProductText).mock.calls;
    expect(calls.map((c) => String(c[1]))).toEqual([KSURE_INDEX_URL, ...DETAIL_URLS]);
    expect(calls[0]?.[0]).toMatchObject({ id: "product-ksure", baseUrl: "https://www.ksure.or.kr" });
  });

  it("★상세 한 건이 실패하면 그 상품만 keepExisting 으로 목록 값만 — 나머지 4건은 새 값", async () => {
    serve({
      detail: (url) => {
        if (url.endsWith("/i-169/dir.do")) throw new Error("상세 응답 없음(시험)");
        return detailHtml;
      },
    });
    const rows = await fetchKsureAll();
    expect(rows.map((p) => p.name)).toEqual(NAMES);
    const failed = rows.find((p) => p.name === "수출신용보증(선적후)");
    expect(failed).toMatchObject({
      keepExisting: true,
      targetText: "",
      detailUrl: "https://www.ksure.or.kr/rh-kr/cntnts/i-169/dir.do",
    });
    expect(failed?.targetRules).toEqual({});
    expect(rows.filter((p) => p.keepExisting)).toHaveLength(1);
    expect(rows.filter((p) => !p.keepExisting).every((p) => p.targetText.includes("연대보증"))).toBe(true);
  });

  it("상세를 받았어도 본문을 못 읽으면(빈 응답) keepExisting — 빈 대상 글로 기존 값을 덮지 않는다", async () => {
    serve({ detail: (url) => (url.endsWith("/i-175/dir.do") ? "" : detailHtml) });
    const rows = await fetchKsureAll();
    expect(rows.filter((p) => p.keepExisting).map((p) => p.name)).toEqual(["수출신용보증(매입)"]);
  });

  it("★신용보증 상품이 5건 미만이면 던진다 — 상세는 하나도 요청하지 않는다", async () => {
    // 고정본에서 포괄매입 경로만 지운다(같은 링크가 두 번 나와도 전부) → 4건
    const fewer = indexHtml.replace(/\/rh-kr\/cntnts\/i-180\/dir\.do/g, "");
    expect(parseKsureList(fewer)).toHaveLength(4);
    serve({ index: fewer });
    await expect(fetchKsureAll()).rejects.toThrow("4건");
    expect(fetchProductText).toHaveBeenCalledTimes(1);
  });
});

describe("ksureSource", () => {
  it("명부 id·대표 주소·수집 함수", () => {
    expect(ksureSource).toMatchObject({ id: "product-ksure", url: "https://www.ksure.or.kr/rh-kr/index.do" });
    expect(ksureSource.fetchAll).toBe(fetchKsureAll);
  });
});
