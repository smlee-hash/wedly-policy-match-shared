import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isKidpDropTitle, parseKidpList, kidpConfig } from "./kidp";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-02 실측 「사업부 전체소식」 1·2쪽(`?menuno=1202&pageIndex=1|2`)과
 * 첨부가 달린 상세 1건(`bbsno=19218`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kidp-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kidp-list-p2.html"), "utf-8");
const rows = parseKidpList(listHtml);
const combined = parseKidpList(listHtml + listP2Html);

const ZTAG =
  "rO0ABXQAMzxjYWxsIHR5cGU9ImJvYXJkIiBubz0iNjIyIiBza2luPSJraWRwX2JicyI%2BPC9jYWxsPg%3D%3D";

describe("한국디자인진흥원 사업부 전체소식 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 10행에서 DROP 을 뺀 3건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      title: "(문화산단1기) 창원 청년디자인리빙랩 틈새문화 시범운영 안내 및 사전신청 방법",
      detailUrl: `https://www.kidp.or.kr/?menuno=1202&bbsno=19219&siteno=16&act=view&ztag=${ZTAG}`,
      dateText: "2026-09-02 ~",
    });
    // 이 게시판은 KIDP 자기 소식판이라 행마다 기관이 갈리지 않는다(제목 앞 대괄호는
    // 「[중국센터]」·「[교육생 모집]」·「[공고]」처럼 기관명이 아니다 — kbiz 와 다른 점).
    expect(rows.every((r) => r.agency === undefined)).toBe(true);
    expect(kidpConfig.agency).toBe("한국디자인진흥원");
  });

  it("★상세 주소에 ztag 를 반드시 담는다 — 빼면 본문이 0바이트로 온다(2026-09-03 실측)", () => {
    // curl 실측: `?menuno=1202&bbsno=19218&siteno=16&act=view` 는 HTTP 200 인데 **본문 0바이트**,
    // ztag 를 붙이면 39,857자. 이 값이 곧 게시판 번호(boardno=622)·스킨 지정이다.
    expect(rows.every((r) => r.detailUrl.includes(`ztag=${ZTAG}`))).toBe(true);
    // `+` 가 날것으로 들어가면 서버가 공백으로 읽어 빈 본문이 된다 — 반드시 %2B 로.
    expect(rows.every((r) => !/ztag=[^&]*\+/.test(r.detailUrl))).toBe(true);
  });

  it("★상세 주소에 쪽 번호(pageIndex)가 섞이지 않는다 — 섞이면 같은 글이 쪽마다 다른 줄로 저장된다", () => {
    // 주소가 곧 중복 판정 열쇠(sourceId)다.
    expect(combined.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 6건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(6);
    // 2쪽의 진짜 지원사업이 살아 있다.
    expect(combined.some((r) => r.title.includes("상호직무훈련"))).toBe(true);
  });

  it("등록일만 주는 게시판이라 개시형(`YYYY-MM-DD ~`)으로 넘긴다", () => {
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("★날짜는 3번째 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("bbsno=19219"));
    // 같은 행의 번호(12435)·조회수(21)가 날짜에 붙으면 안 된다.
    expect(r?.dateText).toBe("2026-09-02 ~");
    expect(r?.dateText).not.toMatch(/12435|21/);
    // 증거: 행 전체 글자에서는 등록일과 조회수(21)가 실제로 이어 붙는다.
    const tr = parseHtml(listHtml).querySelectorAll("table.board01-list > tbody > tr")[1];
    expect(tr.text.replace(/\s+/g, "")).toContain("2026-09-0221");
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다 — 입찰·심사 진행·공개검증·자가진단·가이드북·후기", () => {
    const titles = combined.map((t) => t.title);
    expect(titles.some((t) => t.includes("입찰"))).toBe(false);
    expect(titles.some((t) => t.includes("자가진단"))).toBe(false);
    expect(titles.some((t) => t.includes("공개검증"))).toBe(false);
    expect(titles.some((t) => t.includes("가이드북"))).toBe(false);
    expect(isKidpDropTitle("(부산, 원주, 인천) 청년디자인리빙랩 및 산업단지 브랜드 개발 용역 입찰 공고 알림")).toBe(true);
    expect(isKidpDropTitle("2026 더 편한일터 편의시설 자가진단지 - 한국장애인고용공단. 2026")).toBe(true);
    expect(isKidpDropTitle("2026 GOOD DESIGN KOREA(우수디자인상품선정) 후보자 공개검증")).toBe(true);
    expect(isKidpDropTitle("2026년 제61회 대한민국디자인전람회 3차  심사 진행 안내")).toBe(true);
    expect(isKidpDropTitle("2026 GOOD DESIGN KOREA(우수디자인상품선정) 2차 발표 심사 참관 모집 안내")).toBe(true);
    expect(isKidpDropTitle("산업현장 안전디자인 가이드북 모음 (2021~2025) - 한국디자인진흥원")).toBe(true);
    expect(isKidpDropTitle("정책디자인의 시대로의 전환과 과제 - 2026 한국정책학회 하계학술대회 중 정책디자인연구회 후기")).toBe(true);
    // 경영공시 갈래(3·4·5·8쪽 실측) — 기업이 신청할 것이 아니다.
    expect(isKidpDropTitle("기관장 업무추진비 현황 (2026.7)")).toBe(true);
    expect(isKidpDropTitle("징계현황(2026.4~2026.6)")).toBe(true);
    expect(isKidpDropTitle("고문변호사 및 법률자문 현황(2026.1.1.~2026.6.30.)")).toBe(true);
    expect(isKidpDropTitle("소송 및 소송대리인 현황(2026.1.1.~2026.6.30.)")).toBe(true);
    // 입찰 앞단계(사전 규격 공개)도 기업 지원사업이 아니다 — 3쪽 실측.
    expect(isKidpDropTitle("(부산, 인천, 원주) 청년디자인리빙랩 및 산업단지 브랜드 개발 용역 사전 규격 공고 알림")).toBe(true);
  });

  it("★DROP 을 넓게 잡지 않는다 — 「채용 지원사업」·「우수사례 공모」·「이후기간」은 살아남는다", () => {
    expect(isKidpDropTitle("2026년 청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isKidpDropTitle("2026년 디자인 우수사례 공모전 참가기업 모집")).toBe(false);
    expect(isKidpDropTitle("2026년 디자인전문기업 금융지원 희망기업 24차 모집 공고")).toBe(false);
    expect(isKidpDropTitle("사업 신청 이후기간 연장 안내")).toBe(false);
    // 진짜 사람 뽑는 글만 좁게 버린다.
    expect(isKidpDropTitle("2026년 정규직 신규 채용 공고")).toBe(true);
  });

  it("★1년 넘은 등록일은 담지 않는다 — 개시형이라 오래된 글이 「모집중」으로 되살아난다", () => {
    // 이 게시판엔 붙박이 공지가 없다(1~8쪽 실측: 번호 12436→12357 이 한 칸씩 줄고 날짜도 단조 감소).
    // 대신 게시가 뜸해지면 8쪽까지 파는 사이 1년 전 글이 딸려 온다 — 그때를 막는 나이 검사.
    expect(parseKidpList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"))).toHaveLength(0);
    // 지금 시점(고정본 기준)에서는 한 줄도 이 검사에 걸리지 않는다 — 죽은 코드가 아니라는 증거.
    expect(parseKidpList(listHtml, 1, Date.parse("2026-09-03T00:00:00Z"))).toHaveLength(3);
  });

  it("★행 선택자가 실제로 쓰인다 — 표 class 한 글자를 바꾸면 0행", () => {
    expect(parseKidpList(listHtml.replace(/board01-list/g, "board01-listx"))).toHaveLength(0);
    expect(parseHtml(listHtml).querySelectorAll("table.board01-listx > tbody > tr")).toHaveLength(0);
  });

  it("★제목 선택자가 실제로 쓰인다 — 제목 칸 class 를 바꾸면 0행", () => {
    expect(parseKidpList(listHtml.replace(/class="left"/g, 'class="leftx"'))).toHaveLength(0);
  });
});

describe("한국디자인진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex — 이 게시판에서 `page` 는 아무 효과가 없다(2026-09-03 실측)", () => {
    expect(kidpConfig.list.url(1)).toBe("https://www.kidp.or.kr/?menuno=1202&pageIndex=1");
    expect(kidpConfig.list.url(2)).toBe("https://www.kidp.or.kr/?menuno=1202&pageIndex=2");
    expect(kidpConfig.list.url(2)).not.toContain("page=2");
    expect(kidpConfig.list.maxPages).toBe(8);
  });

  it("지역은 전국 · 기관은 한국디자인진흥원", () => {
    expect(kidpConfig.region).toBe("전국");
    expect(kidpConfig.agency).toBe("한국디자인진흥원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같고, 3보다 크면 1·2쪽이 통째로 버려진다", () => {
    expect(kidpConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    // 1·2쪽 실측 생존 3건 — 기대치를 그보다 높이면 정상 회차가 「서식 깨짐」으로 버려진다.
    expect(kidpConfig.expectMinRows).toBeLessThanOrEqual(3);
  });

  it("★heuristic 추측 단계를 끈다 — 목록 행 링크가 href='#none' 이라 추측은 메뉴만 줍는다", () => {
    expect(kidpConfig.skipHeuristic).toBe(true);
    const anchors = parseHtml(listHtml).querySelectorAll("table.board01-list > tbody > tr td.left a");
    expect(anchors).toHaveLength(10);
    expect(anchors.every((a) => a.getAttribute("href") === "#none")).toBe(true);
    // 같은 쪽에서 진짜 주소를 가진 링크는 왼쪽 메뉴(`/?menuno=…`)뿐이다.
    expect(listHtml).toContain('href="/?menuno=1010"');
  });
});

/**
 * ★상세 본문·첨부 자리 — 2026-09-03 실측 고정본(`bbsno=19218`, 첨부 PDF 1개).
 */
describe("상세 본문·첨부 자리", () => {
  const detailHtml = readFileSync(join(__dirname, "../__fixtures__/kidp-detail.html"), "utf-8");
  const doc = parseHtml(detailHtml);

  it("본문 선택자가 진짜 공고 본문을 잡는다", () => {
    expect(kidpConfig.detailContentSelector).toBe("div.bbs_list");
    const body = doc.querySelector(kidpConfig.detailContentSelector!)!;
    const text = body.text.replace(/\s+/g, " ").trim();
    expect(text.length).toBeGreaterThan(300);
    expect(text).toContain("안전디자인");
  });

  it("본문 선택자를 한 글자 바꾸면 못 잡는다 — 선택자가 실제로 쓰인다는 증거", () => {
    expect(doc.querySelector("div.bbs_listx")).toBeNull();
  });

  it("★첨부 범위가 진짜 파일 하나만 담는다 — 미리보기(pdfjs) 주소를 첨부로 저장하지 않는다", () => {
    const scoped = doc
      .querySelectorAll(kidpConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const files = [...scoped.matchAll(/["']([^"']+\.(?:pdf|hwp|hwpx|zip)(?:\?[^"']*)?)["']/gi)].map(
      (m) => m[1],
    );
    expect(files).toEqual(["/usr/upload/board/zboardcommon333/20260831112915807_6689.0.pdf"]);
    // 증거: 표 전체로 넓히면 pdfjs 뷰어 주소가 가짜 첨부로 딸려 온다.
    const wide = doc.querySelector("table.board02-list")!.outerHTML;
    expect(wide).toContain("/pdfjs/web/viewer.jsp?file=");
  });

  it("첨부 범위 선택자를 한 글자 바꾸면 못 잡는다", () => {
    expect(doc.querySelectorAll("table.board02-listx a")).toHaveLength(0);
  });
});
