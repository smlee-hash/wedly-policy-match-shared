import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchBoardAll } from "../engine";
import { isAtkoreaDropTitle, parseAtkoreaList, atkoreaConfig, atkoreaTargetOf, isAtkoreaRescued } from "./atkorea";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `article/apko363d00/list.action`(공고 > 식품사업) 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/atkorea-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/atkorea-list-p2.html"), "utf-8");
/** 2026-09-03 실측 — 나머지 세 게시판의 1쪽(유통 e00 · 기업지원 f00 · 수출 400). */
const e00Html = readFileSync(join(__dirname, "../__fixtures__/atkorea-e00-list.html"), "utf-8");
const f00Html = readFileSync(join(__dirname, "../__fixtures__/atkorea-f00-list.html"), "utf-8");
const b400Html = readFileSync(join(__dirname, "../__fixtures__/atkorea-400-list.html"), "utf-8");
const rows = parseAtkoreaList(listHtml);
// 엔진 5쪽 = 식품사업(d00) 2쪽 — 게시판을 한 쪽씩 돌아가며 읽으므로 같은 게시판은 4쪽 간격이다.
const rowsP2 = parseAtkoreaList(listP2Html, 5);
const combined = [...rows, ...rowsP2];

describe("한국농수산식품유통공사(aT) 식품사업 공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄에서 DROP(결과·수상 발표) 4건을 뺀 6건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      title: "2026 종균활용 발효식품산업지원 사업 2차 모집공고(~6.17)",
      detailUrl: "https://www.at.or.kr/article/apko363d00/view.action?articleId=52416",
      dateText: "2026-06-02 ~",
      agency: "한국농수산식품유통공사",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(combined.every((r) => !/currentPage/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => /^https:\/\/www\.at\.or\.kr\/article\/apko363d00\/view\.action\?articleId=\d+$/.test(r.detailUrl))).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 자바 날짜 글자를 그대로 흘리지 않는다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of combined) {
      expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
      expect(r.dateText).not.toMatch(/KST|Jun|Mon|Tue/);
    }
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(12);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — at.condition.currentPage 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2025 단체급식 김치응용요리 경연대회 개최 공고 (~6.30(월))",
      detailUrl: "https://www.at.or.kr/article/apko363d00/view.action?articleId=49986",
      dateText: "2025-06-04 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다 — 결과·수상 발표는 지원사업이 아니다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("선정결과"))).toBe(false);
    expect(titles.some((t) => t.includes("심사 결과"))).toBe(false);
    expect(titles.some((t) => t.includes("수상작 발표"))).toBe(false);
    expect(titles.some((t) => t.includes("후보업체 공개"))).toBe(false);
    expect(isAtkoreaDropTitle("2026년 제15회 대한민국 김치품평회 수상작 선정결과 안내")).toBe(true);
    expect(isAtkoreaDropTitle("2026년 제15회 대한민국 김치품평회 정부시상 후보업체 공개")).toBe(true);
    expect(isAtkoreaDropTitle("2026 제15회 대한민국 김치품평회 예선 심사 결과 안내")).toBe(true);
    expect(isAtkoreaDropTitle("2025년도 대한민국 우리술 품평회 수상작 후보 TOP 20 공개")).toBe(true);
    expect(isAtkoreaDropTitle("2026년 aT 청사 시설관리 용역 입찰공고")).toBe(true);
  });

  it("모집·접수 글은 남긴다 — 결과 낱말이 붙어도 모집이면 살린다", () => {
    expect(isAtkoreaDropTitle("2026 종균활용 발효식품산업지원 사업 2차 모집공고(~6.17)")).toBe(false);
    expect(isAtkoreaDropTitle("2026 제15회 대한민국 김치품평회 출품제품 접수(~4.3)")).toBe(false);
    // 1차 선정결과를 알리면서 2차를 함께 모집하는 글이 죽으면 안 된다.
    expect(isAtkoreaDropTitle("2026 발효식품산업지원 사업 1차 선정결과 및 2차 모집공고")).toBe(false);
    // 「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다(bizbc 주석).
    expect(isAtkoreaDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(rows.some((r) => r.title.includes("신청안내"))).toBe(true);
  });

  it("날짜는 등록일 칸에서만 집는다 — 시:분:초·번호가 새 나오지 않는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("articleId=52416"));
    expect(r?.dateText).toBe("2026-06-02 ~");
    expect(rows.every((x) => !/\d{2}:\d{2}/.test(x.dateText))).toBe(true);
    expect(rows.every((x) => !/^\d{3}20/.test(x.dateText))).toBe(true);
  });

  /**
   * ★위 시험만으로는 「칸 단위로 읽는다」를 못 잰다 — 자바 날짜 글자는 행 전체에서 찾아도
   * 같은 답이 나와서, `tr.text` 로 읽는 판을 넣어도 그냥 통과했다(2026-09-03 실제로 해 봄).
   * 그래서 실측 바이트를 ㉠ 제목에 마감일을 붙이고 ㉡ 등록일 칸을 점 서식으로 바꿔
   * **두 답이 갈리게** 만들어 잰다. 행 전체 글자로 읽으면 제목의 6.17 이 등록일로 잡힌다.
   */
  it("★제목에 든 마감일을 등록일로 착각하지 않는다 — 칸 단위 읽기의 진짜 증거", () => {
    const decoy = listHtml
      .replace(
        "2026 종균활용 발효식품산업지원 사업 2차 모집공고(~6.17)",
        "2026 종균활용 발효식품산업지원 사업 2차 모집공고(~2026.6.17)",
      )
      .replace("Tue Jun 02 09:38:22 KST 2026", "2026.06.02");
    const r = parseAtkoreaList(decoy).find((x) => x.detailUrl.includes("articleId=52416"));
    expect(r?.title).toContain("(~2026.6.17)");
    expect(r?.dateText).toBe("2026-06-02 ~");
    expect(r?.dateText).not.toBe("2026-06-17 ~");
  });

  it("붙박이 공지는 날짜를 비우고, 1년 넘은 붙박이는 아예 안 담는다", () => {
    const now = Date.parse("2026-09-03T00:00:00Z");
    const pinned = parseAtkoreaList(listHtml.replaceAll('<tr class="">', '<tr class="notice">'), 1, now);
    // 1년 안쪽 5건만 남는다(2025-08-14 우리술 대축제는 385일 전이라 빠진다).
    expect(pinned).toHaveLength(5);
    expect(pinned.every((r) => r.dateText === "")).toBe(true);
    expect(pinned.some((r) => r.title.includes("우리술 대축제"))).toBe(false);
  });
});

