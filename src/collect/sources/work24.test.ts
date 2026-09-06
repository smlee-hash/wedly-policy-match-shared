import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const announcementFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyAnnouncement: {
      findMany: (...a: unknown[]) => announcementFindMany(...a),
    },
  },
}));

import {
  estimateTitle,
  parseWork24Detail,
  isIndividualOnly,
  planScanIds,
  fetchWork24All,
  type Work24Fetcher,
} from "./work24";

const FX = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const VALID = FX("work24-detail-si318.html");
const EMPTY = FX("work24-detail-empty.html");

describe("parseWork24Detail — 유효 상세", () => {
  const d = parseWork24Detail(VALID, "SI00000318")!;
  it("제도명은 머리(고객센터) h2 가 아니라 마지막 h2_sb", () => {
    expect(d.title).toBe("청년 일자리도약 장려금");
  });
  it("지원자격 섹션 원문이 targetText 로", () => {
    expect(d.targetText).toContain("지원");
    expect(d.targetText.length).toBeGreaterThan(30);
    expect(d.targetText).not.toContain("<"); // 태그 제거됨
  });
  it("자격조건 표제가 「신청자격」·「가입대상」·「지원대상」·「신청대상」·「지원조건」이어도 targetText 로 잡는다(2026-08-31 실측: 「지원자격」은 여러 표제 중 하나뿐)", () => {
    const html = (heading: string) =>
      `<h2 class="h2_sb">제목</h2><h3>지원내용</h3>지원 내용입니다.<h3>${heading}</h3>사업주만 해당`;
    expect(parseWork24Detail(html("신청자격"), "SI1")!.targetText).toContain("사업주만 해당");
    expect(parseWork24Detail(html("가입대상"), "SI1")!.targetText).toContain("사업주만 해당");
    expect(parseWork24Detail(html("지원대상"), "SI1")!.targetText).toContain("사업주만 해당");
    expect(parseWork24Detail(html("신청대상"), "SI1")!.targetText).toContain("사업주만 해당");
    expect(parseWork24Detail(html("지원조건"), "SI1")!.targetText).toContain("사업주만 해당");
    expect(parseWork24Detail(html("참여대상"), "SI1")!.targetText).toContain("사업주만 해당"); // fable 리뷰 중요1(SI00000335 실측)
  });
  it("우선순위가 높은 표제가 있어도 본문이 공백뿐이면 건너뛰고 다음 후보를 본다(fable 리뷰 중요2)", () => {
    const html =
      `<h2 class="h2_sb">제목</h2><h3>지원내용</h3>내용` +
      `<h3>지원자격</h3>   \n  <h3>신청자격</h3>진짜 자격: 상시근로자 5인 이상 중소기업`;
    expect(parseWork24Detail(html, "SI1")!.targetText).toBe("진짜 자격: 상시근로자 5인 이상 중소기업");
  });
  it("「지원자격」과 다른 표제가 함께 있으면 「지원자격」을 우선한다(기존 동작 보존)", () => {
    const html =
      `<h2 class="h2_sb">제목</h2><h3>지원내용</h3>내용<h3>신청자격</h3>덜 우선<h3>지원자격</h3>더 우선`;
    expect(parseWork24Detail(html, "SI1")!.targetText).toBe("더 우선");
  });
  it("지원내용 앞부분이 요약으로 (3000자 이내)", () => {
    expect(d.summary.length).toBeGreaterThan(10);
    expect(d.summary.length).toBeLessThanOrEqual(3000);
  });
  it("지원내용 요약은 3000자까지 남긴다 (500에서 잘리지 않음)", () => {
    const body = "가".repeat(600);
    const html =
      `<h2 class="h2_sb">제목</h2><h3>지원내용</h3>${body}<h3>지원자격</h3>사업주`;
    expect(parseWork24Detail(html, "SI1")!.summary).toBe(body);
  });
  it("본문 속 신청 주소를 찾는다 (「신청」 낱말 근처의 링크)", () => {
    expect(d.applyUrl).toContain("work24.go.kr");
    expect(d.applyUrl).toContain("operOrgList");
  });
  it("개요·지원내용·지원자격을 sections 로 보존한다", () => {
    expect(d.sections.개요).toContain("청년");
    expect(d.sections.지원내용.length).toBeGreaterThan(0);
    expect(d.sections.지원자격).toContain("지원");
    expect(d.sections.개요).not.toContain("<");
  });
  it("h2 class 속성 순서가 달라도 제도명을 읽는다", () => {
    const html =
      `<h2 id="t" class="foo h2_sb bar">섞인 제목</h2>` +
      `<h3>지원내용</h3>지원합니다.<h3>지원자격</h3>사업주 지원`;
    expect(parseWork24Detail(html, "SI00000001")?.title).toBe("섞인 제목");
  });
  it("신청 주소는 https 의 .go.kr/.or.kr 만 채택한다", () => {
    const html = (href: string) =>
      `<h2 class="h2_sb">제목</h2>사업신청 <a href="${href}">링크</a>` +
      `<h3>지원내용</h3>내용입니다.<h3>지원자격</h3>사업주`;
    expect(parseWork24Detail(html("https://evil.example.com/a"), "SI1")?.applyUrl).toBe("");
    expect(parseWork24Detail(html("http://www.work24.go.kr/a"), "SI1")?.applyUrl).toBe("");
    expect(parseWork24Detail(html("https://www.work24.go.kr/a"), "SI1")?.applyUrl)
      .toBe("https://www.work24.go.kr/a");
    expect(parseWork24Detail(html("https://www.hrdkorea.or.kr/a"), "SI1")?.applyUrl)
      .toBe("https://www.hrdkorea.or.kr/a");
    expect(parseWork24Detail(html("https://127.0.0.1:1:2"), "SI1")?.applyUrl).toBe("");
  });
  it("신청 근처 링크가 도메인 검사에서 거부되면 다음 허용 링크를 채택한다", () => {
    const html =
      `<h2 class="h2_sb">제목</h2>` +
      `사업신청 <a href="https://evil.example.com/a">나쁜링크</a>` +
      `신청 <a href="https://www.work24.go.kr/ok">좋은링크</a>` +
      `<h3>지원내용</h3>내용입니다.<h3>지원자격</h3>사업주`;
    expect(parseWork24Detail(html, "SI1")?.applyUrl).toBe("https://www.work24.go.kr/ok");
  });
  it("한 「신청」 낱말이 거부된 링크와 그 다음 무관 링크를 둘 다 보증하지 않는다", () => {
    const html =
      `<h2 class="h2_sb">제목</h2>` +
      `신청 <a href="https://evil.example.com/a">나쁜링크</a>` +
      `${"가".repeat(80)}` +
      `<a href="https://www.work24.go.kr/unrelated">무관</a>` +
      `<h3>지원내용</h3>내용입니다.<h3>지원자격</h3>사업주`;
    expect(parseWork24Detail(html, "SI1")?.applyUrl).toBe("");
  });
  it("빈 머리 h2_sb 가 마지막이어도 제도명·신청 주소를 읽는다", () => {
    const html =
      `<h2 class="h2_sb">고객센터</h2>` +
      `<h2 class="h2_sb">청년 일자리도약 장려금</h2>` +
      `사업신청 <a href="https://www.work24.go.kr/wk/k/a/1430/operOrgList.do">링크</a>` +
      `<h3>지원내용</h3>지원합니다.<h3>지원자격</h3>사업주` +
      `<h2 class="h2_sb quick"><span class="ico"></span></h2>`;
    const d = parseWork24Detail(html, "SI1")!;
    expect(d.title).toBe("청년 일자리도약 장려금");
    expect(d.applyUrl).toBe("https://www.work24.go.kr/wk/k/a/1430/operOrgList.do");
  });
  it("h2_sb 가 고객센터와 빈 머리뿐이어도 내용이 있으면 담는다(제목만 빈 값 — 계약 변경 2026-08-26)", () => {
    const html =
      `<h2 class="h2_sb">고객센터</h2>` +
      `<h3>지원내용</h3>내용입니다.<h3>지원자격</h3>사업주` +
      `<h2 class="h2_sb quick"><span class="ico"></span></h2>`;
    const d = parseWork24Detail(html, "SI1");
    expect(d).not.toBeNull();
    expect(d!.title).toBe("");
  });
});

