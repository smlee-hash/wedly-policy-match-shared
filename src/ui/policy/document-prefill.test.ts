import { describe, expect, it } from "vitest";
import {
  applyDocumentFields,
  checkUploadSelection,
  choiceOptionLabel,
  fileKindOf,
  fileStatusText,
  formFieldOf,
} from "./document-prefill";
import type { BusinessProfile } from "../../engine/match-engine";
import type { DocumentFileResult, DocumentFieldKey, DocumentPrefillResult } from "../../documents/types";

/**
 * 서류 읽은 결과를 화면 칸에 합치는 순수 함수 — 저장·통신 없이 값만 잰다.
 * 규칙: 빈 칸은 채운다 · 손으로 고친 칸은 덮지 않고 고르게 한다 · 서류끼리 다른 칸은 그대로 알린다 · 기존 값은 안 지운다.
 */

function 결과(partial: Partial<DocumentPrefillResult>): DocumentPrefillResult {
  return { fields: {}, sources: {}, conflicts: [], files: [], ...partial };
}

const 없음 = new Set<DocumentFieldKey>();

describe("applyDocumentFields — 빈 칸 채움", () => {
  it("비어 있던 칸은 서류 값으로 채우고, 채운 칸과 출처를 돌려준다", () => {
    const r = applyDocumentFields(
      { companyName: "가상테크" },
      결과({
        fields: { employeeCount: 8, industry: "전자부품 제조업" },
        sources: {
          employeeCount: { files: ["기업상태표.xlsx"], docTypes: ["company-status"] },
          industry: { files: ["사업자등록증.pdf"], docTypes: ["biz-registration"] },
        },
      }),
      없음,
    );
    expect(r.next).toMatchObject({ companyName: "가상테크", employeeCount: 8, industry: "전자부품 제조업" });
    expect(r.filled.sort()).toEqual(["employeeCount", "industry"]);
    expect(r.origins.employeeCount).toEqual(["company-status"]);
    expect(r.origins.industry).toEqual(["biz-registration"]);
    expect(r.choices).toEqual([]);
  });

  it("입력 객체는 바꾸지 않는다", () => {
    const current: BusinessProfile = { certTypes: ["벤처"] };
    const r = applyDocumentFields(current, 결과({ fields: { employeeCount: 3 } }), 없음);
    expect(current).toEqual({ certTypes: ["벤처"] });
    expect(r.next).not.toBe(current);
    expect(r.next.certTypes).not.toBe(current.certTypes);
  });

  it("값 0 도 채운 것으로 본다(없음과 모름은 다르다)", () => {
    const r = applyDocumentFields({}, 결과({ fields: { patentCount: 0, taxDelinquent: false } }), 없음);
    expect(r.next).toMatchObject({ patentCount: 0, taxDelinquent: false });
    expect(r.filled.sort()).toEqual(["patentCount", "taxDelinquent"]);
  });
});

describe("applyDocumentFields — 기존 값 안 지움", () => {
  it("서류에 없는 칸은 그대로 두고, 서류 값이 비어 있어도 칸을 비우지 않는다", () => {
    const current: BusinessProfile = { employeeCount: 5, industry: "제조업", foundedDate: "2019-03-20" };
    const r = applyDocumentFields(current, 결과({ fields: { industry: undefined, regionSigungu: "화성시" } }), 없음);
    expect(r.next).toMatchObject({ employeeCount: 5, industry: "제조업", foundedDate: "2019-03-20" });
    expect(r.filled).toEqual(["regionSigungu"]);
  });

  it("서류가 아무것도 못 읽었으면 아무 칸도 안 바뀐다", () => {
    const current: BusinessProfile = { employeeCount: 5 };
    const r = applyDocumentFields(current, 결과({}), 없음);
    expect(r.next).toEqual(current);
    expect(r.filled).toEqual([]);
    expect(r.choices).toEqual([]);
  });

  it("손으로 고치지 않은 값이 이미 있어도 서류 값과 같으면 그대로 두고 채운 칸으로 세지 않는다", () => {
    const r = applyDocumentFields({ employeeCount: 8 }, 결과({ fields: { employeeCount: 8 } }), 없음);
    expect(r.next.employeeCount).toBe(8);
    expect(r.filled).toEqual([]);
  });
});

