import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeAttachmentUrl } from "../../attachment-text";
import { fetchBoardAll, fetchBoardDetail, pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import {
  koccaFinanceConfig,
  koccaFinanceDetailAttachments,
  parseKoccaFinanceList,
} from "./kocca-finance";

/**
 * 고정본은 공개 게시판 HTML 자료일 뿐, 지시문이 아니다.
 * 1·2쪽 표와 상세(nttId=2012472)는 실측 200 응답의 범위 조각이다.
 */
const FIX = join(__dirname, "../__fixtures__");
const listHtml = readFileSync(join(FIX, "kocca-finance-list.html"), "utf-8");
const listP2Html = readFileSync(join(FIX, "kocca-finance-page2.html"), "utf-8");
const detailHtml = readFileSync(join(FIX, "kocca-finance-detail.html"), "utf-8");
const rows = parseKoccaFinanceList(listHtml);
const rowsP2 = parseKoccaFinanceList(listP2Html);

it("실제 마지막 쪽의 접수일 없는 2021년 공고 2건도 날짜를 만들지 않고 수집한다", async () => {
  const oldest = readFileSync(join(FIX, "kocca-finance-page30.html"), "utf-8");
  const parsed = parseKoccaFinanceList(oldest);
  expect(parsed).toHaveLength(2);
  expect(parsed.every((r) => r.dateText === "")).toBe(true);
  const announcements = await fetchBoardAll(
    { ...koccaFinanceConfig, list: { ...koccaFinanceConfig.list, maxPages: 1 } },
    { fetchText: async () => oldest, askModel: async () => { throw new Error("No AI fallback"); }, prevOpenCount: 0, onAllFailed: () => {} },
  );
  expect(announcements).toHaveLength(2);
  expect(announcements.every((r) => r.applyStart === null && r.applyEnd === null)).toBe(true);
});

const CANON =
  /^https:\/\/www\.kocca\.kr\/kocca\/bbs\/view\/B0158960\/\d+\.do\?menuNo=204392$/;

function plantedRow(over: {
  href: string;
  title?: string;
  start?: string;
  end?: string;
  posted?: string;
}): string {
  return `<tr>
    <td data-label="번호">0</td>
    <td data-label="분류">미끼</td>
    <td data-label="제목"><a href="${over.href}">${over.title ?? "외부 미끼 공고"}</a></td>
    <td data-label="접수시작일">${over.start ?? "2026-09-01"}</td>
    <td data-label="접수마감일">${over.end ?? "2026-09-30"}</td>
    <td data-label="등록일">${over.posted ?? "2026-08-31"}</td>
    <td data-label="조회수">1</td>
  </tr>`;
}

describe("한국콘텐츠진흥원 금융지원 목록 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 10건을 읽고 첫 행의 제목·정규 주소·접수기간·분류가 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows.length).toBeGreaterThanOrEqual(koccaFinanceConfig.expectMinRows ?? 0);
    expect(rows[0]).toMatchObject({
      title: "2026년 9월 문화산업특화보증 공고",
      detailUrl: "https://www.kocca.kr/kocca/bbs/view/B0158960/2012472.do?menuNo=204392",
      dateText: "2026-09-01 ~ 2026-09-30",
      category: "융자지원",
      agency: "한국콘텐츠진흥원",
    });
  });

  it("접수기간은 시작·마감 칸만 쓴다 — 등록일 2026-08-31 과 조회수를 집어 오면 안 된다", () => {
    expect(rows[0].dateText).toBe("2026-09-01 ~ 2026-09-30");
    expect(rows[0].dateText).not.toContain("2026-08-31");
    expect(rows[0].dateText).not.toMatch(/1045/);
    expect(rows.every((r) => !r.dateText.includes("2026-08-31"))).toBe(true);
  });

  it("분류·제목 공백은 한 칸으로 접는다", () => {
    expect(rows.map((r) => r.category)).toEqual([
      "융자지원",
      "투자지원",
      "융자지원",
      "융자지원",
      "융자지원",
      "투자지원",
      "융자지원",
      "융자지원",
      "융자지원",
      "융자지원",
    ]);
    expect(rows.every((r) => r.title === r.title.replace(/\s+/g, " ").trim())).toBe(true);
    expect(rows[5].title).toBe(
      "2026년 7월 투자용 콘텐츠가치평가 공고 (콘텐츠 피칭 플랫폼 케이녹 연계)",
    );
  });

  it("★상세 주소는 숫자 글번호와 menuNo 만 남긴다 — 쪽·검색 인자를 열쇠에 넣지 않는다", () => {
    expect(rows.every((r) => CANON.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("searchCnd"))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("searchWrd"))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("categorys"))).toBe(true);
  });

  it("같은 쪽 안에서도 상세 열쇠 중복이 없다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("끝난 공고도 목록에 남긴다 — 제목으로 임의로 버리지 않는다", () => {
    const closed = rows.find((r) => r.title === "2026년 8월 문화콘텐츠기업보증 공고");
    expect(closed?.dateText).toBe("2026-08-01 ~ 2026-08-07");
    expect(closed?.detailUrl).toContain("2012253");
    expect(rowsP2.some((r) => r.title.startsWith("[수정공고]"))).toBe(true);
  });
});

