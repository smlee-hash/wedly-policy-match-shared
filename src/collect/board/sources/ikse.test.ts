import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harvestBoardAttachments } from "../detail-fill";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { p2w5AttachmentHref } from "../detail-fill";
import { ikseConfig, ikseYmd, isIkseDropTitle, parseIkseList } from "./ikse";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-06 실측 `bo_id=notice` 공지사항 1쪽 · 상세 `wr_id=2638`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/ikse-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/ikse-detail.html"), "utf-8");
const NOW = Date.parse("2026-09-06T00:00:00Z");
const rows = parseIkseList(listHtml, 1, NOW);
const scoped = () =>
  parseHtml(detailHtml)
    .querySelectorAll(ikseConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");

const FIRST = {
  title: "2026년도 하반기 전북특별자치도 ｢지역형 예비사회적기업 지정｣ 공모",
  detailUrl: "https://www.ikse.or.kr/bbs/board.php?bo_id=notice&wr_id=2638",
  dateText: "2026-08-03 ~",
  category: "사회적경제",
  agency: "익산시 사회적경제지원센터",
} as const;

describe("익산시 사회적경제지원센터 목록 읽기 — 실사이트 고정본", () => {
  it("★`<a>` 가 `<li>` 를 감싸는 비표준 구조에서 16행을 잡고 DROP 뒤 9건이 남는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(ikseConfig.list.rowSelector)).toHaveLength(16);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("모든 행이 등록일 개시형(YYYY-MM-DD ~)이고 분야가 사회적경제로 못 박힌다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    // 대상이 사회적경제조직뿐이라 일반 중소기업 매칭에 섞이면 오추천이 난다.
    expect(rows.every((r) => r.category === "사회적경제")).toBe(true);
  });

  it("두 자리 연도를 편다 — 오늘 날짜를 지어내지 않는다", () => {
    expect(ikseYmd("26-08-26")).toBe("2026-08-26");
    expect(ikseYmd("20-10-26")).toBe("2020-10-26");
    expect(ikseYmd("2026-08-26")).toBe("");
    expect(ikseYmd("")).toBe("");
  });

  it("★제목은 `p.tit0` 칸만 집는다 — 행 전체 글자면 `p.minfo`(조회수)가 따라붙는다", () => {
    expect(rows.every((r) => !r.title.includes("조회"))).toBe(true);
    expect(rows.every((r) => !r.title.includes("관리자"))).toBe(true);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => /[?&]wr_id=\d+$/.test(r.detailUrl))).toBe(true);
    expect(pagingParamsOf(ikseConfig)).toContain("page");
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("상세 — 본문·첨부", () => {
  it("본문 선택자가 공고 글자를 집는다", () => {
    const body = parseHtml(detailHtml).querySelector(ikseConfig.detailContentSelector!)?.text ?? "";
    expect(body).toContain("신청기간");
    expect(body).toContain("사회적기업포털");
  });

  it("★`onclick=\"file_download('…')\"` 안의 주소를 첨부로 살려 낸다 — 갈래가 없으면 0건이다", () => {
    const scope = scoped();
    expect(scope).not.toBe("");
    const atts = harvestBoardAttachments(scope, ikseConfig.baseUrl, detailHtml, ikseConfig.charset);
    expect(atts).toHaveLength(2);
    expect(atts.map((a) => a.url)).toEqual([
      "https://www.ikse.or.kr/bbs/download.php?bo_id=notice&wr_id=2638&no=1",
      "https://www.ikse.or.kr/bbs/download.php?bo_id=notice&wr_id=2638&no=3",
    ]);
    expect(atts[1].name).toBe("260803 공고문 2026년 하반기 예비사회적기업 지정 공고최종.hwpx");
    expect(atts[1].kind).toBe("hwpx");
    // 이름 뒤 크기 표기 「(102.8 KB)」가 지워져 있다.
    expect(atts.every((a) => !a.name.includes("KB"))).toBe(true);
  });

  it("★갈래는 **호스트 한정**이다 — 다른 사이트에서 같은 함수 이름이 나와도 안 걸린다", () => {
    const call = "file_download('https://www.ikse.or.kr/bbs/download.php?bo_id=notice&wr_id=1&no=0')";
    expect(p2w5AttachmentHref(call, "https://www.ikse.or.kr/")).toBe(
      "https://www.ikse.or.kr/bbs/download.php?bo_id=notice&wr_id=1&no=0",
    );
    expect(p2w5AttachmentHref(call, "https://www.example.or.kr/")).toBeNull();
    // 남의 사이트 주소를 인자로 넘겨도 담지 않는다(같은 사이트 울타리).
    expect(p2w5AttachmentHref("file_download('https://evil.test/x.hwp')", "https://www.ikse.or.kr/")).toBeNull();
  });

  it("첨부는 상세 세션+Referer 로 받는다 — 맨손 GET 은 75바이트 alert 스크립트다", () => {
    expect(ikseConfig.attachmentSession).toEqual({ warmup: "detail", referer: "detail" });
  });

  it("상세 본문·첨부 자리가 실측 선택자다", () => {
    expect(ikseConfig.detailContentSelector).toBe("div.view_content");
    expect(ikseConfig.attachmentsScopeSelector).toBe("ul.view_file");
    expect(ikseConfig.detailFetch).toBeUndefined();
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("교육·아카데미·매뉴얼·인턴·결과 공고가 빠진다", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("입문"))).toBe(false);
    expect(titles.some((t) => t.includes("아카데미"))).toBe(false);
    expect(titles.some((t) => t.includes("매뉴얼"))).toBe(false);
    expect(titles.some((t) => t.includes("인턴 모집"))).toBe(false);
    expect(isIkseDropTitle("2026년 마을기업 설립 전(입문) 교육 3차 운영 안내")).toBe(true);
    expect(isIkseDropTitle("2026년 익산시 사회적경제 아카데미 안내")).toBe(true);
    expect(
      isIkseDropTitle("2026년 익산형 사회적기업가 육성사업 추가모집 선정 기업(팀) 공고"),
    ).toBe(true);
  });

  it("심은 DROP 제목이 실제로 빠진다", () => {
    for (const planted of ["2026년 전산장비 입찰 공고", "직원 채용 공고", "2026년 평가위원 모집"]) {
      const html = listHtml.replace(FIRST.title, planted);
      const out = parseIkseList(html, 1, NOW);
      expect(out.some((r) => r.title === planted), planted).toBe(false);
      expect(out, planted).toHaveLength(8);
      expect(isIkseDropTitle(planted), planted).toBe(true);
    }
  });

  it("★`교육` 을 통째로 버리지 않는다 — 교육비를 대 주는 지원사업이 죽으면 안 된다", () => {
    expect(isIkseDropTitle("2026년 생애 최초 경영 안정화 교육지원 사업 모집 공고")).toBe(false);
    expect(isIkseDropTitle("2026년 (예비)사회적기업 도약 지원사업 참여기업 모집")).toBe(false);
    expect(rows.some((r) => r.title.includes("도약 지원사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("창업지원사업 창업팀 모집"))).toBe(true);
  });
});

describe("익산시 사회적경제지원센터 설정", () => {
  it("쪽넘김은 GET page + bo_id=notice", () => {
    expect(ikseConfig.list.url(1)).toBe("https://www.ikse.or.kr/bbs/board.php?bo_id=notice&page=1");
    expect(ikseConfig.list.url(2)).toBe("https://www.ikse.or.kr/bbs/board.php?bo_id=notice&page=2");
    expect(ikseConfig.list.maxPages).toBe(3);
  });

  it("이름·지역·추측 끄기·서식 변경 감지", () => {
    expect(ikseConfig.id).toBe("ikse");
    expect(ikseConfig.region).toBe("전북");
    expect(ikseConfig.skipHeuristic).toBe(true);
    expect(ikseConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(ikseConfig.expectMinRows).toBe(4);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("목록 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseIkseList(listHtml.replaceAll("content_wrap", "content_wrap-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseIkseList(listHtml.replaceAll('class="tit0"', 'class="tit0-x"'), 1, NOW)).toHaveLength(0);
  });

  it("날짜 칸 이름이 바뀌면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseIkseList(listHtml.replaceAll('class="date"', 'class="date-x"'), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });

  it("★1년 넘은 붙박이 공지는 담지 않는다 — 거르개가 없어도 나이로 걸린다", () => {
    // 실측 붙박이 `wr_id=1102`(20-10-26)는 「매뉴얼」 거르개에도 걸린다. 그 글자를 지워도 빠져야 한다.
    const html = listHtml.replace(
      "[안내] 사회적기업가를 위한 창업상담매뉴얼을 공개합니다!",
      "2020년 사회적기업 지원사업 모집 공고",
    );
    const out = parseIkseList(html, 1, NOW);
    expect(isIkseDropTitle("2020년 사회적기업 지원사업 모집 공고")).toBe(false);
    expect(out.some((r) => r.detailUrl.includes("wr_id=1102"))).toBe(false);
    expect(out).toHaveLength(9);
  });

  it("첨부 함수 이름이 바뀌면 첨부를 지어내지 않는다", () => {
    const html = detailHtml.replaceAll("file_download(", "file_download_x(");
    const scope = parseHtml(html)
      .querySelectorAll(ikseConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(harvestBoardAttachments(scope, ikseConfig.baseUrl, html, ikseConfig.charset)).toHaveLength(0);
  });
});
