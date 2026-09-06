import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isKitaDropTitle, parseKitaList, kitaConfig } from "./kita";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-03 실측).
 * · `kita-ongoing-list.html` — 진행중인 사업 1쪽(등록일순, 총 80건 중 10건)
 * · `kita-list.html` / `kita-list-p2.html` — 상시지원 사업 1·2쪽(총 116건 중 각 10건)
 * 두 게시판은 **배타적이지 않다** — 실측 179건 중 17건이 양쪽에 같이 실린다(아래 시험).
 */
const ongoingHtml = readFileSync(join(__dirname, "../__fixtures__/kita-ongoing-list.html"), "utf-8");
const alwaysHtml = readFileSync(join(__dirname, "../__fixtures__/kita-list.html"), "utf-8");
const alwaysP2Html = readFileSync(join(__dirname, "../__fixtures__/kita-list-p2.html"), "utf-8");

const ongoing = parseKitaList(ongoingHtml);
const always = parseKitaList(alwaysHtml);
const alwaysP2 = parseKitaList(alwaysP2Html);

describe("한국무역협회 지원사업 목록 읽기 — 실사이트 고정본", () => {
  it("진행중인 사업 1쪽에서 DROP 을 뺀 9건을 읽고 첫 행이 맞다", () => {
    expect(ongoing).toHaveLength(9);
    expect(ongoing[0]).toMatchObject({
      title: "수출입 거래대금 결제 실무 교육(9/22화, 일산 킨텍스)",
      detailUrl: "https://www.kita.net/asocBiz/asocBiz/asocBizOngoingDetail.do?bizAltkey=202609008",
      dateText: "2026-09-02 ~ 2026-09-18",
      category: "교육/취업",
    });
  });

  it("상시지원 사업 1·2쪽도 같은 구조로 읽힌다(1쪽 5건 · 2쪽 10건)", () => {
    expect(always).toHaveLength(5);
    expect(alwaysP2).toHaveLength(10);
    expect(alwaysP2[0]).toMatchObject({
      title: "[에어제타·현대글로비스 공동] 8월 KITA EXPRESS 소비재 항공운임 프로모션",
      detailUrl: "https://www.kita.net/asocBiz/asocBiz/asocBizOngoingDetail.do?bizAltkey=202608010",
      dateText: "2026-08-05 ~ 2026-08-28",
    });
  });

  it("★날짜는 「모집기간」 칸에서만 집는다 — 「사업기간」을 쓰면 이미 끝난 모집이 연말까지 모집중이 된다", () => {
    // 실측 202601011: 사업기간 2026.01.01~2026.12.31 · 모집기간 2026.09.20~2026.09.25.
    const r = always.find((x) => x.detailUrl.endsWith("bizAltkey=202601011"));
    expect(r?.dateText).toBe("2026-09-20 ~ 2026-09-25");
    expect(r?.dateText).not.toContain("2026-01-01");
    expect(r?.dateText).not.toContain("2026-12-31");
    // 행 전체 글자에서 정규식으로 찾으면 D-22·조회수와 붙거나 사업기간이 먼저 잡힌다.
    expect(always.every((x) => /^\d{4}-\d{2}-\d{2}( ~( \d{4}-\d{2}-\d{2})?)?$/.test(x.dateText))).toBe(true);
  });

  it("★두 게시판에 같이 실린 공고는 상세 주소가 **같다** — 안 그러면 같은 공고가 두 줄로 저장된다", () => {
    // 실측(2026-09-03): 상시 116건 · 진행중 80건 중 **17건이 양쪽에 다 있다**.
    // 상세 본문은 어느 통로로 열어도 같아서(실측 바이트 차이는 머리글 「상시지원/진행중인」뿐)
    // 주소를 하나로 못 박는다. 주소가 곧 중복 판정 열쇠(sourceId)다.
    const same = "https://www.kita.net/asocBiz/asocBiz/asocBizOngoingDetail.do?bizAltkey=202609003";
    expect(ongoing.map((r) => r.detailUrl)).toContain(same);
    expect(always.map((r) => r.detailUrl)).toContain(same);
    const combined = parseKitaList(ongoingHtml + alwaysHtml + alwaysP2Html);
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    // 9 + 5 + 10 에서 겹치는 202609003 한 줄이 빠진다.
    expect(combined).toHaveLength(23);
  });

  it("상세 주소에 쪽 번호·게시판 종류가 섞이지 않는다", () => {
    for (const r of [...ongoing, ...always, ...alwaysP2]) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kita\.net\/asocBiz\/asocBiz\/asocBizOngoingDetail\.do\?bizAltkey=[A-Za-z0-9]+$/,
      );
      expect(r.detailUrl).not.toContain("pageIndex");
      expect(r.detailUrl).not.toContain("pageUnit");
      expect(r.detailUrl).not.toContain("pageType");
    }
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다 — 회원 혜택·협력업체 모집은 지원사업이 아니다", () => {
    const titles = [...ongoing, ...always, ...alwaysP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("호텔 특가"))).toBe(false);
    expect(titles.some((t) => t.includes("협력업체 모집"))).toBe(false);
    expect(titles.some((t) => t.includes("규제애로 건의"))).toBe(false);
    expect(titles.some((t) => t.includes("다이어리 공동제작"))).toBe(false);
    expect(isKitaDropTitle("[인천] 2026년 무역협회 회원사를 위한 송도센트럴파크 호텔 특가 안내")).toBe(true);
    expect(isKitaDropTitle("한국무역협회 RADIS 신규 협력업체 모집 안내")).toBe(true);
    expect(isKitaDropTitle("수출 규제애로 건의")).toBe(true);
    expect(
      isKitaDropTitle("[다이어리] 제2차 2027년 TRADE 다이어리 공동제작 회원사 모집 안내 (8/31(월)~9/11(금) 17시까지, 친환경 재질)"),
    ).toBe(true);
    expect(isKitaDropTitle("[KITA 회원 할인 #1] FedEx, DHL, EMS 등 수출입 운송비 특별 할인 이벤트!")).toBe(true);
  });

  it("★「공동」·「모집」·「교육」을 통째로 버리지 않는다 — 진짜 지원사업이 죽는다", () => {
    // 「공동제작」만 버린다. 「[에어제타·현대글로비스 공동] … 프로모션」은 살아남아야 한다.
    expect(isKitaDropTitle("[에어제타·현대글로비스 공동] 8월 KITA EXPRESS 소비재 항공운임 프로모션")).toBe(false);
    expect(isKitaDropTitle("2026 홍콩 코스모프로프 아시아 대구관/경북관 참여기업 모집(~9/14)")).toBe(false);
    expect(isKitaDropTitle("수출입 거래대금 결제 실무 교육(9/22화, 일산 킨텍스)")).toBe(false);
    expect(isKitaDropTitle("2026년 채용 지원사업 참가기업 모집")).toBe(false);
    expect(alwaysP2.some((r) => r.title.includes("현대글로비스 공동"))).toBe(true);
  });

  it("★모집기간이 1년 넘게 지난 줄은 안 담는다 — 2018~2024년 상시 글이 매 회차 새 공고로 들어온다", () => {
    // 상시지원 게시판 뒤쪽은 통째로 옛 글이다(실측 2쪽 16건 전부 2018~2024년).
    const old = parseKitaList(ongoingHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old).toHaveLength(0);
    // 오늘 기준으로는 한 줄도 나이로 잘리지 않는다 — 규칙이 전부를 비우면 안 된다.
    expect(ongoing.length).toBeGreaterThan(0);
  });

  it("목록이 실어 주는 지역을 summary 로 넘긴다 — 지역은 설정상 「전국」이라 행 정보가 유일한 단서다", () => {
    const r = always.find((x) => x.detailUrl.endsWith("bizAltkey=202601011"));
    expect(r?.summary).toContain("울산");
    // targetText 가 아니라 summary 다 — targetText 를 채우면 첨부 본문 뽑기가 이 공고를 건너뛴다.
    expect(r?.targetText).toBeUndefined();
  });

  it("★행 선택자를 틀리게 준 HTML 은 0행이다 — 껍데기 시험이 아니라는 증거", () => {
    const broken = ongoingHtml.replace(/board-list-biz/g, "board-list-bizX");
    expect(parseKitaList(broken)).toHaveLength(0);
    const noOnclick = ongoingHtml.replace(/goDetailPage/g, "goDetailPageX");
    expect(parseKitaList(noOnclick)).toHaveLength(0);
    // 날짜 칸 이름이 바뀌면 날짜가 빈다(= 사업기간으로 슬쩍 넘어가지 않는다).
    const noLabel = ongoingHtml.replace(/모집기간/g, "접수기간");
    expect(parseKitaList(noLabel).every((r) => r.dateText === "")).toBe(true);
  });

  it("안쪽 목록(사업·지역)을 공고 행으로 세지 않는다 — 한 쪽은 10줄이다", () => {
    // ul.board-list-biz 안의 li 에는 div.info > ul > li(「사업 : 교육/취업」·「지역 : 전국」)가 또 들어 있다.
    const all = parseHtml(ongoingHtml).querySelectorAll("ul.board-list-biz li").length;
    const direct = parseHtml(ongoingHtml).querySelectorAll("ul.board-list-biz > li").length;
    expect(all).toBeGreaterThan(direct);
    expect(direct).toBe(10);
    // 자식 선택자와 onclick 검문 둘 다 — 안쪽 항목이 제목으로 새어 나오면 안 된다.
    for (const r of ongoing) {
      expect(r.title.startsWith("사업 :")).toBe(false);
      expect(r.title.startsWith("지역 :")).toBe(false);
    }
  });
});

