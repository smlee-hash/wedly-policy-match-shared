import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isNyjDropTitle, parseNyjList, nyjConfig } from "./nyj";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 남양주시청 일반지원사업 1·2쪽
 * (`selectBbsNttList.do?key=3294&bbsNo=80`, pageIndex=1|2).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/nyj-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/nyj-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseNyjList(listHtml, 1, NOW);
const combined = parseNyjList(listHtml + listP2Html, 1, NOW);

describe("남양주시 기업지원 공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 11건을 읽고 첫 행·첫 일반 행이 맞다", () => {
    expect(rows).toHaveLength(11);
    // 맨 위는 붙박이 G-FAIR. 등록일 2026-03-16 을 개시일로 넘기면 90일 규칙에 걸려 저장 즉시 마감된다.
    expect(rows[0]).toMatchObject({
      title: "G-FAIR KOREA 2026 참가기업 모집",
      detailUrl: "https://www.nyj.go.kr/www/selectBbsNttView.do?key=3294&bbsNo=80&nttNo=529560",
      dateText: "",
      agency: "남양주시",
    });
    const firstDated = rows.find((r) => r.dateText !== "");
    expect(firstDated).toMatchObject({
      title: "[경기도] 모두의 창업 프로젝트（2차） 일반·기술트랙 안내",
      detailUrl: "https://www.nyj.go.kr/www/selectBbsNttView.do?key=3294&bbsNo=80&nttNo=547543",
      dateText: "2026-08-26 ~",
      agency: "경기도",
    });
  });

  it("★상세 주소에 pageIndex 를 넣지 않는다 — 쪽마다 같은 글이 다른 줄로 저장된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
    expect(combined.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
  });

  it("★1년 넘게 붙어 있는 고정 공지는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    // 실측 붙박이 「공무원 사칭 … 사기 주의」(2025-07-02)는 DROP 에도 걸리고, 나이로도 한 번 더 걸러진다.
    expect(rows.some((r) => r.detailUrl.includes("nttNo=497149"))).toBe(false);
    const old = parseNyjList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.title.includes("G-FAIR"))).toBe(false);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 21건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(21);
    // 붙박이 G-FAIR 가 1·2쪽에 반복돼도 한 줄이다.
    expect(urls.filter((u) => u.includes("nttNo=529560"))).toHaveLength(1);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("사칭"))).toBe(false);
    expect(titles.some((t) => t.includes("사기 주의"))).toBe(false);
    expect(isNyjDropTitle("남양주시 공무원 사칭 및 공문서·명함 위조 사기 주의 알림")).toBe(true);
    expect(isNyjDropTitle("위조 공문서 주의 안내")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용박람회 참여기업 모집은 살아남는다", () => {
    expect(rows.some((r) => r.title.includes("채용박람회"))).toBe(true);
    expect(isNyjDropTitle("[남양주시 일자리지원과] 2026년 모두의 일자리 채용박람회 참여기업 모집")).toBe(
      false,
    );
  });

  it("기관을 「남양주시」로 못 박지 않는다 — 제목 앞 대괄호에서 뽑고, 없으면 기본값으로 되돌린다", () => {
    expect(new Set(rows.map((r) => r.agency)).size).toBeGreaterThan(1);
    expect(rows.some((r) => r.agency === "경기도")).toBe(true);
    expect(rows.some((r) => r.agency === "남양주시 일자리지원과")).toBe(true);
    expect(rows.some((r) => r.agency === "경기콘텐츠진흥원")).toBe(true);
    const planted = parseNyjList(
      listHtml.replace(
        "[경기도] 모두의 창업 프로젝트（2차） 일반·기술트랙 안내",
        "대괄호 없는 지원사업 공고",
      ),
      1,
      NOW,
    );
    const fallback = planted.find((r) => r.title === "대괄호 없는 지원사업 공고");
    expect(fallback?.agency).toBe("남양주시");
  });

  it("날짜는 마지막 td 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("nttNo=547543"));
    expect(r?.dateText).toBe("2026-08-26 ~");
    expect(r?.dateText).not.toMatch(/135/);
    // 제목에 날짜가 있어도 작성일 칸을 쓴다.
    const polluted = parseNyjList(
      listHtml.replace(
        "[경기도] 모두의 창업 프로젝트（2차） 일반·기술트랙 안내",
        "[경기도] 모두의 창업 프로젝트（2차） 일반·기술트랙 안내 (2026.01.05)",
      ),
      1,
      NOW,
    );
    const hit = polluted.find((x) => x.detailUrl.includes("nttNo=547543"));
    expect(hit?.dateText).toBe("2026-08-26 ~");
    expect(hit?.dateText).not.toContain("2026-01-05");
  });
});

describe("남양주시 기업지원 공고 설정", () => {
  it("쪽넘김은 GET pageIndex + bbsNo=80", () => {
    expect(nyjConfig.list.url(1)).toBe(
      "https://www.nyj.go.kr/www/selectBbsNttList.do?key=3294&bbsNo=80&pageIndex=1",
    );
    expect(nyjConfig.list.url(2)).toBe(
      "https://www.nyj.go.kr/www/selectBbsNttList.do?key=3294&bbsNo=80&pageIndex=2",
    );
    expect(nyjConfig.list.maxPages).toBe(10);
  });

  it("지역은 경기 — 남양주시 공고를 옮겨 싣는 자리다", () => {
    expect(nyjConfig.region).toBe("경기");
    expect(nyjConfig.id).toBe("nyj");
    expect(nyjConfig.agency).toBe("남양주시");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(nyjConfig.expectMinRows).toBeGreaterThanOrEqual(5);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자를 한 글자 바꾸면 한 줄도 못 읽는다", () => {
    const broken = nyjConfig.list.rowSelector.replace("p-table", "p-table-x");
    expect(parseHtml(listHtml).querySelectorAll(broken)).toHaveLength(0);
    expect(parseNyjList(listHtml.replaceAll("p-table", "p-table-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.p-subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseNyjList(listHtml.replaceAll('class="p-subject"', 'class="p-subject-x"'), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    // 고정본은 <time>\n2026-08-26\n</time> 이라 꺾쇠로 감싼 치환은 안 먹는다.
    const broken = parseNyjList(listHtml.replaceAll("2026-08-26", ""), 1, NOW);
    const hit = broken.find((r) => r.detailUrl.includes("nttNo=547543"));
    expect(hit?.dateText).toBe("");
  });
});
