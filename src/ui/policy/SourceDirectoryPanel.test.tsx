import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceDirectoryTable, sourceRowsForExcel, type DirectoryRow } from "./SourceDirectoryPanel";

const row = (over: Partial<DirectoryRow> = {}): DirectoryRow => ({
  label: "부산테크노파크", url: "https://www.btp.or.kr", status: "connected", note: "",
  count: 36, lastSaved: 36, lastError: null, id: "tp-busan", ...over,
});

describe("수집원 현황 — 엑셀 내보내기", () => {
  it("화면 표와 같은 값을 담는다(수집원·상태·보유 공고·비고)", () => {
    const [r] = sourceRowsForExcel([row()]);
    expect(r[0]).toBe("부산테크노파크");
    expect(r[1]).toBe("연결됨");
    expect(r[2]).toBe(36);
    expect(r[3]).toBe("최근 회차 36건");
  });

  it("연결 안 된 곳은 상태 이름과 사유가 그대로 실린다 — 이 파일을 보고 다음 할 일을 정한다", () => {
    const rows = sourceRowsForExcel([
      row({ label: "전북테크노파크", status: "waiting", count: 52, lastSaved: null, note: "국내 IP 로만 열림", id: "tp-jeonbuk" }),
      row({ label: "창원산업진흥원", status: "candidate", count: 0, lastSaved: null, note: "겹침 대조 후 편입", id: undefined }),
      row({ label: "전남 JEPA", status: "blocked", count: 0, lastSaved: null, note: "지문 차단형", id: undefined }),
    ]);
    expect(rows.map((r) => r[1])).toEqual(["대기", "조사 중", "차단"]);
    expect(rows.map((r) => r[3])).toEqual(["국내 IP 로만 열림", "겹침 대조 후 편입", "지문 차단형"]);
    // 보유 공고가 0 이면 화면과 같이 「-」로
    expect(rows[1][2]).toBe("-");
  });

  it("수집 오류가 있으면 비고를 오류로 덮는다(화면과 같은 규칙)", () => {
    const [r] = sourceRowsForExcel([row({ lastError: "HTTP 503", note: "안 쓰는 메모" })]);
    expect(r[3]).toBe("최근 수집 오류: HTTP 503");
  });

  it("주소와 수집 id 를 함께 담는다 — 화면엔 없지만 파일에선 쓸 값", () => {
    const [r] = sourceRowsForExcel([row()]);
    expect(r[4]).toBe("https://www.btp.or.kr");
    expect(r[5]).toBe("tp-busan");
  });

  it("연결 전 후보는 수집 id 가 빈 값이라도 터지지 않는다", () => {
    const [r] = sourceRowsForExcel([row({ id: undefined })]);
    expect(r[5]).toBe("");
  });
});

describe("수집원 현황 표", () => {
  it("상태 이름이 화면에 그대로 그려진다", () => {
    const html = renderToStaticMarkup(
      <SourceDirectoryTable entries={[row({ status: "waiting" }), row({ label: "차단된 곳", status: "blocked" })]} />,
    );
    expect(html).toContain("대기");
    expect(html).toContain("차단");
  });

  it("오류·대상 아님 상태도 이름 그대로 그려지고, 대상 아님은 점이 없다", () => {
    const html = renderToStaticMarkup(
      <SourceDirectoryTable entries={[
        row({ label: "한국산업기술진흥원", status: "error", count: 312, lastSaved: 0, lastError: "목록 행 0개" }),
        row({ label: "사업주훈련 훈련과정 API", status: "excluded", id: undefined, count: 0, lastSaved: null, note: "공고가 아니라 카탈로그" }),
      ]} />,
    );
    expect(html).toContain("오류");
    expect(html).toContain("대상 아님");
    expect(html).toContain("최근 수집 오류: 목록 행 0개");
    expect(html).toContain("공고가 아니라 카탈로그");
    /**
     * 대상 아님 딱지는 default 변형 = 점 없음(딱지 표준 2026-08-26).
     * ★점은 라벨 **앞**에 그려진다 — 라벨 뒤쪽만 보던 옛 정규식은 `excluded` 를 실수로
     *  yellow·red 로 바꿔 색 점이 생겨도 계속 통과했다(적대 리뷰 낮음).
     *  그래서 「점 span 바로 뒤에 그 라벨이 오는가」로 재고, 점이 있는 딱지(오류)로
     *  이 자를 먼저 검증한다 — 대조군이 없으면 정규식이 아무것도 못 잡아도 초록이다.
     */
    const dotBefore = (label: string) =>
      new RegExp(`<span[^>]*\\brounded-full\\b[^>]*aria-hidden="true"></span>${label}`);
    expect(html, "대조군: 점이 있는 딱지는 이 자에 걸려야 한다").toMatch(dotBefore("오류"));
    expect(html).not.toMatch(dotBefore("대상 아님"));
  });

  it("raw Tailwind 색이 없다(WEDLY 토큰만)", () => {
    const html = renderToStaticMarkup(<SourceDirectoryTable entries={[row(), row({ hitCap: true, lastSaved: 1234 })]} />);
    expect(html).not.toMatch(/(bg|text|border)-(red|green|amber|blue|gray|yellow)-[0-9]{2,3}/);
  });
});