describe("한국무역협회 설정", () => {
  it("목록 주소는 홀수 쪽이 진행중 목록, 짝수 쪽이 상시지원 목록 — 쪽 번호는 (p+1)/2", () => {
    expect(kitaConfig.list.url(1)).toBe(
      "https://www.kita.net/asocBiz/asocBiz/asocBizOngoingList.do?pageIndex=1&pageUnit=100",
    );
    expect(kitaConfig.list.url(2)).toBe(
      "https://www.kita.net/asocBiz/asocBiz/asocBizAlwaysList.do?pageIndex=1&pageUnit=100",
    );
    expect(kitaConfig.list.url(3)).toBe(
      "https://www.kita.net/asocBiz/asocBiz/asocBizOngoingList.do?pageIndex=2&pageUnit=100",
    );
    expect(kitaConfig.list.url(4)).toBe(
      "https://www.kita.net/asocBiz/asocBiz/asocBizAlwaysList.do?pageIndex=2&pageUnit=100",
    );
  });

  it("쪽 번호를 주소가 나른다 — POST 본문(list.init)이 아니다", () => {
    // 실측: GET 질의로도 pageIndex·pageUnit 이 그대로 먹는다(200, 100행).
    expect(kitaConfig.list.init).toBeUndefined();
  });

  it("추측 단계(heuristic)를 끈다 — 목록에 진짜 링크가 하나도 없어 메뉴를 공고로 저장한다", () => {
    expect(kitaConfig.skipHeuristic).toBe(true);
    const hrefs = parseHtml(ongoingHtml)
      .querySelectorAll("ul.board-list-biz > li a")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h.startsWith("javascript:"))).toBe(true);
  });

  it("기관은 「한국무역협회」로 두고 제목 대괄호에서 뽑지 않는다 — 대괄호가 지역·상태다", () => {
    // 실측 대괄호: [인천]·[전남]·[상시]·[모집마감]·[다이어리] — 기관이 아니다.
    expect(kitaConfig.agency).toBe("한국무역협회");
    expect(kitaConfig.region).toBe("전국");
    expect([...ongoing, ...always].every((r) => r.agency === undefined)).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kitaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    // 실측 1쪽(진행중 80건 중 74건 통과)보다 넉넉히 낮게 — 비수기에 통째로 실패하지 않게.
    expect(kitaConfig.expectMinRows).toBeLessThan(40);
  });
});

