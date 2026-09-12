import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSbaDropTitle, parseSbaList, sbaConfig } from "./sba";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-03 실측 `Posting.aspx` 1쪽(GET)·2쪽(포스트백 POST 응답).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/sba-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/sba-list-p2.html"), "utf-8");

const VIEW = "https://www.sba.seoul.kr/Pages/BusinessApply/PostingDetail.aspx";


describe("서울경제진흥원(SBA) 전체사업 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄을 읽고 첫 행이 맞다", () => {
    const rows = parseSbaList(listHtml, 1);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "홍콩 코스모프로프 미용 전시회(Cosmoprof Asia 2026) 서울 공동관 참여기업 모집",
      detailUrl: `${VIEW}?p=0&mid=a271326e-22a0-f111-b404-d4f5ef4a1e33`,
      dateText: "2026-08-26 ~ 2026-09-10",
      category: "기업",
    });
  });

  it("접수기간을 시작·끝 둘 다 읽는다 — 10줄 전부 기간형", () => {
    const rows = parseSbaList(listHtml, 1);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
    expect(rows[3].dateText).toBe("2026-08-20 ~ 2026-12-31");
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    const rows = [...parseSbaList(listHtml, 1), ...parseSbaList(listP2Html, 2)];
    expect(rows.every((r) => !/[?&](page|pageNum|pg)=/i.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => r.detailUrl.startsWith(`${VIEW}?p=0&mid=`))).toBe(true);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — 포스트백 쪽넘김이 진짜 먹는다", () => {
    const rows = parseSbaList(listHtml, 1);
    const rowsP2 = parseSbaList(listP2Html, 2);
    expect(rowsP2).toHaveLength(10);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 하반기 B the B 뷰티테크·디바이스 테스트베드 지원기업 모집",
      detailUrl: `${VIEW}?p=0&mid=6d512064-ac8c-f111-b404-d4f5ef4a1e33`,
      dateText: "2026-07-31 ~ 2026-08-21",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없다", () => {
    const combined = [...parseSbaList(listHtml, 1), ...parseSbaList(listP2Html, 2)];
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(20);
  });

  it("행마다 유형(기업/기업+개인)을 실어 준다", () => {
    const rows = parseSbaList(listHtml, 1);
    expect(rows[1].category).toBe("기업+개인");
    expect(rows.every((r) => (r.category ?? "").length > 0)).toBe(true);
  });
});

