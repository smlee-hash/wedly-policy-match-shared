import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchBoardAll } from "../engine";
import { ansanConfig, ansanTargetOf, isAnsanDropTitle, parseAnsanList, isAnsanRescued } from "./ansan";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다(창원 사고).
 * 고정본: 2026-09-03 실측 안산시 고시/공고(WWW13) 담당부서=기업지원과 1·2쪽
 *         (`selectPageListBbs.do?bbs_code=WWW13&sch_type=departSearch&sch_text=기업지원과&currentPage=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/ansan-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/ansan-list-p2.html"), "utf-8");
/** 2026-09-03 실측 — 나머지 세 부서의 1쪽. */
const sosangHtml = readFileSync(join(__dirname, "../__fixtures__/ansan-sosang-list.html"), "utf-8");
const nodongHtml = readFileSync(join(__dirname, "../__fixtures__/ansan-nodong-list.html"), "utf-8");
const sanupHtml = readFileSync(join(__dirname, "../__fixtures__/ansan-sanup-list.html"), "utf-8");
const rows = parseAnsanList(listHtml);
const rowsP2 = parseAnsanList(listP2Html, 2);
const combined = parseAnsanList(listHtml + listP2Html);

describe("안산시 기업지원 공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 15줄에서 DROP 6줄을 뺀 9건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "2026년 안산시 동남아 해외시장개척단 참가기업 모집 공고",
      detailUrl:
        "https://www.ansan.go.kr/www/common/bbs/selectBbsDetail.do?bbs_code=WWW13&bbs_seq=1681706",
      dateText: "2026-09-02 ~",
      agency: "안산시",
      category: "기업지원과",
    });
  });

  it("2쪽 고정본은 DROP 5줄을 뺀 10건이고 첫 행이 맞다", () => {
    expect(rowsP2).toHaveLength(10);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 해외전시회 참가기업 지원사업 모집공고",
      detailUrl:
        "https://www.ansan.go.kr/www/common/bbs/selectBbsDetail.do?bbs_code=WWW13&bbs_seq=1667024",
      dateText: "2026-03-20 ~",
    });
  });

  it("제목 안의 겹친 공백을 한 칸으로 접는다 — 「일본 FIW  안산시」", () => {
    expect(rows.some((r) => r.title === "2026년도 일본 FIW 안산시 참관단 참여기업 모집 공고")).toBe(true);
  });

  it("★상세 주소에 쪽 번호(currentPage)·검색어를 넣지 않는다 — 쪽마다 다른 줄로 저장된다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.ansan\.go\.kr\/www\/common\/bbs\/selectBbsDetail\.do\?bbs_code=WWW13&bbs_seq=\d+$/,
      );
      expect(r.detailUrl).not.toContain("currentPage");
      expect(r.detailUrl).not.toContain("sch_text");
    }
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없고 19건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(19);
  });

  it("★날짜는 작성일 칸에서만 집는다 — 행 전체 글자면 번호 칸과 「841681706…」처럼 붙는다", () => {
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
    const first = combined.find((r) => r.detailUrl.endsWith("bbs_seq=1681706"));
    expect(first?.dateText).toBe("2026-09-02 ~");
    expect(first?.dateText).not.toMatch(/84/);
  });

  it("등록일만 있는 게시판이라 개시형(`~` 꼬리)으로 넘긴다 — 마감형으로 저장되면 즉시 마감된다", () => {
    expect(rows.every((r) => r.dateText.endsWith(" ~"))).toBe(true);
  });
});

describe("지원사업이 아닌 글 거르기 — 좁게만", () => {
  it("실측 DROP 제목이 실제로 빠진다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("공시송달"))).toBe(false);
    expect(titles.some((t) => t.includes("행정대집행"))).toBe(false);
    expect(titles.some((t) => t.includes("이행강제금"))).toBe(false);
    expect(titles.some((t) => t.includes("행정예고"))).toBe(false);
    expect(titles.some((t) => t.includes("계량기 정기검사"))).toBe(false);
    expect(titles.some((t) => t.includes("기간제근로자"))).toBe(false);
  });

  it("거르개를 제목 글자만으로 재도 같은 판정이다", () => {
    expect(isAnsanDropTitle("국토의 계획 및 이용에 관한 법률, 건축법 위반 처분 사전통지 공시송달")).toBe(true);
    expect(isAnsanDropTitle("행정대집행 보관물품 및 보관장소 공고")).toBe(true);
    // 「공시 송달」처럼 띄어 쓴 실측 제목도 잡아야 한다(2쪽 57번).
    expect(isAnsanDropTitle("건축법 위반사항 이행강제금 부과계고 공시 송달")).toBe(true);
    expect(isAnsanDropTitle("기업지원과 자재보관소CCTV 추가설치에 따른 행정예고")).toBe(true);
    expect(isAnsanDropTitle("2026년도 안산스마트허브 내 계량기 정기검사 실시 공고")).toBe(true);
    expect(isAnsanDropTitle("2026년 안산스마트허브 내 계량기 정기검사 기간제근로자 공개모집 공고")).toBe(true);
  });

  it("★「채용」을 통째로 버리지 않는다 — 채용 지원사업이 함께 죽는다", () => {
    expect(isAnsanDropTitle("2026년 청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isAnsanDropTitle("2026년 기간제근로자 채용 공고")).toBe(true);
  });

  it("지원사업 제목은 하나도 안 버린다 — 거르개가 넓어지면 여기서 걸린다", () => {
    for (const t of [
      "2026년 안산시 동남아 해외시장개척단 참가기업 모집 공고",
      "2027년 기업환경 개선사업 모집 공고",
      "제29회『안산시 중소기업대상』시상 계획 공고",
      "2026년도 안산시 중소기업육성자금 융자지원 공고",
      "2026년 중소기업 노동자 기숙사 임차비 지원사업 참여기업 모집 공고",
    ]) {
      expect(isAnsanDropTitle(t)).toBe(false);
    }
  });
});

describe("붙박이 공지 — 번호 칸이 「공지」인 줄", () => {
  // 고정본(부서 필터)에는 붙박이가 없다. 규칙이 실제로 도는지 보려고 첫 줄의 번호 칸을 「공지」로 바꿔 심는다.
  const planted = listHtml.replace("<td >\n84\n</td>", "<td >\n공지\n</td>");

  it("심은 붙박이는 등록일을 개시일로 넘기지 않는다 — 저장 즉시 마감되는 걸 막는다", () => {
    const r = parseAnsanList(planted).find((x) => x.detailUrl.endsWith("bbs_seq=1681706"));
    expect(r?.dateText).toBe("");
  });

  it("1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 되살아난다", () => {
    const old = parseAnsanList(planted, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((x) => x.detailUrl.endsWith("bbs_seq=1681706"))).toBe(false);
    expect(old).toHaveLength(8);
  });

  it("일반 행은 이 규칙에 안 걸린다 — 전부를 비우면 게시판이 죽는다", () => {
    const old = parseAnsanList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old).toHaveLength(9);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });
});

describe("안산시 설정", () => {
  it("쪽넘김은 GET currentPage + 담당부서 필터 — 같은 부서 2쪽은 5쪽 자리다", () => {
    expect(ansanConfig.list.url(1)).toBe(
      "https://www.ansan.go.kr/www/common/bbs/selectPageListBbs.do?bbs_code=WWW13&sch_type=departSearch&sch_text=%EA%B8%B0%EC%97%85%EC%A7%80%EC%9B%90%EA%B3%BC&currentPage=1",
    );
    // 부서를 한 쪽씩 돌아가며 읽으므로 기업지원과 2쪽은 엔진 5쪽이다.
    expect(ansanConfig.list.url(5)).toBe(
      "https://www.ansan.go.kr/www/common/bbs/selectPageListBbs.do?bbs_code=WWW13&sch_type=departSearch&sch_text=%EA%B8%B0%EC%97%85%EC%A7%80%EC%9B%90%EA%B3%BC&currentPage=2",
    );
  });

  /**
   * ★한 쪽씩 돌리면 `url(1)`·`url(2)` 는 부서명만 다르고 쪽 번호가 둘 다 1 이라, 엔진의
   * 쪽 번호 찾기가 부서명(`sch_text`)을 쪽 변수로 볼 수 있다. 그래도 안전한 근거가 **여기**다 —
   * 상세 주소는 `bbs_seq` 로만 조립해 쪽 번호도 검색어도 없다.
   * `deep-paging.test.ts` 의 `PAGING_WITHOUT_URL_PARAM` 면제는 이 단언 위에 서 있다.
   */
  it("★면제의 근거 — 1·2쪽은 부서만 다르고, 상세 주소엔 쪽도 검색어도 없다", () => {
    const a = new URL(ansanConfig.list.url(1));
    const b = new URL(ansanConfig.list.url(2));
    expect(a.searchParams.get("currentPage")).toBe(b.searchParams.get("currentPage"));
    expect(a.searchParams.get("sch_text")).not.toBe(b.searchParams.get("sch_text"));
    for (const r of combined) {
      expect(r.detailUrl).not.toContain("currentPage");
      expect(r.detailUrl).not.toContain("sch_text");
    }
  });

  it("부서 넷 × 두 쪽 = 상한 8 — 지역은 경기, 기관은 안산시", () => {
    expect(ansanConfig.list.maxPages).toBe(8);
    expect(ansanConfig.region).toBe("경기");
    expect(ansanConfig.agency).toBe("안산시");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(ansanConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(ansanConfig.expectMinRows!);
  });

  it("★heuristic 추측을 끈다 — 목록 링크가 전부 href='#' 이라 추측이 한 주소로 뭉갠다", () => {
    expect(ansanConfig.skipHeuristic).toBe(true);
  });

  it("설정의 선택자·정규식이 고정본과 실제로 맞는다 — customParse 와 어긋나면 자가수리가 헛것을 배운다", () => {
    expect(ansanConfig.list.rowSelector).toBe("table.p-table.simple tbody tr");
    expect(ansanConfig.list.fields.title.selector).toBe("td.p-subject a");
    expect(new RegExp(ansanConfig.list.fields.detailUrl.regex!).test("fnGoDetail( 1681706 ); return false;")).toBe(
      true,
    );
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 선택자(table.p-table.simple)가 한 글자 틀리면 0행이다", () => {
    expect(parseAnsanList(listHtml.replaceAll("p-table simple", "p-table simple-x"))).toHaveLength(0);
  });

  it("제목 칸(td.p-subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseAnsanList(listHtml.replaceAll("p-subject", "p-subject-x"))).toHaveLength(0);
  });

  it("상세 번호 함수 이름(fnGoDetail)이 바뀌면 한 줄도 못 읽는다 — 주소를 지어내지 않는다", () => {
    expect(parseAnsanList(listHtml.replaceAll("fnGoDetail(", "fnGoDetailX("))).toHaveLength(0);
  });

  it("작성일 칸을 비우면 날짜를 지어내지 않는다", () => {
    const blank = parseAnsanList(listHtml.replaceAll("2026-09-02", ""));
    const r = blank.find((x) => x.detailUrl.endsWith("bbs_seq=1681706"));
    expect(r?.dateText).toBe("");
  });
});

/**
 * ★2026-09-03 「누락 0」 — 담당부서를 기업지원과 하나에서 **넷**으로 늘렸다.
 *   여기 시험이 그 사상(어느 쪽이 어느 부서인지)과 「산업진흥과는 맨 뒤」를 못 박는다.
 */
describe("담당부서 넷을 한 쪽씩 돌아가며 — 목록 사상", () => {
  it("쪽 번호 → 부서·쪽 사상이 표대로다", () => {
    const table: Array<[number, string, number]> = [
      [1, "기업지원과", 1], [2, "소상공인지원과", 1],
      [3, "노동일자리과", 1], [4, "산업진흥과", 1],
      [5, "기업지원과", 2], [6, "소상공인지원과", 2],
      [7, "노동일자리과", 2], [8, "산업진흥과", 2],
    ];
    for (const [p, dept, page] of table) expect({ p, ...ansanTargetOf(p) }).toMatchObject({ p, dept, page });
  });

  /**
   * ★한 부서의 두 쪽을 붙이지 않는 이유(2026-09-03 적대 리뷰 지적 ①):
   * 엔진은 「신규 0인 쪽이 **연속 둘**」이면 멈추는데, 그 규칙은 「이 부서가 바닥났다」와
   * 「전체가 끝났다」를 구분하지 못한다. 산업진흥과는 지금 15건뿐이라 2쪽이 0행인데,
   * 붙여 두면 그 자리에서 뒤 부서가 통째로 잘린다.
   */
  it("★같은 부서의 쪽이 연달아 오지 않는다 — 한 부서가 비어도 뒤 부서가 안 잘린다", () => {
    for (let p = 1; p < ansanConfig.list.maxPages; p++) {
      expect(ansanTargetOf(p).dept).not.toBe(ansanTargetOf(p + 1).dept);
    }
  });

  /**
   * ★부서마다 **같은 쪽 수**를 준다(적대 리뷰 지적 ②) — 「지금 15건이니 산업진흥과는 1쪽만」처럼
   * 순간값에 맞춰 자르지 않는다. 그 부서가 늘면 2쪽이 저절로 들어온다.
   */
  it("★상한 8쪽 = 부서 넷 × 2쪽 — 어느 부서도 순간 건수로 잘리지 않는다", () => {
    const pages = new Map<string, number[]>();
    for (let p = 1; p <= ansanConfig.list.maxPages; p++) {
      const t = ansanTargetOf(p);
      pages.set(t.dept, [...(pages.get(t.dept) ?? []), t.page]);
    }
    expect([...pages.keys()]).toEqual(["기업지원과", "소상공인지원과", "노동일자리과", "산업진흥과"]);
    for (const list of pages.values()) expect(list).toEqual([1, 2]);
  });

  it("url(p) 가 부서 이름을 인코딩해 싣는다", () => {
    expect(ansanConfig.list.url(2)).toContain(`sch_text=${encodeURIComponent("소상공인지원과")}`);
    expect(ansanConfig.list.url(2)).toContain("currentPage=1");
    expect(ansanConfig.list.url(7)).toContain(`sch_text=${encodeURIComponent("노동일자리과")}`);
    expect(ansanConfig.list.url(7)).toContain("currentPage=2");
    expect(ansanConfig.list.url(4)).toContain(`sch_text=${encodeURIComponent("산업진흥과")}`);
  });
});

describe("소상공인·노동일자리·산업진흥 고정본 — 같은 파서로 읽힌다", () => {
  const sosang = parseAnsanList(sosangHtml, 2);
  const nodong = parseAnsanList(nodongHtml, 3);
  const sanup = parseAnsanList(sanupHtml, 4);

  it("고정본 행 수 — 세 부서 1쪽에서 각각 13·15·13건", () => {
    expect(sosang).toHaveLength(13);
    expect(nodong).toHaveLength(15);
    expect(sanup).toHaveLength(13);
  });

  it("담당부서 칸을 그대로 category 로 싣는다 — 부서가 섞이지 않는다", () => {
    expect(new Set(sosang.map((r) => r.category))).toEqual(new Set(["소상공인지원과"]));
    expect(new Set(nodong.map((r) => r.category))).toEqual(new Set(["노동일자리과"]));
    expect(new Set(sanup.map((r) => r.category))).toEqual(new Set(["산업진흥과"]));
  });

  it("★상세 주소에 쪽 번호·검색어가 없다 — 부서를 늘려도 열쇠가 안 갈린다", () => {
    for (const r of [...sosang, ...nodong, ...sanup]) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.ansan\.go\.kr\/www\/common\/bbs\/selectBbsDetail\.do\?bbs_code=WWW13&bbs_seq=\d+$/,
      );
      expect(r.detailUrl).not.toContain("currentPage");
      expect(r.detailUrl).not.toContain("sch_text");
    }
  });

  it("네 부서를 합쳐도 상세 열쇠가 겹치지 않는다(50건)", () => {
    const all = [...rows, ...sosang, ...nodong, ...sanup];
    expect(all).toHaveLength(50);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(50);
  });

  it("새 부서 글도 등록일을 개시형으로 넘긴다", () => {
    for (const r of [...sosang, ...nodong, ...sanup]) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("새 부서에도 행정 고시 거르개가 그대로 걸린다", () => {
    const titles = [...sosang, ...nodong, ...sanup].map((r) => r.title);
    expect(titles.some((t) => t.includes("공시송달"))).toBe(false);
    expect(titles.some((t) => t.includes("이행강제금"))).toBe(false);
    // 새 부서 고정본에 실제로 거를 줄이 있었다는 증거(없으면 거르개를 잰 것이 아니다).
    expect(sosangHtml + nodongHtml + sanupHtml).toMatch(/공시\s*송달|행정예고|기간제근로자/);
  });
});

/** ★2026-09-03 적대 리뷰 지적 ⑦ — 포괄 거르개가 진짜 모집 공고를 죽이던 자리. */
describe("거르개가 진짜 모집 공고를 죽이지 않는다", () => {
  it("★버릴 낱말이 사업 이름 안에 든 모집 공고는 살린다", () => {
    expect(isAnsanDropTitle("소비자 설문 조사 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isAnsanDropTitle("공공조달 입찰 공고 대응 지원사업 신청기업 모집")).toBe(false);
    expect(isAnsanDropTitle("2026년 안산시 채용 지원금 참여기업 모집 공고")).toBe(false);
  });

  it("사업 표식이 없으면 그대로 버린다 — 구제 규칙이 거르개를 무력화하지 않는다", () => {
    expect(isAnsanDropTitle("2026년 안산스마트허브 내 계량기 정기검사 기간제근로자 공개모집 공고")).toBe(true);
    expect(isAnsanDropTitle("2026년 기간제근로자 채용 공고")).toBe(true);
    expect(isAnsanDropTitle("행정대집행 보관물품 및 보관장소 공고")).toBe(true);
    expect(isAnsanDropTitle("고객만족도 설문 조사 실시 안내")).toBe(true);
  });

  it("파서도 같은 길로 판정한다 — 고정본 행 수가 안 흔들린다", () => {
    expect(rows).toHaveLength(9);
    expect(parseAnsanList(sosangHtml, 2)).toHaveLength(13);
  });
});

/**
 * ★배치가 실제로 지켜 주는 것 — 엔진까지 돌려 잰다(2026-09-03 적대 리뷰 지적 ①).
 * 한 부서가 통째로 비어도 **뒤 부서가 안 잘린다**. 두 쪽씩 묶어 읽던 옛 배치에서는
 * 그 부서의 두 쪽이 연달아 0행이 되어 「연속 두 쪽 신규 0」 규칙이 수집을 끝내 버렸다.
 */
describe("★부서 하나가 비어도 뒤 부서를 잃지 않는다 — 엔진까지 돌려 확인", () => {
  const EMPTY = '<table class="p-table simple"><tbody></tbody></table>';
  const pageOf = (url: string) => Number(new URL(url).searchParams.get("currentPage") ?? 1);
  const deptOf = (url: string) => new URL(url).searchParams.get("sch_text") ?? "";

  it("소상공인지원과가 두 쪽 다 0행이어도 노동일자리과·산업진흥과가 들어온다", async () => {
    const asked: string[] = [];
    const rowsOut = await fetchBoardAll(ansanConfig, {
      fetchText: async (url) => {
        asked.push(`${deptOf(url)}#${pageOf(url)}`);
        if (deptOf(url) === "소상공인지원과") return EMPTY;          // 이 부서만 통째로 빈다
        if (deptOf(url) === "기업지원과") return pageOf(url) === 1 ? listHtml : listP2Html;
        if (deptOf(url) === "노동일자리과") return pageOf(url) === 1 ? nodongHtml : EMPTY;
        return pageOf(url) === 1 ? sanupHtml : EMPTY;                // 산업진흥과는 1쪽뿐
      },
      prevOpenCount: 0,
      askModel: async () => "{}",
      onAllFailed: async () => {},
    });
    // 빈 부서 뒤에 오는 부서들이 실제로 읽혔다.
    expect(asked).toContain("노동일자리과#1");
    expect(asked).toContain("산업진흥과#1");
    expect(asked).toContain("기업지원과#2");
    const titles = rowsOut.map((r) => r.title);
    expect(titles).toContain("2026년도 일본 FIW 안산시 참관단 참여기업 모집 공고");
    expect(rowsOut.length).toBeGreaterThan(30);
    // 상세 열쇠는 쪽·검색어 없이 하나로 모인다.
    expect(new Set(rowsOut.map((r) => r.sourceId)).size).toBe(rowsOut.length);
  });
});

describe("구제 규칙은 조달·채용 글을 살리지 않는다(코덱스 지적 2026-09-03)", () => {
  it("낱말이 겹쳐도 용역·입찰 참가·채용 글은 구제되지 않고, 진짜 지원사업은 구제된다", () => {
    expect(isAnsanRescued("지원사업 운영 용역 입찰 참가 신청 공고")).toBe(false);
    expect(isAnsanRescued("지원사업 담당 직원 채용 공고 접수 안내")).toBe(false);
    expect(isAnsanRescued("2026 해외 공공조달 입찰 지원사업 참여기업 모집")).toBe(true);
    expect(isAnsanRescued("소비자 설문 조사 지원사업 신청기업 모집")).toBe(true);
  });
});
