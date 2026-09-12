import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSeoulsinboDropTitle,
  parseSeoulsinboList,
  seoulsinboBoardOf,
  seoulsinboConfig,
  seoulsinboListUrl,
} from "./seoulsinbo";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본(2026-09-03 실측):
 *  · `seoulsinbo-list.html`    = 공지사항 1쪽 (`list.do?mng_cd=STRY9788&pageIndex=1`)
 *  · `seoulsinbo-list-p2.html` = 공지사항 2쪽 (`pageIndex=2`)
 *  · `seoulsinbo-biz-p1.html`  = 사업공고 1쪽 (`mng_cd=STRY0006`) — 조달 게시판임을 못 박는 대조군
 */
const F = join(__dirname, "../__fixtures__");
const listHtml = readFileSync(join(F, "seoulsinbo-list.html"), "utf-8");
const listP2Html = readFileSync(join(F, "seoulsinbo-list-p2.html"), "utf-8");
const bizHtml = readFileSync(join(F, "seoulsinbo-biz-p1.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseSeoulsinboList(listHtml, 1, NOW);
const rowsP2 = parseSeoulsinboList(listP2Html, 2, NOW);
/** 사업공고 게시판은 수집기 7쪽(= 두 번째 게시판의 1쪽)에 해당한다. */
const rowsBiz = parseSeoulsinboList(bizHtml, 7, NOW);

const FIRST = {
  title: "안심통장 4호 지원사업 공고",
  detailUrl:
    "https://www.seoulshinbo.co.kr/wbase/contents/bbs/view/23384.do?mng_cd=STRY9788&pageIndex=1",
  /** 붙박이(`td.notice`)라 개시일을 안 넘긴다 — 아래 「붙박이는 날짜를 안 넘긴다」 참고. */
  dateText: "",
  agency: "서울신용보증재단",
} as const;
/** 1쪽 붙박이 글번호(실측). 이 여섯은 날짜가 비고, 나머지는 개시형이 붙는다. */
const PINNED_BNOS = ["23384", "23036", "22839", "21372", "21371", "21370"] as const;
const isPinned = (r: { detailUrl: string }) => PINNED_BNOS.some((b) => r.detailUrl.includes(`/${b}.`));

describe("서울신용보증재단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽에서 DROP·중복을 뺀 11건을 읽고 첫 행이 「안심통장 4호」다", () => {
    expect(rows).toHaveLength(11);
    expect(rows[0]).toMatchObject(FIRST);
  });

  /**
   * ★이 시험이 이번 버그의 핵심이다.
   * 옛 설정은 `mng_cd=STRY0006`(「사업공고」)만 봤는데 그건 **조달 게시판**이라
   * 제목 거르개를 지나면 쪽마다 1건뿐이다. 기업이 신청하는 공고는 공지사항에 있다.
   */
  it("옛 게시판(사업공고)은 1건뿐이고, 새 게시판(공지사항)은 그 열 배를 읽는다", () => {
    expect(rowsBiz).toHaveLength(1);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeGreaterThan(rowsBiz.length * 5);
    // 목록 1쪽이 이제 공지사항을 가리킨다.
    expect(seoulsinboListUrl(1)).toContain("mng_cd=STRY9788");
  });

  it("기업이 신청하는 지원사업이 실제로 들어온다 — 옛 설정에선 한 건도 없던 것들", () => {
    const titles = [...rows, ...rowsP2].map((r) => r.title);
    for (const must of [
      "안심통장 4호 지원사업 공고",
      "2026년 서울시 자영업자 고용보험료 지원사업 공고",
      "2026년 서울시 자영업자 산재보험료 지원사업 공고",
      "2026년 자영업클리닉 모집공고",
      "2026년 서울시 중소기업육성자금 3분기 접수 안내",
    ]) {
      expect(titles).toContain(must);
    }
    // 옛 고정본에서 유일하게 살아남던 그 한 건도 그대로 들어온다(누락 0).
    expect(titles).toContain("[상권지원부] 2026년 골목형상점가 육성 지원 사업 공고(2차)");
  });

  it("2쪽은 1쪽에 없는 글을 준다 — GET pageIndex 가 진짜 먹는다", () => {
    expect(rowsP2.length).toBeGreaterThanOrEqual(10);
    const p1 = new Set(rows.map((r) => r.detailUrl));
    const fresh = rowsP2.filter((r) => !p1.has(r.detailUrl));
    expect(fresh.length).toBeGreaterThanOrEqual(8);
    expect(fresh.map((r) => r.title)).toContain("서울시 안심통장 3호 지원사업 공고");
    // 원문 자체가 다르다 — 같은 쪽을 두 번 받아 온 게 아니다.
    expect(listHtml).toContain("22264");
    expect(listP2Html).not.toContain("22264");
    expect(listP2Html).toContain("21619");
    expect(listHtml).not.toContain("21619");
  });
});

