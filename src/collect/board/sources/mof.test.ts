import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillBoardDetail } from "../detail-fill";
import { attachmentKindOf } from "../../../engine/types";
import { fetchBoardDetail } from "../engine";
import { BOARD_SOURCES } from "../registry";
import {
  fetchMofDetail,
  isMofDropTitle,
  mofConfig,
  mofDetailAttachments,
  mofDetailUrl,
  mofYmd,
  parseMofHmlToHtml,
  parseMofList,
  parseMofValidationList,
  safeMofDownloadUrl,
} from "./mof";

const listHtml = readFileSync(join(__dirname, "../__fixtures__/mof-list.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/mof-detail.html"), "utf-8");
const hml = readFileSync(join(__dirname, "../__fixtures__/mof-announcement.hml"), "utf-8");

const DETAIL = "https://www.mof.go.kr/doc/ko/selectDoc.do?docSeq=67960&menuSeq=375&bbsSeq=9";
const HML_URL = "https://www.mof.go.kr/jfile/readDownloadFile.do?fileType=MOF_ARTICLE&fileTypeSeq=67960&fileNum=1";
const ZIP_URL = "https://www.mof.go.kr/jfile/readDownloadFile.do?fileType=MOF_ARTICLE&fileTypeSeq=67960&fileNum=2";

const raw = parseMofValidationList(listHtml);
const rows = parseMofList(listHtml);
afterEach(() => vi.unstubAllGlobals());

const OFFICIAL: { id: string; title: string; date: string }[] = [
  { id: "55901", title: "2024년 재검토기한 도래 심사대상 목록 공개 및 의견수렴", date: "2024-03-04" },
  { id: "46962", title: "외국인 선원 무단이탈 선박 등의 무역항 출입허가 등에 관한 지침 개정 알림", date: "2022-08-11" },
  { id: "68607", title: "2026년 근해어선 감척 시행계획 변경 공고", date: "2026-09-11" },
  { id: "68519", title: "2026년 친환경양식어업육성(친환경개체굴생산지원) 사업대상자 모집 공고(재공고)", date: "2026-09-03" },
  { id: "68518", title: "전국 항만별 육상항만구역 및 지형도면 변경 고시", date: "2026-09-03" },
  { id: "68515", title: "한국해양교통안전공단 상임이사(해양교통본부장, 검사본부장) 모집공고", date: "2026-09-03" },
  { id: "68483", title: "2026년 청년바다마을 조성 사업대상지 추가 선정 연장 공고", date: "2026-09-02" },
  { id: "68477", title: "국가연구개발사업 제재처분 사전통지서 공고(이마린아이시티㈜)", date: "2026-09-01" },
  { id: "68461", title: "해양수산부(본부) 노사협의회 설치 및 설치준비위원회 모집 공고", date: "2026-09-01" },
  { id: "68381", title: "2026년 제1차 우수 선화주기업 인증서 발급 알림", date: "2026-08-31" },
  { id: "68371", title: "2026년 해양수산부 기타공공기관 고객만족도 조사 주간사업자 선정 공고", date: "2026-08-31" },
  { id: "68369", title: "2026년 해양수산생명자원 기탁등록보존기관 신규지정 모집 공고", date: "2026-08-31" },
];

function byId(id: string) {
  return raw.find((r) => r.detailUrl.includes(`docSeq=${id}`));
}

