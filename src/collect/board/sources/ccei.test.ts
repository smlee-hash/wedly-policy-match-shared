import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { parseCceiList, cceiConfig } from "./ccei";

/**
 * ★손으로 쓴 JSON 대신 **실사이트 고정본**으로 잰다.
 * 손으로 쓴 고정본은 칸 이름 오타를 그대로 통과시킨다(창원 첨부 선택자가 그렇게 새어 나갔다).
 * 고정본: 2026-09-02 `business_list.json` POST 응답 1·2쪽 원문(sPtime=now, pagePerContents=15).
 */
const p1 = readFileSync(join(__dirname, "../__fixtures__/ccei-list.json"), "utf-8");
const p2 = readFileSync(join(__dirname, "../__fixtures__/ccei-list-p2.json"), "utf-8");
const rows = parseCceiList(p1);

describe("창조경제혁신센터 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽에서 15건을 읽고 첫 행의 제목·상세주소·접수기간이 맞다", () => {
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({
      title: "2026년 제주창조경제혁신센터 오픈이노베이션 특화 전문가 Pool 모집",
      detailUrl: "https://ccei.creativekorea.or.kr/service/business_view.do?seq=10568",
      dateText: "2026-09-01 ~ 2026-09-30",
    });
  });

  it("★신청 기간은 R_SDATE~R_EDATE 다 — C_* 는 프로그램 기간이라 쓰면 마감된 공고가 계속 열려 있다", () => {
    // 적대 리뷰가 「치명」으로 잡은 그 줄. C 를 쓰면 2027-01-06~01-09(전시회 날짜)가 저장돼
    // 이미 2026-07-01 에 끝난 모집이 2027년까지 「모집중」으로 뜬다.
    const ces = rows.find((r) => r.title.includes("CES 2027"))!;
    expect(ces.dateText).toBe("2026-06-18 ~ 2026-07-01");
    expect(ces.dateText).not.toContain("2027");
    // 제목 꼬리가 그 마감일과 같다 — R 이 접수기간이라는 증거(세 줄 모두 일치).
    expect(ces.title).toContain("~7/1");
    const deep = rows.find((r) => r.title.includes("딥테크 창업 경진대회"))!;
    expect(deep.dateText).toBe("2026-07-20 ~ 2026-08-14");
    expect(deep.title).toContain("~8/14");
    const retry = rows.find((r) => r.title.includes("재도전 아이디어 경진대회"))!;
    expect(retry.dateText).toBe("2026-07-29 ~ 2026-08-21");
    expect(retry.title).toContain("~08.21");
  });

  it("R 이 빈 줄(15건 중 11건)만 C 로 물러선다", () => {
    // 제주 줄은 R 이 비어 C(2026.09.01~09.30)가 사실상 모집 기간이다.
    expect(rows[0].dateText).toBe("2026-09-01 ~ 2026-09-30");
  });

  it("★자격 요약은 summary 로 싣는다 — targetText 로 실으면 첨부 본문 뽑기가 막힌다", () => {
    const ulsan = rows.find((r) => r.title.includes("STAY-UP"))!;
    expect(ulsan.summary).toBe("예비창업자, 7년이내 기업");
    // "all" 은 「제한 없음」이라 조건이 아니다 — 안 싣는다.
    expect(rows[0].summary).toBeUndefined();
    // targetText 를 채우면 안 된다(뒷단계가 targetText === "" 인 줄만 첨부에서 채운다).
    expect(rows.every((r) => r.targetText === undefined)).toBe(true);
  });

  it("★접수일과 마감일을 둘 다 싣는다 — 게시판 중 드문 경우라 여기서 잃으면 못 되찾는다", () => {
    // 15건 전부 「시작 ~ 끝」 꼴이어야 한다. 하나라도 「시작 ~」로 끝나면 C_EDATE 를 놓친 것.
    const bad = rows.filter((r) => !/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText));
    expect(bad.map((r) => `${r.title}=${r.dateText}`)).toEqual([]);
  });

  it("★지역을 행마다 싣지 **않는다** — CD_NM2 는 「올린 센터의 지역」이지 「신청 자격 지역」이 아니다", () => {
    // 처음엔 CD_NM2(제주·울산…)를 지역으로 실었다가 적대 리뷰가 잡았다:
    // 부산센터의 「BOUNCE 2026」은 자격이 **전국 소재 창업 7년 미만 스타트업**인데
    // 지역을 「부산」으로 저장하면 서울 기업이 지역 필터에서 탈락해 이 공고를 못 받는다.
    // 이 저장소의 우선순위는 「단 1건도 놓치지 않기」라 넓게 두는 쪽을 고른다.
    expect([...rows, ...parseCceiList(p2)].every((r) => r.region === undefined)).toBe(true);
    expect(cceiConfig.region).toBe("전국");
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다 — pn 이 안 먹으면 여기서 걸린다", () => {
    const all = [...rows, ...parseCceiList(p2)];
    expect(all).toHaveLength(30);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(30);
  });

  it("★기관을 센터 이름으로 못 박지 않는다 — 박으면 같은 통합 공고가 센터마다 다른 줄이 된다", () => {
    // 실측: 「모두의 창업 프로젝트」가 강원 센터에서 두 줄로 온다(SEQ 10562·10561).
    // agency 를 안 실으면 둘 다 cfg.agency 로 떨어져 중복 열쇠(제목|기관)가 같아진다.
    const dupes = rows.filter((r) => r.title.includes("모두의 창업 프로젝트"));
    expect(dupes.length).toBeGreaterThanOrEqual(2);
    expect(dupes.every((r) => r.agency === undefined)).toBe(true);
  });

  it("SEQ 나 제목이 없는 줄은 버린다", () => {
    expect(parseCceiList(JSON.stringify({ result: { list: [{ SEQ: "1" }, { PROGRAM_TITLE: "제목만" }] } }))).toEqual([]);
  });

  it("JSON 이 아니거나 모양이 다르면 빈 배열 — 수집이 통째로 죽지 않는다", () => {
    expect(parseCceiList("<html>차단</html>")).toEqual([]);
    expect(parseCceiList(JSON.stringify({ result: {} }))).toEqual([]);
  });

  it("★같은 SEQ 가 한 응답에 두 번 오면 한 줄만 남긴다", () => {
    const one = JSON.parse(p1) as { result: { list: unknown[] } };
    one.result.list = [one.result.list[0], one.result.list[0]];
    expect(parseCceiList(JSON.stringify(one))).toHaveLength(1);
  });
});

