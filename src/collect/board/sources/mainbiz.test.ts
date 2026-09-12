import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { pagingParamsOf } from "../engine";
import { harvestBoardAttachments } from "../detail-fill";
import { parseApplyPeriod } from "../../../engine/types";
import { safeAttachmentUrl } from "../../attachment-text";
import { isMainbizDropTitle, mainbizConfig, parseMainbizList, parseMainbizValidationList } from "./mainbiz";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 중소기업지원정보 1쪽(`company.asp?smem=2&gbn=2`)·상세(`bidx=5906`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/mainbiz-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/mainbiz-detail.html"), "utf-8");
const NOW = Date.parse("2026-09-06T00:00:00Z");
const rows = parseMainbizList(listHtml, 1, NOW);
const raw = parseMainbizValidationList(listHtml, 1);

const FIRST = {
  title: "[월드옥타] 2026 수출컨소시엄 부스기업 모집",
  detailUrl: "https://www.mainbiz.or.kr/notice/company.asp?bidx=5906&gbn=2&smem=2&bgbn=V",
  dateText: "2026-09-04 ~",
  agency: "메인비즈협회",
} as const;

describe("메인비즈협회 중소기업지원정보 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 10행에서 거르개·종료 제외 뒤 2건이 남고 첫 행이 맞다", () => {
    // 10행 = 거르개 7(포럼·대회개최·과정안내·예산안·보러가기·기부모금·멘티모집) + 종료 1(규제예보) → 2건.
    expect(parseHtml(listHtml).querySelectorAll(mainbizConfig.list.rowSelector)).toHaveLength(10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("★새 글 딱지 <em class=new_mark>N</em> 이 제목에 붙지 않는다 — 붙으면 dedupKey 가 갈린다", () => {
    expect(rows.every((r) => !/N$/.test(r.title))).toBe(true);
    expect(rows[0].title).toBe("[월드옥타] 2026 수출컨소시엄 부스기업 모집");
  });

  it("등록일은 td.date 칸에서만 집어 개시형(YYYY-MM-DD ~)으로 싣는다 — 행 전체면 번호와 붙는다", () => {
    for (const r of rows) expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~$/);
    const r = rows.find((x) => x.detailUrl.includes("bidx=5900"));
    expect(r?.dateText).toBe("2026-09-01 ~");
    expect(r?.dateText).not.toMatch(/455|459/);
  });

  it("★상세 주소는 bidx 로 조립한다 — href 를 그대로 쓰면 파서가 &GT 를 > 로 풀어 주소가 깨진다", () => {
    // 원문 href 는 `…&SFIELD=&GTXT=&gbn=2…` 인데 getAttribute 는 `…&SFIELD=>XT=&gbn=2…` 를 준다.
    const raw = parseHtml(listHtml).querySelector("td.tit a")?.getAttribute("href") ?? "";
    expect(raw).toContain(">XT=");
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.mainbiz\.or\.kr\/notice\/company\.asp\?bidx=\d+&gbn=2&smem=2&bgbn=V$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]page=/);
      expect(r.detailUrl).not.toContain(">XT");
    }
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("거르개 전 원본은 1쪽 10행 전부이고 종료·거르개 대상도 등록일을 남긴다", () => {
    expect(raw).toHaveLength(10);
    expect(raw.some((r) => r.detailUrl.includes("bidx=5902"))).toBe(true);
    expect(raw.some((r) => r.title.includes("예산안"))).toBe(true);
    expect(raw.every((r) => !/N$/.test(r.title))).toBe(true);
    expect(raw.every((r) => /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(
      raw.every((r) =>
        /^https:\/\/www\.mainbiz\.or\.kr\/notice\/company\.asp\?bidx=\d+&gbn=2&smem=2&bgbn=V$/.test(
          r.detailUrl,
        ),
      ),
    ).toBe(true);
    expect(raw.every((r) => !r.detailUrl.includes("page="))).toBe(true);
    expect(new Set(raw.map((r) => r.detailUrl)).size).toBe(raw.length);
    expect(mainbizConfig.validationParse?.(listHtml, 1)).toEqual(raw);
  });

  it("쪽 주소는 GET page — url(1)·url(2) 가 쪽 변수만 다르다", () => {
    // 빈 검색조건(cur_pack·SFIELD·GTXT·bcate·date_ing)은 HTTP 500. 판 선택 gbn=2&smem=2 와 쪽만 보낸다.
    expect(mainbizConfig.list.url(1)).toBe(
      "https://www.mainbiz.or.kr/notice/company.asp?page=1&gbn=2&smem=2",
    );
    expect(mainbizConfig.list.url(2)).toBe(
      "https://www.mainbiz.or.kr/notice/company.asp?page=2&gbn=2&smem=2",
    );
    expect(mainbizConfig.list.url(1).replace("page=1", "page=2")).toBe(mainbizConfig.list.url(2));
    expect(mainbizConfig.list.url(1)).not.toMatch(/cur_pack|SFIELD|GTXT|bcate|date_ing/);
    expect(pagingParamsOf(mainbizConfig)).toEqual(["page"]);
    expect(mainbizConfig.list.maxPages).toBe(5);
  });
});

describe("메인비즈협회 상세 — 본문·첨부", () => {
  const body = parseHtml(detailHtml)
    .querySelectorAll(mainbizConfig.detailContentSelector!)
    .map((el) => el.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const scoped = parseHtml(detailHtml)
    .querySelectorAll(mainbizConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");

  it("★본문 상자는 board_view_con 하나다 — 머리를 넣으면 첨부에서 본문 뽑기가 막힌다", () => {
    // 실측 bidx=5906 본문은 공고 이미지 7장뿐이라 글자가 없다.
    expect(parseHtml(detailHtml).querySelectorAll("div.board_view_con")).toHaveLength(1);
    expect(body).toBe("");
    // 머리(board_view_top)를 본문으로 잡으면 「작성일 : … 기간 : …」이 targetText 를 채워
    // 뒷단계(`targetText === ""` 조건)가 첨부를 영영 안 읽는다 — 그래서 안 잡는다.
    const head = (parseHtml(detailHtml).querySelector("div.board_view_top")?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(head).toContain("기간 : 2026-09-04 ~ 2026-09-09");
  });

  it("첨부 상자(board_view_file)에 hwp 링크 1건이 있다", () => {
    expect(scoped).toContain("/lib/file_down_new.asp?filename=");
    expect(
      parseHtml(detailHtml).querySelectorAll("div.board_view_file div.file_each a"),
    ).toHaveLength(1);
  });

  /**
   * ★공용 수확기의 **메인비즈 갈래**로 건져 온다(2026-09-06 신설 — `mainbizAttachmentName`).
   * 주소가 `/lib/file_down_new.asp?filename=…%2Ehwp&furl=16` 라
   * · `FILE_HREF`(주소 끝 `.hwp`) → 확장자가 퍼센트 인코딩(`%2Ehwp`)이라 안 걸리고
   * · `/download/i` → 글자가 `file_down_new` 라 안 걸린다.
   * 그래서 이 게시판은 첨부가 한 건도 안 잡혔다(본문은 공고 이미지뿐이라 조건이 영영 0개였다).
   */
  it("★첨부 1건을 건져 온다 — 이름은 filename 값, 주소는 원문 인코딩 그대로", () => {
    const atts = harvestBoardAttachments(scoped, mainbizConfig.baseUrl, detailHtml, mainbizConfig.charset);
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe("[WORLD-OKTA] 2026 수출컨소시엄 부스기업모집 안내문1.hwp");
    expect(atts[0].kind).toBe("hwp");
    // 조사에서 실제로 2,184,192바이트 hwp 를 받은 그 주소다(퍼센트·+ 를 재해석하지 않는다).
    expect(atts[0].url).toBe(
      "https://www.mainbiz.or.kr/lib/file_down_new.asp?filename=" +
        "%5BWORLD%2DOKTA%5D+2026+%EC%88%98%EC%B6%9C%EC%BB%A8%EC%86%8C%EC%8B%9C%EC%97%84+" +
        "%EB%B6%80%EC%8A%A4%EA%B8%B0%EC%97%85%EB%AA%A8%EC%A7%91+%EC%95%88%EB%82%B4%EB%AC%B81%2Ehwp&furl=16",
    );
    expect(safeAttachmentUrl(atts[0].url)).not.toBeNull();
  });
});

describe("메인비즈협회 접수기간 — 상세 「기간」 칸", () => {
  /**
   * 엔진 옵션 `detailApplyPeriod` 로 배선했다(2026-09-06). 목록은 등록일 개시형으로 담고,
   * 상세를 여는 자리에서 기간 칸이 applyStart·applyEnd·status 를 덮는다
   * (배선 동작 시험은 `board/detail-fill.test.ts` 의 「detailApplyPeriod」 묶음).
   */
  it("목록은 등록일 개시형으로 담고, 기간 칸은 상세에서 덮는다", () => {
    expect(rows[0].dateText).toBe("2026-09-04 ~");
    expect(rows[0].dateText).not.toContain("2026-09-09");
    expect(mainbizConfig.detailApplyPeriod?.selector).toBe("div.board_view_top div.info span.each");
    // ★strip 이 울타리다 — 이 정규식에 걸리는 조각만 기간으로 본다.
    expect(mainbizConfig.detailApplyPeriod?.strip?.test("기간 : 2026-09-04 ~ 2026-09-09")).toBe(true);
    expect(mainbizConfig.detailApplyPeriod?.strip?.test("작성일 : 2026.09.04")).toBe(false);
    expect(mainbizConfig.detailApplyPeriod?.strip?.test("진행상태 : 진행중")).toBe(false);
    // 고정본 상세에 그 칸이 실제로 있다.
    expect(detailHtml).toContain("기간 : <span style='color:blue;'>2026-09-04 ~ 2026-09-09</span>");
  });
});

describe("목록 접수상태 — 「종료」는 담지 않는다", () => {
  it("종료 행(규제예보)이 빠지고 진행중·진행예정만 남는다", () => {
    expect(rows.some((r) => r.detailUrl.includes("bidx=5902"))).toBe(false);
    expect(listHtml).toContain(">종료</td>");
    // 「진행예정」은 담는다 — 곧 열리는 공고다(고정본 455 = 세계한상대회, 거르개로 따로 빠진다).
    const kept = parseMainbizList(
      listHtml.replace("제24차 세계한상대회 개최 안내", "2026년 참여기업 사전 모집"),
      1,
      NOW,
    );
    expect(kept.some((r) => r.detailUrl.includes("bidx=5729"))).toBe(true);
    expect(kept).toHaveLength(3);
  });
});

describe("거르개 — 버릴 것만 지정한다(포상·설문·교육·행사)", () => {
  it("실측 제외가 빠진다 — 포럼·대회 개최 안내·과정 안내", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("물류&모빌리티 포럼"))).toBe(false);
    expect(titles.some((t) => t.includes("세계한상대회 개최 안내"))).toBe(false);
    expect(titles.some((t) => t.includes("미래전략 과정 안내"))).toBe(false);
    expect(isMainbizDropTitle("[메트로경제] 2026 물류&모빌리티 포럼(9/16 개최)")).toBe(true);
    expect(isMainbizDropTitle("[세계한상위원회] 제24차 세계한상대회 개최 안내")).toBe(true);
    expect(isMainbizDropTitle("[KAIST] 2026년도 글로벌 공공조달 미래전략 과정 안내")).toBe(true);
    expect(isMainbizDropTitle("2026년 납품대금 연동 우수기업 포상 공고")).toBe(true);
    expect(isMainbizDropTitle("디자인권 침해 실태 관련 설문조사 안내")).toBe(true);
  });

  it("공고가 아닌 글 4유형도 뺀다 — 보도자료·보러가기·모금 안내·멘티 모집", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("예산안"))).toBe(false);
    expect(titles.some((t) => t.includes("보러가기"))).toBe(false);
    expect(titles.some((t) => t.includes("고향사랑기부제"))).toBe(false);
    expect(titles.some((t) => t.includes("멘토 스쿨"))).toBe(false);
    expect(isMainbizDropTitle("[중기부] ‘27년 예산안 18조 724억 원으로 역대 최대 규모")).toBe(true);
    expect(isMainbizDropTitle("[중기부] 모두의 창업 2차 종합편 보러가기")).toBe(true);
    expect(isMainbizDropTitle("[통영시] 통영시 집중호우 피해 복구를 위한 고향사랑기부제 모금 안내")).toBe(true);
    expect(isMainbizDropTitle("[전자신문] 2세 경영인과 청년 기업가를 위한 멘토 스쿨 멘티 모집")).toBe(true);
    // ★「예산」을 통째로 버리지 않는다 — 「예산 소진 시까지」가 지원사업 제목에 흔하다.
    expect(isMainbizDropTitle("2026년 소상공인 지원사업(예산 소진 시까지)")).toBe(false);
  });

  it("기업 대상 모집은 살린다 — 「모집」·「공모」를 통째로 버리지 않는다", () => {
    expect(rows.some((r) => r.title.includes("수출컨소시엄 부스기업 모집"))).toBe(true);
    expect(rows.some((r) => r.title.includes("통합 품평회 모집 안내"))).toBe(true);
    expect(isMainbizDropTitle("[월드옥타] 2026 수출컨소시엄 부스기업 모집")).toBe(false);
    expect(isMainbizDropTitle("[중소기업중앙회] 2026년 하반기 온오프라인 통합 품평회 모집 안내")).toBe(
      false,
    );
    expect(isMainbizDropTitle("2026년 중소기업 기술경진대회 참가기업 모집 공고")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("기준 시각을 2030년으로 옮기면 「주요」 붙박이가 전부 빠진다", () => {
    const old = parseMainbizList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.includes("bidx=5906"))).toBe(false);
    // 남아 있던 2건이 전부 붙박이(`주요`)라 한 줄도 안 남는다.
    expect(old).toHaveLength(0);
  });
});

