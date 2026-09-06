import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { harvestBoardAttachments } from "../detail-fill";
import { isKfmeDropTitle, kfmeConfig, parseKfmeList } from "./kfme";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본(2026-09-06 실측): 사업공지 1·2쪽(`notice.php?cate=1&startPage=0|10` — 쪽마다 고정 8행 +
 * 일반 10행) · 상세 1건(`idx=5267` — 첨부 2건).
 */
const list = readFileSync(join(__dirname, "../__fixtures__/kfme-list.html"), "utf-8");
const listP2 = readFileSync(join(__dirname, "../__fixtures__/kfme-list-p2.html"), "utf-8");
const detail = readFileSync(join(__dirname, "../__fixtures__/kfme-detail.html"), "utf-8");
const rows = parseKfmeList(list);
const rowsP2 = parseKfmeList(listP2);

describe("소상공인연합회 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 18행에서 DROP 뒤 8건이 남고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      // 고정 공지 딱지(span.notice-tit 「공지사항」)를 뗀 제목이어야 한다.
      title: "2026 소상공인대회 부스운영 참가업체 2차 모집 공고",
      detailUrl: "https://www.kfme.or.kr/kr/board/notice.php?bgu=view&idx=5310&cate=1",
      dateText: "2026-09-03 ~",
      agency: "소상공인연합회",
    });
  });

  it("★고정 공지 제목에서 「공지사항」 딱지를 뗀다 — 안 떼면 dedupKey 가 갈린다", () => {
    expect(rows.every((r) => !r.title.startsWith("공지사항"))).toBe(true);
    expect(rows.map((r) => r.title)).toContain("2026년 소상공인 무료 법률·세무·노무 간편상담 지원사업 안내");
  });

  it("등록일은 data-label 칸에서 집고, 고정 공지도 제 등록일을 그대로 낸다", () => {
    expect(rows.every((x) => /^20\d{2}-\d{2}-\d{2} ~$/.test(x.dateText))).toBe(true);
    // 2022년 고정 공지도 날짜를 비우지 않는다 — 비우면 게시판 전체의 날짜 검증을 못 켠다(sida 와 같은 판정).
    const old = rows.find((r) => r.detailUrl.includes("idx=3276"));
    expect(old?.dateText).toBe("2022-09-26 ~");
  });

  it("상세 주소는 목록 href 를 절대화한 것이고 쪽 offset 이 안 섞인다", () => {
    for (const r of rows) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.kfme\.or\.kr\/kr\/board\/notice\.php\?bgu=view&idx=\d+&cate=1$/,
      );
      expect(r.detailUrl).not.toMatch(/startPage/);
    }
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("★이벤트·포상·공모전·용역·사람 모집을 버린다 — 실측 제목으로 확인", () => {
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.includes("이벤트"))).toBe(false);
    expect(titles.some((t) => t.includes("공모전"))).toBe(false);
    expect(isKfmeDropTitle("오늘은 Sun한 Day! ☀️ 이벤트 안내")).toBe(true);
    expect(isKfmeDropTitle("2026 대한민국 소상공인대회 정부포상 추천 후보자 공개검증 안내")).toBe(true);
    expect(isKfmeDropTitle("「2026 대한민국 소상공인대회」 슬로건 공모전 수상작 발표 (정정)")).toBe(true);
    expect(
      isKfmeDropTitle("「2026년 소상공인연합회 조직 역량강화 온·오프라인 교육 기획·운영 용역」 용역업체 선정결과"),
    ).toBe(true);
    expect(isKfmeDropTitle("「2026년 찾아가는 1:1 교육사업」 신규(전문직) 컨설턴트 모집 공고")).toBe(true);
    expect(isKfmeDropTitle("2026년 소공인 스마트제조지원 (스마트공방) 사업 코디네이터 양성과정 안내")).toBe(true);
    expect(isKfmeDropTitle("[입찰공고]2026년 소상공인연합회 조직 역량강화 온·오프라인 교육 기획·운영 용역(긴급)")).toBe(
      true,
    );
    expect(isKfmeDropTitle("소상공인연합회 제5기 공석지역 기초지역회장 모집 공고(상시)")).toBe(true);
  });

  it("★2쪽 고정본 — 고정 공지 4건은 1쪽과 같은 주소로 접히고 새 행 3건만 는다", () => {
    expect(rowsP2).toHaveLength(7);
    const p1 = new Set(rows.map((r) => r.detailUrl));
    const shared = rowsP2.filter((r) => p1.has(r.detailUrl));
    const fresh = rowsP2.filter((r) => !p1.has(r.detailUrl));
    // 고정 공지는 쪽마다 되풀이된다 — 주소가 같아야 엔진이 「신규 0」으로 오해하지 않고 접는다.
    expect(shared).toHaveLength(4);
    expect(fresh).toHaveLength(3);
    expect(fresh.map((r) => r.title)).toEqual([
      "[세이브더칠드런] <영세소상공인 가정의 에너지 생활 지원사업> 안내",
      "『2026 소상공인 배리어프리 키오스크 지원사업』신청접수 안내",
      "『2026 소상공인·자영업자 건강검진 지원사업』신청접수 안내",
    ]);
  });

  it("★2쪽 실측 제목으로 거르개를 다시 잰다", () => {
    const t = rowsP2.map((r) => r.title);
    expect(t.some((x) => x.includes("입찰공고"))).toBe(false);
    expect(t.some((x) => x.includes("제재조치"))).toBe(false);
    expect(t.some((x) => x.includes("결의대회"))).toBe(false);
    expect(isKfmeDropTitle("[입찰공고]2026년 소상공인연합회 조직 역량강화 온·오프라인 교육 기획·운영 용역(긴급)")).toBe(true);
    expect(isKfmeDropTitle("2025년 소상공인 기능경진대회 시행단체 제재조치 안내")).toBe(true);
    expect(isKfmeDropTitle("생존권 사수와 고용 정책 대전환 범 소상공인 결의대회 안내")).toBe(true);
  });

  it("★소상공인 실지원 공고는 살린다 — 「모집」·「교육」을 낱말째 버리면 안 되는 자리", () => {
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("『2026 소상공인 새출발 경영환경개선 지원사업』 2차 모집 공고 (마감)");
    expect(titles).toContain("『2026 소상공인 배리어프리 키오스크 지원사업』신청접수 안내(연장)");
    expect(titles).toContain("2026년 찾아가는 1:1 교육사업 시행 공고");
    expect(isKfmeDropTitle("『2026 소상공인 새출발 경영환경개선 지원사업』 2차 모집 공고 (마감)")).toBe(false);
    expect(isKfmeDropTitle("2026년 찾아가는 1:1 교육사업 시행 공고")).toBe(false);
  });
});

