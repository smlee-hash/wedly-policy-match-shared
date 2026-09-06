import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKosmesList, kosmesConfig, isKosmesDropTitle } from "./kosmes";

/**
 * ★손으로 쓴 JSON 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-03 POST `/sh/nts/notice_list.json` 응답 1·2쪽 원문
 * (nowPage=1·2, pageCount=10, rowCount=10, param=proc=List, bKind=popluar, activatedTab=01).
 * 파일 이름은 다른 게시판과 맞춰 `.html` 이지만 본문은 JSON 이다 — 목록 HTML 은 행이 없는 뼈대다.
 */
const p1 = readFileSync(join(__dirname, "../__fixtures__/kosmes-list.html"), "utf-8");
const p2 = readFileSync(join(__dirname, "../__fixtures__/kosmes-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseKosmesList(p1, 1, NOW);

describe("중소벤처기업진흥공단 공지 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10건에서 거르개를 지난 9건을 읽고 첫 행(붙박이)의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "새정부 출범, 중소벤처기업과 함께 뛴 중진공의 성과",
      detailUrl: "https://www.kosmes.or.kr/nsh/SH/NTS/SHNTS001F0.do?seqNo=6107029",
      // 붙박이(BADGE_CD=중요)는 등록일을 개시일로 넘기지 않는다 — 넘기면 3월 글이 90일 규칙에 걸려 저장 즉시 마감된다.
      dateText: "",
    });
  });

  it("등록일만 주는 일반 행은 「등록일 ~」 개시형이다 — VALI_DT 를 마감으로 쓰지 않는다", () => {
    const ai = rows.find((r) => r.title.includes("AI 활용"))!;
    expect(ai).toMatchObject({
      title: "「지역 중소기업 AI 활용·확산 유공 포상」 후보자 모집 공고",
      detailUrl: "https://www.kosmes.or.kr/nsh/SH/NTS/SHNTS001F0.do?seqNo=6107140",
      dateText: "2026-09-01 ~",
    });
    // VALI_DT=2026-09-21 이 같이 오지만 본문 대조를 못 해 마감일로 단정하지 않는다.
    expect(ai.dateText).not.toContain("2026-09-21");
    const dated = rows.filter((r) => r.dateText !== "");
    expect(dated.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]nowPage=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => !/[?&]PAGE=/.test(r.detailUrl))).toBe(true);
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다", () => {
    const all = [...rows, ...parseKosmesList(p2, 2, NOW)];
    expect(all).toHaveLength(16);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(16);
  });

  it("SLNO 나 제목이 없는 줄은 버린다", () => {
    expect(
      parseKosmesList(JSON.stringify({ ds_infoList: [{ SLNO: "1" }, { TITL_NM: "제목만" }] })),
    ).toEqual([]);
  });

  it("JSON 이 아니거나 모양이 다르면 빈 배열 — 수집이 통째로 죽지 않는다", () => {
    expect(parseKosmesList("<html>뼈대만</html>")).toEqual([]);
    expect(parseKosmesList(JSON.stringify({ pageInfo: {} }))).toEqual([]);
  });

  it("★같은 SLNO 가 한 응답에 두 번 오면 한 줄만 남긴다", () => {
    const one = JSON.parse(p1) as { ds_infoList: unknown[] };
    one.ds_infoList = [one.ds_infoList[1], one.ds_infoList[1]];
    expect(parseKosmesList(JSON.stringify(one), 1, NOW)).toHaveLength(1);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("실측에 있던 공고 아닌 글을 버린다", () => {
    expect(rows.some((r) => r.title.includes("청렴도"))).toBe(false);
    expect(rows.some((r) => r.title.includes("제3자 제공"))).toBe(false);
    const p2rows = parseKosmesList(p2, 2, NOW);
    expect(p2rows.some((r) => r.title.includes("기준금리"))).toBe(false);
    expect(p2rows.some((r) => r.title.includes("유예기간"))).toBe(false);
    expect(p2rows.some((r) => r.title.includes("선정 결과"))).toBe(false);
    for (const t of [
      "공공기관 종합청렴도 평가 관련 개인정보 제3자 제공사항 알림",
      "2026년도 3/4분기 정책자금 기준금리",
      "정책자금 우대금리(신보 다사랑보험 가입기업) 제도 종료 유예기간 안내",
      "2026년 글로벌베이스캠프 사업 수행기관 선정 결과 공지",
    ]) {
      expect(isKosmesDropTitle(t), t).toBe(true);
    }
  });

  it("★진짜 지원사업은 살린다 — 「채용」을 통째로 버리면 고용보조금이 죽는다", () => {
    for (const t of [
      "「지역 중소기업 AI 활용·확산 유공 포상」 후보자 모집 공고",
      "2026년 중소기업 챌린지진단 지원사업 참여기업 모집 안내",
      "2026년 기업인력애로센터 활용 취업 지원 사업 구인기업 및 구직자 모집 공고",
      "청년 채용 지원금 참여기업 모집 공고",
      "'25년 상반기 중진공 직접대출업체 대상 지원 이후 성과창출기업 우대금리 신청 안내",
    ]) {
      expect(isKosmesDropTitle(t), t).toBe(false);
    }
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("BADGE_CD 가 중요 인 줄은 날짜를 비운다", () => {
    expect(rows[0].dateText).toBe("");
    expect(rows[0].title).toContain("중진공의 성과");
  });

  it("★1년 넘게 붙어 있는 붙박이는 아예 안 담는다 — 오래된 안내문이 새 공고로 되살아나면 안 된다", () => {
    // 2026-03-13 붙박이. 기준을 2027-04-01 로 옮기면 1년을 넘겨 빠진다.
    const later = parseKosmesList(p1, 1, Date.parse("2027-04-01T00:00:00Z"));
    expect(later.some((r) => r.title.includes("중진공의 성과"))).toBe(false);
    expect(later.length).toBe(rows.length - 1);
  });
});

describe("중소벤처기업진흥공단 공지 설정", () => {
  it("쪽 번호는 주소가 아니라 POST 본문이 나른다 — 주소는 쪽과 무관하게 같다", () => {
    expect(kosmesConfig.list.url(1)).toBe(kosmesConfig.list.url(2));
    expect(kosmesConfig.list.url(1)).toBe("https://www.kosmes.or.kr/sh/nts/notice_list.json");
    expect(kosmesConfig.list.init?.(2)).toMatchObject({ method: "POST" });
    expect(kosmesConfig.list.init!(2).body).toContain("nowPage=2");
    expect(kosmesConfig.list.init!(2).body).toContain("pageCount=10");
    expect(kosmesConfig.list.init!(2).body).toContain("rowCount=10");
    expect(kosmesConfig.list.init!(2).body).toContain("param=proc%3DList");
    // 사이트가 popular 를 popluar 로 보낸다 — 고치면 목록이 거절된다.
    expect(kosmesConfig.list.init!(2).body).toContain("bKind=popluar");
    expect(kosmesConfig.list.init!(2).body).toContain("activatedTab=01");
  });

  it("한 쪽 10건 × 4쪽이 실측 전체(40)를 덮는다", () => {
    expect(kosmesConfig.list.maxPages).toBe(4);
    expect(kosmesConfig.expectMinRows).toBe(5);
  });

  it("상세 주소 호스트가 baseUrl 과 같아 허용 호스트 검사를 통과한다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(kosmesConfig.baseUrl).host);
  });

  it("상세 본문·첨부 선택자는 비워 둔다 — 정적 HTML 은 뼈대이고 본문은 별도 AJAX 다", () => {
    expect(kosmesConfig.detailContentSelector).toBeUndefined();
    expect(kosmesConfig.attachmentsScopeSelector).toBeUndefined();
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 이걸 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * JSON 칸 이름을 바꾼 응답을 넣었을 때 결과가 실제로 달라지는지 확인한다.
 */
describe("망가뜨려 보기", () => {
  it("TITL_NM 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKosmesList(p1.replaceAll('"TITL_NM"', '"TITL_NM_X"'), 1, NOW)).toHaveLength(0);
  });

  it("ds_infoList 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKosmesList(p1.replaceAll('"ds_infoList"', '"ds_infoList_X"'), 1, NOW)).toHaveLength(0);
  });

  it("REG_DTM 이 사라지면 일반 행의 날짜를 비운다(오늘 날짜·VALI_DT 를 지어내지 않는다)", () => {
    const broken = parseKosmesList(p1.replaceAll('"REG_DTM"', '"REG_DTM_X"'), 1, NOW);
    const ai = broken.find((r) => r.title.includes("AI 활용"))!;
    expect(ai.dateText).toBe("");
  });

  it("VALI_DT 칸 이름이 바뀌어도 접수기간 글자가 그대로다 — 그 칸을 안 본다는 증거", () => {
    const broken = parseKosmesList(p1.replaceAll('"VALI_DT"', '"VALI_DT_X"'), 1, NOW);
    expect(broken.map((r) => r.dateText)).toEqual(rows.map((r) => r.dateText));
  });
});
