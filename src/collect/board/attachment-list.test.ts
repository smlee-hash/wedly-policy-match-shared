import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectDeps, PolicyAnnouncementUpdate } from "../types";
import type { PolicyAttachmentRequest } from "./types";

/**
 * 국내 경유 출처(대전신보·안양)도 시험에서는 **전역 fetch(stub)** 로 흐르게 한다 — detail-fill.test.ts 와
 * 같은 이유다. 실제 코드는 경유 통로가 있으면 설치판 undici 의 fetch 를 써서 `vi.stubGlobal` 이 못 가로챈다.
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

import {
  ATTACHMENT_LIST_SOURCES,
  ATTACHMENT_LIST_UNSUPPORTED,
  NO_ATTACHMENT_SOURCES,
  attachmentListSourceIds,
  readAttachmentList,
} from "./attachment-list";
import { fillBoardDetail } from "./detail-fill";
import { BOARD_SOURCES } from "./registry";
import { safeAttachmentUrl } from "../attachment-text";

// ── 고정본 ──────────────────────────────────────────────────────────────
// 만든 방법·출처는 __fixtures__/attachments/README.md. 기대 목록은 시험 대상 코드와 따로 만든 판정기로 뽑았다.

const DIR = join(__dirname, "__fixtures__", "attachments");
const read = (name: string): string => readFileSync(join(DIR, name), "utf8");
const readParent = (name: string): string => readFileSync(join(__dirname, "__fixtures__", name), "utf8");

/** 고정본 이름(확장자 뺀 것) → 그 화면의 첨부 목록(화면에 나온 차례). */
const EXPECTED = JSON.parse(read("expected.json")) as Record<string, PolicyAttachmentRequest[]>;
/** 경북경제진흥원 첨부 1건 = `admin-ajax.php` POST 1번. `sample` 은 그 첨부가 실린 상세 주소. */
const GEPA = JSON.parse(read("gepa-ajax.json")) as Array<{ sample: string; pid: string; body: string; response: string }>;
const GEPA_AJAX = "https://www.gepa.kr/wp-admin/admin-ajax.php";
const PROXY = "http://example.invalid:8080";

/** 고정본 첫 줄 `<!-- 주소 -->` = 그 화면의 상세 주소(우리가 붙인 것 — 화면 원문에는 없다). */
function urlOf(html: string): string {
  const m = html.match(/^<!--\s*(\S+)\s*-->/);
  if (!m) throw new Error("고정본 첫 줄에 상세 주소가 없다");
  return m[1];
}

/** 고정본 이름 → 출처 id(`dgtp-3` → `dgtp`). */
const sourceOf = (key: string): string => key.replace(/-\d+$/, "");

// ── 가짜 통신 ────────────────────────────────────────────────────────────

type Route = { url: string; method?: "GET" | "POST"; body?: string; status?: number; text: string };
type Call = { url: string; method: string; body?: string; contentType?: string };

/**
 * form 본문 POST 의 머리글. 진짜 fetch 는 이 머리글이 없으면 문자열 본문을 `text/plain;charset=UTF-8` 로
 * 보내 PHP(`admin-ajax.php`)가 본문을 못 읽는다 — 그래서 흉내 서버도 이 머리글이 없는 POST 는 받지 않는다.
 */
const FORM_TYPE = /^application\/x-www-form-urlencoded\b/i;

