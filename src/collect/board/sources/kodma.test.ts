import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKodmaDropTitle, parseKodmaList, kodmaConfig, stripKodmaTitlePrefix } from "./kodma";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-05 실측 공지사항 통합 게시판 1·2쪽 (`/bbs/list.do?key=2409240028&pageIndex=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kodma-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kodma-list-p2.html"), "utf-8");
const rows = parseKodmaList(listHtml);
const rowsP2 = parseKodmaList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("중소벤처기업유통원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본 10행에서 DROP 뒤 4건이 남고 첫 남은 행의 제목·상세주소·날짜가 맞다", () => {
    // 10행 = 공모전1 + 세계한상대회2 + 협조공지1 + 사칭1 + 국정성과1 = DROP 6 → 4건.
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      // 말머리 `[공고]` 는 저장 전에 뗀다 — 다른 게시판이 말머리 없이 올린 같은 공고와 열쇠를 맞춘다.
      title: "2026년 소상공인 온라인판로 지원사업 참여기업 2차 모집공고",
      detailUrl: "https://www.kodma.or.kr/bbs/view.do?key=2409240028&pstSn=2605270001",
      dateText: "2026-05-27 ~",
      agency: "중소벤처기업유통원",
    });
    expect(rows[0].detailUrl).toContain("view.do?key=2409240028&pstSn=");
  });

  it("「숏폼영상 공모전」은 없다 — DROP 이 실측 제목을 버린다", () => {
    expect(rows.some((r) => r.title.includes("숏폼영상 공모전"))).toBe(false);
    expect(combined.some((r) => r.title.includes("숏폼영상 공모전"))).toBe(false);
    expect(isKodmaDropTitle("[한국중소벤처기업유통원] 2026 「사장님, 힘내세요!」 숏폼영상 공모전")).toBe(
      true,
    );
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("상세 주소는 href(#)가 아니라 onclick goView 번호로 조립하고 쪽 번호가 안 섞인다", () => {
    expect(combined.length).toBeGreaterThan(0);
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kodma\.or\.kr\/bbs\/view\.do\?key=2409240028&pstSn=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]pageIndex=/);
      expect(r.detailUrl).not.toMatch(/#$/);
    }
  });

  it("DROP 거르개가 실측 제목 유형만 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("세계한상대회"))).toBe(false);
    expect(titles.some((t) => t.includes("국민제안"))).toBe(false);
    expect(titles.some((t) => t.includes("사칭"))).toBe(false);
    expect(titles.some((t) => t.includes("회원제 폐지"))).toBe(false);
    expect(titles.some((t) => t.includes("소송수행"))).toBe(false);
    expect(titles.some((t) => t.includes("고객만족도"))).toBe(false);
    expect(titles.some((t) => t.includes("[협조 공지]"))).toBe(false);
    expect(isKodmaDropTitle("[공지] 제24차 세계한상대회 기업전시회 참가 기업 모집 안내")).toBe(true);
    expect(isKodmaDropTitle("[협조 공지] 공공기관 AI 활용 국민제안 접수(상시) 안내")).toBe(true);
    expect(isKodmaDropTitle("[공지] 기관 직원 사칭 및 사기 행위 주의 안내")).toBe(true);
    expect(isKodmaDropTitle("한국중소벤처기업유통원 홈페이지 회원제 폐지 및 개인정보파기 안내")).toBe(
      true,
    );
    expect(isKodmaDropTitle("2026 소송수행대리인단 위촉(공개모집) 선정결과 안내")).toBe(true);
    expect(isKodmaDropTitle("공공기관 고객만족도 조사 관련 개인정보 제3자 제공사항 등 알림")).toBe(true);
  });

  it("「공모」 낱말 전체를 버리지 않는다 — 지원사업 공모가 죽으면 안 된다", () => {
    expect(rows.some((r) => r.title.includes("2차 모집공고"))).toBe(true);
    expect(isKodmaDropTitle("[공고] 2026년 소상공인 온라인판로 지원사업 참여기업 2차 모집공고")).toBe(
      false,
    );
    expect(rows.some((r) => r.title.startsWith("[공고]"))).toBe(false);
    expect(isKodmaDropTitle("2026년 소상공인 판로 지원사업 공모")).toBe(false);
  });

  it("날짜는 div.date 칸에서만 집는다 — 행 전체 글자면 번호 칸과 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("pstSn=2605270001"));
    expect(r?.dateText).toBe("2026-05-27 ~");
    expect(r?.dateText).not.toMatch(/543/);
    expect(r?.dateText).not.toMatch(/546/);
  });

  it("★[국정성과] 보도성 글은 버린다 — 신청 절차가 없는데 90일간 모집중으로 남았다", () => {
    // 고정본 1쪽 실측 제목. DROP 을 통과하면 등록일이 개시일로 저장돼 공고 행세를 한다.
    expect(combined.some((r) => r.title.includes("한유원이 지원합니다"))).toBe(false);
    expect(isKodmaDropTitle("[국정성과] 중소·벤처·소상공인 판로·마케팅, 한유원이 지원합니다.")).toBe(true);
  });

  it("★「개인정보」 단독으로는 안 버린다 — 개인정보보호 지원사업이 같이 죽었다", () => {
    expect(isKodmaDropTitle("2026년 소상공인 개인정보보호 컨설팅 지원사업 참여기업 모집")).toBe(false);
    expect(isKodmaDropTitle("개인정보 처리방침 개정 안내")).toBe(true);
    expect(isKodmaDropTitle("개인정보파기 안내")).toBe(true);
    expect(isKodmaDropTitle("개인정보 제3자 제공사항 알림")).toBe(true);
  });

  it("★말머리를 떼어 다른 게시판의 같은 공고와 제목을 맞춘다(dedupKey 는 제목+기관)", () => {
    // 광명센터가 말머리 없이 올린 같은 공고와 글자가 같아야 저장 쪽 병합이 접을 수 있다.
    expect(stripKodmaTitlePrefix("[공고] 2026년 소상공인 온라인판로 지원사업 참여기업 모집공고"))
      .toBe("2026년 소상공인 온라인판로 지원사업 참여기업 모집공고");
    expect(stripKodmaTitlePrefix("[모집] 참여기업 모집")).toBe("참여기업 모집");
    expect(stripKodmaTitlePrefix("[재공고] 수행기관 모집")).toBe("수행기관 모집");
    // 말머리가 아닌 대괄호·「[공지]」는 건드리지 않는다(저장 쪽 고정 공지 예외가 그 글자를 본다).
    expect(stripKodmaTitlePrefix("[공지] 상시 모집")).toBe("[공지] 상시 모집");
    expect(stripKodmaTitlePrefix("[2026 중국 하이테크 전시회] 공동관")).toBe("[2026 중국 하이테크 전시회] 공동관");
    // 2쪽 실측 행이 실제로 말머리 없이 저장된다.
    expect(rowsP2.some((r) => r.title === "2026년 소상공인 온라인판로 지원사업 참여기업 모집공고")).toBe(true);
    expect(combined.every((r) => !/^\s*[[［【]\s*(공고|모집|재공고)\s*[\]］】]/.test(r.title))).toBe(true);
  });

  it("머리줄(div.list-row.table-title)은 결과에 안 섞인다", () => {
    expect(rows.some((r) => r.title === "제목")).toBe(false);
    expect(combined.every((r) => r.title.length > 2)).toBe(true);
  });
});

describe("중소벤처기업유통원 설정", () => {
  it("쪽넘김은 GET pageIndex — config.list.url(2) 에 pageIndex=2 가 있다", () => {
    expect(kodmaConfig.list.url(1)).toBe(
      "https://www.kodma.or.kr/bbs/list.do?key=2409240028&pageIndex=1",
    );
    expect(kodmaConfig.list.url(2)).toContain("pageIndex=2");
    expect(kodmaConfig.list.url(2)).toBe(
      "https://www.kodma.or.kr/bbs/list.do?key=2409240028&pageIndex=2",
    );
    expect(kodmaConfig.list.maxPages).toBe(3);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(kodmaConfig.id).toBe("kodma");
    expect(kodmaConfig.label).toBe("중소벤처기업유통원");
    expect(kodmaConfig.agency).toBe("중소벤처기업유통원");
    expect(kodmaConfig.region).toBe("전국");
    expect(kodmaConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kodmaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(kodmaConfig.expectMinRows!);
  });
});
