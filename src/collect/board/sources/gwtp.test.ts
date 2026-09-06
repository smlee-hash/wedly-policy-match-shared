import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { harvestBoardAttachments } from "../detail-fill";
import { parseHtml } from "../html";
import { extractByHeuristic } from "../layers/heuristic";
import { isGwtpDropTitle, parseGwtpList, gwtpConfig } from "./gwtp";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `bbsNew_list.php?code=sub01b&keyvalue=sub01` 1·2쪽 + 상세 1건(idx=3272).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gwtp-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gwtp-list-p2.html"), "utf-8");
const rows = parseGwtpList(listHtml);
const rowsP2 = parseGwtpList(listP2Html, 2);
const combined = [...rows, ...rowsP2];

/** 붙박이 공지 첫 줄(idx=3459)의 상세 주소 — 쪽 번호가 안 섞인 붙박이 형태다. */
const FIRST_URL =
  "https://www.gwtp.or.kr/gwtp/bbsNew_view.php?bbs_data=aWR4PTM0NTkmc3RhcnRQYWdlPSZsaXN0Tm89JnRhYmxlPWNzX2Jic19kYXRhX25ldyZjb2RlPXN1YjAxYiZzZWFyY2hfaXRlbT0mc2VhcmNoX29yZGVyPSZ1cmw9c3ViMDFiJmtleXZhbHVlPXN1YjAxJmJic19tYWxuYW1lPQ==||";

