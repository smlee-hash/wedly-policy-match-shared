import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { parseSeseList, seseConfig, isSeseDropTitle, seseAgencyOf } from "./sese";

/** 고정본: 2026-09-02 POST `/homepage/bbs/ajax/boardList.do` 응답 1·2쪽 원문. */
const p1 = readFileSync(join(__dirname, "../__fixtures__/sese-list.json"), "utf-8");
const p2 = readFileSync(join(__dirname, "../__fixtures__/sese-list-p2.json"), "utf-8");
const rows = parseSeseList(p1);

describe("한국사회적기업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 10건에서 교육 안내를 걸러낸 5건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      title: "[전라남도] 2026년도 1차 예비사회적기업 지정 공모",
      detailUrl:
        "https://www.socialenterprise.or.kr/homepage/bbs/boardView.do?bsIdx=10002&bIdx=252611&menuId=822",
      dateText: "2026-09-01 ~",
      agency: "전라남도",
    });
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다", () => {
    const all = [...rows, ...parseSeseList(p2)];
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(all.length);
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 주소가 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
  });
});

describe("기관 뽑기 — 지자체 공고를 옮겨 싣는 자리라서", () => {
  it("지자체 이름이면 그것이 실제 공고 기관이다", () => {
    expect(seseAgencyOf("[전라남도] 2026년도 1차 예비사회적기업 지정 공모")).toBe("전라남도");
    expect(seseAgencyOf("[광주광역시] 2026년도 2차 예비사회적기업 지정 공모")).toBe("광주광역시");
    expect(seseAgencyOf("[성남시] 무엇무엇 모집")).toBe("성남시");
  });

  it("★대괄호가 전부 기관인 것은 아니다 — 글머리표·자기 권역센터는 안 쓴다", () => {
    // 실측 제목에 섞여 있던 것들. 이걸 기관으로 쓰면 중복 열쇠가 엉뚱하게 갈린다.
    expect(seseAgencyOf("[공고문] 2026년 제8회 지방자치단체 사회적경제정책 평가사업 모집")).toBeUndefined();
    expect(seseAgencyOf("[세종대전충청센터] 2026년 제3차 사회적가치지표 측정 대비 교육")).toBeUndefined();
    expect(seseAgencyOf("[경기강원센터] 하반기 인·지정 교육 신청 안내")).toBeUndefined();
    expect(seseAgencyOf("대괄호 없는 제목")).toBeUndefined();
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("실측에 있던 권역센터 교육·설명회·결과 발표를 버린다", () => {
    for (const t of [
      "[경기강원센터] 2026년 하반기 (예비)사회적기업 인·지정 교육 신청 안내 (9/9, 9/14, 9/21)",
      "[세종대전충청센터] 2026년 하반기 차년도 경영공시 대비 (사회적)협동조합 기초 세무·회계 교육 안내",
      "9월 사회적협동조합 설립인가 및 경영공시 교육 안내(9/16(수), 9/17(목) - 온오프라인병행)",
      "[서울·인천센터] 2026년 서울·인천 권역 9월 인증 설명회(09.09(수), 09.29(화))",
      "[정보화기획팀] 고용노동부-산하기관이 함께하는 개인정보보호 퀴즈 이벤트!",
      "「2026 사회적가치 비즈니스 모델 공모전」 1차 심사 결과 공고",
      "`26년 사회적가치지표(SVI) 측정 접수 마감 계획 안내",
    ]) {
      expect(isSeseDropTitle(t), t).toBe(true);
    }
  });

  it("★진짜 지원사업은 살린다 — 허용목록을 쓰면 이것들이 통째로 죽는다", () => {
    for (const t of [
      "[전라남도] 2026년도 1차 예비사회적기업 지정 공모",
      "「2026년 강원권역 멤버십 기업·졸업팀 등 특화 멘토링 지원사업」 참여기업 모집 공고",
      "맞춤형 판로지원사업(소셜벤더 운영 사업(시장진입형)) 참여기업 모집",
      "[경기강원센터] 강원(춘천 권역) 사회적경제 성장사다리 프로그램 참여자(기업) 모집",
      "2026 문화분야 사회적기업 우수사례 포상 공고",
      // ★「채용」을 통째로 버리면 고용보조금이 죽는다(cwip 에서 겪음)
      "청년 채용 지원금 참여기업 모집 공고",
      // ★「교육」을 통째로 버리면 이것도 죽는다 — 「교육 안내」 꼴로만 좁힌 이유
      "2026년 사회적기업가 육성사업 교육생 모집",
    ]) {
      expect(isSeseDropTitle(t), t).toBe(false);
    }
  });
});

describe("붙박이 공지 — 등록일을 개시일로 넘기지 않는다", () => {
  it("NOTICE_YN 이 Y 면 날짜를 비운다(비우지 않으면 90일 규칙에 걸려 저장 즉시 마감)", () => {
    const one = JSON.parse(p1) as { resultList: Array<Record<string, unknown>> };
    one.resultList[0].NOTICE_YN = "Y";
    expect(parseSeseList(JSON.stringify(one))[0].dateText).toBe("");
  });

  it("noticeList 로 온 줄도 날짜를 비우고, 같은 글이 일반 행에 또 와도 한 줄만 남는다", () => {
    const one = JSON.parse(p1) as { resultList: unknown[]; noticeList: unknown[] };
    one.noticeList = [one.resultList[0]];
    const out = parseSeseList(JSON.stringify(one));
    expect(out).toHaveLength(5);
    expect(out[0].dateText).toBe("");
  });
});

describe("설정", () => {
  it("쪽 번호는 POST 본문이 나른다", () => {
    expect(seseConfig.list.url(1)).toBe(seseConfig.list.url(2));
    expect(seseConfig.list.init!(3).body).toContain("page=3");
    expect(seseConfig.list.init!(3).body).toContain("bsIdx=10002");
  });

  it("상세 주소 호스트가 baseUrl 과 같다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(seseConfig.baseUrl).host);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("SUBJECT 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSeseList(p1.replaceAll('"SUBJECT"', '"SUBJECT_X"'))).toHaveLength(0);
  });

  it("WRITE_DATE 가 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    expect(parseSeseList(p1.replaceAll('"WRITE_DATE"', '"WRITE_DATE_X"'))[0].dateText).toBe("");
  });

  it("응답이 JSON 이 아니면 빈 배열", () => {
    expect(parseSeseList("<html>관문 화면</html>")).toEqual([]);
  });
});

