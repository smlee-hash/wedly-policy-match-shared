import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-25 01시 KST GET 원본 —
 * `https://www.kfcc.co.kr/html/goods/popup/goods0217.html`). 칸 이름은 h3, 값은 뒤따르는 p 들이다(대출기간은 p 둘).
 */
vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { UNREAD_TARGET_NOTE } from "./guarantee-target";
import { fetchKfccAll, KFCC_BRANCH_NOTE, KFCC_URL, kfccSource, parseKfcc } from "./kfcc";

const html = readFileSync(new URL("../__fixtures__/kfcc-goods0217.html", import.meta.url), "utf8");
/** 신청대상 칸 이름(h3)을 뺀 쪽 — 대상 글을 못 읽은 응답. */
const noTarget = html.replace('<h3 class="con_title02">신청대상</h3>', "");
/** 이름 머리(h1.tit_popup)를 못 찾는 쪽. */
const noName = html.replace('class="tit_popup"', 'class="gone"');
/** 고정본 신청대상 원문. */
const TARGET = "사업자등록번호가 있는 자영업자 고객 중 사업기간이 3년이상이고 연소득(매출)증빙이 가능한 고객님";

describe("parseKfcc — 사장님드림UP대출 상세설명 팝업(실사이트 고정본)", () => {
  it("이름은 h1 에서 끝의 「상세설명」을 뗀 것, 한도 「최대 6천만원」 = 60,000,000원 — 은행 갈래 신용대출 모양", () => {
    const p = parseKfcc(html);
    expect(p).toMatchObject({
      source: "product-kfcc",
      sourceId: "goods0217",
      fundingGroup: "bank",
      institution: "새마을금고",
      institutionType: "bank",
      name: "사장님드림UP대출",
      productType: "credit",
      targetText: TARGET,
      limitText: "최대 6천만원",
      limitMaxWon: 60_000_000,
      rateText: "신용등급 및 거래실적에 따라 차등 적용",
      rateMin: null, // 숫자가 없다
      rateMax: null,
      feeText: "",
      channel: "가까운 새마을금고",
      applyUrl: "",
      detailUrl: KFCC_URL,
      deadlineText: "상시",
    });
    // 대상 글 한 줄(80자) + 금고 확인 항목 — 지역·기계 조건 없음
    expect(p?.targetRules).toEqual({ humanCheck: [TARGET.slice(0, 80), KFCC_BRANCH_NOTE] });
    expect(p?.keepExisting).toBeUndefined();
  });

  it("한 칸에 p 가 여럿이면 공백 한 칸으로 잇는다 — 대출기간(일시상환·분할상환)", () => {
    expect(parseKfcc(html)?.termText).toBe(
      "일시상환 : 1년 이내(1년 단위로 연장, 최대 5년까지 연장 가능) 원(리)금균등분할상환 : 5년이내(최대 6개월 거치기간 포함)",
    );
  });

  it("★신청대상을 못 읽으면 keepExisting + 「읽지 못함」·금고 확인 항목 — 다른 칸은 그대로", () => {
    expect(noTarget).not.toBe(html);
    const p = parseKfcc(noTarget);
    expect(p).toMatchObject({ name: "사장님드림UP대출", targetText: "", limitMaxWon: 60_000_000, keepExisting: true });
    expect(p?.targetRules).toEqual({ humanCheck: [UNREAD_TARGET_NOTE, KFCC_BRANCH_NOTE] });
  });

  it("이름(h1.tit_popup)을 못 찾으면 null — 이름을 지어내지 않는다", () => {
    expect(noName).not.toBe(html);
    expect(parseKfcc(noName)).toBeNull();
  });
});

describe("fetchKfccAll — 팝업 한 쪽 GET, 1건짜리라 이름·신청대상을 못 읽으면 던진다", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("고정본 → 1건, 팝업 주소를 한 번만 받는다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(html);
    const products = await fetchKfccAll();
    expect(products).toEqual([parseKfcc(html)]);
    expect(vi.mocked(fetchProductText).mock.calls.map((c) => String(c[1]))).toEqual([KFCC_URL]);
  });

  it("★신청대상을 못 읽은 응답은 던진다 — 저장하지 않는다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(noTarget);
    await expect(fetchKfccAll()).rejects.toThrow(/신청대상/);
  });

  it("★이름을 못 읽은 응답도 던진다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(noName);
    await expect(fetchKfccAll()).rejects.toThrow(/이름/);
  });

  it("명부 모양 — id·label·url·fetchAll", () => {
    expect(KFCC_URL).toBe("https://www.kfcc.co.kr/html/goods/popup/goods0217.html");
    expect(kfccSource).toMatchObject({ id: "product-kfcc", label: "새마을금고 사업자대출", url: KFCC_URL });
    expect(kfccSource.fetchAll).toBe(fetchKfccAll);
  });
});
