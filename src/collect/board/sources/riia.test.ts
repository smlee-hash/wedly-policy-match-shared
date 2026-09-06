import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractBySelector } from "../layers/selector";
import { riiaGnConfig, riiaJnConfig } from "./riia";

const gnList = readFileSync(join(__dirname, "../__fixtures__/w3-gnriia-list.html"), "utf-8");
const jnList = readFileSync(join(__dirname, "../__fixtures__/w3-jnriia-list.html"), "utf-8");

describe("riia-gn 경남지역산업진흥원 — 목록 파싱", () => {
  it("selector 형으로 행을 뽑고 접수기간을 그대로 둔다", () => {
    expect(riiaGnConfig.customParse).toBeUndefined();
    const rows = extractBySelector(gnList, riiaGnConfig);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const cluster = rows.find((r) => r.title.includes("동남권 지역혁신클러스터육성사업"));
    expect(cluster).toBeTruthy();
    expect(cluster!.title).toContain("통합공고");
    expect(cluster!.dateText).toBe("2026-05-04 ~ 2026-05-15");
    expect(cluster!.detailUrl).toBe(
      "https://gn.riia.or.kr/board/businessAnnouncement/view/873eed4d-4908-11f1-ad2e-772a0a3197fc",
    );
  });

  it("제목은 첫 span 만 써서 첨부 아이콘 글자가 안 섞인다", () => {
    const rows = extractBySelector(gnList, riiaGnConfig);
    const first = rows[0];
    expect(first.title).toBe(
      "제2026-007호 메가시티협력 첨단산업 육성지원R&D 사업 관련 용역 제안서 평가위원(후보자) 공개모집 공고",
    );
  });
});

describe("riia-jn 전남지역산업진흥원 — 목록 파싱", () => {
  it("같은 구조로 전남 호스트 상세 URL 을 만든다", () => {
    expect(riiaJnConfig.customParse).toBeUndefined();
    const rows = extractBySelector(jnList, riiaJnConfig);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const first = rows[0];
    expect(first.title).toBe(
      "K-Grid 인재창업밸리조성사업 국제 공동연구 사전기획 지원 모집 공고문",
    );
    expect(first.title).not.toMatch(/new/i);
    expect(first.detailUrl).toContain("https://jn.riia.or.kr/board/businessAnnouncement/view/");
    expect(first.dateText).toBe("2026-08-27 ~ 2026-09-11");
  });
});

describe("riia — config", () => {
  it("목록 URL 은 page 매개변수로 쪽을 넘긴다", () => {
    expect(riiaGnConfig.list.url(2)).toBe(
      "https://gn.riia.or.kr/board/businessAnnouncement?page=2",
    );
    expect(riiaJnConfig.list.url(2)).toBe(
      "https://jn.riia.or.kr/board/businessAnnouncement?page=2",
    );
  });
  it("상세 본문 선택자는 .ck-content", () => {
    expect(riiaGnConfig.detailContentSelector).toBe(".ck-content");
    expect(riiaJnConfig.detailContentSelector).toBe(".ck-content");
  });
});
