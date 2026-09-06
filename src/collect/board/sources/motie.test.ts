import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractBySelector } from "../layers/selector";
import { isMotieDropTitle, motieConfig, parseMotieList } from "./motie";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다(창원 사고).
 * 고정본: 2026-09-03 실측 `www.motir.go.kr/kor/article/ATCL2826a2625` 1·2쪽(각 10줄).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/motie-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/motie-list-p2.html"), "utf-8");
const rows = parseMotieList(listHtml);
const rowsP2 = parseMotieList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("산업통상부 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 DROP 1건을 뺀 9건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "2026년도 AX실증밸리조성(R&D) 사업 신규지원 대상과제 공고",
      detailUrl: "https://www.motir.go.kr/kor/article/ATCL2826a2625/71295/view",
      dateText: "2026-08-31 ~",
      category: "인공지능기계로봇과",
    });
  });

  it("제목의 HTML 기호가 풀려 있다 — `R&amp;D` 가 그대로 저장되면 중복 열쇠가 갈린다", () => {
    expect(rows[0].title).not.toContain("&amp;");
    const rl = combined.find((r) => r.detailUrl.endsWith("/71238/view"));
    expect(rl?.title).toBe(
      "중견기업 금융지원 프로그램(Rising Leaders 300) ''''26년 하반기(8회차) 선정 공고",
    );
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.motir\.go\.kr\/kor\/article\/ATCL2826a2625\/\d+\/view$/,
      );
      expect(r.detailUrl).not.toMatch(/pageIndex/);
    }
  });

  it("목록은 등록일만 준다 — 전 행을 개시형(`YYYY-MM-DD ~`)으로 넘긴다", () => {
    expect(combined.length).toBeGreaterThan(0);
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(17);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pageIndex 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(8);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년도 한-독(2+2) 국제공동기술개발사업 공고",
      detailUrl: "https://www.motir.go.kr/kor/article/ATCL2826a2625/71266/view",
      dateText: "2026-08-11 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((t) => t.title);
    expect(titles.some((t) => t.includes("민간자격 등록폐지"))).toBe(false);
    expect(titles.some((t) => t.includes("유공자"))).toBe(false);
    expect(isMotieDropTitle("2026년 민간자격 등록폐지 공고-3차")).toBe(true);
    expect(isMotieDropTitle("2026 산업단지 발전유공자 모집공고")).toBe(true);
    expect(isMotieDropTitle("2026년 기술사업화 유공자 포상 신청 연장공고")).toBe(true);
    expect(isMotieDropTitle("2026년도 녹색인증 유공자포상 신청공고")).toBe(true);
    expect(isMotieDropTitle("한미 전략적 투자 프로젝트 외부 자문사 풀(Pool) 추가 모집 공고")).toBe(true);
    expect(isMotieDropTitle("산업통상부 사무관·주무관(8급 이하) 전입 희망자 공개모집 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isMotieDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isMotieDropTitle("신규직원 채용 공고")).toBe(true);
  });

  it("실측 지원사업은 한 건도 안 버린다", () => {
    for (const t of [
      "2026년 뿌리산업 특화단지 지원사업 추가 공고",
      "2026년도 독일 등 유럽 진출 희망 중견기업 지원사업 선정 공고",
      "2026년 수출지원기반활용사업(긴급지원바우처 4차) 참여기업 모집공고",
      "2026년도 「관세피해업종 이차보전지원」 사업 2차 공고",
    ]) {
      expect(isMotieDropTitle(t)).toBe(false);
    }
  });

  it("날짜는 등록일 칸에서만 집는다 — 행 전체 글자면 공고번호·조회수와 붙는다", () => {
    const r = combined.find((x) => x.detailUrl.endsWith("/71295/view"));
    expect(r?.dateText).toBe("2026-08-31 ~");
    // 같은 행의 공고번호 `2026-567`·조회수 `2,378` 이 새어 들어오면 안 된다
    expect(r?.dateText).not.toMatch(/567/);
    expect(r?.dateText).not.toMatch(/2,?378/);
  });
});