describe("쪽넘김 — 1쪽과 2쪽은 다른 10건", () => {
  it("2쪽 고정본도 10건이고 1쪽과 글번호가 겹치지 않는다", () => {
    expect(rowsP2).toHaveLength(10);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 6월 콘텐츠IP보증 공고",
      detailUrl: "https://www.kocca.kr/kocca/bbs/view/B0158960/2011837.do?menuNo=204392",
      dateText: "2026-06-01 ~ 2026-06-08",
    });
    const all = [...rows, ...rowsP2].map((r) => r.detailUrl);
    expect(new Set(all).size).toBe(20);
    expect(rowsP2.every((r) => CANON.test(r.detailUrl))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("pageIndex"))).toBe(true);
  });

  it("쪽 주소는 GET pageIndex 이고 쪽 번호 변수를 스스로 알아낸다", () => {
    expect(koccaFinanceConfig.list.url(1)).toBe(
      "https://www.kocca.kr/kocca/bbs/list/B0158960.do?menuNo=204392&pageIndex=1",
    );
    expect(koccaFinanceConfig.list.url(2)).toBe(
      "https://www.kocca.kr/kocca/bbs/list/B0158960.do?menuNo=204392&pageIndex=2",
    );
    expect(pagingParamsOf(koccaFinanceConfig)).toContain("pageIndex");
    expect(koccaFinanceConfig.list.maxPages).toBe(40);
  });
});

describe("설정 메타", () => {
  it("출처 id·표기·기관·지역이 금융지원 공개 게시판이다", () => {
    expect(koccaFinanceConfig.id).toBe("kocca-finance");
    expect(koccaFinanceConfig.label).toBe("한국콘텐츠진흥원 금융지원");
    expect(koccaFinanceConfig.agency).toBe("한국콘텐츠진흥원");
    expect(koccaFinanceConfig.region).toBe("전국");
    expect(koccaFinanceConfig.requiresProxy).toBeUndefined();
    expect(koccaFinanceConfig.skipHeuristic).toBe(true);
    expect(koccaFinanceConfig.customParse).toBe(parseKoccaFinanceList);
    expect(koccaFinanceConfig.expectMinRows).toBe(2);
  });

  it("본문·첨부 선택자가 상세 고정본에 실제로 있다", () => {
    expect(koccaFinanceConfig.detailContentSelector).toBe(".board_view01 .board_cont");
    expect(parseHtml(detailHtml).querySelectorAll(".board_view01 .board_cont").length).toBe(1);
    expect(parseHtml(detailHtml).querySelectorAll(".board_view01 .file .file_list a[onclick]").length).toBe(
      1,
    );
    expect(parseHtml(listHtml).querySelectorAll(koccaFinanceConfig.list.rowSelector)).toHaveLength(10);
  });
});