/** 요청 머리글 하나를 이름(대소문자 무시)으로 읽는다 — 객체·`Headers`·[이름, 값] 배열을 모두 받는다. */
function headerOf(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const pairs = Array.isArray(headers)
    ? (headers as Array<[string, string]>)
    : Object.entries(headers as Record<string, string>);
  return pairs.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

/** 주소는 정규화해 비교한다 — 구현이 `new URL()` 을 한 번 거쳐도 같은 주소로 본다. */
function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

/** form 본문은 칸 순서와 인코딩(`%20`·`+`)에 상관없이 푼 값으로 비교한다. */
function formKey(body: string | undefined): string {
  return [...new URLSearchParams(body ?? "").entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
}

function response(status: number, text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    ok: status >= 200 && status < 300,
    status,
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
  };
}

/**
 * 전역 fetch 를 주소표로 바꾼다. 표에 없는 요청은 404 를 주고 `misses` 에 남긴다 —
 * 시험 끝에 `misses` 가 비었으면 「표에 적은 곳 말고는 요청하지 않았다」가 확인된다.
 * 이미 끊긴 표식(signal)으로 온 요청은 진짜 fetch 처럼 AbortError 로 던지고 기록하지 않는다.
 * POST 는 본문이 같고 머리글이 form 형식(`FORM_TYPE`)일 때만 표와 맞는다.
 */
function stubRoutes(routes: Route[]): { calls: Call[]; misses: Call[] } {
  const calls: Call[] = [];
  const misses: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: unknown, init?: { method?: string; body?: unknown; headers?: unknown; signal?: AbortSignal }) => {
        if (init?.signal?.aborted) {
          const e = new Error("This operation was aborted");
          e.name = "AbortError";
          throw e;
        }
        const call: Call = {
          url: String(input),
          method: (init?.method ?? "GET").toUpperCase(),
          body: typeof init?.body === "string" ? init.body : undefined,
          contentType: headerOf(init?.headers, "content-type"),
        };
        calls.push(call);
        const hit = routes.find(
          (r) =>
            sameUrl(r.url, call.url) &&
            (r.method ?? "GET") === call.method &&
            (call.method !== "POST" ||
              (FORM_TYPE.test(call.contentType ?? "") && formKey(r.body) === formKey(call.body))),
        );
        if (!hit) {
          misses.push(call);
          return response(404, "not found");
        }
        return response(hit.status ?? 200, hit.text);
      },
    ),
  );
  return { calls, misses };
}

