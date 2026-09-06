import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { gjtpConfig, parseGjtpList } from "./gjtp";

const HTML = `<table class="list-table"><tbody>
<tr><th scope="row" class="num">1765</th>
 <td class="tal"><a href="?act=view&amp;bsnssId=2252&amp;ctg01=01,02&amp;pageIndex=1&amp;pageUnit=30&amp;searchKeyword=">기술수요조사 공고</a></td>
 <td class="period">2026-08-27 ~ <br>2026-09-04</td>
 <td class="respon">신동휘</td><td class="hits biz">8</td>
 <td class="accept"><span class="status ongoing">접수중</span></td></tr>
<tr><th scope="row" class="num">1764</th>
 <td class="tal"><a href="?act=view&amp;bsnssId=2251&amp;pageIndex=1">수혜기업 모집 공고</a></td>
 <td class="period">2026-08-26 ~ <br>2026-09-09</td>
 <td class="respon">박성범</td><td class="hits biz">320</td>
 <td class="accept"><span class="status">접수마감</span></td></tr>
</tbody></table>`;

describe("광주테크노파크 목록", () => {
  it("행마다 제목·상세주소·접수기간을 뽑는다", () => {
    const rows = parseHtml(HTML).querySelectorAll(gjtpConfig.list.rowSelector);
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector("td.tal a")!.text.trim()).toBe("기술수요조사 공고");
    expect(rows[0].querySelector("td.period")!.text.replace(/\s+/g, " ").trim())
      .toBe("2026-08-27 ~ 2026-09-04");
  });

  it("목록 주소가 쪽 번호를 받는다", () => {
    expect(gjtpConfig.list.url(2)).toContain("pageIndex=2");
    expect(gjtpConfig.list.url(2)).toContain("pageUnit=30");
  });

  it("쪽·검색·분류 파라미터를 상세 주소에서 지운다", () => {
    for (const p of ["pageIndex", "pageUnit", "searchKeyword", "ctg01", "ctg02", "ctg03"]) {
      expect(gjtpConfig.dropUrlParams).toContain(p);
    }
  });

  it("상대 링크가 목록 쪽 주소를 기준으로 절대화된다", () => {
    expect(new URL("?act=view&bsnssId=2252", gjtpConfig.baseUrl).toString())
      .toBe("https://www.gjtp.or.kr/home/business.cs?act=view&bsnssId=2252");
  });

  it("상세 주소가 bsnssId 만 남긴 정규 주소로 만들어진다(쿼리 순서가 달라도 같은 주소)", () => {
    const html = `<table class="list-table"><tbody>
<tr><td class="tal"><a href="?act=view&amp;ctg01=01,02&amp;bsnssId=2252&amp;pageIndex=2&amp;pageUnit=30">기술수요조사 공고</a></td>
 <td class="period">2026-08-27 ~ <br>2026-09-04</td></tr>
<tr><td class="tal"><a href="?bsnssId=2252&amp;act=view&amp;searchKeyword=">기술수요조사 공고</a></td>
 <td class="period">2026-08-27 ~ 2026-09-04</td></tr>
</tbody></table>`;
    const rows = parseGjtpList(html);
    const canonical = "https://www.gjtp.or.kr/home/business.cs?act=view&bsnssId=2252";
    expect(rows).toHaveLength(2);
    expect(rows[0].detailUrl).toBe(canonical);
    expect(rows[1].detailUrl).toBe(canonical);
    expect(rows[0].title).toBe("기술수요조사 공고");
    expect(rows[0].dateText).toBe("2026-08-27 ~ 2026-09-04");
  });

  it("목록 선택자와 dropUrlParams 는 자가수리용으로 남긴다", () => {
    expect(gjtpConfig.customParse).toBeTypeOf("function");
    expect(gjtpConfig.list.fields.title.selector).toBe("td.tal a");
    expect(gjtpConfig.list.fields.detailUrl).toEqual({ selector: "td.tal a", attr: "href" });
    expect(gjtpConfig.list.fields.date.selector).toBe("td.period");
    expect(gjtpConfig.expectMinRows).toBe(10);
  });
});