/**
 * ★상세 본문·첨부 자리 — 고정본 `boardView.do?bsIdx=10002&bIdx=252611` 로 잰다.
 * 이 시험이 없었으면 `div.view-wrp` 를 쓴 첫 판이 그대로 나갈 뻔했다(아래 참고).
 */
describe("상세 본문·첨부 자리", () => {
  const doc = parseHtml(readFileSync(join(__dirname, "../__fixtures__/sese-detail.html"), "utf-8"));

  it("★본문 선택자를 **일부러 비운다** — 짧은 표지문을 채우면 첨부 공고문을 영영 못 읽는다", () => {
    expect(seseConfig.detailContentSelector).toBeUndefined();
    // 왜 비웠는지의 증거: 본문 상자는 183자짜리 표지문뿐이다.
    const body = doc.querySelector("div.view-contents-wrp")!;
    expect(body.text.replace(/\s+/g, " ").trim().length).toBeLessThan(600);
    expect(body.text.replace(/\s+/g, " ")).toContain("예비사회적기업 지정계획");
  });

  it("★`div.view-wrp` 는 어떤 경우에도 쓰면 안 된다 — 21,503자 중 대부분이 자바스크립트다", () => {
    const wide = doc.querySelector("div.view-wrp")!;
    const body = doc.querySelector("div.view-contents-wrp")!;
    expect(wide.querySelectorAll("script").length).toBeGreaterThan(0);
    expect(wide.text.length).toBeGreaterThan(body.text.length * 50);
    expect(body.querySelectorAll("script")).toHaveLength(0);
  });

  it("첨부 범위가 첨부 목록만 담는다", () => {
    const scope = doc.querySelector(seseConfig.attachmentsScopeSelector!)!;
    const links = scope.querySelectorAll("a[href]").map((a) => a.getAttribute("href") ?? "");
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((h) => h.includes("/cmmn/download.do"))).toBe(true);
  });
});