describe("창조경제혁신센터 설정", () => {
  it("쪽 번호는 주소가 아니라 POST 본문이 나른다 — 주소는 쪽과 무관하게 같다", () => {
    expect(cceiConfig.list.url(1)).toBe(cceiConfig.list.url(2));
    expect(cceiConfig.list.init?.(2)).toMatchObject({ method: "POST" });
    expect(cceiConfig.list.init!(2).body).toContain("pn=2");
  });

  it("★진행중(now)만 부른다 — 지난 1,703건을 넣으면 화면이 끝난 글로 찬다", () => {
    expect(cceiConfig.list.init!(1).body).toContain("sPtime=now");
    expect(cceiConfig.list.init!(1).body).not.toContain("sPtime=pre");
  });

  it("한 쪽 요청량 × 쪽수가 실측 진행중 건수(62)를 덮는다", () => {
    const per = Number(cceiConfig.list.init!(1).body?.match(/pagePerContents=(\d+)/)?.[1]);
    expect(per * cceiConfig.list.maxPages).toBeGreaterThanOrEqual(62);
  });

  it("상세 주소 호스트가 baseUrl 과 같아 허용 호스트 검사를 통과한다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(cceiConfig.baseUrl).host);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 이걸 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 칸 이름을 바꾼 응답을 넣었을 때 결과가 실제로 달라지는지 확인한다.
 */
describe("망가뜨려 보기", () => {
  it("PROGRAM_TITLE 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseCceiList(p1.replaceAll('"PROGRAM_TITLE"', '"PROGRAM_TITLE_X"'))).toHaveLength(0);
  });

  it("C_EDATE 가 사라지면 「시작 ~」 개시형으로 떨어진다(마감일을 지어내지 않는다)", () => {
    const broken = parseCceiList(p1.replaceAll('"C_EDATE"', '"C_EDATE_X"'));
    expect(broken).toHaveLength(15);
    expect(broken[0].dateText).toBe("2026-09-01 ~");
  });

  it("★R_EDATE 칸 이름이 바뀌면 CES 줄이 프로그램 기간(2027년)으로 되돌아간다 — 판정이 실제로 R 을 본다는 증거", () => {
    const broken = parseCceiList(p1.replaceAll('"R_EDATE"', '"R_EDATE_X"').replaceAll('"R_SDATE"', '"R_SDATE_X"'));
    const ces = broken.find((r) => r.title.includes("CES 2027"))!;
    expect(ces.dateText).toBe("2027-01-06 ~ 2027-01-09");
  });

  it("ELIGIBILITY 칸 이름이 바뀌면 요약을 비운다(지어내지 않는다)", () => {
    expect(parseCceiList(p1.replaceAll('"ELIGIBILITY"', '"ELIGIBILITY_X"')).every((r) => r.summary === undefined)).toBe(true);
  });
});

/** ★상세 본문·첨부 자리 — 고정본 `business_view.do?seq=10563` 으로 잰다. */
describe("상세 본문·첨부 자리", () => {
  const doc = parseHtml(readFileSync(join(__dirname, "../__fixtures__/ccei-detail.html"), "utf-8"));

  it("★본문 선택자를 **일부러 비운다** — 짧은 표지문을 채우면 첨부 공고문을 영영 못 읽는다", () => {
    expect(cceiConfig.detailContentSelector).toBeUndefined();
    // 왜 비웠는지의 증거: 상세 본문은 297자짜리 표지문뿐이다.
    const body = doc.querySelector("div.vw_article")!;
    const text = body.text.replace(/\s+/g, " ").trim();
    expect(text.length).toBeLessThan(1000);
    expect(text).toContain("첨부파일 공고문 참고");
  });

  it("첨부 범위는 남겨 둔다 — 진짜 자격조건은 그 공고문에 있다", () => {
    const scope = doc.querySelector(cceiConfig.attachmentsScopeSelector!)!;
    const files = scope.querySelectorAll("a[href]").map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.includes("fileDown"));
    expect(files.length).toBeGreaterThan(0);
  });
});
