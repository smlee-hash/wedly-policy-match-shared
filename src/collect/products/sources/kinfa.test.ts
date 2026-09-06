import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 JSON 대신 **실사이트 고정본**으로 잰다(2026-09-03 10:20 실측,
 * `POST https://www.kinfa.or.kr/financialProduct/loanProductGlanceSearch.do`) — 지어낸 표본은
 * 실제 API 가 섞어 보내는 문자참조(`&#40;`)·서식 없는 숫자(`inrt:"4.5"`)·"-" 값을 놓친다.
 * 표본은 325건 중 12건이고, 그중 사업자 관련 낱말이 `trgt` 에 있는 7건만 남아야 한다(hint 실측).
 */
import sample from "../__fixtures__/kinfa-sample.json";

vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }));

import { fetchProductText } from "../fetch";
import { fetchKinfaAll, KINFA_DETAIL_URL, kinfaSource, KINFA_LIST_URL, parseKinfa } from "./kinfa";

const rows = parseKinfa(sample as unknown[]);

describe("parseKinfa — 서민금융진흥원 12건 중 사업자 대상만(실사이트 고정본)", () => {
  it("근로자·주거·서민생활 전용 5건은 빠지고 7건만 남는다", () => {
    expect(rows).toHaveLength(7);
  });

  it("징검다리론 — 한도(만원)·금리·기간·대상·취급기관을 읽는다", () => {
    const jj = rows.find((p) => p.name === "징검다리론");
    expect(jj).toMatchObject({
      source: "product-kinfa",
      institutionType: "microfinance",
      fundingGroup: "urgent",
      limitText: "3,000만원",
      limitMaxWon: 30_000_000,
      rateText: "9% 이내",
      rateMin: null,
      termText: "5년",
      channel: "14개 취급은행",
    });
  });

  it("★사업자 낱말이 trgt 에 없는 항목(근로자·주거·서민생활 전용)은 뺀다", () => {
    const names = rows.map((p) => p.name);
    // 트리거된 항목의 trgt 원문(실측): "금융취약계층, 기타"·"금융취약계층"·서술형 문장 — 사업자 낱말이 전혀 없다
    expect(names).not.toContain("전세자금보증(특례)_정책서민금융 이용자");
    expect(names).not.toContain("불법사금융예방대출(이전 소액생계비대출)");
    expect(names).not.toContain("햇살론일반");
    expect(names).not.toContain("금융취약계층 생계자금");
    expect(names).not.toContain("햇살론특례");
  });

  it("★trgt 에 「창업」·「자영업」·「소상공인」만 있어도 남긴다 — 「사업자」로 낱말을 좁히지 않는다", () => {
    // 청년 미래이음 대출: trgt="…취·창업 1년 이내…"("창업"), 미소금융 운영자금_청년: trgt="영세 자영업을…"("자영업"),
    // 소상공인 특례 햇살론카드: trgt="소상공인"
    const names = rows.map((p) => p.name);
    expect(names).toContain("청년 미래이음 대출");
    expect(names).toContain("미소금융 운영자금_청년");
    expect(names).toContain("소상공인 특례 햇살론카드");
  });

  it("★문자참조(&#40;·&#41;)가 전부 괄호로 풀린다 — 이름·대상 글에 「&#」가 남지 않는다", () => {
    expect(rows.every((p) => !p.name.includes("&#") && !p.targetText.includes("&#"))).toBe(true);
    const r = rows.find((p) => p.name === "미소금융 운영자금");
    expect(r?.targetText).toBe(
      "개인신용평점 하위 20% 또는 차상위계층 이하 또는 근로장려금 신청 대상(수급자)인 자영업자 중 사업자 등록 후 3개월 이상 운영 중인 자",
    );
  });

  it("★대상 상세 글의 줄바꿈·탭·중복 공백은 한 칸으로 모은다(원문에 \\r\\n·이중 공백 실측)", () => {
    const r = rows.find((p) => p.name === "소상공인 특례 햇살론카드");
    expect(r?.targetText).toBe(
      "중·저신용 개인사업자 1. 연 가처분소득 600만원 이상 2. 신용평점 하위 50% 이하 (NICE 또는 KCB 중 낮은 평점 기준)",
    );
  });

  it("이름에 미소금융·햇살론·재기가 있으면 urgent — 6건", () => {
    const urgentNames = rows.filter((p) => p.fundingGroup === "urgent").map((p) => p.name).sort();
    expect(urgentNames).toEqual(
      [
        "징검다리론",
        "미소금융 운영자금",
        "미소금융 재기자금123_운영자금",
        "미소금융 운영자금_무등록사업자",
        "미소금융 운영자금_청년",
        "소상공인 특례 햇살론카드",
      ].sort(),
    );
  });

  it("★좁은 서민금융 낱말이 이름에 없으면 공용 6갈래 규칙으로 — 「대출」만 있는 「청년 미래이음 대출」은 policy", () => {
    const r = rows.find((p) => p.name === "청년 미래이음 대출");
    expect(r?.fundingGroup).toBe("policy");
  });

  it("★이름에 「보증」이 있으면 urgent 낱말보다 뒤라도 guarantee로 갈린다(합성 표본 — 실제 12건엔 없다)", () => {
    const synthetic = [
      {
        fincPrdNm: "테스트 특례보증",
        lonLmt: "1000",
        inrt: "연 3.0%",
        totLonPrid: "3",
        trgt: "사업자",
        ofrInsttNm: "테스트기관",
      },
    ];
    const out = parseKinfa(synthetic);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ fundingGroup: "guarantee", rateText: "연 3.0%", rateMin: 3 });
  });

  // F3(2026-09-03 코덱스 리뷰): targetRules 는 더 이상 항상 빈 값이 아니다 — spprtTrgtDetlCnd 가
  // 있으면 그 글을 humanCheck 로 담는다(아래 별도 시험). 고정본 7건 전부 spprtTrgtDetlCnd 가 있어
  // 여기서는 「빈 값」 대신 다른 공통 칸만 확인한다.
  it("모든 건이 institutionType microfinance · detailUrl 고정 · deadlineText 상시", () => {
    for (const r of rows) {
      expect(r.institutionType).toBe("microfinance");
      expect(r.detailUrl).toBe(KINFA_DETAIL_URL);
      expect(r.deadlineText).toBe("상시");
      expect(r.institution).toBe("서민금융진흥원");
    }
  });

  it("★spprtTrgtDetlCnd 원문을 targetRules.humanCheck 한 항목으로 담는다 — 기계로 못 재는 자격조건을 버리지 않는다(F3)", () => {
    const jj = rows.find((p) => p.name === "징검다리론");
    expect(jj?.targetRules).toEqual({
      humanCheck: [
        "정책서민금융상품을 2년 이상 성실하게 이용 또는 최근 3년 내 완제하였으며, 서민금융진흥원 서민특화 신용평가모형 심사를 통해 선별된 자",
      ],
    });
  });

  it("★humanCheck 원문이 80자를 넘으면 자른다(미소금융 운영자금_무등록사업자 — 원문 108자)", () => {
    const r = rows.find((p) => p.name === "미소금융 운영자금_무등록사업자");
    expect(r?.targetRules).toEqual({
      humanCheck: [
        "개인신용평점 하위 20% 또는 차상위계층 이하 또는 근로장려금 신청 대상(수급자)인 무등록사업자 중 3개월 이상 사업을 영위한 자(프리랜서의 경",
      ],
    });
    expect(r?.targetRules.humanCheck?.[0]).toHaveLength(80);
  });

  it("★spprtTrgtDetlCnd 가 없으면(값 없음 \"-\") targetRules 는 그대로 빈 값(합성 표본)", () => {
    const synthetic = [
      { fincPrdNm: "테스트 창업자금", trgt: "예비창업자 및 소상공인", spprtTrgtDetlCnd: "-", ofrInsttNm: "테스트기관" },
    ];
    expect(parseKinfa(synthetic)[0]?.targetRules).toEqual({});
  });

  it("금리 원문에 「%」 표기가 없으면(예: \"4.5\") rateText 는 원문 그대로, rateMin 은 지어내지 않고 null", () => {
    const r = rows.find((p) => p.name === "미소금융 운영자금");
    expect(r).toMatchObject({ rateText: "4.5", rateMin: null }); // 원문 그대로 — "%"를 붙여 지어내지 않는다
  });

  it("한도·기간이 \"-\"(값 없음)면 빈 값으로 정직하게 — 채널은 여전히 채운다", () => {
    const r = rows.find((p) => p.name === "소상공인 특례 햇살론카드");
    expect(r).toMatchObject({ rateText: "", termText: "", limitText: "500만원", limitMaxWon: 5_000_000 });
  });

  it("sourceId — fincPrdSno 가 없는 고정본 7건은 이름+취급기관 정규화, 전부 겹치지 않는다", () => {
    const byName = Object.fromEntries(rows.map((p) => [p.name, p.sourceId]));
    expect(byName["징검다리론"]).toBe("징검다리론|14개취급은행");
    expect(byName["미소금융 재기자금123_운영자금"]).toBe("미소금융재기자금123_운영자금|서민금융진흥원");
    expect(new Set(rows.map((p) => p.sourceId)).size).toBe(7);
  });

  it("★fincPrdSno 가 있으면(장차 실API) 그 값을 그대로 sourceId 로 쓴다(합성 표본)", () => {
    const synthetic = [
      { fincPrdSno: "PRD-001", fincPrdNm: "테스트 사업자 대출", lonLmt: "500", trgt: "사업자", ofrInsttNm: "테스트은행" },
    ];
    expect(parseKinfa(synthetic)[0]?.sourceId).toBe("PRD-001");
  });

  it("★spprtTrgtDetlCnd 가 없으면(값 없음 \"-\") trgt 원문으로 targetText 를 채운다(합성 표본)", () => {
    const synthetic = [
      { fincPrdNm: "테스트 창업자금", trgt: "예비창업자 및 소상공인", spprtTrgtDetlCnd: "-", ofrInsttNm: "테스트기관" },
    ];
    expect(parseKinfa(synthetic)[0]?.targetText).toBe("예비창업자 및 소상공인");
  });

  it("취급기관(ofrInsttNm)이 비어 있으면 채널·기관 모두 서민금융진흥원으로 정직하게 채운다(합성 표본)", () => {
    const synthetic = [{ fincPrdNm: "테스트 사업자자금", trgt: "사업자", ofrInsttNm: null }];
    const out = parseKinfa(synthetic);
    expect(out[0]).toMatchObject({ channel: "서민금융진흥원", institution: "서민금융진흥원" });
  });
});

