import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harvestBoardAttachments } from "../detail-fill";
import { parseHtml } from "../html";
import {
  isMinistryDropTitle,
  mndConfig,
  mndTargetOf,
  moisConfig,
  mpvaConfig,
  parseMndList,
  parseMndRaw,
  parseMoisList,
  parseMoisRaw,
  parseMpvaList,
  parseMpvaRaw,
} from "./ministries";

const F = join(__dirname, "../__fixtures__");
const load = (name: string) => readFileSync(join(F, name), "utf-8");

const moisList = load("mois-list.html");
const moisP2 = load("mois-page2.html");
const moisDetail = load("mois-detail.html");
const mpvaList = load("mpva-list.html");
const mpvaP2 = load("mpva-page2.html");
const mpvaDetail = load("mpva-detail.html");
const mndList = load("mnd-list.html");
const mndP2 = load("mnd-page2.html");
const mndNotice = load("mnd-notice.html");
const mndNoticeP2 = load("mnd-notice-page2.html");
const mndProducts = load("mnd-products.html");
const mndProductsP2 = load("mnd-products-page2.html");
const mndDetail = load("mnd-detail.html");

const moisRaw = parseMoisRaw(moisList);
const moisRows = parseMoisList(moisList);
const moisRawP2 = parseMoisRaw(moisP2);
const moisRowsP2 = parseMoisList(moisP2);
const mpvaRaw = parseMpvaRaw(mpvaList);
const mpvaRows = parseMpvaList(mpvaList);
const mpvaRawP2 = parseMpvaRaw(mpvaP2);
const mpvaRowsP2 = parseMpvaList(mpvaP2);
const mndRaw = parseMndRaw(mndList);
const mndRows = parseMndList(mndList);
const mndRawP2 = parseMndRaw(mndP2);
const mndRowsP2 = parseMndList(mndP2);
const mndNoticeRaw = parseMndRaw(mndNotice);
const mndNoticeRows = parseMndList(mndNotice);
const mndNoticeRawP2 = parseMndRaw(mndNoticeP2);
const mndNoticeRowsP2 = parseMndList(mndNoticeP2);
const mndProdRaw = parseMndRaw(mndProducts);
const mndProdRows = parseMndList(mndProducts);
const mndProdRawP2 = parseMndRaw(mndProductsP2);
const mndProdRowsP2 = parseMndList(mndProductsP2);

function urlsOf(rows: { detailUrl: string }[]): string[] {
  return rows.map((r) => r.detailUrl);
}

function isSubset(inner: { detailUrl: string }[], outer: { detailUrl: string }[]): boolean {
  const set = new Set(urlsOf(outer));
  return inner.every((r) => set.has(r.detailUrl));
}

describe("행정안전부 목록 — 공식 고정본", () => {
  it("원본 유효 행은 1·2쪽 각 10건이고 거른 뒤에도 안정 번호가 남는다", () => {
    expect(moisRaw).toHaveLength(10);
    expect(moisRawP2).toHaveLength(10);
    expect(moisRows).toHaveLength(6);
    expect(moisRowsP2).toHaveLength(5);
    expect(isSubset(moisRows, moisRaw)).toBe(true);
    expect(isSubset(moisRowsP2, moisRawP2)).toBe(true);
    expect(moisConfig.validationParse!(moisList, 1).map((r) => r.detailUrl)).toEqual(urlsOf(moisRaw));
    expect(moisConfig.customParse!(moisList, 1).map((r) => r.detailUrl)).toEqual(urlsOf(moisRows));
    expect(moisRows[0]).toMatchObject({
      title: "매립지 등이 속할 지방자치단체 결정 신청 내용 공고",
      detailUrl:
        "https://www.mois.go.kr/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&nttId=129419",
      dateText: "2026-09-10 ~",
      agency: "행정안전부",
    });
    expect(urlsOf(moisRaw)).toContain(
      "https://www.mois.go.kr/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&nttId=129448",
    );
    expect(urlsOf(moisRawP2)[0]).toBe(
      "https://www.mois.go.kr/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&nttId=129290",
    );
  });

  it("제목은 온전하고 게시일은 칸에서만 집는다 — 개시형 YYYY-MM-DD ~", () => {
    expect(moisRaw.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(moisRowsP2.find((r) => r.detailUrl.endsWith("nttId=129257"))?.title).toBe(
      "재해경감 우수기업 인증 공고",
    );
    expect(moisRowsP2.some((r) => r.title.includes("우수기업"))).toBe(true);
    const firstRaw = moisRaw.find((r) => r.detailUrl.endsWith("nttId=129448"));
    expect(firstRaw?.dateText).toBe("2026-09-11 ~");
    expect(firstRaw?.dateText).not.toMatch(/134/);
  });

  it("상세 주소는 고정 호스트·경로·숫자 nttId 이고 쪽 번호·세션 표가 없다", () => {
    for (const r of [...moisRaw, ...moisRawP2]) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.mois\.go\.kr\/frt\/bbs\/type013\/commonSelectBoardArticle\.do\?bbsId=BBSMSTR_000000000006&nttId=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/pageIndex|jsessionid/i);
    }
    expect(new Set(urlsOf(moisRaw)).size).toBe(10);
    expect(urlsOf(moisRawP2).every((u) => !urlsOf(moisRaw).includes(u))).toBe(true);
  });

  it("직원 채용·임용·합격자·평가 결과는 거르고 애매한 정책 공고는 남긴다", () => {
    const titles = [...moisRows, ...moisRowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("기간제근로자"))).toBe(false);
    expect(titles.some((t) => t.includes("임용시험"))).toBe(false);
    expect(titles.some((t) => t.includes("합격자"))).toBe(false);
    expect(titles.some((t) => t.includes("사무총장"))).toBe(false);
    expect(titles).toContain("매립지 등이 속할 지방자치단체 결정 결과 공고");
    expect(titles).toContain("(행정안전부공고 제2026-1133호) 민방위 경보단말장비 인증제품 공고");
  });
});