describe("소상공인연합회 설정", () => {
  it("쪽넘김은 쪽 번호가 아니라 행 offset(startPage) 이다", () => {
    expect(kfmeConfig.list.url(1)).toBe("https://www.kfme.or.kr/kr/board/notice.php?cate=1&startPage=0");
    expect(kfmeConfig.list.url(2)).toBe("https://www.kfme.or.kr/kr/board/notice.php?cate=1&startPage=10");
    expect(kfmeConfig.list.url(3)).toContain("startPage=20");
    expect(kfmeConfig.list.maxPages).toBe(2);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(kfmeConfig.id).toBe("kfme");
    expect(kfmeConfig.label).toBe("소상공인연합회");
    expect(kfmeConfig.agency).toBe("소상공인연합회");
    expect(kfmeConfig.region).toBe("전국");
    expect(kfmeConfig.charset).toBe("utf-8");
    expect(kfmeConfig.skipHeuristic).toBe(true);
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(kfmeConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(kfmeConfig.expectMinRows!);
  });
});

describe("소상공인연합회 상세", () => {
  it("본문 선택자가 지원 대상이 든 안내문을 집는다", () => {
    const body = (parseHtml(detail).querySelector(kfmeConfig.detailContentSelector!)?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(body).toContain("「2026 소상공인 새출발 경영환경개선 지원사업」");
    expect(body).toContain("노후 간판 교체 및 안전 기준 개선");
    expect(body).toContain("지원 대상");
  });

  it("첨부 2건의 이름·주소를 집고 이전·다음 글 링크를 안 끌어온다", () => {
    const scoped = parseHtml(detail)
      .querySelectorAll(kfmeConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, kfmeConfig.baseUrl, detail);
    expect(atts.map((a) => a.name)).toEqual([
      "붙임. 사업참여 및 중복지원금지 확약서 양식.hwp",
      "2026 소상공인 새출발 경영환경개선 지원사업 2차 모집 공고 포스터.png",
    ]);
    expect(atts.map((a) => a.url)).toEqual([
      "https://www.kfme.or.kr/bbs/bbs_download.php?idx=5267&download=1",
      "https://www.kfme.or.kr/bbs/bbs_download.php?idx=5267&download=2",
    ]);
  });
});
