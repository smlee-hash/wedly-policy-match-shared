import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { isJepaDropTitle, jepaConfig, parseJepaList } from "./jepa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `bbs_ajax/?b_id=notice&site=new_jepa&mn=426` 1·2쪽
 * (한 쪽 15건 · 전체 1,637건 / 110쪽). 화면 `/bbs/` 는 #board_wrap 이 비어 있고
 * 목록은 ajax 조각에만 있다.
 */
const p1 = readFileSync(join(__dirname, "../__fixtures__/jepa-list.html"), "utf-8");
const p2 = readFileSync(join(__dirname, "../__fixtures__/jepa-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseJepaList(p1, 1, NOW);
const rowsP2 = parseJepaList(p2, 2, NOW);

describe("전남중소기업일자리경제진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 15건에서 DROP 을 뺀 11건을 읽고 첫 행의 제목·상세주소·등록일이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(11);
    expect(rows[0]).toMatchObject({
      title: "전남광주통합특별시 민생회복대출안심보험 안내",
      detailUrl: "https://www.jepa.kr/bbs/?b_id=notice&site=new_jepa&mn=426&type=view&bs_idx=1712",
      dateText: "2026-08-31 ~",
    });
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 목록은 마감일을 안 준다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("날짜는 td.t_date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("bs_idx=1712"));
    expect(r?.dateText).toBe("2026-08-31 ~");
    expect(r?.dateText).not.toMatch(/1637|조회/);
  });

  it("★상세 주소에 page 를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2[0]).toMatchObject({
      title: "전남 청년 희망 일자리 지원사업 참여기업 · 참여청년 모집 재공고",
      detailUrl: "https://www.jepa.kr/bbs/?b_id=notice&site=new_jepa&mn=426&type=view&bs_idx=1695",
      dateText: "2026-06-29 ~",
    });
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다", () => {
    const all = [...rows, ...rowsP2];
    expect(all).toHaveLength(24);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(24);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("같은 bs_idx 는 한 번만 담는다", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("실측 DROP 제목(입찰공고·제안서 평가·평가위원)이 빠진다", () => {
    const titles = [...rows, ...rowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("입찰공고"))).toBe(false);
    expect(titles.some((t) => t.includes("제안서 평가결과"))).toBe(false);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(
      isJepaDropTitle(
        "「전남광주통합특별시 청년 소상공인안심보험(손해보험) 사업 수행 용역」제안서 평가결과 공고",
      ),
    ).toBe(true);
    expect(isJepaDropTitle("2026 세계한인경제인대회 전남광주통합특별시 공동관 운영 용역 입찰공고")).toBe(
      true,
    );
    expect(
      isJepaDropTitle(
        "「청년 소상공인안심보험(손해보험) 사업 수행 용역」제안서 평가위원(후보자) 모집 공고",
      ),
    ).toBe(true);
  });

  it("지원사업은 살린다 — 「채용」을 통째로 버리지 않는다", () => {
    expect(rows.some((r) => r.title.includes("민생회복대출안심보험 안내"))).toBe(true);
    expect(rows.some((r) => r.title.includes("원스톱 중소기업 현장지원단"))).toBe(true);
    expect(isJepaDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isJepaDropTitle("2026년 스마트시티 엑스포 월드 콩그레스 박람회 참가 지원")).toBe(false);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("★모든 제목이 div.title.notice 다 — 게시판 id 가 notice 라서다. 이걸 붙박이로 보면 안 된다", () => {
    expect(p1.match(/class="title notice"/g)?.length).toBe(15);
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
  });

  it("tr.notice 줄이 1년을 넘으면 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const planted = p1.replaceAll("<tr>", '<tr class="notice">');
    expect(parseJepaList(planted, 1, Date.parse("2030-01-01T00:00:00Z"))).toHaveLength(0);
    const fresh = parseJepaList(planted, 1, NOW);
    expect(fresh).toHaveLength(11);
    expect(fresh.every((r) => r.dateText === "")).toBe(true);
  });
});

describe("전남중소기업일자리경제진흥원 설정", () => {
  it("쪽넘김은 GET page 다 — 목록은 화면이 아니라 bbs_ajax 다", () => {
    expect(jepaConfig.list.url(1)).toBe(
      "https://www.jepa.kr/bbs/bbs_ajax/?b_id=notice&site=new_jepa&mn=426&page=1",
    );
    expect(jepaConfig.list.url(2)).toBe(
      "https://www.jepa.kr/bbs/bbs_ajax/?b_id=notice&site=new_jepa&mn=426&page=2",
    );
    expect(jepaConfig.list.maxPages).toBe(15);
  });

  it("★상세 주소의 page 는 엔진이 알아서 떼어 낸다 — 안 떼면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(pagingParamsOf(jepaConfig)).toContain("page");
  });

  it("지역은 전남 — 전남중소기업일자리경제진흥원이다", () => {
    expect(jepaConfig.id).toBe("jepa");
    expect(jepaConfig.region).toBe("전남");
    expect(jepaConfig.agency).toBe("전남중소기업일자리경제진흥원");
    expect(jepaConfig.label).toBe("전남중소기업일자리경제진흥원");
  });

  it("한 쪽 15건의 절반을 기대한다 — 0행이면 서식 변경", () => {
    expect(jepaConfig.expectMinRows).toBe(7);
  });

  it("상세 주소 호스트가 baseUrl 과 같다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(jepaConfig.baseUrl).host);
  });

  it("★본문 선택자를 비운다 — 상세 표지문은 이미지+가입동의 링크뿐이라 첨부 공고문 길을 막는다", () => {
    expect(jepaConfig.detailContentSelector).toBeUndefined();
    expect(jepaConfig.attachmentsScopeSelector).toBe("#file_list");
  });

  it("사람용 /bbs/ 상세는 껍데기라 ajax 조각을 부른다", async () => {
    const seen: string[] = [];
    const html = await jepaConfig.detailFetch!(rows[0].detailUrl, async (u) => {
      seen.push(u);
      return '<ul id="file_list"><li><a href="/bbs/bbs_ajax/?type=download&bf_idx=1">a.hwpx</a></li></ul>';
    });
    expect(seen[0]).toBe(
      "https://www.jepa.kr/bbs/bbs_ajax/?b_id=notice&site=new_jepa&mn=426&type=view&bs_idx=1712",
    );
    expect(html).toContain("file_list");
    expect(html).toContain("type=download");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 고정본 선택자를 한 글자 바꿨을 때 결과가 실제로 달라지는지 확인한다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자(#board_list)가 틀리면 한 줄도 못 읽는다", () => {
    expect(parseJepaList(p1.replaceAll('id="board_list"', 'id="board_list_x"'), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("제목 칸(t_title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJepaList(p1.replaceAll("t_title", "t_title_x"), 1, NOW)).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseJepaList(p1.replaceAll('class="t_date"', 'class="t_date_x"'), 1, NOW);
    expect(broken).toHaveLength(11);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
