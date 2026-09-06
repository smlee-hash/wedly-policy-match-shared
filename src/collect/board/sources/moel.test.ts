import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { harvestBoardAttachments } from "../detail-fill";
import { isMoelDropTitle, moelConfig, parseMoelList, stripMoelTitlePrefix } from "./moel";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본(2026-09-06 실측): 공지사항 1·2쪽 각 50행(`noticeList.do?pageIndex=N&pageUnit=50`) ·
 * 상세 1건(`bbs_seq=20260900193` — 첨부 1건).
 */
const list = readFileSync(join(__dirname, "../__fixtures__/moel-list.html"), "utf-8");
const listP2 = readFileSync(join(__dirname, "../__fixtures__/moel-list-p2.html"), "utf-8");
const detail = readFileSync(join(__dirname, "../__fixtures__/moel-detail.html"), "utf-8");
const rows = parseMoelList(list);
const rowsP2 = parseMoelList(listP2);

describe("고용노동부 목록 읽기 — 실사이트 고정본", () => {
  it("50행에서 거르개 뒤 8건이 남고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      // 구분 딱지 `[공고]` 는 저장 전에 뗀다 — 고용24·기업마당이 딱지 없이 올린 같은 공고와 열쇠를 맞춘다.
      title: "2027년 청년일자리 강소기업 선정 신청 공고문",
      detailUrl: "https://www.moel.go.kr/news/notice/noticeView.do?bbs_seq=20260900193",
      dateText: "2026-09-04 ~",
      agency: "고용노동부",
    });
  });

  it("등록일은 aria-label 칸에서 집고 개시형(`날짜 ~`)으로 낸다", () => {
    const r = rows.find((x) => x.detailUrl.includes("bbs_seq=20260900193"));
    // 이 행의 제목은 「2027년 …」으로 시작한다 — 그 연도가 등록일로 새면 안 된다.
    expect(r?.dateText).toBe("2026-09-04 ~");
    expect(r?.dateText).not.toMatch(/2027/);
    expect(rows.every((x) => /^20\d{2}-\d{2}-\d{2} ~$/.test(x.dateText))).toBe(true);
  });

  it("제목은 title 속성(온전한 제목)을 쓰고 상세 주소에 쪽 번호가 안 섞인다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.moel\.go\.kr\/news\/notice\/noticeView\.do\?bbs_seq=\d+$/,
      );
      expect(r.detailUrl).not.toMatch(/[?&]page(Index|Unit)=/);
      expect(r.title).not.toMatch(/^\s*\[/);
    }
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("★입찰·채용·포상·행정예고·결과 공고를 버린다 — 실측 제목으로 확인", () => {
    const titles = rows.map((t) => t.title);
    expect(titles.some((t) => t.includes("입찰"))).toBe(false);
    expect(titles.some((t) => t.includes("공개초빙"))).toBe(false);
    expect(
      isMoelDropTitle("2026년 제4차 수시 정책연구과제(건설업 하도급 노무비율 산정을 위한 실태조사) 입찰 재공고"),
    ).toBe(true);
    expect(
      isMoelDropTitle(
        "일반임기제 행정5급(사회적금융 정책지원 분야) 공무원 경력경쟁채용시험 서류전형 합격자 및 면접시험 일정 공고",
      ),
    ).toBe(true);
    expect(isMoelDropTitle("2026년 직업능력개발 유공 포상 수상자 명단")).toBe(true);
    expect(isMoelDropTitle("근로자의 날 포상규정 일부개정(안) 행정예고")).toBe(true);
    expect(isMoelDropTitle("민간자격 등록폐지")).toBe(true);
    expect(isMoelDropTitle("2025년 청년일자리 강소기업 선정취소 공고")).toBe(true);
    expect(isMoelDropTitle("제49차 외국인력정책위원회 결정사항 공고")).toBe(true);
    expect(isMoelDropTitle("2026년 하반기 청년고용정책 통합 홍보 용역 공고")).toBe(true);
  });

  it("★기업 대상 공고는 살린다 — 실측 제목으로 확인", () => {
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("2027년 청년일자리 강소기업 선정 신청 공고문");
    expect(titles).toContain("2026년 일터혁신 우수기업 선정계획 공고");
    expect(titles).toContain("2026년 장애인고용 우수사업주 선정 계획 및 우대조치 공고");
    expect(titles).toContain("2026년 올해의 사회적기업 선정 계획 공고");
    expect(isMoelDropTitle("2026년 일터혁신 우수기업 선정계획 공고")).toBe(false);
  });

  it("★KEEP 이 「채용」을 이긴다 — 채용문화 우수기업 어워즈가 죽으면 안 된다", () => {
    const t = "2026년 채용문화 우수기업 어워즈(구. 공정채용 우수기업 어워즈) 참가기업 모집 공고";
    expect(isMoelDropTitle(t)).toBe(false);
    expect(rows.map((r) => r.title)).toContain(t);
  });

  it("★넓힌 KEEP — 포상·채용에 걸린 기업 지원 공고를 되살린다(적대 리뷰)", () => {
    // 「포상」 DROP 에 걸리지만 대상이 기업이다.
    expect(isMoelDropTitle("납품대금 연동 우수기업 포상 모집 공고")).toBe(false);
    // 사업명 뒤에 괄호가 붙는 실제 서식 — 예전 `지원사업\s*모집` 은 못 받았다.
    expect(isMoelDropTitle("채용연계형 일자리도약장려금 지원사업(환경개선) 모집 공고")).toBe(false);
    expect(isMoelDropTitle("2026년 고용장려금 지급 신청 안내")).toBe(false);
    expect(isMoelDropTitle("중소기업 청년 특별지원금 신청 공고")).toBe(false);
    // 넓혔어도 조달·인사 글은 그대로 버린다.
    expect(isMoelDropTitle("2026년 정규 제4차 정책연구과제 입찰공고")).toBe(true);
    expect(isMoelDropTitle("한국고용정보원 상임이사(부원장) 공개모집")).toBe(true);
  });

  it("★2쪽 고정본 — 새 행만 늘고 1쪽과 주소가 겹치지 않는다", () => {
    expect(rowsP2.length).toBeGreaterThan(0);
    const p1 = new Set(rows.map((r) => r.detailUrl));
    expect(rowsP2.every((r) => !p1.has(r.detailUrl))).toBe(true);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 제1차 고용노동부 예비사회적기업 공고",
      detailUrl: "https://www.moel.go.kr/news/notice/noticeView.do?bbs_seq=20260700442",
      dateText: "2026-07-13 ~",
      agency: "고용노동부",
    });
  });

  it("★2쪽 실측 제목으로 거르개를 다시 잰다 — 입법예고·개정령안·「공개 모집」이 새 유형이었다", () => {
    const t = rowsP2.map((r) => r.title);
    expect(t.some((x) => x.includes("입법예고"))).toBe(false);
    expect(t.some((x) => x.includes("공개 모집"))).toBe(false);
    expect(isMoelDropTitle("「산업안전보건법 시행령」 일부개정령(안) 입법예고")).toBe(true);
    expect(isMoelDropTitle("「근로기준법 시행령」 일부개정령안 입법예고")).toBe(true);
    expect(isMoelDropTitle("근로복지공단 이사장 공개 모집")).toBe(true);
    expect(isMoelDropTitle("신규화학물질의 명칭 등의 공표")).toBe(true);
    expect(isMoelDropTitle("2026년 NCS 기업활용 우수사례 경진대회 개최 공고")).toBe(true);
    // 살아야 하는 2쪽 실측 행.
    expect(t).toContain("2026년 노사문화 우수기업 선정 공고");
    expect(t).toContain("2026년 장애인고용개선장려금 사업 요건변경 공고");
  });

  it("★「재공고」를 낱말째 버리지 않는다 — 입찰 재공고는 「입찰」이 잡는다", () => {
    expect(isMoelDropTitle("2026년 청년일자리 강소기업 선정 신청 재공고")).toBe(false);
    expect(isMoelDropTitle("2026년 제4차 수시 정책연구과제 입찰 재공고")).toBe(true);
  });

  it("구분 딱지를 떼어 다른 게시판의 같은 공고와 제목을 맞춘다(dedupKey 는 제목+기관)", () => {
    expect(stripMoelTitlePrefix("[공고] 2027년 청년일자리 강소기업 선정 신청 공고문")).toBe(
      "2027년 청년일자리 강소기업 선정 신청 공고문",
    );
    expect(stripMoelTitlePrefix("[알림] 참여기업 모집")).toBe("참여기업 모집");
    // 말머리가 아닌 대괄호는 건드리지 않는다.
    expect(stripMoelTitlePrefix("[2026 채용문화] 어워즈")).toBe("[2026 채용문화] 어워즈");
  });
});

