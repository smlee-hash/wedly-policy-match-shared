import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSnipDropTitle, parseSnipList, snipConfig } from "./snip";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-02 실측 1·2쪽 (`Business1.do?page=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/snip-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/snip-list-p2.html"), "utf-8");
const rows = parseSnipList(listHtml);
const combined = parseSnipList(listHtml + listP2Html);

describe("성남산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 10건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "성남 중장년 기술창업센터 신규입주기업 모집",
      detailUrl:
        "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0246&portlet2=4100&homeYn=Y",
      // 접수기간은 td.term 을 직접 집는다. 행 전체 글자면 조회수 142 + 작성일 2026-08-31 이 붙는다.
      dateText: "2026-08-31 ~ 2026-09-17",
      agency: "성남산업진흥원",
    });
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고, DROP 1건을 뺀 19건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(19);
  });

  it("DROP 거르개가 실측 제목 「강사 인력 Pool 모집」을 실제로 버린다", () => {
    expect(combined.some((r) => r.title.includes("강사 인력 Pool"))).toBe(false);
    expect(isSnipDropTitle("RA 전문가 양성교육 교육 강사 인력 Pool 모집")).toBe(true);
  });

  it("「~ 안내」로 끝나는 진짜 지원사업은 살린다 — 허용목록(KEEP)을 쓰지 않는다", () => {
    expect(rows.some((r) => r.title.includes("지식재산 거래 지원사업 신청 안내"))).toBe(true);
    expect(isSnipDropTitle("[성남특허센터] 지식재산 거래 지원사업 신청 안내 (기술이전, 기술거래)")).toBe(
      false,
    );
  });

  it("「채용」을 통째로 버리지 않는다 — 고용보조금은 제목에 채용을 쓴다", () => {
    expect(isSnipDropTitle("방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
  });

  it("접수기간은 td.term 칸에서만 집는다 — 작성일 칸(td.data)으로 떨어지면 안 된다", () => {
    // 1쪽 세 번째 행: 접수기간 08-28~09-04, 작성일 08-27. 작성일을 집으면 끝이 08-27 이 된다.
    const r = rows.find((x) => x.title.includes("Indocomtech"));
    expect(r?.dateText).toBe("2026-08-28 ~ 2026-09-04");
  });

  it("같은 쪽 안에서도 상세 열쇠 중복이 없다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("성남산업진흥원 설정", () => {
  it("쪽넘김은 GET page — pageIndex·pageNo·currentPage 는 실측에서 안 먹는다", () => {
    expect(snipConfig.list.url(1)).toBe("https://www.snip.or.kr/SNIP/contents/Business1.do?page=1");
    expect(snipConfig.list.url(2)).toBe("https://www.snip.or.kr/SNIP/contents/Business1.do?page=2");
    expect(snipConfig.list.url(2)).not.toContain("pageIndex");
    expect(snipConfig.list.url(2)).not.toContain("pageNo");
    expect(snipConfig.list.url(2)).not.toContain("currentPage");
    expect(snipConfig.list.maxPages).toBe(10);
  });

  it("상세가 다른 호스트(포트 포함)라 allowedHosts 에 portal.snip.or.kr:8443 이 있다", () => {
    expect(snipConfig.allowedHosts).toEqual(["portal.snip.or.kr:8443"]);
  });

  it("지역은 경기 — 전국에 노출되면 안 된다", () => {
    expect(snipConfig.region).toBe("경기");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(snipConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});

/**
 * ★상세는 공개돼 있지 않다 — 2026-09-02 실측으로 확정하고 시험으로 못 박는다.
 * 목록 링크(`portal.snip.or.kr:8443/…/application.page`)를 받아 보면 20KB 껍데기에
 * `<iframe src='/statics/password/passwordChange.jsp'>` 가 들어 있다(로그인 화면).
 */
describe("상세 조달 — 요청 자체를 하지 않는다", () => {
  it("통신 없이 빈 문자열을 돌려준다 — 회차마다 로그인 화면을 다시 받지 않도록", async () => {
    let called = 0;
    const html = await snipConfig.detailFetch!("https://portal.snip.or.kr:8443/x", async () => {
      called += 1;
      return "<html>로그인</html>";
    });
    expect(html).toBe("");
    expect(called).toBe(0);
  });

  it("상세를 못 읽는 대신 목록이 접수기간을 주므로 마감 판정은 정확하다", () => {
    const withRange = rows.filter((r) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText));
    expect(withRange.length).toBe(rows.length);
  });
});