describe("강원테크노파크 모집공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 40줄에서 DROP 을 뺀 39건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(39);
    expect(rows[0]).toMatchObject({
      title: "(2026-188호) 2026년 합성데이터 생성·활용 실무 교육 모집 공고",
      detailUrl: FIRST_URL,
      // 붙박이 + 「모집중」 딱지라 등록일을 개시일로 넘기지 않는다(아래 붙박이 시험 참조).
      dateText: "",
      agency: "강원테크노파크",
    });
  });

  it("★붙박이가 아닌 일반 행도 읽는다 — 제목 자리가 두 갈래다", () => {
    /**
     * 붙박이는 `<a><button>모집중</button><span class="ellipsis">제목</span></a>`,
     * 일반 행은 `<button>완료</button> <a>제목</a>` 로 **딱지가 링크 밖**이다.
     * `span.ellipsis` 만 보면 일반 15줄이 통째로 사라진다(실측).
     */
    expect(listHtml.match(/class="ellipsis"/g)).toHaveLength(25); // 붙박이 25줄에만 있다
    expect(rows.length).toBeGreaterThan(25); // 그런데 39줄을 읽는다 = 일반 행도 읽었다
    const normal = rows.find((r) => r.title.startsWith("(2026-156호)"));
    expect(normal).toMatchObject({
      title: "(2026-156호) 평창군 그린바이오 기업지원사업 위탁정산 회계법인 모집 공고",
      dateText: "2026-07-13 ~",
    });
    // 딱지 글자가 제목에 섞이면 안 된다.
    expect(rows.every((r) => !/^(모집중|완료)/.test(r.title))).toBe(true);
  });

  it("★상세 주소를 idx 로 다시 조립한다 — 원문 href 를 그대로 쓰면 같은 글이 쪽마다 다른 줄이 된다", () => {
    /**
     * 이 게시판은 쪽 번호(`startPage`)와 줄 번호(`listNo`)를 **base64 안에** 넣는다.
     * 1쪽 원문은 `startPage=0&listNo=497`, 2쪽 원문은 `startPage=15` 라 엔진의
     * `stripDropParams`(변수 이름 기준)로는 절대 못 뗀다 — sourceId 가 쪽마다 갈린다.
     */
    const decoded = combined.map((r) =>
      Buffer.from(
        decodeURIComponent(new URL(r.detailUrl).searchParams.get("bbs_data") ?? "").replace(/\|+$/, ""),
        "base64",
      ).toString("utf-8"),
    );
    expect(decoded.every((d) => d.includes("startPage=&listNo=&"))).toBe(true);
    expect(decoded.every((d) => /^idx=\d+&/.test(d))).toBe(true);
    // 원문 고정본에는 쪽·줄 번호가 실제로 들어 있다(위 규칙이 「그냥 통과하는 글」이 아니라는 증거).
    expect(listHtml).toContain("c3RhcnRQYWdlPTE1"); // "startPage=15…"(2쪽 링크)
    expect(rowsP2.some((r) => r.detailUrl === FIRST_URL)).toBe(true);
  });

  it("★1쪽·2쪽의 붙박이 25줄이 같은 주소로 겹쳐 54건만 남는다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(urls).toHaveLength(79); // 39 + 40
    expect(new Set(urls).size).toBe(54); // 붙박이 25줄이 겹친다
    // 2쪽에만 있는 일반 15줄이 실제로 새로 들어온다.
    const onlyP2 = rowsP2.filter((r) => !rows.some((x) => x.detailUrl === r.detailUrl));
    expect(onlyP2).toHaveLength(15);
    expect(onlyP2[0]).toMatchObject({
      title: "(2026-136호)2026년 수소 전주기 분야 R&D과제 지원사업 기업지원 4차 공고(재공고)",
      dateText: "2026-06-24 ~",
    });
  });

  it("★붙박이는 「모집중」일 때만 날짜를 비운다 — 「완료」 딱지는 등록일을 그대로 넘긴다", () => {
    /**
     * 저장 쪽 `openStartExpired` 의 예외 `PINNED_NOTICE` 는 제목이 「[공지]」로 **시작**해야만
     * 걸린다. 이 게시판 제목은 「(2026-27호) …」로 시작해 안 걸리므로, 2026-01-19 짜리
     * 붙박이에 등록일을 주면 **저장 즉시 마감**된다. 사이트가 「모집중」이라 말하는 줄만 비운다.
     */
    const open = rows.find((r) => r.title.includes("연중 상시모집")); // idx=2624 · 2026-01-19 · 모집중
    expect(open?.dateText).toBe("");
    const done = rows.find((r) => r.title.startsWith("(2026-168호)")); // idx=3339 · 2026-07-29 · 완료
    expect(done?.title).toContain("위탁정산 회계법인");
    expect(done?.dateText).toBe("2026-07-29 ~");
    // 붙박이 25줄 = 모집중 13 + 완료 12. 비우는 것은 모집중 13줄뿐이다.
    expect(rows.filter((r) => r.dateText === "")).toHaveLength(13);
    expect(rows.filter((r) => r.dateText !== "")).toHaveLength(26);
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 날짜를 비우면 처음 본 날부터 90일간 되살아난다", () => {
    const old = parseGwtpList(listHtml, 1, Date.parse("2028-01-01T00:00:00Z"));
    expect(old).toHaveLength(14); // 붙박이 25줄이 통째로 빠지고 일반 14줄만 남는다
    expect(old.every((r) => r.dateText !== "")).toBe(true);
    // 오늘(고정본 기준)엔 1년 넘은 붙박이가 없어야 한다 — 규칙이 멀쩡한 줄을 지우면 안 된다.
    expect(parseGwtpList(listHtml, 1, Date.parse("2026-09-03T00:00:00Z"))).toHaveLength(39);
  });

  it("날짜를 개시형으로 넘기고, 값이 있으면 반드시 YYYY-MM-DD 꼴이다", () => {
    const dated = rows.filter((r) => r.dateText !== "");
    expect(dated.length).toBeGreaterThan(0);
    for (const r of dated) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("날짜는 등록일 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    // 실측 함정: 「497」 + 「2026-07-13」 + 조회수 「52947」 이 이어 붙어 「4972026-07-13」 이 된다.
    const r = rows.find((x) => x.title.includes("(2026-156호)"));
    expect(r?.dateText).toBe("2026-07-13 ~");
    expect(r?.dateText).not.toMatch(/497/);
    expect(r?.dateText).not.toMatch(/52947/);
  });

  it("★날짜는 4번째 칸이 먼저다 — 작성자 칸이 날짜처럼 보여도 등록일을 이긴다", () => {
    /**
     * 칸 순서는 번호/제목/작성자/등록일/… 이다. 「칸 전체가 날짜면 인정」이라는 보조 규칙만 남기면
     * 작성자 칸에 날짜 모양 글자가 들어온 순간 그 값을 집는다 — 4번째 칸을 먼저 보는 이유다.
     */
    const at = listHtml.indexOf("(2026-156호)");
    const planted = listHtml.slice(0, at) + listHtml.slice(at).replace("미래사업단 바이오융합팀", "2001-01-01");
    expect(planted).not.toBe(listHtml);
    const r = parseGwtpList(planted).find((x) => x.title.startsWith("(2026-156호)"));
    expect(r?.dateText).toBe("2026-07-13 ~");
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    expect(combined.some((r) => r.title.includes("평가 위원"))).toBe(false);
    expect(
      isGwtpDropTitle(
        "(2026-152호) 2026년 강원연구장비종합정보망(G-EQNET) 고도화 및 개편 용역 제안서 평가 위원 모..",
      ),
    ).toBe(true);
    expect(isGwtpDropTitle("2026년 용역 제안서 평가위원 모집 공고")).toBe(true);
    expect(isGwtpDropTitle("2026년 시설관리 용역 입찰 공고")).toBe(true);
    expect(isGwtpDropTitle("2026년 상반기 신규 직원 채용 공고")).toBe(true);
  });

  it("「채용」·「수요조사」를 통째로 버리지 않는다 — 채용 지원사업·기술수요조사가 죽으면 안 된다", () => {
    expect(isGwtpDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isGwtpDropTitle("2028년 초광역프로젝트(R&D) 지원을 위한 기술수요조사 공고")).toBe(false);
    expect(rows.some((r) => r.title.includes("기술수요조사"))).toBe(true);
    expect(rows.some((r) => r.title.includes("수요조사 공고"))).toBe(true);
  });
});

