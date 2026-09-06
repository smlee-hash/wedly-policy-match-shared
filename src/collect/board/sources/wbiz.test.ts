import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pagingParamsOf } from "../engine";
import { sessionAttachmentFetch } from "../attachment-session";
import {
  isWbizDropRow,
  parseWbizList,
  wbizConfig,
  wbizCsrfToken,
  wbizDetailAttachments,
} from "./wbiz";
import { safeAttachmentUrl } from "../../attachment-text";
import { isProxyTransportError } from "../proxy";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-06 실측 사업공고 1쪽(`bbsId=BBS_0002&pageIndex=1&searchOp8=`)·상세(`nttId=1042`).
 */
const FIX = join(__dirname, "../__fixtures__");
const listHtml = readFileSync(join(FIX, "wbiz-list.html"), "utf-8");
const detailHtml = readFileSync(join(FIX, "wbiz-detail.html"), "utf-8");
const rows = parseWbizList(listHtml);

describe("여성기업종합지원센터 사업공고 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 9건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      title: "여성기업종합지원센터 서울센터 입주기업 모집 공고(~9.11)",
      detailUrl: "https://www.wbiz.or.kr/notice/bizNewDetail.do?bbsId=BBS_0002&nttId=1050",
      category: "지원사업",
      agency: "여성기업종합지원센터",
    });
  });

  it("신청기간은 dl.i1 칸에서만 집는다 — 제목 꼬리 「(~8. 27.)」가 섞이면 안 된다", () => {
    const r = rows.find((x) => x.detailUrl.includes("nttId=1042"));
    expect(r?.title).toBe("2026년 전남 여성창업보육센터 성장지원사업(~8. 27.)");
    expect(r?.dateText).toBe("2026-08-10 ~ 2026-08-27");
  });

  it("★기간이 안 적힌 줄은 빈 문자열이다 — 지어내지 않는다(실측 9행 중 2행)", () => {
    const blank = rows.filter((r) => r.dateText === "");
    expect(blank.map((r) => r.detailUrl)).toEqual([
      "https://www.wbiz.or.kr/notice/bizNewDetail.do?bbsId=BBS_0002&nttId=1050",
      "https://www.wbiz.or.kr/notice/bizNewDetail.do?bbsId=BBS_0002&nttId=1045",
    ]);
    // 날짜가 있는 행이 7/9 라 `allowUndatedRows` 를 켤 필요가 없다 — 켜면 서식 변경을 못 잡는다.
    expect(wbizConfig.allowUndatedRows).toBeUndefined();
  });

  it("분야 딱지만 분류로 쓰고 상태 딱지(모집중·모집마감)는 뺀다", () => {
    expect(rows.map((r) => r.category)).toEqual([
      "지원사업",
      "BI입주기업",
      "지원사업",
      "BI입주기업",
      "BI입주기업",
      "BI입주기업",
      "BI입주기업",
      "BI입주기업",
      "BI입주기업",
    ]);
    expect(rows.every((r) => !/모집중|모집마감/.test(r.category ?? ""))).toBe(true);
  });

  it("★상세 주소에 쪽 변수를 남기지 않는다", () => {
    expect(
      rows.every((r) =>
        /^https:\/\/www\.wbiz\.or\.kr\/notice\/bizNewDetail\.do\?bbsId=BBS_0002&nttId=\d+$/.test(r.detailUrl),
      ),
    ).toBe(true);
    expect(new Set(rows.map((r) => r.detailUrl)).size).toBe(rows.length);
  });

  it("★쪽 주소에 `searchOp8=` 를 빈값으로 붙인다 — 빼면 사이트가 모집중 1건만 준다", () => {
    expect(wbizConfig.list.url(1)).toBe(
      "https://www.wbiz.or.kr/notice/bizNew.do?bbsId=BBS_0002&pageIndex=1&searchOp8=",
    );
    expect(wbizConfig.list.url(2)).toContain("pageIndex=2");
    expect(pagingParamsOf(wbizConfig)).toContain("pageIndex");
  });
});

describe("거르개 — 시설대관만 버린다", () => {
  it("시설대관은 분류로도 제목으로도 걸린다", () => {
    expect(isWbizDropRow("대관안내", "시설대관")).toBe(true);
    expect(isWbizDropRow("2026년 회의실 대관 안내", "")).toBe(true);
  });

  it("지원사업·BI입주기업·교육행사는 남긴다", () => {
    expect(isWbizDropRow("2026년 전남 여성창업보육센터 성장지원사업(~8. 27.)", "지원사업")).toBe(false);
    expect(isWbizDropRow("경북센터 입주기업 모집 공고", "BI입주기업")).toBe(false);
    expect(isWbizDropRow("여성기업 온라인 교육 안내", "교육·행사")).toBe(false);
  });

  it("시설대관 줄이 섞여 오면 목록에서 빠진다", () => {
    // 첫 번째 「지원사업」 딱지 하나만 바꾼다 — 9행 중 그 한 줄이 빠져 8행이 남는다.
    const html = listHtml.replace('<i class="blue">지원사업</i>', '<i class="orange">시설대관</i>');
    const after = parseWbizList(html);
    expect(after).toHaveLength(8);
    expect(after.some((r) => r.detailUrl.includes("nttId=1050"))).toBe(false);
  });
});