describe("고용노동부 설정", () => {
  it("쪽넘김은 GET pageIndex + pageUnit=50", () => {
    expect(moelConfig.list.url(1)).toBe(
      "https://www.moel.go.kr/news/notice/noticeList.do?pageIndex=1&pageUnit=50",
    );
    expect(moelConfig.list.url(2)).toContain("pageIndex=2");
    expect(moelConfig.list.url(2)).toContain("pageUnit=50");
    expect(moelConfig.list.maxPages).toBe(2);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(moelConfig.id).toBe("moel");
    expect(moelConfig.label).toBe("고용노동부");
    expect(moelConfig.agency).toBe("고용노동부");
    expect(moelConfig.region).toBe("전국");
    expect(moelConfig.charset).toBe("utf-8");
    expect(moelConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(moelConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(moelConfig.expectMinRows!);
  });
});

describe("고용노동부 상세", () => {
  it("본문 선택자가 신청기간이 든 안내문을 집는다", () => {
    const body = (parseHtml(detail).querySelector(moelConfig.detailContentSelector!)?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(body).toContain("『2027년 청년일자리 강소기업』을 선정하고자");
    expect(body).toContain("신청기간 : 2026. 9. 4.(금) ~ 9.30.(수) 18:00");
  });

  it("첨부 1건 — 이름 링크와 「다운로드」 버튼이 같은 주소라 한 줄로 접힌다", () => {
    const scoped = parseHtml(detail)
      .querySelectorAll(moelConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, moelConfig.baseUrl, detail);
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe("2027년 청년일자리 강소기업 선정 신청 공고문(게시).hwpx");
    expect(atts[0].url).toBe(
      "https://www.moel.go.kr/common/downloadFile.do?file_seq=20260900319&bbs_seq=20260900193&bbs_id=9&file_ext=hwpx",
    );
  });
});
