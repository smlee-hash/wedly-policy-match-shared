import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCbfDropTitle, parseCbfList, cbfConfig } from "./cbf";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `twb_bbs/bbs_list.php?bcd=01_05_02_00_00`(사업공고) 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/cbf-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/cbf-list-p2.html"), "utf-8");
const rows = parseCbfList(listHtml);
const rowsP2 = parseCbfList(listP2Html, 2);
const combined = [...rows, ...rowsP2];

describe("춘천바이오산업진흥원 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄을 그대로 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "2026 모두의창업 모두의 해커톤 프로그램 참가자 모집 공고",
      detailUrl:
        "https://www.cbf.or.kr/twb_bbs/bbs_read.php?groupid=1&bcd=01_05_02_00_00&bn=984",
      dateText: "2026-08-06 ~",
      agency: "춘천바이오산업진흥원",
    });
  });

  it("★상세 주소에 쪽 번호(pg)를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]pg=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]pg=/.test(r.detailUrl))).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(20);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pg= 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 강원 바이오엑스포 & 지역 창업페스티벌 참가기업 모집",
      detailUrl:
        "https://www.cbf.or.kr/twb_bbs/bbs_read.php?groupid=1&bcd=01_05_02_00_00&bn=973",
      dateText: "2026-06-02 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("제목 안의 &(엔티티)를 그대로 살린다", () => {
    expect(rows.some((r) => r.title.includes("바이오엑스포 & 지역 창업페스티벌"))).toBe(true);
    expect(combined.every((r) => !r.title.includes("&amp;"))).toBe(true);
  });

  it("날짜는 td.date 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("bn=984"));
    expect(r?.dateText).toBe("2026-08-06 ~");
    // 번호 891 · 조회수 5430 이 앞뒤로 붙으면 「8912026-08-06」·「2026-08-065430」이 된다.
    expect(r?.dateText).not.toMatch(/891/);
    expect(r?.dateText).not.toMatch(/5430/);
  });
});

describe("지원사업이 아닌 글 거르기(DROP)", () => {
  it("실측 제목이 든 행을 실제로 버린다 — 고정본의 한 줄을 평가위원 공고로 바꿔 잰다", () => {
    const mutated = listHtml.replace(
      "2026 모두의창업 모두의 해커톤 프로그램 참가자 모집 공고",
      "용역 제안서 평가위원 모집 공고",
    );
    const dropped = parseCbfList(mutated);
    expect(dropped).toHaveLength(9);
    expect(dropped.some((r) => r.title.includes("평가위원"))).toBe(false);
    expect(dropped.some((r) => r.detailUrl.includes("bn=984"))).toBe(false);
  });

  it("버릴 낱말만 좁게 잡는다", () => {
    expect(isCbfDropTitle("2026년 청소용역 입찰 공고")).toBe(true);
    expect(isCbfDropTitle("사업 만족도 설문 조사 안내")).toBe(true);
    expect(isCbfDropTitle("기술평가 예비평가위원 모집 공고")).toBe(true);
    expect(isCbfDropTitle("신입직원 채용 공고")).toBe(true);
    expect(isCbfDropTitle("최종 합격자 발표")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isCbfDropTitle("강원 바이오기업 성장 촉진 및 고용활성화(채용) 지원기업 모집")).toBe(false);
    expect(isCbfDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    // 고정본 1·2쪽은 전부 지원사업이라 한 줄도 안 버려진다.
    expect(combined).toHaveLength(20);
  });
});

describe("붙박이 공지(번호 칸이 「공지」) 처리", () => {
  const pinned = listHtml.replace(
    '<td class="number mobile">891</td>',
    '<td class="number mobile">공지</td>',
  );

  it("붙박이는 날짜를 비운다 — 옛 등록일을 그대로 쓰면 저장 즉시 마감된다", () => {
    const r = parseCbfList(pinned).find((x) => x.detailUrl.includes("bn=984"));
    expect(r?.dateText).toBe("");
    // 붙박이가 아닌 나머지 행은 그대로 날짜가 있다.
    expect(parseCbfList(pinned).filter((x) => x.dateText !== "")).toHaveLength(9);
  });

  it("1년 넘게 붙어 있는 붙박이는 아예 담지 않는다", () => {
    const twoYearsLater = Date.parse("2028-08-06T00:00:00Z");
    const kept = parseCbfList(pinned, 1, twoYearsLater);
    expect(kept).toHaveLength(9);
    expect(kept.some((r) => r.detailUrl.includes("bn=984"))).toBe(false);
  });
});

describe("춘천바이오산업진흥원 설정", () => {
  it("쪽넘김은 GET pg + bcd=01_05_02_00_00", () => {
    expect(cbfConfig.list.url(1)).toBe(
      "https://www.cbf.or.kr/twb_bbs/bbs_list.php?bcd=01_05_02_00_00&pg=1",
    );
    expect(cbfConfig.list.url(2)).toBe(
      "https://www.cbf.or.kr/twb_bbs/bbs_list.php?bcd=01_05_02_00_00&pg=2",
    );
    expect(cbfConfig.list.maxPages).toBe(10);
  });

  it("지역은 강원", () => {
    expect(cbfConfig.id).toBe("cbf");
    expect(cbfConfig.region).toBe("강원");
    expect(cbfConfig.agency).toBe("춘천바이오산업진흥원");
    expect(cbfConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(cbfConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(cbfConfig.expectMinRows).toBeLessThanOrEqual(rows.length);
  });

  it("상세 본문·첨부 칸은 실측대로 못 박혀 있다", () => {
    // 실측(bn=984·982·980·976): 본문 상자 div.context 는 글자 0자(이미지뿐),
    // 접수기간·담당자는 div.business_info 에 있다.
    expect(cbfConfig.detailContentSelector).toBe("div.business_info");
    expect(cbfConfig.attachmentsScopeSelector).toBe("div.file_wrap");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseCbfList(listHtml.replaceAll("table_basic", "table_basic-x"))).toHaveLength(0);
  });

  it("제목 칸(td.title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseCbfList(listHtml.replaceAll('class="title"', 'class="title-x"'))).toHaveLength(0);
  });

  it("상세 링크의 bn 이 사라지면 담지 않는다", () => {
    expect(parseCbfList(listHtml.replaceAll("&bn=", "&bnx="))).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const r = parseCbfList(listHtml.replaceAll('class="date"', 'class="date-x"'));
    expect(r).toHaveLength(10);
    expect(r.every((x) => x.dateText === "")).toBe(true);
  });
});
