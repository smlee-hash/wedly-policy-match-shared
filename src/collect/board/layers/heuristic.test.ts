import { describe, it, expect } from "vitest";
import { extractByHeuristic } from "./heuristic";

// selector 정보 전혀 없이, 구조만으로 뽑아야 한다. class 이름을 일부러 무의미하게.
const HTML = `<div id="wrap"><ul class="xQ">
<li class="z1"><span>1</span><a href="/read/501">2026년 스마트공장 보급 지원사업 모집 공고</a><em>2026.08.05</em></li>
<li class="z1"><span>2</span><a href="/read/502">지역 소상공인 특례보증 안내</a><em>2026.08.07</em></li>
<li class="z1"><span>3</span><a href="/read/503">수출바우처 참여기업 모집</a><em>2026.08.09</em></li>
</ul></div>`;

describe("extractByHeuristic", () => {
  it("설정 없이 구조·뜻만으로 행을 뽑는다", () => {
    const rows = extractByHeuristic(HTML, "https://b.kr/notice/");
    expect(rows.length).toBe(3);
    expect(rows[0].title).toContain("스마트공장");
    expect(rows[0].detailUrl).toBe("https://b.kr/read/501");
    expect(rows[0].dateText).toBe("2026-08-05");
  });
  it("메뉴 20개보다 날짜 있는 공고 10행을 고른다", () => {
    const menu = Array.from({ length: 20 }, (_, i) =>
      `<li><a href="/m/${i}">메뉴항목 이름 ${i}번입니다</a></li>`,
    ).join("");
    const notices = Array.from({ length: 10 }, (_, i) =>
      `<tr><td><a href="/n/${i}">2026 지원사업 공고 ${i}번 모집</a></td><td>2026-08-0${(i % 9) + 1}</td></tr>`,
    ).join("");
    const html = `<div><ul class="menu">${menu}</ul><table><tbody>${notices}</tbody></table></div>`;
    const rows = extractByHeuristic(html, "https://b.kr/");
    expect(rows.length).toBe(10);
    expect(rows[0].detailUrl).toContain("/n/");
    expect(rows.every((r) => r.dateText.length > 0)).toBe(true);
  });
  it("범위가 있으면 dateText 를 시작~끝 형태로 뽑는다", () => {
    const html = `<ul class="xQ">
<li class="z1"><a href="/read/501">2026년 스마트공장 보급 지원사업 모집 공고</a><em>2026/08/14 ~ 2026/09/02</em></li>
<li class="z1"><a href="/read/502">지역 소상공인 특례보증 안내입니다요</a><em>2026/08/03 ~ 2026/08/21</em></li>
<li class="z1"><a href="/read/503">수출바우처 참여기업 모집 안내입니다요</a><em>2026/07/15 ~ 2026/08/14</em></li>
</ul>`;
    const rows = extractByHeuristic(html, "https://b.kr/");
    expect(rows.length).toBe(3);
    expect(rows[0].dateText).toMatch(/2026-08-14\s*~\s*2026-09-02/);
    expect(rows[1].dateText).toMatch(/2026-08-03\s*~\s*2026-08-21/);
    expect(rows[2].dateText).toMatch(/2026-07-15\s*~\s*2026-08-14/);
  });
  it("깊은 중첩에서도 스택 오버플로 없이 뽑는다", () => {
    const inner = `<ul class="xQ">
<li class="z1"><a href="/read/501">2026년 스마트공장 보급 지원사업 모집 공고</a><em>2026.08.05</em></li>
<li class="z1"><a href="/read/502">지역 소상공인 특례보증 안내입니다</a><em>2026.08.07</em></li>
<li class="z1"><a href="/read/503">수출바우처 참여기업 모집 안내입니다</a><em>2026.08.09</em></li>
</ul>`;
    const html = `${"<div>".repeat(2000)}${inner}${"</div>".repeat(2000)}`;
    expect(() => extractByHeuristic(html, "https://b.kr/")).not.toThrow();
    const rows = extractByHeuristic(html, "https://b.kr/");
    expect(rows.length).toBe(3);
  });
});
