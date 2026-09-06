import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { harvestBoardAttachments } from "../detail-fill";
import { isKwbizDropTitle, kwbizConfig, parseKwbizList } from "./kwbiz";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본(2026-09-06 실측): 공지사항 1쪽(`/notice` 10행) · 상세 1건(`/notice/BOARD_000002480`
 * — 첨부 2건).
 */
const list = readFileSync(join(__dirname, "../__fixtures__/kwbiz-list.html"), "utf-8");
const detail = readFileSync(join(__dirname, "../__fixtures__/kwbiz-detail.html"), "utf-8");
const rows = parseKwbizList(list);

describe("한국여성경제인협회 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10행에서 DROP 뒤 9건이 남고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "2026년 여성CEO비즈니스아카데미『인천·경기권 1회차 교육』 참가자 모집 안내",
      detailUrl: "https://www.kwbiz.or.kr/notice/BOARD_000002502",
      dateText: "2026-08-14 ~",
      agency: "한국여성경제인협회",
    });
  });

  it("작성일은 td.td_date 칸에서 집는다 — 한 행이 같은 날짜를 모바일 칸에 한 번 더 싣는다", () => {
    const r = rows.find((x) => x.detailUrl.endsWith("BOARD_000002480"));
    expect(r?.dateText).toBe("2026-08-03 ~");
    // 원문 서식은 `YYYY/MM/DD` 다 — 저장은 하이픈으로 맞춘다.
    expect(rows.every((x) => /^20\d{2}-\d{2}-\d{2} ~$/.test(x.dateText))).toBe(true);
  });

  it("★상세 주소는 goDetail 번호로 조립한다 — href 는 javascript: 라 그대로 못 쓴다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(/^https:\/\/www\.kwbiz\.or\.kr\/notice\/BOARD_\d+$/);
      expect(r.detailUrl).not.toMatch(/javascript/i);
      expect(r.detailUrl).not.toMatch(/pageIndex/);
    }
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("★협회 채용·용역입찰·포상·보이스피싱 안내를 버린다 — 실측 제목으로 확인", () => {
    expect(rows.some((r) => r.title.includes("직원 채용"))).toBe(false);
    expect(isKwbizDropTitle("[2026 – 3호 재공고] 한국여성경제인협회 직원 채용 공고")).toBe(true);
    expect(isKwbizDropTitle("2026년 전국 여성CEO 경영연수 행사대행 용역")).toBe(true);
    expect(isKwbizDropTitle("[긴급공지] 한국여성경제인협회 사칭 보이스피싱 안내")).toBe(true);
    expect(isKwbizDropTitle("부산지회 여성기업인 유공자 포상 신청 연장")).toBe(true);
  });

  it("★여성기업 대상 모집은 살린다 — 실측 제목으로 확인", () => {
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("[강원지회] 「2026년 브릿G마켓 」홍보 ·판매전 참여기업 모집공고");
    expect(titles).toContain("[경남지회] 2026년 공공기관-중소기업 상생협력 구매상담회 참여기업 모집 안내");
    expect(titles).toContain("[부산지회] 2026년 부산 여성기업 전시회(마케팅) 지원 참여기업 모집공고");
    expect(isKwbizDropTitle("[강원지회] 「2026년 브릿G마켓 」홍보 ·판매전 참여기업 모집공고")).toBe(false);
  });

  it("★KEEP 이 「채용」을 이긴다 — 고용보조금 공고가 제목에 채용을 쓰는 게시판이 있다(cwip)", () => {
    expect(isKwbizDropTitle("2026년 여성기업 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isKwbizDropTitle("여성기업 신규 채용 지원사업")).toBe(false);
  });

  it("★KEEP 에서 「모집 공고」를 뺐다 — 사람 뽑는 글이 DROP 을 무력화하던 자리(적대 리뷰)", () => {
    // 예전 KEEP(`모집\s*공고`)이면 이 둘이 살아났다.
    expect(isKwbizDropTitle("한국여성경제인협회 비상임이사 공개모집 공고")).toBe(true);
    expect(isKwbizDropTitle("평가위원 모집 공고")).toBe(true);
    /**
     * ⚠️남아 있는 한계: 제목에 「여성기업」·「지원사업」이 함께 적히면 KEEP 이 이겨서 살아난다
     * (예: 「여성기업 지원사업 평가위원 모집 공고」). 그 낱말들을 KEEP 에서 빼면 고용보조금류
     * 공고가 `채용` 에 걸려 죽어서(cwip 갈래) 이번엔 그대로 둔다 — 제목만으로는 못 가른다.
     */
    expect(isKwbizDropTitle("여성기업 지원사업 평가위원 모집 공고")).toBe(false);
    // 대상이 기업임이 드러나는 꼴만 살린다.
    expect(isKwbizDropTitle("2026년 브릿G마켓 참여기업 모집 공고")).toBe(false);
    expect(isKwbizDropTitle("여성기업 지원 설명회 참가사 모집")).toBe(false);
    // 「설명회」·「상담회」 단독으로는 이제 안 살아난다 — 협회 발주 용역은 그대로 버려야 한다.
    expect(isKwbizDropTitle("2026년 여성CEO 상담회 운영 용역 입찰")).toBe(true);
  });

  it("지회 머리표가 붙은 제목도 그대로 담는다 — 지역 정보가 제목에만 있다", () => {
    expect(rows.filter((r) => /^\[[^\]]*지회\]/.test(r.title)).length).toBeGreaterThanOrEqual(3);
  });
});

