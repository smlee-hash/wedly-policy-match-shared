import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import {
  isSmes24DropTitle,
  parseSmes24List,
  smes24Config,
  smes24DetailHtml,
  smes24ListUrl,
} from "./smes24";

/**
 * ★손으로 쓴 JSON 대신 **실사이트 고정본**으로 잰다(2026-09-03 받음).
 * · `smes24-list.html`    = 엔진 1쪽 = `applyStatus=AVAILABLE` 1쪽(마감임박순 50건)
 * · `smes24-list-p2.html` = 엔진 2쪽 = `applyStatus=PLANNED` 1쪽(진행예정 17건 전부)
 * · `smes24-list-p3.html` = 엔진 3쪽 = `applyStatus=AVAILABLE` 2쪽
 * 이름이 `.html` 인 것은 이 저장소 고정본 관행이다(중진공 `kosmes-list.html` 도 JSON).
 */
const F = (name: string) => readFileSync(join(__dirname, `../__fixtures__/${name}`), "utf-8");
const p1 = F("smes24-list.html");
const p2 = F("smes24-list-p2.html");
const p3 = F("smes24-list-p3.html");
const detailJson = F("smes24-detail.html");

const rows = parseSmes24List(p1, 1);

describe("중소벤처24 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽에서 50건을 읽고 첫 행의 제목·상세주소·접수기간·분야·소관기관이 맞다", () => {
    expect(rows).toHaveLength(50);
    expect(rows[0]).toMatchObject({
      title: "[전남광주] 2026년 청년친화도시 청년 스타트업 쇼룸 순천 참여업체 모집 재공고",
      detailUrl: "https://portal.smes.go.kr/home/req/pbanc/280581391",
      dateText: "2026-08-28 ~ 2026-09-03",
      category: "창업",
      agency: "전남광주통합특별시",
    });
  });

  it("★날짜는 칸 두 개(bizAplyBgngYmd·bizAplyDdlnYmd)를 따로 읽는다 — 행 글자를 정규식으로 훑지 않는다", () => {
    // 이어 붙인 글자에서 찾으면 조회수·공고번호 숫자가 날짜로 붙는다. 칸 단위라 50건 전부 「시작 ~ 끝」.
    const bad = rows.filter((r) => !/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText));
    expect(bad.map((r) => `${r.title}=${r.dateText}`)).toEqual([]);
  });

  it("★상세주소에 쪽 번호가 섞이지 않는다 — 같은 공고가 쪽마다 다른 줄로 저장되면 안 된다", () => {
    expect(rows.every((r) => /^https:\/\/portal\.smes\.go\.kr\/home\/req\/pbanc\/\d+$/.test(r.detailUrl))).toBe(true);
    expect(rows.some((r) => r.detailUrl.includes("page"))).toBe(false);
  });

  it("2쪽(진행예정)은 17건이고, 마감이 시작보다 앞선 뒤집힌 자료는 마감을 버려 개시형으로 싣는다", () => {
    const planned = parseSmes24List(p2, 2);
    expect(planned).toHaveLength(17);
    // 실자료: 접수시작 2026-10-01 인데 마감이 2025-10-20 로 찍혀 있다(사이트 오타).
    // 그대로 실으면 시작 전에 끝난 공고가 되어 저장 즉시 마감 처리된다.
    expect(planned[0]).toMatchObject({
      title: "2027 일본 도쿄 소비재 기프트쇼 수출컨소시엄",
      detailUrl: "https://portal.smes.go.kr/home/req/pbanc/240183377",
      dateText: "2026-10-01 ~",
    });
    expect(planned[0].dateText).not.toContain("2025");
  });

  it("1·2·3쪽을 합쳐도 중복이 없다 — 쪽 배치가 틀리면 같은 쪽을 두 번 받아 여기서 걸린다", () => {
    const all = [...rows, ...parseSmes24List(p2, 2), ...parseSmes24List(p3, 3)];
    expect(all).toHaveLength(117);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(117);
  });

  it("★행별 상태 글이 「신청가능·진행예정」이 아니면 버린다 — 목록 필터를 API 가 무시해도 끝난 공고가 안 실린다(코덱스 지적 2026-09-03)", () => {
    const mk = (no: string, statusText: string | null) => ({ bizPbancNo: no, bizPbancNm: `상태 시험 공고 ${no}`, bizAplyBgngYmd: "20260901", bizAplyDdlnYmd: "20261231", applyStatusText: statusText });
    const json = JSON.stringify({ data: { content: [mk("9001", "신청가능"), mk("9002", "접수마감"), mk("9003", "진행예정"), mk("9004", null), mk("9005", "종료")] } });
    const out = parseSmes24List(json, 1).map((r) => r.detailUrl.match(/\/pbanc\/(\d+)/)?.[1]);
    expect(out).toEqual(["9001", "9003", "9004"]);
  });

  it("쪽수 상한은 접수중 33쪽 + 진행예정 1쪽을 다 덮는다(1,630건 = 50건씩 33쪽, 2026-09-03 실측)", () => {
    expect(smes24Config.list.maxPages).toBeGreaterThanOrEqual(35);
    expect(smes24Config.allowUndatedRows).toBe(true);
  });

  it("★날짜가 없는 「예산 소진시까지」 줄은 날짜를 지어내지 않고 빈 칸으로 둔다", () => {
    // 실자료 1,630건 중 997건이 이 꼴이다(2026-09-03 전 쪽 실측). 오늘 날짜를 넣으면
    // 접수 시작일을 지어내는 것이고, 회차마다 값이 흔들린다.
    const undated = p1
      .replace('"bizAplyBgngYmd":"20260828"', '"bizAplyBgngYmd":null')
      .replace('"bizAplyDdlnYmd":"20260903"', '"bizAplyDdlnYmd":null');
    const out = parseSmes24List(undated, 1);
    expect(out[0].dateText).toBe("");
  });

  it("★진행예정 쪽에서는 날짜 없는 줄을 싣지 않는다 — 그 쪽이 통째로 검증에 걸리면 뒤쪽을 다 잃는다", () => {
    // 공용 검증기(validate.ts)는 한 쪽의 30% 이상이 날짜를 가져야 통과시키고, 못 통과한 쪽에서
    // 수집을 끊는다. 예정 공고는 접수 시작일이 있어야 「예정」으로서 뜻이 있으므로 여기서만 좁게 거른다.
    const undated = p2.replace(/"bizAplyBgngYmd":"\d+"/g, '"bizAplyBgngYmd":null')
      .replace(/"bizAplyDdlnYmd":"\d+"/g, '"bizAplyDdlnYmd":null');
    expect(parseSmes24List(undated, 2)).toEqual([]);
    // 접수중 쪽(1쪽)은 같은 자료라도 버리지 않는다 — 상시 공고를 잃으면 안 된다.
    const undated1 = p1.replace(/"bizAplyBgngYmd":"\d+"/g, '"bizAplyBgngYmd":null')
      .replace(/"bizAplyDdlnYmd":"\d+"/g, '"bizAplyDdlnYmd":null');
    expect(parseSmes24List(undated1, 1)).toHaveLength(50);
  });

  it("공고번호나 제목이 없는 줄은 버린다", () => {
    const only = JSON.stringify({ data: { content: [{ bizPbancNo: 1 }, { bizPbancNm: "제목만" }] } });
    expect(parseSmes24List(only)).toEqual([]);
  });

  it("JSON 이 아니거나 모양이 다르면 빈 배열 — 수집이 통째로 죽지 않는다", () => {
    expect(parseSmes24List("<html>차단</html>")).toEqual([]);
    expect(parseSmes24List(JSON.stringify({ data: {} }))).toEqual([]);
    expect(parseSmes24List(JSON.stringify({ success: false }))).toEqual([]);
  });

  it("같은 공고번호가 한 응답에 두 번 오면 한 줄만 남긴다", () => {
    const one = JSON.parse(p1) as { data: { content: unknown[] } };
    one.data.content = [one.data.content[0], one.data.content[0]];
    expect(parseSmes24List(JSON.stringify(one))).toHaveLength(1);
  });
});