import { noteTextOf, screenNoteOf } from "./SourceDirectoryPanel";

describe("화면·파일 비고가 갈리지 않는다 (2026-09-01 독립 검사 지적)", () => {
  // ★1,000 이상에서만 갈렸다 — 앞선 시험 7건은 36·133 처럼 작은 수만 써서 못 잡았다.
  it("천 단위 쉼표가 파일에도 들어간다", () => {
    const [r] = sourceRowsForExcel([row({ lastSaved: 1463, count: 1801 })]);
    expect(r[3]).toBe("최근 회차 1,463건");
  });

  it("화면이 그리는 글자와 파일에 담기는 글자가 **같은 함수**에서 나온다", () => {
    const e = row({ lastSaved: 1322 });
    const html = renderToStaticMarkup(<SourceDirectoryTable entries={[e]} />);
    const [fromFile] = sourceRowsForExcel([e]);
    expect(html).toContain(noteTextOf(e));
    expect(fromFile[3]).toBe(noteTextOf(e));
    expect(noteTextOf(e)).toBe("최근 회차 1,322건");
  });

  it("오류·메모·회차 우선순위는 그대로", () => {
    expect(noteTextOf(row({ lastError: "HTTP 503", note: "메모", lastSaved: 5 }))).toBe("최근 수집 오류: HTTP 503");
    expect(noteTextOf(row({ lastError: null, status: "waiting", note: "국내 IP 로만 열림", lastSaved: 5 }))).toBe("국내 IP 로만 열림");
    expect(noteTextOf(row({ lastError: null, note: "", lastSaved: null }))).toBe("");
  });

  it("상한 표시가 켜져도 「최근 회차 N건」이 계속 보인다", () => {
    const e = row({ lastSaved: 1234, hitCap: true, note: "" });
    expect(noteTextOf(e)).toContain("최근 회차 1,234건");
    expect(noteTextOf(e)).toContain("상한 도달 — 더 있을 수 있음");
    const html = renderToStaticMarkup(<SourceDirectoryTable entries={[e]} />);
    // ★화면에서 가장 중요한 것 — 건수가 안 가려진다.
    expect(html).toContain("최근 회차 1,234건");
    // 뜻은 딱지와 설명으로 나눠 싣는다.
    expect(html).toContain("상한 도달");
    expect(html).toContain("더 있을 수 있음");
    /**
     * ★같은 말이 두 번 나오면 안 된다(배포본 눈검토에서 실제로 잡혔다 —
     * 주황 글자 「상한 도달 — 더 있을 수 있음」 옆에 딱지 「상한 도달」이 또 붙었다).
     * 딱지가 이름을 맡고 글자는 설명만 맡으므로 「상한 도달」은 화면에 **한 번만** 나온다.
     */
    expect(html.match(/상한 도달/g)?.length ?? 0).toBe(1);
    expect(screenNoteOf(e)).toBe("최근 회차 1,234건 · 더 있을 수 있음");
    /**
     * ★엑셀은 딱지가 없어 글자 하나로 뜻이 서야 한다 — 그래서 화면과 달리 앞머리를 남긴다.
     * 화면 글자와 파일 글자가 갈리는 유일한 자리라, 그 이유를 여기서 못 박는다.
     */
    const [fromFile] = sourceRowsForExcel([e]);
    expect(fromFile[3]).toBe(noteTextOf(e));
    expect(fromFile[3]).toBe("최근 회차 1,234건 · 상한 도달 — 더 있을 수 있음");
  });

  it("상한을 note 에 넣으면 건수가 가려진다 — 그래서 hitCap 칸을 쓴다", () => {
    expect(noteTextOf(row({
      status: "waiting",
      lastSaved: 1234,
      note: "상한 도달 — 더 있을 수 있음",
      hitCap: false,
    }))).not.toContain("최근 회차");
  });

  it("③ 연결된 줄은 note 가 있어도 건수와 상한 경고가 화면·엑셀에 둘 다 보인다", () => {
    const e = row({
      label: "전북테크노파크",
      id: "tp-jeonbuk",
      status: "connected",
      note: "국내 IP 로만 열림 — 국내 경유 서버(사장님 가입·결제) 생기면 자동 수집 전환",
      lastSaved: 52,
      hitCap: true,
    });
    expect(noteTextOf(e)).toContain("최근 회차 52건");
    expect(noteTextOf(e)).toContain("상한 도달 — 더 있을 수 있음");
    const html = renderToStaticMarkup(<SourceDirectoryTable entries={[e]} />);
    expect(html).toContain("최근 회차 52건");
    expect(html).toContain("상한 도달");
    const [fromFile] = sourceRowsForExcel([e]);
    expect(fromFile[3]).toBe(noteTextOf(e));
    expect(String(fromFile[3])).toContain("최근 회차 52건");
    expect(String(fromFile[3])).toContain("상한 도달 — 더 있을 수 있음");
  });

  it("⑦ 장부가 모름이면 경고를 끄지 않고 확인 불가로 둔다", () => {
    const e = row({ lastSaved: 12, hitCap: null });
    expect(noteTextOf(e)).toContain("최근 회차 12건");
    expect(noteTextOf(e)).toContain("확인 불가");
    expect(noteTextOf(e)).not.toContain("상한 도달 — 더 있을 수 있음");
    const html = renderToStaticMarkup(<SourceDirectoryTable entries={[e]} />);
    expect(html).toContain("확인 불가");
    expect(html).not.toMatch(/상한 도달<\/span>/);
  });
});