describe("상세 — 본문·첨부(세션 + CSRF POST)", () => {
  it("본문 선택자가 상세 고정본에 실제로 있다(본문이 포스터 그림뿐이라 첨부가 사실상 필수)", () => {
    expect(wbizConfig.detailContentSelector).toBe("div.board_view div.con");
    expect(detailHtml).toContain('<div class="con">');
    expect(detailHtml).toContain("/cmm/cke/imageSrc.do");
  });

  it("★첨부는 POST 다 — atchFileId·fileSn 이 본문으로 나가고 _csrf 는 여기 안 담긴다", () => {
    const atts = wbizDetailAttachments(detailHtml);
    // 실측 첨부는 2개인데 하나가 `도보조금 지원사업_JPG.jpg` 라 그림 거르개가 걷어 낸다.
    expect(atts).toHaveLength(1);
    expect(atts[0]).toEqual({
      name: "2026년도「여성창업보육센터 성장지원사업」사업계획서.hwp",
      url: "https://www.wbiz.or.kr/front/fms/FileDown.do",
      kind: "hwp",
      method: "POST",
      body: "atchFileId=FILE_000000000002454&fileSn=1",
    });
    // 세션마다 새로 받아야 하는 값이라 저장하지 않는다.
    expect(atts.every((a) => !a.body?.includes("_csrf"))).toBe(true);
    expect(safeAttachmentUrl(atts[0].url)).toBe(atts[0].url);
  });

  it("★그림 첨부(jpg)는 담지 않는다 — nttId=1042 의 두 번째 첨부다", () => {
    expect(detailHtml).toContain("도보조금 지원사업_JPG.jpg"); // 고정본에 실물이 있다
    expect(wbizDetailAttachments(detailHtml).map((a) => a.name)).toEqual([
      "2026년도「여성창업보육센터 성장지원사업」사업계획서.hwp",
    ]);
  });

  it("★첨부 상자(div.fileAdd) 밖의 같은 호출은 담지 않는다 — 고정본에 미끼가 심어져 있다", () => {
    expect(detailHtml).toContain("FILE_000000000009999"); // 본문 안 미끼가 실제로 있다
    const atts = wbizDetailAttachments(detailHtml);
    expect(atts.every((a) => !a.name.includes("미끼"))).toBe(true);
    expect(atts.every((a) => !a.body?.includes("9999"))).toBe(true);
  });

  it("★범위 선택자를 흔들면 0건이 된다 — 미끼를 대신 집어 오지 않는다", () => {
    expect(wbizDetailAttachments(detailHtml.replace(/class="fileAdd"/g, 'class="fileAddX"'))).toEqual([]);
  });

  it("CSRF 는 값과 **변수 이름**을 함께 뽑는다 — 사이트가 이름을 바꾸면 값만 맞아도 거부당한다", () => {
    expect(wbizCsrfToken(detailHtml)).toEqual({
      token: "a7c24cbc-4eb0-40ee-83a9-b43f813a08b9",
      field: "_csrf",
    });
    // 이름 칸만 사라지면 값은 그대로 쓰고 이름은 설정의 예비값(_csrf)으로 떨어진다.
    expect(wbizCsrfToken(detailHtml.replace(/hdCsrfNm/g, "hdCsrfNmX"))).toEqual({
      token: "a7c24cbc-4eb0-40ee-83a9-b43f813a08b9",
    });
    expect(wbizCsrfToken("<html>토큰 없음</html>")).toBeNull();
  });

  it("설정이 상세 첨부 손잡이·세션 옵션을 실제로 물고 있다", () => {
    expect(typeof wbizConfig.detailAttachments).toBe("function");
    expect(wbizConfig.attachmentSession).toMatchObject({ warmup: "detail", referer: "detail" });
    expect(wbizConfig.attachmentSession?.csrf?.field).toBe("_csrf");
    expect(wbizConfig.attachmentSession?.csrf?.extract(detailHtml)?.token).toBe(
      "a7c24cbc-4eb0-40ee-83a9-b43f813a08b9",
    );
  });
});

/**
 * ★배선 — 데우기로 받은 **그 세션의** 토큰이 첨부 POST 본문에 실제로 붙는지.
 * 저장해 둔 토큰을 쓰면(다음 회차의 새 세션) 사이트가 거부한다 — 그래서 여기서 재는 것이 핵심이다.
 */
