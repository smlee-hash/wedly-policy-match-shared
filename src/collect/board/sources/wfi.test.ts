import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWfiDropTitle, parseWfiList, wfiConfig } from "./wfi";
import { harvestBoardAttachments } from "../detail-fill";
import { fetchBoardDetail } from "../engine";
import { safeAttachmentUrl } from "@/lib/policy-match/attachment-text";
import { parseHtml } from "../html";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 사업공고 목록(`/communication/?b=B_1_14`)과
 * 상세 1건(`view.do?b=B_1_14&bn=518`).
 * ⚠️상세 고정본은 원본 1,895,035바이트를 **그림 알맹이만 잘라** 담았다 —
 *   본문이 통째로 base64 그림이라 그대로 두면 고정본 하나가 1.9MB 다. 태그 구조·첨부·개수는 그대로다.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/wfi-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/wfi-detail.html"), "utf-8");
const rows = parseWfiList(listHtml);

describe("원주미래산업진흥원 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("13행을 그대로 12…13건 읽고 첫 행 값이 맞다 — 이 판에는 버릴 글이 없다", () => {
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject({
      title:
        "⌈2026년 강원 앵커사업 [미래모빌리티 분과]⌋ 2026년 미래모빌리티 기술사업화 지원사업 공고",
      detailUrl: "https://wfi.or.kr/communication/view.do?b=B_1_14&bn=518",
      // 목록에 마감일 칸이 없다 — 「등록일 ~」 개시형이다(저장 규칙이 90일로 닫는다).
      dateText: "2026-08-18 ~",
      agency: "원주미래산업진흥원",
    });
  });

  it("등록일은 td.tbl-date 칸에서만 집는다 — 행 전체 글자면 번호·조회수가 붙는다", () => {
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    // 첫 행의 번호는 13, 조회수는 78 — 날짜 글자에 들어오면 안 된다.
    expect(rows[0].dateText).not.toMatch(/\b13\b|\b78\b/);
    // 2025년 글도 자기 등록일을 그대로 갖는다(옆 행 날짜가 새지 않는다).
    expect(rows.find((r) => r.detailUrl.endsWith("bn=135"))?.dateText).toBe("2025-04-09 ~");
    expect(rows.find((r) => r.detailUrl.endsWith("bn=389"))?.dateText).toBe("2026-04-17 ~");
  });

  it("상세 주소는 b+bn 으로만 조립하고 m_type·nPage·검색 인자가 안 섞인다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(/^https:\/\/wfi\.or\.kr\/communication\/view\.do\?b=B_1_14&bn=\d+$/);
      expect(r.detailUrl).not.toMatch(/m_type=/);
      expect(r.detailUrl).not.toMatch(/nPage=/);
    }
    const bns = rows.map((r) => r.detailUrl);
    expect(new Set(bns).size).toBe(bns.length);
  });

  it("★제목 칸의 첨부 표시 링크(a.file)를 실제로 재고 넘어간다", () => {
    // ① 고정본에 정말로 두 앵커가 있는가 — 없으면 아래 단언은 아무것도 안 재는 껍데기다.
    const cells = parseHtml(listHtml).querySelectorAll("table.tbl tbody tr td.tbl-tit");
    expect(cells.length).toBe(13);
    const twoAnchor = cells.filter((td) => td.querySelectorAll("a").length >= 2);
    expect(twoAnchor.length).toBe(13); // 13행 전부 제목+첨부표시 두 개다
    expect(twoAnchor[0].querySelectorAll("a.file")).toHaveLength(1);
    // 첨부 표시 링크의 글자는 「첨부파일」이고 상세 주소가 제목 링크와 같다 — 그래서 위험하다.
    expect(twoAnchor[0].querySelector("a.file")?.text.trim()).toBe("첨부파일");
    expect(twoAnchor[0].querySelector("a.file")?.getAttribute("href")).toContain("bn=518");
    // ② 파서는 「첨부파일」을 제목으로 담지 않는다.
    expect(rows.some((r) => r.title === "첨부파일")).toBe(false);
    // ③ ★돌연변이 — `a.link` 표식을 없애면 0건이 된다(선택자가 실제로 일한다는 증거).
    expect(parseWfiList(listHtml.replaceAll('class="link"', 'class="linkXX"'))).toHaveLength(0);
    expect(parseWfiList(listHtml)).toHaveLength(13); // 원복
  });

  it("★거르개 — 실측 13건에는 버릴 글이 없고, 공지사항 판용 좁은 꼴만 미리 둔다", () => {
    // 공지사항 판(B_1_1)이 합쳐지는 날을 대비한 갈래 — 지금 이 판에는 안 들어온다.
    expect(isWfiDropTitle("GPU 팜 구축 공사 견적 제출 안내")).toBe(true);
    expect(isWfiDropTitle("(재)원주미래산업진흥원 임원 초빙 공고")).toBe(true);
    expect(isWfiDropTitle("서버 임대 입찰 공고")).toBe(true);
    // 지킬 것: 참여기업·수요기업 모집이 곧 지원사업이다.
    expect(rows.some((r) => r.title.includes("모빌리티 국제표준인증(ISO)"))).toBe(true);
    expect(isWfiDropTitle("2026 모빌리티 국제표준인증(ISO) 지원사업 참여기업 추가 모집 공고")).toBe(false);
    expect(isWfiDropTitle("2026 원주시 중소기업 화재보험 지원 참가기업 모집 공고")).toBe(false);
  });

  /**
   * ★2026-09-06 독립 리뷰 반영 — `교육생 모집` 을 거르개에서 뺐다(kimst 와 같은 판정).
   * 재직자·소상공인 교육 지원이 기업 대상 지원사업이라, 그 낱말을 통째로 버리면 그쪽이 같이 죽는다.
   * 실측 1건(교육발전특구 진로체험)은 학생 대상이지만 한 건 때문에 낱말을 버리지 않는다.
   */
  it("★「교육생 모집」을 버리지 않는다 — 실측 1건이 그대로 들어온다", () => {
    expect(isWfiDropTitle("2026년 원주시 소상공인 실무역량 교육생 모집")).toBe(false);
    expect(
      isWfiDropTitle("2025년 원주시 교육발전특구 첨단분야 진로체험 여름방학 교육생 모집(신청 기간 연장)"),
    ).toBe(false);
    expect(rows.some((r) => r.title.includes("교육생 모집"))).toBe(true);
    expect(rows.find((r) => r.detailUrl.endsWith("bn=184"))?.dateText).toBe("2025-06-27 ~");
  });

  it("★강원TP 공동 공고 2건은 제목을 원문 그대로 담는다 — 병합은 저장 쪽 dedupKey 몫", () => {
    const shared = rows.filter((r) => r.title.startsWith("[강원테크노파크"));
    expect(shared).toHaveLength(2);
    expect(shared[0].title).toBe(
      "[강원테크노파크 공통] 강원 바이오-헬스케어 AI 대전환 수요기업 모집 공고",
    );
  });

  it("★돌연변이 — 행 선택자를 깨뜨리면 0건이 된다(서식 변경을 조용히 넘기지 않는다)", () => {
    const broken = listHtml.replace('<table class="tbl">', '<table class="tblXX">');
    expect(parseWfiList(broken)).toHaveLength(0);
    expect(parseWfiList(listHtml)).toHaveLength(13); // 원복
  });
});

