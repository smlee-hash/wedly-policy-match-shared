import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-25 01시 KST GET 원본 —
 * 목록 `https://www.cu.co.kr/cu/ad/fnncGoods/selectFnncGoodsLonList.do?mi=100244`, 상세
 * `…/selectFnncGoodsLonInfo.do?fnncGoodsSn=95·76·70`). 목록은 상품마다 같은 번호 링크가 셋이고 첫 링크 글자는
 * 분류(「기타대출」)다. 상세 section_B01 에는 주석으로 막은 옛 설명 블록이 살아 있는 설명 앞에 있다 —
 * 지어낸 표본은 이 함정을 놓친다.
 */
vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { UNREAD_TARGET_NOTE } from "./guarantee-target";
import { CU_BRANCH_NOTE, CU_LIST_URL, cuDetailUrl, cuSource, fetchCuAll, parseCuDetail, parseCuList } from "./cu";

const fixture = (name: string) => readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
const listHtml = fixture("cu-list.html");
/** 고정본 상세가 있는 사업자 상품 — 목록 순서. */
const SNS = ["95", "76", "70"] as const;
const detailHtml: Record<string, string> = {
  "95": fixture("cu-detail-95.html"),
  "76": fixture("cu-detail-76.html"),
  "70": fixture("cu-detail-70.html"),
};
/** 살아 있는 설명 블록(`<!--상품설명-->…<!--//상품설명-->`)을 들어낸 상세 — 주석 속 옛 블록과 일반사항만 남는다. */
const withoutLive = (html: string) => html.replace(/<!--상품설명-->[\s\S]*?<!--\/\/상품설명-->/, "");

/** 목록 주소면 목록 고정본, 상세 주소면 `detail(상품 번호)` — 기본은 번호별 고정본. */
function serve({ list = listHtml, detail = (sn: string) => detailHtml[sn] } = {}) {
  vi.mocked(fetchProductText).mockImplementation(async (_source, url) => {
    const u = String(url);
    if (u === CU_LIST_URL) return list;
    const sn = SNS.find((n) => u === cuDetailUrl(n));
    if (!sn) throw new Error(`고정본 없는 주소: ${u}`);
    return detail(sn);
  });
}

