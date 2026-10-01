import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectDeps, PolicyAnnouncementUpdate } from "../types";

/**
 * 첨부 수확 2번 고침(2026-10-01 운영 실측) — 고정본은 그날 받은 실제 상세 쪽이다
 * (세션 토큰은 0 으로 바꿨다).
 *
 * 1. href·onclick 은 **속성 방식**으로 푼다 — `&paramMenuId` 의 `&para` 가 「¶」가 되어
 *    보건산업진흥원·에너지기술평가원 첨부가 전부 오류 화면을 받았다.
 * 2. 용인시산업진흥원(ybs.ypa.or.kr)의 eGov 첨부는 `/FileDown.do` 다 — 표준 경로
 *    `/cmm/fms/FileDown.do` 는 200 + 0바이트(쪽 스크립트 `fn_egov_downFile` 도 `/FileDown.do` 를 연다).
 * 3. 충북기업진흥원(cba)은 옆 메뉴의 「중소기업 지원시책」 전자책(`/ebook/…/pages.pdf`)이 모든 글의
 *    첨부로 잡혔다 — 첨부 칸(`td.txt_left`)·본문(`.substance`)으로 좁힌다.
 * 4. 수출바우처는 화면 고정 메뉴의 「정산가이드」·바닥글의 「관리지침」이 모든 글의 첨부로 잡혔다 —
 *    첨부 칸(`div.file`)으로 좁힌다. 진짜 첨부는 그 칸 안에서 스크립트로 불러와 쪽 HTML 에는 없다
 *    (이번 범위 밖 — 0건이 맞다).
 */

const updateAnnouncement = vi.fn((_id: string, _data: PolicyAnnouncementUpdate): Promise<void> => Promise.resolve());
const updateAnnouncementIfEmpty = vi.fn((_id: string, _data: PolicyAnnouncementUpdate): Promise<number> => Promise.resolve(1));
const deps: Pick<CollectDeps, "updateAnnouncement" | "updateAnnouncementIfEmpty"> = {
  updateAnnouncement,
  updateAnnouncementIfEmpty,
};

// 국내 경유 출처도 시험에서는 전역 fetch(stub)로 흐르게 한다(detail-fill.test.ts 와 같은 이유).
vi.mock("./proxy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./proxy")>();
  return {
    ...actual,
    boardFetch: async (url: string, init: Parameters<typeof actual.boardFetch>[1]) =>
      (await fetch(url, init as unknown as RequestInit)) as unknown as Awaited<
        ReturnType<typeof actual.boardFetch>
      >,
  };
});

import { fillBoardDetail, harvestBoardAttachments } from "./detail-fill";
import { repairStoredAttachmentUrl } from "./attachment-url";
import { parseHtml } from "./html";
import { BOARD_SOURCES } from "./registry";
import type { BoardConfig } from "./types";

