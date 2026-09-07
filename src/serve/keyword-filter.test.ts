import { describe, expect, it } from "vitest";
import { meaningfulKeywords, minKeywordScore } from "./keyword-filter";

const STOPWORDS = [
  "이상",
  "이하",
  "미만",
  "초과",
  "기업",
  "지원",
  "사업",
  "대상",
  "경우",
  "관련",
  "확인",
  "이내",
  "있음",
  "없음",
  "해당",
  "필요",
  "가능",
  "신청",
  "조건",
] as const;

describe("meaningfulKeywords", () => {
  it("한국어 흔한 토막 불용어를 빼고 숫자+단위는 살린다", () => {
    expect(meaningfulKeywords([...STOPWORDS, "고용보험", "5인", "10억", "3년"])).toEqual([
      "고용보험",
      "5인",
      "10억",
      "3년",
    ]);
    expect(meaningfulKeywords(["  이상  ", " 5인 ", "기업"])).toEqual(["5인"]);
    expect(meaningfulKeywords(["이상", "기업", "지원", "  "])).toEqual([]);
  });
});

describe("minKeywordScore", () => {
  it("남은 키워드가 2개 이상이면 2, 1개뿐이면 1", () => {
    expect(minKeywordScore(["고용보험"])).toBe(1);
    expect(minKeywordScore(["고용보험", "5인"])).toBe(2);
    expect(minKeywordScore(["고용보험", "5인", "피보험자"])).toBe(2);
  });
});