describe("상세 주소 — 쪽 번호가 아니라 글 번호로 못 박는다", () => {
  /**
   * ★상세는 `pageIndex` 가 없으면 **HTTP 500**(2026-09-03 실측). 그래서 넣되,
   *   발견한 쪽 번호가 아니라 **늘 1** 로 고정한다 — 안 그러면 같은 글이 쪽마다 다른 줄이 된다.
   */
  it("상세 주소의 pageIndex 는 언제나 1이다 — 2쪽에서 찾은 글도 마찬가지", () => {
    for (const r of [...rows, ...rowsP2, ...rowsBiz]) {
      expect(r.detailUrl).toMatch(/[?&]pageIndex=1$/);
    }
    const p2Only = rowsP2.find((r) => r.title === "서울시 안심통장 3호 지원사업 공고");
    expect(p2Only?.detailUrl).toBe(
      "https://www.seoulshinbo.co.kr/wbase/contents/bbs/view/21619.do?mng_cd=STRY9788&pageIndex=1",
    );
  });

  it("게시판 코드는 목록 HTML 이 들고 있는 값을 쓴다 — 게시판마다 다르다", () => {
    expect(rows.every((r) => r.detailUrl.includes("mng_cd=STRY9788"))).toBe(true);
    expect(rowsBiz.every((r) => r.detailUrl.includes("mng_cd=STRY0006"))).toBe(true);
  });

  it("숨은 칸을 못 읽으면 쪽 번호로 되짚는다", () => {
    const noHidden = parseSeoulsinboList(listHtml.replaceAll('name="mng_cd"', 'name="mng_cd_x"'), 7, NOW);
    expect(noHidden.length).toBeGreaterThan(0);
    expect(noHidden.every((r) => r.detailUrl.includes("mng_cd=STRY0006"))).toBe(true);
  });

  it("같은 글번호(붙박이+본문 두 줄, PC+모바일 표)는 한 번만 담는다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.filter((u) => u.includes("/23384."))).toHaveLength(1);
  });
});