import SourceDirectoryPanel, { SourceDirectoryHeader, type SourcesSummary } from "./SourceDirectoryPanel";

/**
 * 접힘·펼침 기본값 — 랩(`wedly-policy-lab`)의 `/sources` 전용 화면은 이 판 하나가 곧 화면이라
 * 접혀 있으면 **머리줄만 보이고 요약 카드·「빠진 수집원 신고」 단추가 통째로 안 보였다**
 * (2026-09-07 실측 결함 · 승인 시안은 펼친 표). ERP 는 다른 것들 아래 붙는 한 구역이라
 * 접힘이 맞다 — 그래서 **기본값은 그대로 접힘**이고, 펼침은 랩이 인자로 켠다.
 *
 * ★못 재는 것(솔직히): 이 저장소엔 jsdom 이 없어 `renderToStaticMarkup` 한 번뿐이라
 *  손잡이(useEffect)가 돌지 않는다 → 수집원 현황을 **받아오기 전** 모습만 잰다.
 *  그래서 요약 카드(header)는 여기서 안 그려지는 것이 정상이다(아래 ② 참고).
 */
describe("수집원 현황 판 — 접힘·펼침 기본값", () => {
  const panel = (over: { defaultOpen?: boolean } = {}) =>
    renderToStaticMarkup(
      <SourceDirectoryPanel
        endpoint="/api/policy-match/sources"
        onExport={async () => {}}
        actions={<button type="button">빠진 수집원 신고</button>}
        header={() => <div>요약 카드 넷</div>}
        {...over}
      />,
    );

  it("① 인자를 안 주면 접힌 채로 시작한다 — ERP 동작 그대로", () => {
    const html = panel();
    expect(html, "접혀도 머리줄은 보인다").toContain("수집원 현황");
    // 펼침 표식(ChevronDown)이 아니라 접힘 표식(ChevronRight)
    expect(html).toContain("lucide-chevron-right");
    expect(html).not.toContain("lucide-chevron-down");
    // 몸통이 통째로 없다 — 표도, 단추 줄도
    expect(html).not.toContain("<table");
    expect(html).not.toContain("엑셀 내려받기");
    expect(html).not.toContain("빠진 수집원 신고");
  });

  it("② defaultOpen 이면 첫 그림부터 펼쳐져 표 머리줄·신고 단추·엑셀 단추가 보인다", () => {
    const html = panel({ defaultOpen: true });
    // ①과 정반대 — 두 시험이 서로의 대조군이라 표식이 안 갈리면 둘 중 하나가 깨진다.
    expect(html).toContain("lucide-chevron-down");
    expect(html).not.toContain("lucide-chevron-right");
    expect(html).toContain("<table");
    expect(html, "표 머리줄이 그려진다").toContain("보유 공고");
    expect(html, "랩의 「빠진 수집원 신고」가 첫 그림부터 보인다").toContain("빠진 수집원 신고");
    expect(html).toContain("엑셀 내려받기");
    /**
     * ★요약 카드(header)는 **현황을 받아 온 뒤에만** 그린다(`header && summary`).
     * 첫 그림은 받아오기 전이라 아직 없다 — 이게 실제 동작이고, 사람 화면에서는
     * 펼쳐진 덕분에 손잡이가 돌아 곧 채워진다(접혀 있으면 아예 안 부른다).
     */
    expect(html).not.toContain("요약 카드 넷");
  });

  it("③ 펼쳐도 raw Tailwind 색이 없다(WEDLY 토큰만)", () => {
    const html = panel({ defaultOpen: true });
    expect(html.length, "그린 것이 없으면 이 시험은 아무것도 못 잡는다").toBeGreaterThan(80);
    expect(html).not.toMatch(/(bg|text|border)-(red|green|amber|blue|gray|yellow)-[0-9]{2,3}/);
  });
});

