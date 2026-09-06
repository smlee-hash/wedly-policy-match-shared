import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const updateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    jsonCache: { findUnique: vi.fn(), upsert: vi.fn() },
    policyAnnouncement: {
      count: vi.fn().mockResolvedValue(0),
      update: (...a: unknown[]) => update(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
  },
}));

/**
 * 국내 경유 출처(안양·전북TP…)도 시험에서는 **전역 fetch(stub)** 로 흐르게 한다.
 * 실제 코드는 dispatcher 가 있으면 설치판 undici 의 fetch 를 쓰는데(proxy.ts 주석),
 * 그건 `vi.stubGlobal("fetch")` 가 못 가로채 진짜로 바깥에 나가려다 실패한다.
 * dispatcher 가 없는 출처는 원래도 전역 fetch 라 동작이 같다.
 */
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

import { fillBoardDetail, harvestBoardAttachments, mainbizAttachmentName } from "./detail-fill";
import { parseHtml } from "./html";
import { safeAttachmentUrl } from "../attachment-text";
import { dedupKeyOf } from "../../engine/types";
import { classifyWedlyCategory } from "../../engine/wedly-category";
import { itpConfig } from "./sources/itp";
import { BOARD_SOURCES } from "./registry";

describe("harvestBoardAttachments", () => {
  it("a[href] 파일·download 링크와 스크립트 pdf 경로를 모은다", () => {
    const html = `
      <a href="/boardDownload.es?bid=0102&amp;seq=1">공고문.pdf</a>
      <a href="/files/guide.hwp">안내.hwp</a>
      <script>PDFObject.embed("/attachFiles/board/0102/x.pdf", "#pdfview0");</script>
    `;
    const atts = harvestBoardAttachments(html, "https://www.djtp.or.kr/");
    expect(atts.some((a) => a.url.includes("boardDownload.es") && a.name.includes("공고문"))).toBe(true);
    expect(atts.some((a) => a.url.endsWith("guide.hwp") && a.kind === "hwp")).toBe(true);
    expect(atts.some((a) => a.url.includes("attachFiles") && a.kind === "pdf")).toBe(true);
    const urls = atts.map((a) => a.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("fillBoardDetail", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
    updateMany.mockReset().mockResolvedValue({ count: 1 });
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

  it("★상세를 직접 조달하는 출처가 빈 글을 돌려주면 경고하고 실패로 돌린다(독립 리뷰 4번)", async () => {
    // 아산 헬스케어스파는 본문·첨부가 `var r_data = {…}` 안에만 있다 — 그 이름이 바뀌면 빈 글이
    // 오는데, 예전엔 `empty`(채울 게 없음)로 조용히 끝나 첨부가 사라진 줄도 몰랐다.
    okFetch("<html><body>r_data 가 없는 화면</body></html>");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = await fillBoardDetail({
      id: "ann-hespa",
      source: "hespa",
      url: "https://hespa.or.kr/main/index.php?m_cd=23&b_id=20260615083905479",
      targetText: "",
    });
    expect(ok).toBe("error");
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[policy-detail] 상세 조달이 빈 글을 돌려줌",
      "hespa",
      "https://hespa.or.kr/main/index.php?m_cd=23&b_id=20260615083905479",
    );
  });

  it("API 출처 행은 건드리지 않는다", async () => {
    const ok = await fillBoardDetail({
      id: "ann-1", source: "bizinfo", url: "https://www.bizinfo.go.kr/x", targetText: "",
    });
    expect(ok).toBe("empty");
    expect(update).not.toHaveBeenCalled();
  });

  it("이미 본문이 있으면 채우지 않는다", async () => {
    const ok = await fillBoardDetail({
      id: "ann-1", source: "tp-daejeon", url: "https://www.djtp.or.kr/v/1", targetText: "이미 있음",
    });
    expect(ok).toBe("empty");
    expect(update).not.toHaveBeenCalled();
  });

  it("게시판이고 본문이 비었으면 상세 텍스트와 첨부를 채운다", async () => {
    const html = `<div id="board-view">신청대상 : 중소기업</div>
      <a href="/files/gonggo.pdf">공고문.pdf</a>
      <script>PDFObject.embed("/attachFiles/board/x.pdf", "#p");</script>`;
    okFetch(html);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
    });
    expect(ok).toBe("filled");
    expect(update).toHaveBeenCalledOnce();
    const data = update.mock.calls[0][0] as { data: { targetText: string; attachments: { url: string; kind: string }[] } };
    expect(data.data.targetText).toContain("신청대상");
    expect(data.data.attachments.some((a) => a.kind === "pdf")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("본문이 비어도 첨부가 있으면 저장하고 filled", async () => {
    const html = `<div>본문셀렉터없음</div><a href="/files/gonggo.pdf">공고문.pdf</a>`;
    okFetch(html);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
    });
    expect(ok).toBe("filled");
    const data = update.mock.calls[0][0] as { data: { targetText: string; attachments: { kind: string }[] } };
    expect(data.data.targetText.trim()).toBe("");
    expect(data.data.attachments.some((a) => a.kind === "pdf")).toBe(true);
  });

  /**
   * ★첨부 도장 초기화(2026-09-06 충북TP 실측) — 상세를 다시 읽어 첨부 주소가 저장돼 있던 값과
   * 달라졌으면 `attachmentFillTriedAt` 을 지워 다음 회차가 바로 재시도하게 한다. 안 지우면
   * 옛 실패에서 찍힌 7일 도장에 막혀 고친 새 주소를 못 내려받는다.
   */
  it("첨부 주소가 저장돼 있던 것과 다르면 attachmentFillTriedAt: null 이 update data 에 실린다", async () => {
    const html = `<div id="board-view">신청대상 : 중소기업</div><a href="/files/new.pdf">새파일.pdf</a>`;
    okFetch(html);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
      attachments: [{ name: "옛파일.pdf", url: "https://www.djtp.or.kr/files/old.pdf", kind: "pdf" }],
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.attachmentFillTriedAt).toBeNull();
  });

  it("첨부 주소가 저장된 것과 같으면(순서만 달라도) attachmentFillTriedAt 을 건드리지 않는다", async () => {
    const html = `<div id="board-view">신청대상 : 중소기업</div>` +
      `<a href="/files/a.pdf">a.pdf</a>` +
      `<a href="/files/b.hwp">b.hwp</a>`;
    okFetch(html);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
      // 저장돼 있던 목록은 순서만 반대(b 먼저, a 나중) — URL 집합은 같다.
      attachments: [
        { name: "b.hwp", url: "https://www.djtp.or.kr/files/b.hwp", kind: "hwp" },
        { name: "a.pdf", url: "https://www.djtp.or.kr/files/a.pdf", kind: "pdf" },
      ],
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.attachmentFillTriedAt).toBeUndefined();
  });

  /**
   * ★도장 초기화 열쇠는 **주소 + 본문**이다(2026-09-06 독립 리뷰 「중요」).
   * POST 로만 주는 게시판(산업인력공단 등)은 내려받기 창구가 하나뿐이라 **파일이 바뀌어도
   * 주소는 그대로**다 — 주소만 비교하면 첨부가 통째로 갈렸는데 「같다」로 읽혀 7일 도장이 안 지워진다.
   * (돌연변이: 열쇠를 `a.url` 만으로 되돌리면 이 시험이 깨진다.)
   */
  it("★주소는 같고 본문(body)만 달라도 attachmentFillTriedAt: null 이 실린다", async () => {
    const DOWN = "https://www.hrdkorea.or.kr/cms/download/downloadFile2.hrd";
    // 글자는 전부 ASCII — 산업인력공단은 euc-kr 이라 시험 고정본에 한글을 쓰면 디코딩이 갈린다.
    // 산업인력공단은 국내 경유 전용(requiresProxy) — 설정값이 없으면 요청 자체를 거부한다.
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(`<div class="file_"><a href="#" onclick="goDown('TkVX');">new.hwp</a></div>`);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "hrdk",
      url: "https://www.hrdkorea.or.kr/3/1/1?k=56065",
      targetText: "",
      // 저장돼 있던 값은 **같은 주소**인데 본문(열쇠)만 다르다.
      attachments: [{ name: "old.hwp", url: DOWN, kind: "hwp", method: "POST", body: "attachSeq2=T0xE" }],
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect((data.attachments as { url: string; body?: string }[])[0]).toMatchObject({
      url: DOWN,
      body: "attachSeq2=TkVX",
    });
    expect(data.attachmentFillTriedAt).toBeNull();
  });

  it("주소도 본문도 같으면 attachmentFillTriedAt 을 건드리지 않는다", async () => {
    const DOWN = "https://www.hrdkorea.or.kr/cms/download/downloadFile2.hrd";
    // 산업인력공단은 국내 경유 전용(requiresProxy) — 설정값이 없으면 요청 자체를 거부한다.
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(`<div class="file_"><a href="#" onclick="goDown('U0FNRQ==');">same.hwp</a></div>`);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "hrdk",
      url: "https://www.hrdkorea.or.kr/3/1/1?k=56065",
      targetText: "",
      attachments: [{ name: "same.hwp", url: DOWN, kind: "hwp", method: "POST", body: "attachSeq2=U0FNRQ%3D%3D" }],
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.attachmentFillTriedAt).toBeUndefined();
  });

  it("정상 응답인데 본문·첨부가 둘 다 없으면 empty", async () => {
    okFetch(`<div>셀렉터 없는 페이지</div>`);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
    });
    expect(ok).toBe("empty");
    expect(update).not.toHaveBeenCalled();
  });

  it("오류가 나도 throw 하지 않고 error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fillBoardDetail({
      id: "ann-1", source: "tp-busan", url: "https://www.btp.or.kr/v/1", targetText: "",
    })).resolves.toBe("error");
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("onlyIfEmpty 를 켜면 본문이 아직 빈 행만 채운다", async () => {
    const html = `<div id="board-view">신청대상 : 중소기업</div>
      <a href="/files/gonggo.pdf">공고문.pdf</a>`;
    okFetch(html);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    updateMany.mockResolvedValue({ count: 1 });
    const filled = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
    }, { onlyIfEmpty: true });
    expect(filled).toBe("filled");
    expect(updateMany).toHaveBeenCalledTimes(1);
    const w = updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: { targetText: string } };
    expect(w.where).toEqual({ id: "ann-1", targetText: "" });
    expect(w.data.targetText).toContain("신청대상");
    expect(update).not.toHaveBeenCalled();

    updateMany.mockReset().mockResolvedValue({ count: 0 });
    const skipped = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
    }, { onlyIfEmpty: true });
    expect(skipped).toBe("empty");
    expect(update).not.toHaveBeenCalled();

    updateMany.mockClear();
    const def = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
    });
    expect(def).toBe("filled");
    expect(update).toHaveBeenCalledTimes(1);
    const u = update.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(u.where).toEqual({ id: "ann-1" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  /**
   * ★자금 조달 지도(설계 2026-09-03 §3 · Task 4-b) — 갈래·한도·금리는 저장 때(store.upsertAnnouncements)
   * 뽑는데, 게시판 공고는 **그때 본문이 비어 있다.** 여기서 다시 안 뽑으면 나중에 본문이 찬 공고가
   * 영영 「한도 없음·금리 없음」으로 남아 지도에서 「공고 확인」만 뜬다(store.ts 와 같은 함수를 쓴다).
   */
  it("상세 본문을 채울 때 갈래·한도·금리 다섯 칸도 함께 갱신한다", async () => {
    okFetch(`<div id="board-view">신청대상 : 중소기업 / 운전자금 최대 5,000만원, 대출금리 연 1.5%</div>`);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
      title: "2026년 대전 중소기업육성자금 지원계획 공고",
      summary: "",
      agency: "대전테크노파크",
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.fundingGroup).toBe("policy");
    expect(data.amountText).toBe("최대 5,000만원");
    // Prisma BigInt 칸 — Number 로 넘기면 저장이 거부된다(store.ts 와 같은 규약).
    expect(data.amountMaxWon).toBe(BigInt(50_000_000));
    expect(data.rateText).toBe("연 1.5%");
    expect(data.rateMin).toBe(1.5);
  });

  // ── 2026-09-05: 목록이 잘라 보낸 제목을 상세의 온전한 제목으로 승격(안양) ──
  const acaDetailHtml = (title: string) =>
    `<div class="panel-title view-title h5"><strong>${title}</strong></div>` +
    `<div class="bbs_memo">소비재 관련 안양시 유망기업 우수 제품의 판매촉진을 위하여 모집합니다.</div>` +
    // ★첨부 상자는 **첨부가 없는 상세에도 있다**(실사이트 고정본 aca-detail-noattach.html 실측).
    //  손으로 쓴 HTML 에서 빼 두면 「범위 선택자 미적중」 방어가 여기서 헛발질한다.
    `<ul class="list-group"></ul>`;

  it("detailTitle 설정이 있으면 잘린 제목을 올리고 dedupKey·wedlyCategory 도 함께 고친다", async () => {
    // 안양은 국내 경유 전용(requiresProxy) — 설정값이 없으면 요청 자체를 거부한다.
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(acaDetailHtml("[사업안내] - 2026년 안양시 유망기업 온‧오프라인  유통망 입점 지원사업"));
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "aca",
      url: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
      targetText: "",
      title: "2026년 안양시 유망기업 온‧오프라...",
      summary: "",
      agency: "안양산업진흥원",
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    const full = "2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업";
    expect(data.title).toBe(full);
    // ★열쇠가 함께 안 바뀌면 기업마당의 같은 공고와 영영 안 묶인다.
    expect(data.dedupKey).toBe(dedupKeyOf({ title: full, agency: "안양산업진흥원" }));
    expect(data.wedlyCategory).toBe(classifyWedlyCategory(full, ""));
  });

  it("★본문·첨부가 없어도 제목이 올랐으면 제목만 갱신하고 title-only 로 끝낸다", async () => {
    // 예전엔 빈 본문 관문에서 먼저 돌아가 승격이 영영 안 일어났다(독립 검사 지적 1).
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(
      `<div class="panel-title view-title h5"><strong>[사업안내] - 2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업</strong></div><ul class="list-group"></ul>`,
    );
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "aca",
      url: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
      targetText: "",
      title: "2026년 안양시 유망기업 온‧오프라...",
      summary: "",
      agency: "안양산업진흥원",
      sourceId: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
    });
    expect(ok).toBe("title-only");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    const full = "2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업";
    expect(data.title).toBe(full);
    expect(data.dedupKey).toBe(dedupKeyOf({ title: full, agency: "안양산업진흥원" }));
    // 본문·첨부는 없었으니 건드리지 않는다.
    expect(data.targetText).toBeUndefined();
    expect(data.attachments).toBeUndefined();
  });

  it("본문·첨부도 없고 제목도 안 올랐으면 예전대로 empty", async () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(
      `<div class="panel-title view-title h5"><strong>[사업안내] - 전혀 다른 사업</strong></div><ul class="list-group"></ul>`,
    );
    const ok = await fillBoardDetail({
      id: "ann-1", source: "aca", url: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
      targetText: "", title: "2026년 안양시 유망기업 온‧오프라...", summary: "", agency: "안양산업진흥원",
    });
    expect(ok).toBe("empty");
    expect(update).not.toHaveBeenCalled();
  });

  it("승격된 제목이 detailTitle.drop 에 걸리면 closed 로 저장한다", async () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(
      acaDetailHtml("[사업안내] - 2025 지식재산권 출원 지원사업 (선정 결과 발표)"),
    );
    const ok = await fillBoardDetail({
      id: "ann-1", source: "aca", url: "https://aca.or.kr/support/supportBizView.do?sbIdx=524",
      targetText: "", title: "2025 지식재산권 출원 지원사업 (...", summary: "", agency: "안양산업진흥원",
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.title).toBe("2025 지식재산권 출원 지원사업 (선정 결과 발표)");
    expect(data.status).toBe("closed");
  });

  it("제목이 아직 잘려 있으면 줄마다 유일한 임시 열쇠를 준다", async () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    // 상세 제목이 무관해 승격이 안 되지만 본문은 있는 경우 — 열쇠는 임시로 남아야 한다.
    okFetch(acaDetailHtml("[사업안내] - 2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업"));
    const ok = await fillBoardDetail({
      id: "ann-1", source: "aca", url: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
      targetText: "", title: "2026년 안양시 유망기업 온‧오프라...", summary: "", agency: "안양산업진흥원",
      sourceId: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    // 이 경우는 승격됐으므로 정상 열쇠(임시 표식 없음)
    expect(String(data.dedupKey)).not.toContain("#");
  });

  /**
   * ★상세 제목이 잘린 앞부분과 **길이까지 같아도** 승격된다(안양 sbIdx=535, 2026-09-06 실측).
   * title-upgrade.ts 가 「상세가 stem 보다 길어야만」 승격하던 예전 규칙이면 여기서 null 로
   * 떨어져 말줄임이 안 떼어지고 dedupKey 가 임시 열쇠(`#…`)로 영영 남는다.
   */
  it("상세 제목이 잘린 앞부분과 길이까지 같아도 승격되어 정상 열쇠로 바뀐다", async () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(acaDetailHtml("[사업안내] - 2026년 중소기업 수출보험 지원"));
    const ok = await fillBoardDetail({
      id: "ann-1", source: "aca", url: "https://aca.or.kr/support/supportBizView.do?sbIdx=535",
      targetText: "", title: "2026년 중소기업 수출보험 지원...", summary: "", agency: "안양산업진흥원",
      sourceId: "https://aca.or.kr/support/supportBizView.do?sbIdx=535",
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.title).toBe("2026년 중소기업 수출보험 지원");
    // 승격됐으므로 정상 열쇠(임시 표식 없음) — 실패하면 여전히 잘린 제목이라 `#` 붙은 임시 열쇠가 남는다.
    expect(String(data.dedupKey)).not.toContain("#");
  });

  /**
   * ★상자 이름이 바뀌면(`ul.list-group`→`ul.list-group-x`) 예전엔 첨부 0건으로 **조용히** 끝났다.
   * 안양·시흥처럼 본문 선택자가 없거나 본문이 짧은 게시판은 그대로 빈 결과로 굳어,
   * 구조화가 첨부의 존재조차 모른 채 제목만으로 판정을 확정한다(2026-09-06 독립 리뷰 2번).
   */
  it("★첨부 영역 선택자가 하나도 안 잡히면 경고하고 실패로 남긴다 — 조용한 0건 금지", async () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    okFetch(acaDetailHtml("[사업안내] - 2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업").replace("list-group", "list-group-x"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = await fillBoardDetail({
      id: "ann-1", source: "aca", url: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
      targetText: "", title: "2026년 안양시 유망기업 온‧오프라...", summary: "", agency: "안양산업진흥원",
    });
    expect(ok).toBe("error");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("첨부 영역 선택자 미적중");
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  /**
   * ★옵션을 안 켠 게시판은 예전 그대로다(2026-09-06 판정). 범위 선택자를 쓰는 60곳 중 42곳은
   * 본문 선택자도 있는데, 「첨부가 없으면 상자도 없는」 사이트라면 첨부 없는 공고가 본문을
   * 잘 받아 놓고도 버려져 7일마다 헛돈다 — 실물로 확인한 3곳(sida·cbtp·aca)만 켠다.
   */
  it("★옵션(attachmentsScopeRequired)을 안 켠 게시판은 0적중이어도 실패가 아니다 — 예전대로 0건", async () => {
    // 인천 비즈OK 는 범위 선택자(div.board_view)만 있고 옵션은 없다.
    expect(BOARD_SOURCES.find((c) => c.id === "bizok")?.attachmentsScopeRequired).toBeUndefined();
    okFetch(`<div id="content">본문만 있고 첨부 상자가 없다</div>`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = await fillBoardDetail({
      id: "ann-1", source: "bizok", url: "https://bizok.incheon.go.kr/icbizok/12345",
      targetText: "", title: "인천 지원사업", summary: "", agency: "인천광역시",
    });
    expect(ok).not.toBe("error");
    expect(warn).not.toHaveBeenCalledWith("[policy-detail] 첨부 영역 선택자 미적중", "bizok", expect.anything());
  });

  it("★옵션을 켠 3곳만 — 실물로 「첨부 없어도 상자는 있다」를 확인한 게시판", () => {
    const on = BOARD_SOURCES.filter((c) => c.attachmentsScopeRequired).map((c) => c.id).sort();
    expect(on).toEqual(["aca", "cbtp", "sida"]);
    // 옵션을 켰으면 범위 선택자가 반드시 있어야 한다 — 없으면 이 옵션은 아무 일도 안 한다.
    for (const c of BOARD_SOURCES.filter((x) => x.attachmentsScopeRequired)) {
      expect(c.attachmentsScopeSelector, `${c.id} 에 범위 선택자가 없다`).toBeTruthy();
    }
  });

  it("detailTitle 이 없는 게시판은 제목을 건드리지 않는다", async () => {
    okFetch(`<div id="board-view">신청대상 : 중소기업</div>`);
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
      title: "2026년 대전 중소기업육성자금 지원계획 공고",
      summary: "",
      agency: "대전테크노파크",
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.title).toBeUndefined();
    expect(data.dedupKey).toBeUndefined();
  });

  it("상세 제목이 목록과 무관하면 제목을 안 건드린다 — 선택자가 틀린 날 통째로 다른 공고가 되지 않게", async () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "http://example.invalid:8080");
    // 잘린 앞부분보다 **길게** 둔다 — 짧으면 길이 검사만으로 걸려 접두어 검사를 못 잰다.
    okFetch(acaDetailHtml("안양산업진흥원 사업신청 안내 — 기업지원사업 통합 공고 목록 페이지입니다"));
    const ok = await fillBoardDetail({
      id: "ann-1",
      source: "aca",
      url: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
      targetText: "",
      title: "2026년 안양시 유망기업 온‧오프라...",
      summary: "",
      agency: "안양산업진흥원",
    });
    expect(ok).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.title).toBeUndefined();
    expect(data.dedupKey).toBeUndefined();
  });

  it("못 뽑은 칸은 아예 안 싣는다 — 저장된 갈래·한도를 빈 값으로 덮지 않는다", async () => {
    okFetch(`<div id="board-view">신청대상 : 소상공인</div>`);
    const row = {
      id: "ann-1",
      source: "tp-daejeon",
      url: "https://www.djtp.or.kr/board.es?mid=a20102000000&bid=0102&act=view&list_no=9",
      targetText: "",
      title: "2026년 소상공인 특별자금 시행 계획",
      summary: "",
    };
    // 구조화 단계(structurize.ts)는 소관기관을 안 넘긴다 — 그 자리에서 갈래가 안 잡힌다고
    // 저장된 값을 ""로 덮으면 지도에서 그 공고가 통째로 사라진다.
    expect(await fillBoardDetail(row)).toBe("filled");
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    for (const k of ["fundingGroup", "amountText", "amountMaxWon", "rateText", "rateMin"]) {
      expect(Object.keys(data)).not.toContain(k);
    }

    // 「안 싣는다」가 기능이 죽은 것이 아님을 확인 — 소관기관까지 주면 그 자리에서 갈래가 잡힌다.
    update.mockClear();
    expect(await fillBoardDetail({ ...row, agency: "서울신용보증재단" })).toBe("filled");
    expect((update.mock.calls[0][0] as { data: Record<string, unknown> }).data.fundingGroup).toBe("guarantee");
  });
});

