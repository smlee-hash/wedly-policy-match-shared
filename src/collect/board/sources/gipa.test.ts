import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGipaList, gipaConfig } from "./gipa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-05 실측 `/apply/01.php?cate=1&page=1|2`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gipa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gipa-list-p2.html"), "utf-8");
const rows = parseGipaList(listHtml);
const p2 = parseGipaList(listP2Html);
const combined = [...rows, ...p2];

describe("고양산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 10건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "2026년 3차 신규 입주기업 모집",
      detailUrl:
        "https://www.gipa.or.kr/apply/01_view.php?no=914&cate=1&sort=reg&term=all&make=&search=",
      // 접수일정은 td:nth-child(3) 을 직접 집는다. 원문 2026-08-20<br>2026-09-15.
      dateText: "2026-08-20 ~ 2026-09-15",
      agency: "고양산업진흥원",
    });
  });

  it("제목에서 디데이 배지(D-10)를 떼고 사업명만 남긴다", () => {
    expect(rows[0].title).not.toMatch(/D-\d+/i);
    expect(rows[0].title).not.toContain("D-day");
    expect(rows.some((r) => /^D-/i.test(r.title))).toBe(false);
  });

  it("배지가 별도 span(완료·D-n)이면 그 span 을 빼고 텍스트만 쓴다", () => {
    const r = rows.find((x) => x.title.includes("메이커 스페이스"));
    expect(r?.title).toBe("2026년 28청춘창업소 메이커 스페이스 교육 프로그램 참여자 모집");
    expect(r?.title).not.toContain("완료");
  });

  it("제목에 담당부서·전화번호가 안 섞인다 — strong.txt_t 만 집는다", () => {
    expect(rows.every((r) => !r.title.includes("담당부서"))).toBe(true);
    expect(rows.every((r) => !/031-\d{3,4}-\d{4}/.test(r.title))).toBe(true);
  });

  it("접수일정은 행 안 td:nth-child(3) 에서만 집는다 — 시작~마감 두 날짜", () => {
    expect(rows[0].dateText).toBe("2026-08-20 ~ 2026-09-15");
    expect(gipaConfig.list.fields.date.selector).toBe("td:nth-child(3)");
    expect(gipaConfig.list.fields.date.selector).not.toContain("tr >");
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText))).toBe(
      true,
    );
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(p2).toHaveLength(10);
    expect(combined).toHaveLength(20);
  });

  it("같은 쪽 안에서도 상세 열쇠 중복이 없다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("신청·관심 버튼(href=# / javascript:void(0))을 공고 주소로 쓰지 않는다", () => {
    expect(combined.every((r) => r.detailUrl.includes("01_view.php"))).toBe(true);
    expect(combined.every((r) => !/javascript:|#/.test(r.detailUrl))).toBe(true);
  });
});

describe("고양산업진흥원 설정", () => {
  it("쪽넘김은 GET page — url(2) 에 page=2 가 있다", () => {
    expect(gipaConfig.list.url(1)).toBe("https://www.gipa.or.kr/apply/01.php?cate=1&page=1");
    expect(gipaConfig.list.url(2)).toBe("https://www.gipa.or.kr/apply/01.php?cate=1&page=2");
    expect(gipaConfig.list.url(2)).toContain("page=2");
    expect(gipaConfig.list.maxPages).toBe(3);
  });

  it("id·기관·지역·baseUrl 이 실측과 같다", () => {
    expect(gipaConfig.id).toBe("gipa");
    expect(gipaConfig.label).toBe("고양산업진흥원");
    expect(gipaConfig.agency).toBe("고양산업진흥원");
    expect(gipaConfig.region).toBe("경기");
    expect(gipaConfig.baseUrl).toBe("https://www.gipa.or.kr/apply/");
    expect(gipaConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gipaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("추측 단계를 끈다 — 4번째 칸 신청 버튼을 공고로 저장하지 않도록", () => {
    expect(gipaConfig.skipHeuristic).toBe(true);
  });
});