/**
 * 머리줄 제목·요약 두 클래스 — 좁은 화면(390px)에서 제목 「수집원 현황」이 세 줄로 쪼개진
 * 결함의 고침(2026-09-07 독립 화면 검사·중간). `SourceDirectoryHeader` 를 따로 부품으로 뗀
 * 이유는 이 값(summary)을 손잡이(useEffect) 없이 직접 넣어 그려야 재기 때문이다(머리주석 참고).
 */
describe("수집원 현황 머리줄 — 제목은 안 쪼개지고 요약만 줄어든다(2026-09-07)", () => {
  const summary: SourcesSummary = {
    connected: 6,
    waiting: 2,
    candidate: 1,
    blocked: 1,
    error: 0,
    excluded: 3,
    lastRanAt: null,
    lastTailAt: null,
  };

  it("제목 span 은 shrink-0 whitespace-nowrap — 줄지도, 쪼개지지도 않는다", () => {
    const html = renderToStaticMarkup(<SourceDirectoryHeader open={false} summary={summary} onToggle={() => {}} />);
    const m = /<span class="([^"]*)">수집원 현황<\/span>/.exec(html);
    expect(m, "제목 span 을 못 찾았다").not.toBeNull();
    const classes = m![1].split(/\s+/);
    expect(classes).toContain("shrink-0");
    expect(classes).toContain("whitespace-nowrap");
  });

  it("요약 span 은 min-w-0 truncate — 좁으면 요약이 줄고 넘치면 …으로 끊는다", () => {
    const html = renderToStaticMarkup(<SourceDirectoryHeader open={false} summary={summary} onToggle={() => {}} />);
    const i = html.indexOf("연결 6");
    expect(i, "요약 글자를 못 찾았다").toBeGreaterThan(-1);
    const 열림 = html.lastIndexOf("<span", i);
    const 닫힘 = html.indexOf(">", 열림);
    expect(열림, "요약 span 여는 태그를 못 찾았다").toBeGreaterThan(-1);
    const 태그 = html.slice(열림, 닫힘 + 1);
    const m = /class="([^"]*)"/.exec(태그);
    expect(m, "요약 span 에 class 가 없다").not.toBeNull();
    const classes = m![1].split(/\s+/);
    expect(classes).toContain("min-w-0");
    expect(classes).toContain("truncate");
  });

  it("summary 가 없으면(받아오기 전) 제목만 있고 요약 span 자체가 없다", () => {
    const html = renderToStaticMarkup(<SourceDirectoryHeader open={false} summary={null} onToggle={() => {}} />);
    expect(html).toContain("수집원 현황");
    expect(html).not.toContain("min-w-0");
    expect(html).not.toContain("truncate");
  });

  it("펼침 표식(ChevronDown)·아이콘도 shrink-0 이다 — 좁을 때 함께 찌그러지지 않는다", () => {
    const html = renderToStaticMarkup(<SourceDirectoryHeader open summary={null} onToggle={() => {}} />);
    expect(html).toContain("lucide-chevron-down");
    // 아이콘 두 개(펼침 화살표 · Database) 모두 shrink-0 를 지닌다.
    expect(html.match(/shrink-0/g)?.length, "아이콘·제목의 shrink-0 이 예상보다 적다").toBeGreaterThanOrEqual(2);
  });
});