/**
 * ★자바스크립트 내려받기 갈래 — 실사이트 상세 고정본으로 잰다(2026-09-03 실측).
 * 여기 6곳은 「href 가 파일 확장자이거나 download 를 담고 있는가」 검사만으로는 첨부를 한 건도
 * 못 집던 게시판이다. 각 주소는 실제로 curl 로 받아 첫 바이트까지 확인했다(주석에 결과).
 */
const FIX = join(__dirname, "__fixtures__");
const readFix = (n: string) => readFileSync(join(FIX, n), "utf-8");

describe("harvestBoardAttachments — 자바스크립트 내려받기 갈래(실사이트 고정본)", () => {
  it("서울신용보증재단: common.download(bno,'serial') → /download/{bno}/{serial}.do?mng_cd=", () => {
    const html = readFix("seoulsinbo-detail.html");
    const scoped = parseHtml(html)
      .querySelectorAll("div.info_input_each.for_web")
      .map((el) => el.outerHTML)
      .join("\n");
    expect(scoped).not.toBe("");
    // 범위를 좁히면 게시판 코드(`var mng_cd`)가 범위 밖으로 빠진다 — 쪽 전체를 함께 넘긴다.
    const atts = harvestBoardAttachments(scoped, "https://www.seoulshinbo.co.kr/", html);
    expect(atts).toHaveLength(2);
    // 실호출 200 / %PDF-1.6 / 122,316바이트(2026-09-03).
    expect(atts.map((a) => a.url)).toContain(
      "https://www.seoulshinbo.co.kr/download/23384/46eca760-6f1b-4ec1-ac6f-597729a2e8d3.do?mng_cd=STRY9788",
    );
    expect(atts.map((a) => a.name)).toEqual([
      "안심통장 4호 공고문.hwpx",
      "안심통장 4호 공고문.pdf",
    ]);
    expect(atts.map((a) => a.kind).sort()).toEqual(["hwpx", "pdf"]);
  });

  it("서울신용보증재단: 게시판 코드를 못 읽으면 첨부를 만들지 않는다 — mng_cd 없는 주소는 HTTP 400", () => {
    const html = readFix("seoulsinbo-detail.html").replace('var mng_cd = "STRY9788"', 'var mng_cd_x = "STRY9788"');
    const scoped = parseHtml(html)
      .querySelectorAll("div.info_input_each.for_web")
      .map((el) => el.outerHTML)
      .join("\n");
    expect(harvestBoardAttachments(scoped, "https://www.seoulshinbo.co.kr/", html)).toEqual([]);
  });

  it("NIPA: 확장자도 download 글자도 없는 /comm/getFile?…fileTy=ATTACH 를 첨부로 본다", () => {
    const atts = harvestBoardAttachments(readFix("nipa-detail.html"), "https://www.nipa.kr/");
    expect(atts.length).toBe(4);
    // 실호출 200 / OLE(hwp) / 9,665,536바이트(2026-09-03).
    expect(atts[0].url).toBe(
      "https://www.nipa.kr/comm/getFile?srvcId=BBSTY1&upperNo=W3zIUhhev9IWDxVQv86TEw==&fileTy=ATTACH&fileNo=vQ^0YfEiZ3XCWHBQbGfUvg==",
    );
    // 주소엔 확장자가 없지만 링크 글자에 파일 이름이 있어 형식이 잡힌다.
    // 「(파일크기: 9 MB )」 꼬리를 떼야 확장자가 이름 끝에 온다.
    expect(atts[0].name).toBe("붙임_2._2026_KoVAC_XR_쇼룸_전시_입주_기업_2차_모집_공고문.hwp");
    expect(atts.map((a) => a.kind)).toEqual(["hwp", "hwp", "hwp", "zip"]);
  });

  /**
   * ★크기 표기 지우개는 **이름 끝에서만** 문다(2026-09-06 적대 리뷰).
   * 앵커가 없으면 이름 한가운데 든 괄호(「4K 영상 제작(4K) 지원사업」)까지 지워져 **이름이 달라진다**.
   */
  it("크기 표기는 이름 끝에서만 지운다 — 한가운데 (4K) 는 남긴다", () => {
    const atts = harvestBoardAttachments(
      '<a href="/a/b.hwp">4K 영상 제작(4K) 지원사업.hwp [59.6 KB]</a>',
      "https://x.kr/",
    );
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe("4K 영상 제작(4K) 지원사업.hwp");
    expect(atts[0].kind).toBe("hwp");
  });

  it("꼬리 낱말 뒤의 크기 표기도 지운다 — 낱말을 먼저 떼기 때문", () => {
    const atts = harvestBoardAttachments(
      '<a href="/a/c.pdf">모집공고.pdf (304.2KB) 내려받기</a>',
      "https://x.kr/",
    );
    expect(atts[0].name).toBe("모집공고.pdf");
    expect(atts[0].kind).toBe("pdf");
  });

  it("B 없는 크기 표기 (88.9K) 도 지운다 — 의정부시 기업지원센터 실측 서식", () => {
    const atts = harvestBoardAttachments(
      '<a href="/bbs/download.php?wr_id=1&no=0"><strong>별첨1 공고문.pdf</strong> (88.9K)</a>',
      "https://www.uesc.or.kr/",
    );
    expect(atts[0].name).toBe("별첨1 공고문.pdf");
    expect(atts[0].kind).toBe("pdf");
  });

  it("산업통상자원부: javascript:location.href='/attach/down/…' 를 절대주소로 푼다", () => {
    const html = readFix("motie-detail.html");
    const scoped = parseHtml(html)
      .querySelectorAll("div.detail-info li.info-down")
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, "https://www.motir.go.kr/");
    expect(atts.length).toBeGreaterThanOrEqual(2);
    expect(atts.map((a) => a.url)).toContain(
      "https://www.motir.go.kr/attach/down/c26df36c4f964b1523b31be51e734922/1285fcdd7c079cd133cdabdb60f4a5b5/778bdbf5db9ced7c8fd52756c00bf0cd",
    );
    // 크기 꼬리 「[47.9 KB]」를 떼야 이름에서 형식이 잡힌다.
    expect(atts.map((a) => a.name)).toContain("2026-578_민간자격 등록폐지 공고(산업통상부).pdf");
    expect(atts.map((a) => a.kind).sort()).toEqual(["hwpx", "pdf"]);
    // 「바로보기」(/attach/viewer/…)는 첨부가 아니다 — 같은 파일을 두 번 세지 않는다.
    expect(atts.some((a) => a.url.includes("/attach/viewer/"))).toBe(false);
  });

  it("경기도경제과학진흥원: href 에 든 fn_egov_downFile 도 onclick 과 똑같이 집는다", () => {
    const atts = harvestBoardAttachments(readFix("gbsa-detail.html"), "https://www.gbsa.or.kr/");
    // 실호출 200 / OLE(hwp) / 112,128바이트(2026-09-03).
    expect(atts.map((a) => a.url)).toContain(
      "https://www.gbsa.or.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000126614&fileSn=1",
    );
    const f = atts.find((a) => a.url.includes("FILE_000000000126614"))!;
    expect(f.name).toBe("2026년_창업기업_오프라인_판로지원_참여기업_모집공고(팝업스토어,_오프라인기획전)_260703.hwp");
    expect(f.kind).toBe("hwp");
  });

  it("인천테크노파크: fncFileDownload('bbs','파일') → /common/COM_FILEDOWN.ASP?a=bbs&b=파일", () => {
    const html = readFix("itp-detail.html");
    // 첨부는 본문 상자 밖 `dl.view > dd.vdd` 에 있다 — 설정도 같은 범위를 쓴다.
    const scoped = parseHtml(html)
      .querySelectorAll(itpConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, "https://itp.or.kr/");
    // 실호출 200 / %PDF-1.6 / 937,758바이트(2026-09-03).
    expect(atts.map((a) => a.url)).toContain(
      "https://itp.or.kr/common/COM_FILEDOWN.ASP?a=bbs&b=2607311446010169552028.pdf",
    );
    const f = atts.find((a) => a.url.includes("2607311446010169552028"))!;
    expect(f.name).toBe("[공고문] 2026년 인천광역시 중소기업육성자금 지원 공고(8차).pdf");
    expect(f.kind).toBe("pdf");
    // 옛 코드는 `fncFileDownload` 의 「Download」 글자에 걸려 javascript: 문자열을 그대로 저장했다.
    expect(atts.every((a) => a.url.startsWith("https://"))).toBe(true);
  });

  it("한국산업기술기획평가원: f_bsnsAncmFileDownload → /fileDownLoad.do (menuId 까지 붙여야 200)", () => {
    const html = readFix("keit-detail.html");
    const scoped = parseHtml(html).querySelectorAll("table#table-response").map((el) => el.outerHTML).join("\n");
    const atts = harvestBoardAttachments(scoped, "https://itech.keit.re.kr/");
    expect(atts.length).toBeGreaterThanOrEqual(9);
    // 실호출 200 / OLE(hwp) / 110,592바이트(2026-09-03). menuId 를 빼면 404.
    expect(atts.map((a) => a.url)).toContain(
      "https://itech.keit.re.kr/fileDownLoad.do?atchFileId=FzJdhO0bZUoI%2BMXhnpQaJA%3D%3D&orgEdmsId=rByFaOEYYPjcICfCybqiIA%3D%3D&fileCrtSe=NA1001&menuId=02000000",
    );
    expect(atts.some((a) => a.name.endsWith("공고문.hwp") && a.kind === "hwp")).toBe(true);
  });

  it("★판정기를 망가뜨려 본다 — 함수 이름이 바뀌면 그 게시판 첨부가 0건이 된다", () => {
    const swap = (n: string, from: string, to: string) => readFix(n).replaceAll(from, to);
    expect(
      harvestBoardAttachments(swap("gbsa-detail.html", "fn_egov_downFile", "fn_egov_downFileX"), "https://www.gbsa.or.kr/"),
    ).toEqual([]);
    expect(
      harvestBoardAttachments(swap("nipa-detail.html", "fileTy=ATTACH", "fileTy=ATTACHX"), "https://www.nipa.kr/"),
    ).toEqual([]);
    const keitBroken = parseHtml(swap("keit-detail.html", "f_bsnsAncmFileDownload", "f_bsnsAncmFileDownloadX"))
      .querySelectorAll("table#table-response").map((el) => el.outerHTML).join("\n");
    expect(harvestBoardAttachments(keitBroken, "https://itech.keit.re.kr/")).toEqual([]);
  });

  it("여섯 곳 주소의 호스트가 모두 첨부 허용 명부 안에 있다 — 아니면 내려받기 단계가 통째로 막는다", () => {
    const cases: Array<[string, string, string | undefined]> = [
      ["seoulsinbo-detail.html", "https://www.seoulshinbo.co.kr/", "div.info_input_each.for_web"],
      ["nipa-detail.html", "https://www.nipa.kr/", undefined],
      ["motie-detail.html", "https://www.motir.go.kr/", "div.detail-info li.info-down"],
      ["gbsa-detail.html", "https://www.gbsa.or.kr/", undefined],
      ["itp-detail.html", "https://itp.or.kr/", itpConfig.attachmentsScopeSelector],
      ["keit-detail.html", "https://itech.keit.re.kr/", "table#table-response"],
    ];
    for (const [file, base, scope] of cases) {
      const html = readFix(file);
      const target = scope
        ? parseHtml(html).querySelectorAll(scope).map((el) => el.outerHTML).join("\n")
        : html;
      const atts = harvestBoardAttachments(target, base, html);
      expect(atts.length).toBeGreaterThan(0);
      for (const a of atts) expect(safeAttachmentUrl(a.url)).not.toBeNull();
    }
  });
});