describe("지원사업이 아닌 글 거르기 — 버릴 것만 좁게", () => {
  it("★실자료 1,630건에는 버릴 글이 한 건도 없다 — 거르개가 진짜 공고를 먹으면 안 된다", () => {
    // 2026-09-03 전 쪽(33쪽 1,630건) 실측 결과 아래 낱말에 걸리는 제목은 0건이었다.
    // 이 거르개는 나중에 성격이 다른 글이 섞여 들어올 때를 위한 보호막이다.
    expect(rows).toHaveLength(50);
    expect(parseSmes24List(p3, 3)).toHaveLength(50);
  });

  it("입찰·설문·평가위원·합격자·선정결과만 버린다", () => {
    expect(isSmes24DropTitle("2026년 ○○사업 평가위원 모집 공고")).toBe(true);
    expect(isSmes24DropTitle("2026년 ○○ 지원사업 선정 결과 공고")).toBe(true);
    expect(isSmes24DropTitle("2026년 ○○ 용역 입찰 공고")).toBe(true);
    expect(isSmes24DropTitle("2026년 ○○ 만족도 설문조사 안내")).toBe(true);
    expect(isSmes24DropTitle("2026년 ○○ 교육 합격자 발표")).toBe(true);
  });

  it("★「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽는다(실제 목록 제목)", () => {
    expect(isSmes24DropTitle("[울산] 울주군 2026년 소상공인 직원 신규채용 인건비 지원사업 모집 정정 공고")).toBe(false);
    expect(isSmes24DropTitle("[경남] 2026년 기업 채용연계 청년일자리 지원사업 참여기업 모집 공고")).toBe(false);
    // 기관이 사람을 뽑는 글만 좁게 버린다.
    expect(isSmes24DropTitle("2026년 정규직 직원 채용 공고")).toBe(true);
  });

  it("거른 낱말이 든 행은 실제로 목록에서 빠진다", () => {
    const doctored = p1.replace(
      "[전남광주] 2026년 청년친화도시 청년 스타트업 쇼룸 순천 참여업체 모집 재공고",
      "2026년 청년친화도시 사업 평가위원 모집 공고",
    );
    const out = parseSmes24List(doctored, 1);
    expect(out).toHaveLength(49);
    expect(out.some((r) => r.title.includes("평가위원"))).toBe(false);
  });
});

