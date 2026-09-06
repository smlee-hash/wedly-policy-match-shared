import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ipetConfig, isIpetDropTitle, parseIpetList } from "./ipet";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다(창원 사고).
 * 고정본: 2026-09-03 실측 `https://www.ipet.re.kr/Notice/bizNoticeLV.asp?page=1|2`
 * (내려받은 바이트 그대로 복사 — 51,375 / 50,857 바이트).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/ipet-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/ipet-list-p2.html"), "utf-8");
const rows = parseIpetList(listHtml);
const rowsP2 = parseIpetList(listP2Html, 2);
const combined = [...rows, ...rowsP2];

describe("농림식품기술기획평가원 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄을 그대로 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "2026년 투·융자 연계 기술개발사업 정책지정형(농식품부) 시행계획 공고",
      detailUrl: "https://www.ipet.re.kr/Notice/bizNoticeVP.asp?tbl_id=2026000028",
      dateText: "2026-04-14 ~ 2026-04-30",
      agency: "농림식품기술기획평가원",
    });
  });

  it("★상세 주소에 쪽 번호·제목 꼬리표를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    // 목록의 href 는 `bizNoticeVP.asp?page=1&tbl_id=…&_sbj=…` 라 그대로 쓰면 2쪽에서 본 같은 글이
    // 다른 열쇠(sourceId)가 되어 두 줄로 저장된다.
    expect(combined.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]_sbj=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => /^https:\/\/www\.ipet\.re\.kr\/Notice\/bizNoticeVP\.asp\?tbl_id=\d+$/.test(r.detailUrl))).toBe(true);
  });

  it("접수기간을 「시작 ~ 끝」으로 넘긴다 — 전 행", () => {
    expect(combined).toHaveLength(20);
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
  });

  it("★날짜는 접수기간 칸에서만 집는다 — 행 전체 글자면 번호·등록일과 붙는다", () => {
    const first = rows[0];
    // 행 전체 글자였다면 번호 「327」 이 앞에 붙어 「3272026-04-14」 가 된다(hsbiz 실측 함정).
    expect(first.dateText).toBe("2026-04-14 ~ 2026-04-30");
    expect(first.dateText).not.toMatch(/327/);
    // 등록일(2026-03-31)은 접수기간이 아니다 — 마지막 칸을 잘못 집으면 여기서 걸린다.
    expect(first.dateText).not.toMatch(/2026-03-31/);
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — page= 가 진짜 먹는다", () => {
    expect(rowsP2).toHaveLength(10);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 농업연구개발사업 3차공모",
      detailUrl: "https://www.ipet.re.kr/Notice/bizNoticeVP.asp?tbl_id=2026000017",
      dateText: "2025-12-30 ~ 2026-02-02",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("제목이 잘리지 않는다 — 긴 공고명도 통째로", () => {
    expect(rows.map((r) => r.title)).toContain(
      "2026년도 첨단바이오기술기반수요연계형그린바이오소재산업화기술개발사업 시행계획 재공고",
    );
    expect(rows.every((r) => !r.title.endsWith("..."))).toBe(true);
  });
});

describe("지원사업이 아닌 글 거르개", () => {
  it("실측 20줄에는 버릴 글이 없다 — 좁게 버린다는 뜻", () => {
    expect(combined).toHaveLength(20);
  });

  it("입찰·평가위원·합격자·직원 채용 공고는 버린다", () => {
    expect(isIpetDropTitle("2026년 IPET 청사 이전 용역 입찰 공고")).toBe(true);
    expect(isIpetDropTitle("2026년도 농림식품 R&D 평가위원 모집 공고")).toBe(true);
    expect(isIpetDropTitle("2026년 상반기 직원 채용 공고")).toBe(true);
    expect(isIpetDropTitle("2026년 신규직원 채용 최종 합격자 발표")).toBe(true);
    expect(isIpetDropTitle("연구장비 구매 우선협상대상자 공고")).toBe(true);
  });

  it("★「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isIpetDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isIpetDropTitle("2026년도 고부가가치식품기술개발사업 시행계획 재공고")).toBe(false);
  });

  it("거르개가 파싱에 실제로 걸려 있다 — 제목만 바꾸면 그 줄이 사라진다", () => {
    const tampered = listHtml.replaceAll(
      "2026년도 고부가가치식품기술개발사업 시행계획 재공고",
      "2026년도 사업 제안서 평가위원 모집 공고",
    );
    const got = parseIpetList(tampered);
    expect(got).toHaveLength(9);
    expect(got.some((r) => r.detailUrl.includes("tbl_id=2026000025"))).toBe(false);
  });
});