describe("날짜·붙박이", () => {
  it("붙박이가 아닌 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    const normal = [...rows, ...rowsP2].filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThanOrEqual(10);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  /**
   * ★붙박이는 **등록일을 개시일로 넘기지 않는다.**
   * 실측 붙박이 「2026년 서울시 자영업자 고용보험료 지원사업 공고」(2026-02-12)는 지금도 접수 중인데,
   * 등록일을 넘기면 저장 쪽 `openStartExpired`(개시 90일 초과)가 걸려 **저장하자마자 마감**된다.
   * 저장 쪽 예외 `PINNED_NOTICE` 는 제목이 「[공지]」로 시작해야만 걸려 이 게시판엔 안 통한다.
   */
  it("★붙박이는 날짜를 안 넘긴다 — 넘기면 90일 지난 붙박이가 저장 즉시 마감된다", () => {
    for (const bno of PINNED_BNOS) {
      const r = rows.find((x) => x.detailUrl.includes(`/${bno}.`));
      expect(r, `붙박이 ${bno} 가 목록에 있어야 한다`).toBeDefined();
      expect(r!.dateText).toBe("");
    }
    // 붙박이가 아닌 행은 그대로 개시형이다 — 통째로 비우고 있지 않다는 증거.
    const plain = rows.filter((r) => !isPinned(r));
    expect(plain.length).toBeGreaterThanOrEqual(5);
    for (const r of plain) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  /**
   * 날짜를 비운 뒤에도 **엔진의 저장 전 검사**(날짜 있는 행 30% 이상)를 지나야 한다.
   * 못 지나면 그 회차 목록이 통째로 버려진다.
   */
  it("날짜를 비워도 「날짜가 있는 행이 부족」 검사에 안 걸린다", () => {
    for (const list of [rows, rowsP2]) {
      const dated = list.filter((r) => r.dateText !== "").length;
      expect(dated).toBeGreaterThanOrEqual(Math.max(1, Math.ceil(list.length * 0.3)));
    }
  });

  it("오래된 붙박이 정책도 날짜와 함께 보존해 과거 공고로 수집한다", () => {
    const old = parseSeoulsinboList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.map(r => r.detailUrl)).toEqual(rows.map(r => r.detailUrl));
    expect(old.every(r => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("날짜는 4번째 td 칸에서만 집는다 — 행 전체 글자면 번호·첨부와 붙는다", () => {
    // 붙박이는 날짜를 안 넘기므로 **붙박이가 아닌** 행으로 잰다.
    const r = rows.find((x) => x.detailUrl.includes("/22661."));
    expect(r?.dateText).toBe("2026-06-26 ~");
    expect(r?.dateText).not.toMatch(/171|22661/);
  });
});

describe("제목 거르개 — 버릴 것만 버린다", () => {
  it("조달·내부 인사·안내문은 목록에서 빠진다", () => {
    const titles = [...rows, ...rowsP2, ...rowsBiz].map((t) => t.title);
    for (const gone of [
      "임직원 사칭 사기피해 예방 안내",
      "불법브로커 개입 주의 안내",
      "[제2026인사-02호] 서울신용보증재단 노동이사 모집공고",
    ]) {
      expect(titles).not.toContain(gone);
    }
    expect(titles.some((t) => t.includes("입찰공고"))).toBe(false);
    expect(titles.some((t) => t.includes("제안평가결과"))).toBe(false);
    expect(titles.some((t) => t.includes("수의계약"))).toBe(false);
    expect(titles.some((t) => t.includes("계약관련서식"))).toBe(false);
    expect(titles.some((t) => t.includes("개인정보 제3자 제공"))).toBe(false);
  });

  it("실측 제목을 그대로 넣어도 판정이 같다", () => {
    for (const drop of [
      "[제2026재무팀-64호]입찰공고(2026년 중구 로컬브랜드 상권 로컬 축제 운영 용역)",
      "[제2026재무팀-65호]제안평가결과(직급·역량별 통합 교육 설계 및 운영 용역)",
      "[제2026재무팀-57호]전자공개 수의계약 공고(2026년 오! 헬시데이 용역)",
      "[재무팀] 계약관련서식(표준계약서식)",
      "임직원 사칭 사기피해 예방 안내",
      "불법브로커 개입 주의 안내",
      "최근 3년간 신입직원 채용현황_2025년",
      "2025년도 임직원 친인척 채용인원",
      "[제2026인사-02호] 서울신용보증재단 노동이사 모집공고",
      "제2026인사-01호 [서울신용보증재단 상임이사] 공개모집 공고",
      "[고객지원팀] 2026년도 「서울특별시 출연기관 고객만족도 조사」 관련 개인정보 제3자 제공사항 알림",
    ]) {
      expect(isSeoulsinboDropTitle(drop)).toBe(true);
    }
  });

  it("★지원사업을 죽이는 낱말은 안 쓴다 — 「채용」·「모집공고」 통째 버리기 금지", () => {
    for (const keep of [
      "소상공인 채용 지원사업 참여기업 모집",
      "2026년 자영업클리닉 모집공고",
      "안심통장 4호 지원사업 공고",
      "2026년 서울시 자영업자 고용보험료 지원사업 공고",
      "서울시 안심통장 3호 지원사업 Q&A",
    ]) {
      expect(isSeoulsinboDropTitle(keep)).toBe(false);
    }
    expect(isSeoulsinboDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("서울신용보증재단 설정", () => {
  it("한 바퀴 뒤 공지사항과 사업공고의 7쪽부터 계속 읽는다", () => {
    expect(seoulsinboConfig.list.url(13)).toBe("https://www.seoulshinbo.co.kr/wbase/contents/bbs/list.do?mng_cd=STRY9788&pageIndex=7");
    expect(seoulsinboConfig.list.url(19)).toBe("https://www.seoulshinbo.co.kr/wbase/contents/bbs/list.do?mng_cd=STRY0006&pageIndex=7");
    expect(new Set(Array.from({ length: 100 }, (_, i) => seoulsinboConfig.list.url(i + 1))).size).toBe(100);
  });
  it("1~6쪽은 공지사항, 7~12쪽은 사업공고 — 두 게시판을 번갈아 읽는다", () => {
    expect(seoulsinboBoardOf(1)).toBe("STRY9788");
    expect(seoulsinboBoardOf(6)).toBe("STRY9788");
    expect(seoulsinboBoardOf(7)).toBe("STRY0006");
    expect(seoulsinboConfig.list.url(1)).toBe(
      "https://www.seoulshinbo.co.kr/wbase/contents/bbs/list.do?mng_cd=STRY9788&pageIndex=1",
    );
    expect(seoulsinboConfig.list.url(6)).toContain("&pageIndex=6");
    expect(seoulsinboConfig.list.url(7)).toBe(
      "https://www.seoulshinbo.co.kr/wbase/contents/bbs/list.do?mng_cd=STRY0006&pageIndex=1",
    );
    expect(seoulsinboConfig.list.maxPages).toBe(12);
    expect(seoulsinboConfig.list.init).toBeUndefined();
  });

  /**
   * ★엔진은 `list.url(1)` 과 `list.url(2)` 를 견줘 「쪽 변수」를 알아낸다.
   * 두 주소가 `pageIndex` 하나만 달라야 게시판 코드(`mng_cd`)가 상세 주소에서 안 지워진다 —
   * 게시판을 1쪽마다 바꾸면(PAGES_PER_BOARD=1) `mng_cd` 가 쪽 변수로 잡혀 상세가 통째로 깨진다.
   */
  it("url(1)·url(2)는 pageIndex 하나만 다르다 — mng_cd 가 쪽 변수로 오인되면 안 된다", () => {
    const a = new URL(seoulsinboConfig.list.url(1));
    const b = new URL(seoulsinboConfig.list.url(2));
    const differing = [...a.searchParams.keys()].filter(
      (k) => b.searchParams.has(k) && a.searchParams.get(k) !== b.searchParams.get(k),
    );
    expect(differing).toEqual(["pageIndex"]);
  });

  it("지역은 서울", () => {
    expect(seoulsinboConfig.region).toBe("서울");
    expect(seoulsinboConfig.id).toBe("seoulsinbo");
    expect(seoulsinboConfig.agency).toBe("서울신용보증재단");
    expect(seoulsinboConfig.label).toBe("서울신용보증재단");
  });

  it("서식 변경 감지가 살아 있다 — 1쪽 실측 11건이라 5는 넉넉하고, 옛 1은 게시판이 통째로 바뀌어도 못 잡는다", () => {
    expect(seoulsinboConfig.expectMinRows).toBe(5);
    expect(rows.length).toBeGreaterThanOrEqual(seoulsinboConfig.expectMinRows!);
    // 옛 값 1로는 「조달 게시판만 읽던 상태」도 통과한다 — 그래서 올렸다.
    expect(rowsBiz.length).toBeLessThan(seoulsinboConfig.expectMinRows!);
  });

  it("목록 행에 첨부 파일 링크가 섞여 heuristic 을 끈다", () => {
    expect(seoulsinboConfig.skipHeuristic).toBe(true);
    expect(listHtml).toContain("common.download");
  });

  it("★본문 선택자를 비우고 첨부는 PC 상세 칸만 본다 — 짧은 표지문을 채우면 PDF 공고문을 영영 못 읽는다", () => {
    expect(seoulsinboConfig.detailContentSelector).toBeUndefined();
    expect(seoulsinboConfig.attachmentsScopeSelector).toBe("div.info_input_each.for_web");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 행 껍데기 이름을 바꾼 고정본을 넣었을 때 0행이어야 선택자가 실제로 그 칸을 본다는 증거다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseSeoulsinboList(listHtml.replaceAll("for_web", "for_web-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.t_left)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSeoulsinboList(listHtml.replaceAll("t_left", "t_left-x"), 1, NOW)).toHaveLength(0);
  });

  it("goView 함수 이름이 바뀌면 글 번호를 못 뽑아 0행이다", () => {
    expect(parseSeoulsinboList(listHtml.replaceAll("bbs.goView", "bbs.goViewX"), 1, NOW)).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 그 행만 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    // 붙박이는 어차피 날짜가 비므로 **붙박이가 아닌** 행의 작성일 칸을 지워 잰다.
    const broken = parseSeoulsinboList(
      listHtml.replaceAll("<td>2026-06-26</td>", "<td></td>"),
      1,
      NOW,
    );
    const target = broken.find((r) => r.detailUrl.includes("/22661."));
    expect(target?.dateText).toBe("");
    // 다른 행 날짜는 멀쩡해야 한다 — 날짜를 행 전체에서 긁고 있지 않다는 증거.
    expect(broken.find((r) => r.detailUrl.includes("/22683."))?.dateText).toBe("2026-07-01 ~");
  });
});