describe("지원사업이 아닌 글 거르개", () => {
  it("DROP 낱말이 든 행은 목록에서 빠진다 — 실제 고정본 제목을 갈아 끼워 잰다", () => {
    const poisoned = listHtml.replace(
      "중동상황대응 『수출위기극복 및 대체시장 개척』 심화컨설팅",
      "용역 제안서 평가위원 모집 공고",
    );
    const rows = parseSbaList(poisoned, 1);
    expect(rows).toHaveLength(9);
    expect(rows.some((r) => r.title.includes("평가위원"))).toBe(false);
    // 갈아 끼운 그 한 줄만 빠졌다 — 나머지 9줄은 그대로다.
    expect(rows.some((r) => r.title.includes("심화컨설팅"))).toBe(false);
    expect(rows[0].title).toBe("홍콩 코스모프로프 미용 전시회(Cosmoprof Asia 2026) 서울 공동관 참여기업 모집");
  });

  it("입찰·설문·합격자 발표는 버린다", () => {
    expect(isSbaDropTitle("○○ 구축 용역 입찰 공고")).toBe(true);
    expect(isSbaDropTitle("이용자 만족도 설문 조사")).toBe(true);
    expect(isSbaDropTitle("2026년 상반기 교육생 최종 합격자 발표")).toBe(true);
    expect(isSbaDropTitle("사무보조원 채용 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isSbaDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isSbaDropTitle("신규직원 채용 지원금 신청 안내")).toBe(false);
  });

  it("실제 고정본 20줄에는 버릴 글이 없다 — 거르개가 지원사업을 잡아먹지 않는다", () => {
    const combined = [...parseSbaList(listHtml, 1), ...parseSbaList(listP2Html, 2)];
    expect(combined.filter((r) => isSbaDropTitle(r.title))).toEqual([]);
  });
});

it("등록된 수집기가 회차별 쪽 세션을 사용한다", () => {
  expect(sbaConfig.createListSession).toBeTypeOf("function");
  expect(sbaConfig.list.init).toBeUndefined();
  expect(sbaConfig.validationParse).toBeTypeOf("function");
});

describe("서울경제진흥원(SBA) 설정", () => {
  it("id·기관·지역", () => {
    expect(sbaConfig.id).toBe("sba");
    expect(sbaConfig.region).toBe("서울");
    expect(sbaConfig.agency).toBe("서울경제진흥원");
    expect(sbaConfig.charset).toBe("utf-8");
  });

  it("첨부 파일 서버(smc.sba.kr)를 허용 호스트에 적는다 — 안 적으면 공고문 PDF 를 못 받는다", () => {
    expect(sbaConfig.allowedHosts).toContain("smc.sba.kr");
  });

  it("추측 단계를 끈다 — 목록에 상세 링크가 href 로 없어 추측이 메뉴 링크를 공고로 저장한다", () => {
    expect(sbaConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(sbaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(sbaConfig.expectMinRows).toBeLessThanOrEqual(5);
  });

  it("첨부 범위를 상세 표 안으로 좁힌다", () => {
    expect(sbaConfig.attachmentsScopeSelector).toBe("table.info_table");
  });

  it("★상세 본문 선택자는 일부러 비워 둔다 — 표지 요약을 채우면 공고문 PDF 를 영영 못 읽는다", () => {
    expect(sbaConfig.detailContentSelector).toBeUndefined();
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseSbaList(listHtml.replaceAll("grid_list tbody", "grid_list tbody-x"), 1)).toHaveLength(0);
  });

  it("제목 칸(new_name_) 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSbaList(listHtml.replaceAll("new_name_", "new_namex_"), 1)).toHaveLength(0);
  });

  it("상세 열쇠(mid)가 사라지면 한 줄도 못 읽는다 — 주소를 지어내지 않는다", () => {
    const noKey = listHtml.replaceAll("mid=", "xid=").replaceAll("new_displayId_", "x_");
    expect(parseSbaList(noKey, 1)).toHaveLength(0);
  });

  it("onClick 이 사라져도 숨은 칸(new_displayId_)으로 살아난다 — 보조 길이 죽어 있지 않다", () => {
    const noClick = listHtml.replaceAll("onClick=", "data-noclick=");
    const rows = parseSbaList(noClick, 1);
    expect(rows).toHaveLength(10);
    expect(rows[0].detailUrl).toBe(`${VIEW}?p=0&mid=a271326e-22a0-f111-b404-d4f5ef4a1e33`);
  });

  it("제목이 빈 줄은 담지 않는다 — 마지막 쪽(233쪽)에 실제로 그런 줄이 있다", () => {
    const blanked = listHtml.replace(
      '<span id="ContentPlaceHolder1_MainContents_GridView1_new_name_0">홍콩 코스모프로프 미용 전시회(Cosmoprof Asia 2026) 서울 공동관 참여기업 모집</span>',
      '<span id="ContentPlaceHolder1_MainContents_GridView1_new_name_0"></span>',
    );
    const rows = parseSbaList(blanked, 1);
    expect(rows).toHaveLength(9);
    expect(rows.some((r) => r.title.includes("코스모프로프"))).toBe(false);
  });

  it("접수일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const noDate = listHtml.replaceAll("lb_receipt_start_", "x_start_").replaceAll("lb_receipt_end_", "x_end_");
    const rows = parseSbaList(noDate, 1);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.dateText === "")).toBe(true);
  });

});