describe("붙박이 공지", () => {
  // 실측 33쪽 전부 번호 칸이 숫자였다(붙박이 없음). 서식이 바뀌어 생기면 1년 넘은 것은 담지 않는다.
  const pinned = listHtml.replace("<td>327</td>", "<td>공지</td>");

  it("번호가 「공지」인 줄도 1년 안쪽이면 담는다", () => {
    const got = parseIpetList(pinned, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(got).toHaveLength(10);
    expect(got[0].detailUrl).toContain("tbl_id=2026000028");
  });

  it("등록일이 1년 넘은 붙박이는 담지 않는다", () => {
    const got = parseIpetList(pinned, 1, Date.parse("2028-01-01T00:00:00Z"));
    expect(got).toHaveLength(9);
    expect(got.some((r) => r.detailUrl.includes("tbl_id=2026000028"))).toBe(false);
  });
});

describe("농림식품기술기획평가원 설정", () => {
  it("쪽넘김은 GET page", () => {
    expect(ipetConfig.list.url(1)).toBe("https://www.ipet.re.kr/Notice/bizNoticeLV.asp?page=1");
    expect(ipetConfig.list.url(2)).toBe("https://www.ipet.re.kr/Notice/bizNoticeLV.asp?page=2");
    expect(ipetConfig.list.maxPages).toBe(10);
  });

  it("id·기관·지역", () => {
    expect(ipetConfig.id).toBe("ipet");
    expect(ipetConfig.agency).toBe("농림식품기술기획평가원");
    expect(ipetConfig.region).toBe("전국");
    expect(ipetConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(ipetConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(ipetConfig.expectMinRows).toBeLessThanOrEqual(10);
  });

  it("★첨부 호스트(rnd.ipet.re.kr)를 명부에 적었다 — 안 적으면 첨부를 통째로 못 받는다", () => {
    expect(ipetConfig.allowedHosts).toContain("rnd.ipet.re.kr");
  });

  it("본문·첨부 칸 선택자가 실제 상세 서식과 맞다", () => {
    expect(ipetConfig.detailContentSelector).toBe("table.sub-table.row-table");
    expect(ipetConfig.attachmentsScopeSelector).toBe("table.row-table a[href*='fileDownload.do']");
  });

  it("목록에 첨부 링크가 없어 추측 단계를 막지 않는다", () => {
    // 목록 행의 링크는 bizNoticeVP.asp 뿐이라 heuristic 이 파일 링크를 공고로 저장할 위험이 없다.
    expect(ipetConfig.skipHeuristic).toBeUndefined();
    expect(/href="[^"]*(?:download|\.pdf|\.hwp|\.zip)/i.test(listHtml)).toBe(false);
  });

  it("설정의 행 선택자가 실제 고정본에서 10줄을 집는다", () => {
    expect(ipetConfig.list.rowSelector).toBe("table.sub-table tbody tr");
    expect(ipetConfig.customParse).toBeTypeOf("function");
    expect(ipetConfig.customParse!(listHtml, 1)).toHaveLength(10);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseIpetList(listHtml.replaceAll('class="sub-table no-bor"', 'class="sub-table-x no-bor"'))).toHaveLength(0);
  });

  it("제목 칸(td.taxt-lt20)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseIpetList(listHtml.replaceAll('class="taxt-lt20"', 'class="taxt-lt20-x"'))).toHaveLength(0);
  });

  it("상세 링크 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseIpetList(listHtml.replaceAll("tbl_id=", "tbl_idx="))).toHaveLength(0);
  });

  it("접수기간 칸이 비면 날짜를 비운다 — 등록일이나 오늘 날짜를 지어내지 않는다", () => {
    const got = parseIpetList(listHtml.replaceAll("<td>2026-04-14 ~ 2026-04-30</td>", "<td></td>"));
    expect(got).toHaveLength(10);
    expect(got[0].dateText).toBe("");
    expect(got[1].dateText).toBe("2026-03-09 ~ 2026-03-18");
  });
});
