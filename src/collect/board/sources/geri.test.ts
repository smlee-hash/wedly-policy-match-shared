import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isGeriDropTitle, parseGeriList, geriConfig } from "./geri";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 `board_list.asp?board_id=business` 1·2쪽.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/geri-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/geri-list-p2.html"), "utf-8");
const rows = parseGeriList(listHtml);
const rowsP2 = parseGeriList(listP2Html);
const combined = [...rows, ...rowsP2];

describe("구미전자정보기술원 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 20줄에서 DROP 을 뺀 9건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "(수정공고) 김천·칠곡_2026년 시군특화 맞춤형 일자리 지원사업 참여기업 모집(7차)",
      detailUrl: "https://geri.re.kr/html/board_content.asp?board_id=business&board_idx=4358",
      dateText: "2026-08-31 ~",
    });
  });

  it("★상세 주소에 쪽 번호를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
  });

  it("일반 행은 등록일을 개시형으로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(25);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — page= 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 소프트웨어 인재키움사업 바이브 코딩 창업교육 교육생 모집 공고",
      detailUrl: "https://geri.re.kr/html/board_content.asp?board_id=business&board_idx=4314",
      dateText: "2026-08-03 ~",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("예비평가위원"))).toBe(false);
    expect(titles.some((t) => t.includes("선정평가 예비위원"))).toBe(false);
    expect(
      isGeriDropTitle(
        "SEDEX 2026 구미시 투자유치 홍보관 조성 및 투자유치 설명회 기획 운영 용역 제안서 예비평가위원 모집",
      ),
    ).toBe(true);
    expect(
      isGeriDropTitle("「제조 데이터 통합 기반 AI 서비스 개발」 용역 제안서 선정평가 예비위원 모집 공고"),
    ).toBe(true);
    expect(
      isGeriDropTitle("조달용역(전기화재 및 화재감지 안전솔루션 고도화 용역) 제안서 예비평가위원 모집 공고"),
    ).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isGeriDropTitle("청년 채용 지원금 참여기업 모집 공고")).toBe(false);
    expect(rows.some((r) => r.title.includes("인턴십"))).toBe(true);
  });

  it("날짜는 span.t4 칸에서만 집는다 — 행 전체 글자면 번호·조회수와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("board_idx=4358"));
    expect(r?.dateText).toBe("2026-08-31 ~");
    expect(r?.dateText).not.toMatch(/747/);
    expect(r?.dateText).not.toMatch(/107/);
  });
});

describe("구미전자정보기술원 설정", () => {
  it("쪽넘김은 GET page + board_id=business", () => {
    expect(geriConfig.list.url(1)).toBe(
      "https://geri.re.kr/html/board_list.asp?board_id=business&page=1",
    );
    expect(geriConfig.list.url(2)).toBe(
      "https://geri.re.kr/html/board_list.asp?board_id=business&page=2",
    );
    expect(geriConfig.list.maxPages).toBe(10);
  });

  it("지역은 경북", () => {
    expect(geriConfig.region).toBe("경북");
    expect(geriConfig.id).toBe("geri");
    expect(geriConfig.agency).toBe("구미전자정보기술원");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(geriConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseGeriList(listHtml.replaceAll("notice_box", "notice_box-x"))).toHaveLength(0);
  });

  it("제목 칸(span.txt)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseGeriList(listHtml.replaceAll('class="txt"', 'class="txt-x"'))).toHaveLength(0);
  });

  it("작성일 칸이 사라지면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    expect(parseGeriList(listHtml.replaceAll('class="t4"', 'class="t4-x"')).every((r) => r.dateText === "")).toBe(
      true,
    );
  });
});