describe("parseWork24Detail — 없는 번호", () => {
  it("내용 h3(지원내용·지원자격)가 없으면 null", () => {
    expect(parseWork24Detail(EMPTY, "SI09999999")).toBeNull();
  });
  it("자격조건류 표제 7개 중 어느 것도 없으면(지원내용만 있어도) targetText 는 빈 문자열(fable 리뷰 사소 — 회귀 방지)", () => {
    const html = `<h2 class="h2_sb">제목</h2><h3>지원내용</h3>내용만 있음<h3>신청방법</h3>방문 접수`;
    const d = parseWork24Detail(html, "SI1");
    expect(d).not.toBeNull();
    expect(d!.targetText).toBe("");
  });
});

describe("isIndividualOnly — 기업/개인 거르기", () => {
  it("사업주·기업 낱말이 있으면 담는다", () => {
    expect(isIndividualOnly("사업주 및 근로자를 지원", "아무 제목")).toBe(false);
  });
  it("개인 낱말만 있으면 제외", () => {
    expect(isIndividualOnly("구직자의 실업급여 수급을 지원", "구직자 취업 지원")).toBe(true);
  });
  it("애매하면(양쪽 다 없음) 담는다", () => {
    expect(isIndividualOnly("자세한 내용은 운영지침 참조", "지원 제도")).toBe(false);
  });
});