describe("국가보훈부 목록 — 공식 고정본", () => {
  it("원본 유효 행은 1·2쪽 각 10건이고 안정 번호가 남는다", () => {
    expect(mpvaRaw).toHaveLength(10);
    expect(mpvaRawP2).toHaveLength(10);
    expect(mpvaRows).toHaveLength(7);
    expect(mpvaRowsP2).toHaveLength(7);
    expect(isSubset(mpvaRows, mpvaRaw)).toBe(true);
    expect(mpvaConfig.validationParse!(mpvaList, 1).map((r) => r.detailUrl)).toEqual(urlsOf(mpvaRaw));
    expect(mpvaRows[0]).toMatchObject({
      title: "2027년도 이달의 독립운동가 후보 추천 명단 공개",
      detailUrl: "https://www.mpva.go.kr/mpva/selectBbsNttView.do?key=76&bbsNo=15&nttNo=275684",
      dateText: "2026-09-11 ~",
      agency: "국가보훈부",
    });
    expect(urlsOf(mpvaRawP2)[0]).toBe(
      "https://www.mpva.go.kr/mpva/selectBbsNttView.do?key=76&bbsNo=15&nttNo=274791",
    );
  });

  it("검색·쪽 인자를 떼고 공시송달·선정 결과만 거른다", () => {
    for (const r of [...mpvaRaw, ...mpvaRawP2]) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.mpva\.go\.kr\/mpva\/selectBbsNttView\.do\?key=76&bbsNo=15&nttNo=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/pageIndex|searchCtgry|jsessionid/i);
    }
    const titles = [...mpvaRows, ...mpvaRowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("공시송달"))).toBe(false);
    expect(titles.some((t) => t.includes("선정 결과"))).toBe(false);
    expect(titles).toContain("2026년 제대군인 창업 경진대회 참가자 모집");
    expect(titles).toContain("준보훈병원 공개모집 공고");
    expect(urlsOf(mpvaRawP2).every((u) => !urlsOf(mpvaRaw).includes(u))).toBe(true);
  });
});

