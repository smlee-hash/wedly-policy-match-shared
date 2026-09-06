import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  announcementsFromBojo24Json,
  bojo24PageCap,
  extractBojo24Items,
  fetchBojo24All,
  keepIdentifiable,
  regionFromAgency,
  normalizeBojo24Item,
} from "./bojo24";

const bodyOf = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__/datago", name), "utf8").replace(/^HTTP \d+\r?\n/, "");

const listJson = JSON.parse(bodyOf("bojo24-list.sample.txt")) as {
  data: Record<string, unknown>[];
};

describe("보조금24 정규화 — 고정본 3건", () => {
  const items = extractBojo24Items(listJson);
  it("고정본에서 3건을 꺼낸다", () => {
    expect(items).toHaveLength(3);
  });
  it("1건: 제목·기관·대상이 고정본 문자열 그대로", () => {
    const a = normalizeBojo24Item(items[0]);
    expect(a.source).toBe("bojo24");
    expect(a.sourceId).toBe("000000465790");
    expect(a.title).toBe("유아학비 (누리과정) 지원");
    expect(a.agency).toBe("교육부");
    expect(a.targetText).toBe(`${items[0]["지원대상"]}\n[선정기준]\n${items[0]["선정기준"]}`);
    expect(a.url).toBe("https://www.gov.kr/portal/rcvfvrSvc/dtlEx/000000465790");
  });
  it("2건: 제목·기관·대상이 고정본 문자열 그대로", () => {
    const a = normalizeBojo24Item(items[1]);
    expect(a.title).toBe("근로·자녀장려금");
    expect(a.agency).toBe("국세청");
    expect(a.targetText).toBe(`${items[1]["지원대상"]}\n[선정기준]\n${items[1]["선정기준"]}`);
  });
  it("3건: 선정기준이 비면 지원대상만 둔다", () => {
    const a = normalizeBojo24Item(items[2]);
    expect(a.title).toBe("주택금융공사 월세자금보증");
    expect(a.agency).toBe("한국주택금융공사");
    expect(a.targetText).toBe(items[2]["지원대상"]);
  });
});

describe("보조금24 사용자구분 거르기", () => {
  it("개인 전용은 빼고 소상공인·법인/시설/단체가 포함된 건만 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = announcementsFromBojo24Json({
      data: [
        { 서비스ID: "p", 서비스명: "개인혜택", 사용자구분: "개인", 상세조회URL: "https://x.test/p", 지원대상: "개인" },
        { 서비스ID: "h", 서비스명: "가구혜택", 사용자구분: "가구", 상세조회URL: "https://x.test/h", 지원대상: "가구" },
        { 서비스ID: "s", 서비스명: "소상공인 지원", 사용자구분: "소상공인", 상세조회URL: "https://x.test/s", 지원대상: "소상공인" },
        { 서비스ID: "c", 서비스명: "법인 지원", 사용자구분: "법인/시설/단체", 상세조회URL: "https://x.test/c", 지원대상: "법인" },
        { 서비스ID: "m", 서비스명: "혼합", 사용자구분: "개인||소상공인", 상세조회URL: "https://x.test/m", 지원대상: "혼합" },
      ],
    });
    expect(list.map((a) => a.sourceId)).toEqual(["s", "c", "m"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2건"));
    warn.mockRestore();
  });
  it("고정본 3건은 개인·가구라 전부 제외된다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(announcementsFromBojo24Json(listJson)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("3건"));
    warn.mockRestore();
  });
});

/**
 * 원본이 붙인 「사용자구분」만 믿으면 사업주 공고가 샌다 — 2026-09-01 원본 10,968건 전량 실측에서
 * 두루누리(사회보험사각지대해소)·혁신 소상공인 창업지원·소규모사업장 건강상담이 전부 「개인」으로
 * 표시돼 버려지고 있었다. 그래서 지원대상·선정기준 글자의 사업주 신호도 함께 본다.
 * 범위는 사장님 결정(2026-09-01): 기업 + 농·어·임업 사업주, 순수 개인복지는 제외.
 */