describe("parseCuList — 대출 상품 목록에서 사업자 상품만(실사이트 고정본)", () => {
  it("18개 중 이름에 사업자|자영업|소상공인|개인사업 이 든 3개 — 목록 순서대로, 이름은 링크 a 의 title", () => {
    const allSns = new Set([...listHtml.matchAll(/fn_selectFnncGoods\('(\d+)'\)/g)].map((m) => m[1]));
    expect(allSns.size).toBe(18);
    expect(parseCuList(listHtml)).toEqual([
      { sn: "95", name: "소상공인지원대출금" },
      { sn: "76", name: "자영업자스피드대출금" },
      { sn: "70", name: "VAN사업자대출금" },
    ]);
  });

  it("★같은 번호 링크가 여러 번 나와도 한 번만 — 같은 title 의 약관·설명서 내려받기 a 는 상품이 아니다", () => {
    expect((listHtml.match(/href="javascript:fn_selectFnncGoods\('70'\);"/g) ?? []).length).toBeGreaterThan(1);
    expect(listHtml).toMatch(/title="VAN사업자대출금" href="\/cu\/ad\/fnncGoods\/saveFnncGoodsDetailCntntsFileDwldAjax\.do/);
    expect(parseCuList(listHtml).filter((i) => i.sn === "70")).toHaveLength(1);
  });

  it("title 이 없는 번호 링크는 이름을 지어내지 않고 버린다", () => {
    expect(parseCuList(`<a href="javascript:fn_selectFnncGoods('99');">개인사업자대출</a>`)).toEqual([]);
  });
});

describe("parseCuDetail — 상세 section_B01 의 살아 있는 설명(실사이트 고정본)", () => {
  it("★주석 속 옛 블록(「1인당 7천만원 이내」)이 아니라 살아 있는 값(「최대 1인당 7천만원」) — 70", () => {
    const html = detailHtml["70"];
    // 함정이 고정본에 실제로 있다 — 주석으로 막은 옛 블록
    expect(html).toContain('<!--<ul class="info_list">');
    expect(html).toContain("<li>1인당 7천만원 이내</li>");
    const f = parseCuDetail(html);
    expect(f["상품명"]).toBe("VAN사업자대출금");
    expect(f["대출한도"]).toMatch(/^최대 1인당 7천만원 \* 최근3개월월평균매출액/);
    expect(f["대출한도"]).not.toContain("이내");
    // 옛 블록 금리(「금리 : 고정금리」)가 아니라 살아 있는 「기준금리 + 가산금리」
    expect(f["대출금리"]).toMatch(/^- 대출금리: 기준금리 \+ 가산금리/);
  });

  it("★살아 있는 설명을 들어내도 주석 속 옛 블록은 읽히지 않는다 — 세 쪽 모두 상품명·대출대상·대출한도가 빈다", () => {
    for (const sn of SNS) {
      const html = detailHtml[sn];
      expect(html, sn).toMatch(/<!--\s*<ul class="info_list">/); // 옛 블록(주석)이 있는 쪽이다
      const stripped = withoutLive(html);
      expect(stripped, sn).not.toBe(html);
      const f = parseCuDetail(stripped);
      expect(f, sn).not.toHaveProperty("상품명");
      expect(f, sn).not.toHaveProperty("대출대상");
      expect(f, sn).not.toHaveProperty("대출한도");
    }
  });

  it("칸 이름 앞뒤 공백(「 상품유형」「 대출기간 」)을 지워 맞추고, 값 속 li·p 경계는 공백 한 칸", () => {
    const f95 = parseCuDetail(detailHtml["95"]);
    expect(f95["상품유형"]).toBe("기타대출");
    expect(f95["대출기간"]).toBe("5년 이내(거치기간 2년포함)"); // 옛 블록은 「2년 포함」
    expect(f95["대출한도"]).toBe("업체당 최고 7,000만원 (일부자금 별도 한도부여)"); // 옛 블록은 「업체당 최고 7천만원」
    expect(f95["대출대상"]).toBe(
      "소상공인 기준(연평균매출액 및 상시근로자수)을 만족하는 사업자등록증을 소지한 개인 또는 법인 " +
        "단, 각 신협 영업점 심사기준 등에 따라 대출이 제한될 수 있습니다.",
    );
    const f70 = parseCuDetail(detailHtml["70"]);
    expect(f70["상품유형"]).toBe("신용");
    expect(f70["대출기간"]).toBe("- 일일상환방식: 700일이내 - 매월 원리금균등분할상환방식: 최장 3년");
    expect(f70["대출대상"]).toBe(
      "- 신협VAN가맹점으로 등록된 사업장을 보유한 사업자 또는 신용카드 매출대금 결제계좌를 해당 신협에 보유한 사업자 " +
        "- 위와 동시에 신협 여신심사기준(CSS)을 통과하신분 단, 각 신협 영업점 심사기준 등에 따라 대출이 제한될 수 있습니다.",
    );
  });

  it("section_B01 이 없으면 빈 사전 — 쪽 위 요약 상자(옛 한도 글)는 읽지 않는다", () => {
    const html = detailHtml["70"];
    const noSection = html.replace('<section id="section_B01">', '<section id="gone">');
    expect(noSection).not.toBe(html);
    expect(html).toContain("신용등급(1인당 7천만원 이내)"); // 요약 상자의 옛 한도 글
    expect(parseCuDetail(noSection)).toEqual({});
  });
});

describe("fetchCuAll — 목록 한 번 + 사업자 상품마다 상세 한 번(한 번에 하나씩)", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("3개 모두 은행 갈래 사업자대출 모양 — 목록 다음 상세를 목록 순서대로 받는다", async () => {
    serve();
    const products = await fetchCuAll();
    expect(vi.mocked(fetchProductText).mock.calls.map((c) => String(c[1]))).toEqual([
      CU_LIST_URL,
      ...SNS.map((sn) => cuDetailUrl(sn)),
    ]);
    expect(products.map((p) => [p.sourceId, p.name, p.productType, p.limitMaxWon, p.termText])).toEqual([
      ["95", "소상공인지원대출금", "", 70_000_000, "5년 이내(거치기간 2년포함)"],
      ["76", "자영업자스피드대출금", "credit", 20_000_000, "최대 2년(기한연장 포함)"],
      ["70", "VAN사업자대출금", "credit", 70_000_000, "- 일일상환방식: 700일이내 - 매월 원리금균등분할상환방식: 최장 3년"],
    ]);
    for (const p of products) {
      expect(p).toMatchObject({
        source: "product-cu",
        fundingGroup: "bank",
        institution: "신협",
        institutionType: "bank",
        rateMin: null, // 「기준금리 + 가산금리」 — 숫자가 없다
        rateMax: null,
        feeText: "",
        channel: "가까운 신협 조합",
        applyUrl: "",
        detailUrl: cuDetailUrl(p.sourceId),
        deadlineText: "상시",
      });
      expect(p.rateText).toMatch(/^- 대출금리: 기준금리 \+ 가산금리/);
      expect(p.targetText).not.toBe("");
      // 대상 글 한 줄(80자) + 조합 확인 항목 — 지역·기계 조건 없음
      expect(p.targetRules).toEqual({ humanCheck: [p.targetText.slice(0, 80), CU_BRANCH_NOTE] });
      expect(p.keepExisting).toBeUndefined();
    }
    // 70 한도는 살아 있는 설명의 값 — 주석 속 「1인당 7천만원 이내」도, 요약 상자 글도 아니다
    expect(products[2].limitText).toMatch(/^최대 1인당 7천만원 /);
  });

  it("★상세는 한 번에 하나씩 — 동시에 둘 이상 받지 않는다", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(fetchProductText).mockImplementation(async (_source, url) => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return String(url) === CU_LIST_URL ? listHtml : detailHtml["70"];
    });
    await fetchCuAll();
    expect(peak).toBe(1);
  });

  it("★상세 한 건 실패 — 그 상품만 목록 이름 + keepExisting + 「읽지 못함」·조합 확인 항목, 나머지는 계속", async () => {
    serve({
      detail: (sn) => {
        if (sn === "76") throw new Error("응답 없음");
        return detailHtml[sn];
      },
    });
    const products = await fetchCuAll();
    expect(products).toHaveLength(3);
    const failed = products.find((p) => p.sourceId === "76");
    expect(failed).toMatchObject({
      name: "자영업자스피드대출금",
      detailUrl: cuDetailUrl("76"),
      targetText: "",
      limitText: "",
      limitMaxWon: null,
      productType: "",
      keepExisting: true,
    });
    expect(failed?.targetRules).toEqual({ humanCheck: [UNREAD_TARGET_NOTE, CU_BRANCH_NOTE] });
    expect(products.filter((p) => p.keepExisting).map((p) => p.sourceId)).toEqual(["76"]);
  });

  it("대출대상을 못 읽은 상세도 keepExisting + 「읽지 못함」·조합 확인 항목 — 「맞음」이 나올 길이 없다", async () => {
    serve({ detail: (sn) => withoutLive(detailHtml[sn]) });
    const products = await fetchCuAll();
    expect(products.map((p) => p.name)).toEqual(["소상공인지원대출금", "자영업자스피드대출금", "VAN사업자대출금"]);
    for (const p of products) {
      expect(p).toMatchObject({ targetText: "", keepExisting: true });
      expect(p.targetRules).toEqual({ humanCheck: [UNREAD_TARGET_NOTE, CU_BRANCH_NOTE] });
    }
  });

  it("★사업자 상품이 2건 미만이면 던진다 — 상세는 받지 않는다(1건 throw·2건 통과)", async () => {
    const renamed = (html: string, from: string, to: string) => html.split(`title="${from}"`).join(`title="${to}"`);
    const oneLeft = renamed(renamed(listHtml, "자영업자스피드대출금", "스피드대출금"), "VAN사업자대출금", "VAN대출금");
    serve({ list: oneLeft });
    await expect(fetchCuAll()).rejects.toThrow(/1건/);
    expect(fetchProductText).toHaveBeenCalledTimes(1);

    serve({ list: renamed(listHtml, "VAN사업자대출금", "VAN대출금") });
    await expect(fetchCuAll()).resolves.toHaveLength(2);
  });

  it("명부 모양 — id·label·url·fetchAll, 상세 주소는 목록 링크 번호", () => {
    expect(CU_LIST_URL).toBe("https://www.cu.co.kr/cu/ad/fnncGoods/selectFnncGoodsLonList.do?mi=100244");
    expect(cuDetailUrl("70")).toBe("https://www.cu.co.kr/cu/ad/fnncGoods/selectFnncGoodsLonInfo.do?fnncGoodsSn=70");
    expect(cuSource).toMatchObject({ id: "product-cu", label: "신협 사업자대출", url: CU_LIST_URL });
    expect(cuSource.fetchAll).toBe(fetchCuAll);
  });
});