const FIX = join(__dirname, "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIX, name), "utf-8");

function cfgOf(id: string): BoardConfig {
  const cfg = BOARD_SOURCES.find((c) => c.id === id);
  if (!cfg) throw new Error(`출처 없음: ${id}`);
  return cfg;
}

/** 상세 채움(`fillBoardDetail`)과 같은 길로 수확한다 — 범위 선택자가 있으면 그 조각만. */
function harvestLikeFill(id: string, html: string, pageUrl: string) {
  const cfg = cfgOf(id);
  const scoped = cfg.attachmentsScopeSelector
    ? parseHtml(html)
        .querySelectorAll(cfg.attachmentsScopeSelector)
        .map((el) => el.outerHTML)
        .join("\n")
    : html;
  return harvestBoardAttachments(scoped, cfg.baseUrl, html, cfg.charset, pageUrl);
}

describe("href·onclick 은 속성 방식으로 푼다 — `&para` 가 「¶」가 되지 않는다", () => {
  it("보건산업진흥원(khidi) 고정본: `&paramMenuId=` 가 그대로 남는다", () => {
    const atts = harvestLikeFill(
      "khidi",
      fixture("w4-khidi-detail.html"),
      "https://www.khidi.or.kr/board/view?linkId=48925580&menuId=MENU01783",
    );
    expect(atts.map((a) => a.url)).toEqual([
      "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C&paramMenuId=MENU01108",
      "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=2&fileDownType=C&paramMenuId=MENU01108",
    ]);
    // 이름·형식은 예전과 같다(주소만 고친다).
    expect(atts.map((a) => [a.name, a.kind])).toEqual([
      ["[공고문] 외국인환자유치사업자 컨설팅 지원사업 참여기업 모집(안).pdf", "pdf"],
      ["(양식)외국인환자 유치사업자 교육·컨설팅 신청서 및 개인정보 이용 동의서.hwp", "hwp"],
    ]);
  });

  it("에너지기술평가원(ketep) 고정본: 새 수확 = 운영에 저장된 망가진 주소를 되살린 값", () => {
    const atts = harvestLikeFill(
      "ketep",
      fixture("ketep-detail.html"),
      "https://www.ketep.re.kr/businessAcment/view?menuId=MENU002080200000000&uni_ancm_id=D202610542",
    );
    // 2026-10-01 운영 DB 에 저장돼 있던 같은 공고(D202610542)의 첨부 주소 넷.
    const stored = [9, 10, 11, 12].map(
      (n) => `https://www.ketep.re.kr/fileDownload?fileKey=29gvT85lmw&fileId=${n}%C2%B6mMenuId=MENU001021100000000`,
    );
    expect(atts.map((a) => a.url)).toEqual(stored.map(repairStoredAttachmentUrl));
    expect(atts.map((a) => a.url)).toEqual(
      [9, 10, 11, 12].map(
        (n) => `https://www.ketep.re.kr/fileDownload?fileKey=29gvT85lmw&fileId=${n}&paramMenuId=MENU001021100000000`,
      ),
    );
    expect(atts.map((a) => [a.name, a.kind])).toEqual([
      ["2026년 에너지특화기업 지정 신청 공고.hwp", "hwp"],
      ["신청서식 및 참고자료(2026년).zip", "zip"],
      ["[매뉴얼] 에너지특화기업_지정신청_전산접수매뉴얼_2026년.pdf", "pdf"],
      ["[매뉴얼]사업자등록증 및 재무제표 제출처-원클릭서비스 매뉴얼.pdf", "pdf"],
    ]);
  });

  const BASE = "https://www.example.or.kr/";

  it("href 의 `&notice_id`·`&currentPage`·`&regNo` 를 그대로 둔다", () => {
    const html =
      `<a href="/board/download.do?bbs=1&notice_id=7">공고문.hwp</a>` +
      `<a href="/files/a.pdf?x=1&currentPage=3">a.pdf</a>` +
      `<a href="/board/download.do?bbs=2&regNo=RGS_0001">b.hwp</a>`;
    expect(harvestBoardAttachments(html, BASE).map((a) => a.url)).toEqual([
      "https://www.example.or.kr/board/download.do?bbs=1&notice_id=7",
      "https://www.example.or.kr/files/a.pdf?x=1&currentPage=3",
      "https://www.example.or.kr/board/download.do?bbs=2&regNo=RGS_0001",
    ]);
  });

  it("진짜 참조(`&amp;`)는 한 번만 풀고, 풀린 `&` 뒤를 다시 이름으로 읽지 않는다", () => {
    const html = `<a href="/download.do?a=1&amp;notice=1">b.hwp</a>`;
    expect(harvestBoardAttachments(html, BASE).map((a) => a.url)).toEqual([
      "https://www.example.or.kr/download.do?a=1&notice=1",
    ]);
  });

  it("속성 이름이 대문자(HREF)여도 같다", () => {
    const html = `<a HREF="/download/file.do?id=1&paramMenuId=M1">c.pdf</a>`;
    expect(harvestBoardAttachments(html, BASE).map((a) => a.url)).toEqual([
      "https://www.example.or.kr/download/file.do?id=1&paramMenuId=M1",
    ]);
  });

  it("onclick 안의 주소(autoRchk)도 `&section` 을 그대로 둔다", () => {
    const html =
      `<a href="#void" onclick="autoRchk('/config/download_home.php?bo_table=notice&section=2&wr_id=5')">d.hwp</a>`;
    const atts = harvestBoardAttachments(html, BASE, html, "utf-8", "https://www.example.or.kr/notification/noticeView.html");
    expect(atts.map((a) => a.url)).toEqual([
      "https://www.example.or.kr/config/download_home.php?bo_table=notice&section=2&wr_id=5",
    ]);
  });

  it("href=\"javascript:location.href='…'\" 안의 `&notice` 도 그대로 둔다", () => {
    const html = `<a href="javascript:location.href='/attach/down?bbs=1&notice=9'">e.pdf</a>`;
    expect(harvestBoardAttachments(html, BASE).map((a) => a.url)).toEqual([
      "https://www.example.or.kr/attach/down?bbs=1&notice=9",
    ]);
  });
});

describe("용인시산업진흥원(ypa) eGov 첨부는 그 사이트의 실제 경로 `/FileDown.do`", () => {
  it("고정본: 세 첨부 모두 `/FileDown.do` — 이름·형식·순서는 그대로", () => {
    const atts = harvestLikeFill(
      "ypa",
      fixture("ypa-detail.html"),
      "https://ybs.ypa.or.kr/poratlAppFormDtl.do?regNo=RGS_0000000000000660",
    );
    expect(atts.map((a) => a.url)).toEqual([
      "https://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_000000000230380&fileSn=2",
      "https://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_000000000230380&fileSn=1",
      "https://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_000000000230380&fileSn=0",
    ]);
    expect(atts.map((a) => [a.name, a.kind])).toEqual([
      ["『2026년 용인시 일자리창출 우수기업 인증제 시행계획』 공고.hwpx", "hwpx"],
      ["(붙임1) 『2026년 일자리창출 우수기업 인증제』 심사항목 및 점수표.hwpx", "hwpx"],
      ["(붙임2) 『2026년 일자리창출 우수기업 인증제』 신청서식.hwpx", "hwpx"],
    ]);
  });

  it("다른 eGov 게시판은 예전 그대로 `/cmm/fms/FileDown.do`", () => {
    const html = `<a href="#" onclick="fn_egov_downFile('FILE_000000000012345','0')">공고문.hwp</a>`;
    expect(harvestBoardAttachments(html, "https://www.gbtp.or.kr/").map((a) => a.url)).toEqual([
      "https://www.gbtp.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000012345&fileSn=0",
    ]);
    expect(harvestBoardAttachments(html, "https://ybs.ypa.or.kr/").map((a) => a.url)).toEqual([
      "https://ybs.ypa.or.kr/FileDown.do?atchFileId=FILE_000000000012345&fileSn=0",
    ]);
  });
});

describe("상세 채움 — 사이트 공통 파일을 첨부로 잡지 않는다·망가진 저장 주소면 도장을 지운다", () => {
  beforeEach(() => {
    updateAnnouncement.mockReset().mockResolvedValue(undefined);
    updateAnnouncementIfEmpty.mockReset().mockResolvedValue(1);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function okFetch(html: string) {
    const bytes = new TextEncoder().encode(html);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader() {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true as const, value: undefined };
              sent = true;
              return { done: false as const, value: bytes };
            },
            cancel: async () => {},
          };
        },
      },
      arrayBuffer: async () => bytes.buffer,
    })));
  }

  const savedAttachments = () =>
    (updateAnnouncement.mock.calls[0][1] as { attachments: { name: string; url: string; kind: string }[] }).attachments;

  it("충북기업진흥원(cba): 공고 첨부 하나만 — 옆 메뉴 전자책(`/ebook/`)은 빠진다", async () => {
    okFetch(fixture("cba-detail.html"));
    const ok = await fillBoardDetail({
      id: "ann-cba",
      source: "cba",
      url: "https://www.cba.ne.kr/home/sub.php?menukey=172&mod=view&no=30851",
      targetText: "",
    }, deps);
    expect(ok).toBe("filled");
    const atts = savedAttachments();
    expect(atts).toEqual([
      {
        name: "붙임2. 공고문(안)_2026년4분기.pdf",
        url: "https://www.cba.ne.kr/base/download/bbs.php?fno=%23%02%B4%3E&bid=%2A%0B%BD9%E6%BCOl&did=%2A%0B%BD%3A%E6%B4Jl",
        kind: "pdf",
      },
    ]);
    expect(atts.some((a) => a.url.includes("/ebook/"))).toBe(false);
  });

  it.each([
    ["exportvoucher-detail.html", "https://www.exportvoucher.com/portal/board/boardView?bbs_id=1&ntt_id=12555"],
    ["w3-ev-detail.html", "https://www.exportvoucher.com/portal/board/boardView?bbs_id=1&ntt_id=12866"],
  ])("수출바우처(%s): 고정 메뉴 「정산가이드」·바닥글 「관리지침」을 첨부로 잡지 않는다", async (file, url) => {
    okFetch(fixture(file));
    const ok = await fillBoardDetail({ id: "ann-ev", source: "exportvoucher", url, targetText: "" }, deps);
    expect(ok).toBe("filled");
    expect(savedAttachments()).toEqual([]);
  });

  const KHIDI_URL = "https://www.khidi.or.kr/board/view?linkId=48925580&menuId=MENU01783";
  const KHIDI_GOOD = [
    "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C&paramMenuId=MENU01108",
    "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=2&fileDownType=C&paramMenuId=MENU01108",
  ];

  /**
   * 저장 주소가 망가진(`%C2%B6`) 줄을 다시 읽으면 **바뀐 것으로** 봐야 한다 — 읽을 때 되살린 값끼리
   * 비교하면 「같다」가 되어, 망가진 주소로 실패하며 찍힌 7일 도장이 안 지워진다.
   */
  it("khidi: 저장 주소가 `%C2%B6` 으로 망가져 있으면 고친 주소를 저장하고 attachmentFillTriedAt 을 지운다", async () => {
    okFetch(fixture("w4-khidi-detail.html"));
    const ok = await fillBoardDetail({
      id: "ann-khidi",
      source: "khidi",
      url: KHIDI_URL,
      targetText: "",
      attachments: [
        {
          name: "[공고문] 외국인환자유치사업자 컨설팅 지원사업 참여기업 모집(안).pdf",
          url: "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=1&fileDownType=C%C2%B6mMenuId=MENU01108",
          kind: "pdf",
        },
        {
          name: "(양식)외국인환자 유치사업자 교육·컨설팅 신청서 및 개인정보 이용 동의서.hwp",
          url: "https://www.khidi.or.kr/fileDownload?titleId=531733&fileId=2&fileDownType=C%C2%B6mMenuId=MENU01108",
          kind: "hwp",
        },
      ],
    }, deps);
    expect(ok).toBe("filled");
    const data = updateAnnouncement.mock.calls[0][1] as Record<string, unknown>;
    expect(savedAttachments().map((a) => a.url)).toEqual(KHIDI_GOOD);
    expect(data.attachmentFillTriedAt).toBeNull();
  });

  it("khidi: 저장 주소가 이미 올바르면 attachmentFillTriedAt 을 건드리지 않는다", async () => {
    okFetch(fixture("w4-khidi-detail.html"));
    const ok = await fillBoardDetail({
      id: "ann-khidi",
      source: "khidi",
      url: KHIDI_URL,
      targetText: "",
      attachments: KHIDI_GOOD.map((url, i) => ({ name: `f${i}`, url, kind: i === 0 ? "pdf" : "hwp" })),
    }, deps);
    expect(ok).toBe("filled");
    const data = updateAnnouncement.mock.calls[0][1] as Record<string, unknown>;
    expect(data.attachmentFillTriedAt).toBeUndefined();
  });
});