describe("배선 — 상세 세션 쿠키 + 그 쪽의 CSRF 토큰", () => {
  const DETAIL_URL = "https://www.wbiz.or.kr/notice/bizNewDetail.do?bbsId=BBS_0002&nttId=1042";
  const ATTACH_URL = "https://www.wbiz.or.kr/front/fms/FileDown.do";

  function fakeSite(token: string) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (url.includes("bizNewDetail.do")) {
        return {
          status: 200,
          ok: true,
          headers: { get: () => null, getSetCookie: () => [`JSESSIONID=SESS_${token}; path=/; HttpOnly`] },
          text: async () => detailHtml.replace("a7c24cbc-4eb0-40ee-83a9-b43f813a08b9", token),
          body: null,
        } as unknown as Response;
      }
      return { status: 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, body: null } as unknown as Response;
    });
    return { calls, fetchImpl };
  }

  it("첨부 POST 본문 끝에 그 세션의 _csrf 가 붙고 쿠키·Referer 도 함께 나간다", async () => {
    const { calls, fetchImpl } = fakeSite("TOKEN-1");
    const wrapped = sessionAttachmentFetch(wbizConfig, DETAIL_URL, fetchImpl)!;
    expect(wrapped).toBeTypeOf("function");
    await wrapped(ATTACH_URL, {
      method: "POST",
      body: "atchFileId=FILE_000000000002454&fileSn=1",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    // 데우기(상세) → 첨부 순으로 두 번 나간다.
    expect(calls.map((c) => c.url)).toEqual([DETAIL_URL, ATTACH_URL]);
    expect(calls[1].init?.body).toBe("atchFileId=FILE_000000000002454&fileSn=1&_csrf=TOKEN-1");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.Cookie).toContain("JSESSIONID=SESS_TOKEN-1");
    expect(headers.Referer).toBe(DETAIL_URL);
  });

  it("★저장된 옛 토큰을 쓰지 않는다 — 세션이 바뀌면 붙는 값도 바뀐다", async () => {
    const a = fakeSite("TOKEN-A");
    await sessionAttachmentFetch(wbizConfig, DETAIL_URL, a.fetchImpl)!(ATTACH_URL, {
      method: "POST",
      body: "atchFileId=F&fileSn=1",
    });
    const b = fakeSite("TOKEN-B");
    await sessionAttachmentFetch(wbizConfig, DETAIL_URL, b.fetchImpl)!(ATTACH_URL, {
      method: "POST",
      body: "atchFileId=F&fileSn=1",
    });
    expect(a.calls[1].init?.body).toBe("atchFileId=F&fileSn=1&_csrf=TOKEN-A");
    expect(b.calls[1].init?.body).toBe("atchFileId=F&fileSn=1&_csrf=TOKEN-B");
  });

  it("한 공고의 첨부 둘은 데우기를 한 번만 하고 같은 토큰을 나눠 쓴다", async () => {
    const { calls, fetchImpl } = fakeSite("TOKEN-2");
    const wrapped = sessionAttachmentFetch(wbizConfig, DETAIL_URL, fetchImpl)!;
    await wrapped(ATTACH_URL, { method: "POST", body: "atchFileId=F&fileSn=1" });
    await wrapped(ATTACH_URL, { method: "POST", body: "atchFileId=F&fileSn=2" });
    expect(calls.filter((c) => c.url.includes("bizNewDetail.do"))).toHaveLength(1);
    expect(calls[1].init?.body).toBe("atchFileId=F&fileSn=1&_csrf=TOKEN-2");
    expect(calls[2].init?.body).toBe("atchFileId=F&fileSn=2&_csrf=TOKEN-2");
  });

  it("GET 요청에는 본문을 만들어 붙이지 않는다", async () => {
    const { calls, fetchImpl } = fakeSite("TOKEN-3");
    const wrapped = sessionAttachmentFetch(wbizConfig, DETAIL_URL, fetchImpl)!;
    await wrapped(ATTACH_URL, {});
    expect(calls[1].init?.body).toBeUndefined();
  });

  /**
   * ★데우기는 상세 본문을 **상한까지만** 읽는다(2026-09-06 보안 리뷰 4번).
   * `res.text()` 는 끝까지 다 받은 뒤 자르므로, 끝없는 본문을 흘리면 서버 메모리가 그대로 찬다.
   */
  it("★상세 본문이 끝없이 와도 상한에서 끊고 나머지는 취소한다", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 1;
        c.enqueue(chunk); // 끝나지 않는다
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      const res = new Response(body, { status: 200 });
      // 쿠키 도우미가 보는 모양으로 바꿔 끼운다(가짜 게시판과 같은 방식).
      Object.defineProperty(res, "headers", {
        value: { get: () => null, getSetCookie: () => ["JSESSIONID=CAP; path=/"] },
      });
      return res;
    });
    const wrapped = sessionAttachmentFetch(wbizConfig, DETAIL_URL, fetchImpl)!;
    // 토큰이 안 나오므로 통로 탓 오류로 떨어진다 — 여기서 재는 것은 **끝까지 안 읽었다**는 것이다.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await wrapped(ATTACH_URL, { method: "POST", body: "a=1" }).catch(() => {});
    warn.mockRestore();
    expect(cancelled).toBe(true);
    // 400,000바이트 상한이면 64KB 조각을 7개쯤 읽고 멈춘다 — 끝없이 읽지 않는다.
    expect(sent).toBeLessThanOrEqual(400_000 / chunk.byteLength + 2);
  });

  /**
   * ★토큰을 못 뽑으면 **조용히 넘어가지 않는다**(2026-09-06 독립 리뷰 「중요」).
   * 실측: 토큰 없이 보내면 사이트가 200 이 아니라 **404 + 95바이트 HTML** 을 준다 —
   * 그건 뒷단계에서 「파일 형식 실패」로 분류돼 7일 도장이 찍힌다. 통로 탓으로 던져 1시간 도장을 탄다.
   */
  it("★상세에 토큰이 없으면 통로 탓 오류로 던진다 — 7일이 아니라 1시간 뒤 재시도", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string): Promise<Response> => {
      calls.push(url);
      return {
        status: 200,
        ok: true,
        headers: { get: () => null, getSetCookie: () => ["JSESSIONID=X; path=/"] },
        text: async () => detailHtml.replace(/hdCsrfTk/g, "hdCsrfTkX"),
        body: null,
      } as unknown as Response;
    });
    const wrapped = sessionAttachmentFetch(wbizConfig, DETAIL_URL, fetchImpl)!;
    const err = await wrapped(ATTACH_URL, { method: "POST", body: "atchFileId=F&fileSn=1" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isProxyTransportError(err)).toBe(true);
    expect(warn).toHaveBeenCalled();
    // 첨부 요청은 아예 나가지 않았다 — 데우기 한 번뿐이다.
    expect(calls).toEqual([DETAIL_URL]);
    warn.mockRestore();
  });
});