/** 상세 GET 하나 + (경북경제진흥원이면) 그 상세에 실린 첨부의 POST 응답들. */
function boardRoutes(key: string): { url: string; routes: Route[] } {
  const html = read(`${key}.html`);
  const url = urlOf(html);
  const routes: Route[] = [{ url, text: html }];
  for (const g of GEPA.filter((x) => x.sample === url)) {
    routes.push({ url: GEPA_AJAX, method: "POST", body: g.body, text: g.response });
  }
  return { url, routes };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("흉내 서버 자체", () => {
  it("form 머리글이 없는 POST 는 본문이 같아도 표와 맞지 않는다(404·misses 에 남음)", async () => {
    const { body, response: text } = GEPA[0];
    const { misses } = stubRoutes([{ url: GEPA_AJAX, method: "POST", body, text }]);
    expect((await fetch(GEPA_AJAX, { method: "POST", body })).status).toBe(404);
    const form = await fetch(GEPA_AJAX, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(200);
    expect(misses).toHaveLength(1);
  });
});

// ── 게시판 20곳 실제 상세 ─────────────────────────────────────────────────

const BOARD_KEYS = Object.keys(EXPECTED)
  .filter((k) => !k.startsWith("ks-") && !k.startsWith("bizinfo-"))
  .sort();
/** 본문은 있는데 첨부가 없는 화면 → 「없음」(원문을 확인했는데 첨부가 없다). */
const NONE = new Set([
  "dgsinbo-2",
  "dgtp-3",
  "djsinbo-1",
  "gbsinbo-2",
  "innobiz-1",
  "innobiz-2",
  "innobiz-3",
  "jbsinbo-2",
  "kidp-2",
  "kita-2",
]);
/** 본문도 첨부도 없는 화면 → 「실패」. 사이트가 빈 화면을 줬을 수 있어 「없음」으로 단정하지 않는다. */
const ERROR = new Set(["sjsinbo-1"]);

describe("readAttachmentList — 게시판 실제 상세", () => {
  it("기대 0건인 고정본은 「없음」·「실패」 둘 중 하나로 빠짐없이 나뉜다", () => {
    const zero = BOARD_KEYS.filter((k) => EXPECTED[k].length === 0).sort();
    expect(zero).toEqual([...NONE, ...ERROR].sort());
  });

  it.each(BOARD_KEYS)("%s", async (key) => {
    // 대전신보는 국내 경유 전용이다. 경유 통로가 있다고 두면 다른 게시판은 그 값을 안 본다.
    vi.stubEnv("POLICY_BOARD_PROXY_URL", PROXY);
    const { url, routes } = boardRoutes(key);
    const { misses } = stubRoutes(routes);
    const got = await readAttachmentList({ source: sourceOf(key), url });
    if (ERROR.has(key)) {
      expect(got.state).toBe("error");
      expect((got as { reason?: string }).reason).toBeTruthy();
    } else if (NONE.has(key)) {
      expect(got).toEqual({ state: "none" });
    } else {
      expect(got).toEqual({ state: "found", attachments: EXPECTED[key] });
    }
    expect(misses).toEqual([]);
  });
});

describe("readAttachmentList — 실패·지원 안 함", () => {
  it("국내 경유 전용 게시판은 경유 설정값이 없으면 요청하지 않고 실패로 돌린다", async () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "");
    const { url, routes } = boardRoutes("djsinbo-2");
    const { calls } = stubRoutes(routes);
    const got = await readAttachmentList({ source: "djsinbo", url });
    expect(got.state).toBe("error");
    expect(calls).toEqual([]);
  });

  it("상세가 500 이면 실패(빈 목록을 「없음」으로 적지 않는다)", async () => {
    const { url } = boardRoutes("dgtp-1");
    stubRoutes([{ url, status: 500, text: "server error" }]);
    const got = await readAttachmentList({ source: "dgtp", url });
    expect(got.state).toBe("error");
    expect((got as { reason?: string }).reason).toBeTruthy();
  });

  it("바깥 예산이 이미 끝났으면 요청하지 않고 실패", async () => {
    const { url, routes } = boardRoutes("dgtp-1");
    const { calls } = stubRoutes(routes);
    const got = await readAttachmentList({ source: "dgtp", url }, { signal: AbortSignal.abort() });
    expect(got.state).toBe("error");
    expect(calls).toEqual([]);
  });

  it("상세 주소가 비었거나 그 게시판 호스트가 아니면 요청하지 않고 실패", async () => {
    const { calls } = stubRoutes([]);
    expect((await readAttachmentList({ source: "dgtp", url: "" })).state).toBe("error");
    expect((await readAttachmentList({ source: "dgtp", url: "https://evil.example.com/x" })).state).toBe("error");
    expect(calls).toEqual([]);
  });

  it.each(["semas", "nope", "bizinfo", "msit"])("%s → 지원 안 함(요청 없음)", async (source) => {
    const { calls } = stubRoutes([]);
    const got = await readAttachmentList({ source, url: "https://www.semas.or.kr/x" });
    expect(got).toEqual({ state: "unsupported" });
    expect(calls).toEqual([]);
  });

  it.each(["bojo24", "work24"])("%s → 원문 화면에 첨부가 없는 출처라 요청 없이 「없음」", async (source) => {
    const { calls } = stubRoutes([]);
    const got = await readAttachmentList({ source, url: "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/000000000001" });
    expect(got).toEqual({ state: "none" });
    expect(calls).toEqual([]);
  });

  it("경북경제진흥원 — 첨부 POST 가 하나라도 실패하면 목록 전체를 실패로(반쪽 목록을 저장하지 않는다)", async () => {
    const { url, routes } = boardRoutes("gepa-1");
    const broken = routes.map((r, i) => (i === 2 ? { ...r, status: 500, text: "" } : r));
    stubRoutes(broken);
    const got = await readAttachmentList({ source: "gepa", url });
    expect(got.state).toBe("error");
  });

  it("경북경제진흥원 — POST 응답이 success 가 아니면 실패", async () => {
    const { url, routes } = boardRoutes("gepa-1");
    const refused = routes.map((r) =>
      r.method === "POST" ? { ...r, text: JSON.stringify({ state: "error", code: "1", message: "nonce" }) } : r,
    );
    stubRoutes(refused);
    const got = await readAttachmentList({ source: "gepa", url });
    expect(got.state).toBe("error");
  });
});

