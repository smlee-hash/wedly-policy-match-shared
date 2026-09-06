import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKiriaDropTitle, kiriaConfig, parseKiriaList } from "./kiria";
import { harvestBoardAttachments } from "../detail-fill";
import { fetchBoardDetail } from "../engine";
import { safeAttachmentUrl } from "@/lib/policy-match/attachment-text";
import { parseHtml } from "../html";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 사업공고 1·2쪽(`portalInfoBusinessList.do?pageIndex=1|2`)과
 * 상세 1건(`portalInfoBusinessWrite.do?mode=update&ibusCode=IBUS_000000000001264`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/kiria-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/kiria-list-p2.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/kiria-detail.html"), "utf-8");
const rows = parseKiriaList(listHtml);
const rowsP2 = parseKiriaList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("한국로봇산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10행에서 DROP 1건을 뺀 9건을 읽고 첫 행의 제목·상세주소·접수기간이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "2026년 한국로봇산업진흥원 연구장비 임대 운영 기업 모집 공고",
      detailUrl:
        "https://www.kiria.org/portal/info/portalInfoBusinessWrite.do?mode=update&ibusCode=IBUS_000000000001264",
      // ★목록이 접수기간을 시작·마감 둘 다 준다 — 등록일만 주는 게시판과 다른 값이다.
      dateText: "2026-09-01 ~ 2026-12-31",
      category: "진행중",
      agency: "한국로봇산업진흥원",
    });
  });

  it("접수기간은 시작·마감 두 날짜를 모두 담는다 — 마감 칸을 잃으면 개시형으로 떨어진다", () => {
    // 실측 19건 전부 「시작 ~ 마감」 꼴이다. 하나라도 「시작 ~」이면 칸이 밀렸다는 뜻이다.
    expect(combined.every((r) => /^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/.test(r.dateText))).toBe(true);
    const one = combined.find((r) => r.detailUrl.includes("IBUS_000000000001251"));
    expect(one?.dateText).toBe("2026-05-28 ~ 2026-11-15");
  });

  it("접수기간은 td:nth-child(3) 칸에서만 집는다 — 행 전체 글자면 번호·조회수가 날짜에 붙는다", () => {
    // 1쪽 첫 행의 번호는 669, 조회수는 438 — 어느 쪽도 날짜 글자에 들어오면 안 된다.
    expect(rows[0].dateText).not.toMatch(/669/);
    expect(rows[0].dateText).not.toMatch(/438/);
  });

  it("상세 주소는 javascript:fn_update 의 ibusCode 로 조립하고 세션·쪽 번호가 안 섞인다", () => {
    expect(combined.length).toBeGreaterThan(0);
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kiria\.org\/portal\/info\/portalInfoBusinessWrite\.do\?mode=update&ibusCode=IBUS_\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/jsessionid/i);
      expect(r.detailUrl).not.toMatch(/[?&]pageIndex=/);
    }
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠(ibusCode) 중복이 없다", () => {
    expect(rowsP2).toHaveLength(10);
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(19);
  });

  it("★거르개 — 「지자체 수요조사」는 버리고 기업 대상 공고는 지킨다", () => {
    // 버릴 것: 받는 쪽이 기업이 아니라 지자체인 실측 1건.
    expect(combined.some((r) => r.title.includes("지자체 수요조사"))).toBe(false);
    expect(isKiriaDropTitle("2027년 「국제로봇콘테스트(IRC)」 유치 희망 지자체 수요조사 공고")).toBe(true);
    // 지킬 것: 기업 대상 지원사업.
    expect(combined.some((r) => r.title.includes("신뢰성기반활용지원사업"))).toBe(true);
    expect(isKiriaDropTitle("2026년도「신뢰성기반활용지원사업」 수시형 2차 참여기업 모집")).toBe(false);
  });

  it("「채용」·「모집」을 통째로 버리지 않는다 — 고용보조금과 참여기업 모집이 같이 죽는다", () => {
    expect(isKiriaDropTitle("로봇 중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isKiriaDropTitle("2026년 실외이동로봇 기술지원사업 참여기업 모집 공고")).toBe(false);
    // 다만 좁은 꼴(공고·안내가 붙은 직원 채용)은 버린다.
    expect(isKiriaDropTitle("2026년 제3차 직원 채용 공고")).toBe(true);
  });

  it("머리글(thead)·상태 칸이 결과에 안 섞인다", () => {
    expect(combined.some((r) => r.title === "제목")).toBe(false);
    expect(combined.every((r) => ["진행중", "완료"].includes(r.category ?? ""))).toBe(true);
  });

  it("★돌연변이 — 행 선택자를 깨뜨리면 0건이 된다(서식 변경을 조용히 넘기지 않는다)", () => {
    const broken = listHtml.replace('class="default_board_01 mobile_default_board03"', 'class="default_board_XX"');
    expect(parseKiriaList(broken)).toHaveLength(0);
    // 원복하면 다시 9건 — 시험이 「깨졌다」가 아니라 「선택자가 일한다」를 잰다.
    expect(parseKiriaList(listHtml)).toHaveLength(9);
  });
});

