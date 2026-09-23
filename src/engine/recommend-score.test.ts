import { describe, expect, it } from "vitest";
import { NATIONWIDE_SIDO_COUNT } from "./match-engine";
import { bucketOf, scoreOf, compareRecommend, fitVerdictOf } from "./recommend-score";
import type { ConditionCheck } from "./structure-types";

const NOW = new Date("2026-08-29T00:00:00Z");
const pass = { verdict: "pass" } as ConditionCheck;
const fail = { verdict: "fail" } as ConditionCheck;
const unknown = { verdict: "unknown" } as ConditionCheck;
const D = (s: string | null) => (s ? new Date(s) : null);

describe("구획", () => {
  it("접수중(마감 미래) → open, 상시(마감 없음) → always, 곧 시작 → upcoming", () => {
    expect(bucketOf(D("2026-08-01"), D("2026-09-10"), NOW)).toBe("open");
    expect(bucketOf(D("2026-08-01"), null, NOW)).toBe("always");
    expect(bucketOf(null, null, NOW)).toBe("always");
    expect(bucketOf(D("2026-09-05"), D("2026-09-30"), NOW)).toBe("upcoming"); // 시작이 미래면 마감 있어도 upcoming
  });
});

describe("점수", () => {
  it("일치 +15, 불일치 -40, 확인필요 0, 기본 50", () => {
    expect(scoreOf([pass, pass, unknown])).toBe(80);
    expect(scoreOf([pass, fail])).toBe(25);
  });
  it("조건 0개는 40 — 일치 1개(65)보다 아래, 불일치(10)보다 위", () => {
    expect(scoreOf([])).toBe(40);
    expect(scoreOf([fail])).toBe(10);
  });
});

describe("정렬", () => {
  const item = (bucket: "open" | "always" | "upcoming", score: number, end: string | null) =>
    ({ bucket, score, applyEnd: D(end) });
  it("구획 → 점수 → 마감임박 순", () => {
    const list = [
      item("always", 90, null),
      item("open", 50, "2026-09-01"),
      item("open", 80, "2026-09-20"),
      item("open", 80, "2026-09-02"),
      item("upcoming", 95, "2026-10-01"),
    ].sort(compareRecommend);
    expect(list.map((x) => `${x.bucket}:${x.score}`)).toEqual([
      "open:80", "open:80", "open:50", "always:90", "upcoming:95",
    ]);
    // 동점 80 둘은 마감 빠른 쪽이 앞
    expect(list[0].applyEnd?.toISOString().slice(0, 10)).toBe("2026-09-02");
  });
});

