import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKetepDropTitle, parseKetepList, ketepConfig } from "./ketep";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-03 실측 `businessAcment?menuId=MENU002080200000000&pageNum=1|2&rowCnt=10`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/ketep-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/ketep-list-p2.html"), "utf-8");
const rows = parseKetepList(listHtml);
const rowsP2 = parseKetepList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("한국에너지기술평가원 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10줄을 그대로 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "2026년 3차 재생에너지R&D(태양광) 신규지원대상 연구개발과제 공고",
      detailUrl:
        "https://www.ketep.re.kr/businessAcment/view?menuId=MENU002080200000000&uni_ancm_id=D202610539",
      dateText: "2026-09-01 ~",
      category: "과제",
      agency: "한국에너지기술평가원",
    });
  });

  it("★상세 주소에 쪽 번호·한 쪽 건수를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    for (const r of combined) {
      expect(r.detailUrl).not.toMatch(/[?&]pageNum=/);
      expect(r.detailUrl).not.toMatch(/[?&]rowCnt=/);
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.ketep\.re\.kr\/businessAcment\/view\?menuId=MENU002080200000000&uni_ancm_id=[A-Za-z0-9_-]+$/,
      );
    }
  });

  it("제목의 HTML 기호를 풀어 담는다 — R&amp;D 가 R&D 로", () => {
    expect(rows[0].title).toContain("R&D");
    expect(combined.every((r) => !r.title.includes("&amp;"))).toBe(true);
  });

  it("목록이 등록일만 주므로 전부 개시형(뒤에 ~)으로 넘긴다", () => {
    expect(combined).toHaveLength(20);
    for (const r of combined) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("열쇠 모양 두 가지(D+9자리 · 순수 숫자)를 모두 읽는다", () => {
    const ids = combined.map((r) => r.detailUrl.split("uni_ancm_id=")[1]);
    expect(ids).toContain("D202610539");
    expect(ids).toContain("10262");
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pageNum 이 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2028년 차세대 분산형 전력망 핵심기술 집중 수요조사 공고",
      detailUrl:
        "https://www.ketep.re.kr/businessAcment/view?menuId=MENU002080200000000&uni_ancm_id=10253",
      dateText: "2026-05-15 ~",
      category: "수요",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("날짜는 등록일 칸에서만 집는다 — 행 전체 글자면 번호 칸과 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("uni_ancm_id=D202610539"));
    expect(r?.dateText).toBe("2026-09-01 ~");
    // 번호 칸이 「499」라 행 전체에서 찾으면 「4992026-09-01」이 된다.
    expect(r?.dateText).not.toMatch(/499/);
  });
});

/**
 * DROP — 이 게시판은 전량(2026-09-03 실측 499줄)이 사업공고·기술수요조사라 고정본 2쪽에는
 * 버릴 행이 하나도 없다. 그래서 ⓐ 같은 게시판 뒤쪽 쪽에 **실제로 있는** 제목으로 거르개를 재고
 * ⓑ 고정본의 진짜 행 제목을 그 실측 제목으로 바꿔 **파싱이 실제로 그 줄을 뺀다**는 것까지 잰다.
 */
describe("지원사업이 아닌 글 걸러내기", () => {
  it("실측 제목(전문가 공모)을 버린다", () => {
    expect(isKetepDropTitle("국제에너지기구(IEA) 기술협력 활동전문가 모집 공모")).toBe(true);
    expect(isKetepDropTitle("국제에너지기구 기술협력 활동전문가 추가 공모")).toBe(true);
    expect(
      isKetepDropTitle("2012년도 에너지국제공동연구 국제협력사업 다자협력활동 전문가 공모"),
    ).toBe(true);
  });

  it("진짜 사업공고는 하나도 안 버린다 — 「지정공모」·「수요조사」·「채용」이 죽으면 안 된다", () => {
    expect(isKetepDropTitle("2026년 3차 재생에너지R&D(태양광) 신규지원대상 연구개발과제 공고")).toBe(false);
    expect(isKetepDropTitle("2028년 에너지기술개발사업 기술수요조사")).toBe(false);
    expect(
      isKetepDropTitle("2018년도 (제1차) 에너지기술개발사업 신규지원 대상과제(지정공모형) 재공고"),
    ).toBe(false);
    expect(isKetepDropTitle("청년 채용 지원사업 참여기업 모집 공고")).toBe(false);
    expect(combined.every((r) => !isKetepDropTitle(r.title))).toBe(true);
  });

  it("고정본 한 줄의 제목을 실측 DROP 제목으로 바꾸면 그 줄이 빠진다", () => {
    const mutated = listHtml.replace(
      "2028년 에너지기술개발사업 기술수요조사",
      "국제에너지기구(IEA) 기술협력 활동전문가 모집 공모",
    );
    expect(mutated).not.toBe(listHtml);
    const dropped = parseKetepList(mutated);
    expect(dropped).toHaveLength(9);
    expect(dropped.some((r) => r.detailUrl.endsWith("uni_ancm_id=10254"))).toBe(false);
  });
});

/**
 * 붙박이 공지 — 실측 499줄이 전부 번호 1~499 로 매겨져 있어 지금은 붙박이가 없다.
 * 생겼을 때 1년 넘은 것이 「모집중」으로 되살아나지 않게 미리 막고, 고정본을 고쳐 그 길을 잰다.
 */
describe("붙박이 공지", () => {
  const pinned = listHtml
    .replace('aria-label="번호">\n                                499', 'aria-label="번호">\n                                공지')
    .replace('aria-label="등록일">2026-09-01<', 'aria-label="등록일">2020-01-02<');

  it("1년 넘은 붙박이는 아예 안 담는다", () => {
    expect(pinned).not.toBe(listHtml);
    const out = parseKetepList(pinned, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(out).toHaveLength(9);
    expect(out.some((r) => r.detailUrl.endsWith("uni_ancm_id=D202610539"))).toBe(false);
  });

  it("최근 붙박이는 담되 날짜를 비운다 — 옛 등록일로 즉시 마감되지 않게", () => {
    const fresh = listHtml.replace(
      'aria-label="번호">\n                                499',
      'aria-label="번호">\n                                공지',
    );
    const out = parseKetepList(fresh, 1, Date.parse("2026-09-03T00:00:00Z"));
    expect(out).toHaveLength(10);
    expect(out[0].dateText).toBe("");
  });
});

describe("한국에너지기술평가원 설정", () => {
  it("쪽넘김은 GET pageNum + rowCnt 고정", () => {
    expect(ketepConfig.list.url(1)).toBe(
      "https://www.ketep.re.kr/businessAcment?menuId=MENU002080200000000&pageNum=1&rowCnt=10",
    );
    expect(ketepConfig.list.url(2)).toBe(
      "https://www.ketep.re.kr/businessAcment?menuId=MENU002080200000000&pageNum=2&rowCnt=10",
    );
    expect(ketepConfig.list.maxPages).toBe(8);
  });

  it("기관·지역·열쇠", () => {
    expect(ketepConfig.id).toBe("ketep");
    expect(ketepConfig.agency).toBe("한국에너지기술평가원");
    expect(ketepConfig.region).toBe("전국");
    expect(ketepConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(ketepConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(ketepConfig.expectMinRows).toBeLessThanOrEqual(rows.length);
  });

  it("상세 본문·첨부 범위를 공고 상자로 못 박는다", () => {
    expect(ketepConfig.detailContentSelector).toBe("article.board_view div.contents");
    expect(ketepConfig.attachmentsScopeSelector).toBe("article.board_view div.contents");
  });

  it("heuristic 은 끄지 않는다 — 목록 행에 첨부 링크가 섞이지 않아 마지막 방어선으로 쓸 만하다", () => {
    expect(ketepConfig.skipHeuristic).toBeUndefined();
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseKetepList(listHtml.replaceAll("tstyle_list", "tstyle_list-x"))).toHaveLength(0);
  });

  it("제목 칸(td.txt_left)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKetepList(listHtml.replaceAll('class="txt_left"', 'class="txt_left-x"'))).toHaveLength(0);
  });

  it("상세 열쇠(uni_ancm_id)가 사라지면 한 줄도 안 담는다 — 주소를 지어내지 않는다", () => {
    expect(parseKetepList(listHtml.replaceAll("uni_ancm_id=", "uni_ancm_idx="))).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const out = parseKetepList(listHtml.replaceAll('aria-label="등록일"', 'aria-label="등록일-x"'));
    expect(out).toHaveLength(10);
    expect(out.every((r) => r.dateText === "")).toBe(true);
  });
});
