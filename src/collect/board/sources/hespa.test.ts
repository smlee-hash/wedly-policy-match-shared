import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseHtml } from "../html";
import { fetchBoardAll, pagelessSource } from "../engine";
import {
  buildHespaDetailHtml,
  extractHespaRData,
  hespaConfig,
  isHespaDropTitle,
  parseHespaList,
} from "./hespa";

/**
 * ★손으로 쓴 자료 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 자료로 시험하면 선택자·열쇠 오타가 그대로 통과한다.
 * 고정본(2026-09-06 실측):
 * · `hespa-list.json` = `https://hespa.or.kr/bbs2/bbs_gate.php?cmd=get_blist&pm_id=23` 응답 전문(16건)
 * · `hespa-detail.html` = `https://hespa.or.kr/main/index.php?m_cd=23&b_id=20260615083905479`
 */
const listJson = readFileSync(join(__dirname, "../__fixtures__/hespa-list.json"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/hespa-detail.html"), "utf-8");
const rows = parseHespaList(listJson);

describe("헬스케어스파산업진흥원 목록 읽기 — JSON 통로 고정본", () => {
  it("고정본 16건에서 거르개를 지난 6건을 읽고 첫 행이 맞다", () => {
    expect(JSON.parse(listJson)).toHaveLength(16);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      title: "[국내외 AI 규제 적용성 진단 및 대응 준비 세미나 개최] 참석 등록 안내",
      detailUrl: "https://hespa.or.kr/main/index.php?m_cd=23&b_id=20260814164681129",
      dateText: "2026-08-14 ~",
      agency: "헬스케어스파산업진흥원",
    });
  });

  it("★상세 주소는 b_id 로 조립한다 — 목록 화면 주소를 그대로 쓰면 전 행이 같은 주소가 된다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(/^https:\/\/hespa\.or\.kr\/main\/index\.php\?m_cd=23&b_id=\d+$/);
    }
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("등록일은 시각을 떼고 「등록일 ~」 개시형으로 넘긴다", () => {
    const good = rows.find((r) => r.detailUrl.endsWith("b_id=20260615083905479"));
    expect(good).toMatchObject({
      title: "2026년 「굿스파 인증제도」 참여기업 모집 공고",
      dateText: "2026-06-15 ~",
    });
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("★「굿스파 인증」 계열은 전부 살아남는다 — 이 게시판의 값은 그것뿐이다", () => {
    const kept = rows.filter((r) => r.title.includes("굿스파 인증"));
    expect(kept.map((r) => r.title)).toEqual([
      "굿스파 인증(국제수면치유박람회) 기업지원 수혜기업 공고",
      "2026년 「굿스파 인증제도」 참여기업 모집 공고",
      "2025년 「굿스파 인증 시범사업」 추가 모집 공고",
      "2025년 「굿스파 인증 시범사업」 참여기관 모집 공고",
    ]);
    // ★선정결과는 신청할 수 없는 글이라 뺀다(koreg·kosmes 와 같은 처리)
    expect(kept.some((r) => r.title.includes("선정결과"))).toBe(false);
  });

  it("거르개가 실측 제목을 실제로 버린다 — 유관기관 재게시·시민 프로그램·평가위원·공모전", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.startsWith("[유관기관]"))).toBe(false);
    expect(titles.some((t) => t.includes("어린이 온천과학캠프"))).toBe(false);
    expect(titles.some((t) => t.includes("수중건강"))).toBe(false);
    expect(titles.some((t) => t.includes("평가위원"))).toBe(false);
    expect(titles.some((t) => t.includes("공모전"))).toBe(false);
    expect(isHespaDropTitle("[유관기관] KMI 2026년도 바이오산업기반구축사업 기업지원 모집 공고")).toBe(true);
    expect(isHespaDropTitle("[2026 어린이 온천과학캠프] 참여자 모집")).toBe(true);
    expect(isHespaDropTitle("[2026 스파헬스케어 프로그램] 하반기 수중건강 프로그램 참여자 모집")).toBe(true);
    expect(isHespaDropTitle("제안서 평가위원(후보자) 공개모집")).toBe(true);
    expect(isHespaDropTitle("「청년 크리에이티브」 콘텐츠 공모전  공고")).toBe(true);
    expect(isHespaDropTitle("2025년 「굿스파 인증 시범사업」 굿스파 인증기업 선정결과 공고")).toBe(true);
    expect(isHespaDropTitle("2026년 지원사업 선정 결과 안내")).toBe(true);
  });

  it("★「어린이」·「캠프」를 낱말째 버리지 않는다 — 진짜 지원사업이 그 낱말을 쓴다", () => {
    expect(isHespaDropTitle("직장어린이집 설치·운영비 지원사업 공고")).toBe(false);
    expect(isHespaDropTitle("중장년 인턴캠프 참여기업 모집")).toBe(false);
    expect(isHespaDropTitle("어린이제품 안전인증 지원사업 모집")).toBe(false);
    // 버릴 것은 실측 제목 두 개뿐이다
    expect(isHespaDropTitle("[2026 어린이 온천과학캠프] 참여자 모집")).toBe(true);
  });

  it("★「모집」·「공모」·「채용」을 통째로 버리지 않는다 — 지원사업 제목이 그 낱말을 쓴다", () => {
    expect(isHespaDropTitle("2026년 「굿스파 인증제도」 참여기업 모집 공고")).toBe(false);
    expect(isHespaDropTitle("2026년 그린바이오 참여기업 공모 안내")).toBe(false);
    expect(isHespaDropTitle("소상공인 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isHespaDropTitle("직원 채용 공고")).toBe(true);
  });
});

describe("헬스케어스파산업진흥원 상세 — r_data 덩어리에서 본문·첨부 뽑기", () => {
  const built = buildHespaDetailHtml(detailHtml);

  it("본문(b_cont)과 첨부 목록(f_list)을 함께 돌려준다", () => {
    expect(built).toContain("ImageBrowser.php");
    expect(built).toContain('<ul class="hespa-files">');
    const anchors = parseHtml(built).querySelectorAll("a");
    expect(anchors).toHaveLength(3);
    expect(anchors[0].getAttribute("href")).toBe(
      "../bbs2/file_download.php?fname=f20260615104931_[공고문] 굿스파 인증 참여기업 모집.hwpx",
    );
    expect(anchors[0].text.trim()).toBe("[공고문] 굿스파 인증 참여기업 모집.hwpx");
  });

  it("★첨부를 빼면 안 된다 — 이 공고의 본문은 그림 한 장뿐이라 자격조건이 첨부에만 있다", () => {
    expect(parseHtml(built).querySelector("ul.hespa-files")).not.toBeNull();
    const contOnly = built.split('<ul class="hespa-files">')[0];
    // 본문 글자는 없다(그림 한 장) — 그래서 첨부가 유일한 자격조건 원천이다
    expect(parseHtml(contOnly).text.trim()).toBe("");
    /**
     * ★본문(b_cont) 유실도 함께 잡는다(2026-09-06 독립 리뷰 7번) — 「글자가 없다」만 재면
     * b_cont 를 통째로 빠뜨려도 이 시험이 통과한다. 본문 조각이 실제로 들어왔는지 본다.
     */
    expect(contOnly.trim()).not.toBe("");
    expect(contOnly).toContain("ImageBrowser.php");
    expect(contOnly).toContain("화면 캡처 2026-06-15 083706.png");
  });

  it("중괄호를 세면서 끝을 찾는다 — 본문 속 중괄호에서 잘리지 않는다", () => {
    const block = extractHespaRData(detailHtml);
    expect(block.startsWith("{")).toBe(true);
    expect(block.endsWith("}")).toBe(true);
    expect(JSON.parse(block)).toMatchObject({ b_id: "20260615083905479" });
  });
});

describe("헬스케어스파산업진흥원 설정", () => {
  it("목록은 JSON 통로 한 곳 — 쪽 번호를 붙이지 않는다", () => {
    expect(hespaConfig.list.url(1)).toBe("https://hespa.or.kr/bbs2/bbs_gate.php?cmd=get_blist&pm_id=23");
    expect(hespaConfig.list.url(2)).toBe(hespaConfig.list.url(1));
    expect(hespaConfig.list.maxPages).toBe(1);
  });

  it("★공지사항(pm_id=23)만 읽는다 — 입찰정보(24)·채용공고(25)는 같은 통로지만 안 본다", () => {
    expect(hespaConfig.list.url(1)).toContain("pm_id=23");
    expect(hespaConfig.list.url(1)).not.toContain("pm_id=24");
    expect(hespaConfig.list.url(1)).not.toContain("pm_id=25");
  });

  it("첨부 상대주소(../bbs2/…)가 풀리도록 baseUrl 이 /main/ 이다", () => {
    expect(hespaConfig.baseUrl).toBe("https://hespa.or.kr/main/");
    expect(new URL("../bbs2/file_download.php?fname=a.hwp", hespaConfig.baseUrl).toString()).toBe(
      "https://hespa.or.kr/bbs2/file_download.php?fname=a.hwp",
    );
  });

  it("id·기관·지역·서식 변경 감지", () => {
    expect(hespaConfig.id).toBe("hespa");
    expect(hespaConfig.agency).toBe("헬스케어스파산업진흥원");
    expect(hespaConfig.region).toBe("충남");
    expect(hespaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(hespaConfig.skipHeuristic).toBe(true);
  });

  it("상세는 detailFetch 로만 조달한다 — 선택자 갈래는 이 출처에서 안 쓰인다", async () => {
    expect(typeof hespaConfig.detailFetch).toBe("function");
    expect(hespaConfig.detailContentSelector).toBeUndefined();
    expect(hespaConfig.attachmentsScopeSelector).toBeUndefined();
    let asked = "";
    const out = await hespaConfig.detailFetch!(
      "https://hespa.or.kr/main/index.php?m_cd=23&b_id=20260615083905479",
      async (u) => {
        asked = u;
        return detailHtml;
      },
    );
    expect(asked).toBe("https://hespa.or.kr/main/index.php?m_cd=23&b_id=20260615083905479");
    expect(out).toContain("file_download.php");
  });
});

describe("쪽 개념이 없는 출처는 「상한 도달」로 안 적는다 — 매 회차 오경보(독립 리뷰 3번)", () => {
  it("hespa 설정으로 한 바퀴 돌면 onPageCap 은 hitCap:false 다", async () => {
    const onPageCap = vi.fn();
    const out = await fetchBoardAll(hespaConfig, {
      fetchText: async () => listJson,
      prevOpenCount: 0,
      askModel: async () => "",
      onAllFailed: () => {},
      onPageCap,
    });
    expect(out).toHaveLength(6);
    expect(onPageCap).toHaveBeenCalledWith({ hitCap: false, lastPageNew: 0 });
  });

  it("쪽 주소가 달라지는 출처는 예전대로 상한을 적는다 — 판정은 목록 주소로만 한다", () => {
    expect(pagelessSource(hespaConfig)).toBe(true);
    expect(
      pagelessSource({ ...hespaConfig, list: { ...hespaConfig.list, url: (p) => `https://hespa.or.kr/x?p=${p}` } }),
    ).toBe(false);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("열쇠 이름이 하나만 바뀌어도 한 줄도 못 읽는다", () => {
    expect(parseHespaList(listJson.replaceAll('"b_id"', '"b_idx"'))).toHaveLength(0);
    expect(parseHespaList(listJson.replaceAll('"b_subj"', '"b_title"'))).toHaveLength(0);
  });

  it("JSON 이 아니면 조용히 0행 — 엔진이 「행 0개」로 실패를 적는다", () => {
    expect(parseHespaList("<html>차단 안내</html>")).toHaveLength(0);
    expect(parseHespaList("")).toHaveLength(0);
  });

  it("등록일 열쇠가 비면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const blanked = parseHespaList(listJson.replaceAll(/"b_regdt":"[^"]*"/g, '"b_regdt":""'));
    expect(blanked).toHaveLength(6);
    expect(blanked.every((r) => r.dateText === "")).toBe(true);
  });

  it("상세에서 r_data 이름이 바뀌면 본문·첨부를 못 만든다(빈 글)", () => {
    expect(buildHespaDetailHtml(detailHtml.replace("var r_data", "var r_dataX"))).toBe("");
    expect(buildHespaDetailHtml("<html>본문 없음</html>")).toBe("");
  });
});