describe("planScanIds — 훑기 계획", () => {
  it("아는 번호가 없으면 시딩: 1~600", () => {
    const ids = planScanIds([]);
    expect(ids[0]).toBe("SI00000001");
    expect(ids[ids.length - 1]).toBe("SI00000600");
    expect(ids.length).toBe(600);
  });
  it("아는 번호가 있으면: 1 ~ max(600, 아는최대+200) 전 구간 + 아는 번호", () => {
    const ids = planScanIds(["SI00000318", "SI00000320"]);
    expect(ids[0]).toBe("SI00000001");
    expect(ids[ids.length - 1]).toBe("SI00000600");
    expect(ids).toContain("SI00000318");
    expect(ids).toContain("SI00000320");
    expect(ids.length).toBe(600);
  });
  it("아는 최대가 580이면 780까지", () => {
    const ids = planScanIds(["SI00000580"]);
    expect(ids[0]).toBe("SI00000001");
    expect(ids[ids.length - 1]).toBe("SI00000780");
    expect(ids.length).toBe(780);
  });
  it("깨진 번호는 무시", () => {
    const ids = planScanIds(["엉터리", "SI00000010"]);
    expect(ids.length).toBe(600);
  });
});

describe("fetchWork24All — 수집 루프 (fetcher 주입)", () => {
  beforeEach(() => {
    announcementFindMany.mockReset().mockResolvedValue([]);
  });

  const okFetch: Work24Fetcher = async (id) =>
    id === "SI00000318" ? { status: 200, text: VALID } : { status: 200, text: EMPTY };

  it("유효 번호만 공고로 만든다", async () => {
    const out = await fetchWork24All({
      knownIds: ["SI00000318", "SI00000319"],
      fetcher: okFetch,
      delayMs: 0,
    });
    expect(out.length).toBe(1);
    const a = out[0];
    expect(a.source).toBe("work24");
    expect(a.sourceId).toBe("SI00000318");
    expect(a.title).toBe("청년 일자리도약 장려금");
    expect(a.applyStart).toBeNull();
    expect(a.applyPeriodText).toBe("상시(제도)");
    expect(a.category).toBe("인력");
    expect(a.url).toBe(
      "https://www.work24.go.kr/cm/c/f/1100/selecSystInfo.do?systId=SI00000318",
    );
    expect((a.raw as { applyUrl: string }).applyUrl).toContain("operOrgList");
    expect((a.raw as { sections: { 개요: string } }).sections.개요).toBeTruthy();
  });

  it("안전선: 아는 번호 통신 실패비율 50% 이상(동률 포함)이면 던진다", async () => {
    const mixed: Work24Fetcher = async (id) => {
      if (id === "SI00000318") return { status: 200, text: VALID };
      if (id === "SI00000320") throw new Error("연결 실패");
      return { status: 200, text: EMPTY };
    };
    await expect(
      fetchWork24All({ knownIds: ["SI00000318", "SI00000320"], fetcher: mixed, delayMs: 0, ratioMinSample: 1 }),
    ).rejects.toThrow(/통신 실패/);
  });

  it("아는 번호가 전부 통신 실패면 던진다", async () => {
    const badFetch: Work24Fetcher = async () => { throw new Error("연결 실패"); };
    await expect(
      fetchWork24All({ knownIds: ["SI00000318", "SI00000320"], fetcher: badFetch, delayMs: 0 }),
    ).rejects.toThrow(/통신 실패/);
  });

  it("기본 knownIds 조회는 열린 행만 분모 — 닫힌 번호는 전 구간 훑기가 다시 방문", async () => {
    announcementFindMany.mockResolvedValue([
      { sourceId: "SI00000001" },
      { sourceId: "SI00000002" },
    ]);
    const open = ["SI00000001", "SI00000002"];
    const fetcher: Work24Fetcher = async (id) =>
      open.includes(id) ? { status: 200, text: VALID } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({ fetcher, delayMs: 0, seedEnd: 10 });
    expect(announcementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "work24", status: "open" },
        select: { sourceId: true, title: true },
      }),
    );
    expect(out.map((a) => a.sourceId).sort()).toEqual(open);
  });

  it("열린 2만 분모 — 닫힌 8건이 비어 있어도 개편 감지가 오발하지 않는다", async () => {
    // 운영에서 닫힌 8이 분모에 쌓이면 2/10 < 50% 로 개편 감지가 오발한다.
    // knownIds 주입 = 기본 조회가 열린 행만 돌려준 결과.
    const open = ["SI00000001", "SI00000002"];
    const closed = Array.from({ length: 8 }, (_, i) => `SI${String(i + 3).padStart(8, "0")}`);
    const fetcher: Work24Fetcher = async (id) =>
      open.includes(id) ? { status: 200, text: VALID } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({
      knownIds: open,
      fetcher,
      delayMs: 0,
      seedEnd: 10,
    });
    expect(closed).toHaveLength(8);
    expect(out.map((a) => a.sourceId).sort()).toEqual(open);
  });

  // defaultLoadStored 의 where 에 status:'open' 을 넣는 것은 prisma 를 주입하지 않아
  // 여기서 검증할 수 없다 — 구현(defaultLoadStored findMany where)을 직접 확인.
  // 닫힌 제도가 통신 실패를 계기로 되살아나지 않게 하기 위함. 아래는 주입 경로 시험.
  it("실패비율이 50% 미만이면 실패한 아는 번호는 저장 행을 되살린다", async () => {
    const restored = {
      source: "work24" as const,
      sourceId: "SI00000320",
      title: "저장된 제도",
      agency: "고용노동부(고용24)",
      category: "인력",
      region: "",
      summary: "저장 요약",
      targetText: "저장 대상",
      applyStart: null,
      applyEnd: null,
      applyPeriodText: "상시(제도)",
      url: "https://www.work24.go.kr/cm/c/f/1100/selecSystInfo.do?systId=SI00000320",
      attachments: [],
      raw: { systId: "SI00000320" },
    };
    const fetcher: Work24Fetcher = async (id) => {
      if (id === "SI00000318") return { status: 200, text: VALID };
      if (id === "SI00000319") return { status: 200, text: VALID };
      if (id === "SI00000320") return { status: 500, text: "err" };
      return { status: 200, text: EMPTY };
    };
    const seen: string[][] = [];
    const out = await fetchWork24All({
      knownIds: ["SI00000318", "SI00000319", "SI00000320"],
      fetcher,
      delayMs: 0,
      loadStored: async (ids) => {
        seen.push(ids);
        return [restored];
      },
    });
    expect(seen).toEqual([["SI00000320"]]);
    expect(out.map((a) => a.sourceId).sort()).toEqual(["SI00000318", "SI00000319", "SI00000320"]);
    expect(out.find((a) => a.sourceId === "SI00000320")?.title).toBe("저장된 제도");
  });

  it("빈 번호(내용 h3 없음)는 통신 실패가 아니라 빠져서 마감된다", async () => {
    // 일부만 소실(1/2)이면 집단 감지가 아니라 그 건만 자연 마감.
    const fetcher: Work24Fetcher = async (id) =>
      id === "SI00000318" ? { status: 200, text: VALID } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({
      knownIds: ["SI00000318", "SI00000320"],
      fetcher,
      delayMs: 0,
    });
    expect(out.map((a) => a.sourceId)).toEqual(["SI00000318"]);
  });

  it("아는 번호 2건이 모두 200인데 내용 소실이면 회차를 폐기한다", async () => {
    await expect(
      fetchWork24All({
        knownIds: ["SI00000001", "SI00000002"],
        fetcher: async () => ({ status: 200, text: EMPTY }),
        delayMs: 0,
        ratioMinSample: 1, // 이 시험의 뜻은 「비율 판정」 — 최소표본 규칙과는 다른 축이다
        seedEnd: 5,
      }),
    ).rejects.toThrow(/표식 소실/);
  });

  it("아는 번호 1건만 내용 소실이면 통과하고 그 건만 빠진다", async () => {
    const fetcher: Work24Fetcher = async (id) =>
      id === "SI00000001" ? { status: 200, text: VALID } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({
      knownIds: ["SI00000001", "SI00000002"],
      fetcher,
      delayMs: 0,
      seedEnd: 5,
    });
    expect(out.map((a) => a.sourceId)).toEqual(["SI00000001"]);
  });

  it("통신 실패가 연속 10번이면 즉시 회차를 중단한다", async () => {
    let calls = 0;
    const fetcher: Work24Fetcher = async () => {
      calls++;
      throw new Error("연결 실패");
    };
    await expect(
      fetchWork24All({ knownIds: [], fetcher, delayMs: 0, seedEnd: 50 }),
    ).rejects.toThrow(/연쇄 통신 실패/);
    expect(calls).toBe(10);
  });

  it("차단 감지: 「정상적인 접근」 문구가 오면 즉시 던진다", async () => {
    const blockedFetch: Work24Fetcher = async () => ({
      status: 200,
      text: "<script>alert('정상적인 접근 방식이 아닙니다.');</script>",
    });
    await expect(
      fetchWork24All({ knownIds: ["SI00000318"], fetcher: blockedFetch, delayMs: 0 }),
    ).rejects.toThrow(/차단/);
  });

  it("시딩 모드(아는 번호 0)에서는 안전선을 새 번호에 적용하지 않는다", async () => {
    // 시딩은 대부분 빈 번호라 정상률 낮은 게 정상 — 통신 오류율로만 판단
    const sparse: Work24Fetcher = async (id) =>
      id === "SI00000318" ? { status: 200, text: VALID } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({ knownIds: [], fetcher: sparse, delayMs: 0, seedEnd: 320 });
    expect(out.length).toBe(1);
  });
});

