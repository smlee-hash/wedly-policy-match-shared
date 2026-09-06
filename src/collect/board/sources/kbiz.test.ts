import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isKbizDropTitle, parseKbizList, kbizConfig } from "./kbiz";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-02 실측 유관기관 공지 1·2쪽 (`mnSeq=210&pg=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kbiz-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kbiz-list-p2.html"), "utf-8");
const rows = parseKbizList(listHtml);
const combined = parseKbizList(listHtml + listP2Html);

describe("중소기업중앙회 유관기관 공지 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 8건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      title: "[한국전력공사] 2026년 KTP 및 KTP+ 신규 인증기업 공모 안내",
      detailUrl: "https://www.kbiz.or.kr/ko/contents/bbs/view.do?seq=163878&mnSeq=210",
      dateText: "2026-09-01 ~",
      agency: "한국전력공사",
    });
    expect(rows[0].title).not.toMatch(/NEW/i);
  });

  it("★상세 주소에 topFixYn 을 넣지 않는다 — 고정 여부가 Y↔N 으로 바뀌면 같은 공고가 두 줄이 된다", () => {
    // 주소가 곧 중복 판정 열쇠(sourceId)다. 빼고 불러도 본문은 동일하다(실측).
    expect(rows.every((r) => !r.detailUrl.includes("topFixYn"))).toBe(true);
  });

  it("★1년 넘게 붙어 있는 고정 공지는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    // 실측 고정 공지 「[국세청] … 자료 모음」(2025.12.19)은 DROP(자료 모음)에도 걸리고,
    // 걸리지 않았더라도 아래처럼 나이로 한 번 더 걸러진다.
    expect(rows.some((r) => r.detailUrl.includes("seq=161888"))).toBe(false);
    const old = parseKbizList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 16건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(16);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("세제개편안"))).toBe(false);
    expect(titles.some((t) => t.includes("밤길걷기"))).toBe(false);
    expect(titles.some((t) => t.includes("사회서비스 박람회"))).toBe(false);
    expect(isKbizDropTitle("[한국생명존중희망재단] 2026 자살예방캠페인 제21회 생명사랑 밤길걷기 개최 안내")).toBe(
      true,
    );
    expect(isKbizDropTitle("[보건복지부] 2026년 대한민국 사회서비스 박람회 개최 안내")).toBe(true);
    expect(isKbizDropTitle("[중소벤처기업부] 2026년 세제개편안_ 창업중소기업 세액감면 재설계")).toBe(true);
    expect(isKbizDropTitle("[통계청] 기술통계조사 오류정정 안내")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용문화 우수기업 어워즈는 살아남는다", () => {
    expect(rows.some((r) => r.title.includes("채용문화 우수기업"))).toBe(true);
    expect(isKbizDropTitle("[고용노동부] 2026년 채용문화 우수기업 어워즈 안내")).toBe(false);
  });

  it("기관을 「중소기업중앙회」로 못 박지 않는다 — 제목 앞 대괄호에서 뽑고, 없으면 기본값으로 되돌린다", () => {
    expect(new Set(rows.map((r) => r.agency)).size).toBeGreaterThan(1);
    expect(rows.some((r) => r.agency === "한국전력공사")).toBe(true);
    expect(rows.some((r) => r.agency === "금융감독원")).toBe(true);
    const planted = parseKbizList(
      listHtml.replace(
        "[한국전력공사] 2026년 KTP 및 KTP+ 신규 인증기업 공모 안내",
        "대괄호 없는 지원사업 공고",
      ),
    );
    const fallback = planted.find((r) => r.title === "대괄호 없는 지원사업 공고");
    expect(fallback?.agency).toBe("중소기업중앙회");
  });

  it("날짜는 td.date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("seq=163878"));
    expect(r?.dateText).toBe("2026-09-01 ~");
    expect(r?.dateText).not.toMatch(/1287/);
  });
});

describe("중소기업중앙회 설정", () => {
  it("쪽넘김은 GET pg + mnSeq=210 — 209(자체 공지)·211(용역 입찰)은 붙이면 안 된다", () => {
    expect(kbizConfig.list.url(1)).toBe(
      "https://www.kbiz.or.kr/ko/contents/bbs/list.do?mnSeq=210&pg=1",
    );
    expect(kbizConfig.list.url(2)).toBe(
      "https://www.kbiz.or.kr/ko/contents/bbs/list.do?mnSeq=210&pg=2",
    );
    expect(kbizConfig.list.url(2)).not.toContain("mnSeq=209");
    expect(kbizConfig.list.url(2)).not.toContain("mnSeq=211");
    expect(kbizConfig.list.maxPages).toBe(3);
  });

  it("지역은 전국 — 유관기관 공고를 옮겨 싣는 자리다", () => {
    expect(kbizConfig.region).toBe("전국");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kbizConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});

/**
 * ★상세 본문·첨부 자리 — 2026-09-02 실측 고정본(`view.do?seq=163878&topFixYn=N&mnSeq=210`)으로 잰다.
 */
describe("상세 본문·첨부 자리", () => {
  const detailHtml = readFileSync(join(__dirname, "../__fixtures__/kbiz-detail.html"), "utf-8");
  const doc = parseHtml(detailHtml);

  it("★본문 선택자를 **일부러 비운다** — 328자 도입부를 채우면 첨부 공고문(PDF)의 진짜 자격조건을 영영 못 읽는다", () => {
    expect(kbizConfig.detailContentSelector).toBeUndefined();
    // 왜 비웠는지의 증거: 파서가 첫 문단에서 상자를 닫아 도입부만 잡힌다.
    const body = doc.querySelector("div.detail-body")!;
    expect(body.text.replace(/\s+/g, " ").trim().length).toBeLessThan(600);
    expect(body.text.replace(/\s+/g, " ")).toContain("한국전력공사에서는");
  });

  it("★첨부 범위가 첨부 목록만 담는다 — 사이트 공용 파일이 섞이면 자격조건 추출이 오염된다", () => {
    const scope = doc.querySelector(kbizConfig.attachmentsScopeSelector!);
    expect(scope).not.toBeNull();
    // `#` 은 미리보기 단추라 주소가 아니다 — 진짜 링크만 골라 전부 내려받기 통로인지 본다.
    const links = scope!
      .querySelectorAll("a[href]")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h !== "#");
    expect(links).toHaveLength(2);
    expect(links.every((h) => h.startsWith("/download.do"))).toBe(true);
  });

  it("첨부 범위 선택자를 한 글자 바꾸면 못 잡는다 — 선택자가 실제로 쓰인다는 증거", () => {
    expect(doc.querySelector("div.file-wrap-x")).toBeNull();
  });
});
