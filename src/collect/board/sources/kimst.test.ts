import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKimstDropTitle, kimstConfig, parseKimstList } from "./kimst";
import { harvestBoardAttachments } from "../detail-fill";
import { fetchBoardDetail } from "../engine";
import { safeAttachmentUrl } from "../../attachment-text";
import { parseHtml } from "../html";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 **공지사항** 1쪽·5쪽(`/u/news/notice_01/board.do?page=1|5`)과
 * 상세 1건(`?type=view&bno=153421765145800`).
 * 5쪽을 둘째 고정본으로 쓴 이유: 1쪽 뒤 몇 쪽은 같은 달 글이라 거르개 갈래가 안 늘어난다 —
 * 5쪽에 포럼·교육생·인턴십·의견수렴·수요조사가 한꺼번에 있다.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kimst-list.html"), "utf-8");
const listP5Html = readFileSync(join(__dirname, "../__fixtures__/kimst-list-p5.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/kimst-detail.html"), "utf-8");
const rows = parseKimstList(listHtml);
const rowsP5 = parseKimstList(listP5Html);
const combined = [...rows, ...rowsP5];

describe("해양수산과학기술진흥원 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10행에서 DROP 3건을 뺀 7건을 읽고 첫 행 값이 맞다", () => {
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({
      title: "2026년 해양수산 현장방문행사(팸투어) 참여기업 모집공고",
      detailUrl:
        "https://www.kimst.re.kr/u/news/notice_01/board.do?type=view&bno=153421765145806",
      // 목록에 마감일 칸이 없다 — 「등록일 ~」 개시형이다(저장 규칙이 90일로 닫는다).
      dateText: "2026-08-25 ~",
      agency: "해양수산과학기술진흥원",
    });
    const star = rows.find((r) => r.detailUrl.endsWith("bno=153421765145800"));
    expect(star?.title).toBe("2026 예비오션스타 기업 모집 공고");
    expect(star?.dateText).toBe("2026-08-24 ~");
  });

  it("5쪽은 DROP 3건을 뺀 7건이고 1쪽과 상세 열쇠가 안 겹친다", () => {
    expect(rowsP5).toHaveLength(7);
    expect(rowsP5[1].title).toBe("기업은행-KIMST 상생형 해양수산 창업벤처기업 지원사업 모집 공고");
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("일자는 td:nth-child(3) 칸에서만 집는다 — 행 전체 글자면 「공지」·조회수가 붙는다", () => {
    expect(combined.every((r) => /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    // 1쪽 첫 행의 조회수는 856 — 날짜 글자에 들어오면 안 된다.
    expect(rows[0].dateText).not.toMatch(/856/);
  });

  it("상세 주소는 빈 검색 인자를 떼고 bno 하나로 못 박는다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kimst\.re\.kr\/u\/news\/notice_01\/board\.do\?type=view&bno=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/searchKeyword/);
      expect(r.detailUrl).not.toMatch(/[?&]page=/);
    }
  });

  it("★IRIS 거울·채용 게시판이 아니라 공지사항을 읽는다", () => {
    // 사업공고 게시판(`inform_01/pjtAnuc.do`)은 11행 전부 iris.go.kr 링크뿐이라 값이 0이다.
    expect(kimstConfig.list.url(1)).toContain("/u/news/notice_01/board.do");
    expect(kimstConfig.list.url(1)).not.toContain("pjtAnuc");
    expect(kimstConfig.list.url(1)).not.toContain("notice_03");
    expect(combined.some((r) => r.detailUrl.includes("iris.go.kr"))).toBe(false);
  });

  it("★거르개 — 이벤트·개인정보·후보자·포럼·국제기구 인턴십·의견수렴을 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("퀴즈 이벤트"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보 제3자 제공"))).toBe(false);
    expect(titles.some((t) => t.includes("후보자"))).toBe(false);
    expect(titles.some((t) => t.includes("혁신포럼"))).toBe(false);
    expect(titles.some((t) => t.includes("인턴십"))).toBe(false);
    expect(titles.some((t) => t.includes("의견수렴"))).toBe(false);
    expect(isKimstDropTitle("해양수산과학기술진흥원 2026년도 개인정보보호 퀴즈 이벤트")).toBe(true);
    expect(isKimstDropTitle("2026년 공공기관 동반성장평가 체감도 조사 관련 개인정보 제3자 제공 알림")).toBe(true);
    expect(isKimstDropTitle("2026년 해양수산과학기술대상 후보자 추가 모집 공고")).toBe(true);
    expect(isKimstDropTitle("2026년도 제1회 해양수산 과학기술 혁신포럼 개최 안내")).toBe(true);
    expect(isKimstDropTitle("2026년도 해양수산 국제기구 인턴십 프로그램 공고")).toBe(true);
  });

  /**
   * ★2026-09-06 독립 리뷰 반영 — 넓게 잡았던 세 낱말을 좁혔다.
   * 네 수집기(kiria·knrec·kimst·wfi)가 **같은 낱말에 같은 판정**을 하게 맞춘 것이다.
   */
  it("★좁힌 거르개 — 「수요조사」·「인턴십」·「교육생 모집」을 통째로 버리지 않는다", () => {
    // ㉠ 수요조사: 기업 대상 수요조사가 많다 — 받는 쪽이 지자체일 때만 버린다(kiria 와 같은 꼴).
    expect(isKimstDropTitle("2026년도 수산업 현장 맞춤형 기술고도화 수요조사 공고")).toBe(false);
    expect(rowsP5.some((r) => r.title.includes("기술고도화 수요조사"))).toBe(true);
    expect(isKimstDropTitle("2027년 해양수산 실증센터 유치 희망 지자체 수요조사 공고")).toBe(true);
    // ㉡ 인턴십: 국제기구·해외 인턴십만 버린다 — 기업이 인턴을 받는 지원사업은 지킨다.
    expect(isKimstDropTitle("2026년 해양수산 중소기업 인턴십 지원사업 참여기업 모집")).toBe(false);
    expect(isKimstDropTitle("2026년도 해양수산 해외 인턴십 프로그램 공고")).toBe(true);
    // ㉢ 교육생 모집: 재직자·소상공인 교육 지원이 기업 대상이라 거르개에서 아예 뺐다.
    expect(isKimstDropTitle("2026년 해양 연구장비 활용 교육 · 시범 자격검정 과정 교육생 모집 공고")).toBe(false);
    expect(rowsP5.some((r) => r.title.includes("교육생 모집"))).toBe(true);
  });

  it("★지킬 것 — 인증·자금·상용화 지원은 남는다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles).toContain("2026 예비오션스타 기업 모집 공고");
    expect(titles).toContain("2026년도 하반기 해양수산신기술(NET) 인증 시행 공고");
    expect(titles).toContain("해양수산 기술사업화자금 대출지원사업 안내");
    expect(isKimstDropTitle("2026 예비오션스타 기업 모집 공고")).toBe(false);
    expect(isKimstDropTitle("해양수산 기술사업화자금 대출지원사업 안내")).toBe(false);
    // ★「개인정보」 단독·「행사」 단독으로는 안 버린다 — 지원사업이 같이 죽는다(kodma·실측 팸투어).
    expect(isKimstDropTitle("2026년 해양수산 개인정보보호 컨설팅 지원사업 참여기업 모집")).toBe(false);
    expect(isKimstDropTitle("2026년 해양수산 현장방문행사(팸투어) 참여기업 모집공고")).toBe(false);
    // ★「채용」을 통째로 버리지 않는다 — 고용보조금은 제목에 채용을 쓴다(cwip).
    expect(isKimstDropTitle("해양수산 중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
  });

  it("★돌연변이 — 행 선택자를 깨뜨리면 0건이 된다(서식 변경을 조용히 넘기지 않는다)", () => {
    const broken = listHtml.replace('<table class="table table-list">', '<table class="table table-listXX">');
    expect(parseKimstList(broken)).toHaveLength(0);
    expect(parseKimstList(listHtml)).toHaveLength(7); // 원복
  });
});

