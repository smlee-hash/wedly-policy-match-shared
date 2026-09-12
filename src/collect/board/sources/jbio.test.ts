import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { harvestBoardAttachments } from "../detail-fill";
import { isJbioDropTitle, jbioConfig, jbioDetailUrl, parseJbioList } from "./jbio";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본(2026-09-06 국내 회선 실측):
 * · `jbio-list.html` = `https://jbio.or.kr/boardList.do?boardId=5&sub=02_02` (11행)
 * · `jbio-detail.html` = `https://jbio.or.kr/boardView.do?boardId=5&…&dataNo=1650&…`
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/jbio-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/jbio-detail.html"), "utf-8");
const rows = parseJbioList(listHtml);

describe("진주바이오산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 11행에서 거르개를 지난 10건을 읽고 첫 행(공지)이 맞다", () => {
    expect(parseHtml(listHtml).querySelectorAll("table.basicList tbody tr")).toHaveLength(11);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title:
        "[수정공고] 「2026 인도네시아 자카르타 K-뷰티&푸드 소비재 수출상담회 지역 수출컨소시엄」참여기업 모집",
      detailUrl: "https://jbio.or.kr/boardView.do?boardId=5&fieldNo=0&dataNo=1650&sub=02_02",
      dateText: "2026-08-21 ~",
      agency: "진주바이오산업진흥원",
    });
  });

  it("★상세 주소는 dataNo 로 조립한다 — href 는 javascript: 라 그대로 쓰면 전 행이 같은 주소가 된다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/jbio\.or\.kr\/boardView\.do\?boardId=5&fieldNo=0&dataNo=\d+&sub=02_02$/,
      );
      expect(r.detailUrl).not.toContain("javascript:");
    }
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("★상세 주소에 쪽 변수(nowPage)를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("nowPage"))).toBe(true);
    expect(jbioDetailUrl("1637")).toBe(
      "https://jbio.or.kr/boardView.do?boardId=5&fieldNo=0&dataNo=1637&sub=02_02",
    );
  });

  it("등록일은 작성일 칸에서만 집고 시각을 뗀다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("dataNo=1637"));
    expect(r).toMatchObject({
      title: "2026년 창업보육센터 입주기업 지원사업 공고",
      dateText: "2026-07-13 ~",
    });
    expect(r?.dateText).not.toMatch(/194/);
    expect(r?.dateText).not.toMatch(/16:24/);
    for (const row of rows) expect(row.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("거르개가 실측 제목을 실제로 버린다 — 기관 조달(입찰·위탁사업자)", () => {
    expect(rows.some((r) => r.title.includes("위탁사업자"))).toBe(false);
    expect(rows.some((r) => r.detailUrl.includes("dataNo=1616"))).toBe(false);
    expect(isJbioDropTitle("(재)진주바이오산업진흥원 구내식당 위탁사업자 입찰공고")).toBe(true);
    expect(isJbioDropTitle("사무용품 견적 제출 안내")).toBe(true);
    // 사람 뽑는 글도 지원사업이 아니다(hespa 와 같은 처리 — 독립 리뷰 5번)
    expect(isJbioDropTitle("제안서 평가위원(후보자) 공개모집")).toBe(true);
    expect(rows.some((r) => r.title.includes("평가위원"))).toBe(false);
  });

  it("★「모집」·「공고」·「지원사업」은 살린다 — 통째로 버리면 이 판의 값이 사라진다", () => {
    expect(isJbioDropTitle("2026년 그린바이오 특화역량 BI 육성지원사업 참여기업 모집")).toBe(false);
    expect(rows.some((r) => r.title.includes("그린바이오 특화역량 BI 육성지원사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("바우처형 연구서비스사업"))).toBe(true);
  });
});

describe("진주바이오산업진흥원 상세 — 본문·첨부 선택자를 실측 고정본에 들이댄다", () => {
  const doc = parseHtml(detailHtml);

  it("본문 선택자가 실제 상세를 잡고 공고문 첫 문장이 들어 있다", () => {
    const body = doc.querySelector(jbioConfig.detailContentSelector!);
    expect(body).not.toBeNull();
    expect(body!.text.replace(/\s+/g, " ")).toContain("(재)진주바이오산업진흥원 공고 2026- 33호");
  });

  it("첨부 범위 안에서 파일 한 건을 수확한다 — 이름·주소가 실측과 같다", () => {
    const scoped = doc
      .querySelectorAll(jbioConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(scoped).not.toBe("");
    const files = harvestBoardAttachments(scoped, jbioConfig.baseUrl, detailHtml, jbioConfig.charset);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(
      "(공고) 2026 인도네시아 자카르타 K-뷰티&푸드 소비재 수출상담회 지역수출컨소시엄 참여기업 모집(수정공고).hwp",
    );
    expect(files[0].url).toContain("/fileDownload.do");
    expect(files[0].url).toContain("fileNo=1770");
    expect(files[0].url).toContain("boardId=5");
    expect(files[0].url.startsWith("https://jbio.or.kr/")).toBe(true);
  });

  it("첨부 범위 이름이 한 글자 틀리면 한 조각도 안 잡힌다", () => {
    expect(doc.querySelector("div.conField-x")).toBeNull();
    expect(doc.querySelector("div.conText-x")).toBeNull();
  });
});

describe("진주바이오산업진흥원 설정", () => {
  it("쪽넘김은 &nowPage={n} 이고 1쪽에도 붙는다 — 엔진이 쪽 변수를 알아내는 근거다", () => {
    expect(jbioConfig.list.url(1)).toBe("https://jbio.or.kr/boardList.do?boardId=5&sub=02_02&nowPage=1");
    expect(jbioConfig.list.url(2)).toBe("https://jbio.or.kr/boardList.do?boardId=5&sub=02_02&nowPage=2");
    expect(jbioConfig.list.url(1)).not.toBe(jbioConfig.list.url(2));
    expect(jbioConfig.list.maxPages).toBe(3);
  });

  it("★사업공고(boardId=5)만 읽는다 — 타기관 소식(25)은 재게시라 중복이 난다", () => {
    expect(jbioConfig.list.url(1)).toContain("boardId=5");
    expect(jbioConfig.list.url(1)).not.toContain("boardId=25");
    expect(jbioConfig.list.url(1)).not.toContain("boardId=26");
  });

  it("★국내 경유 전용이다 — 설정값이 없으면 회차에서 빠진다", () => {
    expect(jbioConfig.requiresProxy).toBe(true);
  });

  it("id·기관·지역·서식 변경 감지·추측 끄기", () => {
    expect(jbioConfig.id).toBe("jbio");
    expect(jbioConfig.agency).toBe("진주바이오산업진흥원");
    expect(jbioConfig.region).toBe("경남");
    expect(jbioConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(jbioConfig.skipHeuristic).toBe(true);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseJbioList(listHtml.replaceAll('class="basicList"', 'class="basicList-x"'))).toHaveLength(0);
  });

  it("제목 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJbioList(listHtml.replaceAll('class="title"', 'class="subject"'))).toHaveLength(0);
  });

  it("상세 열쇠 함수 이름이 바뀌면 한 줄도 못 읽는다 — 헛주소를 저장하지 않는다", () => {
    expect(parseJbioList(listHtml.replaceAll("viewData(", "viewDataX("))).toHaveLength(0);
  });

  it("작성일 칸이 비면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const blanked = listHtml.replaceAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "");
    const parsed = parseJbioList(blanked);
    expect(parsed).toHaveLength(10);
    expect(parsed.every((r) => r.dateText === "")).toBe(true);
  });
});

it("붙박이가 남아도 공식 쪽수와 빈 목록이 함께 끝을 확인한다", async () => {
  const { fetchBoardWindow } = await import("../page-window");
  const html = readFileSync(join(__dirname, "../__fixtures__/jbio-page21.html"), "utf-8");
  const result = await fetchBoardWindow(jbioConfig, { prevOpenCount: 0, fetchText: async () => html, askModel: async () => "{}", onAllFailed: () => {} }, { startPage: 21, pageBudget: 1 });
  expect(result).toMatchObject({ complete: true, reason: "source-end", nextPage: 21 });
});

it.each(["쪽수 불일치", "빈 목록 미확인", "쪽수 미확인"])("%s이면 진주 공고의 끝으로 단정하지 않는다", async kind => {
  const { fetchBoardWindow } = await import("../page-window");
  let html = readFileSync(join(__dirname, "../__fixtures__/jbio-page21.html"), "utf-8");
  if (kind === "쪽수 불일치") html = html.replace("21/20", "20/20");
  if (kind === "빈 목록 미확인") html = html.replace("게시물이 없습니다.", "요청 처리 오류");
  if (kind === "쪽수 미확인") html = html.replace("count-2", "count-changed");
  const result = await fetchBoardWindow(jbioConfig, { prevOpenCount: 0, fetchText: async () => html, askModel: async () => "{}", onAllFailed: () => {} }, { startPage: 21, pageBudget: 1 });
  expect(result.complete).toBe(false);
});