/** ★상세 본문·첨부 자리 — 2026-09-03 실측 고정본(`asocBizAlwaysDetail.do?bizAltkey=202601011`). */
describe("상세 본문·첨부 자리", () => {
  const detailHtml = readFileSync(join(__dirname, "../__fixtures__/kita-detail.html"), "utf-8");
  const doc = parseHtml(detailHtml);

  it("★본문 선택자를 채운다 — 첨부가 원리적으로 수확 안 되는 게시판이라 비워 두면 영영 안 채워진다", () => {
    expect(kitaConfig.detailContentSelector).toBeTruthy();
    const text = doc
      .querySelectorAll(kitaConfig.detailContentSelector!)
      .map((el) => el.text.replace(/\s+/g, " ").trim())
      .join("\n\n");
    expect(text).toContain("모집기간");
    expect(text).toContain("2026.09.20 ~ 2026.09.25");
    expect(text).toContain("울산");
    expect(text.length).toBeGreaterThan(50);
  });

  it("본문 선택자를 한 글자 바꾸면 못 잡는다 — 선택자가 실제로 쓰인다는 증거", () => {
    expect(doc.querySelector("div.detail-head-x")).toBeNull();
    expect(doc.querySelector("div.detail-head")).not.toBeNull();
  });

  it("첨부 범위가 첨부 목록만 담는다 — 다만 내려받기가 onclick 이라 수확은 0건이다", () => {
    const scope = doc.querySelector(kitaConfig.attachmentsScopeSelector!);
    expect(scope).not.toBeNull();
    expect(scope!.text).toContain(".pdf");
    // href 가 전부 javascript:void(0) 이고 eGov·서울TP 형식도 아니라 첨부 수확기가 못 집는다.
    const hrefs = scope!.querySelectorAll("a").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h.startsWith("javascript:"))).toBe(true);
  });
});