describe("보조금24 — 원본이 「개인」이라 해도 사업주 공고면 담는다", () => {
  const q = (over: Record<string, unknown>) => ({
    서비스ID: "x", 서비스명: "이름", 사용자구분: "개인",
    상세조회URL: "https://x.test/x", 지원대상: "", 선정기준: "", ...over,
  });
  const passes = (item: Record<string, unknown>) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = announcementsFromBojo24Json({ data: [item] }).length === 1;
    warn.mockRestore();
    return out;
  };

  it.each([
    ["두루누리", { 서비스명: "사회보험사각지대해소", 지원대상: "10인 미만 사업장의 사업주와 근로자" }],
    ["소상공인 창업", { 서비스명: "혁신 소상공인 창업지원", 지원대상: "예비창업자 및 창업 3년 이내" }],
    ["사업장 건강상담", { 서비스명: "소규모사업장 근로자 건강상담서비스 제공", 지원대상: "50인 미만 사업장" }],
    ["제조 중소기업", { 서비스명: "스마트공장 구축", 지원대상: "제조업을 영위하는 중소기업" }],
    ["어업인 교육", { 서비스명: "어업인및어업인후계자교육지원", 지원대상: "어업인 및 수산업경영인" }],
    ["어촌 정착", { 서비스명: "청년어촌정착지원", 지원대상: "어촌에 정착한 청년" }],
    ["농업 경영체", { 서비스명: "농기계 임대", 지원대상: "농업경영체 등록 농가" }],
  ])("%s 는 담는다", (_label, over) => {
    expect(passes(q(over))).toBe(true);
  });

  it.each([
    ["기초연금", { 서비스명: "기초연금 지급", 지원대상: "만 65세 이상" }],
    ["범죄피해", { 서비스명: "범죄 피해 구조금 지급", 지원대상: "범죄피해자" }],
    ["한부모", { 서비스명: "한부모가족 임대주택 특별공급", 지원대상: "한부모가족" }],
    ["유아학비", { 서비스명: "유아학비 (누리과정) 지원", 지원대상: "유치원에 다니는 3~5세 유아" }],
    ["월세보증", { 서비스명: "주택금융공사 월세자금보증", 지원대상: "월세 계약을 체결한 대출 대상자" }],
    ["북한이탈", { 서비스명: "북한이탈주민 정착금 지원(기본금)", 지원대상: "북한이탈주민" }],
  ])("%s 는 계속 뺀다", (_label, over) => {
    expect(passes(q(over))).toBe(false);
  });

  it("개인복지 이름이면 본문에 「사업자등록」이 있어도 뺀다 — 이름이 우선", () => {
    expect(passes(q({ 서비스명: "근로·자녀장려금", 지원대상: "사업자등록을 한 사업소득자 가구" }))).toBe(false);
  });

  it("원본이 「법인/시설/단체」로 표시했으면 글자 신호가 없어도 담는다", () => {
    expect(passes(q({ 사용자구분: "법인/시설/단체", 서비스명: "이름", 지원대상: "" }))).toBe(true);
  });

  // ★적대 리뷰 ④ — 이름만 보고 자르면 지원대상에 「소상공인 사업자」가 대놓고 적힌 공고가 버려졌다.
  it.each([
    ["소상공인 월세", { 서비스명: "소상공인 임차료(월세) 지원", 지원대상: "관내 소상공인 사업자" }],
    ["지역화폐 가맹점", { 서비스명: "지역화폐 가맹점 결제수수료 지원", 지원대상: "연매출 3억 이하 소상공인" }],
    ["온누리상품권", { 서비스명: "온누리상품권 가맹점 등록 지원", 지원대상: "전통시장 내 소상공인" }],
    ["소상공인 재해위로금", { 서비스명: "소상공인 재해위로금 지원", 지원대상: "재해 피해 소상공인" }],
    ["요양기관 사업주", { 서비스명: "장기요양기관 종사자 처우개선비 지원", 지원대상: "장기요양기관을 운영하는 사업주" }],
  ])("이름이 개인복지로 보여도 지원대상에 사업주 신호가 있으면 담는다 — %s", (_l, over) => {
    expect(passes(q(over))).toBe(true);
  });

  // ★적대 리뷰 ⑤ — 「어가」가 「만들어가는」에 걸려 순수 복지가 담기던 것
  it.each([
    ["만들어가는", { 서비스명: "행복 돌봄 지원", 지원대상: "함께 만들어가는 행복도시 주민 누구나" }],
    ["들어가는", { 서비스명: "아이 돌봄 서비스", 지원대상: "돌봄에 들어가는 비용을 지원받으려는 가구" }],
    ["되어선", { 서비스명: "청소년 상담", 지원대상: "혼자가 되어선 안 되는 청소년" }],
  ])("낱말 안에 우연히 든 「어가·어선」은 안 담는다 — %s", (_l, over) => {
    expect(passes(q(over))).toBe(false);
  });

  it("진짜 어가·어선 공고는 담는다", () => {
    expect(passes(q({ 서비스명: "어선 안전장비 지원", 지원대상: "연근해 어선 소유자" }))).toBe(true);
    expect(passes(q({ 서비스명: "어가 소득안정 지원", 지원대상: "어가 단위로 신청" }))).toBe(true);
  });

  // ★적대 리뷰 ⑥ — 「사업장가입자」·「사업자등록 여부 무관」은 배경·부정문이다
  it.each([
    ["사업장가입자", { 서비스명: "국민연금 실업크레딧 지원", 지원대상: "국민연금 사업장가입자였던 자" }],
    ["사업자등록 여부", { 서비스명: "희망키움통장", 선정기준: "가구(사업자등록 여부 무관)" }],
  ])("배경·부정문으로 나온 사업 낱말은 안 담는다 — %s", (_l, over) => {
    expect(passes(q(over))).toBe(false);
  });
});