describe("한국로봇산업진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex — 1쪽과 2쪽 주소가 다르다", () => {
    expect(kiriaConfig.list.url(1)).toBe(
      "https://www.kiria.org/portal/info/portalInfoBusinessList.do?pageIndex=1",
    );
    expect(kiriaConfig.list.url(2)).toBe(
      "https://www.kiria.org/portal/info/portalInfoBusinessList.do?pageIndex=2",
    );
    expect(kiriaConfig.list.maxPages).toBe(3);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(kiriaConfig.id).toBe("kiria");
    expect(kiriaConfig.label).toBe("한국로봇산업진흥원");
    expect(kiriaConfig.agency).toBe("한국로봇산업진흥원");
    expect(kiriaConfig.region).toBe("전국");
    expect(kiriaConfig.charset).toBe("utf-8");
    expect(kiriaConfig.requiresProxy).toBeUndefined(); // 사무실 맥에서 직접 200
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kiriaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(kiriaConfig.expectMinRows!);
  });

  it("추측 단계를 끈다 — 제목 링크가 전부 javascript: 라 메뉴가 공고로 저장된다", () => {
    expect(kiriaConfig.skipHeuristic).toBe(true);
  });
});

describe("한국로봇산업진흥원 상세 — 실사이트 고정본", () => {
  it("본문은 td.board_cnts 에서 뽑는다", async () => {
    const text = await fetchBoardDetail(
      kiriaConfig,
      "https://www.kiria.org/portal/info/portalInfoBusinessWrite.do?mode=update&ibusCode=IBUS_000000000001264",
      { fetchText: async () => detailHtml },
    );
    expect(text.startsWith("한국로봇산업진흥원 공고 제2026-13호")).toBe(true);
    expect(text).toContain("국내 중소·중견 기업의 사업 역량 강화를 지원하기 위하여");
  });

  it("첨부 2건을 fn_egov_downFile 인자로 조립한다(실호출 200 + HWP 359,936바이트)", () => {
    const scoped = parseHtml(detailHtml)
      .querySelectorAll(kiriaConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, kiriaConfig.baseUrl, detailHtml, kiriaConfig.charset);
    expect(atts).toHaveLength(2);
    expect(atts[0].url).toBe(
      "https://www.kiria.org/cmm/fms/FileDown.do?atchFileId=FILE_000000000008373&fileSn=1",
    );
    expect(atts[0].name).toContain("(공고문) 2026년 한국로봇산업진흥원 연구장비 임대 운영.hwp");
    expect(atts[0].kind).toBe("hwp");
    expect(atts[1].url).toContain("fileSn=2");
    // ★「[359936 byte]」 크기 꼬리가 이름에 남으면 형식 판정이 흔들린다.
    expect(atts.every((a) => !/\[\s*\d+\s*byte/i.test(a.name))).toBe(true);
    for (const a of atts) expect(safeAttachmentUrl(a.url)).not.toBeNull();
  });

  it("첨부 범위를 안 좁혀도 남의 링크가 안 들어온다 — 그래도 범위는 못 박아 둔다", () => {
    const whole = harvestBoardAttachments(detailHtml, kiriaConfig.baseUrl, detailHtml, kiriaConfig.charset);
    expect(whole).toHaveLength(2);
    expect(kiriaConfig.attachmentsScopeSelector).toBe("table.default_board_02");
    // 실물로 「첨부 없는 상세에도 상자가 있다」를 못 봤으므로 필수 판정은 켜지 않는다.
    expect(kiriaConfig.attachmentsScopeRequired).toBeUndefined();
  });
});
