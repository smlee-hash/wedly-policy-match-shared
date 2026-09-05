import { describe, expect, it } from "vitest";
import { extractAmount, extractRate, normalizeRateMin, wonOf } from "./amount-rate-extract";

describe("wonOf — 한글 단위 금액 → 원", () => {
  it("억·천만·백만·만 단위와 쉼표를 읽는다", () => {
    expect(wonOf("1억원")).toBe(100_000_000);
    expect(wonOf("5,000만원")).toBe(50_000_000);
    expect(wonOf("2천만원")).toBe(20_000_000);
    expect(wonOf("1억 5천만원")).toBe(150_000_000);
    expect(wonOf("600만 원")).toBe(6_000_000);
    expect(wonOf("3000")).toBeNull(); // 단위 없는 숫자는 뜻을 모른다(서금원 lonLmt 는 어댑터가 만원으로 안다)
  });
});

describe("extractAmount — 본문에서 지원 한도", () => {
  it("「최대/한도/기업당 N원」을 뽑고 가장 큰 값을 상한으로 둔다 — amountText 도 그 최댓값을 낳은 표현(G3③ — 2026-09-03 코덱스 지적, 예전엔 첫 표현을 보여줬다)", () => {
    const r = extractAmount("운전자금 최대 1억원, 시설자금 최대 5억원까지 지원");
    expect(r.amountText).toBe("최대 5억원");
    expect(r.amountMaxWon).toBe(500_000_000);
  });
  it("비율만 있으면 글자만 남기고 상한은 null", () => {
    const r = extractAmount("도입비의 70% 이내 지원");
    expect(r.amountText).toBe("70% 이내 지원");
    expect(r.amountMaxWon).toBeNull();
  });
  it("아무것도 없으면 빈 값", () => {
    expect(extractAmount("참가 기업을 모집합니다")).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("「한도」 뒤 콜론(:) 도 허용 — 자부담 비율(%)은 한도로 잡지 않는다", () => {
    const r = extractAmount("지원한도: 1,000만원 · 자부담 30% 이내");
    expect(r).toEqual({ amountText: "한도 1,000만원", amountMaxWon: 10_000_000 });
  });
  it("낱말 없이 금액만 있는 짧은 글(80자 이하)은 원문 그대로 담고 가장 큰 값을 상한으로 둔다", () => {
    const r = extractAmount("운전 1억원,시설 5억원");
    expect(r).toEqual({ amountText: "운전 1억원,시설 5억원", amountMaxWon: 500_000_000 });
  });

  // ★사업 총 규모를 기업 한 곳 한도로 읽지 않는다 (2026-09-03 운영 실측: 지도의
  //   「안 갚아도 되는 돈 · 최대」가 500억원으로 떴다 — 공고 본문의 「총 500억원 규모」가 한도로 저장됐다)
  it("금액 앞 8자에 「총·규모·예산·조성·펀드·기금·재원·출자」가 있으면 한도로 보지 않는다 — 같은 글의 기업당 한도는 그대로 잡는다", () => {
    const r = extractAmount("총 500억원 규모로 기업당 최대 5억원 지원");
    expect(r.amountText).toBe("기업당 최대 5억원");
    expect(r.amountMaxWon).toBe(500_000_000);
  });
  it("사업 총 규모만 적힌 글은 빈 값 — 「최대」가 붙어 있어도 100억 넘는 금액은 기업당 표시가 없으면 버린다", () => {
    expect(extractAmount("최대 300억원 펀드 조성")).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("짧은 글의 낱말 없는 금액 훑기에도 같은 규칙이 걸린다 — 「총사업비」 뒤 금액은 한도가 아니다", () => {
    expect(extractAmount("총사업비 최대 50억원")).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("100억이 넘어도 「기업당」이 앞에 있으면 진짜 한도로 인정한다", () => {
    const r = extractAmount("기업당 최대 150억원");
    expect(r.amountText).toBe("기업당 최대 150억원");
    expect(r.amountMaxWon).toBe(15_000_000_000);
  });

  // ★자격·기준 금액을 「받는 돈」으로 읽지 않는다 (2026-09-03 독립 검사 A · 배포본 캡처
  //   `09-amount-is-eligibility-ceiling.png` — 앞면이 「최대 3억원」인데 실제 지원은 월 1만원이었다)
  it("「연매출 3억원 이하 소상공인」의 3억은 자격 문턱이지 한도가 아니다 — 빈 값으로 둔다(캡처 09·10)", () => {
    const 원문 =
      "영세 소상공인 노란우산 가입지원\n\n도내 연매출 3억원 이하 소상공인 신규가입자에게 월 1만원씩 12개월 지원";
    expect(extractAmount(원문)).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("「이하」가 없어도 금액 앞 10자에 매출·자본금·자산·보험료·납입·가입이 있으면 자격 금액이다(노란우산공제 희망장려금과 같은 모양)", () => {
    expect(extractAmount("노란우산공제 희망장려금 연매출 3억원 소상공인 지원")).toEqual({
      amountText: "",
      amountMaxWon: null,
    });
  });
  // ★2026-09-03 코덱스 적대 리뷰 재지적 — 「금액에 더 가까운 낱말이 이긴다」 전제가 틀렸다. 「신청대상:
  //   연매출 최대 3억원 이하 소상공인」은 「최대」가 「매출」보다 금액에 가까워 옛 규칙(가까운 쪽이 이김)이
  //   한도로 오판했다. 「매출」 같은 자격 명사와 뒤 「이하」가 함께 있으면, 그 사이에 최대·한도가 껴도
  //   무조건 자격 조건이다(새 규칙 1번).
  it("「신청대상: 연매출 최대 3억원 이하 소상공인」— 「최대」가 「매출」보다 금액에 가까워도 자격 문턱이다(빈 값)", () => {
    expect(extractAmount("신청대상: 연매출 최대 3억원 이하 소상공인")).toEqual({
      amountText: "",
      amountMaxWon: null,
    });
  });
  // ★2026-09-03 코덱스 적대 리뷰 지적 2 — 뒤 6자에 이하·미만·이상·초과·까지의 가 있어도, 앞 10자에
  //   「한도 낱말」(한도·최대·지원·융자·대출·보증 등)이 자격 낱말(매출·자본금 등)보다 금액에 더 가까이
  //   있으면 그건 진짜 한도다. 예전엔 뒤 낱말만 보고 무조건 자격 조건으로 버렸다(「지원한도 3억원 이하」가
  //   빈 값이 됐다).
  it("「융자 지원한도 3억원 이하」는 진짜 한도다 — 앞 10자의 「한도」 낱말이 뒤 「이하」보다 우선", () => {
    const r = extractAmount("융자 지원한도 3억원 이하");
    expect(r.amountText).toBe("한도 3억원");
    expect(r.amountMaxWon).toBe(300_000_000);
  });
  it("「지원한도 5억원까지의 융자금」도 진짜 한도다 — 뒤 「까지의」보다 앞 「지원·한도」가 우선", () => {
    const r = extractAmount("지원한도 5억원까지의 융자금");
    expect(r.amountText).toBe("한도 5억원");
    expect(r.amountMaxWon).toBe(500_000_000);
  });
  // ★위 지적 2 로 뜻이 바뀐 기존 시험 — 예전 제목·기대값("버린다")은 「뒤 낱말이 항상 이긴다」는 옛
  //   규칙 그대로였다. 이제 앞 10자에 매출·자본금 같은 자격 낱말이 없고 「지원한도」만 있으므로 진짜
  //   한도로 뽑는다(위 두 새 시험과 같은 문형). 자격 낱말이 실제로 있는 경우는 바로 아래 시험이 잇는다.
  it("금액 뒤 6자에 미만이 와도 앞 10자에 자격 낱말이 없고 「한도」만 있으면 한도로 본다(지적 2로 기대값 변경 — 예전엔 무조건 버렸다)", () => {
    const r = extractAmount("지원한도 3억원 미만 기업");
    expect(r.amountText).toBe("한도 3억원");
    expect(r.amountMaxWon).toBe(300_000_000);
    // 반대로 자격 낱말이 하나도 없는 짧은 글은 예전 그대로 읽는다(BARE 규칙이 통째로 죽으면 안 된다)
    expect(extractAmount("운전 1억원,시설 5억원")).toEqual({
      amountText: "운전 1억원,시설 5억원",
      amountMaxWon: 500_000_000,
    });
  });
  it("앞 10자에 「한도」 낱말 없이 매출액 같은 자격 낱말만 있으면 뒤가 「미만」이어도 여전히 빈 값(「매출액 10억원 미만 기업」)", () => {
    expect(extractAmount("매출액 10억원 미만 기업")).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("자격 금액이 괄호로 곁들여져도 진짜 한도는 그대로 남는다 — 「기업당 최대 5억원(연매출 100억 이하)」", () => {
    const r = extractAmount("기업당 최대 5억원(연매출 100억 이하)");
    expect(r.amountText).toBe("기업당 최대 5억원");
    expect(r.amountMaxWon).toBe(500_000_000);
  });

  // ★2026-09-03 코덱스 적대 리뷰 지적 3 — 앞 10자의 보험료·가입·납입 같은 자격 접두어가 실제 지급액
  //   (「최대」·「지원」 낱말이 자격 접두어와 금액 사이에 낀 경우)까지 버렸다.
  it("「사회보험료 지원 최대 50만원」은 지급액이다 — 「보험료」보다 「최대」가 금액에 더 가깝다", () => {
    const r = extractAmount("사회보험료 지원 최대 50만원");
    expect(r.amountText).toBe("최대 50만원");
    expect(r.amountMaxWon).toBe(500_000);
  });
  it("「신규가입 지원금 최대 12만원」도 지급액이다 — 「가입」보다 「지원금·최대」가 금액에 더 가깝다", () => {
    const r = extractAmount("신규가입 지원금 최대 12만원");
    expect(r.amountText).toBe("최대 12만원");
    expect(r.amountMaxWon).toBe(120_000);
  });

  // ★2026-09-03 코덱스 적대 리뷰 7차 지적 1 — 규칙 1 이 「자격 명사가 보이면 끝」이라, 「매출채권 지원한도
  //   3억원 이하」처럼 **명시적 한도 표현**(「지원한도」)까지 버렸다(「매출채권」 안의 「매출」+뒤 「이하」로
  //   자격 판정 → 빈 값). 자격 명사와 금액 **사이**에 「한도|한도액」이 있으면 한도다 — 「최대」만 낀
  //   「연매출 최대 3억원 이하」는 여전히 자격 문턱(위 시험 그대로).
  it("「매출채권 지원한도 3억원 이하」는 진짜 한도다 — 자격 명사(매출)와 금액 사이의 「한도」가 이긴다(7차 지적 1)", () => {
    const r = extractAmount("매출채권 지원한도 3억원 이하");
    expect(r.amountText).toBe("한도 3억원");
    expect(r.amountMaxWon).toBe(300_000_000);
  });
  it("「연매출 최대 3억원 이하 소상공인」은 여전히 빈 값 — 사이에 「최대」만 있으면 규칙 1 그대로(7차 지적 1 의 반례)", () => {
    expect(extractAmount("연매출 최대 3억원 이하 소상공인")).toEqual({ amountText: "", amountMaxWon: null });
  });
  // ★7차 지적 2 — ① 비교어 분기(규칙 1·2·3)의 자격 명사에 보험료·납입·가입이 빠져 있었고 ② 「지원대상」의
  //   「지원」이 문맥 없이 한도 낱말로 세어져 「지원대상: 보험료 50만원 이하」가 50만원 한도로 저장됐다.
  it("「지원대상: 보험료 50만원 이하」는 자격 조건(빈 값) — 보험료는 자격 명사, 「지원대상」의 「지원」은 한도 낱말이 아니다(7차 지적 2)", () => {
    expect(extractAmount("지원대상: 보험료 50만원 이하")).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("자격 명사가 없어도 「지원자격」의 「지원」만으로는 한도가 아니다 — 「지원자격: 월세 50만원 이하 임차인」은 빈 값(7차 지적 2 ② 단독 확인)", () => {
    expect(extractAmount("지원자격: 월세 50만원 이하 임차인")).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("「지원 최대 50만원」·「지원금 최대 12만원」의 「지원」은 그대로 한도 낱말이다 — 위 두 기존 시험(사회보험료·신규가입)이 그대로 초록이어야 한다(7차 지적 2 의 반례)", () => {
    expect(extractAmount("사회보험료 지원 최대 50만원").amountMaxWon).toBe(500_000);
    expect(extractAmount("신규가입 지원금 최대 12만원").amountMaxWon).toBe(120_000);
  });

  // ★2026-09-03 코덱스 적대 리뷰 지적 4 — 짧은 글 어디든(금액과 상관없는 자리라도) 이상·이하·미만·초과가
  //   하나 있으면 낱말 없는(BARE) 금액 훑기 자체를 통째로 껐다. 「업력 3년 이상」의 「이상」이 훨씬 뒤에
  //   있는 「5천만원」까지 못 찾게 막았다. 이제 후보 금액마다 앞뒤 창(지적 2·3 의 규칙)만으로 거른다.
  it("글 전체가 아니라 금액 후보 앞뒤 창만 본다 — 「업력 3년 이상 기업에 사업화 자금 5천만원 지원」에서 5천만원을 찾는다", () => {
    expect(extractAmount("업력 3년 이상 기업에 사업화 자금 5천만원 지원")).toEqual({
      amountText: "업력 3년 이상 기업에 사업화 자금 5천만원 지원",
      amountMaxWon: 50_000_000,
    });
  });
  it("「연매출 3억원 이하」 홀로는 여전히 빈 값 — 글 전체 훑기를 없애도 자격 판정 자체는 그대로다", () => {
    expect(extractAmount("연매출 3억원 이하")).toEqual({ amountText: "", amountMaxWon: null });
  });
});

describe("extractRate — 금리·이자 지원", () => {
  it("「연 N%」 최솟값을 rateMin 으로", () => {
    expect(extractRate("대출금리 연 1.5% 고정, 5년 상환")).toEqual({ rateText: "연 1.5%", rateMin: 1.5 });
    expect(extractRate("금리 연 3.97%~5.90%")).toEqual({ rateText: "연 3.97%~5.90%", rateMin: 3.97 });
  });
  it("★금리가 여러 개 나열되면(자금 종류별) rateMin 은 전체 중 최솟값, rateText 도 그 최솟값을 낳은 표현(G3③ — 2026-09-03 코덱스 지적, F2②의 「첫 표현 그대로」를 대체한다)", () => {
    expect(extractRate("운전자금 연 4.5%, 시설자금 연 2.0%")).toEqual({ rateText: "연 2.0%", rateMin: 2.0 });
  });
  it("이차보전(이자 지원)은 「이자 N%p 지원」으로 적고 rateMin 은 null(대출 금리가 아니다)", () => {
    expect(extractRate("대출이자 최대 2.5% 이차보전")).toEqual({ rateText: "이자 2.5%p 지원", rateMin: null });
  });
  it("보증료만 있으면 보증료 글자, rateMin null", () => {
    expect(extractRate("보증료 연 0.6%")).toEqual({ rateText: "보증료 연 0.6%", rateMin: null });
  });
  it("보증료와 대출금리가 함께 있으면 대출금리가 rateMin — extractAmount 는 퍼센트를 한도로 잡지 않는다", () => {
    const text = "보증료 연 0.6%, 대출금리 연 3.5% 이내";
    expect(extractRate(text)).toEqual({ rateText: "연 3.5%", rateMin: 3.5 });
    expect(extractAmount(text)).toEqual({ amountText: "", amountMaxWon: null });
  });
  it("없으면 빈 값", () => {
    expect(extractRate("참가 기업 모집")).toEqual({ rateText: "", rateMin: null });
  });
});

/**
 * ★5차 독립 화면 검사 지적 1(2026-09-04, screen-checker) — 「사업자당 지원한도 300억 원」의
 * 「사업자당」이 매치 시작점(「한도」)에서 8자(AMOUNT_CONTEXT_RADIUS) 밖이라 표지를 못 찾고
 * null 이 됐다. 「기업당」류 표지를 찾는 창만 16자로 넓힌다 — 총·규모 같은 「사업 전체 규모」
 * 판정 창(AMOUNT_CONTEXT_RADIUS=8, SCALE_WORD_RE)은 그대로 둔다(재설계 계약 G1 부록).
 */
describe("isPerCompanyLimit — 「기업당」류 표지를 찾는 창(2026-09-04, 5차 지적 1)", () => {
  it("「사업자당 지원한도 300억 원」— 표지가 8자 밖이라도 16자 창에서 찾아 한도를 그대로 살린다", () => {
    const r = extractAmount("사업자당 지원한도 300억 원");
    expect(r.amountMaxWon).toBe(30_000_000_000);
    expect(r.amountText).toContain("300억");
  });
  it("「총 대출한도 500억원」은 그대로 null — 앞 8자 규모 창(AMOUNT_CONTEXT_RADIUS)은 안 바뀐다", () => {
    expect(extractAmount("총 대출한도 500억원")).toEqual({ amountText: "", amountMaxWon: null });
  });

  /**
   * ★코덱스 11차 #8(2026-09-04) — 16자 창이 문장·절 경계를 넘어, 앞 금액에 붙은 표지(「사업자당」)를
   *  뒤 금액(「전체 한도 300억원」)의 표지로 읽었다. 창은 **마지막 구두점(; , . · / 줄바꿈) 뒤부터**
   *  만 본다 — 표지는 같은 절 안에 있을 때만 그 금액의 것이다.
   */
  it("표지 창은 마지막 구두점 뒤부터만 본다 — 「사업자당 5억; 전체 한도 300억원」은 5억(11차 #8)", () => {
    const r = extractAmount("사업자당 5억; 전체 한도 300억원");
    expect(r.amountMaxWon).toBe(500_000_000);
  });
  it("쉼표·가운뎃점·줄바꿈도 절을 끊는다 — 뒤 금액이 100억을 넘으면 표지 없이 버려진다(11차 #8)", () => {
    // 「전체」로 적은 이유: 「총」을 쓰면 앞 8자 규모 창(SCALE_WORD_RE)이 먼저 걸러 이 시험이
    // 구두점 자르기를 실제로 재지 못한다(고치기 전에도 통과해 버린다).
    for (const text of [
      "기업당 5억, 전체 한도 300억원",
      "기업당 5억 · 전체 한도 300억원",
      "기업당 5억\n전체 한도 300억원",
    ]) {
      expect(extractAmount(text).amountMaxWon, text).toBe(500_000_000);
    }
  });
  /**
   * ★코덱스 12차 #3(2026-09-04) — 경계 문자 목록에 콜론이 없어 「사업자당 한도 5억: 한도 300억원」
   *  처럼 표지가 콜론 앞에 있는 글은 16자 창이 절을 넘어 뒤 금액을 「기업당 한도」로 읽었다.
   *  보고서·표 서식은 「항목: 값」 꼴이 흔하다 — 콜론(반각·전각)도 절을 끊는다.
   */
  it("콜론도 절을 끊는다 — 「사업자당 한도 5억: 한도 300억원」은 5억(12차 #3)", () => {
    expect(extractAmount("사업자당 한도 5억: 한도 300억원").amountMaxWon).toBe(500_000_000);
    expect(extractAmount("사업자당 한도 5억： 한도 300억원").amountMaxWon, "전각 콜론").toBe(500_000_000);
  });
  /**
   * ★코덱스 13차 #3(2026-09-04) — 콜론을 **무조건** 절 경계로 삼으니 12차 #3 이 고친 것과 반대쪽이
   *  깨졌다. 「사업자당 지원한도: 300억원」은 콜론이 「항목: 값」의 이음표라 앞뒤가 같은 절인데,
   *  경계로 읽어 표지(「사업자당」)를 잘라 내고 300억을 버렸다(5차 지적 1 이 살린 값이 다시 죽음).
   *  콜론은 **앞에 금액 표현이 있을 때만** 절을 끊는다 — 앞이 금액이면 그 금액의 절이 이미 끝난
   *  것이고(「5억: 한도 300억원」), 앞이 낱말이면 아직 한 절이다(「지원한도: 300억원」).
   */
  it("콜론은 앞에 금액이 있을 때만 절을 끊는다 — 「사업자당 지원한도: 300억원」은 300억 유지(13차 #3)", () => {
    const r = extractAmount("사업자당 지원한도: 300억원");
    expect(r.amountMaxWon).toBe(30_000_000_000);
    expect(r.amountText, "표지가 글자에도 남는다").toContain("사업자당");
    // 전각 콜론도 같다
    expect(extractAmount("사업자당 지원한도： 300억원").amountMaxWon, "전각 콜론").toBe(30_000_000_000);
  });
  /**
   * ★코덱스 11차 #12(2026-09-04) — 표지를 창에서 찾아 한도를 살리면서도 글자에는 안 적어
   *  「한도 300억원」이 됐다(사업 전체 한도인지 한 곳당인지가 사라진다). 표지가 창 안에 있으면
   *  amountText 를 **표지 구절부터** 적는다.
   */
  it("표지가 창 안에 있으면 amountText 를 표지부터 적는다 — 「사업자당 지원한도 300억원」(11차 #12)", () => {
    const r = extractAmount("사업자당 지원한도 300억 원");
    expect(r.amountText).toBe("사업자당 지원한도 300억원");
    expect(r.amountMaxWon).toBe(30_000_000_000);
  });
  it("표지가 이미 낱말 자리에 잡힌 글은 예전 그대로 — 표지를 두 번 적지 않는다", () => {
    expect(extractAmount("기업당 최대 150억원").amountText).toBe("기업당 최대 150억원");
  });
});

/**
 * ★2026-09-05 브라우저 재검사 — 지도 타일 「가장 낮은 이자」가 「연 0%」로 떴다. 은행 상품이 하한
 *  미기재 자리에 0 을 저장한 것이 원인(「중고차할부」 rateText 「연 0.00%~17.90%」 rateMin 0).
 *  0 은 글이 무이자라고 말할 때만 뜻이 있고, 그 밖은 미상이다.
 */
describe("normalizeRateMin — 하한 미기재 0 을 미상으로", () => {
  it("무이자가 아닌 글의 0 은 미상(null) — 「연 0.00%~17.90%」", () => {
    expect(normalizeRateMin(0, "연 0.00%~17.90%")).toBeNull();
  });
  it("글이 무이자라고 말하면 0 은 그대로 0", () => {
    expect(normalizeRateMin(0, "무이자 대출")).toBe(0);
    expect(normalizeRateMin(0, "이자 없음")).toBe(0);
    expect(normalizeRateMin(0, "금리 0%")).toBe(0);
  });
  it("음수·NaN·없음은 전부 미상", () => {
    expect(normalizeRateMin(-1, "")).toBeNull();
    expect(normalizeRateMin(Number.NaN, "")).toBeNull();
    expect(normalizeRateMin(undefined, "")).toBeNull();
    expect(normalizeRateMin(null, "")).toBeNull();
  });
  it("양수는 글과 상관없이 그대로", () => {
    expect(normalizeRateMin(2.5, "")).toBe(2.5);
  });
  /** 「이자 낮은 순」 1등이 「청년전용 보증부월세 대출」(rateText 「(보증금)연1.3%」·rateMin 0)이던 뿌리. */
  it("글자에서 다시 뽑으면 진짜 이자가 나온다 — 「(보증금)연1.3%」", () => {
    expect(extractRate("(보증금)연1.3%").rateMin).toBe(1.3);
    expect(normalizeRateMin(extractRate("(보증금)연1.3%").rateMin, "(보증금)연1.3%")).toBe(1.3);
  });
});