describe("해양수산부 목록 — 공식 고정본", () => {
  it("검증 행은 잘리지 않은 제목·번호·날짜를 모두 담는다", () => {
    expect(raw).toHaveLength(OFFICIAL.length);
    for (const row of OFFICIAL) {
      expect(byId(row.id)).toMatchObject({
        title: row.title,
        detailUrl: mofDetailUrl(row.id),
        dateText: `${row.date} ~`,
        agency: "해양수산부",
      });
      expect(byId(row.id)?.title).not.toContain("...");
    }
  });

  it("검증 행 수가 정책 행 수 이상이다", () => {
    expect(raw.length).toBeGreaterThanOrEqual(rows.length);
    expect(rows.length).toBeLessThan(raw.length);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("지원·모집·정책 제목은 남기고 분명한 비정책만 버린다", () => {
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("2026년 근해어선 감척 시행계획 변경 공고");
    expect(titles).toContain("2026년 친환경양식어업육성(친환경개체굴생산지원) 사업대상자 모집 공고(재공고)");
    expect(titles).toContain("2026년 청년바다마을 조성 사업대상지 추가 선정 연장 공고");
    expect(titles).toContain("2026년 해양수산생명자원 기탁등록보존기관 신규지정 모집 공고");
    expect(titles.some((t) => t.includes("지형도면"))).toBe(false);
    expect(titles.some((t) => t.includes("상임이사"))).toBe(false);
    expect(titles.some((t) => t.includes("제재처분"))).toBe(false);
    expect(titles.some((t) => t.includes("노사협의회"))).toBe(false);
    expect(titles.some((t) => t.includes("고객만족도"))).toBe(false);
    expect(isMofDropTitle("해양수산부 직원 채용 공고")).toBe(true);
    expect(isMofDropTitle("2026년 선정 결과 발표")).toBe(true);
    expect(isMofDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isMofDropTitle("2026년 친환경개체굴 생산지원 사업대상자 모집")).toBe(false);
  });

  it("과거 날짜·붙박이·모집 낱말만으로 버리지 않는다", () => {
    expect(byId("55901")).toBeTruthy();
    expect(rows.some((r) => r.detailUrl.includes("docSeq=55901"))).toBe(true);
    expect(rows.some((r) => r.detailUrl.includes("docSeq=46962"))).toBe(true);
    expect(rows.some((r) => r.detailUrl.includes("docSeq=68381"))).toBe(true);
  });

  it("상세 주소는 숫자 id 로만 조립하고 onclick·첨부·바깥 주소를 쓰지 않는다", () => {
    for (const r of raw) {
      expect(r.detailUrl).toMatch(
        /^https:\/\/www\.mof\.go\.kr\/doc\/ko\/selectDoc\.do\?docSeq=\d+&menuSeq=375&bbsSeq=9$/,
      );
      expect(r.detailUrl).not.toMatch(/javascript:|#none|readDownloadFile|onclick|paginationInfo/i);
    }
    expect(listHtml).toContain("readDownloadFile.do");
    expect(listHtml).toContain('href="#none"');
  });

  it("달력에 없는 날짜는 비운다", () => {
    expect(mofYmd("2026.02.31.")).toBe("");
    expect(mofYmd("2026.09.11.")).toBe("2026-09-11");
    expect(mofYmd("2024.03.04")).toBe("2024-03-04");
  });
});

describe("해양수산부 설정", () => {
  it("1·2쪽 주소와 쪽수 상한", () => {
    expect(mofConfig.list.url(1)).toBe(
      "https://www.mof.go.kr/doc/ko/selectDocList.do?menuSeq=375&bbsSeq=9&paginationInfo.currentPageNo=1",
    );
    expect(mofConfig.list.url(2)).toBe(
      "https://www.mof.go.kr/doc/ko/selectDocList.do?menuSeq=375&bbsSeq=9&paginationInfo.currentPageNo=2",
    );
    expect(mofConfig.list.maxPages).toBe(5);
    expect(mofConfig.expectMinRows).toBe(2);
    expect(mofConfig.skipHeuristic).toBe(true);
    expect(mofConfig.validationParse).toBe(parseMofValidationList);
  });

  it("id·기관·호스트", () => {
    expect(mofConfig.id).toBe("mof");
    expect(mofConfig.label).toBe("해양수산부");
    expect(mofConfig.agency).toBe("해양수산부");
    expect(mofConfig.region).toBe("전국");
    expect(mofConfig.baseUrl).toBe("https://www.mof.go.kr/");
    expect(mofConfig.charset).toBe("utf-8");
  });
});

describe("해양수산부 HML 본문", () => {
  it("공식 HML 의 자격·금액 글자를 문단 순으로 남기고 HEAD·BINDATA 는 버린다", () => {
    const html = parseMofHmlToHtml(hml);
    expect(html.length).toBeGreaterThan(1500);
    expect(html).toContain("지원자격");
    expect(html).toContain("7억원");
    expect(html).toContain("국내기업");
    expect(html).toContain("지원대상");
    expect(html).not.toContain("<HWPML>");
    expect(html).not.toContain("<HEAD>");
    expect(html).not.toContain("<BINDATA>");
    const poisoned = hml.replace(
      "</HWPML>",
      '<HEAD><CHAR>HEADSECRET</CHAR></HEAD><BINDATA>QUJDREVGR0gxMjM0NTY3ODkw</BINDATA></HWPML>',
    );
    const cleaned = parseMofHmlToHtml(poisoned);
    expect(cleaned).not.toContain("HEADSECRET");
    expect(cleaned).not.toContain("QUJDREVGR0gxMjM0NTY3ODkw");
    expect(cleaned).toContain("지원자격");
  });

  it("UTF-8 BOM 이 있어도 읽고, DTD 외부 엔티티는 펼치지 않는다", () => {
    expect(parseMofHmlToHtml(`\uFEFF${hml}`)).toContain("지원자격");
    const out = parseMofHmlToHtml(
      `<!DOCTYPE hwpml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><HWPML><BODY><P><CHAR>&xxe;자격</CHAR></P></BODY></HWPML>`,
    );
    expect(out).not.toMatch(/root:|passwd/);
    expect(out).toContain("자격");
  });

  it("HML 이 아니면 throw — 짧은 상세를 완료로 두지 않는다", () => {
    expect(() => parseMofHmlToHtml("<html><body>안내</body></html>")).toThrow(/HML/);
    expect(() => parseMofHmlToHtml("<HWPML><HEAD></HEAD></HWPML>")).toThrow();
    expect(() => parseMofHmlToHtml("<HWPML><CHAR>본문 밖 글자</CHAR></HWPML>")).toThrow();
  });
});

describe("해양수산부 상세·첨부", () => {
  async function load(fetchMap: Record<string, string | Error>, record: string[] = []) {
    return fetchMofDetail(DETAIL, async (url) => {
      record.push(url);
      const hit = Object.entries(fetchMap).find(([k]) => url === k || url.startsWith(k));
      const v = hit?.[1] ?? fetchMap[url];
      if (v instanceof Error) throw v;
      if (typeof v === "string") return v;
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it("HML 이 있으면 자격·금액을 담고 첨부 이름을 유지한다", async () => {
    const asked: string[] = [];
    const out = await load({ [DETAIL]: detailHtml, [HML_URL]: hml }, asked);
    expect(asked).toEqual([DETAIL, HML_URL]);
    expect(out).toContain("지원자격");
    expect(out).toContain("7억원");
    expect(out).not.toContain("HEADSECRET");
    const atts = mofDetailAttachments({
      html: out,
      pageHtml: out,
      detailUrl: DETAIL,
      baseUrl: mofConfig.baseUrl,
    });
    expect(atts).toHaveLength(2);
    expect(atts[0]).toMatchObject({
      name: "(공고문) 해양부문 국제감축사업 설치 지원사업 공고문.hml",
      url: HML_URL,
      kind: attachmentKindOf("(공고문) 해양부문 국제감축사업 설치 지원사업 공고문.hml", HML_URL),
    });
    expect(atts[0].kind).toBe("etc");
    expect(atts[1]).toMatchObject({ name: "붙임파일.zip", url: ZIP_URL, kind: "zip" });
    expect(atts.every((a) => !a.name.includes("첨부파일"))).toBe(true);
  });

  it("HML 이 없으면 원래 상세 본문을 돌리고 첨부만 집는다", async () => {
    const noHml = detailHtml.replaceAll(".hml", ".hwpx");
    const asked: string[] = [];
    const out = await load({ [DETAIL]: noHml }, asked);
    expect(asked).toEqual([DETAIL]);
    expect(out).toContain("해양수산부 공고 제2026-1226호");
    expect(out).toContain("설치 지원사업");
    expect(out).not.toContain("지원자격");
  });

  it("HML 받기·해석 실패는 throw 한다", async () => {
    await expect(load({ [DETAIL]: detailHtml, [HML_URL]: new Error("끊김") })).rejects.toThrow(/끊김/);
    await expect(load({ [DETAIL]: detailHtml, [HML_URL]: "<html>차단</html>" })).rejects.toThrow(/HML/);
  });

  it("바깥 HML 주소는 호출하지 않는다", async () => {
    const evil = detailHtml.replace(
      "/jfile/readDownloadFile.do?fileType=MOF_ARTICLE&amp;fileTypeSeq=67960&amp;fileNum=1",
      "https://evil.example/secret.hml",
    );
    const asked: string[] = [];
    const out = await load({ [DETAIL]: evil }, asked);
    expect(asked).toEqual([DETAIL]);
    expect(asked.some((u) => u.includes("evil"))).toBe(false);
    expect(out).toContain("해양수산부 공고 제2026-1226호");
    expect(safeMofDownloadUrl("https://evil.example/x.hml", "67960")).toBeNull();
    expect(safeMofDownloadUrl("https://www.mof.go.kr/other/readDownloadFile.do?fileType=MOF_ARTICLE&fileTypeSeq=67960&fileNum=1", "67960")).toBeNull();
    expect(safeMofDownloadUrl(HML_URL, "1")).toBeNull();
  });

  it("HML 은 같은 글번호로 최대 2건만 받는다", async () => {
    const extra =
      `<li><a href="/jfile/readDownloadFile.do?fileType=MOF_ARTICLE&amp;fileTypeSeq=67960&amp;fileNum=3" class="down-i-btn"><span class="blind">첨부파일</span>추가.hml</a></li>` +
      `<li><a href="/jfile/readDownloadFile.do?fileType=MOF_ARTICLE&amp;fileTypeSeq=67960&amp;fileNum=4" class="down-i-btn"><span class="blind">첨부파일</span>세번째.hml</a></li>`;
    const html = detailHtml.replace("</ul>", `${extra}</ul>`);
    const asked: string[] = [];
    const u3 = "https://www.mof.go.kr/jfile/readDownloadFile.do?fileType=MOF_ARTICLE&fileTypeSeq=67960&fileNum=3";
    const u4 = "https://www.mof.go.kr/jfile/readDownloadFile.do?fileType=MOF_ARTICLE&fileTypeSeq=67960&fileNum=4";
    await fetchMofDetail(DETAIL, async (url) => {
      asked.push(url);
      if (url === DETAIL) return html;
      if (url === HML_URL || url === u3 || url === u4) return hml;
      throw new Error(`unexpected ${url}`);
    });
    expect(asked.filter((u) => u.includes("readDownloadFile"))).toHaveLength(2);
    expect(asked).not.toContain(u4);
  });
});

describe("엔진 연동 — detailFetch 와 fetchBoardDetail", () => {
  it("실제 상세 채움 경로에서 HML 조건과 공식 첨부 두 개를 함께 저장한다", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      requested.push(url);
      if (url === DETAIL) return new Response(detailHtml, { status: 200 });
      if (url === HML_URL) return new Response(hml, { status: 200 });
      throw new Error("unexpected URL");
    }));
    const updateAnnouncementIfEmpty = vi.fn(async (_id: string, _data: unknown) => 1);
    const updateAnnouncement = vi.fn(async () => {});
    const result = await fillBoardDetail({ id: "mof-test", source: "mof", url: DETAIL, targetText: "", title: "해양부문 국제감축사업 설치 지원사업", agency: "해양수산부", attachments: [] }, { updateAnnouncementIfEmpty, updateAnnouncement }, { onlyIfEmpty: true });
    expect(result).toBe("filled");
    expect(requested).toEqual([DETAIL, HML_URL]);
    const saved = updateAnnouncementIfEmpty.mock.calls[0]?.[1] as { targetText: string; attachments: unknown[] };
    expect(saved.targetText).toContain("지원자격");
    expect(saved.targetText).toContain("7억원");
    expect(saved.attachments).toHaveLength(2);
    expect(updateAnnouncement).not.toHaveBeenCalled();
  });
  it("fetchBoardDetail 은 detailFetch 를 타지 않고 선택자 본문만 돌려준다", async () => {
    let n = 0;
    const text = await fetchBoardDetail(mofConfig, DETAIL, {
      fetchText: async () => {
        n += 1;
        return detailHtml;
      },
    });
    expect(n).toBe(1);
    expect(text).toContain("해양수산부 공고 제2026-1226호");
    expect(text).not.toContain("지원자격");
  });

  it("fillBoardDetail 이 등록된 MOF 설정을 찾는다", () => {
    expect(BOARD_SOURCES.some((c) => c.id === "mof")).toBe(true);
    expect(mofConfig.detailFetch).toBe(fetchMofDetail);
  });

  it("엔진은 detailFetch 반환값을 pageHtml 로 넘기므로 그 글에서 첨부를 회수해야 한다", async () => {
    const contentHtml = await mofConfig.detailFetch!(DETAIL, async (url) => {
      if (url === DETAIL) return detailHtml;
      if (url === HML_URL) return hml;
      throw new Error(`unexpected ${url}`);
    });
    const atts = mofConfig.detailAttachments!({
      html: contentHtml,
      pageHtml: contentHtml,
      detailUrl: DETAIL,
      baseUrl: mofConfig.baseUrl,
    });
    expect(contentHtml).toContain("지원자격");
    expect(atts.map((a) => a.name)).toEqual([
      "(공고문) 해양부문 국제감축사업 설치 지원사업 공고문.hml",
      "붙임파일.zip",
    ]);
  });
});

it("실제 전체 HML은 HEAD의 문서 설정과 BODY를 분리해서 읽는다", () => {
  const full = readFileSync(join(__dirname, "../__fixtures__/mof-announcement-full.hml"), "utf-8");
  const body = parseMofHmlToHtml(full);
  expect(body).toContain("지원자격");
  expect(body).toContain("7억원");
});
