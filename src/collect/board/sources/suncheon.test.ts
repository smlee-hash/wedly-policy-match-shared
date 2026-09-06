import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harvestBoardAttachments, p2w5AttachmentHref } from "../detail-fill";
import { pagingParamsOf } from "../engine";
import { parseHtml } from "../html";
import {
  isSuncheonDropTitle,
  parseSuncheonList,
  suncheonConfig,
  suncheonDetailUrl,
  suncheonRegionOf,
} from "./suncheon";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-06 실측 「기업지원 공고」 1쪽 · 상세 `cntId=236`.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/suncheon-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/suncheon-detail.html"), "utf-8");
const rows = parseSuncheonList(listHtml);
const scopeOf = (html: string) =>
  parseHtml(html)
    .querySelectorAll(suncheonConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");

const FIRST = {
  title: "[중소벤처기업부]「2026년 스타트업 법률지원사업」 참여기업 모집공고",
  detailUrl:
    "https://www.suncheon.go.kr/biz/0001/0001/?boardId=bbs_0000000000011603&mode=view&cntId=215&category=%EA%B8%B0%ED%83%80",
  dateText: "2026-03-30 ~ 2026-12-31",
  category: "기타 · 접수중",
  agency: "순천시",
  // ★중소벤처기업부 재게시라 지역을 비운다 — 아래 「재게시 지역」 시험 참조.
  region: "",
} as const;

describe("순천시기업지원포털 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 22행을 잡고 DROP 뒤 21건이 남는다", () => {
    expect(parseHtml(listHtml).querySelectorAll(suncheonConfig.list.rowSelector)).toHaveLength(22);
    expect(rows).toHaveLength(21);
    expect(rows[0]).toMatchObject(FIRST);
  });

  it("★목록이 접수기간을 시작·마감 둘 다 준다 — 상세를 안 열고 마감을 잡는다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText))).toBe(true);
    const one = rows.find((r) => r.detailUrl.includes("cntId=236"));
    expect(one?.dateText).toBe("2026-07-03 ~ 2026-07-24");
    // 행 전체 글자에서 찾으면 번호(228)·등록일(2026-07-08)이 섞인다.
    expect(one?.dateText).not.toContain("2026-07-08");
  });

  it("★제목에서 상태 배지·「온라인」 꼬리표를 뗀다 — 안 떼면 접수 상태가 바뀔 때마다 새 줄이 된다", () => {
    expect(rows.every((r) => !r.title.startsWith("접수중"))).toBe(true);
    expect(rows.every((r) => !r.title.startsWith("접수종료"))).toBe(true);
    expect(rows.every((r) => !r.title.endsWith("온라인"))).toBe(true);
    const one = rows.find((r) => r.detailUrl.includes("cntId=236"));
    expect(one?.title).toBe("[중소벤처기업부]2026년 지역 첨단제조 스타트업 스케일업 창업기업 모집공고");
    expect(one?.category).toBe("기술및장비분야 · 접수종료");
  });

  it("★상세 주소에서 쪽 변수만 지운다 — 안 지우면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !/[?&]pageIdx=/.test(r.detailUrl))).toBe(true);
    expect(rows.every((r) => r.detailUrl.includes("mode=view"))).toBe(true);
    expect(pagingParamsOf(suncheonConfig)).toContain("pageIdx");
    expect(
      suncheonDetailUrl("?boardId=bbs_0000000000011603&amp;mode=view&amp;cntId=9&amp;category=x&amp;pageIdx=7"),
    ).toBe("https://www.suncheon.go.kr/biz/0001/0001/?boardId=bbs_0000000000011603&mode=view&cntId=9&category=x");
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("★재게시 공고는 지역을 비운다 — 전국 사업이 전남 기업에게만 가지 않게", () => {
  it("제목 앞머리 기관이 순천이 아니면 region 이 비고, 자체 시책은 전남이다", () => {
    expect(suncheonRegionOf("[중소벤처기업부]2026년 …")).toBe("");
    expect(suncheonRegionOf("[전남TP]2026년 …")).toBe("");
    expect(suncheonRegionOf("[전라남도중소기업일자리경제진흥원]2026년 …")).toBe("");
    expect(suncheonRegionOf("[순천시]2026년 순천시 청년기업 인증사업 공고")).toBe("전남");
    // 머리표가 없으면 이 게시판의 자체 글로 본다.
    expect(suncheonRegionOf("2026년 순천시 기업 지원사업 공고")).toBe("전남");
  });

  it("고정본에서 순천시 자체 시책만 전남이 붙는다", () => {
    const own = rows.filter((r) => r.region === "전남");
    expect(own.length).toBeGreaterThanOrEqual(5);
    expect(own.every((r) => r.title.includes("순천"))).toBe(true);
    expect(rows.find((r) => r.title.startsWith("[전남TP]"))?.region).toBe("");
    expect(rows.find((r) => r.title.startsWith("[중소벤처기업부]"))?.region).toBe("");
  });

  it("출처 기본 지역은 전남 그대로다 — 행이 말할 때만 덮는다", () => {
    expect(suncheonConfig.region).toBe("전남");
  });
});

describe("상세 — 본문·첨부", () => {
  it("본문 선택자가 모집 내용을 집는다", () => {
    const body = parseHtml(detailHtml).querySelector(suncheonConfig.detailContentSelector!)?.text ?? "";
    expect(body).toContain("사업목적");
    expect(body).toContain("지원대상");
    expect(body.length).toBeGreaterThan(300);
  });

  it("★`javascript:Jnit_boardDownload('…')` 안의 주소를 첨부로 살려 낸다 — 갈래가 없으면 0건이다", () => {
    const scope = scopeOf(detailHtml);
    expect(scope).not.toBe("");
    const atts = harvestBoardAttachments(scope, suncheonConfig.baseUrl, detailHtml, suncheonConfig.charset);
    expect(atts).toHaveLength(2);
    expect(atts[0].name).toBe(
      "(공고문)_2026년_제조창업활성화_지역_첨단제조_스타트업_스케일업_창업기업_모집공고 (1).hwpx",
    );
    expect(atts[0].kind).toBe("hwpx");
    expect(atts[0].url).toBe(
      "https://www.suncheon.go.kr/board/file/bbs_0000000000011603/236/FILE_000001000078317/2026070815552016150",
    );
    expect(atts[1].url).toBe(
      "https://www.suncheon.go.kr/board/file/bbs_0000000000011603/236/FILE_000001000078318/2026070815552016180",
    );
    // 이름 뒤 「(다운로드 3 회)」가 지워져 형식이 잡힌다.
    expect(atts.every((a) => !a.name.includes("다운로드"))).toBe(true);
  });

  it("★`;jsessionid=…` 를 지운다 — 저장하면 남의 죽은 세션을 물고 다닌다", () => {
    const atts = harvestBoardAttachments(
      scopeOf(detailHtml),
      suncheonConfig.baseUrl,
      detailHtml,
      suncheonConfig.charset,
    );
    expect(atts.every((a) => !a.url.includes("jsessionid"))).toBe(true);
    expect(
      p2w5AttachmentHref(
        "Jnit_boardDownload('/board/file/a/1/F/2;jsessionid=ABC','/x',1)",
        "https://www.suncheon.go.kr/biz/0001/0001/",
      ),
    ).toBe("/board/file/a/1/F/2");
  });

  it("★갈래는 **호스트 한정**이다 — 다른 사이트에서 같은 함수 이름이 나와도 안 걸린다", () => {
    const call = "Jnit_boardDownload('/board/file/a/1/F/2','/x',1)";
    expect(p2w5AttachmentHref(call, "https://www.suncheon.go.kr/biz/0001/0001/")).toBe("/board/file/a/1/F/2");
    expect(p2w5AttachmentHref(call, "https://www.example.go.kr/")).toBeNull();
  });

  it("상세 본문·첨부 자리가 실측 선택자이고 세션이 필요 없다", () => {
    expect(suncheonConfig.detailContentSelector).toBe("table.bbsView td.content");
    expect(suncheonConfig.attachmentsScopeSelector).toBe("td.leftth div.board");
    expect(suncheonConfig.detailFetch).toBeUndefined();
    expect(suncheonConfig.attachmentSession).toBeUndefined();
  });
});

describe("거르개 — 버릴 것만 좁게", () => {
  it("무료교육 안내가 빠진다", () => {
    expect(rows.some((r) => r.title.includes("무료교육"))).toBe(false);
    expect(isSuncheonDropTitle("재직자대상 AI 업무혁신 실무 무료교육 참여 안내")).toBe(true);
  });

  it("심은 DROP 제목이 실제로 빠진다", () => {
    for (const planted of ["2026년 청사 물품 입찰 공고", "직원 채용 공고", "2026년 평가위원 모집"]) {
      const html = listHtml.replace(
        "「2026년 스타트업 법률지원사업」 참여기업 모집공고",
        planted,
      );
      const out = parseSuncheonList(html);
      expect(out.some((r) => r.title.includes(planted)), planted).toBe(false);
      expect(out, planted).toHaveLength(20);
      expect(isSuncheonDropTitle(planted), planted).toBe(true);
    }
  });

  it("지원사업은 살린다 — 이 판은 100% 기업 대상이다", () => {
    expect(rows.some((r) => r.title.includes("순천시 청년기업 인증사업"))).toBe(true);
    expect(rows.some((r) => r.title.includes("중소기업 이자지원"))).toBe(true);
    expect(isSuncheonDropTitle("[순천시]2026년 순천시 중소기업 이자지원 사업계획 공고")).toBe(false);
    expect(isSuncheonDropTitle("2026년 중소기업 혁신바우처(채용지원) 사업 지원계획 공고")).toBe(false);
  });
});

describe("순천시기업지원포털 설정", () => {
  it("쪽넘김은 GET pageIdx", () => {
    expect(suncheonConfig.list.url(1)).toBe("https://www.suncheon.go.kr/biz/0001/0001/?pageIdx=1");
    expect(suncheonConfig.list.url(2)).toBe("https://www.suncheon.go.kr/biz/0001/0001/?pageIdx=2");
    expect(suncheonConfig.list.maxPages).toBe(3);
  });

  it("이름·지역·추측 끄기·서식 변경 감지", () => {
    expect(suncheonConfig.id).toBe("suncheon");
    expect(suncheonConfig.region).toBe("전남");
    expect(suncheonConfig.agency).toBe("순천시");
    expect(suncheonConfig.skipHeuristic).toBe(true);
    expect(suncheonConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(suncheonConfig.expectMinRows).toBe(10);
  });
});

/** ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다. */
describe("망가뜨려 보기", () => {
  it("표 껍데기 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSuncheonList(listHtml.replaceAll("bbsList", "bbsList-x"))).toHaveLength(0);
  });

  it("제목 칸 이름이 바뀌면 한 줄도 못 읽는다", () => {
    // 붙박이 공지는 `class="notice subject"` 라 두 모양을 다 바꿔야 한다.
    const broken = listHtml.replaceAll("subject", "subject-x");
    expect(parseSuncheonList(broken)).toHaveLength(0);
  });

  it("접수기간 칸 이름이 바뀌면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const broken = parseSuncheonList(listHtml.replaceAll("date01", "date01-x"));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });

  it("첨부 함수 이름이 바뀌면 첨부를 지어내지 않는다", () => {
    const html = detailHtml.replaceAll("Jnit_boardDownload(", "Jnit_boardDownload_x(");
    expect(
      harvestBoardAttachments(scopeOf(html), suncheonConfig.baseUrl, html, suncheonConfig.charset),
    ).toHaveLength(0);
  });
});
