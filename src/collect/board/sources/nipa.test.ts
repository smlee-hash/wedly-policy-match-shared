import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isNipaDropTitle, parseNipaList, nipaConfig } from "./nipa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `nttList?bbsNo=4&tab=2` 1·2쪽(각 110KB).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/nipa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/nipa-list-p2.html"), "utf-8");
const rows = parseNipaList(listHtml);
const rowsP2 = parseNipaList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("정보통신산업진흥원(NIPA) 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄을 그대로 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "2026년 KoVAC XR 쇼룸 입주기업 2차 모집",
      detailUrl:
        "https://www.nipa.kr/home/bsnsAll/0/nttDetail?tab=2&bbsNo=4&bsnsDtlsIemNo=&nttNo=16900",
      dateText: "2026-08-18 ~ 2026-09-17",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(combined.every((r) => !/[?&]curPage=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => /^https:\/\/www\.nipa\.kr\/home\/bsnsAll\/0\/nttDetail\?/.test(r.detailUrl))).toBe(
      true,
    );
  });

  it("신청기간은 「시작 ~ 끝」 접수기간형이고 시각(14:00)은 떼어 낸다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
    expect(rows[0].dateText).not.toContain("14:00");
    // 시각을 남기면 parseApplyPeriod 가 「YYYY-MM-DD ~ YYYY-MM-DD」를 못 읽어 신청기간이 통째로 빈다.
    expect(rows[0].dateText).not.toContain(":");
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(20);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — curPage= 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2026 가상융합산업허브 입주기업 모집(2차)",
      detailUrl:
        "https://www.nipa.kr/home/bsnsAll/0/nttDetail?tab=2&bbsNo=4&bsnsDtlsIemNo=&nttNo=16872",
      dateText: "2026-07-28 ~ 2026-08-21",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("날짜는 칸(span.bco) 단위로만 집는다 — 상태뱃지·담당자·조회수와 안 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("nttNo=16900"));
    expect(r?.dateText).toBe("2026-08-18 ~ 2026-09-17");
    expect(r?.dateText).not.toMatch(/D-14/);
    expect(r?.dateText).not.toMatch(/이종석/);
  });

  it("접수기간에 날짜가 하나뿐이면 등록일 대신 그 날짜를 개시형으로 넘긴다", () => {
    const mutated = listHtml.replace(
      "신청기간 : 2026-08-18 14:00 ~ 2026-09-17 15:00",
      "신청기간 : 예산 소진 시까지",
    );
    // 「오늘」을 못 박는다 — 안 그러면 1년 뒤에 아래 나이 검사에 걸려 시험이 저 혼자 빨개진다.
    const got = parseNipaList(mutated, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(got).toHaveLength(10);
    // 접수기간이 사라지면 마지막 칸의 등록일(2026-08-18)로 되떨어진다.
    expect(got[0].dateText).toBe("2026-08-18 ~");
  });

  it("개시형으로 되떨어진 줄이 1년 넘게 묵었으면 아예 안 담는다 — 90일 되살아남 방지", () => {
    const mutated = listHtml.replace(
      "신청기간 : 2026-08-18 14:00 ~ 2026-09-17 15:00",
      "신청기간 : 예산 소진 시까지",
    );
    const got = parseNipaList(mutated, 1, Date.parse("2028-01-01T00:00:00Z"));
    expect(got).toHaveLength(9);
    expect(got.some((r) => r.detailUrl.includes("nttNo=16900"))).toBe(false);
    // 접수기간이 살아 있는 줄은 아무리 오래돼도 그대로 담는다(마감은 저장 쪽이 판정한다).
    expect(got.some((r) => r.detailUrl.includes("nttNo=16899"))).toBe(true);
  });

  it("DROP 거르개는 「버릴 것만」 좁게 — 실측 10건은 한 줄도 안 버린다", () => {
    expect(rows).toHaveLength(10);
    expect(isNipaDropTitle("2026년 정보통신 용역 입찰공고")).toBe(true);
    expect(isNipaDropTitle("2026년 AI 반도체 사업 평가위원 모집 공고")).toBe(true);
    expect(isNipaDropTitle("2026년 상반기 직원 채용 공고")).toBe(true);
    expect(isNipaDropTitle("2026년 SW 인재양성 사업 최종 합격자 발표")).toBe(true);
    expect(isNipaDropTitle("이용자 만족도 설문조사 안내")).toBe(true);
  });

  it("★거르개가 parse 에 실제로 물려 있다 — 제목만 입찰공고로 바꾸면 그 줄이 사라진다", () => {
    const mutated = listHtml.replace(
      "2026년 KoVAC XR 쇼룸 입주기업 2차 모집",
      "2026년 KoVAC XR 쇼룸 조성 용역 입찰공고",
    );
    const got = parseNipaList(mutated);
    expect(got).toHaveLength(9);
    expect(got.some((r) => r.detailUrl.includes("nttNo=16900"))).toBe(false);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isNipaDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(isNipaDropTitle("2026년 KoVAC XR 쇼룸 입주기업 2차 모집")).toBe(false);
    expect(isNipaDropTitle("2026년 오픈소스 개발자 대회 공고")).toBe(false);
  });
});

describe("정보통신산업진흥원 설정", () => {
  it("쪽넘김은 GET curPage + bbsNo=4&tab=2(사업공고 전용 탭)", () => {
    expect(nipaConfig.list.url(1)).toBe(
      "https://www.nipa.kr/home/bsnsAll/0/nttList?bbsNo=4&tab=2&curPage=1",
    );
    expect(nipaConfig.list.url(2)).toBe(
      "https://www.nipa.kr/home/bsnsAll/0/nttList?bbsNo=4&tab=2&curPage=2",
    );
    expect(nipaConfig.list.maxPages).toBe(8);
  });

  it("지역은 전국", () => {
    expect(nipaConfig.region).toBe("전국");
    expect(nipaConfig.id).toBe("nipa");
    expect(nipaConfig.agency).toBe("정보통신산업진흥원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(nipaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("상세 본문 칸을 적어 둔다 — 첨부(getFile)는 확장자가 없어 공용 수확기가 못 본다", () => {
    expect(nipaConfig.detailContentSelector).toBe("label.cont_align");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 표(table.tbgg)가 한 글자 틀리면 0행이다", () => {
    expect(parseNipaList(listHtml.replaceAll('class="tbgg"', 'class="tbgg-x"'))).toHaveLength(0);
  });

  it("제목 칸(td.tl)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseNipaList(listHtml.replaceAll('class="tl"', 'class="tl-x"'))).toHaveLength(0);
  });

  it("날짜 칸(span.bco)이 사라지면 날짜를 비운다 — 행 전체 글자에서 주워 오지 않는다", () => {
    const broken = parseNipaList(listHtml.replaceAll('class="bco"', 'class="bco-x"'));
    expect(broken).toHaveLength(10);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });

  it("상세 링크(nttNo)가 사라지면 그 줄을 버린다 — 열쇠 없는 줄을 저장하지 않는다", () => {
    expect(parseNipaList(listHtml.replaceAll("nttNo=", "nttNoX="))).toHaveLength(0);
  });
});
