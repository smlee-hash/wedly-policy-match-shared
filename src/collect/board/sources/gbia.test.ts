import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { pagingParamsOf } from "../engine";
import { harvestBoardAttachments } from "../detail-fill";
import { safeAttachmentUrl } from "../../attachment-text";
import { gbiaConfig, gbiaYmd, isGbiaDropTitle, parseGbiaList } from "./gbia";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 사업공고 1쪽(`bo_table=business`)·상세(`wr_id=904`).
 * 고정본은 **받은 바이트 그대로**다(사이트가 utf-8 로 내려 준다).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gbia-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/gbia-detail.html"), "utf-8");
const NOW = Date.parse("2026-09-06T00:00:00Z");
const rows = parseGbiaList(listHtml, 1, NOW);

const FIRST = {
  title: "2026년 김해시 청년도전지원사업 단기 프로그램 참여자 모집 공고",
  detailUrl: "https://gbia.or.kr/bbs/board.php?bo_table=business&wr_id=904",
  dateText: "2026-09-02 ~",
  agency: "김해의생명산업진흥원",
} as const;

describe("김해의생명산업진흥원 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 15행을 전부 읽고 첫 행이 맞다", () => {
    expect(parseHtml(listHtml).querySelectorAll(gbiaConfig.list.rowSelector)).toHaveLength(15);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("★목록 날짜는 월-일뿐이다 — 수집 시각의 해를 메워 개시형으로 싣는다", () => {
    // 원문 칸이 `09-02` 다(연도 없음).
    expect((parseHtml(listHtml).querySelector("td.td_date")?.text ?? "").trim()).toBe("09-02");
    for (const r of rows) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~$/);
    expect(rows[0].dateText).toBe("2026-09-02 ~");
    // 오늘(9/6)보다 뒤 날짜면 지난해 글이다 — 등록일은 미래일 수 없다.
    expect(gbiaYmd("09-02", NOW)).toBe("2026-09-02");
    expect(gbiaYmd("09-06", NOW)).toBe("2026-09-06");
    expect(gbiaYmd("09-07", NOW)).toBe("2025-09-07");
    expect(gbiaYmd("12-31", NOW)).toBe("2025-12-31");
    // 달력에 없는 날짜는 지어내지 않는다.
    expect(gbiaYmd("02-29", NOW)).toBe("");
    expect(gbiaYmd("", NOW)).toBe("");
    expect(gbiaYmd("2026-09-02", NOW)).toBe("");
  });

  it("날짜는 td.td_date 칸에서만 집는다 — 행 전체 글자면 번호와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("wr_id=904"));
    expect(r?.dateText).toBe("2026-09-02 ~");
    expect(r?.dateText).not.toMatch(/817/);
  });

  it("★상세 주소는 wr_id 로 조립한다 — 쪽 번호가 안 섞인다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/gbia\.or\.kr\/bbs\/board\.php\?bo_table=business&wr_id=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]page=/);
    }
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("쪽 주소는 GET page — url(1)·url(2) 가 쪽 변수만 다르다", () => {
    expect(gbiaConfig.list.url(1)).toBe("https://gbia.or.kr/bbs/board.php?bo_table=business&page=1");
    expect(gbiaConfig.list.url(2)).toContain("page=2");
    expect(pagingParamsOf(gbiaConfig)).toEqual(["page"]);
    expect(gbiaConfig.list.maxPages).toBe(5);
  });
});