describe("강원테크노파크 설정", () => {
  it("1쪽은 맨 주소, 2쪽부터 base64 startPage 로 넘긴다(15씩)", () => {
    expect(gwtpConfig.list.url(1)).toBe(
      "https://www.gwtp.or.kr/gwtp/bbsNew_list.php?code=sub01b&keyvalue=sub01",
    );
    const p2 = new URL(gwtpConfig.list.url(2));
    const dec = (u: URL) =>
      Buffer.from((u.searchParams.get("bbs_data") ?? "").replace(/\|+$/, ""), "base64").toString("utf-8");
    expect(dec(p2)).toBe(
      "startPage=15&code=sub01b&table=cs_bbs_data_new&search_item=&search_order=&url=sub01b&keyvalue=sub01",
    );
    expect(dec(new URL(gwtpConfig.list.url(3)))).toContain("startPage=30&");
    // 실사이트 1쪽이 실제로 그렇게 링크한다(지어낸 규칙이 아니라는 증거).
    expect(listHtml).toContain("c3RhcnRQYWdlPTE1JmNvZGU9c3ViMDFiJnRhYmxlPWNzX2Jic19kYXRhX25ldyZzZWFyY2hfaXRlbT0mc2VhcmNoX29yZGVyPSZ1cmw9c3ViMDFiJmtleXZhbHVlPXN1YjAx");
  });

  it("★1쪽 주소에 bbs_data 를 쓰지 않는다 — 쓰면 엔진이 bbs_data 를 쪽 변수로 보고 상세 주소에서 지운다", () => {
    /**
     * `pagingParamsOf` 는 url(1)·url(2) 에서 **이름은 같고 값이 다른** 변수를 쪽 번호로 본다.
     * 1쪽도 `bbs_data=…` 로 두면 상세 주소의 `bbs_data` 가 통째로 지워져
     * 39줄이 전부 `bbsNew_view.php` 한 주소로 뭉개진다(sourceId 붕괴).
     */
    expect(gwtpConfig.list.url(1)).not.toContain("bbs_data");
    expect(pagingParamsOf(gwtpConfig)).toEqual([]);
  });

  it("★기준 주소가 /gwtp/ 까지다 — 이 사이트 링크는 폴더 없는 상대 주소다", () => {
    expect(gwtpConfig.baseUrl).toBe("https://www.gwtp.or.kr/gwtp/");
    expect(new URL("bbsNew_download.php?x=1", gwtpConfig.baseUrl).toString()).toBe(
      "https://www.gwtp.or.kr/gwtp/bbsNew_download.php?x=1",
    );
  });

  it("★추측 단계를 끈다 — 켜 두면 붙박이 25줄이 쪽마다 다른 주소로 저장된다", () => {
    expect(gwtpConfig.skipHeuristic).toBe(true);
    /**
     * 왜 껐는지의 증거: 추측 단계는 원문 href 를 그대로 쓴다. 1·2쪽을 추측으로 뽑으면
     * 겹치는 붙박이 25줄이 **각각 다른 주소**가 되어 80건(= 40+40)이 나온다.
     * 우리 파서는 같은 입력에서 54건으로 접는다.
     */
    const h1 = extractByHeuristic(listHtml, gwtpConfig.baseUrl);
    const h2 = extractByHeuristic(listP2Html, gwtpConfig.baseUrl);
    expect(new Set([...h1, ...h2].map((r) => r.detailUrl)).size).toBe(80);
    expect(new Set(combined.map((r) => r.detailUrl)).size).toBe(54);
    // 추측 단계는 상태 딱지도 제목에 붙여 저장한다.
    expect(h1[0]?.title.startsWith("모집중")).toBe(true);
  });

  it("이름·지역·상한이 맞다", () => {
    expect(gwtpConfig.id).toBe("gwtp");
    expect(gwtpConfig.label).toBe("강원테크노파크");
    expect(gwtpConfig.agency).toBe("강원테크노파크");
    expect(gwtpConfig.region).toBe("강원");
    expect(gwtpConfig.charset).toBe("utf-8");
    expect(gwtpConfig.list.maxPages).toBe(10);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(gwtpConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    // 붙박이 25줄은 관리자가 언제든 내릴 수 있다 — 한 쪽이 보장하는 일반 15줄보다 낮게 잡는다.
    expect(gwtpConfig.expectMinRows).toBeLessThan(15);
  });
});

/**
 * ★상세 본문·첨부 자리 — 2026-09-03 실측 고정본(`bbsNew_view.php?…idx=3272`)으로 잰다.
 */
describe("상세 본문·첨부 자리", () => {
  const detailHtml = readFileSync(join(__dirname, "../__fixtures__/gwtp-detail.html"), "utf-8");
  const doc = parseHtml(detailHtml);

  it("본문 칸(td.img_td)에 진짜 공고문이 들어 있다", () => {
    expect(gwtpConfig.detailContentSelector).toBe("td.img_td");
    const body = doc.querySelector(gwtpConfig.detailContentSelector!);
    expect(body).not.toBeNull();
    const text = body!.text.replace(/\s+/g, " ").trim();
    expect(text.length).toBeGreaterThan(2000);
    expect(text).toContain("미래모빌리티");
    expect(text).toContain("지원대상 선정");
    expect(text).toContain("신청접수 및 문의처");
  });

  it("★첨부 주소가 /gwtp/ 를 잃지 않는다 — 기준 주소가 한 칸 짧으면 첨부가 전부 404 다", () => {
    expect(gwtpConfig.attachmentsScopeSelector).toBe("a[href*='bbsNew_download.php']");
    const scoped = doc
      .querySelectorAll(gwtpConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    // 실물 href 는 폴더가 없는 상대 주소다 — 기준 주소가 절대 주소를 정한다.
    expect(scoped).toContain('href="bbsNew_download.php?');
    const files = harvestBoardAttachments(scoped, gwtpConfig.baseUrl);
    expect(files).toHaveLength(3);
    expect(files.every((f) => f.url.startsWith("https://www.gwtp.or.kr/gwtp/bbsNew_download.php?"))).toBe(true);
    expect(files.every((f) => f.kind === "hwp")).toBe(true);
    // 기준 주소를 한 칸 줄이면 폴더가 빠진다(위 단언이 「그냥 통과하는 글」이 아니라는 증거).
    const wrong = harvestBoardAttachments(scoped, "https://www.gwtp.or.kr/");
    expect(wrong[0]?.url.startsWith("https://www.gwtp.or.kr/bbsNew_download.php?")).toBe(true);
  });

  it("범위를 좁혀도 첨부를 하나도 안 잃는다 — 좁힌 목적은 본문 덩어리를 안 넘기는 것이다", () => {
    const scoped = doc
      .querySelectorAll(gwtpConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    // 본문 칸은 범위 밖이다 — 이 상세 한 건의 본문 HTML 만 26만 자다(그림이 base64 로 박혀 있다).
    expect(scoped).not.toContain("img_td");
    expect(doc.querySelector("td.img_td")!.innerHTML.length).toBeGreaterThan(100_000);
    expect(scoped.length).toBeLessThan(3_000);
    // 그러면서 상세 전체를 훑었을 때와 **같은 첨부**를 얻는다(좁혀서 잃은 것이 없다는 증거).
    const wide = harvestBoardAttachments(detailHtml, gwtpConfig.baseUrl).map((f) => f.url);
    const narrow = harvestBoardAttachments(scoped, gwtpConfig.baseUrl).map((f) => f.url);
    expect(narrow).toEqual(wide);
  });

  it("첨부 선택자를 한 글자 바꾸면 못 잡는다 — 선택자가 실제로 쓰인다는 증거", () => {
    expect(doc.querySelectorAll("a[href*='bbsNew_download-x.php']")).toHaveLength(0);
    expect(doc.querySelector("td.img_td-x")).toBeNull();
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseGwtpList(listHtml.replaceAll("table table-hover", "table table-hover-x"))).toHaveLength(0);
  });

  it("상세 링크 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGwtpList(listHtml.replaceAll("bbsNew_view.php", "bbsNew_view-x.php"))).toHaveLength(0);
  });

  it("제목 칸(td.text-start)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGwtpList(listHtml.replaceAll("pt-3 pb-3 text-start", "pt-3 pb-3 text-start-x"))).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    // 칸을 통째로 지워 4번째 칸이 조회수로 밀리게 한다 — 그래도 날짜를 지어내면 안 된다.
    const broken = listHtml.replace(/<td class="pt-3 pb-3">20\d\d-\d\d-\d\d<\/td>/g, "");
    expect(parseGwtpList(broken).every((r) => r.dateText === "")).toBe(true);
  });
});