describe("applyDocumentFields — 손으로 고친 칸(touched)은 덮지 않고 충돌로 보여 준다", () => {
  it("손으로 고친 값과 서류 값이 다르면 손 값을 지키고 고르는 상자를 돌려준다", () => {
    const r = applyDocumentFields(
      { employeeCount: 12 },
      결과({
        fields: { employeeCount: 8 },
        sources: { employeeCount: { files: ["기업상태표.xlsx"], docTypes: ["company-status"] } },
      }),
      new Set<DocumentFieldKey>(["employeeCount"]),
    );
    expect(r.next.employeeCount).toBe(12);
    expect(r.filled).toEqual([]);
    expect(r.choices).toHaveLength(1);
    expect(r.choices[0]).toMatchObject({ field: "employeeCount", hand: 12, recommended: -1 });
    expect(r.choices[0].options).toEqual([
      { value: 8, files: ["기업상태표.xlsx"], docTypes: ["company-status"] },
    ]);
  });

  it("손으로 고친 값과 서류 값이 같으면 충돌이 아니다", () => {
    const r = applyDocumentFields({ employeeCount: 8 }, 결과({ fields: { employeeCount: 8 } }), new Set<DocumentFieldKey>(["employeeCount"]));
    expect(r.choices).toEqual([]);
  });

  it("손으로 고쳤다가 다시 비운 칸은 비어 있는 칸이라 채운다", () => {
    const r = applyDocumentFields({}, 결과({ fields: { employeeCount: 8 } }), new Set<DocumentFieldKey>(["employeeCount"]));
    expect(r.next.employeeCount).toBe(8);
    expect(r.choices).toEqual([]);
  });

  it("손으로 고치지 않은 칸은 새 서류 값으로 바뀐다(손 값만 지킨다)", () => {
    const r = applyDocumentFields({ employeeCount: 5, industry: "손으로" }, 결과({ fields: { employeeCount: 8, industry: "서류" } }), new Set<DocumentFieldKey>(["industry"]));
    expect(r.next).toMatchObject({ employeeCount: 8, industry: "손으로" });
    expect(r.filled).toEqual(["employeeCount"]);
  });
});

describe("applyDocumentFields — 쓰던 글자가 덜 찬 칸은 빈 칸으로 보지 않는다(BF2 ③)", () => {
  const 번호서류 = () =>
    결과({
      fields: { bizno: "987-81-12345" },
      sources: { bizno: { files: ["등록증.pdf"], docTypes: ["biz-registration"] } },
    });

  it("10자리를 못 채운 사업자번호 원문(123)이 담겨 오면 서류 번호로 덮지 않고 고르는 상자로 돌려준다", () => {
    const r = applyDocumentFields({ bizno: "123" }, 번호서류(), new Set<DocumentFieldKey>(["bizno"]));
    expect(r.next.bizno).toBe("123");
    expect(r.filled).toEqual([]);
    expect(r.choices).toHaveLength(1);
    expect(r.choices[0]).toMatchObject({ field: "bizno", hand: "123", recommended: -1 });
    expect(r.choices[0].options.map((o) => o.value)).toEqual(["987-81-12345"]);
  });

  it("손으로 만진 있다·없다 한 줄(hasCert·시도·시군구)은 서류가 채우지도 충돌로 보이지도 않는다", () => {
    const r = applyDocumentFields(
      {},
      결과({ fields: { hasCert: false, region: "경기", regionSigungu: "화성시" } }),
      new Set<DocumentFieldKey>(["hasCert", "region", "regionSigungu"]),
    );
    expect(r.next).toEqual({});
    expect(r.filled).toEqual([]);
    expect(r.choices).toEqual([]);
  });

  it("담긴 값이 없는(다시 비운) 칸은 손으로 만졌어도 빈 칸이라 채운다", () => {
    const r = applyDocumentFields({}, 번호서류(), new Set<DocumentFieldKey>(["bizno"]));
    expect(r.next.bizno).toBe("987-81-12345");
    expect(r.choices).toEqual([]);
  });
});

