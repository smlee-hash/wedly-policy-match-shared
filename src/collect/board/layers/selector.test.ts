import { describe, it, expect } from "vitest";
import { extractBySelector } from "./selector";
import type { BoardConfig } from "../types";

const HTML = `<table><tbody>
<tr><td class="num">1</td><td class="subject"><a href="/board/view?id=101">2026 창업 지원사업 공고</a></td><td class="date">2026-08-01</td></tr>
<tr><td class="num">2</td><td class="subject"><a href="/board/view?id=102">청년 채용 장려금 안내</a></td><td class="date">2026-08-03</td></tr>
</tbody></table>`;

const cfg = {
  id: "t", label: "테", agency: "테크노파크", region: "부산", baseUrl: "https://a.kr/board/",
  list: { url: () => "", maxPages: 1, rowSelector: "tbody tr",
    fields: { title: { selector: "td.subject a" }, detailUrl: { selector: "td.subject a", attr: "href" }, date: { selector: "td.date" } } },
} as unknown as BoardConfig;

describe("extractBySelector", () => {
  it("행마다 제목·절대링크·날짜를 뽑는다", () => {
    const rows = extractBySelector(HTML, cfg);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("2026 창업 지원사업 공고");
    expect(rows[0].detailUrl).toBe("https://a.kr/board/view?id=101");
    expect(rows[0].dateText).toBe("2026-08-01");
  });
  it("rowSelector 가 안 맞으면 빈 배열", () => {
    expect(extractBySelector("<div>없음</div>", cfg)).toEqual([]);
  });
  it("속성값 HTML 엔티티를 복원한 뒤 절대 주소로 만든다", () => {
    const html = `<table><tbody>
<tr><td class="subject"><a href="board.es?mid=a20102000000&amp;bid=0102&amp;act=view&amp;list_no=9">대전 지원사업 공고</a></td><td class="date">2026/08/14~2026/09/02</td></tr>
</tbody></table>`;
    const daejeonCfg = {
      ...cfg,
      baseUrl: "https://www.djtp.or.kr/",
      list: {
        ...cfg.list,
        fields: {
          title: { selector: "td.subject a" },
          detailUrl: { selector: "td.subject a", attr: "href" },
          date: { selector: "td.date" },
        },
      },
    } as unknown as BoardConfig;
    const rows = extractBySelector(html, daejeonCfg);
    expect(rows).toHaveLength(1);
    expect(rows[0].detailUrl).toBe(
      "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
    );
    expect(rows[0].detailUrl).not.toContain("&amp;");
  });
  it("dateText 를 내놓기 직전 점·빗금 날짜를 정규화한다", () => {
    const html = `<table><tbody>
<tr><td class="subject"><a href="/v?id=1">접수기간 공고</a></td><td class="date">2026.08.26 ~ 2026.09.04</td></tr>
</tbody></table>`;
    const rows = extractBySelector(html, cfg);
    expect(rows[0].dateText).toBe("2026-08-26 ~ 2026-09-04");
  });
  it("regex 는 앞 1000자만 본다", () => {
    const pad = "x".repeat(1000);
    const html = `<table><tbody>
<tr><td class="subject"><a href="/v?id=1">2026 창업 지원사업 공고</a></td><td class="date">${pad}2026-08-01</td></tr>
</tbody></table>`;
    const withRe = {
      ...cfg,
      list: {
        ...cfg.list,
        fields: { ...cfg.list.fields, date: { selector: "td.date", regex: "(20\\d{2}-\\d{2}-\\d{2})" } },
      },
    };
    const rows = extractBySelector(html, withRe);
    expect(rows[0].dateText).toBe("");
    const near = `<table><tbody>
<tr><td class="subject"><a href="/v?id=1">2026 창업 지원사업 공고</a></td><td class="date">${"x".repeat(10)}2026-08-01</td></tr>
</tbody></table>`;
    expect(extractBySelector(near, withRe)[0].dateText).toBe("2026-08-01");
  });
});