describe("한국여성경제인협회 설정", () => {
  it("쪽넘김은 GET pageIndex + categoryId", () => {
    expect(kwbizConfig.list.url(1)).toBe("https://www.kwbiz.or.kr/notice?pageIndex=1&categoryId=notice");
    expect(kwbizConfig.list.url(2)).toContain("pageIndex=2");
    expect(kwbizConfig.list.maxPages).toBe(3);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(kwbizConfig.id).toBe("kwbiz");
    expect(kwbizConfig.label).toBe("한국여성경제인협회");
    expect(kwbizConfig.agency).toBe("한국여성경제인협회");
    expect(kwbizConfig.region).toBe("전국");
    expect(kwbizConfig.charset).toBe("utf-8");
    expect(kwbizConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kwbizConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(kwbizConfig.expectMinRows!);
  });
});

describe("한국여성경제인협회 상세", () => {
  it("본문 선택자가 첫 문장을 집는다", () => {
    const body = (parseHtml(detail).querySelector(kwbizConfig.detailContentSelector!)?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(body).toContain("한국여성경제인협회 강원지회에서는");
    expect(body).toContain("「2026년 브릿G마켓」을 개최합니다");
  });

  it("첨부 2건의 주소를 집는다 — 이름은 링크 글자가 「다운로드」뿐이라 주소 꼬리로 떨어진다", () => {
    const scoped = parseHtml(detail)
      .querySelectorAll(kwbizConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, kwbizConfig.baseUrl, detail);
    expect(atts.map((a) => a.url)).toEqual([
      "https://www.kwbiz.or.kr/download?category=NOTICE&fileId=FILE_2026080311040937ae62",
      "https://www.kwbiz.or.kr/download?category=NOTICE&fileId=FILE_20260803110409bdcf8e",
    ]);
    /**
     * ⚠️알려진 한계(실물 확인 2026-09-06): 파일 이름이 옆 `<span>` 에만 있어 공용 수확기가 못 읽는다.
     * 이름이 없어도 형식이 `etc` 로 잡혀 내려받기·본문 뽑기 대상에는 들어간다(CANDIDATE_KINDS).
     */
    expect(atts.map((a) => a.name)).toEqual(["download", "download"]);
    expect(atts.every((a) => a.kind === "etc")).toBe(true);
  });
});