describe("메인비즈협회 설정", () => {
  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(mainbizConfig.id).toBe("mainbiz");
    expect(mainbizConfig.label).toBe("메인비즈협회");
    expect(mainbizConfig.agency).toBe("메인비즈협회");
    expect(mainbizConfig.region).toBe("전국");
    // 고정본 머리글이 `<meta charset="UTF-8">` 이다.
    expect(mainbizConfig.charset).toBe("utf-8");
    expect(mainbizConfig.baseUrl).toBe("https://www.mainbiz.or.kr/");
  });

  it("서식 변경 감지가 살아 있다 — 최소 행은 거르개 전 원본에 적용한다", () => {
    expect(mainbizConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(raw.length).toBeGreaterThanOrEqual(mainbizConfig.expectMinRows!);
    expect(typeof mainbizConfig.validationParse).toBe("function");
    // 빈 검색조건은 HTTP 500. c520cd3 목록 주소(판 선택+쪽만)를 유지한다.
    expect(mainbizConfig.list.url(1)).toBe(
      "https://www.mainbiz.or.kr/notice/company.asp?page=1&gbn=2&smem=2",
    );
  });

  it("추측 단계를 끈다 — href 의 &GT 가 > 로 풀려 깨진 주소가 저장된다", () => {
    expect(mainbizConfig.skipHeuristic).toBe(true);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("표 껍데기 이름(board_list)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseMainbizList(listHtml.replaceAll("board_list", "board_list-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.tit)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseMainbizList(listHtml.replaceAll('class="tit"', 'class="tit-x"'), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("등록일 칸을 비우면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseMainbizList(listHtml.replaceAll('class="date"', 'class="date-x"'), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
    const brokenRaw = parseMainbizValidationList(
      listHtml.replaceAll('class="date"', 'class="date-x"'),
      1,
    );
    expect(brokenRaw).toHaveLength(10);
    expect(brokenRaw.every((r) => r.dateText === "")).toBe(true);
  });

  it("상태 칸(td.sort)이 사라지면 종료 행이 다시 들어온다 — 그 칸이 실제로 판정에 쓰인다", () => {
    const broken = parseMainbizList(listHtml.replaceAll('class="sort"', 'class="sort-x"'), 1, NOW);
    expect(broken.some((r) => r.detailUrl.includes("bidx=5902"))).toBe(true);
    expect(broken).toHaveLength(3);
  });
});