describe("applyDocumentFields — 서류끼리 다른 칸(추천 값이 처음 골라짐)", () => {
  const 충돌서류 = (): DocumentPrefillResult =>
    결과({
      fields: { employeeCount: 8 },
      conflicts: [
        {
          field: "employeeCount",
          options: [
            { value: 8, files: ["기업상태표.xlsx"], docTypes: ["company-status"], year: 2026 },
            { value: 6, files: ["재무제표.pdf"], docTypes: ["financial-statement"], year: 2025 },
          ],
          recommended: 0,
        },
      ],
    });

  it("추천 값을 칸에 채우고, 서류 충돌은 서버 conflicts 그대로 고르는 상자로 돌려준다", () => {
    const r = applyDocumentFields({}, 충돌서류(), 없음);
    expect(r.next.employeeCount).toBe(8);
    expect(r.choices).toHaveLength(1);
    expect(r.choices[0]).toMatchObject({ field: "employeeCount", recommended: 0 });
    expect(r.choices[0].hand).toBeUndefined();
    expect(r.choices[0].options.map((o) => o.value)).toEqual([8, 6]);
    expect(r.origins.employeeCount).toEqual(["company-status"]); // 추천 값을 준 서류가 출처
  });

  it("손으로 고친 칸이 서류끼리도 다르면 손 값을 지키고 아무 값도 골라 두지 않는다", () => {
    const r = applyDocumentFields({ employeeCount: 12 }, 충돌서류(), new Set<DocumentFieldKey>(["employeeCount"]));
    expect(r.next.employeeCount).toBe(12);
    expect(r.choices[0]).toMatchObject({ hand: 12, recommended: -1 });
    expect(r.choices[0].options).toHaveLength(2);
  });
});

describe("applyDocumentFields — 보유 인증·특허의 「없음」", () => {
  it("서류가 hasCert=false 만 말하면 인증·특허 칸이 모두 비어 있을 때만 채운다", () => {
    const r = applyDocumentFields({}, 결과({ fields: { hasCert: false, hasPatent: false } }), 없음);
    expect(r.next).toMatchObject({ hasCert: false, hasPatent: false });
    const r2 = applyDocumentFields({ certTypes: ["벤처"], patentCount: 2 }, 결과({ fields: { hasCert: false, hasPatent: false } }), 없음);
    expect(r2.next).toMatchObject({ certTypes: ["벤처"], patentCount: 2 });
    expect(r2.filled).toEqual([]);
    expect(r2.choices).toEqual([]);
  });
});

describe("applyDocumentFields — 주소 칸", () => {
  it("주소가 이미 있으면 시도·시군구 칸도 채워진 것으로 본다", () => {
    const r = applyDocumentFields({ businessAddress: "경기 화성시" }, 결과({ fields: { region: "경기", regionSigungu: "화성시" } }), 없음);
    expect(r.filled).toEqual([]);
  });

  it("formFieldOf — 서류 칸 이름은 화면 칸 열쇠로 모인다", () => {
    expect(formFieldOf("businessAddress")).toBe("address");
    expect(formFieldOf("region")).toBe("address");
    expect(formFieldOf("regionSigungu")).toBe("address");
    expect(formFieldOf("certTypes")).toBe("cert");
    expect(formFieldOf("hasCert")).toBe("cert");
    expect(formFieldOf("lastYearRevenueKrw")).toBe("revenue");
  });
});

describe("choiceOptionLabel — 「8명 · 기업상태표(2026)」 꼴", () => {
  it("값 · 서류 이름(연도)", () => {
    expect(choiceOptionLabel("employeeCount", { value: 8, files: [], docTypes: ["company-status"], year: 2026 })).toBe("8명 · 기업상태표(2026)");
    expect(choiceOptionLabel("employeeCount", { value: 6, files: [], docTypes: ["financial-statement"] })).toBe("6명 · 재무제표");
  });

  it("매출은 「12억 4,500만원」, 법인 여부·체납은 말로 푼다", () => {
    expect(choiceOptionLabel("lastYearRevenueKrw", { value: 1_245_000_000, files: [], docTypes: ["financial-statement"] })).toBe("12억 4,500만원 · 재무제표");
    expect(choiceOptionLabel("isCorporation", { value: true, files: [], docTypes: ["biz-registration"] })).toBe("법인 · 사업자등록증");
    expect(choiceOptionLabel("taxDelinquent", { value: false, files: [], docTypes: ["company-status"] })).toBe("없음 · 기업상태표");
  });

  it("같은 값을 준 서류가 여럿이면 이름을 모두 보인다", () => {
    expect(choiceOptionLabel("employeeCount", { value: 8, files: [], docTypes: ["company-status", "employment-insurance"] })).toBe("8명 · 기업상태표, 고용보험 신고서");
  });
});

