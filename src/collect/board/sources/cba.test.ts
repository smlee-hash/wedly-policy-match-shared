import { describe, expect, it } from "vitest";
import { cbaConfig, parseCbaList } from "./cba";

const HTML = `<table class="board m_board"><tbody>
<tr><td><img alt="공지글"></td><td class="c00000001">자금/금융</td>
 <td class="txt_left"><a href="sub.php?menukey=172&amp;mod=view&amp;no=30726">중소기업육성자금 융자 공고</a></td>
 <td>기업지원부</td><td>2026/08/21</td><td>1406</td><td></td></tr>
<tr><td>3115</td><td class="c00000021">청년지원</td>
 <td class="txt_left"><a href="sub.php?menukey=172&amp;mod=view&amp;no=30700">청년 일경험 참여기업 모집</a></td>
 <td>청년일자리팀</td><td>2026/08/13</td><td>22</td><td></td></tr>
<tr><td>3114</td><td class="c00000001">자금/금융</td>
 <td class="txt_left"><a href="sub.php?menukey=172&amp;mod=view&amp;no=30726">중소기업육성자금 융자 공고</a></td>
 <td>기업지원부</td><td>2026/08/21</td><td>1406</td><td></td></tr>
</tbody></table>`;

function rowHtml(opts: { no: string; title: string; date: string; notice?: boolean }): string {
  const first = opts.notice ? `<td><img alt="공지글"></td>` : `<td>1</td>`;
  return `<table class="board"><tbody><tr>${first}<td>분류</td>
 <td class="txt_left"><a href="sub.php?menukey=172&amp;mod=view&amp;no=${opts.no}">${opts.title}</a></td>
 <td>부서</td><td>${opts.date}</td><td>1</td></tr></tbody></table>`;
}

describe("충북기업진흥원 목록", () => {
  it("제목·상세주소·분류를 뽑고 등록일을 개시형으로 만든다", () => {
    const rows = parseCbaList(HTML);
    expect(rows[0].title).toBe("중소기업육성자금 융자 공고");
    expect(rows[0].detailUrl).toBe("https://www.cba.ne.kr/home/sub.php?menukey=172&mod=view&no=30726");
    expect(rows[1].dateText).toBe("2026-08-13 ~");
    expect(rows[0].category).toBe("자금/금융");
  });

  it("한 쪽 안에 두 번 나오는 고정 공지를 한 번만 센다", () => {
    expect(parseCbaList(HTML).length).toBe(2);
  });

  it("고정 공지는 제목을 그대로 두고 날짜를 비운다 — 개시 90일 자동 마감에 안 걸리게", () => {
    const rows = parseCbaList(HTML);
    expect(rows[0].title).toBe("중소기업육성자금 융자 공고"); // 우리가 [공지] 를 지어 붙이지 않는다
    expect(rows[0].dateText).toBe("");
    expect(rows[1].dateText).toBe("2026-08-13 ~"); // 고정 아닌 행은 그대로 개시형
  });

  it("공고가 아닌 소식지·설명회는 버린다", () => {
    expect(parseCbaList(rowHtml({ no: "9", title: "비지자체 대상 공모사업 동향(26-31호)(26.7.27~7.31)", date: "2026/08/21" }))).toEqual([]);
    expect(parseCbaList(rowHtml({ no: "10", title: "KAIST 바이오 혁신경영 전문대학원 2027학년도 봄학기 입시설명회", date: "2026/08/21" }))).toEqual([]);
    expect(parseCbaList(rowHtml({ no: "11", title: "2026년 충북 농식품 해외 무역사절단 파견(재공고)", date: "2026/08/21" }))).toHaveLength(1);
  });

  it("주소에 못 넣을 글자가 섞인 글번호는 버린다 — 두 번 인코딩해 엉뚱한 글을 부르지 않게", () => {
    expect(parseCbaList(rowHtml({ no: "A%2FB", title: "인코딩된 번호", date: "2026/08/21" }))).toEqual([]);
  });

  it("등록일이 2026/8/1 이나 2026-08-01 로 와도 읽는다", () => {
    expect(parseCbaList(rowHtml({ no: "1", title: "한자리 빗금", date: "2026/8/1" }))[0].dateText)
      .toBe("2026-08-01 ~");
    expect(parseCbaList(rowHtml({ no: "2", title: "하이픈 날짜", date: "2026-08-01" }))[0].dateText)
      .toBe("2026-08-01 ~");
    expect(parseCbaList(rowHtml({ no: "3", title: "점 날짜", date: "2026.8.1" }))[0].dateText)
      .toBe("2026-08-01 ~");
  });

  it("no 값에 숫자 아닌 글자가 섞여도 그대로 쓴다", () => {
    const rows = parseCbaList(rowHtml({ no: "30726A", title: "알파 번호", date: "2026/08/21" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].detailUrl).toBe("https://www.cba.ne.kr/home/sub.php?menukey=172&mod=view&no=30726A");
  });

  it("no 가 없거나 제목이 빈 행은 버린다", () => {
    expect(parseCbaList(`<table class="board"><tbody><tr><td class="txt_left"><a href="sub.php?menukey=172">  </a></td></tr></tbody></table>`)).toEqual([]);
  });

  it("목록 주소가 쪽 번호를 받는다", () => {
    expect(cbaConfig.list.url(3)).toContain("page=3");
    expect(cbaConfig.expectMinRows).toBe(8);
  });
});
