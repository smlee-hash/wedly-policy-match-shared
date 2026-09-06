import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { isKritDropTitle, parseKritList, kritConfig } from "./krit";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-02 실측 1·2쪽 (`notice_list.do?page=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/krit-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/krit-list-p2.html"), "utf-8");
const rows = parseKritList(listHtml);
const p2 = parseKritList(listP2Html);
const combined = parseKritList(listHtml + listP2Html);

describe("국방기술진흥연구소 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 13건(일반 10 + 고정 공지에만 있는 3)을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject({
      title: "2026년 하반기 방산전시회 참가 지원사업 국내 방산전시회 참여기업 모집 공고문",
      detailUrl: "https://www.krit.re.kr/krit/bbs/notice_view.do?bbsId=notice&nttId=6484",
      dateText: "2026-09-02 ~",
      agency: "국방기술진흥연구소",
    });
  });

  it("제목 앞머리 번호·공지 span 을 뗀다 — 「567…」이나 「공지…」로 시작하면 안 된다", () => {
    // 1쪽 첫 일반 행의 span 글자가 「567」이다. 안 떼면 「5672026년…」이 된다.
    expect(rows[0].title.startsWith("567")).toBe(false);
    expect(rows[0].title.startsWith("공지")).toBe(false);
    for (const r of rows) expect(r.title.startsWith("공지")).toBe(false);
  });

  it("★고정 공지에만 있는 지원사업을 살린다 — 통째로 버리면 영영 못 받는다(적대 리뷰 지적)", () => {
    // 「판로개척 지원사업」(2026-01-14)·「방산 헬프데스크 (~2027.12.31.)」(2023-09-20)은
    // 고정 공지에만 있고 등록일이 오래돼 maxPages:5 안의 일반 목록에서는 다시 안 나온다.
    expect(rows.some((r) => r.title.includes("판로개척 지원사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("방산 헬프데스크"))).toBe(true);
    // 그래도 사람 뽑는 글은 DROP 이 버린다.
    expect(rows.some((r) => r.title.includes("선물 신고"))).toBe(false);
    expect(rows.every((r) => r.detailUrl.includes("nttId="))).toBe(true);
  });

  it("★고정 공지에만 있는 줄은 날짜를 비운다 — 등록일을 넘기면 저장 즉시 마감된다", () => {
    const blank = rows.filter((r) => r.dateText === "");
    expect(blank).toHaveLength(3);
    expect(blank.some((r) => r.title.includes("방산 헬프데스크"))).toBe(true);
    // 2023-09-20 짜리가 개시일로 새어 나가면 안 된다.
    expect(rows.some((r) => r.dateText.includes("2023-09-20"))).toBe(false);
  });

  it("★일반 행에도 있는 공고는 **일반 행의 진짜 등록일**을 지킨다 — 공지가 먼저 담기면 날짜를 잃는다", () => {
    const first = rows.find((r) => r.detailUrl.includes("nttId=6484"))!;
    expect(first.dateText).toBe("2026-09-02 ~");
  });

  it("★상세 주소는 입력칸 이름(bbsId·nttId)을 쓴다 — 스크립트 변수 이름으로 만들면 빈 표가 온다", () => {
    // `bbsSeq`·`bbs_id`·`article_id` 는 이 사이트에 없는 이름이다. 그 이름으로 부르면 응답이
    // 오긴 오는데 표 안의 제목·내용·첨부 칸이 전부 비어 있어 「본문 없음」으로 조용히 남는다.
    expect(rows[0].detailUrl).toContain("bbsId=notice");
    expect(rows[0].detailUrl).not.toContain("bbsSeq");
    // `page` 를 넣으면 엔진이 쪽 번호로 보고 떼어 낼 수 있다 — 애초에 넣지 않는다.
    expect(rows.every((r) => !/[?&]page=/.test(r.detailUrl))).toBe(true);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("2쪽 DROP(소장 모집·중간발표회)을 빼고 8건이며, 합치면 20건이다", () => {
    expect(p2).toHaveLength(8);
    expect(combined).toHaveLength(20);
    expect(combined.some((r) => r.title.includes("소장 모집"))).toBe(false);
    expect(combined.some((r) => r.title.includes("중간발표회"))).toBe(false);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    expect(isKritDropTitle("국방기술품질원 부설 국방기술진흥연구소 소장 모집 공고")).toBe(true);
    expect(isKritDropTitle("[감사실] 선물 신고 제도 안내")).toBe(true);
    expect(
      isKritDropTitle(
        "[국방기술품질원] DQS AI·SW 연구분과 2026년 지능SW팀 연구과제 의견수렴을 위한 중간발표회 개최",
      ),
    ).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 임원 채용만 좁혀 버린다", () => {
    expect(isKritDropTitle("방산 중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isKritDropTitle("국방기술진흥연구소 임원 채용 공고")).toBe(true);
  });

  it("등록일은 ul.writer li.date 칸에서만 집는다 — 행 전체 글자면 조회수와 붙는다", () => {
    expect(rows.every((r) => r.dateText === "" || /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(
      true,
    );
    expect(rows[0].dateText).toBe("2026-09-02 ~");
  });
});

describe("국방기술진흥연구소 설정", () => {
  it("쪽넘김은 GET page — 2쪽 요청이 1쪽과 다르다", () => {
    expect(kritConfig.list.url(1)).toBe(
      "https://www.krit.re.kr/krit/bbs/notice_list.do?gotoMenuNo=05010000&page=1",
    );
    expect(kritConfig.list.url(2)).toBe(
      "https://www.krit.re.kr/krit/bbs/notice_list.do?gotoMenuNo=05010000&page=2",
    );
    expect(kritConfig.list.maxPages).toBe(5);
  });

  it("지역은 전국", () => {
    expect(kritConfig.region).toBe("전국");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kritConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});

/**
 * ★상세 조달 — 함정이 두 겹이라 시험으로 못 박는다(2026-09-02 실측).
 * 고정본: `notice_view.do?bbsId=notice&nttId=6484` + 목록 Referer (57,513바이트).
 */
describe("상세 조달 — Referer 를 붙여 본문 표만 잘라 온다", () => {
  const detailHtml = readFileSync(join(__dirname, "../__fixtures__/krit-detail.html"), "utf-8");

  it("Referer 헤더를 붙여 GET 으로 부른다 — 없으면 빈 표가 온다", async () => {
    const calls: Array<{ url: string; init?: { method: string; headers?: Record<string, string> } }> = [];
    await kritConfig.detailFetch!("https://www.krit.re.kr/krit/bbs/notice_view.do?bbsId=notice&nttId=6484", async (url, init) => {
      calls.push({ url, init: init as never });
      return detailHtml;
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.headers?.Referer).toContain("notice_list.do");
  });

  it("본문 표(div.tbTypeView)만 돌려준다 — 제목·내용·첨부가 그 안에 들어 있다", async () => {
    const html = await kritConfig.detailFetch!("x", async () => detailHtml);
    expect(html).toContain("tbTypeView");
    // 「이전글/다음글」 표는 두 번째 tbTypeView 라 안 들어와야 한다.
    expect(html).not.toContain("이전글이 없습니다");
    const text = parseHtml(html).text.replace(/\s+/g, " ");
    expect(text).toContain("방산전시회 참가 지원사업");
    expect(text).toContain("국제경쟁력강화 지원사업 운영규정");
    expect(html).toContain("/common/download.do?atchFileId=");
  });

  it("★껍데기(빈 표)가 오면 본문도 첨부도 없다 — 「바이트가 늘었으니 됐다」로 속지 않게", async () => {
    // 인자 이름을 틀리면 실제로 이 모양이 온다. 표 골격은 있는데 칸이 비어 있다.
    const shell = '<div class="tbTypeView"><table><tbody><tr><th>제목</th><td></td></tr></tbody></table></div>';
    const html = await kritConfig.detailFetch!("x", async () => shell);
    expect(parseHtml(html).text.replace(/\s+/g, "")).toBe("제목");
    expect(html).not.toContain("download.do");
  });

  it("본문 표가 아예 없으면 빈 문자열 — 메뉴·바닥글을 자격조건으로 넘기지 않는다", async () => {
    expect(await kritConfig.detailFetch!("x", async () => "<html><body><div id='footer'>바닥글</div></body></html>")).toBe("");
  });
});
