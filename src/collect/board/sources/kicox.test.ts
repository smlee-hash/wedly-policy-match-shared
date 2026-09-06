import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractByHeuristic } from "../layers/heuristic";
import { isKicoxDropTitle, parseKicoxList, kicoxConfig } from "./kicox";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `boardList/1016`(공지사항) 1·2쪽.
 * 한 쪽 18줄 = 붙박이 공지 8 + 일반 10.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kicox-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kicox-list-p2.html"), "utf-8");
const rows = parseKicoxList(listHtml, 1);
const rowsP2 = parseKicoxList(listP2Html, 2);
const combined = [...rows, ...rowsP2];

describe("한국산업단지공단 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 18줄에서 DROP 을 뺀 14건(붙박이 6 + 일반 8 — 잡 페스티벌 구인기업 모집은 기업 참가 공고라 남긴다)을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(14);
    expect(rows[0]).toMatchObject({
      title: "2026년 산업단지 에너지 자급자족형 인프라 구축 및 운영사업 2차 재공고",
      detailUrl: "https://www.kicox.or.kr/boardDetail/1016?bbsSeq=49427",
      // 붙박이라 등록일을 개시일로 넘기지 않는다(아래 「붙박이」 시험이 이유를 잰다).
      dateText: "",
      agency: "한국산업단지공단",
    });
  });

  it("일반 행 첫 줄은 등록일을 개시형으로 넘긴다", () => {
    const first = rows.find((r) => r.detailUrl.endsWith("bbsSeq=49468"));
    expect(first).toMatchObject({
      title: "한국산업단지공단-KB국민은행 협력 산업단지 입주기업 지원 협약보증 안내",
      detailUrl: "https://www.kicox.or.kr/boardDetail/1016?bbsSeq=49468",
      dateText: "2026-08-26 ~",
    });
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal).toHaveLength(8);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("★상세 주소는 onClick 번호로 조립하고 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(/^https:\/\/www\.kicox\.or\.kr\/boardDetail\/1016\?bbsSeq=\d+$/);
      expect(r.detailUrl).not.toMatch(/pageIndex/);
      expect(r.detailUrl).not.toMatch(/#none/);
    }
  });

  it("★2쪽부터는 붙박이 공지를 담지 않는다 — 쪽마다 되풀이돼 같은 글이 여러 줄이 된다", () => {
    expect(rowsP2).toHaveLength(7);
    expect(rowsP2.some((r) => r.detailUrl.endsWith("bbsSeq=49427"))).toBe(false);
    // 쪽을 안 넘기면(=1쪽 취급) 붙박이가 그대로 딸려 온다는 증거 — 위 규칙이 진짜 일한다.
    expect(parseKicoxList(listP2Html, 1)).toHaveLength(13);
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없고 21건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(21);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pageIndex 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2026 산업단지 오픈이노베이션 프로그램 KICXUP 챌린지&로컬 스타트업 모집 공고 안내",
      detailUrl: "https://www.kicox.or.kr/boardDetail/1016?bbsSeq=49188",
      dateText: "2026-08-05 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("세미나"))).toBe(false);
    expect(titles.some((t) => t.includes("설문조사"))).toBe(false);
    expect(titles.some((t) => t.includes("포상계획"))).toBe(false);
    expect(titles.some((t) => t.includes("유공자"))).toBe(false);
    expect(titles.some((t) => t.includes("자문위원"))).toBe(false);
    expect(titles.some((t) => t.includes("통근버스"))).toBe(false);
    expect(
      isKicoxDropTitle(
        "한국의료기기안전정보원-G밸리의료기기개발지원센터 2026년 의료기기 혁신성장 세미나 개최 안내(2026.9.3.(목))",
      ),
    ).toBe(true);
    expect(isKicoxDropTitle("계양산업단지 지원시설용지 분양 관련 사전 수요조사(설문조사)")).toBe(true);
    // 잡 페스티벌 구인기업 모집은 기업이 부스 참가를 신청하는 지원 공고라 버리지 않는다(코덱스 지적 2026-09-03).
    expect(isKicoxDropTitle("2026 KB굿잡 부산 잡(JOB) 페스티벌 구인기업 모집 안내")).toBe(false);
    expect(isKicoxDropTitle("2026년 지역산업 균형발전 유공 포상계획 공고")).toBe(true);
    expect(isKicoxDropTitle("2026 대한민국 산업단지 발전 유공자 모집 공고(기간 연장)")).toBe(true);
    expect(isKicoxDropTitle("2026년 한국산업단지공단 건축자문위원 모집 공고")).toBe(true);
    expect(
      isKicoxDropTitle("2026년 대구국가 및 달성2차산단 근로자 통근버스 노선도 및 이용방법 안내"),
    ).toBe(true);
  });

  it("★DROP 을 넓게 잡지 않는다 — 「수요기업 모집」·「채용 지원사업」은 살아남는다", () => {
    // 「수요조사」를 버리면서 「수요기업」까지 죽이면 실측 5건이 통째로 사라진다.
    expect(rows.some((r) => r.title.includes("수요기업 모집공고"))).toBe(true);
    expect(isKicoxDropTitle("울산미포 에너지자급자족형 인프라 구축사업 수요기업 모집공고(상시)")).toBe(false);
    expect(isKicoxDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(isKicoxDropTitle("2026년 산업단지 ESG 기업지원사업 참여기업 모집")).toBe(false);
  });

  it("★붙박이 공지는 등록일을 개시일로 넘기지 않고, 1년 넘게 붙어 있으면 아예 안 담는다", () => {
    const pinned = rows.filter((r) => r.dateText === "");
    expect(pinned).toHaveLength(6);
    // 4개월 전 등록일을 개시일로 넘기면 저장 즉시 마감된다(store 의 openStartExpired).
    expect(pinned.some((r) => r.detailUrl.endsWith("bbsSeq=48359"))).toBe(true);
    const old = parseKicoxList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old).toHaveLength(8);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });

  it("날짜는 td.b_date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("bbsSeq=49468"));
    expect(r?.dateText).toBe("2026-08-26 ~");
    // 번호 1042 · 조회수 67 이 붙은 「10422026-08-26」·「672026-08-26」 이 아니어야 한다.
    expect(r?.dateText).not.toMatch(/1042/);
    expect(r?.dateText).not.toMatch(/67/);
  });
});

