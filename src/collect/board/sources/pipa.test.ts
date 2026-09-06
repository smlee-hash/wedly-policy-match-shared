import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { parsePipaList, pipaConfig, isPipaDropTitle } from "./pipa";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(적대 리뷰 지적).
 * 앞서 손으로 쓴 고정본으로 시험했더니 실제 마크업과 어긋난 선택자가 그대로 통과했다 —
 * 창원은 첨부 범위를 `div.file_list_wrap` 으로 적고도 통과했는데 실제는 `<ul>` 이라
 * 첨부를 하나도 못 잡고 있었다. 고정본: 2026-09-01 배포본 목록 1·2쪽 + 상세 id=1103.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/pipa-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/pipa-list-p2.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/pipa-detail.html"), "utf-8");
const rows = parsePipaList(listHtml);
const combined = parsePipaList(listHtml + listP2Html);

describe("평택산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 6건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      title: "[모집] 2026년 제조 AI 실무 활용 재직자 무료교육 교육생 모집 안내",
      detailUrl:
        "https://www.pipabiz.or.kr/web/contents/notice.do?schM=view&page=1&viewCount=10&id=962&notice=notice",
      // ★이 행은 **고정 공지**(div.board_num.notice)라 날짜를 비운다 — 등록일 2026-05-06 을
      //   개시일로 넘기면 저장 시점에 90일 규칙으로 즉시 마감된다(적대 리뷰 「치명」).
      dateText: "",
      agency: "평택산업진흥원",
    });
  });

  it("onclick 따옴표 안 공백을 버리고 숫자만 쓴다", () => {
    const r = rows.find((x) => x.title.includes("디지털 특성화대학"));
    expect(r?.detailUrl).toContain("id=1090");
    expect(r?.detailUrl).not.toMatch(/id=1090\s/);
  });

  it("★머리줄(li.tr.thead)은 결과에 안 섞인다 — onclick 을 심어도", () => {
    const planted = listHtml.replace(
      '<li class="tr thead">',
      `<li class="tr thead"><div class="board_tit"><a href="#none" onclick="fn_goView('9999', 'notice')"><span>NO</span></a></div>`,
    );
    expect(parsePipaList(planted).some((r) => r.detailUrl.includes("id=9999"))).toBe(false);
  });

  it("★고정 공지 중복이 1·2쪽을 합쳐도 한 번만 나온다", () => {
    const ids = combined.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((u) => u.includes("id=1103")).length).toBe(1);
    expect(ids.filter((u) => u.includes("id=962")).length).toBe(1);
    expect(combined).toHaveLength(11);
  });

  it("등록일은 개시형 YYYY-MM-DD ~ 이다 — 마감일이 없다", () => {
    expect(rows.every((r) => r.dateText === "" || /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(
      true,
    );
    expect(rows.some((r) => r.dateText !== "")).toBe(true);
  });

  it("DROP 은 실측한 버릴 제목을 버리고, 살아남아야 할 제목은 살린다", () => {
    const titles = combined.map((r) => r.title);
    const dropped = [
      "2026년 ｢평택시 기업지원사업 통합 설명회｣ 안내책자 자료",
      "2026 평택시 미래자동차 포럼 행사대행 용역 제안서평가위원회 결과공고",
      "「2026년 평택 창업경진대회 및 팝 스타트업 데이 행사 대행 용역」 제안서 평가위원회 결과 공고",
      "2026 평택시 미래자동차 포럼 행사대행 용역 제안서 평가위원 모집공고",
      "한경국립대학교 경영대학원 최고경영자과정 모집안내",
      "2026년 평택 창업경진대회 및 팝(POP) 스타트업 데이 용역 제안서 평가위원 공개모집 공고",
      "｢PATH 2026(AI 페스타) 행사 대행 용역｣ 제안서 평가결과 공고",
      "공공기관 임직원 사칭 사기피해 예방주의",
      "2026년 ｢반도체 공정·장비 교육 운영｣ 용역 제안서 평가결과 공개",
      "｢2026년 제조 AI 인재양성 사업 교육 운영 위탁 용역｣ 제안서 평가결과 공고",
    ];
    for (const t of dropped) expect(titles.some((x) => x.includes(t) || x === t), t).toBe(false);

    const kept = [
      "평택시「2026년 반도체·첨단소자 공정개발 지원사업」참여기업 모집 공고",
      "2026년 반도체 공정 가스 저감 실증사업 참여기업 추가모집",
      "2026년 해외플랫폼 입점 지원사업 선정기업 공고",
      "2026년 온라인 마케팅 지원사업 선정기업 공고",
      "[결과공고] 2026년 시험인증 지원사업 선정기업 공고",
      "소상공인 대상 「디지털 특성화대학」무료 교육생 모집",
      "[모집] 2026년 제조 AI 실무 활용 재직자 무료교육 교육생 모집 안내",
      "2026년 평택시 미래기술학교 반도체 공정‧장비 과정 교육생 모집",
    ];
    for (const t of kept) expect(titles.some((x) => x.includes(t)), t).toBe(true);
  });

  it("참여기관별 발표자료는 버린다", () => {
    expect(
      parsePipaList(
        listHtml.replace(
          "소상공인 대상 「디지털 특성화대학」무료 교육생 모집",
          "2026년 참여기관별 발표자료",
        ),
      ).some((r) => r.title.includes("발표자료")),
    ).toBe(false);
  });

  it("발명의 날·발명왕 공고는 살린다 — 「안내」로 끝나도 버리지 않는다", () => {
    const planted = listHtml.replace(
      "[행사 안내] PATH 2026 (AI 페스타) – AI로 만들고, 예술로 즐기고, 상상으로 연결한다",
      "제61회 발명의 날 유공 포상 계획 공고",
    );
    expect(parsePipaList(planted).some((r) => r.title.includes("발명의 날"))).toBe(true);
    const king = listHtml.replace(
      "소상공인 대상 「디지털 특성화대학」무료 교육생 모집",
      "2026년 「제16회 올해의 발명왕」 선발 신청 접수 공고",
    );
    expect(parsePipaList(king).some((r) => r.title.includes("올해의 발명왕"))).toBe(true);
  });

  it("같은 글번호는 한 쪽 안에서도 한 번만 담는다 — 1쪽 1103 이 공지+본문 두 줄", () => {
    const ids = rows.map((r) => r.detailUrl);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("평택산업진흥원 설정", () => {
  it("쪽넘김은 GET page — 쪽마다 주소가 달라야 중복이 안 생긴다", () => {
    expect(pipaConfig.list.url(1)).toContain("page=1");
    expect(pipaConfig.list.url(2)).toContain("page=2");
    expect(pipaConfig.list.url(1)).not.toBe(pipaConfig.list.url(2));
    expect(pipaConfig.list.maxPages).toBe(15);
  });

  it("지역은 경기 — 지역 조건 없이 전국에 노출되면 안 된다", () => {
    expect(pipaConfig.region).toBe("경기");
  });

  /**
   * ★설정값이 자기 자신과 같은지만 재면 오타를 못 잡는다(적대 리뷰 지적 — 실제로 못 잡았다).
   * **상세 고정본에서 그 선택자가 실제로 무언가를 잡는지**를 잰다.
   */
  it("첨부 범위 선택자가 상세 고정본에서 실제로 잡힌다", () => {
    const root = parseHtml(detailHtml);
    const hit = root.querySelectorAll(pipaConfig.attachmentsScopeSelector!);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.map((n) => n.innerHTML).join("")).toContain("fileDownload");
  });

  it("상세 본문 선택자가 상세 고정본에서 실제로 잡힌다", () => {
    const root = parseHtml(detailHtml);
    const hit = root.querySelectorAll(pipaConfig.detailContentSelector!);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.map((n) => n.text).join("").length).toBeGreaterThan(0);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(pipaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  /**
   * ★적대 리뷰(코덱스) 「치명」 고정 — 고정 공지는 날짜를 비운다.
   *
   * 왜 이 시험이 필요한가: 저장 쪽 `openStartExpired` 는 「마감일 없음 + 개시일 90일 초과」를
   * 저장 시점에 닫는데, 그 예외인 `PINNED_NOTICE` 는 제목이 「[공지]」로 시작해야 걸린다.
   * 이 게시판 고정 공지는 제목이 「[모집] …」이라 예외에 못 걸리고, 등록일 2026-05-06 은
   * 2026-09-01 기준 118일이라 **사이트에선 맨 위 모집중인데 우리 DB 엔 처음부터 마감**이 된다.
   */
  it("★고정 공지(div.board_num.notice)는 등록일을 개시일로 넘기지 않는다 — 저장 즉시 마감 방지", () => {
    const rows = parsePipaList(listHtml);
    const pinned = rows.find((r) => r.title.includes("제조 AI 실무 활용"));
    expect(pinned, "고정 공지 행이 목록에 있어야 한다").toBeTruthy();
    expect(pinned!.dateText, "고정 공지는 날짜가 비어야 한다").toBe("");
  });

  it("★일반 행은 등록일을 그대로 개시형으로 넘긴다 — 위 규칙이 전부를 비우면 안 된다", () => {
    const rows = parsePipaList(listHtml);
    const normal = rows.filter((r) => r.dateText !== "");
    expect(normal.length, "날짜가 있는 일반 행이 있어야 한다").toBeGreaterThan(0);
    for (const r of normal) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  /** ★적대 리뷰 「중간」 고정 — `대학원` 을 통째로 버리면 진짜 사업이 죽는다. */
  it("★대학원이 들어가도 신청 가능한 사업은 살아남는다", () => {
    for (const t of ["대학원생 창업지원사업 참여기업 모집", "산학협력대학원 기술사업화 지원사업 공고"]) {
      expect(isPipaDropTitle(t), `${t} 가 죽었다`).toBe(false);
    }
    // 실측에 있던 대학원 과정 글은 그대로 버린다.
    expect(isPipaDropTitle("한경국립대학교 경영대학원 최고경영자과정 모집안내")).toBe(true);
  });

  /** ★적대 리뷰 「중간」 고정 — 평가 단계가 아닌 발주 공고도 버린다. */
  it("★용역 발주(입찰·위탁운영)도 버린다 — 제안서 평가만으로는 샌다", () => {
    for (const t of [
      "2026년 제조 AI 인재양성 사업 교육 운영 위탁 용역 입찰 공고",
      "평택시 반도체 장비 유지보수 용역 낙찰 결과",
    ]) {
      expect(isPipaDropTitle(t), `${t} 가 새어 나왔다`).toBe(true);
    }
    // 「교육 운영」·「용역」이라는 낱말만으로 거르면 죽는 진짜 교육 사업은 살아야 한다.
    expect(isPipaDropTitle("2026년 평택시 미래기술학교 반도체 공정‧장비 과정 교육생 모집")).toBe(false);
  });
});