describe("원주미래산업진흥원 설정", () => {
  it("쪽넘김은 GET nPage — 1쪽과 2쪽 주소가 다르다", () => {
    expect(wfiConfig.list.url(1)).toBe("https://wfi.or.kr/communication/?b=B_1_14&nPage=1");
    expect(wfiConfig.list.url(2)).toBe("https://wfi.or.kr/communication/?b=B_1_14&nPage=2");
    expect(wfiConfig.list.maxPages).toBe(2);
  });

  it("★거울 게시판(B_1_5 국가R&D통합공고·B_1_1 타기관)을 읽지 않는다", () => {
    expect(wfiConfig.list.url(1)).toContain("b=B_1_14");
    expect(wfiConfig.list.url(1)).not.toContain("B_1_5");
    expect(wfiConfig.list.url(1)).not.toContain("B_1_1&");
    expect(wfiConfig.list.url(1)).not.toContain("OTORG");
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(wfiConfig.id).toBe("wfi");
    expect(wfiConfig.label).toBe("원주미래산업진흥원");
    expect(wfiConfig.agency).toBe("원주미래산업진흥원");
    expect(wfiConfig.region).toBe("강원");
    expect(wfiConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(wfiConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(wfiConfig.expectMinRows!);
  });

  it("추측 단계를 끈다 — 첨부 표시 링크가 공고로 저장된다", () => {
    expect(wfiConfig.skipHeuristic).toBe(true);
  });

  /**
   * ★마감이 첨부 PDF 에만 있다(2026-09-06 독립 리뷰 [높음] 2).
   * 안 켜면 등록일 기준 90일이 지난 줄이 첫 저장에서 닫히고, 닫힌 줄은 첨부 채움 줄서기
   * (`status:"open"`)에 못 들어가 첨부를 영영 안 읽는다 → 마감도 조건도 영영 0.
   */
  it("★마감-첨부 유예 옵션이 켜져 있다 — 13건 중 7건이 등록일 90일 초과다(2026-09-06 기준)", () => {
    expect(wfiConfig.deadlineInAttachments).toBe(true);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const stale = rows.filter((r) => r.dateText.slice(0, 10) < ninetyDaysAgo);
    // 고정본 날짜는 멈춰 있고 「지금」은 흐르므로 초과 건수는 늘기만 한다 — 하한으로 잰다.
    expect(stale.length).toBeGreaterThanOrEqual(7);
    // 목록엔 마감 칸이 없다 — 그래서 유예가 없으면 이 8건이 첫 저장에서 그대로 닫힌다.
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });
});

describe("원주미래산업진흥원 상세 — 실사이트 고정본", () => {
  it("★본문에는 글자가 없다 — 공고문을 통째로 그림으로 올린다(자격조건은 첨부 PDF 몫)", async () => {
    const text = await fetchBoardDetail(
      wfiConfig,
      "https://wfi.or.kr/communication/view.do?b=B_1_14&bn=518",
      { fetchText: async () => detailHtml },
    );
    expect(text).toBe("");
    // 제목은 상세에도 온전히 있다 — 목록 제목이 잘려 오지 않으므로 승격 설정은 안 둔다.
    expect(parseHtml(detailHtml).querySelector("div.view-title-wrap h2.title")?.text.trim()).toBe(
      "⌈2026년 강원 앵커사업 [미래모빌리티 분과]⌋ 2026년 미래모빌리티 기술사업화 지원사업 공고",
    );
    expect(wfiConfig.detailTitle).toBeUndefined();
  });

  it("첨부 4건을 한글 파일 이름 그대로 집는다(실호출 200 + PDF 533,794바이트, 쿠키 불필요)", () => {
    const scoped = parseHtml(detailHtml)
      .querySelectorAll(wfiConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, wfiConfig.baseUrl, detailHtml, wfiConfig.charset);
    // 사이트가 붙임1·2를 두 벌씩 올려 두었다(file_no 544~547).
    expect(atts).toHaveLength(4);
    expect(atts.map((a) => a.url)).toEqual([
      "https://wfi.or.kr/_common/new_download_file.php?menu=boardfile&file_no=544",
      "https://wfi.or.kr/_common/new_download_file.php?menu=boardfile&file_no=546",
      "https://wfi.or.kr/_common/new_download_file.php?menu=boardfile&file_no=545",
      "https://wfi.or.kr/_common/new_download_file.php?menu=boardfile&file_no=547",
    ]);
    // ★공고문이 앞으로 온다 — 첨부에서 본문을 뽑는 단계가 앞 파일부터 읽는다.
    expect(atts[0].name).toBe(
      "[붙임1] 사업 공고문(2026년 앵커사업 미래모빌리티 기술사업화 지원사업_공고).pdf",
    );
    expect(atts[0].kind).toBe("pdf");
    expect(atts[2].kind).toBe("hwp");
    for (const a of atts) expect(safeAttachmentUrl(a.url)).not.toBeNull();
  });

  it("★첨부 통로는 robots 가 막은 /upload_data/ 가 아니다 — /_common/ 이라 허용 범위다", () => {
    const scoped = parseHtml(detailHtml)
      .querySelectorAll(wfiConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, wfiConfig.baseUrl, detailHtml, wfiConfig.charset);
    expect(atts.every((a) => a.url.includes("/_common/new_download_file.php"))).toBe(true);
    expect(atts.some((a) => a.url.includes("/upload_data/"))).toBe(false);
    expect(atts.some((a) => a.url.includes("/manager/"))).toBe(false);
  });

  it("첨부 상자 선택자가 바뀌면 0건이 된다 — 서식 변경을 조용히 넘기지 않는다", () => {
    const broken = parseHtml(detailHtml.replaceAll('class="file-area"', 'class="file-areaXX"'))
      .querySelectorAll(wfiConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(broken).toBe("");
    // 실물로 「첨부 없는 상세에도 상자가 있다」를 못 봤으므로 필수 판정은 켜지 않는다.
    expect(wfiConfig.attachmentsScopeRequired).toBeUndefined();
  });
});
