import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import { isGmsbdcDropTitle, parseGmsbdcList, gmsbdcConfig } from "./gmsbdc";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `https://sbdc.gm.go.kr/s41` 1쪽 + `index.php?mid=s41&page=2` 2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/gmsbdc-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/gmsbdc-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseGmsbdcList(listHtml, 1, NOW);
const rowsP2 = parseGmsbdcList(listP2Html, 2, NOW);
const combined = parseGmsbdcList(listHtml + listP2Html, 1, NOW);

describe("광명시 소상공인지원센터 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 17건을 읽고 첫 행이 맞다", () => {
    // 붙박이 2 + 일반 19 − DROP 4(공개채용·신입생·무상점검·통큰 세일).
    expect(rows).toHaveLength(17);
    expect(rows.length).toBeGreaterThanOrEqual(gmsbdcConfig.expectMinRows ?? 0);
    expect(rows[0]).toMatchObject({
      title: "★ 2026년 소상공인 경영역량강화 교육, 교육대상자 모집",
      detailUrl: "https://sbdc.gm.go.kr/s41/26834",
      dateText: "",
      agency: "광명시 소상공인지원센터",
    });
  });

  it("최신 일반글의 제목·상세주소·dateText 가 맞다 — 등록일이라 개시형", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("/s41/27026"));
    expect(r).toMatchObject({
      title:
        "[중소벤처기업부&소상공인시장진흥공단] 『2026년도 희망리턴패키지 재기사업화(경영개선)』위기 소상공인 진단·멘토링 지원 모집",
      detailUrl: "https://sbdc.gm.go.kr/s41/27026",
      dateText: "2026-08-20 ~",
      agency: "중소벤처기업부&소상공인시장진흥공단",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 2쪽 href 는 page=2&document_srl 혼용", () => {
    // 주소가 곧 중복 판정 열쇠(sourceId)다. 쪽 번호가 섞이면 같은 글이 쪽마다 다른 줄이 된다.
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => /^https:\/\/sbdc\.gm\.go\.kr\/s41\/\d+$/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.some((r) => r.detailUrl === "https://sbdc.gm.go.kr/s41/26371")).toBe(true);
  });

  it("★1년 넘게 붙어 있는 고정 공지는 아예 안 담는다 — 날짜를 비우면 90일간 되살아난다", () => {
    const old = parseGmsbdcList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old.some((r) => r.detailUrl.endsWith("/s41/26834"))).toBe(false);
    expect(old.some((r) => r.detailUrl.endsWith("/s41/25938"))).toBe(false);
    expect(old.every((r) => r.dateText !== "")).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    // 1쪽 17 + 2쪽 일반 20 − DROP 1(통큰 세일). 붙박이 2건은 쪽마다 반복이라 한 번만.
    expect(combined).toHaveLength(36);
    expect(rowsP2[0].detailUrl).toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = [...rows, ...rowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("공개채용"))).toBe(false);
    expect(titles.some((t) => t.includes("신입생"))).toBe(false);
    expect(titles.some((t) => t.includes("무상점검"))).toBe(false);
    expect(titles.some((t) => t.includes("통큰 세일"))).toBe(false);
    expect(
      isGmsbdcDropTitle(
        "「2026년 광명시상인회총연합회」상권 활성화 계약직 (사무국장) 공개채용 공고(마감)",
      ),
    ).toBe(true);
    expect(isGmsbdcDropTitle("[부천대학교] 소상공인융합비즈니스과 신입생 모집")).toBe(true);
    expect(isGmsbdcDropTitle("카포스 광명시지회와 함께하는 2026년 자동차 무상점검")).toBe(true);
    expect(isGmsbdcDropTitle("26년 상반기 경기 살리기 통큰 세일 : '26. 03. 20.(금) ~ '26.03.29.(일)")).toBe(
      true,
    );
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업은 살아남는다", () => {
    expect(isGmsbdcDropTitle("청년 채용 지원금 참여기업 모집")).toBe(false);
    expect(
      parseGmsbdcList(
        listHtml.replace(
          "「2026 광명시 온라인 마케팅 교육」참여 모집",
          "청년 채용 지원금 참여기업 모집",
        ),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원금")),
    ).toBe(true);
  });

  it("기관을 「광명시 소상공인지원센터」로 못 박지 않는다 — 제목 앞 대괄호에서 뽑고, 없으면 기본값", () => {
    expect(rows.some((r) => r.agency === "중소벤처기업부&소상공인시장진흥공단")).toBe(true);
    expect(rows.some((r) => r.agency === "경기도시장상권진흥원")).toBe(true);
    expect(rows.some((r) => r.agency === "광명시 소상공인지원센터")).toBe(true);
  });

  it("날짜는 td.time 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("/s41/27026"));
    expect(r?.dateText).toBe("2026-08-20 ~");
    expect(r?.dateText).not.toMatch(/227|56/);
    const polluted = listHtml.replace(
      "[중소벤처기업부&amp;소상공인시장진흥공단] 『2026년도 희망리턴패키지 재기사업화(경영개선)』위기 소상공인 진단·멘토링 지원 모집",
      "[중소벤처기업부&amp;소상공인시장진흥공단] (2026.01.05) 희망리턴패키지",
    );
    const hit = parseGmsbdcList(polluted, 1, NOW).find((x) => x.detailUrl.endsWith("/s41/27026"));
    expect(hit?.dateText).toBe("2026-08-20 ~");
    expect(hit?.dateText).not.toContain("2026-01-05");
  });
});

describe("광명시 소상공인지원센터 설정", () => {
  it("쪽넘김은 GET page + mid=s41", () => {
    expect(gmsbdcConfig.list.url(1)).toBe("https://sbdc.gm.go.kr/index.php?mid=s41&page=1");
    expect(gmsbdcConfig.list.url(2)).toBe("https://sbdc.gm.go.kr/index.php?mid=s41&page=2");
    expect(pagingParamsOf(gmsbdcConfig)).toContain("page");
    expect(gmsbdcConfig.list.maxPages).toBe(6);
  });

  it("지역은 경기 — 광명시 산하 소상공인지원센터다", () => {
    expect(gmsbdcConfig.region).toBe("경기");
    expect(gmsbdcConfig.id).toBe("gmsbdc");
  });

  it("서식 변경 감지가 살아 있다 — 한 쪽 19건의 절반", () => {
    expect(gmsbdcConfig.expectMinRows).toBe(9);
  });

  it("상세 본문·첨부 선택자가 비어 있지 않다 — 실측 div.xe_content · ul.files", () => {
    expect(gmsbdcConfig.detailContentSelector).toBe("div.xe_content");
    expect(gmsbdcConfig.attachmentsScopeSelector).toBe("ul.files");
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGmsbdcList(listHtml.replaceAll("table-hover", "table-hover-x"), 1, NOW)).toHaveLength(0);
  });

  it("제목 칸(td.title)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGmsbdcList(listHtml.replaceAll('class="title"', 'class="title-x"'), 1, NOW)).toHaveLength(0);
  });

  it("행 선택자를 틀리게 준 설정으로 고정본에서 0행이다", () => {
    expect(parseHtml(listHtml).querySelectorAll("table.table-hover-x tbody tr")).toHaveLength(0);
    expect(parseHtml(listHtml).querySelectorAll(gmsbdcConfig.list.rowSelector).length).toBe(21);
  });
});