describe("맞음 판정(fitVerdictOf)", () => {
  const c = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "region", op: "in", value: ["전북"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  const corp = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "isCorporation", op: "eq", value: true, rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  const seoul = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "region", op: "in", value: ["서울"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  const scale = (verdict: "pass" | "fail" | "unknown") => ({ condition: { key: "companyScale", op: "in", value: ["소상공인"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  it("불일치가 하나라도 있으면 excluded — 일치가 있어도 탈락", () => {
    expect(fitVerdictOf([c("pass"), c("fail")])).toBe("excluded");
  });
  it("일치 1개 이상 + 불일치 0 + 확인필요 0 = fit", () => {
    expect(fitVerdictOf([c("pass")])).toBe("fit");
  });
  it("★2026-09-24 정밀 맞음 — 확인필요 조건이 하나라도 남으면 fit 이 아니다", () => {
    expect(fitVerdictOf([c("pass"), c("unknown")])).toBe("unverified");
  });
  it("조건 0개·확인필요뿐이면 unverified", () => {
    expect(fitVerdictOf([])).toBe("unverified");
    expect(fitVerdictOf([c("unknown")])).toBe("unverified");
  });
  it("법인 여부(isCorporation) pass 단독은 「전국」 pass 처럼 단독으로는 fit 근거가 못 된다 — unverified", () => {
    expect(fitVerdictOf([corp("pass")])).toBe("unverified");
  });
  it("법인 여부 pass + 구체 지역(서울) pass 가 함께 있으면 fit", () => {
    expect(fitVerdictOf([corp("pass"), seoul("pass")])).toBe("fit");
  });
  it("기업 규모(companyScale) pass 단독도 「전국」·법인 여부처럼 단독으로는 fit 근거가 못 된다 — unverified(F3 코덱스: 희망리턴처럼 규모만 맞은 상품이 fit 으로 뜨던 자리)", () => {
    expect(fitVerdictOf([scale("pass")])).toBe("unverified");
  });
  it("기업 규모 pass + 구체 지역(서울) pass 가 함께 있으면 fit", () => {
    expect(fitVerdictOf([scale("pass"), seoul("pass")])).toBe("fit");
  });
});

describe("맞음 판정 — targetOrg unknown 은 fit 금지", () => {
  const busan = (verdict: "pass" | "fail" | "unknown") =>
    ({ condition: { key: "region", op: "in", value: ["부산"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;
  const org = (verdict: "pass" | "fail" | "unknown") =>
    ({ condition: { key: "targetOrg", op: "in", value: ["사회적기업"], rawText: "", machineReadable: true }, verdict, note: "" }) as never;

  it("지역(부산) pass + targetOrg unknown → unverified (종전 fit)", () => {
    expect(fitVerdictOf([busan("pass"), org("unknown")])).toBe("unverified");
  });
  it("지역 pass + targetOrg pass → fit", () => {
    expect(fitVerdictOf([busan("pass"), org("pass")])).toBe("fit");
  });
  it("targetOrg fail 하나 → excluded", () => {
    expect(fitVerdictOf([org("fail")])).toBe("excluded");
  });
});

describe("맞음 판정 — 17개 시도 나열은 전국 약한 통과", () => {
  const SIDOS_17 = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
  const regionPass = (value: string[]) =>
    ({ condition: { key: "region", op: "in", value, rawText: "", machineReadable: true }, verdict: "pass", note: "" }) as never;

  it("17개 시도 배열 pass 하나만으로는 fit 을 주지 않는다", () => {
    expect(fitVerdictOf([regionPass(SIDOS_17)])).toBe("unverified");
  });

  it("구체 시도(전북) pass 하나는 종전대로 fit", () => {
    expect(fitVerdictOf([regionPass(["전북"])])).toBe("fit");
  });

  it("「전국」이 든 배열 pass 는 종전대로 unverified", () => {
    expect(fitVerdictOf([regionPass(["전국"])])).toBe("unverified");
  });

  it("약한 통과 문턱 NATIONWIDE_SIDO_COUNT=10 의 경계 — 9곳은 fit, 10곳은 unverified(2차 리뷰 T2)", () => {
    expect(NATIONWIDE_SIDO_COUNT).toBe(10);
    expect(fitVerdictOf([regionPass(SIDOS_17.slice(0, 9))])).toBe("fit");
    expect(fitVerdictOf([regionPass(SIDOS_17.slice(0, 10))])).toBe("unverified");
  });
});

describe("맞음 판정 — 시군구 blocksFit", () => {
  const regionPass = () =>
    ({ condition: { key: "region", op: "in", value: ["경기"], rawText: "", machineReadable: true }, verdict: "pass", note: "" }) as never;
  const blocked = () =>
    ({ condition: { key: "region", op: "in", value: ["화성시"], rawText: "", machineReadable: true }, verdict: "unknown", note: "", blocksFit: true }) as never;
  const regionFail = () =>
    ({ condition: { key: "region", op: "in", value: ["서울"], rawText: "", machineReadable: true }, verdict: "fail", note: "" }) as never;

  it("blocksFit 이 하나라도 있으면 실질 pass(지역 등)가 있어도 unverified", () => {
    expect(fitVerdictOf([regionPass(), blocked()])).toBe("unverified");
  });
  it("blocksFit 과 fail 이 함께 있으면 excluded(fail 이 먼저다)", () => {
    expect(fitVerdictOf([blocked(), regionFail()])).toBe("excluded");
  });
  it("blocksFit 이 없으면 종전 그대로 fit", () => {
    expect(fitVerdictOf([regionPass()])).toBe("fit");
  });
});

/**
 * 2026-09-24 사장님 지시 「정확도 100%」 — 「맞음」은 모든 조건이 확인된 것만.
 * 재측정(9/23): 대전 팁스타운이 전남 회사에, [강원] 청년창업자금이 충남 회사에, 예비창업자 공고가
 * 2024년 설립 회사에 「맞음」으로 떴다. 공고 쪽 조건이 비어 있어도 제목이 가르는 경우를 막는다.
 */
describe("정밀 맞음 — 공고 단위 안전장치(strictFitBlock)", () => {
  const seoulPass = { condition: { key: "region", op: "in", value: ["서울"], rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
  it("사람이 직접 확인할 조건이 있으면 fit 이 아니다", () => {
    expect(fitVerdictOf([seoulPass], { humanCheck: 1 })).toBe("unverified");
  });
  it("제목에 회사와 다른 시도가 있으면 fit 이 아니다", () => {
    expect(fitVerdictOf([seoulPass], { title: "2026년 제3차 대전 팁스타운 입주기업 모집", profile: { region: "서울" } })).toBe("unverified");
    expect(fitVerdictOf([seoulPass], { title: "[강원] 2026년 청년창업자금 무이자 대출지원", profile: { region: "서울" } })).toBe("unverified");
  });
  it("제목의 시도가 회사 시도와 같으면 막지 않는다", () => {
    expect(fitVerdictOf([seoulPass], { title: "2026년 서울시 소상공인 경영개선 지원", profile: { region: "서울" } })).toBe("fit");
  });
  it("회사 시도를 모르면 제목에 시도가 있는 공고는 fit 이 아니다", () => {
    expect(fitVerdictOf([seoulPass], { title: "부산 스타트업 지원", profile: {} })).toBe("unverified");
  });
  it("예비창업자·재창업자 공고는 회사가 예비창업자일 때만 fit", () => {
    const title = "2026년 로봇분야 예비창업자 및 재창업자를 위한 창업 성장 프로그램";
    expect(fitVerdictOf([seoulPass], { title, profile: { region: "서울", foundedDate: "2024-03-01" } })).toBe("unverified");
    expect(fitVerdictOf([seoulPass], { title, profile: { region: "서울", companyScale: "예비창업자", industry: "산업용 로봇 제조업" } })).toBe("fit");
  });
  it("제목에 시군구가 있으면 회사 시군구가 같을 때만 fit — 9/23 재측정 「창원시 벤처투자」·「용인시 반도체」", () => {
    expect(fitVerdictOf([seoulPass], { title: "창원시 벤처투자 『매칭&피칭데이』참여기업 모집 공고", profile: { region: "경남", regionSigungu: "양산시" } })).toBe("unverified");
    expect(fitVerdictOf([seoulPass], { title: "용인시 반도체 기업 채용 연계 지원 안내", profile: { region: "경기" } })).toBe("unverified");
    const empPass = { condition: { key: "employeeMax", op: "lte", value: 50, rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
    expect(fitVerdictOf([empPass], { title: "창원시 벤처투자 참여기업 모집", profile: { region: "경남", regionSigungu: "창원시" } })).toBe("fit");
  });
  it.each([
    ["※스팸문자주의※ :"], ["[공지] PTP포장기 공개매각 공고"], ["제안서 평가위원(후보자) 모집안내"],
    ["2026년 나노소재기술개발사업 신규과제 선정결과(4차) 공고"], ["한국환경산업기술원 비상임임원(이사 및 감사) 초빙공고"],
    ["직원 채용 공고"], ["2026 설문조사 안내"],
  ])("지원사업이 아닌 글은 fit 이 아니다 — %s", (title) => {
    expect(fitVerdictOf([seoulPass], { title, profile: { region: "서울" } })).toBe("unverified");
  });
  it("규칙으로만 뽑은 조건(AI 미검증)이면 fit 이 아니다", () => {
    expect(fitVerdictOf([seoulPass], { title: "2026년 소상공인 경영개선 지원", profile: { region: "서울" }, ruleOnly: true })).toBe("unverified");
  });
  it("안전장치는 fail(excluded)을 fit 으로 올리지 않는다", () => {
    const f = { condition: { key: "region", op: "in", value: ["부산"], rawText: "", machineReadable: true }, verdict: "fail", note: "" } as never;
    expect(fitVerdictOf([f], { title: "서울 지원", profile: { region: "서울" } })).toBe("excluded");
  });
});

/** 2026-09-24 사장님 결정 — 결격 사항은 막지 않고 표시, 자격 관련 사람 확인은 막음, 업종 무관 공고는 맞음 금지. */
describe("정밀 맞음 — 사람 확인 항목 분류·업종 무관 차단", () => {
  const empPass = { condition: { key: "employeeMax", op: "lte", value: 50, rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
  const P = { region: "서울", industry: "간판 및 광고물 제조업" };
  it("결격 사항·지원내용 안내뿐이면 맞음", () => {
    expect(fitVerdictOf([empPass], { title: "소상공인 경영개선 지원", profile: P, humanCheck: 0, humanCheckTexts: [
      "휴·폐업 기업 제외", "허위 또는 부정한 방법으로 신청한 경우", "※ 자세한 지원내용 공고문 참조", "국세·지방세 체납 기업 제외",
    ] })).toBe("fit");
  });
  it("자격 관련 사람 확인(「중소기업」·「지원대상 공고문 참조」)이 남으면 맞음이 아니다", () => {
    expect(fitVerdictOf([empPass], { title: "소상공인 경영개선 지원", profile: P, humanCheckTexts: ["중소기업"] })).toBe("unverified");
    expect(fitVerdictOf([empPass], { title: "소상공인 경영개선 지원", profile: P, humanCheckTexts: ["※ 자세한 지원대상 공고문 참조"] })).toBe("unverified");
  });
  it("회사 업종과 무관한 분야 공고는 맞음이 아니다 — 광고회사에 치매의료기술연구개발", () => {
    expect(fitVerdictOf([empPass], { title: "2026년도 치매의료기술연구개발사업 1차 신규과제 공모", profile: P })).toBe("unverified");
  });
  it("업종을 모르면 분야가 적힌 공고는 맞음이 아니다", () => {
    expect(fitVerdictOf([empPass], { title: "로봇분야 스타트업 성장 지원", profile: { region: "서울" } })).toBe("unverified");
  });
  it("회사 업종과 같은(이웃) 분야면 맞음", () => {
    expect(fitVerdictOf([empPass], { title: "로봇분야 스타트업 성장 지원", profile: { region: "서울", industry: "금속 절삭가공 제조업" } })).toBe("fit");
  });
  // 독립 리뷰 review-1b329d8d·ERP 리뷰 — 문장 끝 모양(「경우」·「한하여 신청」)이나 결격 낱말 하나로
  // 자격 문장 전체를 결격으로 치면 나이·실적을 확인하지 않고 맞음이 된다.
  it.each([
    "대표자가 만 39세 이하인 경우",
    "수출 실적이 있는 기업에 한하여 신청",
    "지원대상: 수출 실적 보유 기업(국세 체납 기업 제외)",
    "대학과 기술이전 계약을 체결한 경우",
    "만 39세 초과 시 신청 불가",
    "체납이 없고 수출 실적이 있는 기업",
    "상장기업 및 수출 실적이 없는 기업은 지원대상에서 제외",
    "대표자가 만 39세 이하인 기업은 신청서 제출",
    "신청서상 대표자가 만 39세 이하인 경우",
    "중소기업만 신청서 제출 가능",
    "코스닥 상장기업만 신청서 제출 가능",
    "연체 중인 소상공인",
    "폐업 소상공인",
    "체납이 없는 법인에 한하여 신청",
    "체납이 없는 시내 기업",
    "신청자는 폐업 이력이 있는 자",
    "신용불량 상태인 기업",
    "회생 중인 기업",
    "휴·폐업중인 기업",
    "지원내용: 신용불량 상태인 기업",
  ])("자격 문장 「%s」 이 남으면 맞음이 아니다", (t) => {
    expect(fitVerdictOf([empPass], { title: "2026년 경영환경 개선 지원사업", profile: P, humanCheckTexts: [t] })).toBe("unverified");
  });
  it("결격 낱말이 공고의 대상이면(폐업 지원) 결격으로 보지 않는다", () => {
    expect(fitVerdictOf([empPass], { title: "2026년 폐업 소상공인 사업정리 지원사업 공고", profile: P, humanCheckTexts: ["폐업 소상공인"] })).toBe("unverified");
    expect(fitVerdictOf([empPass], { title: "소상공인 재기 지원", profile: P, humanCheckTexts: ["연체 중인 소상공인"] })).toBe("unverified");
  });
  it("제목 분야는 업종 조건으로 면제하지 않는다 — 선택지 중 무엇이 맞았는지 몰라 구멍이 난다(4차 리뷰)", () => {
    const indPass = { condition: { key: "industry", op: "in", value: ["식품"], rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
    // 정확도 우선: 식품업체도 「홍보영상」(콘텐츠) 분야와 이어지지 않아 확인 필요로 내려간다(알려진 손해).
    expect(fitVerdictOf([empPass, indPass], { title: "2026년 식품제조업 전용 홍보영상 제작 지원사업", profile: { region: "서울", industry: "식품 제조업" } })).toBe("unverified");
    const adPass = { condition: { key: "industry", op: "in", value: ["광고"], rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
    expect(fitVerdictOf([empPass, adPass], { title: "2026년 식품제조업 전용 홍보영상 제작 지원사업", profile: P })).toBe("unverified");
    const mixed = { condition: { key: "industry", op: "in", value: ["제조업", "소프트웨어"], rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
    expect(fitVerdictOf([empPass, mixed], { title: "2026년 식품제조업 전용 홍보영상 제작 지원사업", profile: P })).toBe("unverified");
    // 넓은 업종 조건(「제조업」)은 제목의 구체 분야(식품)를 확인하지 못한다 — 광고물 제조업체는 막는다.
    const broad = { condition: { key: "industry", op: "in", value: ["제조업"], rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
    expect(fitVerdictOf([empPass, broad], { title: "2026년 식품제조업 전용 홍보영상 제작 지원사업", profile: P })).toBe("unverified");
    // 업종 조건이 없으면 여전히 막는다(광고회사)
    expect(fitVerdictOf([empPass], { title: "2026년 식품제조업 전용 홍보영상 제작 지원사업", profile: P })).toBe("unverified");
  });
  it("「지원대상에서 제외」라는 결격 문장은 맞음을 막지 않는다", () => {
    expect(fitVerdictOf([empPass], { title: "2026년 경영환경 개선 지원사업", profile: P, humanCheckTexts: ["상장기업은 지원대상에서 제외", "국세·지방세 체납 기업 제외"] })).toBe("fit");
  });
  it("제목의 분야가 여럿이면 모두 회사 업종과 관련 있어야 맞음 — 식품제조업 전용 홍보영상", () => {
    expect(fitVerdictOf([empPass], { title: "2026년 식품제조업 전용 홍보영상 제작 지원사업", profile: P })).toBe("unverified");
  });
  it("가림 합성어(귀금속)도 제목 분야로 읽는다 — 식품 제조업체에 귀금속 제조업 전용 공고", () => {
    const broad = { condition: { key: "industry", op: "in", value: ["제조업"], rawText: "", machineReadable: true }, verdict: "pass", note: "" } as never;
    expect(fitVerdictOf([empPass, broad], { title: "2026년 귀금속 제조업 전용 지원사업", profile: { region: "서울", industry: "식품 제조업" } })).toBe("unverified");
  });
  it.each([
    "2026년 음료 제조업 전용 지원사업", "2026년 미용업 전용 경영환경 개선 지원사업",
    "2026년 IT 기업 전용 지원사업", "2026년 교육업 전용 지원사업", "2026년 기계 제조업 전용 지원사업",
  ])(
    "판정용 분야 사전 낱말도 제목 분야로 읽는다 — 「%s」",
    (title) => {
      const food = { region: "서울", industry: "한식 음식점업" };
      expect(fitVerdictOf([empPass], { title, profile: /음료/.test(title) ? P : food, humanCheckTexts: ["국세·지방세 체납 기업 제외"] })).toBe("unverified");
    },
  );
  it("「정보통신」 한국어 표기도 분야로 읽는다", () => {
    expect(fitVerdictOf([empPass], { title: "2026년 정보통신산업 기술개발 지원사업", profile: { region: "서울", industry: "음식점업" } })).toBe("unverified");
  });
  it("분야가 안 적힌 일반 공고는 업종과 상관없이 맞음(작업환경 개선 등)", () => {
    expect(fitVerdictOf([empPass], { title: "도시제조업 작업환경개선 지원", profile: P })).toBe("fit");
  });
});
