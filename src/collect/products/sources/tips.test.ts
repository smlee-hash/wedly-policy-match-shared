import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(2026-09-03 10:21 실측,
 * `https://www.jointips.or.kr/about.php`) — 지어낸 HTML 은 선택자 오타를 그냥 통과시킨다.
 */
const html = readFileSync(join(__dirname, "../__fixtures__/tips-about.html"), "utf-8");

/**
 * ★tips.ts 는 공용 fetch.ts(fetchProductText) 대신 core `node:https` 를 직접 쓴다(헤더 폴딩 우회,
 * tips.ts 파일 맨 위 설명 참고) — 그래서 여기서는 `../fetch` 가 아니라 `node:https` 의 `get` 을
 * 흉내 낸다(기존 저장소의 `vi.mock("../fetch", () => ({ fetchProductText: vi.fn() }))` 사용례와
 * 같은 형태를 이 파일에서만 `node:https` 대상으로 바꿔 쓴 것).
 */
vi.mock("node:https", () => ({ get: vi.fn() }));

import { get as httpsGet } from "node:https";
import { fetchTipsAll, parseTips, tipsSource, TIPS_DETAIL_URL } from "./tips";

type FakeIncomingMessage = EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  resume: () => void;
  destroy: () => void;
};

/** httpsGet 콜백에 넘길 가짜 응답 — node:http IncomingMessage 를 흉내 낸 최소 모양(EventEmitter). */
function fakeRes(statusCode: number, headers: Record<string, string> = {}): FakeIncomingMessage {
  const res = new EventEmitter() as FakeIncomingMessage;
  res.statusCode = statusCode;
  res.headers = headers;
  res.resume = () => {};
  res.destroy = () => {};
  return res;
}

/** httpsGet 이 돌려주는 가짜 요청 — 이 시험들은 timeout/error 를 쓰지 않으므로 빈 EventEmitter 로 충분. */
function fakeReq(): EventEmitter & { destroy: (err?: Error) => void } {
  const req = new EventEmitter() as EventEmitter & { destroy: (err?: Error) => void };
  req.destroy = () => {};
  return req;
}

describe("parseTips — TIPS 정적 문장에서 상시 상품 1건 읽기(실사이트 고정본)", () => {
  const rows = parseTips(html);

  it("정확히 1건", () => {
    expect(rows).toHaveLength(1);
  });

  it("이름·출처·갈래·기관·상품형태가 계획대로다", () => {
    const r = rows[0];
    expect(r.source).toBe("product-tips");
    expect(r.name).toBe("TIPS (민간투자주도형 기술창업지원)");
    expect(r.fundingGroup).toBe("invest");
    expect(r.institution).toBe("창업진흥원·TIPS 운영사");
    expect(r.institutionType).toBe("invest");
    expect(r.productType).toBe("equity");
  });

  // F3(2026-09-03 코덱스 리뷰 한도 정정): 괄호 「(창업자금 1억원, 해외마케팅 1억원)」은 별개 항목이
  // 아니라 앞의 「추가투자 최대 2억원」의 내역(사용처 세부)이다 — 다섯 값을 전부 더하면(1+5+2+1+1=10억)
  // 추가투자 2억을 두 번 세는 이중 계산이 된다. 맞는 합계는 투자·R&D·추가투자 세 값만 더한 8억이다.
  it("한도 문장 — 「최장 3년간 투자 1억, R&D 5억, 추가투자 2억(창업자금 1억·해외마케팅 1억)」에서 괄호는 추가투자 2억의 내역이라 세 값만 더해 8억", () => {
    const r = rows[0];
    expect(r.limitText).toBe("투자 1억원 + R&D 5억원 + 추가투자 최대 2억원(창업자금·해외마케팅)");
    expect(r.limitMaxWon).toBe(800_000_000); // 1+5+2 = 8억(괄호 내역을 다시 더하지 않는다 — 이중계산 방지)
    expect(r.termText).toBe("최장 3년");
  });

  it("지분 투자라 금리가 없다 — rateText 는 「지분 투자」 고정, rateMin/rateMax 는 null", () => {
    const r = rows[0];
    expect(r.rateText).toBe("지분 투자");
    expect(r.rateMin).toBeNull();
    expect(r.rateMax).toBeNull();
  });

  it("대상 원문 문장을 targetText 에 그대로 담고, targetRules 는 창업기업 정의(설립 후 7년 이내)로 고정", () => {
    const r = rows[0];
    expect(r.targetText).toBe(
      "「중소기업창업 지원법」 제2조에 따른 창업기업 또는 예비창업자로, 팁스 운영사로부터 투자(확약) 및 추천을 받은 창업기업을 지원하고 있습니다.",
    );
    // F3(2026-09-03 코덱스 리뷰): 「운영사 추천」·「기술 기반 창업」은 기계로 못 재는 필수조건이라
    // 지어낸 숫자로 대신하지 않고 humanCheck 원문으로 남긴다(버리지 않는다).
    expect(r.targetRules).toEqual({
      bizAgeMaxYears: 7,
      humanCheck: ["TIPS 운영사의 투자·추천 필요", "기술 기반 창업"],
    });
  });

  it("마감·주소·채널·수수료 칸", () => {
    const r = rows[0];
    expect(r.deadlineText).toBe("운영사 추천 상시");
    expect(r.applyUrl).toBe("https://www.jointips.or.kr/");
    expect(r.detailUrl).toBe(TIPS_DETAIL_URL);
    expect(r.channel).toBe("TIPS 운영사 추천");
    expect(r.feeText).toBe("");
  });

  it("sourceId 는 이름을 정규화한 값(공백·괄호 제거)", () => {
    expect(rows[0].sourceId).toBe("TIPS민간투자주도형기술창업지원");
  });

  it("raw 에 원문 두 문장을 그대로 남긴다(사람이 나중에 대조할 수 있게)", () => {
    const r = rows[0];
    expect(r.raw).toMatchObject({
      지원내용문장: "최장 3년간 투자 1억원, R&D 5억원 및 추가투자 최대 2억원을 지원합니다. (창업자금 1억원, 해외마케팅 1억원)",
      지원대상문장:
        "「중소기업창업 지원법」 제2조에 따른 창업기업 또는 예비창업자로, 팁스 운영사로부터 투자(확약) 및 추천을 받은 창업기업을 지원하고 있습니다.",
    });
  });

  it("★지원 금액 문장을 못 찾으면 값을 지어내지 않고 던진다", () => {
    const idx = html.indexOf("창업팀당 최장");
    const truncated = html.slice(0, idx) + html.slice(idx).replace("최장 3년간", "얼마간");
    expect(() => parseTips(truncated)).toThrow();
  });

  it("★지원 대상 문장을 못 찾으면 값을 지어내지 않고 던진다", () => {
    const without = html.replace("중소기업창업 지원법", "중소기업창업지원특별법");
    expect(() => parseTips(without)).toThrow();
  });
});