// ── K-Startup ────────────────────────────────────────────────────────────

const KS = (n: string): string =>
  `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${n}`;

describe("readAttachmentList — K-Startup", () => {
  function stubKs(n: string) {
    return stubRoutes([{ url: KS(n), text: read(`ks-${n}.html`) }]);
  }

  it("179361 → 첨부 1건(요청글 합격 기준)", async () => {
    const { misses } = stubKs("179361");
    const got = await readAttachmentList({ source: "kstartup", url: KS("179361"), sourceId: "179361" });
    expect(got).toEqual({ state: "found", attachments: EXPECTED["ks-179361"] });
    expect(EXPECTED["ks-179361"]).toHaveLength(1);
    expect(misses).toEqual([]);
  });

  it("179356 → 첨부 3건(요청글 합격 기준)", async () => {
    const { misses } = stubKs("179356");
    const got = await readAttachmentList({ source: "kstartup", url: KS("179356"), sourceId: "179356" });
    expect(got).toEqual({ state: "found", attachments: EXPECTED["ks-179356"] });
    expect(EXPECTED["ks-179356"]).toHaveLength(3);
    expect(misses).toEqual([]);
  });

  it("179302 → 본문에 「첨부파일 참조」만 있고 파일이 없으면 「없음」", async () => {
    stubKs("179302");
    const got = await readAttachmentList({ source: "kstartup", url: KS("179302"), sourceId: "179302" });
    expect(got).toEqual({ state: "none" });
  });

  it("179340 → 공고 대신 빈 화면(제목 #scrTitle 없음)이면 실패", async () => {
    stubKs("179340");
    const got = await readAttachmentList({ source: "kstartup", url: KS("179340"), sourceId: "179340" });
    expect(got.state).toBe("error");
  });

  /**
   * K-Startup 만 「빈 주소·다른 호스트면 요청 없이 실패」의 예외다. 저장된 주소는 공공데이터 API 의
   * `detl_pg_url` 이라 비거나 다른 곳일 수 있고, 수집기가 그런 행도 남긴다(`sources/kstartup.ts` 의
   * `normalizeKstartupItem`·`keepIdentifiable` — 공고 번호나 주소 중 하나만 있으면 저장). 정본은 공고 번호다.
   * 그래서 저장된 주소는 **요청하지 않고** 숫자 공고 번호로 만든 K-Startup 주소만 요청한다 —
   * 다른 호스트로는 여전히 한 번도 요청하지 않는다.
   */
  it.each(["https://k.test/1", ""])("저장된 주소가 K-Startup 이 아니면(%j) 공고 번호로 정규 주소를 만들어 그곳만 요청", async (url) => {
    const { calls, misses } = stubKs("179361");
    const got = await readAttachmentList({ source: "kstartup", url, sourceId: "179361" });
    expect(got).toEqual({ state: "found", attachments: EXPECTED["ks-179361"] });
    expect(calls.map((c) => c.url)).toEqual([KS("179361")]);
    expect(misses).toEqual([]);
  });

  it("주소도 K-Startup 이 아니고 공고 번호도 숫자가 아니면 요청 없이 「받을 수 없음」", async () => {
    const { calls } = stubRoutes([]);
    const got = await readAttachmentList({ source: "kstartup", url: "https://k.test/1", sourceId: "https://k.test/1" });
    expect(got.state).toBe("unavailable");
    expect((got as { reason?: string }).reason).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

// ── 중소벤처24 ───────────────────────────────────────────────────────────

const SMES_URL = "https://portal.smes.go.kr/home/req/pbanc/280588404";
const SMES_API = "https://portal.smes.go.kr/home/api/v1/pbanc/280588404?bizPbancTypeCd=BIZPBN";
const BIZ = "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000126577";

/** 중소벤처24 상세 API 원문(280588404 — 기업마당 연동 BI16). `patch` 로 칸을 바꿔 변형을 만든다. */
function smesJson(patch?: (d: Record<string, unknown>) => void): string {
  const j = JSON.parse(read("smes24-d280588404.json")) as { data: Record<string, unknown> };
  patch?.(j.data);
  return JSON.stringify(j);
}

describe("readAttachmentList — 중소벤처24", () => {
  it("기업마당 연동(BI16)이면 기업마당 상세의 첨부 상자에서 목록을 읽는다", async () => {
    const { misses } = stubRoutes([
      { url: SMES_API, text: smesJson() },
      { url: BIZ, text: read("bizinfo-126577.html") },
    ]);
    const got = await readAttachmentList({ source: "smes24", url: SMES_URL });
    expect(got).toEqual({ state: "found", attachments: EXPECTED["bizinfo-126577"] });
    expect(misses).toEqual([]);
  });

  it("기업마당 첨부 상자가 있는데 파일이 0건이면 「없음」", async () => {
    stubRoutes([
      { url: SMES_API, text: smesJson() },
      { url: BIZ, text: read("bizinfo-126577-none.html") },
    ]);
    const got = await readAttachmentList({ source: "smes24", url: SMES_URL });
    expect(got).toEqual({ state: "none" });
  });

  it("기업마당 첨부 상자 자체가 없으면(화면 구조 바뀜) 실패", async () => {
    const html = read("bizinfo-126577.html").split('class="attached_file_list"').join('class="attached_file_lst"');
    expect(html).not.toContain("attached_file_list");
    stubRoutes([
      { url: SMES_API, text: smesJson() },
      { url: BIZ, text: html },
    ]);
    const got = await readAttachmentList({ source: "smes24", url: SMES_URL });
    expect(got.state).toBe("error");
  });

  it("상세 API 가 500 이면 실패", async () => {
    stubRoutes([{ url: SMES_API, status: 500, text: "" }]);
    const got = await readAttachmentList({ source: "smes24", url: SMES_URL });
    expect(got.state).toBe("error");
  });

  it("비연동인데 첨부가 있으면 포털 통로가 막혀 「받을 수 없음」 — 기업마당에 요청하지 않는다", async () => {
    const { calls } = stubRoutes([
      {
        url: SMES_API,
        text: smesJson((d) => {
          d.bizPbancLinkInstCd = null;
        }),
      },
    ]);
    const got = await readAttachmentList({ source: "smes24", url: SMES_URL });
    expect(got.state).toBe("unavailable");
    expect((got as { reason?: string }).reason).toBeTruthy();
    expect(calls.some((c) => c.url.includes("bizinfo.go.kr"))).toBe(false);
  });

  it("비연동이고 첨부도 없으면 「없음」", async () => {
    stubRoutes([
      {
        url: SMES_API,
        text: smesJson((d) => {
          d.bizPbancLinkInstCd = null;
          d.pbancMtxtFiles = [];
          d.pbancAtchFiles = [];
        }),
      },
    ]);
    const got = await readAttachmentList({ source: "smes24", url: SMES_URL });
    expect(got).toEqual({ state: "none" });
  });

  it.each(["https://evil.example.com/x", ""])("연동이라도 상세 주소가 기업마당이 아니면(%j) 요청 없이 「받을 수 없음」", async (addr) => {
    const { calls } = stubRoutes([
      {
        url: SMES_API,
        text: smesJson((d) => {
          d.bizDtlUrlAddr = addr;
        }),
      },
    ]);
    const got = await readAttachmentList({ source: "smes24", url: SMES_URL });
    expect(got.state).toBe("unavailable");
    expect(calls.every((c) => sameUrl(c.url, SMES_API))).toBe(true);
  });
});

// ── 안양(첨부 상자 필수 게시판) ──────────────────────────────────────────

const ACA_URL = "https://aca.or.kr/support/supportBizView.do?sbIdx=541";

describe("readAttachmentList — 안양(공용 수확기 그대로 쓰는 게시판)", () => {
  beforeEach(() => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", PROXY);
  });

  it("첨부 2건을 공용 수확기 결과 그대로 돌려준다", async () => {
    stubRoutes([{ url: ACA_URL, text: readParent("aca-detail.html") }]);
    const got = await readAttachmentList({ source: "aca", url: ACA_URL });
    expect(got).toEqual({
      state: "found",
      attachments: [
        { name: "공고문.hwp", url: "https://aca.or.kr/cmmn/download.do?idx=45383", kind: "hwp" },
        { name: "신청서류 및 매뉴얼.hwp", url: "https://aca.or.kr/cmmn/download.do?idx=45384", kind: "hwp" },
      ],
    });
  });

  it("첨부 없는 상세 → 「없음」", async () => {
    stubRoutes([{ url: ACA_URL, text: readParent("aca-detail-noattach.html") }]);
    const got = await readAttachmentList({ source: "aca", url: ACA_URL });
    expect(got).toEqual({ state: "none" });
  });

  it("필수 첨부 상자(ul.list-group)가 화면에서 사라지면 「없음」이 아니라 실패", async () => {
    const html = readParent("aca-detail.html").split('class="list-group"').join('class="list-grp"');
    expect(html).not.toContain('class="list-group"');
    stubRoutes([{ url: ACA_URL, text: html }]);
    const got = await readAttachmentList({ source: "aca", url: ACA_URL });
    expect(got.state).toBe("error");
  });
});

// ── 상세 채움(새 공고)도 같은 갈고리를 쓴다 ───────────────────────────────

const updateAnnouncement = vi.fn<(id: string, data: PolicyAnnouncementUpdate) => Promise<void>>(() => Promise.resolve());
const updateAnnouncementIfEmpty = vi.fn<(id: string, data: PolicyAnnouncementUpdate) => Promise<number>>(() =>
  Promise.resolve(1),
);
const deps: Pick<CollectDeps, "updateAnnouncement" | "updateAnnouncementIfEmpty"> = {
  updateAnnouncement,
  updateAnnouncementIfEmpty,
};

describe("fillBoardDetail — 새 첨부 갈고리", () => {
  beforeEach(() => {
    updateAnnouncement.mockReset().mockResolvedValue(undefined);
    updateAnnouncementIfEmpty.mockReset().mockResolvedValue(1);
  });

  function savedData(): PolicyAnnouncementUpdate {
    expect(updateAnnouncement).toHaveBeenCalledTimes(1);
    return updateAnnouncement.mock.calls[0][1];
  }

  it.each(["dgtp-1", "kidp-1"])("%s — 저장하는 첨부가 고정본 기대 목록과 같다", async (key) => {
    const { url, routes } = boardRoutes(key);
    stubRoutes(routes);
    const ok = await fillBoardDetail({ id: `ann-${key}`, source: sourceOf(key), url, targetText: "" }, deps);
    expect(ok).toBe("filled");
    expect(savedData().attachments).toEqual(EXPECTED[key]);
  });

  it("경북경제진흥원 — POST 로 받은 주소까지 저장한다", async () => {
    const { url, routes } = boardRoutes("gepa-1");
    stubRoutes(routes);
    const ok = await fillBoardDetail({ id: "ann-gepa", source: "gepa", url, targetText: "" }, deps);
    expect(ok).toBe("filled");
    expect(savedData().attachments).toEqual(EXPECTED["gepa-1"]);
  });

  it("경북경제진흥원 — 첨부 POST 가 실패해도 본문은 저장하고, 모르는 첨부 칸은 건드리지 않는다", async () => {
    const { url, routes } = boardRoutes("gepa-1");
    stubRoutes(routes.map((r) => (r.method === "POST" ? { ...r, status: 500, text: "" } : r)));
    const ok = await fillBoardDetail(
      { id: "ann-gepa", source: "gepa", url, targetText: "", attachments: [] },
      deps,
    );
    expect(ok).toBe("filled");
    const data = savedData();
    expect((data.targetText ?? "").trim()).not.toBe("");
    expect(data).not.toHaveProperty("attachments");
    expect(data).not.toHaveProperty("attachmentFillTriedAt");
    expect(console.warn).toHaveBeenCalled();
  });

  it("중소벤처24 기업마당 연동 — 기업마당 첨부를 저장한다", async () => {
    stubRoutes([
      { url: SMES_API, text: smesJson() },
      { url: BIZ, text: read("bizinfo-126577.html") },
    ]);
    const ok = await fillBoardDetail({ id: "ann-smes", source: "smes24", url: SMES_URL, targetText: "" }, deps);
    expect(ok).toBe("filled");
    expect(savedData().attachments).toEqual(EXPECTED["bizinfo-126577"]);
  });

  it("중소벤처24 비연동인데 첨부가 있으면(받을 수 없음) 본문은 저장하고 첨부는 빈 목록으로 저장한다", async () => {
    const { calls } = stubRoutes([
      {
        url: SMES_API,
        text: smesJson((d) => {
          d.bizPbancLinkInstCd = null;
        }),
      },
    ]);
    const ok = await fillBoardDetail(
      { id: "ann-smes", source: "smes24", url: SMES_URL, targetText: "", attachments: [] },
      deps,
    );
    expect(ok).toBe("filled");
    const data = savedData();
    expect((data.targetText ?? "").trim()).not.toBe("");
    expect(data).toHaveProperty("attachments", []);
    expect(calls.some((c) => c.url.includes("bizinfo.go.kr"))).toBe(false);
  });

  it("갈고리가 「받을 수 없음」을 돌려주면 공용 수확기 결과 대신 빈 목록을 저장한다(안양 설정에 잠깐 붙여 확인)", async () => {
    // 안양은 공용 수확기가 첨부 2건을 잡는 게시판이다 — 갈고리 결과가 수확기 결과를 대신하는지 드러난다.
    vi.stubEnv("POLICY_BOARD_PROXY_URL", PROXY);
    const cfg = BOARD_SOURCES.find((c) => c.id === "aca");
    if (!cfg) throw new Error("안양 설정 없음");
    const hook = vi.fn(async () => ({ unavailable: "시험 — 원문에 첨부가 있지만 받을 길이 없음" }));
    cfg.detailAttachmentsAsync = hook;
    try {
      stubRoutes([{ url: ACA_URL, text: readParent("aca-detail.html") }]);
      const ok = await fillBoardDetail({ id: "ann-aca", source: "aca", url: ACA_URL, targetText: "" }, deps);
      expect(ok).toBe("filled");
      expect(hook).toHaveBeenCalledTimes(1);
      const data = savedData();
      expect((data.targetText ?? "").trim()).not.toBe("");
      expect(data).toHaveProperty("attachments", []);
    } finally {
      delete cfg.detailAttachmentsAsync;
    }
  });
});

// ── 목록·허용 호스트 ──────────────────────────────────────────────────────

const UNSUPPORTED_IDS = [
  "semas",
  "snip",
  "gjsinbo",
  "icsinbo",
  "cnsinbo",
  "jcgf",
  "kibo",
  "kosmes",
  "gipa",
  "bssinbo",
  "sese",
  "smartfactory",
  "gwsinbo",
  "kicox",
  "kead",
  "ketep",
  "kocca-finance",
  "hrdk",
  "kofic",
];
const OLD_HOOKS = ["hrdk", "kocca-finance", "kofic", "mof", "mois", "molit", "snip", "wbiz"];
const NEW_HOOKS = [
  "bizok",
  "dgtp",
  "innobiz",
  "jica",
  "cistep",
  "dgsinbo",
  "gbsinbo",
  "djsinbo",
  "sjsinbo",
  "jbsinbo",
  "jnsinbo",
  "jba",
  "bepa",
  "kidp",
  "kita",
  "ansan",
  "motie",
  "cbf",
  "kodma",
];

describe("첨부 목록 출처 목록", () => {
  it("기대 목록의 모든 첨부 주소가 글자 추출 허용 검사를 그대로 통과한다(K-Startup 포함)", () => {
    const blocked = Object.values(EXPECTED)
      .flat()
      .filter((a) => safeAttachmentUrl(a.url) !== a.url)
      .map((a) => a.url);
    expect(blocked).toEqual([]);
  });

  it("지원 안 하는 게시판 19곳은 각각 사유가 있다", () => {
    expect(Object.keys(ATTACHMENT_LIST_UNSUPPORTED).sort()).toEqual([...UNSUPPORTED_IDS].sort());
    for (const id of UNSUPPORTED_IDS) {
      expect(ATTACHMENT_LIST_UNSUPPORTED[id]?.trim()).toBeTruthy();
    }
  });

  it("게시판 전체 = 지원 + 지원 안 함(겹침·중복·빠짐 없음)", () => {
    const supported = [...ATTACHMENT_LIST_SOURCES];
    expect(new Set(supported).size).toBe(supported.length);
    const boards = supported.filter((id) => id !== "kstartup");
    const unsupported = Object.keys(ATTACHMENT_LIST_UNSUPPORTED);
    expect(boards.filter((id) => unsupported.includes(id))).toEqual([]);
    expect([...boards, ...unsupported].sort()).toEqual(BOARD_SOURCES.map((c) => c.id).sort());
  });

  it("K-Startup 은 지원, 기업마당·과기부·보조금24·고용24 는 지원 목록에 없다", () => {
    const supported = new Set(ATTACHMENT_LIST_SOURCES);
    expect(supported.has("kstartup")).toBe(true);
    for (const id of ["bizinfo", "msit", "bojo24", "work24"]) expect(supported.has(id)).toBe(false);
    expect([...NO_ATTACHMENT_SOURCES]).toEqual(["bojo24", "work24"]);
  });

  it("지금 읽을 출처 — 국내 경유 설정값이 없으면 경유 전용 게시판을 뺀다", () => {
    vi.stubEnv("POLICY_BOARD_PROXY_URL", "");
    const without = attachmentListSourceIds();
    expect(without).toContain("kstartup");
    expect(without).toContain("dgtp");
    expect(without).not.toContain("djsinbo");
    expect(without).not.toContain("aca");
    vi.stubEnv("POLICY_BOARD_PROXY_URL", PROXY);
    const withProxy = attachmentListSourceIds();
    expect([...withProxy].sort()).toEqual([...ATTACHMENT_LIST_SOURCES].sort());
  });

  it("첨부를 직접 만드는 게시판 = 기존 8곳 + 이번 19곳, 요청이 더 필요한 곳 = 경북경제진흥원·중소벤처24", () => {
    const sync = BOARD_SOURCES.filter((c) => c.detailAttachments).map((c) => c.id);
    expect(sync.sort()).toEqual([...OLD_HOOKS, ...NEW_HOOKS].sort());
    const asyncHooks = BOARD_SOURCES.filter((c) => c.detailAttachmentsAsync).map((c) => c.id);
    expect(asyncHooks.sort()).toEqual(["gepa", "smes24"]);
  });
});
