import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hsbizConfig, parseHsbizList } from "./hsbiz";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 앞서 손으로 쓴 고정본으로 시험했더니 실제 마크업과 어긋난 선택자가 그대로 통과했다 —
 * 이 저장소의 다른 출처 19곳은 전부 실사이트 HTML 을 저장해 쓴다. 같은 방식으로 맞춘다.
 * 고정본: 2026-09-01 배포본 1쪽(`/bbs/BBSMSTR_000000000040/list.do`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/hsbiz-list.html"), "utf-8");
const rows = parseHsbizList(listHtml);

describe("화성산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("행을 읽어 낸다", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("지원사업을 담는다 — 「~ 안내」로 끝나도 버리지 않는다", () => {
    expect(rows.some((r) => r.title.includes("중소기업 지원사업 안내"))).toBe(true);
  });

  it("★인력·용역 공고는 뺀다 — 기업이 신청할 지원사업이 아니다", () => {
    const staff = rows.filter((r) => /평가위원|외부전문가|전문가\s*풀|우선협상대상자/.test(r.title));
    expect(staff.map((r) => r.title)).toEqual([]);
  });

  it("시청·시민 대상 글은 뺀다", () => {
    const civic = rows.filter((r) => /페스타|탐사대|재능기부|대학원|신입생/.test(r.title));
    expect(civic.map((r) => r.title)).toEqual([]);
  });

  it("★등록일을 그 칸에서 집는다 — 「날짜가 든 첫 칸」이면 제목 속 날짜에 걸린다", () => {
    // 칸 순서가 번호|제목|작성자|조회수|등록일|첨부라 제목이 등록일보다 앞이다.
    const dated = rows.filter((r) => r.dateText !== "");
    expect(dated.length).toBeGreaterThan(0);
    for (const r of dated) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~$/);
  });

  it("상세 주소를 nttId 로 조립한다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.hsbiz\.or\.kr\/bbs\/BBSMSTR_000000000040\/view\.do\?nttId=[A-Za-z0-9]+$/,
      );
    }
  });

  it("제목에 「새글」 딱지가 남지 않는다", () => {
    for (const r of rows) expect(r.title).not.toMatch(/새글$/);
  });

  it("★기관을 「화성산업진흥원」으로 못 박지 않는다 — 남의 기관 공고를 그대로 옮겨 싣는 게시판이다", () => {
    // 못 박으면 중복 판정 열쇠(제목+기관)가 달라져 기업마당의 같은 공고와 안 묶인다.
    expect(new Set(rows.map((r) => r.agency)).size).toBeGreaterThan(1);
  });

  it("같은 글번호는 한 번만 담는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("글번호가 없는 행(머리글 등)은 건너뛴다", () => {
    expect(parseHsbizList("<table><tbody><tr><th>제목</th></tr></tbody></table>")).toEqual([]);
  });
});

describe("화성산업진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(hsbizConfig.list.url(1)).toContain("pageIndex=1");
    expect(hsbizConfig.list.url(1)).not.toBe(hsbizConfig.list.url(2));
  });

  it("지역은 경기 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(hsbizConfig.region).toBe("경기");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(hsbizConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});
