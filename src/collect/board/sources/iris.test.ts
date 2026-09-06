import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { harvestBoardAttachments } from "../detail-fill";
import { pagingParamsOf } from "../engine";
import { irisAgencyOf, irisConfig, irisListUrl, irisTargetOf, isIrisDropTitle, parseIrisList } from "./iris";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본(2026-09-06 실측):
 * · `iris-list.html` — 접수중 1쪽(`ancmPrg=ancmIng&pageIndex=1`, 10행/전체 14건)
 * · `iris-list-end.html` — 마감 1쪽(`ancmPrg=ancmEnd&pageIndex=1`) · 운영자 시험 글 2건이 여기 있다
 * · `iris-list-pre.html` — 접수예정 1쪽(`ancmPrg=ancmPre&pageIndex=1`) · 시험 글 3건이 여기 있다
 * · `iris-detail.html` — GET 상세(`ancmId=023757`) 첨부 3건
 */
const list = readFileSync(join(__dirname, "../__fixtures__/iris-list.html"), "utf-8");
const listEnd = readFileSync(join(__dirname, "../__fixtures__/iris-list-end.html"), "utf-8");
const listPre = readFileSync(join(__dirname, "../__fixtures__/iris-list-pre.html"), "utf-8");
const detail = readFileSync(join(__dirname, "../__fixtures__/iris-detail.html"), "utf-8");
const rows = parseIrisList(list);
const rowsEnd = parseIrisList(listEnd);
const rowsPre = parseIrisList(listPre);