/**
 * ★적대 리뷰 ⑧ — 보조금24는 지역 칸을 안 준다. 그대로 두면 지역 조건이 0개라
 * 「안동시 축사 CCTV 지원」이 서울 회사에게 「맞음」으로 뜨고, 지역 필터에서는 사라진다.
 * 운영 실측: 열린 3,056건 전부 region="" 이고 그중 1,733건이 시·군·구 소관이었다.
 */
describe("보조금24 지역 칸 — 소관기관이 지자체면 그 이름을 싣는다", () => {
  it.each([
    ["경상북도 안동시", "경상북도 안동시"],
    ["전남광주통합특별시 보성군", "전남광주통합특별시 보성군"],
    ["서울특별시 성동구", "서울특별시 성동구"],
    ["경기도", "경기도"],
    ["제주특별자치도", "제주특별자치도"],
  ])("지자체 %s 는 지역 칸에 싣는다", (agency, want) => {
    expect(regionFromAgency(agency)).toBe(want);
  });

  it.each(["고용노동부", "중소벤처기업부", "산림청", "국세청", "보건복지부", "한국장학재단", ""])(
    "중앙기관 %s 는 전국이므로 비운다", (agency) => {
      expect(regionFromAgency(agency)).toBe("");
    });

  it("정규화 결과에도 실제로 실린다 — 배선까지 확인", () => {
    const a = normalizeBojo24Item({
      서비스ID: "x", 서비스명: "축사관리용 CCTV 지원", 소관기관명: "경상북도 안동시",
      상세조회URL: "https://x.test/x", 지원대상: "관내 축산농가",
    });
    expect(a.region).toBe("경상북도 안동시");
  });
});

/** 판정의 절반이 이 칸에 달려 있다 — 원본에서 사라지면 통과 건수가 조용히 준다(적대 리뷰 사소). */
describe("보조금24 — 판정에 쓰는 칸이 원본에 실제로 있다", () => {
  it.each(["서비스ID", "서비스명", "소관기관명", "지원대상", "선정기준", "사용자구분", "상세조회URL", "신청기한"])(
    "고정본에 「%s」 칸이 있다", (key) => {
      const items = extractBojo24Items(listJson);
      expect(items.some((i) => key in i)).toBe(true);
    });
});

describe("보조금24 keepIdentifiable", () => {
  it("공고번호·링크가 둘 다 빈 항목은 거른다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = keepIdentifiable([
      normalizeBojo24Item({ 서비스ID: "P1", 상세조회URL: "https://x.test/1" }),
      normalizeBojo24Item({ 서비스명: "빈 것" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceId).toBe("P1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1건"));
    warn.mockRestore();
  });
});

describe("보조금24 호출", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("열쇠가 없으면 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "");
    await expect(fetchBojo24All()).rejects.toThrow("DATA_GO_KR_API_KEY 없음");
  });

  it("빈 data 배열은 빈 목록", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], matchCount: 0 }),
      text: async () => "",
    }));
    await expect(fetchBojo24All()).resolves.toEqual([]);
  });

  it("data 배열이 없으면 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ matchCount: 10 }),
      text: async () => "",
    }));
    await expect(fetchBojo24All()).rejects.toThrow(/data/);
    expect(() => extractBojo24Items({})).toThrow(/data/);
    expect(() => extractBojo24Items(null)).toThrow(/data/);
  });

  it("수집+제외 합계가 matchCount 의 90% 미만이면 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matchCount: 1000,
        data: [
          { 서비스ID: "s", 서비스명: "소상공인 지원", 사용자구분: "소상공인", 상세조회URL: "https://x.test/s", 지원대상: "소상공인" },
        ],
      }),
      text: async () => "",
    }));
    await expect(fetchBojo24All()).rejects.toThrow(/90/);
  });

  it("쪽 상한 산수: ceil(matchCount/100)+2, 절대 상한 130", () => {
    expect(bojo24PageCap(200)).toBe(4);
    expect(bojo24PageCap(10957)).toBe(112);
    expect(bojo24PageCap(1)).toBe(3);
    expect(bojo24PageCap(20000)).toBe(130);
  });

  it("쪽 상한은 ceil(matchCount/100)+2 이고 절대 상한 130이다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          matchCount: 200,
          data: Array.from({ length: 100 }, (_, i) => ({
            서비스ID: `s${i}`,
            서비스명: "소상공인 지원",
            사용자구분: "소상공인",
            상세조회URL: `https://x.test/${i}`,
            지원대상: "소상공인",
          })),
        }),
        text: async () => "",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const list = await fetchBojo24All();
    expect(fetchMock).toHaveBeenCalledTimes(4); // ceil(200/100)+2
    expect(list).toHaveLength(400);
  });

  it("오류 응답은 상태코드와 본문 일부를 담아 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "UNAUTHORIZED key",
    }));
    await expect(fetchBojo24All()).rejects.toThrow(/401/);
    await expect(fetchBojo24All()).rejects.toThrow(/UNAUTHORIZED/);
  });
});