describe("빈 제목 서버 변형 (2026-08-26 실측)", () => {
  const NOTITLE = FX("work24-detail-si318-notitle.html");

  it("내용이 있으면 제목이 비어도 null 이 아니다", () => {
    const d = parseWork24Detail(NOTITLE, "SI00000318");
    expect(d).not.toBeNull();
    expect(d!.title).toBe("");
    expect(d!.targetText.length).toBeGreaterThan(30);
  });

  it("빈 번호(내용 없음)는 여전히 null — 재시도 대상 아님", () => {
    expect(parseWork24Detail(FX("work24-detail-empty.html"), "SI09999999")).toBeNull();
  });

  it("재시도로 제목 있는 변형을 얻으면 그 제목 사용 (같은 번호 2회 호출)", async () => {
    const EMPTY = FX("work24-detail-empty.html");
    let calls318 = 0;
    const flip: Work24Fetcher = async (id) =>
      id === "SI00000318"
        ? { status: 200, text: ++calls318 === 1 ? NOTITLE : VALID }
        : { status: 200, text: EMPTY };
    const out = await fetchWork24All({ knownIds: ["SI00000318"], fetcher: flip, delayMs: 0 });
    expect(out.length).toBe(1);
    expect(out[0].title).toBe("청년 일자리도약 장려금");
    expect(calls318).toBe(2);
  });

  it("계속 빈 변형이면 본문에서 제도명을 추정한다 — 정확 문자열(리뷰 M2)", async () => {
    const EMPTY = FX("work24-detail-empty.html");
    const always: Work24Fetcher = async (id) =>
      id === "SI00000318" ? { status: 200, text: NOTITLE } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({ knownIds: ["SI00000318"], fetcher: always, delayMs: 0 });
    expect(out.length).toBe(1);
    expect(out[0].title).toBe("청년일자리도약장려금");
  });

  it("저장된 진짜 제목이 있으면 추정으로 덮지 않는다 (리뷰 C1)", async () => {
    const EMPTY = FX("work24-detail-empty.html");
    const always: Work24Fetcher = async (id) =>
      id === "SI00000318" ? { status: 200, text: NOTITLE } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({
      knownIds: ["SI00000318"],
      knownTitles: new Map([["SI00000318", "청년 일자리도약 장려금"]]),
      fetcher: always,
      delayMs: 0,
    });
    expect(out.length).toBe(1);
    expect(out[0].title).toBe("청년 일자리도약 장려금");
  });

  it("개인전용 판정엔 추정 제목을 쓰지 않는다 — 빈 진짜 제목이면 보수적으로 담는다 (리뷰 C2)", async () => {
    // 지원자격에 기업 낱말이 없고, 본문에 「지원금」류 낱말이 있어 추정 제목이 개인 낱말을 물 수 있는 판.
    const page =
      `<h2 class="h2_sb">고객센터</h2><div><h2 class="h2_sb"></h2></div>` +
      `<h3>지원내용</h3>직업훈련 수료자에게 구직급여 지원금 안내를 제공합니다` +
      `<h3>지원자격</h3>훈련 수료자`;
    const EMPTY = FX("work24-detail-empty.html");
    const f: Work24Fetcher = async (id) =>
      id === "SI00000010" ? { status: 200, text: page } : { status: 200, text: EMPTY };
    const out = await fetchWork24All({ knownIds: ["SI00000010"], fetcher: f, delayMs: 0 });
    expect(out.length).toBe(1); // 추정 제목(구직급여 지원금)이 판정에 들어갔다면 0건이 됐을 것
  });

  it("진짜 제목·저장 제목·추정 전부 없으면 그 건은 담지 않는다 (리뷰 H4)", async () => {
    const page =
      `<h2 class="h2_sb">고객센터</h2><h2 class="h2_sb"></h2>` +
      `<h3>지원자격</h3>사업주`; // 지원내용 없음 → 추정 최후 대체도 지원자격? — 지원내용·개요 다 비면 빈 제목
    const f: Work24Fetcher = async () => ({ status: 200, text: page });
    const out = await fetchWork24All({ knownIds: ["SI00000010"], fetcher: f, delayMs: 0, seedEnd: 10 });
    expect(out.length).toBe(0);
  });

  it("estimateTitle — 연도 접두를 떼고 제도명을 뽑는다", () => {
    expect(estimateTitle({ 개요: "2026년도 청년일자리도약장려금 지원요건은…", 지원내용: "", 지원자격: "" }))
      .toBe("청년일자리도약장려금");
    expect(estimateTitle({ 개요: "특별한 명칭 없음", 지원내용: "중소기업을 돕는 사업입니다", 지원자격: "" }))
      .toContain("…");
  });
});