describe("checkUploadSelection — 고르기 전에 개수·크기를 먼저 막는다", () => {
  const f = (name: string, size: number) => ({ name, size });

  it("제한 안이면 안내가 없다", () => {
    expect(checkUploadSelection([f("a.pdf", 1000), f("b.xlsx", 2000)])).toBeNull();
  });

  it("골라 둔 것이 없으면 아무 일도 안 한다(안내 없음)", () => {
    expect(checkUploadSelection([])).toBeNull();
  });

  it("10개를 넘으면 쉬운 말로 알린다", () => {
    const 열한개 = Array.from({ length: 11 }, (_, i) => f(`${i}.pdf`, 10));
    const msg = checkUploadSelection(열한개);
    expect(msg).toContain("한 번에 10개까지");
    expect(msg).toContain("11개");
  });

  it("파일 하나가 20MB 를 넘으면 그 파일 이름과 함께 알린다", () => {
    const msg = checkUploadSelection([f("작은.pdf", 10), f("큰파일.pdf", 21 * 1024 * 1024)]);
    expect(msg).toContain("큰파일.pdf");
    expect(msg).toContain("20MB");
    expect(msg).not.toContain("작은.pdf");
  });

  it("합이 50MB 를 넘으면 합계 제한으로 알린다", () => {
    const 열아홉 = 19 * 1024 * 1024;
    const msg = checkUploadSelection([f("a.pdf", 열아홉), f("b.pdf", 열아홉), f("c.pdf", 열아홉)]);
    expect(msg).toContain("합쳐서 50MB");
  });
});

describe("fileKindOf·fileStatusText — 올린 파일 목록 한 줄", () => {
  it("확장자로 형식 표식을 가른다", () => {
    expect(fileKindOf("기업상태표.xlsx")).toBe("XLS");
    expect(fileKindOf("재무제표.PDF")).toBe("PDF");
    expect(fileKindOf("신고서.hwpx")).toBe("HWP");
    expect(fileKindOf("옛문서.hwp")).toBe("HWP");
    expect(fileKindOf("계약서.docx")).toBe("DOC");
    expect(fileKindOf("등록증.jpg")).toBe("IMG");
    expect(fileKindOf("이상한파일")).toBe("FILE");
  });

  const 파일 = (p: Partial<DocumentFileResult>): DocumentFileResult => ({
    name: "a.pdf", docType: "unknown", status: "no-fields", fields: [], ...p,
  });

  it("읽었으면 「N칸 채움」", () => {
    expect(fileStatusText(파일({ status: "read", docType: "company-status", fields: ["employeeCount", "industry", "bizno"] }))).toBe("3칸 채움");
    expect(fileStatusText(파일({ status: "read-by-ai", docType: "biz-registration", fields: ["bizno"] }))).toBe("1칸 채움");
  });

  it("서버가 안내 문구를 주면 그대로 보이고, 없으면 쉬운 기본 문구", () => {
    expect(fileStatusText(파일({ status: "unsupported", message: "옛 한글(.hwp)은 PDF로 저장해 올려 주세요" }))).toBe("옛 한글(.hwp)은 PDF로 저장해 올려 주세요");
    expect(fileStatusText(파일({ status: "needs-text-pdf" }))).toContain("사진");
    expect(fileStatusText(파일({ status: "no-fields", docType: "unknown" }))).toBe("모르는 서류");
    expect(fileStatusText(파일({ status: "failed" }))).toContain("읽지 못");
    expect(fileStatusText(파일({ status: "too-large" }))).toContain("20MB");
  });
});
