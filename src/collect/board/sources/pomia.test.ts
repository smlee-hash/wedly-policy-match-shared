import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { pagingParamsOf } from "../engine";
import { harvestBoardAttachments } from "../detail-fill";
import { safeAttachmentUrl } from "../../attachment-text";
import { isPomiaDropTitle, parsePomiaList, pomiaConfig } from "./pomia";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 기업지원사업 1쪽(`/sub/board_buisness.html`)·상세(`no=135`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/pomia-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/pomia-detail.html"), "utf-8");
const NOW = Date.parse("2026-09-06T00:00:00Z");
const rows = parsePomiaList(listHtml, 1, NOW);

const FIRST = {
  title: "2026년 포항소재산업진흥원 기업지원사업 통합공고",
  detailUrl: "https://pomia.or.kr/sub/board_detail_buisness.html?no=108",
  dateText: "2026-04-09 ~",
  category: "통합지원",
  agency: "포항소재산업진흥원",
} as const;

describe("포항소재산업진흥원 기업지원사업 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 22행(머리줄 제외)에서 거르개·접수마감 제외 뒤 5건이 남고 첫 행이 맞다", () => {
    // 머리줄까지 23 li — 링크가 있는 행만 담는다.
    // 22행 = 거르개 10(교육생 5·평가위원 3·컨설팅 업체 2) + 접수마감 7 → 5건.
    expect(parseHtml(listHtml).querySelectorAll(pomiaConfig.list.rowSelector)).toHaveLength(23);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject(FIRST);
  });

  /** ★접수마감 행은 담지 않는다 — 목록에 마감일이 없어 담으면 90일간 「모집중」이 된다. */
  it("접수현황이 「접수마감」인 행은 빠지고, 접수중·공지만 남는다", () => {
    expect(listHtml).toContain("접수마감");
    // 실측 접수마감 행(no=126 글로벌 철강 미래인재…는 거르개, no=119 리트로핏 시범기업 재공고가 마감)
    expect(rows.some((r) => r.detailUrl.endsWith("no=126"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.endsWith("no=119"))).toBe(false);
    // 상태 칸을 지우면 그 행들이 다시 들어온다 — 그 칸이 실제로 판정에 쓰인다.
    const broken = parsePomiaList(listHtml.replaceAll('class="see2"', 'class="see2-x"'), 1, NOW);
    expect(broken).toHaveLength(12);
  });

  it("머리줄(li.board_header)은 결과에 안 섞인다", () => {
    expect(rows.some((r) => r.title === "제목")).toBe(false);
    expect(rows.every((r) => r.title.length > 4)).toBe(true);
  });

  it("등록일은 p.date 칸에서만 집어 개시형으로 싣는다 — 행 전체면 번호와 붙는다", () => {
    for (const r of rows) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~$/);
    const r = rows.find((x) => x.detailUrl.endsWith("no=135"));
    expect(r?.dateText).toBe("2026-08-31 ~");
    expect(r?.dateText).not.toMatch(/130/);
  });

  it("★상세 주소는 no 만 남긴다 — page·search 를 남기면 같은 글이 쪽마다 다른 줄이 된다", () => {
    // 원문 href 에는 `&page=1&search=&keyword=&scate=` 가 붙어 있다.
    expect(parseHtml(listHtml).querySelector('a[href*="board_detail_buisness.html"]')?.getAttribute("href")).toContain(
      "&page=1",
    );
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/pomia\.or\.kr\/sub\/board_detail_buisness\.html\?no=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]page=/);
      expect(r.detailUrl).not.toMatch(/[?&]scate=/);
    }
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("쪽 주소는 GET page — url(1)·url(2) 가 쪽 변수만 다르고 전체 7쪽이다", () => {
    expect(pomiaConfig.list.url(1)).toBe(
      "https://pomia.or.kr/sub/board_buisness.html?search=&keyword=&scate=&sstatus=&page=1",
    );
    expect(pomiaConfig.list.url(2)).toContain("page=2");
    expect(pagingParamsOf(pomiaConfig)).toEqual(["page"]);
    expect(pomiaConfig.list.maxPages).toBe(7);
  });

  it("분류 칸을 싣고 붙박이 행의 대괄호는 뗀다 — 일반 행과 글자를 맞춘다", () => {
    expect(rows[0].category).toBe("통합지원");
    expect(rows.some((r) => r.category === "사업화지원")).toBe(true);
    expect(rows.every((r) => !/^\[/.test(r.category ?? ""))).toBe(true);
  });
});