describe("시간 예산으로 쪼개 이어보기", () => {
  const okHtml = (t: string) =>
    `<h2 class="h2_sb">${t}</h2><h3>지원내용</h3>내용<h3>지원자격</h3>사업주 대상`;

  it("예산을 넘기면 거기서 멈추고, 다음 회차가 이어볼 자리를 남긴다", async () => {
    let saved: number | null = null;
    let clock = 0;
    const out = await fetchWork24All({
      knownIds: [],
      seedEnd: 50,
      delayMs: 0,
      fetcher: async (id) => { clock += 60_000; return { status: 200, text: okHtml(`제도 ${id}`) }; },
      now: () => clock,
      budgetMs: 3 * 60_000,      // 3분 예산 · 한 건에 1분 → 몇 건만 훑고 멈춰야 한다
      loadCursor: async () => 1,
      saveCursor: async (n) => { saved = n; },
      loadStored: async () => [],
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(50);   // 전부 안 훑었다
    expect(saved).not.toBeNull();
    expect(saved).toBeGreaterThan(1);      // 다음엔 그 뒤부터
  });

  it("아는 번호가 많아 예산 안에 다 못 봐도, 못 본 것은 저장된 행으로 메꾼다 — 안 그러면 멀쩡한 제도가 닫힌다", async () => {
    // 아는 번호 5개 · 한 건에 1분 · 예산 2분 → 뒤쪽 아는 번호는 이번에 못 본다.
    // 그 번호들을 저장된 행으로 되돌려 주지 않으면 markStaleClosed 가 통째로 닫는다.
    const known = ["SI00000010", "SI00000011", "SI00000012", "SI00000013", "SI00000014"];
    const storedRow = (id: string) => ({
      source: "work24", sourceId: id, title: "저장된 제도", agency: "고용노동부(고용24)",
      category: "인력", region: "", summary: "", targetText: "사업주",
      applyStart: null, applyEnd: null, applyPeriodText: "상시(제도)",
      url: "u", attachments: [], raw: {},
    });
    let askedFor: string[] = [];
    let clock = 0;
    const out = await fetchWork24All({
      knownIds: known,
      knownTitles: new Map(known.map((k) => [k, "저장된 제도"])),
      seedEnd: 600, delayMs: 0,
      fetcher: async (id) => { clock += 60_000; return { status: 200, text: okHtml(`제도 ${id}`) }; },
      now: () => clock,
      budgetMs: 2 * 60_000,
      ratioMinSample: 99,          // 표본 부족으로 안전선이 도는 것과 이 시험을 섞지 않는다
      loadCursor: async () => 1,
      saveCursor: async () => {},
      loadStored: async (ids) => { askedFor = ids; return ids.map(storedRow); },
    });
    expect(askedFor.length).toBeGreaterThan(0);              // 못 본 아는 번호가 실제로 있었다
    for (const id of askedFor) expect(out.some((o) => o.sourceId === id)).toBe(true);
  });

  it("끝까지 훑으면 이어볼 자리를 처음으로 되돌린다", async () => {
    let saved: number | null = null;
    await fetchWork24All({
      knownIds: [], seedEnd: 3, delayMs: 0,
      fetcher: async (id) => ({ status: 200, text: okHtml(`제도 ${id}`) }),
      now: () => 0,              // 시간이 안 흐른다 = 예산에 안 걸린다
      budgetMs: 60_000,
      loadCursor: async () => 1,
      saveCursor: async (n) => { saved = n; },
      loadStored: async () => [],
    });
    expect(saved).toBe(1);       // 한 바퀴 다 돌았으니 처음부터
  });

  it("이어볼 자리부터 시작한다 — 그 앞 번호는 이번에 안 부른다", async () => {
    const called: string[] = [];
    await fetchWork24All({
      knownIds: [], seedEnd: 10, delayMs: 0,
      fetcher: async (id) => { called.push(id); return { status: 200, text: okHtml("t") }; },
      now: () => 0, budgetMs: 60_000,
      loadCursor: async () => 8,
      saveCursor: async () => {},
      loadStored: async () => [],
    });
    expect(called[0]).toBe("SI00000008");
    expect(called).not.toContain("SI00000001");
  });
});

describe("쪼개 훑기의 안전선·이어볼 자리 (적대 리뷰 반영)", () => {
  const okHtml = (t: string) =>
    `<h2 class="h2_sb">${t}</h2><h3>지원내용</h3>내용<h3>지원자격</h3>사업주 대상`;

  it("표본이 적으면 비율 안전선으로 회차를 버리지 않는다 — 아는 번호 1개가 없어졌다고 개편이 아니다", async () => {
    // 아는 번호 1개만 걸리는 좁은 구간 + 그 번호가 빈 페이지(정상 폐지)
    const out = await fetchWork24All({
      knownIds: ["SI00000002"],
      knownTitles: new Map([["SI00000002", "옛 제도"]]),
      seedEnd: 3, delayMs: 0,
      fetcher: async (id) =>
        id === "SI00000002" ? { status: 200, text: "<html>빈 번호</html>" } : { status: 200, text: okHtml("살아있는 제도") },
      now: () => 0, budgetMs: 60_000,
      loadCursor: async () => 1, saveCursor: async () => {},
      loadStored: async () => [],
    });
    // 예전 규칙이면 knownParsedOk/knownTried = 0/1 < 0.5 로 통째로 던졌다.
    expect(Array.isArray(out)).toBe(true);
  });

  it("회차를 버릴 때는 이어볼 자리도 되돌린다 — 안 그러면 이번 구간의 새 번호가 사라진다", async () => {
    const saved: number[] = [];
    let n = 0;
    await expect(
      fetchWork24All({
        // 아는 번호 30개 중 3분의 2를 통신 실패시켜 **루프 뒤** 비율 안전선에 걸리게 한다
        // (연속 10회 실패로 루프 안에서 던지지 않도록 3건에 1건은 성공시킨다)
        knownIds: Array.from({ length: 30 }, (_, i) => `SI${String(i + 1).padStart(8, "0")}`),
        seedEnd: 30, delayMs: 0,
        fetcher: async () => { n += 1; return n % 3 === 0 ? { status: 200, text: VALID } : { status: 500, text: "" }; },
        now: () => 0, budgetMs: 60_000,
        loadCursor: async () => 5,
        saveCursor: async (v) => { saved.push(v); },
        loadStored: async () => [],
      }),
    ).rejects.toThrow(/통신 실패/);
    // 마지막으로 적힌 값이 「시작할 때 읽은 자리」로 되돌아가 있어야 한다
    expect(saved[saved.length - 1]).toBe(5);
  });

  it("통신 오류율은 전체 목록이 아니라 **훑은 개수**로 잰다 — 아는 번호 유무와 무관하게", async () => {
    // 목록은 600개지만 예산에 걸려 30개만 훑고, 그중 20개(66%)가 통신 실패다 → 버려야 한다.
    // 옛 규칙(전체 목록 길이로 나누기)이면 20/600 = 3% 라 장애를 그냥 통과시킨다.
    // ★ seedEnd 를 훑는 개수보다 훨씬 크게 둬야 두 분모가 갈린다(안 그러면 시험이 아무것도 못 가른다).
    let n = 0;
    let clock = 0;
    await expect(
      fetchWork24All({
        knownIds: [], seedEnd: 600, delayMs: 0,
        fetcher: async () => {
          n += 1;
          return n % 3 === 0 ? { status: 200, text: okHtml("t") } : { status: 500, text: "" };
        },
        now: () => { const t = clock; clock += 1000; return t; }, // 한 건에 1초
        budgetMs: 30_000,                                          // 30건쯤에서 멈춘다
        loadCursor: async () => 1, saveCursor: async () => {},
        loadStored: async () => [],
      }),
    ).rejects.toThrow(/통신 오류율/);
  });
});

describe("아는 번호 먼저 · 탐색만 나눠 돌기", () => {
  const okHtml = (t: string) =>
    `<h2 class="h2_sb">${t}</h2><h3>지원내용</h3>내용<h3>지원자격</h3>사업주 대상`;

  it("아는 번호는 이어볼 자리와 무관하게 **매 회차 전부** 훑는다", async () => {
    // 이어볼 자리가 500 인데도 아는 번호 3·7 은 이번에 다 봐야 한다.
    const called: string[] = [];
    await fetchWork24All({
      knownIds: ["SI00000003", "SI00000007"],
      knownTitles: new Map([["SI00000003", "가"], ["SI00000007", "나"]]),
      seedEnd: 600, delayMs: 0,
      fetcher: async (id) => { called.push(id); return { status: 200, text: okHtml("t") }; },
      now: () => 0, budgetMs: 60_000,
      loadCursor: async () => 500,
      saveCursor: async () => {},
      loadStored: async () => [],
    });
    expect(called.slice(0, 2)).toEqual(["SI00000003", "SI00000007"]); // 맨 앞에서 처리
  });

  it("이어볼 자리는 탐색 몫에서만 센다 — 아는 번호가 섞여 자리가 튀면 안 된다", async () => {
    // 아는 번호는 400번대인데 탐색은 1번부터다. 예산에 걸려 멈추면 자리는 **탐색 쪽** 다음 번호여야 한다.
    let saved: number | null = null;
    let clock = 0;
    await fetchWork24All({
      knownIds: ["SI00000400"],
      knownTitles: new Map([["SI00000400", "가"]]),
      seedEnd: 600, delayMs: 0,
      fetcher: async () => { clock += 60_000; return { status: 200, text: okHtml("t") }; },
      now: () => clock,
      budgetMs: 4 * 60_000,   // 아는 1건 + 탐색 몇 건만
      loadCursor: async () => 1,
      saveCursor: async (n) => { saved = n; },
      loadStored: async () => [],
    });
    expect(saved).not.toBeNull();
    expect(saved).toBeLessThan(100);  // 400(아는 번호)이 아니라 탐색 앞쪽 번호여야 한다
    expect(saved).toBeGreaterThan(1);
  });

  it("아는 번호가 133개면 안전선 표본이 매 회차 보장된다 — 표본 미달로 안전선이 꺼지지 않는다", async () => {
    // 아는 번호 30개를 전부 빈 페이지로 만들면(사이트 개편) 파싱률 0% 라 회차를 버려야 한다.
    // 예전 구조였다면 이 30개가 한 구간에 다 걸릴지 알 수 없어 안전선이 꺼질 수 있었다.
    const known = Array.from({ length: 30 }, (_, i) => `SI${String(300 + i).padStart(8, "0")}`);
    await expect(
      fetchWork24All({
        knownIds: known,
        knownTitles: new Map(known.map((k) => [k, "옛 제도"])),
        seedEnd: 600, delayMs: 0,
        fetcher: async () => ({ status: 200, text: "<html>빈 번호</html>" }),
        now: () => 0, budgetMs: 60_000,
        loadCursor: async () => 1, saveCursor: async () => {},
        loadStored: async () => [],
      }),
    ).rejects.toThrow(/표식 소실/);
  });
});

describe("적대 리뷰 반영 — 404·대량 폐지·예산", () => {
  const okHtml = (t: string) =>
    `<h2 class="h2_sb">${t}</h2><h3>지원내용</h3>내용<h3>지원자격</h3>사업주 대상`;

  it("404 는 「없는 번호」로 본다 — 연달아 나와도 회차를 중단하지 않는다", async () => {
    // 없어진 제도 12개가 나란히 404 면, 404 를 통신 실패로 세는 옛 규칙에서는
    // 「연쇄 통신 실패」로 회차가 통째로 중단됐다.
    const known = Array.from({ length: 12 }, (_, i) => `SI${String(i + 1).padStart(8, "0")}`);
    const out = await fetchWork24All({
      knownIds: known,
      knownTitles: new Map(known.map((k) => [k, "옛 제도"])),
      seedEnd: 20, delayMs: 0,
      fetcher: async (id) => (known.includes(id) ? { status: 404, text: "" } : { status: 200, text: okHtml("살아있음") }),
      now: () => 0, budgetMs: 60_000,
      ratioMinSample: 99,
      loadCursor: async () => 1, saveCursor: async () => {},
      loadStored: async () => [],
    });
    expect(Array.isArray(out)).toBe(true); // 중단되지 않았다
  });

  it("제도가 절반쯤 정상 폐지돼도 회차를 버리지 않는다 — 매번 같은 자리에서 걸리면 영영 못 나간다", async () => {
    const known = Array.from({ length: 30 }, (_, i) => `SI${String(300 + i).padStart(8, "0")}`);
    const dead = new Set(known.slice(0, 18)); // 60% 폐지
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await fetchWork24All({
      knownIds: known,
      knownTitles: new Map(known.map((k) => [k, "제도"])),
      seedEnd: 340, delayMs: 0,
      fetcher: async (id) => (dead.has(id) ? { status: 200, text: "<html>빈 번호</html>" } : { status: 200, text: okHtml("살아있음") }),
      now: () => 0, budgetMs: 60_000,
      loadCursor: async () => 1, saveCursor: async () => {},
      loadStored: async () => [],
    });
    expect(Array.isArray(out)).toBe(true);
  });

  it("거의 전부 파싱 실패면 그때는 회차를 버린다 — 진짜 개편 감지는 살아 있어야 한다", async () => {
    const known = Array.from({ length: 30 }, (_, i) => `SI${String(300 + i).padStart(8, "0")}`);
    await expect(
      fetchWork24All({
        knownIds: known,
        knownTitles: new Map(known.map((k) => [k, "제도"])),
        seedEnd: 340, delayMs: 0,
        fetcher: async () => ({ status: 200, text: "<html>빈 번호</html>" }),
        now: () => 0, budgetMs: 60_000,
        loadCursor: async () => 1, saveCursor: async () => {},
        loadStored: async () => [],
      }),
    ).rejects.toThrow(/표식 소실/);
  });

  it("아는 번호가 많으면 예산을 늘려 **전부** 훑는다 — 뒤쪽이 확인 없이 「최신」으로 보이면 안 된다", async () => {
    // 400개 × 1.1초 ≈ 7.3분 > 기본 6분. 예산이 고정이면 뒤쪽 70여 개는 영영 차례가 안 온다.
    const known = Array.from({ length: 400 }, (_, i) => `SI${String(i + 1).padStart(8, "0")}`);
    const seen = new Set<string>();
    let clock = 0;
    await fetchWork24All({
      knownIds: known,
      knownTitles: new Map(known.map((k) => [k, "제도"])),
      seedEnd: 400, delayMs: 0,
      fetcher: async (id) => { seen.add(id); clock += 1100; return { status: 200, text: okHtml("t") }; },
      now: () => clock,
      // budgetMs 를 주지 않는다 — 아는 번호 수에 맞춰 스스로 늘려야 한다
      ratioMinSample: 99,
      loadCursor: async () => 1, saveCursor: async () => {},
      loadStored: async () => [],
    });
    for (const k of known) expect(seen.has(k)).toBe(true);
  });
});