describe("첨부 수확기 — 코덱스 지적 3건(2026-09-03)", () => {
  const base = "https://www.seoulshinbo.co.kr/wbase/contents/bbs/view/23384?mng_cd=STRY9788&pageIndex=1";

  it("서울신보 게시판 코드는 인라인 스크립트가 없으면 상세 주소의 mng_cd 로 대신한다", () => {
    const html = `<div class="file"><a href="javascript:common.download('23384','1')">안심통장 안내.hwpx</a></div>`;
    const out = harvestBoardAttachments(html, base, "<html><body>스크립트 없음</body></html>");
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("/download/23384/1.do?mng_cd=STRY9788");
  });

  it("javascript:location.href 갈래는 같은 사이트 안의 내려받기 경로만 받고 바깥 주소는 버린다", () => {
    const html =
      `<a href="javascript:location.href='https://evil.example/attach/viewer/x'">공고문.pdf</a>` +
      `<a href="javascript:location.href='/attach/down/123'">공고문(진짜).pdf</a>`;
    const out = harvestBoardAttachments(html, "https://www.motie.go.kr/kor/article/ATCL2826a2625/71295/view");
    expect(out.map((a) => a.url)).toEqual(["https://www.motie.go.kr/attach/down/123"]);
  });

  it("★autoRchk 상대경로는 게시판 뿌리가 아니라 **상세 문서 주소** 기준으로 푼다", () => {
    // 파일 이름이 주소 끝에 오지 않는 모양을 쓴다 — 「스크립트 안 파일 경로」 갈래(EMBEDDED_FILE)가
    // 같은 글자를 게시판 뿌리 기준으로 한 번 더 집어 두 줄이 되는 것을 피한다(그 갈래는 이번 범위 밖).
    const html = `<a href="#void" onclick="autoRchk('downloads/get.php?file=a.hwp&z=1')">공고문.hwp</a>`;
    const out = harvestBoardAttachments(
      html,
      "https://www.sida.kr/",
      html,
      "utf-8",
      "https://www.sida.kr/notification/noticeView.html?uid=1144",
    );
    expect(out.map((a) => a.url)).toEqual([
      "https://www.sida.kr/notification/downloads/get.php?file=a.hwp&z=1",
    ]);
  });

  it("★autoRchk 안의 JS 이스케이프(\\\" · \\')를 문자열 끝으로 오해하지 않는다", () => {
    const html =
      `<a href="#void" onclick=\'autoRchk("/config/download.php?filename=O\\"Brien.hwp")\'>큰따옴표.hwp</a>` +
      `<a href="#void" onclick="autoRchk(\'/config/download.php?filename=O\\\'Neil.hwp\')">작은따옴표.hwp</a>`;
    const out = harvestBoardAttachments(html, "https://www.sida.kr/", html, "utf-8", "https://www.sida.kr/x.html");
    expect(out.map((a) => decodeURIComponent(new URL(a.url).search))).toEqual([
      '?filename=O"Brien.hwp',
      "?filename=O'Neil.hwp",
    ]);
  });

  it("공고문·모집요강이 접수 매뉴얼·서식보다 앞에 온다 — 첨부 본문 읽기가 앞 파일부터라서", () => {
    const html =
      `<a href="/files/manual.pdf">온라인 연구개발과제 접수매뉴얼.pdf</a>` +
      `<a href="/files/form.hwp">품목개요서 양식.hwp</a>` +
      `<a href="/files/notice.hwp">신규지원 대상과제 공고문.hwp</a>` +
      `<a href="/files/guide.pdf">사업 안내문.pdf</a>`;
    const out = harvestBoardAttachments(html, "https://srome.keit.re.kr/srome/biz/view");
    expect(out.map((a) => a.name)).toEqual([
      "신규지원 대상과제 공고문.hwp",
      "사업 안내문.pdf",
      "온라인 연구개발과제 접수매뉴얼.pdf",
      "품목개요서 양식.hwp",
    ]);
  });
});