describe("국방부 세 게시판 — 공식 고정본", () => {
  it("입찰·고시·상용품 원본 행 수가 맞고 AI 지원·기업 공모를 남긴다", () => {
    expect(mndRaw).toHaveLength(15);
    expect(mndRawP2).toHaveLength(15);
    expect(mndNoticeRaw).toHaveLength(15);
    expect(mndNoticeRawP2).toHaveLength(15);
    expect(mndProdRaw).toHaveLength(15);
    expect(mndProdRawP2).toHaveLength(15);
    expect(mndRows).toHaveLength(15);
    expect(mndRowsP2).toHaveLength(12);
    expect(mndNoticeRows).toHaveLength(13);
    expect(mndNoticeRowsP2).toHaveLength(13);
    expect(mndProdRows).toHaveLength(6);
    expect(mndProdRowsP2).toHaveLength(4);
    expect(mndConfig.validationParse!(mndList, 1).map((r) => r.detailUrl)).toEqual(urlsOf(mndRaw));
    const titles = [...mndRows, ...mndNoticeRows].map((r) => r.title);
    expect(titles).toContain("2026년도 AI응용제품신속상용화 지원사업(국방)사업 재공고");
    expect(titles).toContain("AI응용제품신속상용화지원사업(국방) 수정 공고");
    expect(titles).toContain("(수정)'26년도 AI 응용제품 신속 상용화 지원사업(국방) 공고");
    expect(titles).toContain("국방부공고 제2026-336호(2026 국방 드론 기술전 참여 기업 모집)");
    expect(mndRows[0]).toMatchObject({
      title: "2026년 민군기술협력 전력지원체계개발사업 주관연구개발기관 선정을 위한 공고",
      detailUrl: "https://www.mnd.go.kr/bbs/mnd/26374/I_14082223/artclView.do",
      dateText: "2026-08-31 ~",
      agency: "국방부",
    });
    expect(mndNoticeRaw[0].detailUrl).toBe(
      "https://www.mnd.go.kr/bbs/mnd/26390/I_14082431/artclView.do",
    );
    expect(mndProdRaw[0].detailUrl).toBe(
      "https://www.mnd.go.kr/bbs/mnd/133389/O_500141/artclView.do",
    );
  });

  it("상세 주소는 세 판 ID와 I_/O_ 숫자만 쓰고 옛 게시일도 남긴다", () => {
    const all = [...mndRaw, ...mndRawP2, ...mndNoticeRaw, ...mndNoticeRawP2, ...mndProdRaw, ...mndProdRawP2];
    for (const r of all) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.mnd\.go\.kr\/bbs\/mnd\/(26374|26390|133389)\/[IO]_\d+\/artclView\.do$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]page=|jsessionid/i);
      expect(r.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~$/);
    }
    expect(mndRowsP2.some((r) => r.dateText.startsWith("2021-11-23"))).toBe(true);
    expect(mndRows.some((r) => r.title.includes("입찰"))).toBe(false);
    expect(mndNoticeRows.some((r) => r.title.includes("공시송달"))).toBe(false);
    expect(mndProdRows.every((r) => !/결과/.test(r.title) || /접수|설명회/.test(r.title))).toBe(true);
    expect(urlsOf(mndRawP2).every((u) => !urlsOf(mndRaw).includes(u))).toBe(true);
    expect(urlsOf(mndNoticeRawP2).every((u) => !urlsOf(mndNoticeRaw).includes(u))).toBe(true);
    expect(urlsOf(mndProdRawP2).every((u) => !urlsOf(mndProdRaw).includes(u))).toBe(true);
  });

  it("수집 쪽 1..9 가 세 판을 번갈아 가리키고 주소가 겹치지 않는다", () => {
    const urls = Array.from({ length: 9 }, (_, i) => mndConfig.list.url(i + 1));
    expect(new Set(urls).size).toBe(9);
    const boards = urls.map((u) => u.match(/\/bbs\/mnd\/(\d+)\//)?.[1]);
    expect(boards).toEqual([
      "26374", "26390", "133389",
      "26374", "26390", "133389",
      "26374", "26390", "133389",
    ]);
    expect(urls.map((u) => u.match(/[?&]page=(\d+)/)?.[1])).toEqual([
      "1", "1", "1", "2", "2", "2", "3", "3", "3",
    ]);
    expect(mndTargetOf(1)).toEqual({ boardId: "26374", page: 1 });
    expect(mndTargetOf(6)).toEqual({ boardId: "133389", page: 2 });
    expect(mndConfig.list.maxPages).toBe(6);
    expect(mndConfig.emptyStreakStop).toBe(6);
    expect(mndConfig.list.url(1)).toBe("https://www.mnd.go.kr/bbs/mnd/26374/artclList.do?page=1");
  });
});

