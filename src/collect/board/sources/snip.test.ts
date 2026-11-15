import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endOfKstDay, fetchBoardAll, type BoardDeps } from "../engine";
import { parseHtml } from "../html";
import { readBoardDetail } from "../detail-fill";
import { BoardDetailGoneError } from "../detail-gone";
import {
  isSnipDropTitle,
  parseSnipList,
  snipConfig,
  snipDetailAttachments,
  snipOfficialDetailUrl,
} from "./snip";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 *
 * 고정본 두 벌.
 * · 2026-09-02 1·2쪽(`snip-list.html`·`snip-list-p2.html`): 사이트 개편 전. 상세가 포털(`portal.snip.or.kr:8443`)이었다.
 *   접수기간이 `시작~끝` 꼴이라 기간 읽기·DROP 거르개 시험에 그대로 쓴다.
 * · 2026-11-15(`snip-list-202611.html`·`snip-view-*.html`·`snip-filelist-*.json`): 개편 뒤.
 *   상세가 같은 목록 주소의 `?schM=view&snp=…` 이고, 접수기간은 마감일만(`~2026-11-20`) 준다.
 *   담당자 전자우편은 `@` 앞을 같은 길이의 x 로 가렸다(공개 저장소). 스크립트·스타일은 뺐다.
 */
const fixture = (name: string) => readFileSync(join(__dirname, "../__fixtures__", name), "utf-8");
const oldListHtml = fixture("snip-list.html");
const oldListP2Html = fixture("snip-list-p2.html");
const listHtml = fixture("snip-list-202611.html");
const viewFilesHtml = fixture("snip-view-files.html");
const viewImageHtml = fixture("snip-view-image.html");
const viewOldHtml = fixture("snip-view-old.html");
const viewMissingHtml = fixture("snip-view-missing.html");
const viewDeletedHtml = fixture("snip-view-deleted.html");
const fileListFiles = fixture("snip-filelist-files.json");
const fileListOld = fixture("snip-filelist-old.json");

const LIST_URL = "https://www.snip.or.kr/SNIP/contents/Business1.do";
const detailOf = (snp: string) => `${LIST_URL}?schM=view&snp=${snp}`;
/** 개편 뒤 2026-11 배포까지 저장된 주소 — 목록의 상대 주소를 사이트 뿌리에 붙인 꼴. 중복 판정 열쇠로 남긴다. */
const legacyOf = (snp: string) => `https://www.snip.or.kr/?schM=view&snp=${snp}`;

const SNP_FILES = "ebdd9e00dc8f11f1b1350200655b0007";
const SNP_IMAGE = "7f01bc0ddf4011f1b1350200655b0007";
const SNP_OLD = "2026-0049";
const FILE_ID = "26111058666gk9iU";
const OLD_FILE_ID = "202004104043102026-0049";
const fileListUrl = (id: string) => `https://www.snip.or.kr/afile/fileList.do?fileId=${id}`;
const PORTAL_STORED =
  "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167&homeYn=Y";

/** 주소별로 고정본을 돌려주는 가짜 요청. 모르는 주소는 던진다 — 몰래 다른 곳을 부르면 시험이 깨진다. */
function routes(map: Record<string, string>) {
  const asked: Array<{ url: string; init?: unknown }> = [];
  const fetchText = async (url: string, init?: unknown) => {
    asked.push({ url, init });
    if (!(url in map)) throw new Error(`예상 밖 요청: ${url}`);
    return map[url];
  };
  return { asked, fetchText };
}