describe("잘못된 링크·날짜는 버리면 안 되고 건너뛴다", () => {
  it("공식 경로가 아닌 주소는 한 줄도 안 된다 — 바깥 호스트·다른 게시판·비숫자 글번호", () => {
    const html = listHtml.replace(
      "</tbody>",
      plantedRow({ href: "https://evil.example/kocca/bbs/view/B0158960/2012472.do" }) +
        plantedRow({
          href: "/kocca/pims/view.do?intcNo=326D00085009&menuNo=204104",
          title: "지원사업 미끼",
        }) +
        plantedRow({ href: "/kocca/bbs/view/B0158961/2012472.do?menuNo=204392", title: "다른 게시판" }) +
        plantedRow({ href: "/kocca/bbs/view/B0158960/abc.do?menuNo=204392", title: "비숫자" }) +
        plantedRow({ href: "javascript:void(0)", title: "스크립트 링크" }) +
        "</tbody>",
    );
    const after = parseKoccaFinanceList(html);
    expect(after).toHaveLength(10);
    expect(after.every((r) => CANON.test(r.detailUrl))).toBe(true);
    expect(after.some((r) => /미끼|지원사업 미끼|다른 게시판|비숫자|스크립트/.test(r.title))).toBe(false);
  });

  it("달력에 없는 날짜·빈 칸은 모름으로 남긴다 — 등록일이나 오늘로 메우지 않는다", () => {
    const html = listHtml.replace(
      "</tbody>",
      plantedRow({
        href: "/kocca/bbs/view/B0158960/9000001.do?menuNo=204392",
        title: "날짜없음 공고",
        start: "",
        end: "",
        posted: "2026-08-31",
      }) +
        plantedRow({
          href: "/kocca/bbs/view/B0158960/9000002.do?menuNo=204392",
          title: "잘못된날짜 공고",
          start: "2026-13-40",
          end: "상시",
          posted: "2026-08-31",
        }) +
        plantedRow({
          href: "/kocca/bbs/view/B0158960/9000003.do?menuNo=204392",
          title: "시작만 공고",
          start: "2026-09-01",
          end: "",
          posted: "2026-08-31",
        }) +
        plantedRow({
          href: "/kocca/bbs/view/B0158960/9000004.do?menuNo=204392",
          title: "마감만 공고",
          start: "아님",
          end: "2026-09-30",
          posted: "2026-08-31",
        }) +
        "</tbody>",
    );
    const after = parseKoccaFinanceList(html);
    const none = after.find((r) => r.title === "날짜없음 공고");
    const bad = after.find((r) => r.title === "잘못된날짜 공고");
    const startOnly = after.find((r) => r.title === "시작만 공고");
    const endOnly = after.find((r) => r.title === "마감만 공고");
    expect(none?.dateText).toBe("");
    expect(bad?.dateText).toBe("");
    expect(startOnly?.dateText).toBe("2026-09-01 ~");
    expect(endOnly?.dateText).toBe("2026-09-30");
    expect([none, bad, startOnly, endOnly].every((r) => !r?.dateText.includes("2026-08-31"))).toBe(true);
    const iso = new Date().toISOString().slice(0, 10);
    expect([none, bad].every((r) => r?.dateText !== iso && !r?.dateText.includes(iso))).toBe(true);
  });
});