describe("거르개·주소·날짜 울타리", () => {
  it("채용 지원사업은 살리고 기관 직원 채용만 버린다", () => {
    expect(isMinistryDropTitle("2026년 중소기업 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isMinistryDropTitle("행정안전부 성과관리담당관 공무직근로자 채용 공고")).toBe(true);
    const grant = parseMoisList(
      moisList.replace(
        "유네스코 국제기록유산센터 사무총장 후보자 공개모집 공고",
        "2026년 청년 채용 지원사업 공고",
      ),
    );
    expect(grant.some((r) => r.title.includes("채용 지원사업"))).toBe(true);
    const mndGrant = parseMndList(
      mndList.replace(
        "2026년 민군기술협력 전력지원체계개발사업 주관연구개발기관 선정을 위한 공고",
        "국방 분야 채용 지원사업 참여기업 모집",
      ),
    );
    expect(mndGrant.some((r) => r.title.includes("채용 지원사업"))).toBe(true);
  });

  it("잘못된 호스트·경로·달력 날짜는 원본 파서에서 버린다", () => {
    const badHost = moisList.replace(
      "/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&amp;nttId=129448",
      "https://evil.example/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&amp;nttId=129448",
    );
    expect(parseMoisRaw(badHost).some((r) => r.detailUrl.includes("nttId=129448"))).toBe(false);

    const badPath = moisList.replace(
      "/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&amp;nttId=129445",
      "/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&amp;nttId=129445",
    );
    expect(parseMoisRaw(badPath).some((r) => r.detailUrl.includes("nttId=129445"))).toBe(false);

    const badDate = moisList.replace(">2026.09.11.<", ">2026.02.30.<");
    expect(parseMoisRaw(badDate).some((r) => r.detailUrl.endsWith("nttId=129448"))).toBe(false);

    const badMndHost = mndList.replace(
      "/bbs/mnd/26374/I_14082223/artclView.do",
      "https://other.go.kr/bbs/mnd/26374/I_14082223/artclView.do",
    );
    expect(parseMndRaw(badMndHost).some((r) => r.detailUrl.includes("I_14082223"))).toBe(false);

    const badMndPath = mndList.replace(
      "/bbs/mnd/26374/I_14062771/artclView.do",
      "/bbs/mnd/99999/I_14062771/artclView.do",
    );
    expect(parseMndRaw(badMndPath).some((r) => r.detailUrl.includes("I_14062771"))).toBe(false);
  });

  it("jsessionid 와 쪽 번호를 떼고 title 속성·새글/첨부 아이콘 글자만 지운다", () => {
    const withSession = moisList.replace(
      "/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&amp;nttId=129419",
      "/frt/bbs/type013/commonSelectBoardArticle.do;jsessionid=ABC123?bbsId=BBSMSTR_000000000006&amp;nttId=129419&amp;pageIndex=9",
    );
    const sessionRow = parseMoisRaw(withSession).find((r) => r.detailUrl.includes("nttId=129419"));
    expect(sessionRow?.detailUrl).toBe(
      "https://www.mois.go.kr/frt/bbs/type013/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000006&nttId=129419",
    );

    const titled = moisList.replace(
      `onclick="javascript:fn_egov_inqire_notice('129419', 'BBSMSTR_000000000006'); return false;" >매립지 등이 속할 지방자치단체 결정 신청 내용 공고`,
      `onclick="javascript:fn_egov_inqire_notice('129419', 'BBSMSTR_000000000006'); return false;" title="매립지 등이 속할 지방자치단체 결정 신청 내용 공고 전체">잘린제목`,
    );
    expect(parseMoisRaw(titled).find((r) => r.detailUrl.endsWith("nttId=129419"))?.title).toBe(
      "매립지 등이 속할 지방자치단체 결정 신청 내용 공고 전체",
    );

    const withIcons = mndList.replace(
      "<strong><span>2026년도 AI응용제품신속상용화 지원사업(국방)사업 재공고</span></strong>",
      "<strong><span>2026년도 AI응용제품신속상용화 지원사업(국방)사업 재공고</span></strong> 새글 첨부파일",
    );
    const iconRow = parseMndRaw(withIcons).find((r) => r.detailUrl.includes("I_14062771"));
    expect(iconRow?.title).toBe("2026년도 AI응용제품신속상용화 지원사업(국방)사업 재공고");
    expect(iconRow?.title).not.toMatch(/새글|첨부파일/);
  });
});

describe("설정 칸", () => {
  it("세 출처 모두 expectMinRows 1 · skipHeuristic · 거르기 전 검증 파서를 둔다", () => {
    for (const cfg of [moisConfig, mpvaConfig, mndConfig]) {
      expect(cfg.expectMinRows).toBe(1);
      expect(cfg.skipHeuristic).toBe(true);
      expect(cfg.charset).toBe("utf-8");
      expect(cfg.region).toBe("전국");
      expect(typeof cfg.validationParse).toBe("function");
      expect(cfg.list.maxPages).toBeGreaterThanOrEqual(5);
    }
    expect(moisConfig.list.url(2)).toBe(
      "https://www.mois.go.kr/frt/bbs/type013/commonSelectBoardList.do?bbsId=BBSMSTR_000000000006&pageIndex=2",
    );
    expect(mpvaConfig.list.url(2)).toBe(
      "https://www.mpva.go.kr/mpva/selectBbsNttList.do?bbsNo=15&key=76&pageIndex=2",
    );
    expect(moisConfig.list.fields.title.selector).toBe("td.l a");
    expect(mpvaConfig.list.fields.title.selector).toBe("td.p-subject a");
    expect(mndConfig.list.fields.title.selector).toBe("td.td-title a");
    expect(moisRows.length).toBeGreaterThanOrEqual(moisConfig.expectMinRows!);
    expect(mpvaRows.length).toBeGreaterThanOrEqual(mpvaConfig.expectMinRows!);
    expect(mndRows.length).toBeGreaterThanOrEqual(mndConfig.expectMinRows!);
  });
});

describe("상세 본문·첨부 선택자 — 공식 고정본", () => {
  it("행정안전부 본문은 .desc, 첨부는 dl.download 의 FileDown.do", () => {
    const body = cleanText(parseHtml(moisDetail).querySelector(moisConfig.detailContentSelector!)?.text ?? "");
    expect(body).toContain("모바일 신분증 민간개방");
    expect(body).toContain("참여기업");
    const scoped = parseHtml(moisDetail)
      .querySelectorAll(moisConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = moisConfig.detailAttachments!({ html: scoped, pageHtml: moisDetail, detailUrl: moisConfig.baseUrl, baseUrl: moisConfig.baseUrl });
    expect(atts).toHaveLength(3);
    expect(atts.every((a) => /\/cmm\/fms\/FileDown\.do\?atchFileId=FILE_00143576KRYkgSk&fileSn=\d+$/.test(a.url))).toBe(
      true,
    );
    expect(atts.map((a) => a.name).some((n) => n.endsWith(".pdf"))).toBe(true);
    expect(atts.map((a) => a.name).some((n) => n.endsWith(".hwpx"))).toBe(true);
    expect(atts.map((a) => a.name).some((n) => n.endsWith(".hwp"))).toBe(true);
  });

  it("국가보훈부 본문은 .p-table__content, 첨부는 .p-attach", () => {
    const body = cleanText(parseHtml(mpvaDetail).querySelector(mpvaConfig.detailContentSelector!)?.text ?? "");
    expect(body).toContain("이달의 독립운동가");
    const scoped = parseHtml(mpvaDetail)
      .querySelectorAll(mpvaConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, mpvaConfig.baseUrl, mpvaDetail);
    expect(atts).toHaveLength(1);
    expect(atts[0].url).toBe("https://www.mpva.go.kr/mpva/downloadBbsFile.do?atchmnflNo=173250");
    expect(atts[0].name).toContain("이달의 독립운동가");
  });

  it("국방부 본문은 머리글을 빼고 .hwp/.hwpx 내려받기만 담는다", () => {
    const body = cleanText(parseHtml(mndDetail).querySelector(mndConfig.detailContentSelector!)?.text ?? "");
    expect(body).toContain("민군기술협력 전력지원체계개발사업");
    expect(body).toContain("유무인 지뢰제거 굴착기");
    expect(body).not.toMatch(/작성자\s*:/);
    expect(body).not.toMatch(/조회수\s*:/);
    const header = cleanText(parseHtml(mndDetail).querySelector(".viewCont")?.text ?? "");
    expect(header).toMatch(/작성자\s*:/);
    const scoped = parseHtml(mndDetail)
      .querySelectorAll(mndConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, mndConfig.baseUrl, mndDetail);
    expect(atts).toHaveLength(4);
    expect(atts.every((a) => /\/bbs\/mnd\/26374\/I_\d+\/download\.do$/.test(a.url))).toBe(true);
    expect(atts.every((a) => /\.hwp(x)?$/i.test(a.name))).toBe(true);
    expect(atts.some((a) => /viewer\.do/.test(a.url))).toBe(false);
  });
});

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

 it("고용 지원 공고는 기간제 근로자라는 대상 표현만으로 버리지 않는다", () => {
  expect(isMinistryDropTitle("기간제 근로자 정규직 전환 지원사업 모집")).toBe(false);
 });

it("행안부 실제 목록처럼 title 속성이 없어도 엔진에서 공고를 수집한다", async () => {
  const { fetchBoardWindow } = await import("../page-window");
  const html = moisList.replace(/ title="[^"]*"/g, "");
  const result = await fetchBoardWindow(moisConfig, {
    prevOpenCount: 0, fetchText: async () => html, askModel: async () => { throw new Error("no AI"); }, onAllFailed: () => {},
  }, { startPage: 1, pageBudget: 1 });
  expect(result.nextPage).toBe(2);
  expect(result.announcements.length).toBeGreaterThan(0);
});
