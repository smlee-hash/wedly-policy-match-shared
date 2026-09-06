import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { harvestBoardAttachments } from "../detail-fill";
import { isKeadDropTitle, keadConfig, parseKeadList } from "./kead";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본(2026-09-06 실측): 부서 공지사항 1·2쪽(`bbsPage.do?menuId=MENU0895&bbsCode=deptgongji`)
 * · 상세 1건(`bbsCnId=215941` — 첨부 1건).
 */
const list = readFileSync(join(__dirname, "../__fixtures__/kead-list.html"), "utf-8");
const listP2 = readFileSync(join(__dirname, "../__fixtures__/kead-list-p2.html"), "utf-8");
const detail = readFileSync(join(__dirname, "../__fixtures__/kead-detail.html"), "utf-8");
const rows = parseKeadList(list);
const rowsP2 = parseKeadList(listP2);
const combined = [...rows, ...rowsP2];

describe("한국장애인고용공단 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10행에서 거르개 뒤 2건이 남고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    // 10행 = 지사·개발원 머리표 7 + 공직박람회 1 = 8건이 걸러지고 2건 남는다.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "장애인 표준사업장 인증 공고",
      detailUrl:
        "https://www.kead.or.kr/bbs/deptgongji/bbsView.do?bbsCnId=215941&menuId=MENU0895&bbsCode=deptgongji",
      dateText: "2026-08-31 ~",
      agency: "한국장애인고용공단",
    });
  });

  it("등록일은 네 번째 칸에서 집고 개시형(`날짜 ~`)으로 낸다", () => {
    const r = rows.find((x) => x.detailUrl.includes("bbsCnId=215941"));
    expect(r?.dateText).toBe("2026-08-31 ~");
    // 번호 칸(3147 대)이 날짜에 붙으면 「31472026-08-31」이 된다 — 그 모양이 아니어야 한다.
    expect(r?.dateText).not.toMatch(/^\d{5,}/);
    expect(combined.every((x) => /^20\d{2}-\d{2}-\d{2} ~$/.test(x.dateText))).toBe(true);
  });

  it("상세 주소는 href(javascript:void(0))가 아니라 onClick 의 bbsCnId 로 조립한다", () => {
    for (const r of combined) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kead\.or\.kr\/bbs\/deptgongji\/bbsView\.do\?bbsCnId=\d+&menuId=MENU0895&bbsCode=deptgongji$/,
      );
      // 쪽 번호를 안 남긴다 — 2026-09-06 실측으로 pageIndex 없이도 200(233,675바이트)이다.
      expect(r.detailUrl).not.toMatch(/[?&]pageIndex=/);
      expect(r.detailUrl).not.toMatch(/javascript/i);
    }
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("★공단 조직 머리표가 붙은 글은 버린다 — 실측 제목으로 확인", () => {
    expect(combined.some((r) => r.title.includes("채용"))).toBe(false);
    expect(isKeadDropTitle("[경기남부직업능력개발원] 기간제근로자(전산관리원 대체인력) 공개경쟁 채용")).toBe(true);
    expect(isKeadDropTitle("[한국장애인고용공단 전남지사] 2026년 체험형 청년인턴(대체근로자) 채용")).toBe(true);
    expect(isKeadDropTitle("[한국장애인고용공단 경기지역본부] 대체 근로자(체험형 청년인턴) 채용 공고")).toBe(true);
    expect(isKeadDropTitle("[경기남부직업능력개발원] 고정형 영상정보처리기기(CCTV) 설치에 따른 행정예고")).toBe(true);
    expect(isKeadDropTitle("「2026 공직박람회 」참가 안내")).toBe(true);
    expect(isKeadDropTitle("「2026년 장애인 고용확대 아이디어 공모전」수상작 공고")).toBe(true);
  });

  it("★사업주 대상 공고는 살린다 — 실측 제목으로 확인", () => {
    const titles = combined.map((r) => r.title);
    expect(titles).toContain("장애인 표준사업장 인증 공고");
    expect(titles).toContain(
      "2026년 2차 문화체험형 직장 내 장애인 인식개선 교육 지원 사업 위탁 수행기관 공모",
    );
    expect(isKeadDropTitle("장애인 표준사업장 인증 공고")).toBe(false);
    expect(
      isKeadDropTitle("2026년 2차 문화체험형 직장 내 장애인 인식개선 교육 지원 사업 위탁 수행기관 공모"),
    ).toBe(false);
  });

  it("★KEEP 이 머리표를 이긴다 — 지사가 올리는 참여기업 모집이 죽으면 안 된다", () => {
    expect(isKeadDropTitle("[한국장애인고용공단 전남지사] 철도역 장애인 일자리 플랫폼 참여 기업 모집")).toBe(
      false,
    );
    expect(isKeadDropTitle("[한국장애인고용공단 인천지사] 장애인 고용장려금 전자신청 개시 알림")).toBe(false);
  });

  it("★「인증취소」는 KEEP 이 되살리지 않는다 — 「인증 공고」와 글자를 맞췄기 때문", () => {
    // 2쪽 실측 제목. 「표준사업장 인증」만으로 KEEP 을 잡으면 이 글이 공고로 저장된다.
    expect(combined.some((r) => r.title.includes("인증취소"))).toBe(false);
    expect(isKeadDropTitle("장애인 표준사업장 인증취소 공고")).toBe(true);
  });

  it("머리줄(thead)은 결과에 안 섞인다", () => {
    expect(combined.some((r) => r.title === "제목")).toBe(false);
    expect(combined.every((r) => r.title.length > 3)).toBe(true);
  });
});