describe("성남산업진흥원 목록 읽기 — 개편 뒤 실사이트 고정본(2026-11)", () => {
  const rows = parseSnipList(listHtml);

  it("10행 가운데 DROP 1건(강사 인력 Pool)을 뺀 9건을 읽고 첫 행의 제목·정식 상세 주소·옛 열쇠·마감일이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows.some((r) => r.title.includes("강사 인력 Pool"))).toBe(false);
    expect(rows[0]).toEqual({
      title: "2026 복지 X 에이지테크 커넥트 개최",
      detailUrl: detailOf(SNP_IMAGE),
      sourceId: legacyOf(SNP_IMAGE),
      dateText: "~ 2026-11-20",
      category: "",
      agency: "성남산업진흥원",
    });
  });

  it("상세 주소는 사이트 뿌리가 아니라 목록 주소에 붙인다 — 뿌리에 붙이면 166바이트 넘김 화면만 온다", () => {
    for (const r of rows) {
      expect(r.detailUrl.startsWith(`${LIST_URL}?schM=view&snp=`)).toBe(true);
      expect(r.detailUrl).not.toContain("&amp;");
    }
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("중복 판정 열쇠는 이미 저장된 주소 꼴 그대로다 — 바꾸면 같은 공고가 두 줄로 쌓인다", () => {
    expect(rows.map((r) => r.sourceId)).toEqual(
      rows.map((r) => legacyOf(new URL(r.detailUrl).searchParams.get("snp") ?? "")),
    );
  });

  it("접수기간 칸이 마감일만(`~2026-11-20`) 주면 시작일이 아니라 마감일로 적는다", () => {
    expect(rows.map((r) => r.dateText)).toEqual([
      "~ 2026-11-20",
      "~ 2026-11-18",
      "~ 2026-11-16",
      "~ 2026-11-19",
      "~ 2026-11-27",
      "~ 2026-12-31",
      "~ 2026-11-30",
      "~ 2026-12-31",
      "~ 2026-12-10",
    ]);
  });
});

describe("수집 엔진을 거친 결과 — 열쇠·주소·마감", () => {
  beforeEach(() => {
    // 날짜만 고정한다 — 엔진의 쪽 사이 대기(setTimeout)까지 묶으면 시험이 멈춘다.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T09:00:00+09:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("마감일만 준 행은 applyEnd 로 들어가고 applyStart 는 비어 있다", async () => {
    const deps: BoardDeps = {
      fetchText: async () => listHtml,
      prevOpenCount: 0,
      askModel: async () => {
        throw new Error("모델을 부르면 안 된다");
      },
      onAllFailed: () => {
        throw new Error("실패로 끝나면 안 된다");
      },
    };
    const out = await fetchBoardAll(snipConfig, deps);
    const first = out.find((a) => a.title === "2026 복지 X 에이지테크 커넥트 개최");
    expect(first).toMatchObject({
      sourceId: legacyOf(SNP_IMAGE),
      url: detailOf(SNP_IMAGE),
      applyStart: null,
      applyEnd: endOfKstDay(2026, 11, 20),
    });
  });
});

describe("성남산업진흥원 목록 읽기 — 개편 전 고정본(2026-09)", () => {
  const rows = parseSnipList(oldListHtml);
  const combined = parseSnipList(oldListHtml + oldListP2Html);

  it("시작~끝 접수기간은 td.term 칸에서만 그대로 읽는다", () => {
    expect(rows).toHaveLength(10);
    // 행 전체 글자면 조회수 142 + 작성일 2026-08-31 이 붙는다.
    expect(rows[0].dateText).toBe("2026-08-31 ~ 2026-09-17");
    // 작성일 칸(td.data)으로 떨어지면 끝이 08-27 이 된다.
    expect(rows.find((x) => x.title.includes("Indocomtech"))?.dateText).toBe("2026-08-28 ~ 2026-09-04");
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없고, DROP 1건을 뺀 19건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(19);
    expect(combined.some((r) => r.title.includes("강사 인력 Pool"))).toBe(false);
  });

  it("DROP 은 버릴 것만 — 「~ 안내」 지원사업과 「채용」 고용보조금은 살린다", () => {
    expect(isSnipDropTitle("RA 전문가 양성교육 교육 강사 인력 Pool 모집")).toBe(true);
    expect(isSnipDropTitle("[성남특허센터] 지식재산 거래 지원사업 신청 안내 (기술이전, 기술거래)")).toBe(false);
    expect(isSnipDropTitle("방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
    expect(rows.some((r) => r.title.includes("지식재산 거래 지원사업 신청 안내"))).toBe(true);
  });
});

describe("성남산업진흥원 설정", () => {
  it("쪽넘김은 GET page — pageIndex·pageNo·currentPage 는 실측에서 안 먹는다", () => {
    expect(snipConfig.list.url(1)).toBe(`${LIST_URL}?page=1`);
    expect(snipConfig.list.url(2)).toBe(`${LIST_URL}?page=2`);
    expect(snipConfig.list.maxPages).toBe(10);
  });

  it("옛 포털 첨부 주소를 내려받을 수 있게 portal.snip.or.kr:8443 허용은 남긴다", () => {
    expect(snipConfig.allowedHosts).toEqual(["portal.snip.or.kr:8443"]);
  });

  it("지역은 경기, 서식 변경 감지는 켜 둔다", () => {
    expect(snipConfig.region).toBe("경기");
    expect(snipConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("공개 상세를 채우므로 skipDetailFill 을 쓰지 않고, 본문 선택자·첨부 손잡이가 있다", () => {
    expect(snipConfig.skipDetailFill).toBeUndefined();
    expect(typeof snipConfig.detailFetch).toBe("function");
    expect(typeof snipConfig.detailAttachments).toBe("function");
    expect(snipConfig.detailContentSelector).toBe("#snip-detail-body");
    expect(snipConfig.detailApplyPeriod).toBeUndefined();
  });
});

describe("상세 주소 — 저장된 세 꼴을 정식 주소로", () => {
  it("정식 주소·개편 뒤 저장 꼴·옛 포털 꼴을 모두 같은 정식 주소로 옮긴다", () => {
    expect(snipOfficialDetailUrl(detailOf(SNP_FILES))).toBe(detailOf(SNP_FILES));
    expect(snipOfficialDetailUrl(legacyOf(SNP_FILES))).toBe(detailOf(SNP_FILES));
    // 옛 포털 공고 번호(portlet)가 새 사이트의 snp 다 — 2026-0253 은 두 곳 모두 「해외 전시회 개별 참가 지원」(실측).
    expect(snipOfficialDetailUrl(PORTAL_STORED)).toBe(detailOf("2026-0253"));
    expect(snipOfficialDetailUrl(`${detailOf(SNP_OLD)}&page=3`)).toBe(detailOf(SNP_OLD));
  });

  /**
   * ★2009년 「입주기업 모집」 글은 연도 자리가 `1900` 인 번호(`1900-0001`~)로 남아 있다(2026-11-15 운영 백업·실사이트 실측).
   * 20xx 만 받으면 상세를 안 불러 빈 글 → 「게시판 상세 채움 실패」에 남는다(NO.486).
   */
  it("연도 자리가 1900 인 옛 번호도 옛 포털 꼴·정식 꼴 모두 정식 주소로 옮긴다", async () => {
    const portal1900 =
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=1900-0001&portlet2=12&homeYn=Y";
    expect(snipOfficialDetailUrl(portal1900)).toBe(detailOf("1900-0001"));
    expect(snipOfficialDetailUrl(detailOf("1900-0012"))).toBe(detailOf("1900-0012"));
    // 상세 쪽 모양은 개편 뒤 공통이라 첨부 없는 고정본으로 잰다 — 요점은 번호 검사가 요청 전에 거절하지 않는 것.
    const { asked, fetchText } = routes({ [detailOf("1900-0001")]: viewImageHtml });
    expect(await snipConfig.detailFetch!(portal1900, fetchText)).not.toBe("");
    expect(asked.map((a) => a.url)).toEqual([detailOf("1900-0001")]);
  });

  it("틀린 입력은 요청 전에 거절한다", async () => {
    const bad = [
      `http://www.snip.or.kr/SNIP/contents/Business1.do?schM=view&snp=${SNP_FILES}`,
      `https://www.snip.or.kr:8443/SNIP/contents/Business1.do?schM=view&snp=${SNP_FILES}`,
      `https://user:pass@www.snip.or.kr/SNIP/contents/Business1.do?schM=view&snp=${SNP_FILES}`,
      `https://evil.example/SNIP/contents/Business1.do?schM=view&snp=${SNP_FILES}`,
      `https://snip.or.kr.evil.example/?schM=view&snp=${SNP_FILES}`,
      `https://www.snip.or.kr/SNIP/contents/Other.do?schM=view&snp=${SNP_FILES}`,
      `https://www.snip.or.kr/SNIP/contents/Business1.do?schM=list&snp=${SNP_FILES}`,
      `https://www.snip.or.kr/SNIP/contents/Business1.do?schM=view`,
      `https://www.snip.or.kr/SNIP/contents/Business1.do?schM=view&snp=${SNP_FILES.slice(0, 31)}`,
      "https://www.snip.or.kr/SNIP/contents/Business1.do?schM=view&snp=..%2Fx",
      "https://www.snip.or.kr/SNIP/contents/Business1.do?schM=view&snp=1999-0001",
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026&portlet2=4167",
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=0",
      "https://portal.snip.or.kr/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167",
      "https://portal.snip.or.kr:8443/user/snip/busin/businDetail.face?pjtAnncSn=2026-0253&pjtCd=4167&stateChk=N",
      "not a url",
    ];
    for (const url of bad) {
      let called = 0;
      const html = await snipConfig.detailFetch!(url, async () => {
        called += 1;
        return viewFilesHtml;
      });
      expect({ url, html, called }).toEqual({ url, html: "", called: 0 });
      expect(snipOfficialDetailUrl(url)).toBeNull();
    }
  });
});

describe("상세 조달 — 개편 뒤 실사이트 고정본", () => {
  it("본문과 첨부 목록(JSON)을 읽는다 — 저장된 옛 꼴 주소로 불러도 정식 주소만 요청한다", async () => {
    const { asked, fetchText } = routes({
      [detailOf(SNP_FILES)]: viewFilesHtml,
      [fileListUrl(FILE_ID)]: fileListFiles,
    });
    const html = await snipConfig.detailFetch!(legacyOf(SNP_FILES), fetchText);
    expect(asked.map((a) => a.url)).toEqual([detailOf(SNP_FILES), fileListUrl(FILE_ID)]);

    const body = parseHtml(html).querySelector(snipConfig.detailContentSelector!);
    expect(body).not.toBeNull();
    const text = (body!.text ?? "").replace(/\s+/g, " ");
    expect(text).toContain("킨스타워 입주기업 모집공고");
    expect(text).toContain("벤처기업육성에 관한 특별조치법에 따른 벤처인증기업");
    // 상세 채움은 돌려준 HTML 전체의 글자를 저장한다 — 버튼·이전글·파일 이름이 섞이면 안 된다.
    const all = parseHtml(html).text.replace(/\s+/g, " ");
    expect(all).not.toContain("신청하기");
    expect(all).not.toContain("이전글");
    expect(all).not.toContain("지원신청서.hwp");
    expect(html).not.toMatch(/<script|<style|<form|<iframe/i);

    expect(
      snipConfig.detailAttachments!({ html, pageHtml: html, detailUrl: legacyOf(SNP_FILES), baseUrl: snipConfig.baseUrl }),
    ).toEqual([
      { name: "1. 킨스타워 입주기업 모집공고.hwp", url: "https://www.snip.or.kr/afile/fileDownload/hegmn", kind: "hwp" },
      { name: "2 지원신청서.hwp", url: "https://www.snip.or.kr/afile/fileDownload/3egmn", kind: "hwp" },
      { name: "3. 사업계획서.hwp", url: "https://www.snip.or.kr/afile/fileDownload/Jegmn", kind: "hwp" },
      { name: "4. 제출서류 작성요령.hwp", url: "https://www.snip.or.kr/afile/fileDownload/Kegmn", kind: "hwp" },
    ]);
  });

  it("첨부가 없는 공고(fileId 빈 값)는 첨부 목록을 요청하지 않고, 본문 그림을 원문 첨부로 남긴다", async () => {
    const { asked, fetchText } = routes({ [detailOf(SNP_IMAGE)]: viewImageHtml });
    const html = await snipConfig.detailFetch!(detailOf(SNP_IMAGE), fetchText);
    expect(asked.map((a) => a.url)).toEqual([detailOf(SNP_IMAGE)]);
    expect(parseHtml(html).text).toContain("성남시니어산업혁신센터와 성남시복지재단이 공동으로");
    expect(snipDetailAttachments(html)).toEqual([
      {
        name: "포스터 최종 시안.png",
        url: "https://www.snip.or.kr/data/COMMON/editor/attach/20261113174045_qmeiyptu.png",
        kind: "etc",
      },
    ]);
  });

  it("옛 포털 시절 공고도 새 사이트에서 그림 3장·첨부 1건을 읽는다", async () => {
    const { asked, fetchText } = routes({
      [detailOf(SNP_OLD)]: viewOldHtml,
      [fileListUrl(OLD_FILE_ID)]: fileListOld,
    });
    const html = await snipConfig.detailFetch!(detailOf(SNP_OLD), fetchText);
    expect(asked.map((a) => a.url)).toEqual([detailOf(SNP_OLD), fileListUrl(OLD_FILE_ID)]);
    const base = "https://www.snip.or.kr/data/COMMON/jfile/biz_old/2026";
    expect(snipDetailAttachments(html)).toEqual([
      { name: "리빙랩 기반 사용성평가 지원 참여기업 모집 공고문001.jpg", url: `${base}/202603130550072980.jpg`, kind: "etc" },
      { name: "리빙랩 기반 사용성평가 지원 참여기업 모집 공고문002.jpg", url: `${base}/202603130550242700.jpg`, kind: "etc" },
      { name: "리빙랩 기반 사용성평가 지원 참여기업 모집 공고문003.jpg", url: `${base}/202603130550382470.jpg`, kind: "etc" },
      {
        name: "붙임 리빙랩 기반 사용성평가 지원사업 신청 서류.hwp",
        url: "https://www.snip.or.kr/afile/fileDownload/ap2mn",
        kind: "hwp",
      },
    ]);
  });

  it("삭제 안내가 없는 오류 화면(점검 등)은 빈 글 — 첨부 목록도 요청하지 않는다", async () => {
    expect(viewMissingHtml).not.toContain("삭제되었습니다");
    const { asked, fetchText } = routes({ [detailOf("2026-9999")]: viewMissingHtml });
    expect(await snipConfig.detailFetch!(detailOf("2026-9999"), fetchText)).toBe("");
    expect(asked).toHaveLength(1);
  });

  /**
   * NO.486 — 원문에서 지워진 공고 3건(2026-0006·0015·0018)은 「게시된 공고문이 없거나 삭제되었습니다」 안내만 오는
   * 「오류」 화면이다. 빈 글로 돌려주면 「상세 조달이 빈 글을 돌려줌」 실패로 남아 영영 못 나온다 — 지워진 공고로 가른다.
   */
  it("지워진 공고 화면은 BoardDetailGoneError 를 던진다 — 저장 주소 세 꼴 모두, 첨부 목록은 요청하지 않는다", async () => {
    for (const stored of [legacyOf("2026-0006"), detailOf("2026-0006")]) {
      const { asked, fetchText } = routes({ [detailOf("2026-0006")]: viewDeletedHtml });
      await expect(snipConfig.detailFetch!(stored, fetchText)).rejects.toBeInstanceOf(BoardDetailGoneError);
      expect(asked.map((a) => a.url)).toEqual([detailOf("2026-0006")]);
    }
    const portal = "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0006&portlet2=1&homeYn=Y";
    const { fetchText } = routes({ [detailOf("2026-0006")]: viewDeletedHtml });
    await expect(snipConfig.detailFetch!(portal, fetchText)).rejects.toThrow("원문에서 지워진 공고");
  });

  it("readBoardDetail 은 지워진 공고를 「gone」 실패로 돌려준다 — 「상세 조달이 빈 글」과 구분된다", async () => {
    const { fetchText } = routes({ [detailOf("2026-0006")]: viewDeletedHtml, [detailOf("2026-9999")]: viewMissingHtml });
    const cfg = { ...snipConfig, detailFetch: (u: string) => snipConfig.detailFetch!(u, fetchText) };
    expect(await readBoardDetail(cfg, legacyOf("2026-0006"))).toEqual({
      kind: "fail",
      reason: "원문에서 지워진 공고(게시된 공고문이 없거나 삭제되었습니다)",
      gone: true,
    });
    expect(await readBoardDetail(cfg, legacyOf("2026-9999"))).toEqual({ kind: "fail", reason: "상세 조달이 빈 글을 돌려줌" });
  });

  it("본문 칸이 있는 화면은 안내 글자가 본문에 있어도 지워진 공고로 보지 않는다", async () => {
    const withText = viewImageHtml.replace(
      '<div class="view-content">',
      '<div class="view-content"><p>alert("게시된 공고문이 없거나 삭제되었습니다.")</p>',
    );
    expect(withText).not.toBe(viewImageHtml);
    const html = await snipConfig.detailFetch!(detailOf(SNP_IMAGE), routes({ [detailOf(SNP_IMAGE)]: withText }).fetchText);
    expect(html).toContain("삭제되었습니다");
  });

  it("본문 칸이 있지만 비었고 첨부도 없으면 빈 상자를 돌려준다 — 진짜 공고를 7일마다 실패로 돌리지 않는다", async () => {
    const empty = viewImageHtml.replace(/<div class="view-content">[\s\S]*?<\/div>\n<div class="btn-board_bottom">/, '<div class="view-content"></div>\n<div class="btn-board_bottom">');
    expect(empty).not.toBe(viewImageHtml);
    const html = await snipConfig.detailFetch!(detailOf(SNP_IMAGE), routes({ [detailOf(SNP_IMAGE)]: empty }).fetchText);
    expect(html.trim()).not.toBe("");
    expect(parseHtml(html).text.trim()).toBe("");
    expect(snipDetailAttachments(html)).toEqual([]);
  });

  it("첨부 목록 응답이 JSON 배열이 아니면 던진다 — 「첨부 없음」으로 굳히지 않고 다음에 다시 읽는다", async () => {
    for (const bad of ["<html>점검 중</html>", '{"result":0}', ""]) {
      const { fetchText } = routes({ [detailOf(SNP_FILES)]: viewFilesHtml, [fileListUrl(FILE_ID)]: bad });
      await expect(snipConfig.detailFetch!(detailOf(SNP_FILES), fetchText)).rejects.toThrow();
    }
  });

  it("첨부 목록의 이상한 줄은 버린다 — 바깥 주소·지우기 주소·이름 없음·같은 주소", async () => {
    const list = JSON.stringify([
      { fileName: "a.hwp", downloadPath: "https://evil.example/afile/fileDownload/abc" },
      { fileName: "b.hwp", downloadPath: "/afile/fileRemove/abc" },
      { fileName: "c.hwp", downloadPath: "/afile/fileDownload/../x" },
      { fileName: "", downloadPath: "/afile/fileDownload/abc" },
      { fileName: "d.hwp", downloadPath: "/afile/fileDownload/abc" },
      { fileName: "d 사본.hwp", downloadPath: "/afile/fileDownload/abc" },
      { fileName: "e.pdf", downloadPath: 3 },
      "문자열",
      null,
    ]);
    const { fetchText } = routes({ [detailOf(SNP_FILES)]: viewFilesHtml, [fileListUrl(FILE_ID)]: list });
    const html = await snipConfig.detailFetch!(detailOf(SNP_FILES), fetchText);
    expect(snipDetailAttachments(html)).toEqual([
      { name: "d.hwp", url: "https://www.snip.or.kr/afile/fileDownload/abc", kind: "hwp" },
    ]);
  });

  it("fileId 가 이상한 값이면 첨부 목록을 요청하지 않는다", async () => {
    const odd = viewFilesHtml.replace(`value="${FILE_ID}"`, 'value="../../x?y=1"');
    const { asked, fetchText } = routes({ [detailOf(SNP_FILES)]: odd });
    const html = await snipConfig.detailFetch!(detailOf(SNP_FILES), fetchText);
    expect(asked).toHaveLength(1);
    expect(parseHtml(html).text).toContain("킨스타워 입주기업 모집공고");
  });
});

describe("첨부 — 잘못된 그림·파일 주소는 거절한다", () => {
  const body = (inner: string) => `<div id="snip-detail-body">${inner}</div>`;

  it("같은 사이트 /data/COMMON/ 아래 png·jpg 만 담는다", () => {
    for (const src of [
      "https://evil.example/data/COMMON/editor/attach/x.png",
      "http://www.snip.or.kr/data/COMMON/editor/attach/x.png",
      "https://www.snip.or.kr/other/x.png",
      "https://www.snip.or.kr/data/COMMON/editor/attach/x.gif",
      "https://www.snip.or.kr/data/COMMON/editor/attach/x.png?download=1",
      "https://www.snip.or.kr/data/COMMON/../x.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
    ]) {
      expect(snipDetailAttachments(body(`<img src="${src}" alt="x.png">`))).toEqual([]);
    }
    expect(snipDetailAttachments(body('<img src="/data/COMMON/editor/attach/x.png" alt="포스터.png">'))).toEqual([
      { name: "포스터.png", url: "https://www.snip.or.kr/data/COMMON/editor/attach/x.png", kind: "etc" },
    ]);
  });

  it("이름표가 없는 그림은 파일 이름으로 짓는다", () => {
    expect(snipDetailAttachments(body('<img src="https://www.snip.or.kr/data/COMMON/editor/attach/a1.jpg">'))).toEqual([
      { name: "a1.jpg", url: "https://www.snip.or.kr/data/COMMON/editor/attach/a1.jpg", kind: "etc" },
    ]);
  });

  it("파일 줄은 fileDownload 주소와 이름표가 함께 있어야 담는다", () => {
    const li = (href: string, name: string) => `<ul class="snip-files"><li><a href="${href}" data-snip-name="${name}"></a></li></ul>`;
    expect(snipDetailAttachments(li("https://www.snip.or.kr/afile/fileDownload/abc", ""))).toEqual([]);
    expect(snipDetailAttachments(li("https://www.snip.or.kr/afile/fileRemove/abc", "a.hwp"))).toEqual([]);
    expect(snipDetailAttachments(li("https://evil.example/afile/fileDownload/abc", "a.hwp"))).toEqual([]);
    expect(snipDetailAttachments(li("https://www.snip.or.kr/afile/fileDownload/abc?x=1", "a.hwp"))).toEqual([]);
    expect(snipDetailAttachments(li("https://www.snip.or.kr/afile/fileDownload/abc", "a.hwp"))).toEqual([
      { name: "a.hwp", url: "https://www.snip.or.kr/afile/fileDownload/abc", kind: "hwp" },
    ]);
  });

  it("본문 상자·파일 목록 밖의 링크는 담지 않는다", () => {
    expect(
      snipDetailAttachments('<a href="https://www.snip.or.kr/afile/fileDownload/abc" data-snip-name="a.hwp"></a>'),
    ).toEqual([]);
  });
});