describe("한국농수산식품유통공사(aT) 설정", () => {
  it("쪽넘김은 GET at.condition.currentPage", () => {
    expect(atkoreaConfig.list.url(1)).toBe(
      "https://www.at.or.kr/article/apko363d00/list.action?at.condition.currentPage=1",
    );
    // 2쪽은 **다음 게시판의 1쪽**이다(한 쪽씩 돌아가며 읽는다) — 같은 게시판 2쪽은 5쪽 자리.
    expect(atkoreaConfig.list.url(5)).toBe(
      "https://www.at.or.kr/article/apko363d00/list.action?at.condition.currentPage=2",
    );
    // 게시판 4곳 × 10쪽 = 엔진 절대 상한(40). 예전 8쪽(식품사업 한 곳)에서 늘렸다.
    expect(atkoreaConfig.list.maxPages).toBe(40);
  });

  it("지역은 전국, 기관은 한국농수산식품유통공사", () => {
    expect(atkoreaConfig.id).toBe("atkorea");
    expect(atkoreaConfig.region).toBe("전국");
    expect(atkoreaConfig.agency).toBe("한국농수산식품유통공사");
    expect(atkoreaConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(atkoreaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(atkoreaConfig.expectMinRows!);
  });

  it("★목록 행에 내려받기 링크가 섞여 있으니 추측 단계를 끈다", () => {
    // 고정본 실측: 첨부 칸에 <a href="/download.action?attachId=...">가 행마다 있다.
    expect(listHtml).toMatch(/href="\/download\.action\?attachId=\d+"/);
    expect(atkoreaConfig.skipHeuristic).toBe(true);
  });

  it("첨부는 상세의 첨부 상자 안에서만 걷는다 — 본문 선택자는 일부러 비운다", () => {
    expect(atkoreaConfig.attachmentsScopeSelector).toBe("div.board-file-box");
    expect(atkoreaConfig.detailContentSelector).toBeUndefined();
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseAtkoreaList(listHtml.replaceAll("colTable", "colTable-x"))).toHaveLength(0);
  });

  it("제목 칸(td.list_tit)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseAtkoreaList(listHtml.replaceAll("list_tit", "list_tit-x"))).toHaveLength(0);
  });

  it("상세 주소 변수 이름이 바뀌면 한 줄도 못 읽는다 — 번호를 지어내지 않는다", () => {
    expect(parseAtkoreaList(listHtml.replaceAll("articleId=", "articleNo="))).toHaveLength(0);
  });

  it("등록일 칸의 자바 날짜가 깨지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseAtkoreaList(listHtml.replaceAll(" KST ", " "));
    expect(broken.length).toBe(rows.length);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});

/**
 * ★2026-09-03 「누락 0」 — 게시판 넷(d00 식품사업·e00 유통사업·f00 기업지원·400 수출)을
 *   **두 쪽씩 번갈아** 읽는다. 여기 시험이 그 사상(어느 쪽이 어느 게시판인지)을 못 박는다.
 */
describe("네 게시판을 한 쪽씩 돌아가며 — 목록 사상", () => {
  it("쪽 번호 → 게시판·쪽 사상이 표대로다", () => {
    const table: Array<[number, string, number]> = [
      [1, "apko363d00", 1], [2, "apko363e00", 1],
      [3, "apko363f00", 1], [4, "apko363400", 1],
      [5, "apko363d00", 2], [6, "apko363e00", 2],
      [9, "apko363d00", 3], [37, "apko363d00", 10], [40, "apko363400", 10],
    ];
    for (const [p, board, page] of table) {
      expect({ p, ...atkoreaTargetOf(p) }).toMatchObject({ p, board, page });
    }
  });

  /**
   * ★한 대상의 두 쪽을 붙이지 않는 이유(2026-09-03 적대 리뷰 지적 ①):
   * 엔진은 「신규 0인 쪽이 **연속 둘**」이면 멈추는데, 그 규칙은 「이 게시판이 바닥났다」와
   * 「전체가 끝났다」를 구분하지 못한다. 붙여 두면 게시판 하나가 비는 순간 뒤 게시판이 통째로 잘린다.
   */
  it("★같은 게시판의 쪽이 연달아 오지 않는다 — 한 게시판이 비어도 뒤 게시판이 안 잘린다", () => {
    for (let p = 1; p < atkoreaConfig.list.maxPages; p++) {
      expect(atkoreaTargetOf(p).board).not.toBe(atkoreaTargetOf(p + 1).board);
    }
  });

  it("상한(40쪽)이면 네 게시판을 10쪽씩 읽고 그 안에 게시판이 하나도 안 빠진다", () => {
    const seen = new Map<string, number[]>();
    for (let p = 1; p <= atkoreaConfig.list.maxPages; p++) {
      const t = atkoreaTargetOf(p);
      seen.set(t.board, [...(seen.get(t.board) ?? []), t.page]);
    }
    expect([...seen.keys()].sort()).toEqual(["apko363400", "apko363d00", "apko363e00", "apko363f00"]);
    // 게시판마다 **같은 쪽 수**를 준다 — 어느 한 곳을 순간 건수에 맞춰 자르지 않는다.
    for (const pages of seen.values()) expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("url(p) 가 사상대로 조립된다 — 게시판 조각이 주소 경로에 들어간다", () => {
    expect(atkoreaConfig.list.url(2)).toBe(
      "https://www.at.or.kr/article/apko363e00/list.action?at.condition.currentPage=1",
    );
    expect(atkoreaConfig.list.url(4)).toBe(
      "https://www.at.or.kr/article/apko363400/list.action?at.condition.currentPage=1",
    );
    expect(atkoreaConfig.list.url(9)).toBe(
      "https://www.at.or.kr/article/apko363d00/list.action?at.condition.currentPage=3",
    );
  });

  /**
   * ★한 쪽씩 돌리면 `url(1)`·`url(2)` 의 쪽 번호가 둘 다 1 이라 엔진이 쪽 번호 변수를 못 찾는다
   * (`pagingParamsOf` → 빈 목록). 그래도 안전한 근거가 **여기**다 — 상세 주소는 articleId 로만
   * 조립해 쪽 정보가 아예 없어 지울 것이 없다. `deep-paging.test.ts` 의 `PAGING_WITHOUT_URL_PARAM`
   * 면제는 이 단언 위에 서 있다.
   */
  it("★면제의 근거 — 쪽 번호는 주소에서 안 드러나지만 상세 주소에도 쪽이 없다", () => {
    const a = new URL(atkoreaConfig.list.url(1));
    const b = new URL(atkoreaConfig.list.url(2));
    expect(a.pathname).not.toBe(b.pathname);
    expect(a.searchParams.get("at.condition.currentPage")).toBe(
      b.searchParams.get("at.condition.currentPage"),
    );
    for (const r of [...rows, ...rowsP2]) expect(r.detailUrl).not.toMatch(/currentPage|page=/i);
  });
});

describe("유통·기업지원·수출 게시판 고정본 — 같은 파서로 읽힌다", () => {
  const e00 = parseAtkoreaList(e00Html, 2);
  const f00 = parseAtkoreaList(f00Html, 3);
  const b400 = parseAtkoreaList(b400Html, 4);

  it("고정본 행 수 — 세 게시판 모두 한 쪽 10줄을 그대로 읽는다", () => {
    expect(e00).toHaveLength(10);
    expect(f00).toHaveLength(10);
    expect(b400).toHaveLength(10);
  });

  it("첫 행이 실측과 맞는다 — 선택자가 게시판마다 같다는 증거", () => {
    expect(e00[0]).toMatchObject({
      title: "2026년 농산물 온라인 마케터 육성 기획전 참여 업체 모집 공고",
      detailUrl: "https://www.at.or.kr/article/apko363d00/view.action?articleId=53136",
      category: "유통사업",
    });
    expect(f00[0].category).toBe("기업지원");
    expect(b400[0].category).toBe("수출");
    expect(rows[0].category).toBe("식품사업");
  });

  /**
   * ★상세 주소는 어느 게시판에서 읽었든 d00 경로다. 실측(2026-09-03): e00 글 53136 을
   * d00·e00·f00·400 네 경로로 열면 전부 200 이고 제목·첨부 상자가 같다. 경로를 게시판마다
   * 바꾸면 같은 글이 두 게시판에 걸릴 때 두 줄로 저장된다(주소가 곧 중복 열쇠).
   */
  it("★네 게시판 행이 전부 d00 상세 주소 한 모양이고 쪽 번호가 없다", () => {
    const all = [...rows, ...rowsP2, ...e00, ...f00, ...b400];
    for (const r of all) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.at\.or\.kr\/article\/apko363d00\/view\.action\?articleId=\d+$/,
      );
      expect(r.detailUrl).not.toContain("currentPage");
    }
    // 유통·수출 게시판의 원문 href 에는 실제로 쪽 번호가 붙어 있다 — 그걸 그대로 쓰면 안 된다는 증거.
    expect(e00Html).toContain("view.action?articleId=53136&amp;amp;at.condition.currentPage=1");
  });

  it("네 게시판을 합쳐도 상세 열쇠가 겹치지 않는다(42건)", () => {
    const all = [...rows, ...rowsP2, ...e00, ...f00, ...b400];
    expect(all).toHaveLength(42);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(42);
  });

  /**
   * ★실사이트 함정 — 최근 글은 제목 앞에 「새글」 딱지(`i.new > span.hideTxt`)가 붙는다.
   * 앵커의 첫 span 을 집던 옛 판은 유통 게시판 1행 제목을 통째로 **「새글」**로 읽었다.
   * 식품(d00) 고정본엔 딱지가 없어 이 함정이 안 보였다 — 게시판을 넷으로 늘려서 드러났다.
   */
  it("★「새글」 딱지를 제목으로 읽지 않는다", () => {
    expect(e00Html).toContain('<i class="new"><span class="hideTxt">새글</span></i>');
    expect(e00.every((r) => r.title !== "새글")).toBe(true);
    expect(e00.every((r) => !r.title.startsWith("새글"))).toBe(true);
    expect(e00[0].title).toBe("2026년 농산물 온라인 마케터 육성 기획전 참여 업체 모집 공고");
  });

  it("날짜·기관은 게시판이 달라도 같은 규칙으로 읽는다", () => {
    for (const r of [...e00, ...f00, ...b400]) {
      expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
      expect(r.agency).toBe("한국농수산식품유통공사");
    }
  });

  it("게시판 이름은 쪽 번호가 정한다 — 사상이 깨지면 여기서 걸린다", () => {
    expect(parseAtkoreaList(e00Html, 6)[0].category).toBe("유통사업"); // 6쪽 = 유통 2쪽
    expect(parseAtkoreaList(e00Html, 3)[0].category).toBe("기업지원"); // 3쪽 = 기업지원 1쪽
  });
});

/**
 * ★2026-09-03 적대 리뷰 지적 ⑦·⑧ — 거르개 과잉과 딱지 제거 경계.
 */
describe("거르개가 진짜 모집 공고를 죽이지 않는다", () => {
  it("★버릴 낱말이 사업 이름 안에 든 모집 공고는 살린다", () => {
    expect(isAtkoreaDropTitle("해외 공공조달 입찰 지원사업 참여기업 모집")).toBe(false);
    expect(isAtkoreaDropTitle("소비자 설문 조사 지원사업 신청기업 모집")).toBe(false);
    expect(isAtkoreaDropTitle("2026년 수출바우처 지원사업 참여기업 모집 공고")).toBe(false);
  });

  it("사업 표식이 없으면 그대로 버린다 — 구제 규칙이 거르개를 무력화하지 않는다", () => {
    expect(isAtkoreaDropTitle("2026년 aT 청사 시설관리 용역 입찰공고")).toBe(true);
    expect(isAtkoreaDropTitle("평가위원 모집 공고")).toBe(true);
    expect(isAtkoreaDropTitle("2026년 상반기 고객만족도 설문 조사")).toBe(true);
    expect(isAtkoreaDropTitle("신규직원 채용 공고")).toBe(true);
  });

  it("★「NEW」로 시작하는 진짜 제목을 깎지 않는다 — 딱지 모양일 때만 지운다", () => {
    const swapped = e00Html.replace(
      "2026년 농산물 온라인 마케터 육성 기획전 참여 업체 모집 공고",
      "NEW딜 농식품 수출기업 모집",
    );
    const r = parseAtkoreaList(swapped, 2).find((x) => x.detailUrl.includes("articleId=53136"));
    expect(r?.title).toBe("NEW딜 농식품 수출기업 모집");
  });

  it("앞머리 딱지 글자는 그대로 지운다 — 선택자가 바뀌어 앵커 글자로 내려갔을 때의 보루", () => {
    // 딱지 span 을 지워 앵커 글자(= 「새글 제목」)로 내려가게 만든 판.
    const fallen = e00Html.replaceAll('<span class="hideTxt">새글</span>', "새글");
    const r = parseAtkoreaList(fallen, 2).find((x) => x.detailUrl.includes("articleId=53136"));
    expect(r?.title.startsWith("새글")).toBe(false);
  });
});

/**
 * ★배치가 실제로 지켜 주는 것 — 엔진까지 돌려 잰다(2026-09-03 적대 리뷰 지적 ①).
 * 게시판 하나가 통째로 비어도 **뒤 게시판이 안 잘린다**. 두 쪽씩 묶어 읽던 옛 배치에서는
 * 그 게시판의 두 쪽이 연달아 0행이 되어 「연속 두 쪽 신규 0」 규칙이 수집을 끝내 버렸다.
 */
describe("★게시판 하나가 비어도 뒤 게시판을 잃지 않는다 — 엔진까지 돌려 확인", () => {
  const EMPTY = '<table id="colTable"><tbody></tbody></table>';
  const boardOf = (url: string) => new URL(url).pathname.split("/")[2];
  const pageOf = (url: string) => Number(new URL(url).searchParams.get("at.condition.currentPage") ?? 1);

  it("유통(e00)이 비어도 기업지원(f00)·수출(400)·식품 2쪽이 들어온다", async () => {
    const asked: string[] = [];
    const rowsOut = await fetchBoardAll(atkoreaConfig, {
      fetchText: async (url) => {
        const board = boardOf(url);
        const page = pageOf(url);
        asked.push(`${board}#${page}`);
        if (board === "apko363e00") return EMPTY;                       // 이 게시판만 통째로 빈다
        if (page > 2) return EMPTY;                                     // 3쪽부터는 없다고 친다
        if (board === "apko363d00") return page === 1 ? listHtml : listP2Html;
        return page === 1 ? (board === "apko363f00" ? f00Html : b400Html) : EMPTY;
      },
      prevOpenCount: 0,
      askModel: async () => "{}",
      onAllFailed: async () => {},
    });
    expect(asked).toContain("apko363f00#1");
    expect(asked).toContain("apko363400#1");
    expect(asked).toContain("apko363d00#2");
    // 빈 게시판 뒤의 두 게시판 줄이 실제로 담겼다(f00 10 + 400 10 + d00 1·2쪽 12 = 32).
    expect(rowsOut.length).toBeGreaterThanOrEqual(32);
    expect(new Set(rowsOut.map((r) => r.sourceId)).size).toBe(rowsOut.length);
  });
});

describe("구제 규칙은 조달·채용 글을 살리지 않는다(코덱스 지적 2026-09-03)", () => {
  it("낱말이 겹쳐도 용역·입찰 참가·채용 글은 구제되지 않고, 진짜 지원사업은 구제된다", () => {
    expect(isAtkoreaRescued("지원사업 운영 용역 입찰 참가 신청 공고")).toBe(false);
    expect(isAtkoreaRescued("지원사업 담당 직원 채용 공고 접수 안내")).toBe(false);
    expect(isAtkoreaRescued("2026 해외 공공조달 입찰 지원사업 참여기업 모집")).toBe(true);
    expect(isAtkoreaRescued("소비자 설문 조사 지원사업 신청기업 모집")).toBe(true);
  });
});
