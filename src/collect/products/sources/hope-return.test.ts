import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-03 10:49 실측,
 * `https://www.sbiz.or.kr/nhrp/intro/bizIntroduce.do` · `.../nhrp/cnsl/bsnsArngCnslInfo.do`).
 * ★실사이트 재실측(2026-09-03, 구현 중) — 계획서가 못박은 「main.do 쿠키를 들고 GET」 을 그대로
 * 돌려보니 `main.do` 자체가 첫 히트에 302 를 던져 `fetchProductWithCookies` 가 곧장 예외를 낸다.
 * 그런데 이 302 세션 부트스트랩은 intro·onestop 주소 자체에도 걸려 있어(둘 다 쿠키 없이 치면
 * 자기 자신 `?null` 로 302 + Set-Cookie) `fetchProductText` 혼자 리다이렉트를 따라가며 쿠키를
 * 받는 것만으로 충분하다 — main.do 부트스트랩·Cookie/Referer 수동 전달은 필요 없다(hope-return.ts
 * 상단 주석에 근거 상세).
 */
const introHtml = readFileSync(join(__dirname, "../__fixtures__/hope-return-intro.html"), "utf-8");
const onestopHtml = readFileSync(join(__dirname, "../__fixtures__/hope-return-onestop.html"), "utf-8");

vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import {
  fetchHopeReturnAll,
  hopeReturnSource,
  HOPE_RETURN_INTRO_URL,
  HOPE_RETURN_MAIN_URL,
  HOPE_RETURN_ONESTOP_URL,
  parseHopeReturn,
} from "./hope-return";

const introRows = parseHopeReturn(introHtml);
const onestopRows = parseHopeReturn(onestopHtml);

describe("parseHopeReturn(introHtml) — 지원단계별 지원대상 안내표(실사이트 고정본 11행)", () => {
  it("항목 3건 이상 — 실측은 11건(원스톱폐업지원 4 · 특화취업지원 2 · 재기사업화지원 5)", () => {
    expect(introRows.length).toBeGreaterThanOrEqual(3);
    expect(introRows).toHaveLength(11);
  });

  it("점포철거비 지원 — 계획서 Task 13 이 못박은 값 전부", () => {
    const r = introRows.find((x) => x.name === "점포철거비 지원");
    expect(r).toMatchObject({
      source: "product-hope-return",
      fundingGroup: "urgent",
      institution: "소상공인시장진흥공단",
      institutionType: "policy",
      productType: "grant",
      limitText: "최대 600만원",
      limitMaxWon: 6_000_000,
      rateText: "무상",
      deadlineText: "상시",
      applyUrl: "https://www.sbiz.or.kr/nhrp/main.do",
    });
    expect(r?.targetText).toContain("폐업(예정)소상공인");
  });

  it("한도가 본문에 있는 다른 항목도 최대값을 원으로 환산한다(전직장려수당·재기 사업화)", () => {
    const jeonjik = introRows.find((x) => x.name === "전직장려수당");
    expect(jeonjik).toMatchObject({ limitText: "최대 100만원", limitMaxWon: 1_000_000, fundingGroup: "urgent" });
    const jaegi = introRows.find((x) => x.name === "재기 사업화");
    expect(jaegi).toMatchObject({ limitText: "최대 2,000만원", limitMaxWon: 20_000_000 });
  });

  it("한도가 없는(서비스형) 항목은 값을 지어내지 않고 빈 값으로 둔다", () => {
    const beopryul = introRows.find((x) => x.name === "법률자문");
    expect(beopryul).toMatchObject({ limitText: "", limitMaxWon: null });
  });

  it("11건 전부 출처·기관·기관형태·갈래·금리·마감·신청주소·targetRules 가 같다(패키지 하나)", () => {
    for (const r of introRows) {
      expect(r.source).toBe("product-hope-return");
      expect(r.institution).toBe("소상공인시장진흥공단");
      expect(r.institutionType).toBe("policy");
      expect(r.fundingGroup).toBe("urgent");
      expect(r.rateText).toBe("무상");
      expect(r.rateMin).toBeNull();
      expect(r.deadlineText).toBe("상시");
      expect(r.applyUrl).toBe(HOPE_RETURN_MAIN_URL);
      expect(r.detailUrl).toBe(HOPE_RETURN_INTRO_URL);
      // F3(2026-09-03 코덱스 리뷰): 「소상공인」 규모 조건 하나만으로는 실질 검증이 아니다 —
      // 「폐업(예정) 소상공인」이라는 필수조건은 기계로 못 재니 humanCheck 원문으로 버리지 않고 남긴다.
      expect(r.targetRules).toEqual({ scale: ["소상공인"], humanCheck: ["폐업(예정) 또는 경영위기 소상공인"] });
      expect(r.targetText).toContain("폐업(예정)소상공인"); // 사업대상 문구가 11건 전부에 실린다
    }
  });

  it("HTML 주석으로 감싼 미개통 항목(재창업지원)은 나오지 않는다", () => {
    expect(introRows.some((r) => r.name === "재창업 교육")).toBe(false);
    expect(introRows.some((r) => r.name === "재창업 사업화")).toBe(false);
  });

  it("sourceId 는 공백을 지운 이름이고 11건 모두 겹치지 않는다", () => {
    const r = introRows.find((x) => x.name === "경영·재창업 진단");
    expect(r?.sourceId).toBe("경영·재창업진단");
    expect(new Set(introRows.map((r) => r.sourceId)).size).toBe(11);
  });
});