describe("fetchTipsAll — 실제 수집 배선(node:https 직접 호출, insecureHTTPParser 우회)", () => {
  beforeEach(() => {
    vi.mocked(httpsGet).mockReset();
  });
  afterEach(() => {
    vi.mocked(httpsGet).mockReset();
  });

  it("고정 주소로 글을 받아 parseTips 로 1건을 만든다", async () => {
    vi.mocked(httpsGet).mockImplementation((...args: any[]) => {
      const callback = args[2] as (res: FakeIncomingMessage) => void;
      const res = fakeRes(200);
      callback(res);
      res.emit("data", Buffer.from(html, "utf-8"));
      res.emit("end");
      return fakeReq() as never;
    });

    const list = await fetchTipsAll();
    expect(list).toHaveLength(1);

    expect(httpsGet).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = vi.mocked(httpsGet).mock.calls[0] as [string, Record<string, unknown>];
    expect(calledUrl).toBe(TIPS_DETAIL_URL);
    expect(calledOptions).toEqual(
      expect.objectContaining({
        insecureHTTPParser: true,
        headers: expect.objectContaining({ "User-Agent": expect.stringContaining("Mozilla/5.0") }),
      }),
    );
  });

  it("반쪽 응답(문장 없음)이면 저장하지 않고 던진다", async () => {
    vi.mocked(httpsGet).mockImplementation((...args: any[]) => {
      const callback = args[2] as (res: FakeIncomingMessage) => void;
      const res = fakeRes(200);
      callback(res);
      res.emit("data", Buffer.from("<html><body>점검 중입니다</body></html>", "utf-8"));
      res.emit("end");
      return fakeReq() as never;
    });

    await expect(fetchTipsAll()).rejects.toThrow();
  });

  it("★리다이렉트가 다른 호스트로 가면 던진다(허용 호스트 검문 대체)", async () => {
    vi.mocked(httpsGet).mockImplementation((...args: any[]) => {
      const callback = args[2] as (res: FakeIncomingMessage) => void;
      const res = fakeRes(302, { location: "https://evil.example.com/x" });
      callback(res);
      return fakeReq() as never;
    });

    await expect(fetchTipsAll()).rejects.toThrow(/호스트/);
    // 다른 호스트로는 실제 요청을 내지 않는다 — 첫 요청 1건만 나가고 끝난다.
    expect(httpsGet).toHaveBeenCalledTimes(1);
  });

  it("★본문이 상한(2,000,000바이트)을 넘으면 던진다", async () => {
    vi.mocked(httpsGet).mockImplementation((...args: any[]) => {
      const callback = args[2] as (res: FakeIncomingMessage) => void;
      const res = fakeRes(200);
      callback(res);
      res.emit("data", Buffer.alloc(2_100_000, 1)); // 상한(2,000,000B) 초과
      return fakeReq() as never;
    });

    await expect(fetchTipsAll()).rejects.toThrow(/MB 초과/);
  });
});

describe("tipsSource — 명부에 실릴 모양(공통 계약)", () => {
  it("id·라벨·주소·fetchAll 이 계획대로다", () => {
    expect(tipsSource.id).toBe("product-tips");
    expect(tipsSource.url).toBe(TIPS_DETAIL_URL);
    expect(tipsSource.fetchAll).toBe(fetchTipsAll);
    expect(tipsSource.label.length).toBeGreaterThan(0);
  });
});