describe("한국장애인고용공단 설정", () => {
  it("쪽넘김은 GET pageIndex — 2026-09-06 실측으로 폼 submit 없이 돈다", () => {
    expect(keadConfig.list.url(1)).toBe(
      "https://www.kead.or.kr/bbs/deptgongji/bbsPage.do?menuId=MENU0895&bbsCode=deptgongji&pageIndex=1",
    );
    expect(keadConfig.list.url(2)).toContain("pageIndex=2");
    expect(keadConfig.list.maxPages).toBe(4);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(keadConfig.id).toBe("kead");
    expect(keadConfig.label).toBe("한국장애인고용공단");
    expect(keadConfig.agency).toBe("한국장애인고용공단");
    expect(keadConfig.region).toBe("전국");
    expect(keadConfig.charset).toBe("utf-8");
    expect(keadConfig.skipHeuristic).toBe(true);
  });

  it("★최소 행수를 걸지 않는다 — 밀도 0.17 이라 조용한 주에 출처 전체가 실패한다", () => {
    expect(keadConfig.expectMinRows).toBeUndefined();
    // 그래도 「행 0개」는 엔진이 잡는다 — 두 쪽 다 한 건 이상 남는 것을 고정본으로 확인한다.
    expect(rows.length).toBeGreaterThan(0);
    expect(rowsP2.length).toBeGreaterThan(0);
  });
});

describe("한국장애인고용공단 상세", () => {
  it("본문 선택자가 첫 문장을 집는다", () => {
    const body = (parseHtml(detail).querySelector(keadConfig.detailContentSelector!)?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(body).toContain("장애인고용촉진 및 직업재활법 제22조의5에 따라");
  });

  it("첨부 1건의 이름·주소를 집고 이전·다음 글 링크를 안 끌어온다", () => {
    const scoped = parseHtml(detail)
      .querySelectorAll(keadConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, keadConfig.baseUrl, detail);
    expect(atts.map((a) => a.name)).toEqual(["2026년 제17차 표준사업장 인증공고문.pdf"]);
    expect(atts.map((a) => a.url)).toEqual([
      "https://www.kead.or.kr/cmm/fms/downloadDirect.do?key=CBDD1DA199FAC96C2F50",
    ]);
  });
});