describe("산업통상부 설정", () => {
  it("쪽넘김은 GET pageIndex", () => {
    expect(motieConfig.list.url(1)).toBe(
      "https://www.motir.go.kr/kor/article/ATCL2826a2625?pageIndex=1",
    );
    expect(motieConfig.list.url(2)).toBe(
      "https://www.motir.go.kr/kor/article/ATCL2826a2625?pageIndex=2",
    );
    expect(motieConfig.list.maxPages).toBe(8);
  });

  it("id·기관·지역·글자표", () => {
    expect(motieConfig.id).toBe("motie");
    expect(motieConfig.label).toBe("산업통상부 공고");
    expect(motieConfig.agency).toBe("산업통상부");
    expect(motieConfig.region).toBe("전국");
    expect(motieConfig.charset).toBe("utf-8");
    expect(motieConfig.baseUrl).toBe("https://www.motir.go.kr/");
  });

  it("목록 행에 첨부 링크가 섞여 있어 추측 단계를 끈다", () => {
    expect(motieConfig.skipHeuristic).toBe(true);
    // 고정본에 실제로 첨부 링크가 행 안에 있다 — 이 전제가 깨지면 위 설정도 다시 봐야 한다
    expect(listHtml).toContain('<a href="/attach/down/');
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(motieConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(motieConfig.expectMinRows).toBeLessThanOrEqual(rows.length);
  });

  it("설정에 적은 선택자만으로도 실제로 읽힌다 — 자가수리 단계가 참고하는 값이 죽어 있으면 안 된다", () => {
    const bySelector = extractBySelector(listHtml, motieConfig);
    expect(bySelector.length).toBe(10);
    expect(bySelector[0].detailUrl).toContain("71301");
    expect(bySelector[0].dateText).toContain("2026-09-03");
  });

  it("상세 본문·첨부 칸을 실제 상세 서식에 맞춰 못 박았다", () => {
    expect(motieConfig.detailContentSelector).toBe("div.detail-cont");
    expect(motieConfig.attachmentsScopeSelector).toBe("div.detail-info li.info-down");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseMotieList(listHtml.replaceAll("board-tbl board-list", "board-tbl-x board-list"))).toHaveLength(0);
  });

  it("제목 칸(div.board-link)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseMotieList(listHtml.replaceAll('class="board-link"', 'class="board-link-x"'))).toHaveLength(0);
  });

  it("상세 번호(article.view) 모양이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseMotieList(listHtml.replaceAll("article.view(", "article.open("))).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseMotieList(listHtml.replaceAll("<td>2026-", "<td-x>2026-"));
    expect(broken).toHaveLength(9);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});

/**
 * 붙박이 공지 처리 — 실측 1·2쪽에는 붙박이가 없어(전 행이 공고번호 꼴) **고정본을 바꿔** 잰다.
 * 안 그러면 붙박이 규칙이 아무도 안 밟는 죽은 코드가 된다.
 */
describe("붙박이 공지(공고번호 칸이 「공지」인 행)", () => {
  const pinnedHtml = listHtml.replace("2026-567", "공지");
  const oldPinnedHtml = pinnedHtml.replace("<td>2026-08-31</td>", "<td>2024-08-31</td>");

  it("최근 붙박이는 담되 등록일을 개시일로 넘기지 않는다 — 90일 자동 마감에 즉사하지 않게", () => {
    const r = parseMotieList(pinnedHtml).find((x) => x.detailUrl.endsWith("/71295/view"));
    expect(r).toBeDefined();
    expect(r?.dateText).toBe("");
  });

  it("1년 넘게 붙어 있는 붙박이는 아예 담지 않는다", () => {
    const rows2 = parseMotieList(oldPinnedHtml, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(rows2.some((x) => x.detailUrl.endsWith("/71295/view"))).toBe(false);
    expect(rows2).toHaveLength(8);
  });

  it("같은 행이 붙박이가 아니면 그대로 담긴다 — 판정이 날짜만 보고 있지 않다", () => {
    const rows2 = parseMotieList(listHtml.replace("<td>2026-08-31</td>", "<td>2024-08-31</td>"));
    const r = rows2.find((x) => x.detailUrl.endsWith("/71295/view"));
    expect(r?.dateText).toBe("2024-08-31 ~");
  });
});