describe("포항소재산업진흥원 상세 — 본문·첨부", () => {
  const body = parseHtml(detailHtml)
    .querySelectorAll(pomiaConfig.detailContentSelector!)
    .map((el) => el.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const scoped = parseHtml(detailHtml)
    .querySelectorAll(pomiaConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");
  const atts = harvestBoardAttachments(scoped, pomiaConfig.baseUrl, detailHtml, pomiaConfig.charset);

  it("★본문 상자는 board_detail_con 하나다 — 실측 본문은 공고 이미지뿐이라 글자가 없다", () => {
    expect(parseHtml(detailHtml).querySelectorAll("div.board_detail_con")).toHaveLength(1);
    expect(body).toBe("");
    // 머리(분류·접수상태·작성일)는 본문으로 잡지 않는다 — 잡으면 targetText 가 차서
    // 뒷단계의 「첨부에서 본문 뽑기」가 이 공고를 영영 건너뛴다(cbtp 주석과 같은 갈래).
    const head = (parseHtml(detailHtml).querySelector("div.board_detail_header")?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(head).toContain("작성일 : 2026.08.31");
  });

  it("첨부 2건(공고문·신청서 hwp)이 잡히고 주소가 실제 내려받기 통로다", () => {
    expect(atts).toHaveLength(2);
    expect(atts[0].url).toBe(
      "https://pomia.or.kr/inc/download4.php?fn=1788152032_2538.hwp&dir=board_data7&ext=1" +
        "&fn2=%5B%EA%B3%B5%EA%B3%A0%5D2026%EB%85%84+%EC%9D%B4%EC%B0%A8%EC%A0%84%EC%A7%80+%EC%A0%84%EC%8B%9C%ED%9A%8C" +
        "+%EC%B0%B8%EA%B0%80+%ED%99%8D%EB%B3%B4%EA%B4%80+%EC%9A%B4%EC%98%81%EC%82%AC%EC%97%85+%EC%B0%B8%EC%97%AC%EA%B8%B0%EC%97%85" +
        "+%EB%AA%A8%EC%A7%91%EA%B3%B5%EA%B3%A0_260828.hwp",
    );
    expect(atts[0].name).toBe(
      "[공고]2026년 이차전지 전시회 참가 홍보관 운영사업 참여기업 모집공고_260828.hwp",
    );
    expect(atts[0].kind).toBe("hwp");
    expect(atts[1].name).toContain("참가신청서.hwp");
    for (const a of atts) expect(safeAttachmentUrl(a.url)).not.toBeNull();
  });

  it("첨부 범위를 파일 상자로 못 박아 「목록 보기」 링크가 안 섞인다", () => {
    expect(detailHtml).toContain("board_detail_golist");
    expect(atts.every((a) => !a.url.includes("board_buisness.html"))).toBe(true);
  });
});

describe("거르개 — 기업이 수혜자가 아닌 글만 버린다(교육생·평가위원·수행업체)", () => {
  it("실측 제외 10건이 빠진다", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("교육생"))).toBe(false);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설팅 업체 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("컨설팅업체 모집"))).toBe(false);
    expect(isPomiaDropTitle("2026년 철강산업 실무 맞춤형 취업 역량 강화과정 교육생 모집공고")).toBe(true);
    expect(isPomiaDropTitle("2026년 이차전지 업종전환 수혜기업 선정평가위원 모집 공고")).toBe(true);
    expect(
      isPomiaDropTitle("2026년 지역 이차전지산업 업종전환 지원사업 컨설팅 업체 모집 공고"),
    ).toBe(true);
    expect(isPomiaDropTitle("2026년 철강·금속 디지털전환(DX) 리트로핏 컨설팅업체 모집공고")).toBe(true);
    expect(isPomiaDropTitle("2026년 수행기관 모집 공고")).toBe(true);
  });

  it("기업이 수혜자인 공고는 살린다 — 「컨설팅」·「모집」을 통째로 버리지 않는다", () => {
    expect(rows.some((r) => r.title.includes("참여기업 모집공고"))).toBe(true);
    expect(rows.some((r) => r.title.includes("수혜기업 모집"))).toBe(true);
    expect(
      isPomiaDropTitle("2026년 이차전지 전시회 참가 홍보관 운영사업 참여기업 모집공고"),
    ).toBe(false);
    expect(isPomiaDropTitle("2026년 공공판로 컨설팅 지원사업 참가기업 모집 공고")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 「공지」 붙박이가 빠진다", () => {
    const old = parsePomiaList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.endsWith("no=108"))).toBe(false);
    expect(old).toHaveLength(4);
  });
});

describe("포항소재산업진흥원 설정", () => {
  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(pomiaConfig.id).toBe("pomia");
    expect(pomiaConfig.label).toBe("포항소재산업진흥원");
    expect(pomiaConfig.agency).toBe("포항소재산업진흥원");
    expect(pomiaConfig.region).toBe("경북");
    expect(pomiaConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(pomiaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(pomiaConfig.expectMinRows!);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("목록 껍데기(ul.board_con_wrap)가 바뀌면 한 줄도 못 읽는다", () => {
    expect(parsePomiaList(listHtml.replaceAll("board_con_wrap", "board_con_wrap-x"), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("상세 링크 이름이 바뀌면 한 줄도 못 읽는다 — 헛주소를 지어내지 않는다", () => {
    expect(
      parsePomiaList(listHtml.replaceAll("board_detail_buisness.html", "board_detail_x.html"), 1, NOW),
    ).toHaveLength(0);
  });

  it("제목 칸(p.tit)을 비우면 한 줄도 안 담는다", () => {
    expect(parsePomiaList(listHtml.replaceAll('class="tit"', 'class="tit-x"'), 1, NOW)).toHaveLength(0);
  });
});
