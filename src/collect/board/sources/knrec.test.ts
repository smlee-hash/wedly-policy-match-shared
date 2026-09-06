import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKnrecDropTitle, knrecConfig, parseKnrecList } from "./knrec";
import { harvestBoardAttachments } from "../detail-fill";
import { fetchBoardDetail } from "../engine";
import { safeAttachmentUrl } from "@/lib/policy-match/attachment-text";
import { parseHtml } from "../html";
import { upgradeTruncatedTitle } from "../title-upgrade";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-06 실측 사업공고 1·2쪽(`/biz/pds/businoti/list.do?page=1|2&`)과
 * 상세 1건(`view.do?no=7023`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/knrec-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/knrec-list-p2.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/knrec-detail.html"), "utf-8");
/** 목록 제목이 50자에서 잘린 줄의 상세(2026-09-06 실측 `view.do?no=6365`). */
const detailTruncHtml = readFileSync(join(__dirname, "../__fixtures__/knrec-detail-trunc.html"), "utf-8");
const rows = parseKnrecList(listHtml);
const rowsP2 = parseKnrecList(listP2Html);

describe("한국에너지공단 신·재생에너지센터 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 18행에서 고정 공지 중복 2 + DROP 5 를 뺀 11건을 읽고 첫 행 값이 맞다", () => {
    // 18행 = 상단 고정 「공지」 8 + 일반 10. 그중 no 7023·6884 는 두 자리에 겹쳐 있다.
    expect(rows).toHaveLength(11);
    expect(rows[0]).toMatchObject({
      title: "2026년도 9월 재생에너지종합서비스기업(ReSCO) 모집 공고 및 8월 등록 결과 안내",
      detailUrl: "https://www.knrec.or.kr/biz/pds/businoti/view.do?no=7023",
      // ★등록일 칸과 마감일 칸이 따로라 접수기간을 본문 추정 없이 얻는다.
      dateText: "2026-09-03 ~ 2026-10-07",
      category: "[공고] · 진행",
      agency: "한국에너지공단 신·재생에너지센터",
    });
  });

  it("★상단 고정 「공지」 8행이 매 쪽 반복돼도 한 쪽 안에서 no 로 접힌다", () => {
    // 같은 쪽에 두 번 나오는 no 7023·6884 가 결과에 한 번씩만 있어야 한다.
    expect(rows.filter((r) => r.detailUrl.endsWith("no=7023"))).toHaveLength(1);
    // 6884(KS인증 위탁기관 지정)는 DROP 이 버리므로 아예 0건이다.
    expect(rows.filter((r) => r.detailUrl.endsWith("no=6884"))).toHaveLength(0);
    const nos = rows.map((r) => r.detailUrl);
    expect(new Set(nos).size).toBe(nos.length);
    const nosP2 = rowsP2.map((r) => r.detailUrl);
    expect(new Set(nosP2).size).toBe(nosP2.length);
  });

  it("2쪽도 고정 공지 6건 + 새 일반 5건 = 11건이고, 겹치는 6건은 상세 주소가 1쪽과 같다", () => {
    expect(rowsP2).toHaveLength(11);
    // 쪽을 넘는 중복은 주소가 같아야 저장 단계가 한 줄로 접는다 — 쪽 번호가 섞이면 못 접힌다.
    const shared = rowsP2.filter((r) => rows.some((x) => x.detailUrl === r.detailUrl));
    expect(shared).toHaveLength(6);
    expect(rowsP2.some((r) => r.detailUrl.endsWith("no=6664"))).toBe(true); // 2쪽에만 있는 일반 행
  });

  it("등록일·마감일은 각자 칸에서만 집는다 — 행 전체 글자면 번호·조회수가 날짜에 붙는다", () => {
    expect(
      [...rows, ...rowsP2].every((r) => /^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/.test(r.dateText)),
    ).toBe(true);
    // 1쪽 첫 행의 번호는 「공지」·304, 조회수는 381 — 날짜 글자에 들어오면 안 된다.
    expect(rows[0].dateText).not.toMatch(/304|381/);
    const later = rows.find((r) => r.detailUrl.endsWith("no=6903"));
    expect(later?.dateText).toBe("2026-08-10 ~ 2026-08-14");
  });

  it("상세 주소는 ./view.do?no= 를 절대 주소로 바꾸고 쪽 번호가 안 섞인다", () => {
    for (const r of [...rows, ...rowsP2]) {
      expect(r.detailUrl).toMatch(/^https:\/\/www\.knrec\.or\.kr\/biz\/pds\/businoti\/view\.do\?no=\d+$/);
      expect(r.detailUrl).not.toMatch(/[?&]page=/);
    }
  });

  it("★거르개 — 입찰·제도 공고는 버리고 기업 지원사업은 지킨다", () => {
    const titles = [...rows, ...rowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("경쟁입찰"))).toBe(false);
    expect(titles.some((t) => t.includes("위탁기관 지정"))).toBe(false);
    expect(titles.some((t) => t.includes("REGO"))).toBe(false);
    expect(
      isKnrecDropTitle("(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입찰 공고"),
    ).toBe(true);
    expect(isKnrecDropTitle("중대형 풍력터빈 KS인증 위탁기관 지정 변경사항 공고")).toBe(true);
    expect(isKnrecDropTitle("재생에너지 자가설비 인증서(REGO) 발급ㆍ거래 시범사업 공고")).toBe(true);
    expect(isKnrecDropTitle("신·재생에너지센터 연구개발사업 위탁정산기관 선정 재공고 안내")).toBe(true);
    // 지킬 것: 기업이 받는 지원사업.
    expect(titles.some((t) => t.includes("재생에너지 금융지원사업"))).toBe(true);
    expect(isKnrecDropTitle("2026년도 재생에너지 금융지원사업 지원 변경 공고")).toBe(false);
    expect(isKnrecDropTitle("2026년 KS인증 제품심사 수수료지원 공고")).toBe(false);
  });

  it("「공모」·「모집」을 통째로 버리지 않는다 — ReSCO 모집·A/S 전담업체 공모가 지원 대상이다", () => {
    expect(isKnrecDropTitle("2026년 신재생에너지설비 A/S 전담업체 공모 및 신청 안내")).toBe(false);
    expect(
      isKnrecDropTitle("2026년도 9월 재생에너지종합서비스기업(ReSCO) 모집 공고 및 8월 등록 결과 안내"),
    ).toBe(false);
  });

  it("★돌연변이 — 행 선택자를 깨뜨리면 0건이 된다(서식 변경을 조용히 넘기지 않는다)", () => {
    const broken = listHtml.replace('<div class="table_list m_scroll on">', '<div class="table_list_XX">');
    expect(parseKnrecList(broken)).toHaveLength(0);
    expect(parseKnrecList(listHtml)).toHaveLength(11); // 원복
  });
});