describe("김해의생명산업진흥원 상세 — 본문·첨부", () => {
  const body = parseHtml(detailHtml)
    .querySelectorAll(gbiaConfig.detailContentSelector!)
    .map((el) => el.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const scoped = parseHtml(detailHtml)
    .querySelectorAll(gbiaConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");
  const atts = harvestBoardAttachments(scoped, gbiaConfig.baseUrl, detailHtml, gbiaConfig.charset);

  it("본문 상자(#bo_v_con)에서 공고 글자를 읽는다", () => {
    expect(body).toContain("김해의생명산업진흥원 공고 제2026- 172호");
    expect(body).toContain("『단기 프로그램』참여자 모집 공고");
  });

  it("첨부 1건의 주소가 그누보드 download.php 다", () => {
    expect(atts).toHaveLength(1);
    expect(atts[0].url).toBe("https://gbia.or.kr/bbs/download.php?bo_table=business&wr_id=904&no=0");
    expect(atts[0].name).toContain("『단기 프로그램』참여자 모집 공고.pdf");
    expect(safeAttachmentUrl(atts[0].url)).not.toBeNull();
  });

  it("첨부 범위를 게시글 껍데기로 못 박아 사이드 링크가 안 섞인다", () => {
    // `#quick` 의 엑셀 링크(`/img/common/fmsite/product_list.xlsx`)는 article 밖이라 안 들어온다.
    expect(detailHtml).toContain("product_list.xlsx");
    expect(atts.every((a) => !a.url.includes("product_list.xlsx"))).toBe(true);
  });

  /**
   * ★첨부는 상세 세션 쿠키가 있어야 내려온다(2026-09-06 curl 실측 wr_id=904&no=0):
   * 그냥 GET 하면 200 + text/html 3,829바이트(그누보드 중간 페이지), 상세를 먼저 받아
   * 쿠키를 실으면 200 + `content-disposition: attachment` + PDF 173,015바이트.
   */
  it("첨부 세션(상세 데우기 + Referer)이 켜져 있다 — 없으면 200 짜리 안내 화면만 받는다", () => {
    expect(gbiaConfig.attachmentSession).toEqual({ warmup: "detail", referer: "detail" });
  });
});

describe("거르개 — 버릴 것만 지정한다(채용·입찰)", () => {
  it("고정본 15건에는 한 줄도 안 걸린다 — 채용·입찰이 다른 판이기 때문", () => {
    expect(rows).toHaveLength(15);
  });

  it("심어 넣은 채용·입찰 제목은 빠진다", () => {
    const cases = ["2026년 계약직 채용 공고", "전산장비 구매 입찰 공고", "용역 공고 안내"];
    for (const planted of cases) {
      const html = listHtml.replace(
        "2026년 김해시 청년도전지원사업 단기 프로그램 참여자 모집 공고",
        planted,
      );
      const out = parseGbiaList(html, 1, NOW);
      expect(out.some((r) => r.title === planted), planted).toBe(false);
      expect(out, planted).toHaveLength(14);
      expect(isGbiaDropTitle(planted), planted).toBe(true);
    }
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isGbiaDropTitle("2026년 청년 신규채용 인건비 지원사업 참여기업 모집")).toBe(false);
    expect(rows.some((r) => r.title.includes("입주기업 모집공고"))).toBe(true);
    expect(rows.some((r) => r.title.includes("해외지사화 지원사업"))).toBe(true);
    expect(isGbiaDropTitle("김해지식산업센터 입주기업 모집공고")).toBe(false);
  });
});

describe("김해의생명산업진흥원 설정", () => {
  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(gbiaConfig.id).toBe("gbia");
    expect(gbiaConfig.label).toBe("김해의생명산업진흥원");
    expect(gbiaConfig.agency).toBe("김해의생명산업진흥원");
    expect(gbiaConfig.region).toBe("경남");
    // ★페이지 글자표는 utf-8 이다 — euc-kr 로 적으면 목록 한글이 통째로 깨진다.
    //  EUC-KR 인 것은 응답 헤더의 첨부 파일 이름뿐이고, 저장 이름은 링크 글자에서 온다.
    expect(gbiaConfig.charset).toBe("utf-8");
    expect(listHtml).toContain('<meta charset="utf-8">');
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gbiaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(gbiaConfig.expectMinRows!);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("목록 껍데기(#bo_list)가 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGbiaList(listHtml.replaceAll('id="bo_list"', 'id="bo_list-x"'), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td_subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGbiaList(listHtml.replaceAll("td_subject", "td_subject-x"), 1, NOW)).toHaveLength(0);
  });

  it("날짜 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseGbiaList(listHtml.replaceAll("td_date", "td_date-x"), 1, NOW);
    expect(broken).toHaveLength(15);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