describe("중소벤처24 설정", () => {
  it("1쪽은 접수중 1쪽, 2쪽은 진행예정, 3쪽부터는 접수중 2쪽… 으로 이어진다", () => {
    expect(smes24ListUrl(1)).toBe(
      "https://portal.smes.go.kr/home/api/v1/pbanc?page=1&size=50&sortType=DEADLINE&bizPbancTypeCd=BIZPBN&applyStatus=AVAILABLE",
    );
    expect(smes24ListUrl(2)).toBe(
      "https://portal.smes.go.kr/home/api/v1/pbanc?page=1&size=50&sortType=DEADLINE&bizPbancTypeCd=BIZPBN&applyStatus=PLANNED",
    );
    expect(smes24ListUrl(3)).toContain("page=2&size=50");
    expect(smes24ListUrl(3)).toContain("applyStatus=AVAILABLE");
    expect(smes24ListUrl(16)).toContain("page=15&size=50");
    expect(smes24Config.list.url(1)).toBe(smes24ListUrl(1));
  });

  it("★쪽 배치가 겹치지 않는다 — 겹치면 같은 쪽을 두 번 받아 뒷쪽을 잃는다", () => {
    const urls = Array.from({ length: smes24Config.list.maxPages }, (_, i) => smes24ListUrl(i + 1));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("★소관을 중앙·지방으로 가르지 않는다(govType 없음) — 가르면 한쪽만 들어온다", () => {
    // govType 을 빼면 중앙정부 567건 + 지방정부 1,063건이 한 줄기로 온다(2026-09-03 실측).
    expect(smes24ListUrl(1)).not.toContain("govType");
    expect(smes24ListUrl(5)).not.toContain("govType");
  });

  it("★마감임박순(DEADLINE)으로 부른다 — 등록일순으로 부르면 12쪽부터 수집이 끊긴다", () => {
    // 실측(2026-09-03): 등록일순은 12쪽에서 날짜 있는 줄이 28% 로 떨어져 공용 검증기의
    // 「30% 규칙」에 걸리고, 걸린 쪽에서 수집이 끊겨 뒷쪽을 통째로 잃는다.
    // 마감임박순은 날짜 있는 633건이 앞쪽에 모여 13쪽까지 100%~62% 로 안전하다.
    expect(smes24ListUrl(1)).toContain("sortType=DEADLINE");
    expect(smes24ListUrl(7)).toContain("sortType=DEADLINE");
  });

  it("한 쪽 50건 — 서버가 50 을 넘는 요청도 50 으로 깎는다(실측)", () => {
    expect(smes24ListUrl(1)).toContain("size=50");
    expect(smes24Config.expectMinRows).toBe(25);
    expect(rows.length).toBeGreaterThanOrEqual(smes24Config.expectMinRows!);
  });

  it("목록은 GET 이라 init 이 없다 — 쪽 번호는 주소가 나른다", () => {
    expect(smes24Config.list.init).toBeUndefined();
  });

  it("상세 주소 호스트가 baseUrl 과 같아 허용 호스트 검사를 통과한다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(smes24Config.baseUrl).host);
    expect(smes24Config.allowedHosts).toBeUndefined();
  });

  it("자격 요약을 targetText 로 싣지 않는다 — 채우면 뒷단계의 상세 채움이 이 공고를 건너뛴다", () => {
    expect(rows.every((r) => r.targetText === undefined && r.summary === undefined)).toBe(true);
  });
});

/**
 * ★상세 본문 — 사람용 상세는 스크립트 화면(빈 껍데기)이라 선택자로는 한 글자도 못 읽는다.
 * 같은 번호를 상세 API 로 다시 불러 칸을 이어 붙인다(`detailFetch`).
 */
describe("상세 본문 조달", () => {
  const html = smes24DetailHtml(detailJson);
  const text = parseHtml(html).text;

  it("지원대상·지원자격·신청제외대상·제출서류·추진절차·문의처를 이름표와 함께 싣는다", () => {
    for (const label of ["사업개요", "지원대상", "지원자격", "신청제외대상", "제출서류", "추진절차", "문의처"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("중소기업 대표·임직원");
    expect(text.length).toBeGreaterThan(500);
  });

  it("빈 칸은 이름표까지 뺀다 — 「지원규모:」 같은 빈 줄을 저장하지 않는다", () => {
    // 고정본의 bizSprtSclCn·bizPbancSprtAmtCn 은 빈 문자열이다.
    expect(text).not.toContain("지원규모");
    expect(text).not.toContain("지원금액");
  });

  it("JSON 이 아니거나 칸이 다 비면 빈 문자열 — 빈 껍데기를 본문으로 저장하지 않는다", () => {
    expect(smes24DetailHtml("<html>차단</html>")).toBe("");
    expect(smes24DetailHtml(JSON.stringify({ data: { bizPbancNo: 1 } }))).toBe("");
  });

  it("detailFetch 는 상세 API 를 인자로 받은 fetchText 로만 부른다 — 허용 호스트 검사가 유지된다", async () => {
    const called: string[] = [];
    const out = await smes24Config.detailFetch!(
      "https://portal.smes.go.kr/home/req/pbanc/280581478",
      async (u) => { called.push(u); return detailJson; },
    );
    expect(called).toEqual(["https://portal.smes.go.kr/home/api/v1/pbanc/280581478?bizPbancTypeCd=BIZPBN"]);
    expect(parseHtml(out).text).toContain("지원자격");
  });

  it("상세 주소에서 공고번호를 못 뽑으면 요청하지 않는다", async () => {
    const called: string[] = [];
    const out = await smes24Config.detailFetch!("https://portal.smes.go.kr/home/req/pbanc/", async (u) => {
      called.push(u); return detailJson;
    });
    expect(called).toEqual([]);
    expect(out).toBe("");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 이걸 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 칸 이름을 바꾼 응답을 넣었을 때 결과가 실제로 달라지는지 확인한다.
 */
describe("망가뜨려 보기", () => {
  it("행 담는 칸(content) 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSmes24List(p1.replaceAll('"content"', '"content_X"'))).toHaveLength(0);
  });

  it("제목 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSmes24List(p1.replaceAll('"bizPbancNm"', '"bizPbancNm_X"'))).toHaveLength(0);
  });

  it("공고번호 칸 이름이 바뀌면 한 줄도 못 읽는다 — 상세주소를 지어내지 않는다", () => {
    expect(parseSmes24List(p1.replaceAll('"bizPbancNo"', '"bizPbancNo_X"'))).toHaveLength(0);
  });

  it("마감 칸 이름이 바뀌면 「시작 ~」 개시형으로 떨어진다(마감일을 지어내지 않는다)", () => {
    const broken = parseSmes24List(p1.replaceAll('"bizAplyDdlnYmd"', '"bizAplyDdlnYmd_X"'), 1);
    expect(broken).toHaveLength(50);
    expect(broken[0].dateText).toBe("2026-08-28 ~");
  });

  it("시작 칸 이름이 바뀌면 마감일만 남는다(단일 날짜 = 마감)", () => {
    const broken = parseSmes24List(p1.replaceAll('"bizAplyBgngYmd"', '"bizAplyBgngYmd_X"'), 1);
    expect(broken[0].dateText).toBe("2026-09-03");
  });

  it("분야 칸 이름이 바뀌면 분야를 비운다(지어내지 않는다)", () => {
    expect(parseSmes24List(p1.replaceAll('"bizPbancClsfCd"', '"bizPbancClsfCd_X"')).every((r) => r.category === "")).toBe(true);
  });

  it("소관기관 칸 이름이 바뀌면 기관을 비워 설정값(중소벤처24)으로 떨어진다", () => {
    expect(parseSmes24List(p1.replaceAll('"bizSprvsnInstNm"', '"bizSprvsnInstNm_X"')).every((r) => r.agency === undefined)).toBe(true);
  });

  it("상세 본문의 자격 칸 이름이 바뀌면 그 줄이 사라진다 — 판정이 실제로 그 칸을 본다는 증거", () => {
    const broken = smes24DetailHtml(detailJson.replaceAll('"bizSprtQlfcRqmtCn"', '"bizSprtQlfcRqmtCn_X"'));
    expect(parseHtml(broken).text).not.toContain("지원자격");
    expect(parseHtml(broken).text).toContain("지원대상");
  });
});