describe("한국에너지공단 신·재생에너지센터 설정", () => {
  it("쪽넘김은 GET page — 1쪽과 2쪽 주소가 다르다", () => {
    expect(knrecConfig.list.url(1)).toBe("https://www.knrec.or.kr/biz/pds/businoti/list.do?page=1&");
    expect(knrecConfig.list.url(2)).toBe("https://www.knrec.or.kr/biz/pds/businoti/list.do?page=2&");
    expect(knrecConfig.list.maxPages).toBe(3);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(knrecConfig.id).toBe("knrec");
    expect(knrecConfig.label).toBe("한국에너지공단 신·재생에너지센터");
    expect(knrecConfig.agency).toBe("한국에너지공단 신·재생에너지센터");
    expect(knrecConfig.region).toBe("전국");
    expect(knrecConfig.charset).toBe("utf-8");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(knrecConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(knrecConfig.expectMinRows!);
  });

  it("추측 단계를 끈다 — 목록 첨부 칸의 file_down 링크가 공고로 저장된다", () => {
    expect(knrecConfig.skipHeuristic).toBe(true);
  });
});

describe("한국에너지공단 신·재생에너지센터 상세 — 실사이트 고정본", () => {
  it("본문은 p.notice_view_txt 에서 뽑고 신청대상·공모기간이 글자로 들어 있다", async () => {
    const text = await fetchBoardDetail(
      knrecConfig,
      "https://www.knrec.or.kr/biz/pds/businoti/view.do?no=7023",
      { fetchText: async () => detailHtml },
    );
    expect(text.startsWith("햇빛소득마을의 성공적 조성 및 활성화를 위하여")).toBe(true);
    expect(text).toContain("ㅇ신청대상 :");
    expect(text).toContain("ㅇ공모기간 : 2026. 9. 1.(화) ~ 9.15.(화)");
  });

  it("★첨부 4건을 javascript:file_down 인자로 조립한다(실호출 200 + HWP 123,904바이트)", () => {
    const scoped = parseHtml(detailHtml)
      .querySelectorAll(knrecConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, knrecConfig.baseUrl, detailHtml, knrecConfig.charset);
    expect(atts).toHaveLength(4);
    expect(atts[0].url).toBe(
      "https://www.knrec.or.kr/biz/file/File_down.do?no=7023&gubun=1&kinds=notice",
    );
    // 이름은 상세 링크 글자에서 온다 — 응답 헤더 파일명은 EUC-KR 이라 못 쓴다.
    // 링크 안 아이콘 글자(「한글파일」)가 앞에 붙어 오는 것이 사이트 원문 그대로다.
    expect(atts[0].name).toContain("[붙임1] 2026년도 9월 재생에너지종합서비스기업(ReSCO)모집공고.hwp");
    expect(atts[0].kind).toBe("hwp");
    expect(atts.map((a) => a.url)).toEqual([
      "https://www.knrec.or.kr/biz/file/File_down.do?no=7023&gubun=1&kinds=notice",
      "https://www.knrec.or.kr/biz/file/File_down.do?no=7023&gubun=2&kinds=notice",
      "https://www.knrec.or.kr/biz/file/File_down.do?no=7023&gubun=3&kinds=notice",
      "https://www.knrec.or.kr/biz/file/File_down.do?no=7023&gubun=4&kinds=notice",
    ]);
    for (const a of atts) expect(safeAttachmentUrl(a.url)).not.toBeNull();
  });

  it("★file_down 갈래는 이 사이트에서만 푼다 — 다른 게시판의 같은 이름 함수를 주소로 만들지 않는다", () => {
    const html = `<a href="javascript:file_down('7023','1','notice')">공고문.hwp</a>`;
    expect(harvestBoardAttachments(html, "https://www.knrec.or.kr/").map((a) => a.url)).toEqual([
      "https://www.knrec.or.kr/biz/file/File_down.do?no=7023&gubun=1&kinds=notice",
    ]);
    // 다른 호스트에서는 `javascript:` 의사링크라 아무것도 안 남는다.
    expect(harvestBoardAttachments(html, "https://www.example.or.kr/")).toEqual([]);
  });

  it("첨부 상자 선택자가 바뀌면 0건이 된다 — 서식 변경을 조용히 넘기지 않는다", () => {
    const broken = parseHtml(detailHtml.replaceAll('class="notive_view_file fix"', 'class="notive_view_file_XX"'))
      .querySelectorAll(knrecConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(broken).toBe("");
    // 실물로 「첨부 없는 상세에도 상자가 있다」를 못 봤으므로 필수 판정은 켜지 않는다.
    expect(knrecConfig.attachmentsScopeRequired).toBeUndefined();
  });
});

/**
 * ★제목 승격(2026-09-06 독립 리뷰 [높음] 1) — 목록이 제목을 **50자에서 잘라** 보낸다.
 * 실측: 1쪽 18행 중 2행·2쪽 18행 중 1행이 `...` 로 끝난다
 * (`(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입찰 공...`).
 * 잘린 채 저장하면 `dedupKeyOf(제목+기관)` 이 다른 게시판의 같은 공고와 영영 안 묶이고,
 * 갈래·한도 추출이 제목 뒷부분을 통째로 못 본다(안양과 같은 사정).
 */
describe("한국에너지공단 신·재생에너지센터 제목 승격 — 실사이트 고정본", () => {
  /** 상세 채움(`upgradedTitleOf`)이 하는 것과 **같은 순서**로 재현한다 — 규칙이 갈리면 자리마다 제목이 달라진다. */
  const promoted = (listTitle: string, html: string) => {
    const raw = parseHtml(html).querySelector(knrecConfig.detailTitle!.selector)?.text ?? "";
    const stripped = raw.replace(knrecConfig.detailTitle!.strip!, "");
    return upgradeTruncatedTitle(listTitle, stripped);
  };

  it("목록 고정본에 정말로 잘린 제목이 있다 — 없으면 아래 시험은 껍데기다", () => {
    const cut = (html: string) =>
      parseHtml(html)
        .querySelectorAll("div.table_list table tbody tr td.left a")
        .map((a) => a.text.replace(/\s+/g, " ").trim())
        .filter((t) => t.endsWith("..."));
    expect(cut(listHtml)).toHaveLength(2);
    expect(cut(listP2Html)).toHaveLength(1);
    expect(cut(listHtml)[0]).toBe(
      "(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입찰 공...",
    );
  });

  it("★잘린 제목을 상세의 온전한 제목으로 올린다 — 말머리 [공고] 는 뗀다", () => {
    expect(
      promoted("(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입찰 공...", detailTruncHtml),
    ).toBe("(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입찰 공고");
    // strip 을 안 하면 상세가 「[공고] …」로 시작해 접두어 관계가 깨져 승격 자체가 안 된다.
    const raw = parseHtml(detailTruncHtml).querySelector(knrecConfig.detailTitle!.selector)?.text ?? "";
    expect(raw.replace(/\s+/g, " ").trim().startsWith("[공고]")).toBe(true);
    expect(
      upgradeTruncatedTitle("(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입찰 공...", raw),
    ).toBeNull();
  });

  it("잘리지 않은 제목은 건드리지 않는다 — 상세 선택자가 틀린 날 엉뚱한 글자로 덮지 않게", () => {
    expect(promoted("2026년도 9월 재생에너지종합서비스기업(ReSCO) 모집 공고 및 8월 등록 결과 안내", detailHtml)).toBeNull();
    expect(promoted("전혀 다른 공고 제목...", detailTruncHtml)).toBeNull();
  });

  it("★승격된 온전한 제목이 DROP 에 다시 걸린다 — 낱말 중간에서 잘리면 목록 단계가 못 본다", () => {
    // 잘림이 「경쟁입찰」 중간에서 일어난 꼴. 목록 단계 거르개는 이 글자를 못 보고 통과시킨다.
    const cutMidWord = "(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입...";
    expect(isKnrecDropTitle(cutMidWord)).toBe(false);
    // 상세를 처음 여는 자리에서 온전한 제목으로 올라가고, 그 제목이 drop 에 걸려 닫힌다.
    const full = promoted(cutMidWord, detailTruncHtml);
    expect(full).toBe("(신·재생에너지센터 공고 제2026-3호) 2026년 상반기 풍력 고정가격계약 경쟁입찰 공고");
    expect(knrecConfig.detailTitle!.drop!.test(full!)).toBe(true);
  });

  it("승격 설정이 실측 선택자·말머리를 가리킨다", () => {
    expect(knrecConfig.detailTitle?.selector).toBe("p.notice_view_tit");
    expect(knrecConfig.detailTitle?.strip).toBeInstanceOf(RegExp);
    expect(knrecConfig.detailTitle?.drop).toBeInstanceOf(RegExp);
    // 목록 거르개와 **같은 정규식**이어야 판정이 자리마다 갈리지 않는다.
    expect(knrecConfig.detailTitle!.drop!.test("중대형 풍력터빈 KS인증 위탁기관 지정 변경사항 공고")).toBe(true);
    expect(knrecConfig.detailTitle!.drop!.test("2026년 KS인증 제품심사 수수료지원 공고")).toBe(false);
  });

  it("「위탁기관 지정」은 사이에 낱말이 끼어도 걸린다", () => {
    expect(isKnrecDropTitle("중대형 풍력터빈 KS인증 위탁기관 지정 변경사항 공고")).toBe(true);
    expect(isKnrecDropTitle("태양광 KS인증 위탁기관 추가 지정 공고")).toBe(true);
  });
});