/**
 * ★상세에만 있는 접수기간 칸(`BoardConfig.detailApplyPeriod` — 2026-09-06 신설).
 * 고정본은 메인비즈 실측 상세(`bidx=5906`) 그대로다.
 */
describe("detailApplyPeriod — 상세 기간 칸을 접수기간으로 읽는다", () => {
  const mainbizDetail = readFileSync(join(__dirname, "__fixtures__/mainbiz-detail.html"), "utf-8");
  const ROW = {
    id: "ann-mainbiz",
    source: "mainbiz",
    sourceId: "https://www.mainbiz.or.kr/notice/company.asp?bidx=5906&gbn=2&smem=2&bgbn=V",
    url: "https://www.mainbiz.or.kr/notice/company.asp?bidx=5906&gbn=2&smem=2&bgbn=V",
    targetText: "",
    title: "[월드옥타] 2026 수출컨소시엄 부스기업 모집",
    summary: "",
    agency: "메인비즈협회",
  };

  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
    updateMany.mockReset().mockResolvedValue({ count: 1 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("마감이 아직이면 applyStart·applyEnd 를 쓰고 status 는 open 이다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    okFetch(mainbizDetail);
    const ok = await fillBoardDetail(ROW);
    expect(ok).toBe("filled");
    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect((data.applyStart as Date).toISOString()).toBe("2026-09-03T15:00:00.000Z"); // KST 09-04 00:00
    expect((data.applyEnd as Date).toISOString()).toBe("2026-09-09T14:59:59.000Z"); // KST 09-09 23:59:59
    expect(data.applyPeriodText).toBe("2026-09-04 ~ 2026-09-09");
    expect(data.status).toBe("open");
  });

  it("마감이 지났으면 같은 자리에서 status 를 closed 로 쓴다 — 저장 단계와 같은 기준", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    okFetch(mainbizDetail);
    const ok = await fillBoardDetail(ROW);
    expect(ok).toBe("filled");
    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("closed");
    expect((data.applyEnd as Date).toISOString()).toBe("2026-09-09T14:59:59.000Z");
  });

  /** ★판정기를 망가뜨려 본다 — 기간 칸을 지우면 날짜 칸을 아예 안 쓴다(값을 지어내지 않는다). */
  it("기간 칸 라벨을 바꾸면 applyStart·applyEnd·status 를 안 쓴다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    okFetch(mainbizDetail.replaceAll("기간 :", "게시 :"));
    const ok = await fillBoardDetail(ROW);
    expect(ok).toBe("filled");
    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("applyStart");
    expect(data).not.toHaveProperty("applyEnd");
    expect(data).not.toHaveProperty("status");
  });

  /**
   * ★「시작·끝이 **둘 다** 나올 때만 쓴다」는 방어를 실제로 잰다(2026-09-06 리뷰 보강7).
   * `detailApplyPeriodOf` 의 `if (start && end)` 를 `||` 로 바꾸면 이 시험이 깨진다 —
   * 한쪽만 읽고 쓰면 「상시」·「예산 소진 시까지」 공고에 없는 마감이 생긴다.
   */
  it("★기간이 반쪽(상시·예산 소진 시까지)이면 날짜 칸을 아예 안 쓴다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    // 마지막 것은 **시작만 읽히는** 실제 반쪽이다 — 달력에 없는 끝 날짜(2월 30일)라
    // `parseApplyPeriod` 가 end 만 null 로 돌려준다. `&&` 를 `||` 로 바꾸면 여기서 깨진다.
    for (const half of [
      "2026-09-04 ~ 예산 소진 시까지",
      "2026-09-04 ~ 상시",
      "상시 모집",
      "2026-09-04 ~ 2026-02-30",
    ]) {
      update.mockClear();
      okFetch(mainbizDetail.replace("2026-09-04 ~ 2026-09-09", half));
      const ok = await fillBoardDetail(ROW);
      expect(ok, half).toBe("filled");
      const data = update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data, half).not.toHaveProperty("applyStart");
      expect(data, half).not.toHaveProperty("applyEnd");
      expect(data, half).not.toHaveProperty("status");
    }
  });

  it("이웃 칸(작성일·조회·진행상태)을 기간으로 오독하지 않는다 — strip 이 울타리다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    // 기간 칸만 지우고 작성일·진행상태는 그대로 둔다.
    okFetch(mainbizDetail.replace(/<span class="each">기간 :[\s\S]*?<\/span>\s*<\/span>/, ""));
    await fillBoardDetail(ROW);
    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("applyStart");
  });

  /** ★메인비즈 첨부 갈래 — 주소에 확장자가 없고 이름이 `?filename=` 안에 있다. */
  it("메인비즈 첨부를 실제로 건져 온다(주소는 원문 인코딩 그대로, 이름은 filename 값)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    okFetch(mainbizDetail);
    await fillBoardDetail(ROW);
    const data = update.mock.calls[0][0].data as {
      attachments: { name: string; url: string; kind: string }[];
    };
    expect(data.attachments).toHaveLength(1);
    expect(data.attachments[0].name).toBe(
      "[WORLD-OKTA] 2026 수출컨소시엄 부스기업모집 안내문1.hwp",
    );
    expect(data.attachments[0].kind).toBe("hwp");
    // 실호출 200 + Content-Disposition + 2,184,192바이트 hwp 를 받은 그 주소다(퍼센트·+ 보존).
    expect(data.attachments[0].url).toBe(
      "https://www.mainbiz.or.kr/lib/file_down_new.asp?filename=" +
        "%5BWORLD%2DOKTA%5D+2026+%EC%88%98%EC%B6%9C%EC%BB%A8%EC%86%8C%EC%8B%9C%EC%97%84+" +
        "%EB%B6%80%EC%8A%A4%EA%B8%B0%EC%97%85%EB%AA%A8%EC%A7%91+%EC%95%88%EB%82%B4%EB%AC%B81%2Ehwp&furl=16",
    );
  });

  it("★호스트가 다르면 이 갈래를 안 탄다 — 남의 file_down_new.asp 를 첨부로 저장하지 않는다", () => {
    const html = `<a href="/lib/file_down_new.asp?filename=%EA%B3%B5%EA%B3%A0%2Ehwp&furl=1">첨부</a>`;
    expect(harvestBoardAttachments(html, "https://www.example.or.kr/")).toHaveLength(0);
    expect(harvestBoardAttachments(html, "https://www.mainbiz.or.kr/")).toHaveLength(1);
    expect(mainbizAttachmentName("/lib/file_down_new.asp?filename=x.hwp", "https://www.mainbiz.or.kr/")).toBe(
      "x.hwp",
    );
    expect(mainbizAttachmentName("/lib/file_down_new.asp?filename=", "https://www.mainbiz.or.kr/")).toBeNull();
    expect(mainbizAttachmentName("/files/a.hwp", "https://www.mainbiz.or.kr/")).toBeNull();
  });
});