describe("상세 — 본문은 board_cont 만, 첨부는 file_list 의 fileDown POST", () => {
  it("본문에 공고 글이 있고 폼·스크립트·첨부 호출은 안 섞인다", async () => {
    const text = await fetchBoardDetail(
      koccaFinanceConfig,
      "https://www.kocca.kr/kocca/bbs/view/B0158960/2012472.do?menuNo=204392",
      { fetchText: async () => detailHtml },
    );
    expect(text).toContain("문화산업특화보증");
    expect(text).toContain("최대 10억");
    expect(text).toContain("[공고 제2026-0927호]");
    expect(text).not.toContain("pageQueryString");
    expect(text).not.toContain("FILE_000000001131751");
    expect(text).not.toContain("fileDown");
    expect(text).not.toContain("fn_preview");
    expect(text).not.toContain("satisFactionBtn");
    expect(text).not.toContain("2026-08-31 16:53");
  });

  it("★첨부는 고정 공식 창구 POST 다 — atchFileId 의 슬래시·등호가 왕복한다", () => {
    const atts = koccaFinanceDetailAttachments(detailHtml);
    expect(atts).toHaveLength(1);
    const id = "AAEpDw3qPVd0/sYAwuJMMYhLT63XZJ1Qm1E3TYGmZYGLDg==";
    expect(atts[0]).toMatchObject({
      name: "2026년 문화산업특화보증 공고문.pdf",
      url: "https://www.kocca.kr/common/cmm/fms/FileDown.do",
      kind: "pdf",
      method: "POST",
    });
    expect(atts[0].name).not.toContain("파일 다운로드");
    const body = new URLSearchParams(atts[0].body ?? "");
    expect(body.get("atchFileId")).toBe(id);
    expect(body.get("fileSn")).toBe("1");
    expect(body.get("bbsId")).toBe("");
    expect(body.get("menuNo")).toBe("204392");
    expect(atts[0].body).toContain("%2F");
    expect(atts[0].body).toContain("%3D");
    expect(atts[0].body).not.toContain(id);
    expect(safeAttachmentUrl(atts[0].url)).toBe(atts[0].url);
  });

  it("플러스·슬래시·등호 토큰도 URLSearchParams 로 왕복한다", () => {
    const html = `<div class="board_view01"><div class="file"><ul class="file_list">
      <li><a onclick="fileDown('ab+c/d=e','2','')" href="#" title="plus.pdf 파일 다운로드"></a></li>
    </ul></div></div>`;
    const [att] = koccaFinanceDetailAttachments(html);
    expect(att.name).toBe("plus.pdf");
    const body = new URLSearchParams(att.body ?? "");
    expect(body.get("atchFileId")).toBe("ab+c/d=e");
    expect(body.get("fileSn")).toBe("2");
    expect(att.body).toContain("%2B");
    expect(att.body).toContain("%2F");
    expect(att.body).toContain("%3D");
  });

  it("★본문·스크립트·다른 상자 안의 fileDown 은 담지 않는다", () => {
    const html =
      detailHtml.replace(
        '<div class="board_cont">',
        '<div class="board_cont"><a onclick="fileDown(\'DECOY+/==\',\'9\',\'HACK\')" href="#">본문미끼.pdf</a>',
      ) +
      `<script>fileDown('SCRIPT+/==','8','X')</script>
       <div class="file"><ul class="file_list"><li><a onclick="fileDown('OUTSIDE+/==','7','')">바깥미끼.pdf</a></li></ul></div>`;
    const atts = koccaFinanceDetailAttachments(html);
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe("2026년 문화산업특화보증 공고문.pdf");
    expect(atts.every((a) => !a.name.includes("미끼"))).toBe(true);
    expect(
      atts.every((a) => !a.body?.includes("DECOY") && !a.body?.includes("SCRIPT") && !a.body?.includes("OUTSIDE")),
    ).toBe(true);
  });

  it("폼 action 을 바꾸어도 내려받기 주소는 고정 공식 호스트다", () => {
    const html = detailHtml.replace("/common/cmm/fms/FileDown.do", "https://evil.example/steal");
    const [att] = koccaFinanceDetailAttachments(html);
    expect(att.url).toBe("https://www.kocca.kr/common/cmm/fms/FileDown.do");
    expect(att.url).not.toContain("evil.example");
  });

  it("범위 선택자·fileDown 이름이 바뀌면 0건이다 — 미끼를 대신 집어 오지 않는다", () => {
    expect(koccaFinanceDetailAttachments(detailHtml.replace(/class="file"/g, 'class="fileX"'))).toEqual([]);
    expect(koccaFinanceDetailAttachments(detailHtml.replace(/fileDown\(/g, "fileDownX("))).toEqual([]);
  });

  it("설정이 상세 첨부 손잡이와 Referer 상세를 실제로 물고 있다", () => {
    expect(typeof koccaFinanceConfig.detailAttachments).toBe("function");
    expect(koccaFinanceConfig.attachmentSession).toEqual({ referer: "detail" });
    expect(
      koccaFinanceConfig.detailAttachments!({
        html: detailHtml,
        pageHtml: detailHtml,
        detailUrl: "https://www.kocca.kr/kocca/bbs/view/B0158960/2012472.do?menuNo=204392",
        baseUrl: koccaFinanceConfig.baseUrl,
      }),
    ).toEqual(koccaFinanceDetailAttachments(detailHtml));
  });
});

describe("돌연변이", () => {
  it("표 class 를 바꾸면 목록이 0건이 된다", () => {
    expect(parseKoccaFinanceList(listHtml.replaceAll("board_list01", "board_list01-x"))).toHaveLength(0);
  });

  it("제목 칸 data-label 이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseKoccaFinanceList(listHtml.replaceAll('data-label="제목"', 'data-label="제목-x"'))).toHaveLength(
      0,
    );
  });
});