describe("해양수산과학기술진흥원 설정", () => {
  it("쪽넘김은 GET page — 1쪽과 2쪽 주소가 다르다", () => {
    expect(kimstConfig.list.url(1)).toBe("https://www.kimst.re.kr/u/news/notice_01/board.do?page=1");
    expect(kimstConfig.list.url(2)).toBe("https://www.kimst.re.kr/u/news/notice_01/board.do?page=2");
    expect(kimstConfig.list.maxPages).toBe(3);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(kimstConfig.id).toBe("kimst");
    expect(kimstConfig.label).toBe("해양수산과학기술진흥원");
    expect(kimstConfig.agency).toBe("해양수산과학기술진흥원");
    expect(kimstConfig.region).toBe("전국");
    expect(kimstConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kimstConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(kimstConfig.expectMinRows!);
    expect(rowsP5.length).toBeGreaterThanOrEqual(kimstConfig.expectMinRows!);
    expect(rowsP5).toHaveLength(7);
  });

  it("추측 단계를 끈다 — 거르개를 지나친 글과 메뉴가 공고로 저장된다", () => {
    expect(kimstConfig.skipHeuristic).toBe(true);
  });
});

describe("해양수산과학기술진흥원 상세 — 실사이트 고정본", () => {
  it("본문은 div.bbs-article-detail 에서 뽑는다", async () => {
    const text = await fetchBoardDetail(
      kimstConfig,
      "https://www.kimst.re.kr/u/news/notice_01/board.do?type=view&bno=153421765145800",
      { fetchText: async () => detailHtml },
    );
    expect(text.startsWith("해양수산부 공고 제2026-1276호")).toBe(true);
    expect(text).toContain("해양수산 유망기업 발굴 및 지원을 위해");
    // 본문 안의 `<!--[data-hwpjson]…-->` 주석은 글자로 새어 나오면 안 된다(파서가 주석을 버린다).
    expect(text).not.toContain("data-hwpjson");
  });

  it("첨부 1건을 /fileDown.do 평문 주소로 집는다(실호출 200 + HWP 76,288바이트)", () => {
    const scoped = parseHtml(detailHtml)
      .querySelectorAll(kimstConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, kimstConfig.baseUrl, detailHtml, kimstConfig.charset);
    expect(atts).toHaveLength(1);
    expect(atts[0].url).toContain("https://www.kimst.re.kr/fileDown.do?fn=filename_202608240449451506");
    expect(atts[0].name).toBe("[공고] 2026년 예비오션스타 모집 공고문.hwp");
    expect(atts[0].kind).toBe("hwp");
    expect(safeAttachmentUrl(atts[0].url)).not.toBeNull();
  });

  it("★본문 편집기가 심은 그림 주소(/download.do?fn=editor_…)가 첨부로 안 들어간다", () => {
    const scoped = parseHtml(detailHtml)
      .querySelectorAll(kimstConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, kimstConfig.baseUrl, detailHtml, kimstConfig.charset);
    expect(atts.some((a) => a.url.includes("editor_"))).toBe(false);
    expect(kimstConfig.attachmentsScopeSelector).toBe("div.file-item");
    // 실물로 「첨부 없는 상세에도 상자가 있다」를 못 봤으므로 필수 판정은 켜지 않는다.
    expect(kimstConfig.attachmentsScopeRequired).toBeUndefined();
  });

  it("첨부 상자 선택자가 바뀌면 0건이 된다 — 서식 변경을 조용히 넘기지 않는다", () => {
    const broken = parseHtml(detailHtml.replaceAll('class="file-item"', 'class="file-itemXX"'))
      .querySelectorAll(kimstConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(broken).toBe("");
  });
});
