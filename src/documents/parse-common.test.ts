import { describe, expect, it } from "vitest";
import { addressFields, normalizeDate, parseKrwAmount } from "./parse-common";

describe("parseKrwAmount — 금액 표기를 원 단위로", () => {
  it.each([
    ["120,000,000", 120_000_000],
    ["120,000,000원", 120_000_000],
    ["12000만원", 120_000_000],
    ["12,000만 원", 120_000_000],
    ["3,500만원", 35_000_000],
    ["1억", 100_000_000],
    ["1억 2천", 120_000_000], // 억 뒤의 천은 천만(줄임말)
    ["1억 2천만원", 120_000_000],
    ["1억 5천만원", 150_000_000],
    ["3억 5000만", 350_000_000],
    ["1.5억", 150_000_000],
    ["5천만원", 50_000_000],
    ["2천5백만원", 25_000_000],
    ["약 8억", 800_000_000],
    ["850,000원", 850_000],
    ["5천원", 5_000],
    ["0", 0],
    ["0원", 0],
  ])("%s → %d", (text, expected) => {
    expect(parseKrwAmount(text)).toBe(expected);
  });

  it.each([
    ["12000"], // 단위 없는 작은 숫자는 원인지 만원인지 모른다
    ["5천"], // 억·만·원이 없는 천은 모른다
    ["삼천만원"],
    ["억"],
    ["만원"],
    [""],
    ["미정"],
    ["$1000"],
    ["1억 2억"],
  ])("%j → 모름(null)", (text) => {
    expect(parseKrwAmount(text)).toBeNull();
  });
});

describe("normalizeDate", () => {
  it.each([
    ["2018-03-12", "2018-03-12"],
    ["2018.3.12", "2018-03-12"],
    ["2018년 3월 12일", "2018-03-12"],
    ["2018 년 03 월 12 일", "2018-03-12"],
    ["2018/03/12", "2018-03-12"],
    ["20180312", "2018-03-12"],
    ["2018-03-12T00:00:00", "2018-03-12"],
    ["41456", "2013-07-01"], // 엑셀 날짜 번호
  ])("%s → %s", (text, expected) => {
    expect(normalizeDate(text)).toBe(expected);
  });

  it.each([["2018-13-45"], ["2018-02-30"], ["1800-01-01"], ["어제"], [""], ["899"]])("%j → null", (text) => {
    expect(normalizeDate(text)).toBeNull();
  });
});

describe("addressFields — 시도·시군구까지만 남긴다", () => {
  it("도로명·번지·건물명은 결과에 없다", () => {
    const out = addressFields("경기도 화성시 동탄대로 123, 가상빌딩 5층");
    expect(out).toEqual({ region: "경기", regionSigungu: "화성시", businessAddress: "경기 화성시" });
    expect(JSON.stringify(out)).not.toMatch(/동탄대로|123|가상빌딩/);
  });

  it("읽을 수 없으면 빈 결과", () => {
    expect(addressFields("주소 미상")).toEqual({});
  });
});