describe("IRIS 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10행에서 DROP 뒤 9건이 남고 첫 행의 제목·상세주소·날짜·기관이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "2026년도 연안하구 인간-자연시스템 관리기술 개발 사업 신규과제 선정계획 재공고",
      detailUrl: "https://www.iris.go.kr/contents/retrieveBsnsAncmView.do?ancmId=023757&ancmPrg=ancmIng",
      dateText: "2026-08-26 ~",
      agency: "해양수산과학기술진흥원",
      category: "지정공모",
    });
  });

  it("공고일자는 span.ancmDe 칸에서 집고 개시형(`날짜 ~`)으로 낸다", () => {
    const r = rows.find((x) => x.detailUrl.includes("ancmId=023757"));
    // 같은 행에 공고번호 「해양수산부 공고 제2026-1283호」가 함께 있다 — 그 숫자가 날짜로 새지 않아야 한다.
    expect(r?.dateText).toBe("2026-08-26 ~");
    expect(r?.dateText).not.toMatch(/1283/);
    expect(rows.every((x) => /^20\d{2}-\d{2}-\d{2} ~$/.test(x.dateText))).toBe(true);
  });

  it("상세 주소는 href(빈 값)가 아니라 onclick 의 ancmId 로 조립하고 탭값이 못 박힌다", () => {
    for (const r of [...rows, ...rowsEnd, ...rowsPre]) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.iris\.go\.kr\/contents\/retrieveBsnsAncmView\.do\?ancmId=\d+&ancmPrg=ancmIng$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]pageIndex=/);
    }
    // 마감 탭 고정본을 읽어도 탭값은 ancmIng 로 못 박힌다 — 같은 공고가 두 주소로 저장되면 중복이다.
    expect(rowsEnd.every((r) => r.detailUrl.endsWith("&ancmPrg=ancmIng"))).toBe(true);
  });

  it("★운영자 시험 글은 버린다 — 마감 2건·접수예정 3건이 고정본에 실제로 있다", () => {
    const titles = [...rowsEnd, ...rowsPre].map((r) => r.title);
    expect(titles).not.toContain("test");
    expect(titles).not.toContain("테스트");
    expect(titles.some((t) => t.includes("KISTEP 통합공고 테스트"))).toBe(false);
    expect(isIrisDropTitle("test")).toBe(true);
    expect(isIrisDropTitle("테스트")).toBe(true);
    expect(isIrisDropTitle("(TEST) KISTEP 통합공고 테스트 입니다.")).toBe(true);
  });

  it("★「테스트」를 낱말째 버리지 않는다 — 제목 전체가 시험 글자일 때만 버린다", () => {
    expect(isIrisDropTitle("2026년 테스트베드 지원기업 모집 공고")).toBe(false);
    expect(isIrisDropTitle("테스트베드 실증 지원사업")).toBe(false);
  });

  it("★대학·출연연·사람 대상 과제를 버린다 — 실측 제목으로 확인", () => {
    // 1쪽 실측 행. 「인적기반조성」은 대학 연구자 대상이라 기업 매칭에 소음이 된다.
    expect(rows.some((r) => r.title.includes("인적기반조성"))).toBe(false);
    expect(
      isIrisDropTitle(
        "양자정보과학 인적기반조성사업 리더급연구역량강화(연구혁신형)2026년도 한-캐나다 양자과학기술 공동연구사업 신규과제 공모",
      ),
    ).toBe(true);
    // 마감 탭 1~6쪽 실측 제목들.
    expect(isIrisDropTitle("2026년 한-캐나다 이공계 대학원생 연수프로그램 공모")).toBe(true);
    expect(isIrisDropTitle("2026년 이공계 연구생활장려금 지원 사업 하반기 신규과제 공고")).toBe(true);
    expect(isIrisDropTitle("2026년도 인공지능혁신인재양성 2차 사업 공고")).toBe(true);
    expect(isIrisDropTitle("2027년 제18차 일본 HOPE Meeting 참가자 모집 공모")).toBe(true);
    expect(
      isIrisDropTitle("2026년 산업혁신인재성장지원(해외연계) - 최고급 해외인재유치 지원사업 시행계획 추가 공고"),
    ).toBe(true);
  });

  it("★「대학」을 낱말째 버리지 않는다 — 기업이 주관인 공고가 함께 죽는다(적대 리뷰)", () => {
    expect(isIrisDropTitle("지역앵커기업-지역대학 공동개발 신규과제 공고")).toBe(false);
    expect(isIrisDropTitle("창업중심대학 추천형 창업기업 지원 공고")).toBe(false);
    // 「인력양성」도 DROP 에서 뺐다 — 기업지원 프로그램 제목에 쓰인다.
    expect(
      isIrisDropTitle("2026년도 소부장분야 전문인력양성(데이터융합형 신소재 고급인력양성) 신규과제 공모"),
    ).toBe(false);
  });

  it("★기업이 들어가는 R&D 공고는 살린다 — 낱말째 버리면 안 되는 자리", () => {
    // 1쪽 실측 행(한국산업기술기획평가원 · 기업 주관 과제).
    expect(rows.some((r) => r.title === "2026년도 제2차 로봇산업기술개발사업 신규지원 대상과제 공고")).toBe(true);
    expect(isIrisDropTitle("2026년도 제2차 로봇산업기술개발사업 신규지원 대상과제 공고")).toBe(false);
    // 마감 탭 실측 행(중소기업기술정보진흥원).
    expect(isIrisDropTitle("표준공정 기반 공정최적화 기술개발사업(공정최적화R&D) 시행계획 공고")).toBe(false);
    expect(rowsEnd.some((r) => r.agency === "중소기업기술정보진흥원")).toBe(true);
  });

  it("기관은 「부처 > 전문기관」에서 전문기관만 쓴다 — 부처를 쓰면 전 행이 뭉쳐 dedupKey 가 갈린다", () => {
    expect(irisAgencyOf("해양수산부 > 해양수산과학기술진흥원")).toBe("해양수산과학기술진흥원");
    expect(irisAgencyOf("우주항공청 > 우주항공청")).toBe("우주항공청");
    expect(irisAgencyOf("한국연구재단")).toBe("한국연구재단");
    expect(new Set(rows.map((r) => r.agency)).size).toBeGreaterThan(1);
    expect(rows.every((r) => !r.agency!.includes(">"))).toBe(true);
  });

  it("같은 쪽에서 상세 열쇠 중복이 없다", () => {
    const urls = [...rows, ...rowsEnd].map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("IRIS 설정", () => {
  it("★쪽 번호는 「접수중·접수예정 두 탭을 한 쪽씩 번갈아」로 풀린다", () => {
    expect(irisTargetOf(1)).toEqual({ prg: "ancmIng", page: 1 });
    expect(irisTargetOf(2)).toEqual({ prg: "ancmPre", page: 1 });
    expect(irisTargetOf(3)).toEqual({ prg: "ancmIng", page: 2 });
    expect(irisTargetOf(4)).toEqual({ prg: "ancmPre", page: 2 });
    const base = "https://www.iris.go.kr/contents/retrieveBsnsAncmBtinSituListView.do";
    expect(irisListUrl(1)).toBe(`${base}?ancmPrg=ancmIng&pageIndex=1`);
    expect(irisListUrl(2)).toBe(`${base}?ancmPrg=ancmPre&pageIndex=1`);
    expect(irisListUrl(3)).toBe(`${base}?ancmPrg=ancmIng&pageIndex=2`);
    expect(irisConfig.list.url(4)).toBe(`${base}?ancmPrg=ancmPre&pageIndex=2`);
    // 상한은 탭 2개 × 탭마다 2쪽, 「연속 빈 쪽」 판정은 한 바퀴 길이(2)만큼.
    expect(irisConfig.list.maxPages).toBe(4);
    expect(irisConfig.emptyStreakStop).toBe(2);
  });

  it("★상세 주소의 ancmPrg 를 엔진이 쪽 변수로 짚는다 — 그래서 지우지 못하게 막는다", () => {
    // 1·2쪽 모두 pageIndex=1 이고 ancmPrg 만 갈리므로 엔진이 그것을 쪽 번호로 본다.
    expect(pagingParamsOf(irisConfig)).toEqual(["ancmPrg"]);
    expect(irisConfig.keepPagingParamsInDetail).toBe(true);
  });

  it("접수예정 탭도 같은 파서로 읽힌다 — 목록엔 접수기간이 없어 공고일자 개시형으로 낸다", () => {
    expect(rowsPre.length).toBeGreaterThan(0);
    expect(rowsPre.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    // 접수예정 1쪽 실측 행(중소기업기술정보진흥원) — 접수중 탭에는 절대 안 나오는 축이다.
    const jump = rowsPre.find((r) => r.title.includes("Multi AI Agent"));
    expect(jump?.title).toBe(
      "중소제조 특화 Multi AI Agent 개발(R&D) 점프업 Track 시행계획 공고",
    );
    expect(jump?.dateText).toBe("2026-08-31 ~");
    expect(jump?.agency).toBe("중소기업기술정보진흥원");
    // 탭이 달라도 상세 주소의 탭값은 한 값이다 — 갈리면 같은 공고가 두 줄이 된다.
    expect(jump?.detailUrl).toBe(
      "https://www.iris.go.kr/contents/retrieveBsnsAncmView.do?ancmId=023857&ancmPrg=ancmIng",
    );
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(irisConfig.id).toBe("iris");
    expect(irisConfig.label).toBe("IRIS 범부처통합연구지원시스템");
    expect(irisConfig.region).toBe("전국");
    expect(irisConfig.charset).toBe("utf-8");
    expect(irisConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(irisConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(irisConfig.expectMinRows!);
  });
});

describe("IRIS 상세", () => {
  it("본문 선택자가 라벨-값 표와 공고문을 함께 집는다", () => {
    const body = (parseHtml(detail).querySelector(irisConfig.detailContentSelector!)?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(body).toContain("전문기관해양수산과학기술진흥원");
    expect(body).toContain("접수기간 2026-09-02 ~ 2026-09-09");
    expect(body).toContain("■ 공고문");
  });

  it("★첨부 3건을 실제 내려받기 주소로 바꾼다 — javascript: 링크라 규칙이 없으면 0건이다", () => {
    const scoped = parseHtml(detail)
      .querySelectorAll(irisConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, irisConfig.baseUrl, detail);
    expect(atts.map((a) => a.name)).toEqual([
      "2026년도 연안하구 인간-자연시스템 관리기술 개발 사업 신규과제 선정계획 재공고.hwpx",
      "[별첨] 연구개발계획서 서식 및 별첨서류(1~8) 등 관련서식.zip",
      "[별첨] 참고자료(규정 및 iris 매뉴얼 등).zip",
    ]);
    // 2026-09-06 curl 실측으로 200 + content-disposition + hwpx 134,364바이트가 온 바로 그 주소.
    expect(atts[0].url).toBe(
      "https://www.iris.go.kr/comm/file/fileDownload.do" +
        "?atchDocId=HrRMYh18DXFRhbOzQzR3KQ%3D%3D&atchFileId=crSHzPxqVqLW%2B9uq9U4EFw%3D%3D",
    );
    // Base64 열쇠의 `+`·`/`·`=` 가 날것으로 남으면 서버가 다른 값으로 읽는다.
    expect(atts[1].url).toContain("atchFileId=x%2F55ZfsifpPDJ1cfCw1B9g%3D%3D");
    expect(atts.every((a) => !a.url.startsWith("javascript:"))).toBe(true);
  });

  it("★파일 이름에 `/` 가 있어도 유령 첨부가 안 생긴다 — 이름이 주소로 오인되던 자리", () => {
    /**
     * 고정본의 실제 첨부 하나만 이름을 바꿔 만든 파생본이다(손으로 쓴 HTML 이 아니다).
     * `EMBEDDED_FILE` 갈래는 따옴표 안 `…hwpx` 글자를 주소 후보로 보고 「경로 구분자가 있으면
     * 주소」로 판단한다 — 「UI/UX …hwpx」가 그 조건을 통과해 없는 주소를 첨부로 만들었다.
     */
    // 이름은 링크 인자와 링크 글자 두 곳에 같이 적혀 있다 — 둘 다 바꾼다.
    const mutated = detail.replaceAll(
      "[별첨] 연구개발계획서 서식 및 별첨서류(1~8) 등 관련서식.zip",
      "UI/UX 설계 지침.hwpx",
    );
    const scoped = parseHtml(mutated)
      .querySelectorAll(irisConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, irisConfig.baseUrl, mutated);
    expect(atts).toHaveLength(3);
    expect(atts.some((a) => a.name === "UI/UX 설계 지침.hwpx")).toBe(true);
    expect(atts.every((a) => a.url.includes("/comm/file/fileDownload.do"))).toBe(true);
    expect(atts.some((a) => a.url.includes("/UI/UX"))).toBe(false);
  });
});
