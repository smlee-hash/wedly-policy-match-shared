import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-25 01시 KST GET 원본 —
 * 목록 `https://www.kibo.or.kr/main/work/work01030101.do`, 상세 `…/main/work/work010901.do`). 목록에는 같은
 * 메뉴 링크가 여러 번·글자가 빈 a 와 섞여 나오고 이름에 엔티티(&#40; &#41; &amp;)가 있다 — 지어낸 표본은
 * 이 함정을 놓친다.
 */
vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { UNREAD_TARGET_NOTE } from "./guarantee-target";
import { fetchKiboAll, KIBO_LIST_URL, kiboSource, parseKiboDetail, parseKiboList } from "./kibo";

const fixture = (name: string) => readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
const listHtml = fixture("kibo-list.html");
const detailHtml = fixture("kibo-detail-010901.html");

const BASE_URL = "https://www.kibo.or.kr";
/** 상품 쪽 경로 — 숫자 6자리(설계 §E). */
const PRODUCT_PATH = /^\/main\/work\/work01(?:05|06|07|08|09)\d{2}\.do$/;
/** 고정본 010901 의 머리 제목(h2.sec-title). */
const GOODJOB_NAME = "일자리창출 지원(굿잡보증)";
/** sourceId 규칙 — 공백·괄호 제거. */
const idPart = (v: string) => v.replace(/\s+/g, "").replace(/[()（）]/g, "");

const items = parseKiboList(listHtml);

/** 목록 주소면 목록 고정본, 그 밖은 `detail(주소)` — 상세 고정본은 010901 한 장이라 모든 상품에 돌려 쓴다. */
function serve({ list = listHtml, detail = (_url: string) => detailHtml } = {}) {
  vi.mocked(fetchProductText).mockImplementation(async (_source, url) =>
    String(url) === KIBO_LIST_URL ? list : detail(String(url)),
  );
}

/** 목록 고정본에서 앞 n 개 상품만 남긴다 — 나머지 경로는 상품 쪽이 아닌 주소로 바꿔 끼운다. */
function listKeeping(n: number): string {
  return items.slice(n).reduce((html, item) => html.split(item.path).join("/main/work/gone.do"), listHtml);
}

describe("parseKiboList — 보증상품 목록의 6자리 상품 쪽만(실사이트 고정본)", () => {
  it("상품 쪽 21개 — 여러 번 나온 링크는 경로로 한 번만, 이름은 모두 글자 있음(공백 한 칸)", () => {
    const hrefs = listHtml.match(/href="\/main\/work\/work01(?:05|06|07|08|09)\d{2}\.do"/g) ?? [];
    expect(hrefs.length).toBeGreaterThan(21); // 고정본에 같은 경로 링크가 겹쳐 있다
    expect(items).toHaveLength(21);
    expect(new Set(items.map((i) => i.path)).size).toBe(21);
    expect(new Set(items.map((i) => idPart(i.name))).size).toBe(21);
    for (const { name, path } of items) {
      expect(path).toMatch(PRODUCT_PATH);
      expect(name).not.toBe("");
      expect(name).toBe(name.replace(/\s+/g, " ").trim());
    }
  });

  it("★8자리 안내 쪽(work01050103 같은)은 없고, 다섯 묶음(05~09) 모두에서 나온다", () => {
    expect(items.filter((i) => /work01\d{6}\.do$/.test(i.path))).toEqual([]);
    const groups = new Set(items.map((i) => i.path.match(/work01(\d{2})/)?.[1]));
    expect(groups).toEqual(new Set(["05", "06", "07", "08", "09"]));
  });

  it("이름은 엔티티를 풀어서(&#40; &#41; &amp;) — 목록 a 글자 그대로", () => {
    expect(items).toContainEqual({ name: "예비창업자 사전보증", path: "/main/work/work010601.do" });
    const names = items.map((i) => i.name);
    expect(names).toContain("우수기술 사업화지원(TECH밸리)");
    expect(names).toContain("R&D보증");
    expect(names.filter((n) => /&#?\w+;/.test(n))).toEqual([]);
  });

  it("★글자가 빈 a 가 먼저 나와도 이름은 같은 경로의 글자 있는 a 에서", () => {
    const blankFirst = `<a href="/main/work/work010601.do">&nbsp;</a><a href="/main/work/work010601.do"> </a>`;
    const parsed = parseKiboList(blankFirst + listHtml);
    expect(parsed).toHaveLength(21);
    expect(parsed[0]).toEqual({ name: "예비창업자 사전보증", path: "/main/work/work010601.do" });
  });
});

describe("parseKiboDetail — 굿잡보증 상세(실사이트 고정본 010901)", () => {
  const detail = parseKiboDetail(detailHtml);

  it("이름은 h2.sec-title, 대상 글은 div#cms-content 글자 — 「상시근로자」가 들어 있다", () => {
    expect(detail.name).toBe(GOODJOB_NAME);
    expect(detail.targetText).toContain("상시근로자");
    expect(detail.targetText).toBe(detail.targetText.replace(/\s+/g, " ").trim());
  });

  it("자르지 않는다 — 확인 항목(80자)보다 긴 본문도 그대로", () => {
    expect(detail.targetText.length).toBeGreaterThan(80);
  });

  it("★쪽 아래 누리집 이용안내·주소(cms-content 밖)는 넣지 않는다", () => {
    expect(detail.targetText).not.toMatch(/개인정보처리방침|누리집 이용안내|문현금융로/);
    // 본문 밖(main 끝)에 심은 글자도 들어오지 않는다
    const planted = detailHtml.replace("</main>", "<p>본문밖꼬리표</p></main>");
    expect(planted).not.toBe(detailHtml);
    expect(parseKiboDetail(planted).targetText).not.toContain("본문밖꼬리표");
  });

  it("본문(div#cms-content)이 없으면 대상 글은 빈 값 — 지어내지 않는다(이름은 h2 그대로)", () => {
    const noBody = detailHtml.replace(/id="cms-content"/g, 'id="gone"');
    expect(noBody).not.toBe(detailHtml);
    expect(parseKiboDetail(noBody)).toEqual({ name: GOODJOB_NAME, targetText: "" });
  });
});

describe("fetchKiboAll — 목록 한 번 + 상품마다 상세 한 번(한 번에 하나씩)", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("21개 모두 보증 상품 모양 — 목록 다음 상세를 목록 순서대로 받는다", async () => {
    serve();
    const products = await fetchKiboAll();
    expect(vi.mocked(fetchProductText).mock.calls.map((c) => String(c[1]))).toEqual([
      KIBO_LIST_URL,
      ...items.map((i) => `${BASE_URL}${i.path}`),
    ]);
    expect(products).toHaveLength(21);
    products.forEach((p, n) => {
      expect(p).toMatchObject({
        source: "product-kibo",
        // 상세 고정본 한 장을 돌려 쓰므로 이름은 모두 그 h2 — sourceId 는 목록 이름에서라 21개가 다르다
        sourceId: idPart(items[n].name),
        fundingGroup: "guarantee",
        institution: "기술보증기금",
        institutionType: "guarantee",
        name: GOODJOB_NAME,
        productType: "guarantee",
        limitText: "",
        limitMaxWon: null,
        rateText: "",
        rateMin: null,
        rateMax: null,
        feeText: "",
        termText: "",
        channel: "기술보증기금 영업점·디지털지점",
        applyUrl: "",
        detailUrl: `${BASE_URL}${items[n].path}`,
        deadlineText: "상시",
      });
      expect(p.targetText).toContain("상시근로자");
      // 대상 글은 확인 항목 한 줄(80자)로만 — 지역·기계 조건 없음
      expect(p.targetRules).toEqual({ humanCheck: [p.targetText.slice(0, 80)] });
      expect(p.keepExisting).toBeUndefined();
    });
  });

  it("★상세는 한 번에 하나씩 — 동시에 둘 이상 받지 않는다", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(fetchProductText).mockImplementation(async (_source, url) => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return String(url) === KIBO_LIST_URL ? listHtml : detailHtml;
    });
    await fetchKiboAll();
    expect(peak).toBe(1);
  });

  it("★상세 한 건 실패 — 그 상품만 목록 이름 + keepExisting + 「읽지 못함」 확인 항목, 나머지는 계속", async () => {
    const failedUrl = `${BASE_URL}/main/work/work010601.do`;
    serve({
      detail: (url) => {
        if (url === failedUrl) throw new Error("응답 없음");
        return detailHtml;
      },
    });
    const products = await fetchKiboAll();
    expect(products).toHaveLength(21);
    const failed = products.find((p) => p.detailUrl === failedUrl);
    expect(failed).toMatchObject({
      name: "예비창업자 사전보증",
      sourceId: "예비창업자사전보증",
      targetText: "",
      keepExisting: true,
    });
    expect(failed?.targetRules).toEqual({ humanCheck: [UNREAD_TARGET_NOTE] });
    expect(products.filter((p) => p.keepExisting)).toHaveLength(1);
  });

  it("본문(div#cms-content)을 못 읽은 상세도 keepExisting + 「읽지 못함」 확인 항목 — 「맞음」이 나올 길이 없다", async () => {
    const noBody = detailHtml.replace(/id="cms-content"/g, 'id="gone"');
    serve({ detail: () => noBody });
    const products = await fetchKiboAll();
    expect(products).toHaveLength(21);
    for (const p of products) {
      expect(p).toMatchObject({ targetText: "", keepExisting: true });
      expect(p.targetRules).toEqual({ humanCheck: [UNREAD_TARGET_NOTE] });
    }
  });

  it("★목록이 15건 미만이면 던진다 — 상세는 받지 않는다(14건 throw·15건 통과)", async () => {
    serve({ list: listKeeping(14) });
    await expect(fetchKiboAll()).rejects.toThrow(/14건/);
    expect(fetchProductText).toHaveBeenCalledTimes(1);

    serve({ list: listKeeping(15) });
    await expect(fetchKiboAll()).resolves.toHaveLength(15);
  });

  it("명부 모양 — id·label·url·fetchAll", () => {
    expect(KIBO_LIST_URL).toBe("https://www.kibo.or.kr/main/work/work01030101.do");
    expect(kiboSource).toMatchObject({ id: "product-kibo", label: "기술보증기금 보증상품", url: KIBO_LIST_URL });
    expect(kiboSource.fetchAll).toBe(fetchKiboAll);
  });
});
