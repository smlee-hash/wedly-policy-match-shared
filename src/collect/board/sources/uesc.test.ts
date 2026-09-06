import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harvestBoardAttachments } from "../detail-fill";
import { fetchBoardAll, pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { isUescDropTitle, parseUescList, uescConfig, uescListUrl, uescTargetOf, uescYmd } from "./uesc";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-06 실측 `bo_table=board_01` 공지사항 1쪽 · 상세 `wr_id=274`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/uesc-list.html"), "utf-8");
const busHtml = readFileSync(join(__dirname, "../__fixtures__/uesc-list-bus04.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/uesc-detail.html"), "utf-8");
const NOW = Date.parse("2026-09-06T00:00:00Z");
const rows = parseUescList(listHtml, 1, NOW);
const busRows = parseUescList(busHtml, 2, NOW);

const FIRST = {
  title: "2026년도 의정부시 우수기업(박람회 · 플리마켓) 참여기업 모집 공고",
  detailUrl: "https://www.uesc.or.kr/bbs/board.php?bo_table=board_01&wr_id=274",
  dateText: "2026-08-14 ~",
  category: "공지사항",
  agency: "의정부시 기업지원센터",
} as const;

describe("의정부시 기업지원센터 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP 을 뺀 12건을 읽고 첫 행의 제목·상세주소·dateText 가 맞다", () => {
    expect(parseHtml(listHtml).querySelectorAll(uescConfig.list.rowSelector)).toHaveLength(15);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("모든 행이 등록일 개시형(YYYY-MM-DD ~)이다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => /[?&]wr_id=\d+$/.test(r.detailUrl))).toBe(true);
  });

  /**
   * ★게시판 둘을 번갈아 읽으면서 생긴 함정을 못 박는다.
   * 엔진은 `url(1)`·`url(2)` 를 견줘 달라지는 변수를 쪽 번호로 보는데, 이 출처는 그 둘이
   * **게시판**으로 갈려서 `bo_table` 을 쪽 번호로 짚는다. `keepPagingParamsInDetail` 을 끄면
   * 저장 직전에 상세 주소에서 `bo_table` 이 지워져 글을 못 여는 주소가 된다.
   */
  it("★`bo_table` 이 쪽 번호로 오인돼 지워지지 않게 막아 뒀다", () => {
    expect(pagingParamsOf(uescConfig)).toEqual(["bo_table"]);
    expect(uescConfig.keepPagingParamsInDetail).toBe(true);
    expect([...rows, ...busRows].every((r) => /[?&]bo_table=(board_01|bus_04)&/.test(r.detailUrl))).toBe(true);
  });

  it("★거울 게시판(bus_01·bus_02)은 주소에 한 번도 안 나온다", () => {
    for (let p = 1; p <= uescConfig.list.maxPages; p += 1) {
      expect(uescConfig.list.url(p), `쪽 ${p}`).not.toMatch(/bus_0[12]|board_job/);
    }
    expect([...rows, ...busRows].every((r) => !/bus_0[12]|board_job/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => r.detailUrl.includes("bo_table=board_01"))).toBe(true);
    expect(busRows.every((r) => r.detailUrl.includes("bo_table=bus_04"))).toBe(true);
  });

  it("★거울 게시판 글이 목록에 섞여 들어와도 담지 않는다 — 게시판을 링크에서 읽는다", () => {
    const planted = listHtml.replace("bo_table=board_01&amp;wr_id=274", "bo_table=bus_01&amp;wr_id=274");
    const out = parseUescList(planted, 1, NOW);
    expect(out.some((r) => r.detailUrl.includes("wr_id=274"))).toBe(false);
    expect(out).toHaveLength(11);
    const planted2 = listHtml.replace("bo_table=board_01&amp;wr_id=273", "bo_table=bus_02&amp;wr_id=273");
    expect(parseUescList(planted2, 1, NOW).some((r) => r.detailUrl.includes("wr_id=273"))).toBe(false);
  });

  it("같은 글번호는 한 번만 담는다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("게시판 둘을 한 쪽씩 번갈아 읽는다 — board_01 · bus_04", () => {
  it("★쪽 번호 → 게시판 사상: 1=board_01 1쪽 · 2=bus_04 1쪽 · 3=board_01 2쪽 · 4=bus_04 2쪽", () => {
    expect(uescTargetOf(1)).toEqual({ code: "board_01", label: "공지사항", page: 1 });
    expect(uescTargetOf(2)).toEqual({ code: "bus_04", label: "의정부시 지원사업", page: 1 });
    expect(uescTargetOf(3)).toEqual({ code: "board_01", label: "공지사항", page: 2 });
    expect(uescTargetOf(4)).toEqual({ code: "bus_04", label: "의정부시 지원사업", page: 2 });
    expect(uescListUrl(2)).toBe("https://www.uesc.or.kr/bbs/board.php?bo_table=bus_04&page=1");
    expect(uescListUrl(3)).toBe("https://www.uesc.or.kr/bbs/board.php?bo_table=board_01&page=2");
  });

  it("bus_04 고정본에서 DROP 6건을 뺀 9건을 읽고 분류가 게시판 이름이다", () => {
    expect(parseHtml(busHtml).querySelectorAll(uescConfig.list.rowSelector)).toHaveLength(15);
    expect(busRows).toHaveLength(9);
    expect(busRows[0]).toMatchObject({
      title: "기업 맞춤형 원스톱 애로 상담 서비스 운영 안내",
      detailUrl: "https://www.uesc.or.kr/bbs/board.php?bo_table=bus_04&wr_id=185",
      dateText: "2026-06-16 ~",
      category: "의정부시 지원사업",
    });
    expect(busRows.every((r) => r.category === "의정부시 지원사업")).toBe(true);
  });

  it("bus_04 의 수요조사·안전 안내·세미나·해커톤이 빠지고 지원사업은 남는다", () => {
    const titles = busRows.map((r) => r.title);
    expect(titles.some((t) => t.includes("수요조사"))).toBe(false);
    expect(titles.some((t) => t.includes("입주의향 조사"))).toBe(false);
    expect(titles.some((t) => t.includes("폭염"))).toBe(false);
    expect(titles.some((t) => t.includes("세미나"))).toBe(false);
    expect(titles.some((t) => t.includes("해커톤"))).toBe(false);
    expect(titles.some((t) => t.includes("2027년 기업환경개선 참여기업 모집공고"))).toBe(true);
    // ★「교육」이 든 지원사업은 살아 있어야 한다.
    expect(titles.some((t) => t.includes("실무교육 참여기업 모집"))).toBe(true);
    expect(titles.some((t) => t.includes("핵심직무교육"))).toBe(true);
  });

  it("★두 게시판을 합쳐도 상세 주소가 겹치지 않는다 — 글번호가 게시판마다 따로 돈다", () => {
    const all = [...rows, ...busRows].map((r) => r.detailUrl);
    expect(new Set(all).size).toBe(all.length);
    // board_01 wr_id=185 와 bus_04 wr_id=185 는 서로 다른 글이다.
    expect(busRows.some((r) => r.detailUrl.endsWith("bo_table=bus_04&wr_id=185"))).toBe(true);
  });

  it("빈 쪽 중단값이 한 바퀴의 두 배다 — 「같은 게시판에서 연속 두 쪽이 빈다」의 뜻", () => {
    expect(uescConfig.emptyStreakStop).toBe(4);
    expect(uescConfig.list.maxPages).toBe(6);
  });

  /**
   * ★설정값만 재지 않고 **엔진을 실제로 돌린다**(2026-09-06 적대 리뷰).
   * 3·4쪽(board_01 2쪽 · bus_04 2쪽)이 빈 쪽이어도 5쪽(board_01 3쪽)의 공고가 들어와야 한다.
   * 중단값이 2 면 3·4쪽에서 끊겨 5쪽을 통째로 잃는다.
   */
  it("★엔진 실제 구동: 3·4쪽이 비어도 5쪽 공고가 수집된다", async () => {
    const EMPTY = '<html><body><div class="Board_list"></div></body></html>';
    const late = listHtml.replace(
      "bo_table=board_01&amp;wr_id=274",
      "bo_table=board_01&amp;wr_id=9001",
    );
    const seenPages: number[] = [];
    const rowsOut = await fetchBoardAll(uescConfig, {
      fetchText: async (url: string) => {
        const page = Number(new URL(url).searchParams.get("page") ?? "1");
        const board = new URL(url).searchParams.get("bo_table") ?? "";
        seenPages.push(page);
        if (board === "board_01" && page === 1) return listHtml;
        if (board === "bus_04" && page === 1) return busHtml;
        if (board === "board_01" && page === 3) return late;
        return EMPTY; // board_01 2쪽 · bus_04 2쪽·3쪽 = 빈 쪽
      },
      prevOpenCount: 0,
      askModel: async () => "",
      onAllFailed: () => {},
    });
    const urls = rowsOut.map((r) => r.url);
    expect(urls.some((u) => u.includes("wr_id=9001")), "5쪽(board_01 3쪽) 공고가 안 들어왔다").toBe(true);
    expect(urls.some((u) => u.includes("bo_table=bus_04"))).toBe(true);
    expect(seenPages.length).toBeGreaterThanOrEqual(5);
  });
});

describe("★연도 없는 목록 날짜 보정 — 12월→1월 경계", () => {
  it("올해로 붙일 수 있으면 올해다", () => {
    expect(uescYmd("08-14", NOW)).toBe("2026-08-14");
    expect(uescYmd("2-26", NOW)).toBe("2026-02-26");
  });

  it("★해를 넘긴 직후 보이는 12월 글은 작년으로 내린다", () => {
    const jan5 = Date.parse("2027-01-05T00:00:00Z");
    expect(uescYmd("12-20", jan5)).toBe("2026-12-20");
    expect(uescYmd("01-03", jan5)).toBe("2027-01-03");
  });

  it("오늘·어제 글은 시차(KST) 때문에 작년으로 밀리지 않는다", () => {
    // 사이트는 KST(+9), 이 판단은 UTC — 여유 2일이 없으면 오늘 글이 작년이 된다.
    const t = Date.parse("2026-09-06T15:00:00Z"); // KST 로는 9/7 자정
    expect(uescYmd("09-07", t)).toBe("2026-09-07");
    expect(uescYmd("09-06", t)).toBe("2026-09-06");
  });

  it("날짜 모양이 아니면 오늘 날짜를 지어내지 않는다", () => {
    expect(uescYmd("", NOW)).toBe("");
    expect(uescYmd("2026-08-14", NOW)).toBe("");
    expect(uescYmd("최고관리자", NOW)).toBe("");
  });
});

describe("상세 — 본문·첨부", () => {
  it("본문 선택자가 공고 전문을 집는다(자체 공고번호가 글자로 들어 있다)", () => {
    const body = parseHtml(detailHtml).querySelector(uescConfig.detailContentSelector!)?.text ?? "";
    expect(body.replace(/\s+/g, "")).toContain("의정부시기업지원센터공고");
    expect(body.length).toBeGreaterThan(500);
  });

  it("첨부 두 건을 상자 안에서만 수확하고 크기 표기 `(88.9K)` 를 이름에서 지운다", () => {
    const scope = parseHtml(detailHtml)
      .querySelectorAll(uescConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(scope).not.toBe("");
    const atts = harvestBoardAttachments(scope, uescConfig.baseUrl, detailHtml, uescConfig.charset);
    expect(atts).toHaveLength(2);
    expect(atts[0].url).toBe(
      "https://www.uesc.or.kr/bbs/download.php?bo_table=board_01&wr_id=274&no=0",
    );
    // ★`B` 없는 크기 표기라 옛 지우개로는 안 지워져 형식이 `etc` 였다 — 지금은 `pdf` 로 잡힌다.
    expect(atts[0].name).toBe("별첨12026 박람회 및 플리마켓 공고문.pdf");
    expect(atts[0].kind).toBe("pdf");
    expect(atts.every((a) => !/\(\s*\d/.test(a.name))).toBe(true);
    expect(atts[1].name).toBe("박람회신청서.zip");
    expect(atts[1].kind).toBe("zip");
    expect(atts[1].url).toBe(
      "https://www.uesc.or.kr/bbs/download.php?bo_table=board_01&wr_id=274&no=1",
    );
  });

  it("★첨부는 상세 세션+Referer 로 받는다 — 안 그러면 200 인데 「잘못된 접근입니다」 HTML 이 온다", () => {
    expect(uescConfig.attachmentSession).toEqual({ warmup: "detail", referer: "detail" });
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("결과 공고(수혜업체 선정·수행업체 선정·선정 기업 안내)가 빠진다", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("최종 수혜업체 선정"))).toBe(false);
    expect(titles.some((t) => t.includes("수행업체 선정"))).toBe(false);
    expect(titles.some((t) => t.includes("선정 기업 안내"))).toBe(false);
    expect(isUescDropTitle("2026년도 영상콘텐츠 제작 지원사업 최종 수혜업체 선정")).toBe(true);
    expect(isUescDropTitle("2026년 기업환경개선(노후간판/후광현판) 지원사업 선정 기업 안내")).toBe(true);
  });

  it("심은 DROP 제목이 실제로 빠진다", () => {
    for (const planted of [
      "2026년 전산장비 입찰 공고",
      "직원 채용 공고",
      "2026년 평가위원 모집",
      "지원사업 합격자 발표",
    ]) {
      const html = listHtml.replace(FIRST.title, planted);
      const out = parseUescList(html, 1, NOW);
      expect(out.some((r) => r.title === planted), planted).toBe(false);
      expect(out, planted).toHaveLength(11);
      expect(isUescDropTitle(planted), planted).toBe(true);
    }
  });

  it("지원사업·수행업체 「모집」은 살린다 — 「선정」이 붙은 것만 버린다", () => {
    expect(rows.some((r) => r.title.includes("수행업체 모집 공고"))).toBe(true);
    expect(rows.some((r) => r.title.includes("기업 환경개선 지원사업"))).toBe(true);
    expect(isUescDropTitle("2026년 기업 영상콘텐츠 제작 지원사업 수행업체 모집 공고")).toBe(false);
    expect(isUescDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
  });
});

describe("의정부시 기업지원센터 설정", () => {
  it("쪽넘김은 GET page — 쪽 번호가 게시판·쪽으로 갈린다", () => {
    expect(uescConfig.list.url(1)).toBe(
      "https://www.uesc.or.kr/bbs/board.php?bo_table=board_01&page=1",
    );
    expect(uescConfig.list.url(3)).toBe(
      "https://www.uesc.or.kr/bbs/board.php?bo_table=board_01&page=2",
    );
    expect(uescConfig.list.maxPages).toBe(6);
  });

  it("이름·지역·추측 끄기", () => {
    expect(uescConfig.id).toBe("uesc");
    expect(uescConfig.region).toBe("경기");
    expect(uescConfig.agency).toBe("의정부시 기업지원센터");
    expect(uescConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(uescConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(uescConfig.expectMinRows).toBe(4);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseUescList(listHtml.replaceAll("Board_item", "Board_item-x"), 1, NOW)).toHaveLength(0);
    expect(parseUescList(busHtml.replaceAll("Board_item", "Board_item-x"), 2, NOW)).toHaveLength(0);
  });

  it("제목 링크 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseUescList(listHtml.replaceAll("board_title", "board_title-x"), 1, NOW)).toHaveLength(0);
  });

  it("날짜 칸을 망가뜨리면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseUescList(listHtml.replace(/<span>(\d\d)-(\d\d)<\/span>/g, "<span>$1/$2</span>"), 1, NOW);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });

  /**
   * ★알려진 한계를 **시험으로 못 박는다**(고쳐진 척하지 않게).
   * 목록이 연도를 안 주므로 오래된 붙박이 공지도 「올해 아니면 작년」로만 추정된다 —
   * 나이가 363일을 못 넘어서 「1년 넘은 붙박이는 버린다」 규칙 자체를 둘 수 없다.
   */
  it("연도 추정의 한계: 오래 붙어 있는 공지도 1년 안쪽 날짜로만 저장된다", () => {
    const oldest = rows.map((r) => Date.parse(`${r.dateText.replace(" ~", "")}T00:00:00Z`));
    expect(Math.max(...oldest.map((t) => NOW - t))).toBeLessThan(365 * 24 * 3600_000);
    // 실측 「2025년 의정부시 우수 기업제품 …」(목록 표기 02-26)이 2026 으로 저장된다 — 못 고치는 자리다.
    const y2025 = rows.find((r) => r.title.startsWith("2025년 의정부시 우수 기업제품"));
    expect(y2025?.dateText).toBe("2026-02-26 ~");
  });
});