/** 돌연변이 1회 — 선택자·함수 이름이 실제로 일을 하고 있다는 증거. */
describe("돌연변이", () => {
  it("목록 ul class 를 바꾸면 0건이 된다", () => {
    expect(parseWbizList(listHtml.replace(/business_list/g, "business_listX"))).toEqual([]);
  });

  it("fnCommonDownFile 이름이 바뀌면 첨부가 0건이 된다", () => {
    expect(wbizDetailAttachments(detailHtml.replace(/fnCommonDownFile\(/g, "fnCommonDownFileX("))).toEqual([]);
  });

  it("hdCsrfTk id 가 바뀌면 토큰이 null 이다", () => {
    expect(wbizCsrfToken(detailHtml.replace(/hdCsrfTk/g, "hdCsrfTkX"))).toBeNull();
  });

  /**
   * ★변수 **이름**은 사이트가 주는 글자다 — 정규식 재료로 쓰면 안 된다(2026-09-06 보안 리뷰 6번).
   * 짝 안 맞는 괄호가 들어오면 `new RegExp` 가 던지는데, 그 예외에는 통로 탓 표식이 없어
   * 「파일 형식 실패」로 7일 도장이 찍힌다.
   */
  it("★이름에 정규식 특수문자가 와도 던지지 않고 그대로 붙인다", async () => {
    const DETAIL_URL = "https://www.wbiz.or.kr/notice/bizNewDetail.do?bbsId=BBS_0002&nttId=1042";
    const ATTACH_URL = "https://www.wbiz.or.kr/front/fms/FileDown.do";
    const calls: Array<RequestInit | undefined> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push(init);
      if (url.includes("bizNewDetail.do")) {
        return {
          status: 200,
          ok: true,
          headers: { get: () => null, getSetCookie: () => ["JSESSIONID=S; path=/"] },
          text: async () => detailHtml.replace('id="hdCsrfNm" value="_csrf"', 'id="hdCsrfNm" value="a(b"'),
          body: null,
        } as unknown as Response;
      }
      return { status: 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, body: null } as unknown as Response;
    });
    const wrapped = sessionAttachmentFetch(wbizConfig, DETAIL_URL, fetchImpl)!;
    await wrapped(ATTACH_URL, { method: "POST", body: "atchFileId=F&fileSn=1" });
    expect(calls[1]?.body).toBe("atchFileId=F&fileSn=1&a(b=a7c24cbc-4eb0-40ee-83a9-b43f813a08b9");
  });
});