describe("parseHopeReturn(onestopHtml) — 원스톱폐업지원 사업 개요(실사이트 고정본)", () => {
  it("「원스톱 폐업지원」 1건 이상", () => {
    expect(onestopRows.length).toBeGreaterThanOrEqual(1);
    expect(onestopRows.some((r) => r.name === "원스톱 폐업지원")).toBe(true);
  });

  it("intro 표의 세부 4항목(점포철거비 지원 등)을 다시 쪼개 세지 않는다 — 이중 집계 방지", () => {
    expect(onestopRows).toHaveLength(1);
  });

  it("기관·갈래·출처는 intro 와 같은 값(같은 패키지)", () => {
    const r = onestopRows[0];
    expect(r).toMatchObject({
      source: "product-hope-return",
      institution: "소상공인시장진흥공단",
      institutionType: "policy",
      fundingGroup: "urgent",
      rateText: "무상",
      deadlineText: "상시",
      detailUrl: HOPE_RETURN_ONESTOP_URL,
    });
    expect(r.targetText).toContain("폐업");
  });
});

describe("hopeReturnSource — 명부에 실릴 모양(공통 계약)", () => {
  it("id·라벨·주소·fetchAll 이 계획대로다", () => {
    expect(hopeReturnSource.id).toBe("product-hope-return");
    expect(hopeReturnSource.label).toBe("희망리턴패키지");
    expect(hopeReturnSource.url).toBe(HOPE_RETURN_MAIN_URL);
    expect(hopeReturnSource.fetchAll).toBe(fetchHopeReturnAll);
  });
});

describe("fetchHopeReturnAll — intro·onestop GET 배선(실측 반영: main.do 부트스트랩 없이 직접 GET)", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });
  afterEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("intro·onestop 을 쿠키 없이 그대로 GET 하고(세션은 fetchProductText 가 스스로 해결), 이름으로 합쳐 12건을 만든다", async () => {
    vi.mocked(fetchProductText).mockImplementation(async (_cfg, url) => {
      if (url === HOPE_RETURN_INTRO_URL) return introHtml;
      if (url === HOPE_RETURN_ONESTOP_URL) return onestopHtml;
      throw new Error(`예상 못 한 주소: ${url}`);
    });

    const list = await fetchHopeReturnAll();

    // init 을 안 실어야 한다 — fetchProductText(→fetchBoardText) 가 리다이렉트 안에서 쿠키를 스스로 받는다.
    expect(fetchProductText).toHaveBeenCalledWith(
      { id: "product-hope-return", baseUrl: "https://www.sbiz.or.kr" },
      HOPE_RETURN_INTRO_URL,
    );
    expect(fetchProductText).toHaveBeenCalledWith(
      { id: "product-hope-return", baseUrl: "https://www.sbiz.or.kr" },
      HOPE_RETURN_ONESTOP_URL,
    );
    expect(fetchProductText).toHaveBeenCalledTimes(2);
    expect(list).toHaveLength(12); // intro 11 + onestop 전용("원스톱 폐업지원") 1, 겹치는 이름 없음
    expect(new Set(list.map((p) => p.sourceId)).size).toBe(12);
  });

  it("같은 지원사업명이 두 페이지에 다 있으면 intro 쪽 값을 남긴다(같은 이름은 intro 우선)", async () => {
    // onestop 쪽 이름은 상수("원스톱 폐업지원")라 그 이름과 겹치는 intro 행을 하나 만든다.
    // intro 에 항목을 2개 더 둬 합계(고유 이름 3개)가 3건 미만 방어선에 걸리지 않게 한다 —
    // 그래야 fetchHopeReturnAll 이 실제로 병합한 결과를 본다.
    const fakeIntro = `
      <table><caption>지원단계별 지원대상 안내표</caption>
        <thead><tr><th>구분</th><th>지원사업</th><th>지원내용</th></tr></thead>
        <tbody>
          <tr><td>테스트구분</td><td>원스톱 폐업지원</td><td><p>intro 버전 최대 100만원 지원</p></td></tr>
          <tr><td>항목B</td><td><p>안내 B</p></td></tr>
          <tr><td>항목C</td><td><p>안내 C</p></td></tr>
        </tbody>
      </table>`;
    // onestop 은 이름을 안 읽고 본문 섹션 유무로만 판정한다(위 hope-return.ts 주석 근거) — 최소 본문만 채운다.
    const fakeOnestop = `
      <div class="stit_area"><h4 class="stit04">사업목적</h4></div>
      <p>onestop 버전 최대 999만원 지원</p>`;
    vi.mocked(fetchProductText).mockImplementation(async (_cfg, url) => {
      if (url === HOPE_RETURN_INTRO_URL) return fakeIntro;
      if (url === HOPE_RETURN_ONESTOP_URL) return fakeOnestop;
      throw new Error(`예상 못 한 주소: ${url}`);
    });

    const list = await fetchHopeReturnAll(); // 고유 이름 3개(원스톱 폐업지원·항목B·항목C) — 방어선에 안 걸린다
    expect(list).toHaveLength(3);
    const merged = list.find((p) => p.name === "원스톱 폐업지원");
    expect(merged?.limitText).toBe("최대 100만원"); // onestop(999만원)이 뒤에 합쳐져도 intro 값이 남는다
  });

  it("★사이트 개편 등으로 빈 셸만 받으면(intro·onestop 모두 0건) 반쪽 응답으로 보고 던진다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue("<html><body>안내 페이지 준비 중입니다</body></html>");

    await expect(fetchHopeReturnAll()).rejects.toThrow();
  });
});
