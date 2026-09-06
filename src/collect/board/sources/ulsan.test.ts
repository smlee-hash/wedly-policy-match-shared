import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ulsan, parseUlsanList } from "./ulsan";
import { fetchBoardAll, fetchBoardDetail } from "../engine";

const listHtml = readFileSync(join(__dirname, "../__fixtures__/ulsan-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/ulsan-detail.html"), "utf-8");

const deps = {
  fetchText: async () => listHtml,
  prevOpenCount: 0,
  askModel: async () => "{}",
  onAllFailed: vi.fn(),
};

describe("ulsan", () => {
  it("고정본에서 공고를 뽑아 정규화한다", async () => {
    const out = await fetchBoardAll(ulsan, deps);
    expect(out.length).toBeGreaterThanOrEqual(ulsan.expectMinRows ?? 5);
    expect(out[0].source).toBe("ulsan");
    expect(out[0].url).toMatch(/^https?:\/\//);
    expect(out[0].title.length).toBeGreaterThan(3);
  });

  it("customParse 상세주소가 biz_gonggo_detail.php?cmd=detail&rq_gonggopgrm=<id> 형태다", async () => {
    const out = await fetchBoardAll(ulsan, deps);
    expect(out[0].url).toMatch(
      /^https:\/\/platform\.utp\.or\.kr\/com\/biz_gonggo_detail\.php\?cmd=detail&rq_gonggopgrm=\d+$/,
    );
  });

  it("한국어 날짜가 범위로 정규화된다", async () => {
    const out = await fetchBoardAll(ulsan, deps);
    expect(out[0].applyPeriodText).toContain("2026-08-26");
    expect(out[0].applyPeriodText).toContain("2026-09-11");
    expect(out[0].applyStart).not.toBeNull();
    expect(out[0].applyEnd).not.toBeNull();
  });

  it("행별 agency(수행기관)가 잡힌다", async () => {
    const out = await fetchBoardAll(ulsan, deps);
    expect(out[0].agency).toBe("울산테크노파크");
    expect(out.every((r) => r.agency.length > 0)).toBe(true);
  });

  it("onclick 공백·따옴표 유무를 받고, 날짜는 행 전체에서 스캔한다", () => {
    const oneRow = `<table class="media-table"><tbody><tr>
<td>1</td><td>사업화지원</td><td>마케팅</td><td></td>
<td><div class="hidden-xs"><a href="#gonggoView" onclick="goViewGonggo(1461)">2026 울산 지원사업 공고 하나</a></div></td>
<td></td><td><span>울산경제진흥원</span></td>
<td>열추가됨</td>
<td>2026년 8월 26일 0시 ~ 2026년 9월 11일 23시</td>
</tr></tbody></table>`;
    const scanned = parseUlsanList(oneRow, 1);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].detailUrl).toContain("rq_gonggopgrm=1461");
    expect(scanned[0].dateText).toContain("2026-08-26");
    expect(scanned[0].dateText).toContain("2026-09-11");
    expect(scanned[0].category).toBe("사업화지원");
    expect(scanned[0].agency).toBe("울산경제진흥원");
    const quoted = parseUlsanList(oneRow.replace("goViewGonggo(1461)", "goViewGonggo( '1461' )"), 1);
    expect(quoted[0].detailUrl).toContain("rq_gonggopgrm=1461");
    const dbl = parseUlsanList(
      oneRow.replace(`onclick="goViewGonggo(1461)"`, `onclick='goViewGonggo("1461")'`),
      1,
    );
    expect(dbl[0].detailUrl).toContain("rq_gonggopgrm=1461");
  });

  it("상세 고정본 table.table-bordered2 join 에 신청대상이 있다", async () => {
    const text = await fetchBoardDetail(ulsan, "https://platform.utp.or.kr/detail", {
      fetchText: async () => detailHtml,
    });
    expect(text).toContain("신청대상");
  });
});
