import { describe, expect, it } from "vitest";
import { formatCount, manwonToKorean, maskBizno } from "./profile-field-format";

describe("maskBizno — 숫자만 받아 000-00-00000 으로, 최대 10자리", () => {
  it("자리가 차오르는 대로 하이픈을 넣는다", () => {
    expect(maskBizno("")).toBe("");
    expect(maskBizno("12")).toBe("12");
    expect(maskBizno("123")).toBe("123");
    expect(maskBizno("1234")).toBe("123-4");
    expect(maskBizno("12345")).toBe("123-45");
    expect(maskBizno("123456")).toBe("123-45-6");
    expect(maskBizno("1234567890")).toBe("123-45-67890");
  });

  it("숫자가 아닌 글자는 버리고 10자리를 넘으면 자른다", () => {
    expect(maskBizno("123-81-45678")).toBe("123-81-45678");
    expect(maskBizno("abc 123 81 45678")).toBe("123-81-45678");
    expect(maskBizno("12345678901234")).toBe("123-45-67890");
  });
});

describe("formatCount — 숫자만 받아 쉼표를 넣는다", () => {
  it("세 자리마다 쉼표, 숫자가 아닌 글자는 버린다", () => {
    expect(formatCount("")).toBe("");
    expect(formatCount("abc")).toBe("");
    expect(formatCount("0")).toBe("0");
    expect(formatCount("999")).toBe("999");
    expect(formatCount("1000")).toBe("1,000");
    expect(formatCount("124500")).toBe("124,500");
    expect(formatCount("1,245,00a")).toBe("124,500");
  });

  it("앞의 0은 떼되, 0 하나는 남긴다", () => {
    expect(formatCount("007")).toBe("7");
    expect(formatCount("000")).toBe("0");
  });
});

describe("manwonToKorean — 만원 단위 숫자를 「N억 M만원」으로 읽는다", () => {
  it("억이 있으면 억 뒤에 남는 만원을 붙인다", () => {
    expect(manwonToKorean(124500)).toBe("12억 4,500만원");
    expect(manwonToKorean(10000)).toBe("1억원");
    expect(manwonToKorean(50000)).toBe("5억원");
    expect(manwonToKorean(10001)).toBe("1억 1만원");
  });

  it("1억이 안 되면 만원만 쓴다", () => {
    expect(manwonToKorean(3000)).toBe("3,000만원");
    expect(manwonToKorean(0)).toBe("0만원");
  });
});