describe("fetchKinfaAll — 실제 수집 배선(POST JSON)", () => {
  beforeEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });
  afterEach(() => {
    vi.mocked(fetchProductText).mockReset();
  });

  it("고정 주소로 POST JSON 요청을 보내고, 100건 넘는 응답은 parseKinfa 로 넘긴다", async () => {
    // 고정본은 12건뿐이라(< 100) 실 규모를 흉내내려고 9번 이어붙인다 — 반쪽 응답 방어선은
    // "필터 후 몇 건 남았나"가 아니라 "원본 배열이 몇 건 왔나"를 잰다(hint: 325건 응답 중 사업자만 남김).
    const padded = Array.from({ length: 9 }, () => sample as unknown[]).flat();
    vi.mocked(fetchProductText).mockResolvedValue(JSON.stringify(padded));

    const list = await fetchKinfaAll();

    expect(list).toHaveLength(7 * 9); // 사업자 대상만 걸러진 뒤의 건수
    expect(fetchProductText).toHaveBeenCalledWith(
      { id: "product-kinfa", baseUrl: "https://www.kinfa.or.kr" },
      KINFA_LIST_URL,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPageNo: 1, recordCountPerPage: 400 }) },
      { timeoutMs: 60_000, maxBytes: 12_000_000 },
    );
  });

  it("★원본 배열이 100건 미만이면(고정본 그대로 12건) 반쪽 응답으로 보고 던진다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(JSON.stringify(sample));
    await expect(fetchKinfaAll()).rejects.toThrow();
  });

  it("★응답이 배열이 아니면(오류 페이지 등) 0건으로 보고 던진다", async () => {
    vi.mocked(fetchProductText).mockResolvedValue(JSON.stringify({ error: "서비스 점검중" }));
    await expect(fetchKinfaAll()).rejects.toThrow();
  });
});

describe("kinfaSource — 명부에 실릴 모양(공통 계약)", () => {
  it("id·라벨·주소·fetchAll 이 계획대로다", () => {
    expect(kinfaSource.id).toBe("product-kinfa");
    expect(kinfaSource.label).toBe("서민금융진흥원 정책서민금융상품");
    expect(kinfaSource.url).toBe(KINFA_DETAIL_URL);
    expect(kinfaSource.fetchAll).toBe(fetchKinfaAll);
  });
});
