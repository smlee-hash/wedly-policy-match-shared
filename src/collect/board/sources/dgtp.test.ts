import { describe, expect, it } from "vitest";
import { dgtpConfig, parseDgtpList } from "./dgtp";

/** 실제 원문 형태 그대로 — 툴팁 사본, 안 닫힌 <a>, 고정 공지 포함. */
const HTML = `<table class="nth3left tablelist">
<colgroup><col class="width100"><col class="width200"></colgroup>
<thead><tr><th>No</th><th>부서명</th><th class="subject_th">제목</th><th>접수기간</th><th>상태</th><th>첨부</th><th>작성자</th><th>작성일</th><th>조회</th></tr></thead>
<tbody>
<tr> <td><span class="notice">공지</span></td> <td>경영기획실</td>
 <td><div class="tooltip"><span class="tooltiptext"><a href="#link" onclick="javascript:fn_egov_inqire_notice('15645', 'BBSMSTR_000000000003', '980221')">공유오피스 사용자 모집</span>
 <a href="#link" onclick="javascript:fn_egov_inqire_notice('15645', 'BBSMSTR_000000000003', '980221')"> 공유오피스 사용자 모집 </a></div></td>
 <td> </td> <td><span class="state state01">상시모집</span></td> <td></td> <td>서정빈</td> <td>2026-07-07</td> <td>1995</td> </tr>
<tr> <td>2191</td> <td>정책기획단</td>
 <td><div class="tooltip"><span class="tooltiptext"><a href="#link" onclick="javascript:fn_egov_inqire_notice('15719', 'BBSMSTR_000000000003', '030140')">기술수요조사 공고</span>
 <a href="#link" onclick="javascript:fn_egov_inqire_notice('15719', 'BBSMSTR_000000000003', '030140')"> 기술수요조사 공고 </a></div></td>
 <td>2026-08-28 ~ 2026-09-11</td> <td><span class="state state03">접수중</span></td> <td></td> <td>박진희</td> <td>2026-08-28</td> <td>97</td> </tr>
</tbody></table>`;

describe("대구테크노파크 목록", () => {
  it("행마다 제목·상세주소·접수기간을 뽑는다", () => {
    const rows = parseDgtpList(HTML);
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe("기술수요조사 공고");
    expect(rows[1].detailUrl).toBe(
      "https://www.dgtp.or.kr/bbs/BoardControllView.do?bbsId=BBSMSTR_000000000003&nttId=15719",
    );
    expect(rows[1].dateText).toBe("2026-08-28 ~ 2026-09-11");
    expect(rows[1].category).toBe("정책기획단");
  });

  it("★제목이 두 번 이어붙지 않는다 — 툴팁 사본을 지운다", () => {
    const rows = parseDgtpList(HTML);
    expect(rows[1].title).not.toContain("기술수요조사 공고 기술수요조사");
    for (const r of rows) expect(r.title).toBe(r.title.trim());
  });

  it("고정 공지는 기간이 없으므로 날짜를 비운다 — 등록일을 시작일로 쓰면 90일 규칙이 공지를 닫는다", () => {
    const rows = parseDgtpList(HTML);
    expect(rows[0].dateText).toBe("");
  });

  it("같은 제목이 고정 공지와 일반 행에 겹치면 일반 행만 남긴다", () => {
    // 제목 링크가 툴팁·본문에 두 번 있다. replace() 는 툴팁만 바꿔 파서가 그걸
    // 지운 뒤에는 원본 제목이 남아 겹침을 만들지 못한다 — 두 번 다 바꾼다.
    const dup = HTML.replace(
      "<td>2191</td> <td>정책기획단</td>",
      "<td>2185</td> <td>경영기획실</td>",
    ).replaceAll("기술수요조사 공고", "공유오피스 사용자 모집");
    const rows = parseDgtpList(dup);
    const titles = rows.map((r) => r.title);
    expect(new Set(titles).size).toBe(titles.length);
    // 남은 쪽은 기간이 있는 일반 행이어야 한다
    expect(rows.find((r) => r.title === "공유오피스 사용자 모집")!.dateText).not.toBe("");
  });

  it("글번호가 숫자가 아니면 그 행을 버린다 — 주소에 그대로 들어가므로", () => {
    // 글번호도 툴팁·본문에 두 번. 툴팁만 바꾸면 파서가 그걸 지운 뒤 정상 번호가 남는다.
    const bad = HTML.replaceAll("'15719'", "'15719&foo=1'");
    expect(parseDgtpList(bad)).toHaveLength(1);
  });

  it("설정값이 쪽 번호를 받고 검사 관문을 갖는다", () => {
    expect(dgtpConfig.list.url(2)).toContain("pageIndex=2");
    expect(dgtpConfig.list.maxPages).toBe(30);
    expect(dgtpConfig.expectMinRows).toBe(5);
    expect(dgtpConfig.customParse).toBeTypeOf("function");
    expect(dgtpConfig.id).toBe("dgtp");
    expect(dgtpConfig.region).toBe("대구");
  });

  it("상세 본문 범위를 form 안쪽으로 좁힌다 — 「다음글/이전글」 표가 섞이면 옆 공고 제목이 본문에 들어간다", () => {
    expect(dgtpConfig.detailContentSelector).toBe("form table.tableview");
    expect(dgtpConfig.attachmentsScopeSelector).toBe("form table.tableview");
  });
});
