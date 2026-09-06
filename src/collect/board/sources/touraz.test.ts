import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { isTourazDropTitle, parseTourazList, tourazConfig } from "./touraz";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 투어라즈 공모 1·2쪽
 * (`/announcementList?tabMode=ktoip&curPage=1|2&cntPerPage=12`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/touraz-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/touraz-list-p2.html"), "utf-8");
const rows = parseTourazList(listHtml);
const p2 = parseTourazList(listP2Html);
const combined = parseTourazList(listHtml + listP2Html);

describe("한국관광공사 관광기업지원(touraz) 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 12건을 읽고 첫 행의 제목·상세주소·dateText 가 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({
      title: "2026 중국국제여유교역회(CITM) 참가기관 모집 안내",
      detailUrl:
        "https://touraz.kr/announcementList/pssrpView?pssrpSeqEnc=gceHXEN*FRnXmIAn6LDZGA==",
      dateText: "2026-08-24 ~ 2026-09-03",
      agency: "한국관광공사",
    });
  });

  it("★상세 주소에 curPage·tabMode·cntPerPage 를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]curPage=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => !/[?&]tabMode=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => !/[?&]cntPerPage=/.test(r.detailUrl))).toBe(true);
    expect(p2.every((r) => !/[?&]curPage=/.test(r.detailUrl))).toBe(true);
    expect(p2.every((r) => !/[?&]tabMode=/.test(r.detailUrl))).toBe(true);
    expect(p2.every((r) => !/[?&]cntPerPage=/.test(r.detailUrl))).toBe(true);
  });

  it("★pssrpSeqEnc 의 *·^ 를 이스케이프하지 않는다 — 사이트가 그대로 열고 새 세션에서도 통한다", () => {
    expect(rows[0].detailUrl).toContain("pssrpSeqEnc=gceHXEN*FRnXmIAn6LDZGA==");
    expect(rows[0].detailUrl).not.toContain("%2A");
    const caret = rows.find((r) => r.title.includes("러시아 주요도시"))!;
    expect(caret.detailUrl).toContain("pssrpSeqEnc=BDgepASVD9^rS0JfT6RqIg==");
    expect(caret.detailUrl).not.toContain("%5E");
    const p2caret = p2.find((r) => r.title.includes("여행가는 달") && r.title.includes("지자체"))!;
    expect(p2caret.detailUrl).toContain("pssrpSeqEnc=D^5soARyfpIwliVOIqWn5w==");
  });

  it("신청기간을 dateText 로 쓴다 — 등록일이 아니라 「시작 ~ 끝」", () => {
    // 4번째 카드: 신청기간 2026-08-04 ~ 2026-09-30, 등록일 2026-08-11.
    const r = rows.find((x) => x.title.includes("데이터랩 활용 경진대회"))!;
    expect(r.dateText).toBe("2026-08-04 ~ 2026-09-30");
    expect(r.dateText).not.toBe("2026-08-11 ~");
    expect(rows.every((x) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(x.dateText))).toBe(
      true,
    );
  });

  it("날짜는 dt 텍스트로 칸을 고른다 — 담당부서 dl 이 없어도 등록일·신청기간을 찾는다", () => {
    const noDept = listHtml.replace(
      /<dl>\s*<dt>담당부서<\/dt>\s*<dd>중국팀<\/dd>\s*<\/dl>/,
      "",
    );
    expect(parseTourazList(noDept)[0].dateText).toBe("2026-08-24 ~ 2026-09-03");
  });

  it("등록일 dd 가 비어도 신청기간으로 남긴다 — 모집 대기 글이 이 모양이다", () => {
    const emptyReg = parseTourazList(
      listHtml.replace(/<dt>등록일 <\/dt>\s*<dd>\s*2026-08-24<\/dd>/, "<dt>등록일 </dt><dd></dd>"),
    );
    expect(emptyReg[0].dateText).toBe("2026-08-24 ~ 2026-09-03");
  });

  it("제목의 <2026 …> 꺾쇠가 파서에 먹히지 않고 살아남는다", () => {
    expect(rows.some((r) => r.title.includes("<2026 한국관광 데이터랩 활용 경진대회>"))).toBe(
      true,
    );
  });

  it("행마다 기관이 다르다 — 울산 글을 한국관광공사로 못 박지 않는다", () => {
    expect(rows.some((r) => r.agency === "울산문화관광재단")).toBe(true);
    expect(rows.some((r) => r.agency === "한국관광공사")).toBe(true);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 24건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(24);
    expect(p2).toHaveLength(12);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(p2.map((r) => r.detailUrl));
    expect(p2[0]).toMatchObject({
      title: "⌈2026 K-관광 비즈니스데이 in 나고야⌋ 참가기관 모집",
      detailUrl:
        "https://touraz.kr/announcementList/pssrpView?pssrpSeqEnc=IaZIIQ8SY^YV26xMghY*bA==",
      dateText: "2026-08-03 ~ 2026-08-24",
    });
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 낱말을 심은 행은 빠지고, 지원사업은 산다", () => {
    const planted = parseTourazList(
      listHtml.replace(
        "2026 중국국제여유교역회(CITM) 참가기관 모집 안내",
        "2026년 평가위원 모집 공고",
      ),
    );
    expect(planted.some((r) => r.title.includes("평가위원"))).toBe(false);
    expect(planted).toHaveLength(11);
    expect(
      parseTourazList(
        listHtml.replace(
          "2026 울산 관광 인재 인턴십 지원사업 참여기업 모집",
          "용역 입찰 공고",
        ),
      ).some((r) => r.title.includes("입찰")),
    ).toBe(false);
    expect(
      parseTourazList(
        listHtml.replace(
          "2026 대한민국 관광공모전(사진)  대국민 온라인 참여 심사 이벤트",
          "합격자 발표",
        ),
      ).some((r) => r.title.includes("합격자")),
    ).toBe(false);
    expect(isTourazDropTitle("2026년 평가위원 모집")).toBe(true);
    expect(isTourazDropTitle("용역 입찰 공고")).toBe(true);
    expect(isTourazDropTitle("설문조사 안내")).toBe(true);
    expect(isTourazDropTitle("합격자 발표")).toBe(true);
    expect(isTourazDropTitle("직원 채용 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽는다", () => {
    expect(
      parseTourazList(
        listHtml.replace(
          "2026 중국국제여유교역회(CITM) 참가기관 모집 안내",
          "청년 채용 지원사업 참여기업 모집",
        ),
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
    expect(isTourazDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(rows.some((r) => r.title.includes("심사 이벤트"))).toBe(true);
  });
});

describe("한국관광공사 관광기업지원(touraz) 설정", () => {
  it("쪽넘김은 GET curPage + cntPerPage=12 + tabMode=ktoip", () => {
    expect(tourazConfig.list.url(1)).toBe(
      "https://touraz.kr/announcementList?tabMode=ktoip&curPage=1&cntPerPage=12",
    );
    expect(tourazConfig.list.url(2)).toBe(
      "https://touraz.kr/announcementList?tabMode=ktoip&curPage=2&cntPerPage=12",
    );
    expect(tourazConfig.list.url(1)).not.toBe(tourazConfig.list.url(2));
    expect(tourazConfig.list.maxPages).toBe(20);
    expect(pagingParamsOf(tourazConfig)).toContain("curPage");
  });

  it("id·기관·지역이 맞다", () => {
    expect(tourazConfig.id).toBe("touraz");
    expect(tourazConfig.label).toBe("한국관광공사 관광기업지원(touraz)");
    expect(tourazConfig.agency).toBe("한국관광공사");
    expect(tourazConfig.region).toBe("전국");
  });

  it("서식 변경 감지가 살아 있다 — 한 쪽 12건의 절반 미만이면 표식이 바뀐 것이다", () => {
    expect(tourazConfig.expectMinRows).toBe(6);
  });

  it("상세 주소 호스트가 baseUrl 과 같다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(tourazConfig.baseUrl).host);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("행 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseTourazList(listHtml.replaceAll("board-card-wrap", "board-card-wrap-x"))).toHaveLength(
      0,
    );
  });

  it("제목 칸(subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseTourazList(listHtml.replaceAll("subject", "subject-x"))).toHaveLength(0);
  });

  it("신청기간 dt 가 사라지면 등록일 개시형으로 물러선다 — 오늘 날짜를 지어내지 않는다", () => {
    const broken = parseTourazList(listHtml.replaceAll("<dt>신청기간</dt>", "<dt>모집기간</dt>"));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken[0].dateText).toBe("2026-08-24 ~");
    expect(broken.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });
});