describe("한국산업단지공단 설정", () => {
  it("쪽넘김은 GET pageIndex — boardList/1016(공지사항)", () => {
    expect(kicoxConfig.list.url(1)).toBe("https://www.kicox.or.kr/boardList/1016?pageIndex=1");
    expect(kicoxConfig.list.url(2)).toBe("https://www.kicox.or.kr/boardList/1016?pageIndex=2");
    expect(kicoxConfig.list.maxPages).toBe(8);
  });

  it("지역은 전국 — 전국 산업단지 공고를 싣는다", () => {
    expect(kicoxConfig.region).toBe("전국");
    expect(kicoxConfig.id).toBe("kicox");
    expect(kicoxConfig.agency).toBe("한국산업단지공단");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kicoxConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(kicoxConfig.expectMinRows!);
  });

  it("★heuristic 추측 단계를 막는다 — 목록 링크가 전부 href=#none 이라 18줄이 같은 주소로 저장된다", () => {
    const guessed = extractByHeuristic(listHtml, kicoxConfig.baseUrl);
    expect(guessed).toHaveLength(18);
    expect(new Set(guessed.map((r) => r.detailUrl)).size).toBe(1);
    expect(guessed[0].detailUrl).toBe("https://www.kicox.or.kr/#none");
    expect(kicoxConfig.skipHeuristic).toBe(true);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseKicoxList(listHtml.replaceAll('class="board"', 'class="board-x"'), 1)).toHaveLength(0);
  });

  it("제목 칸(td.cont)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKicoxList(listHtml.replaceAll('class="cont"', 'class="cont-x"'), 1)).toHaveLength(0);
  });

  it("상세 번호를 부르는 함수 이름이 바뀌면 한 줄도 못 읽는다 — 주소를 지어내지 않는다", () => {
    expect(parseKicoxList(listHtml.replaceAll("bbsArticleDet(", "bbsArticleDetX("), 1)).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseKicoxList(listHtml.replaceAll('class="b_date"', 'class="b_date-x"'), 1);
    expect(broken).toHaveLength(14);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
