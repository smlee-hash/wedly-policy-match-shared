import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchBoardAll, PAGE_HARD_CAP } from "./engine";
import type { BoardConfig } from "./types";
import { jbsinboConfig } from "./sources/jbsinbo";
import { mainbizConfig } from "./sources/mainbiz";

/**
 * 거르개 뒤 정책 행이 0~1건인 건강한 게시판을 원본 행으로 검증하는 계약.
 * 실제 요청은 하지 않는다 — 고정본과 그 변형만 쓴다.
 */
const jbsinboP1 = readFileSync(join(__dirname, "__fixtures__/jbsinbo-list.html"), "utf-8");
const jbsinboP2 = readFileSync(join(__dirname, "__fixtures__/jbsinbo-list-p2.html"), "utf-8");
const mainbizP1 = readFileSync(join(__dirname, "__fixtures__/mainbiz-list.html"), "utf-8");

const base: BoardConfig = {
  id: "tp-x",
  label: "X테크노파크",
  agency: "X테크노파크",
  region: "부산",
  baseUrl: "https://x.kr/b/",
  list: {
    url: (p) => `https://x.kr/b/list?p=${p}`,
    maxPages: 5,
    rowSelector: "tbody tr",
    fields: {
      title: { selector: "td.subject a" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.date" },
    },
  },
  expectMinRows: 2,
  skipHeuristic: true,
};

function deps(overrides: Partial<Parameters<typeof fetchBoardAll>[1]> = {}) {
  return {
    fetchText: async () => "<div/>",
    prevOpenCount: 0,
    askModel: async () => "{}",
    onAllFailed: vi.fn(),
    ...overrides,
  };
}

function rawHtml(
  ids: number[],
  title: (id: number) => string,
  date = "2026-08-01",
): string {
  return `<table><tbody>${ids
    .map(
      (id) =>
        `<tr><td class="subject"><a href="/v?id=${id}">${title(id)}</a></td><td class="date">${date}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function noticeTitle(id: number): string {
  return `행사 안내 ${id}번 공지문`;
}
function policyTitle(id: number): string {
  return `2026 지원사업 공고 ${id}번`;
}

function parseSparseRows(html: string): { title: string; id: string; dateText: string }[] {
  const out: { title: string; id: string; dateText: string }[] = [];
  const seen = new Set<string>();
  const re =
    /<tr>\s*<td class="subject"><a href="\/v\?id=(\d+)">([^<]*)<\/a><\/td><td class="date">([^<]*)<\/td><\/tr>/g;
  for (const m of html.matchAll(re)) {
    const id = m[1] ?? "";
    const title = (m[2] ?? "").replace(/\s+/g, " ").trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ title, id, dateText: (m[3] ?? "").trim() });
  }
  return out;
}

function toRow(r: { title: string; id: string; dateText: string }) {
  return { title: r.title, detailUrl: `https://x.kr/v?id=${r.id}`, dateText: r.dateText };
}

function parseSparseValidation(html: string) {
  return parseSparseRows(html).map(toRow);
}
function parseSparsePolicies(html: string) {
  return parseSparseRows(html)
    .filter((r) => r.title.includes("지원사업"))
    .map(toRow);
}

function sparseCfg(over: Partial<BoardConfig> = {}): BoardConfig {
  return {
    ...base,
    ...over,
    list: { ...base.list, ...(over.list ?? {}) },
    customParse: over.customParse ?? parseSparsePolicies,
    validationParse: over.validationParse ?? parseSparseValidation,
    skipHeuristic: over.skipHeuristic ?? true,
  };
}

describe("거르개 전 원본 행 검증 — 정책 행이 적어도 계속 읽는다", () => {
  it("1쪽이 원본은 멀쩡하고 정책 1건이면 뒤 쪽 정책을 이어서 담는다", async () => {
    const pages: number[] = [];
    const out = await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 4 } }),
      deps({
        fetchText: async (url) => {
          const p = Number(new URL(url).searchParams.get("p"));
          pages.push(p);
          if (p === 1) return rawHtml([1, 2, 3], (id) => (id === 1 ? policyTitle(id) : noticeTitle(id)));
          if (p === 2) return rawHtml([4, 5, 6], policyTitle);
          return rawHtml([7, 8, 9], noticeTitle);
        },
      }),
    );
    expect(out.map((r) => r.url)).toEqual([
      "https://x.kr/v?id=1",
      "https://x.kr/v?id=4",
      "https://x.kr/v?id=5",
      "https://x.kr/v?id=6",
    ]);
    expect(pages).toContain(2);
  });

  it("1쪽이 원본은 멀쩡하고 정책 0건이어도 뒤 쪽 정책을 담는다", async () => {
    const out = await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 4 } }),
      deps({
        prevOpenCount: 20,
        fetchText: async (url) => {
          const p = Number(new URL(url).searchParams.get("p"));
          if (p === 1) return rawHtml([1, 2, 3], noticeTitle);
          if (p === 2) return rawHtml([4, 5, 6], policyTitle);
          return rawHtml([7, 8, 9], noticeTitle);
        },
      }),
    );
    expect(out.map((r) => r.url)).toEqual([
      "https://x.kr/v?id=4",
      "https://x.kr/v?id=5",
      "https://x.kr/v?id=6",
    ]);
  });

  it("원본이 있는 거르개-빈 쪽 둘이 연속이어도 4쪽 정책을 가리지 않는다", async () => {
    const fetched: string[] = [];
    const out = await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 5 } }),
      deps({
        fetchText: async (url) => {
          fetched.push(url);
          const p = Number(new URL(url).searchParams.get("p"));
          if (p === 1) return rawHtml([1, 2, 3], noticeTitle);
          if (p === 2) return rawHtml([4, 5, 6], noticeTitle);
          if (p === 3) return rawHtml([7, 8, 9], noticeTitle);
          if (p === 4) return rawHtml([10, 11, 12], policyTitle);
          return rawHtml([13, 14, 15], noticeTitle);
        },
      }),
    );
    expect(out.map((r) => r.url)).toEqual([
      "https://x.kr/v?id=10",
      "https://x.kr/v?id=11",
      "https://x.kr/v?id=12",
    ]);
    expect(fetched.some((u) => u.includes("p=4"))).toBe(true);
  });

  it("같은 원본 쪽이 연속 두 번이면 멈춘다", async () => {
    const fetched: string[] = [];
    const out = await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 8 } }),
      deps({
        fetchText: async (url) => {
          fetched.push(url);
          const p = Number(new URL(url).searchParams.get("p"));
          if (p === 1) return rawHtml([1, 2, 3], (id) => (id === 1 ? policyTitle(id) : noticeTitle(id)));
          return rawHtml([1, 2, 3], noticeTitle);
        },
      }),
    );
    expect(out.map((r) => r.url)).toEqual(["https://x.kr/v?id=1"]);
    expect(fetched.some((u) => u.includes("p=3"))).toBe(true);
    expect(fetched.some((u) => u.includes("p=4"))).toBe(false);
  });

  it("원본이 있는 쪽을 상한까지 읽었는데 정책이 0이어도 더 있을 수 있다고 남긴다", async () => {
    const onPageCap = vi.fn();
    const out = await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 3 } }),
      deps({
        onPageCap,
        fetchText: async (url) => {
          const p = Number(new URL(url).searchParams.get("p"));
          return rawHtml([p * 10 + 1, p * 10 + 2, p * 10 + 3], noticeTitle);
        },
      }),
    );
    expect(out).toEqual([]);
    /**
     * lastPageNew 는 상한 쪽의 **거르개 전 새 정규 주소** 수다.
     * 정책 행이 0이어도 원본에 새 글이 있으면 hitCap — 더 팔 쪽이 있을 수 있다.
     */
    expect(onPageCap).toHaveBeenCalledWith({ hitCap: true, lastPageNew: 3 });
  });

  it("상한 쪽 원본이 비면 장부를 쓰지 않는다 — 없는 쪽과 구별이 안 된다", async () => {
    const onPageCap = vi.fn();
    const out = await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 3 } }),
      deps({
        onPageCap,
        fetchText: async (url) => {
          const p = Number(new URL(url).searchParams.get("p"));
          if (p === 1) return rawHtml([1, 2, 3], policyTitle);
          if (p === 2) return rawHtml([4, 5, 6], policyTitle);
          return `<table><tbody></tbody></table>`;
        },
      }),
    );
    expect(out).toHaveLength(6);
    expect(onPageCap).not.toHaveBeenCalled();
  });

  it("뒤 쪽 원본이 날짜·제목이 깨져도 앞쪽은 유지하고 장부를 쓰지 않는다", async () => {
    const onPageCap = vi.fn();
    const fetched: string[] = [];
    const out = await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 4 } }),
      deps({
        onPageCap,
        fetchText: async (url) => {
          fetched.push(url);
          const p = Number(new URL(url).searchParams.get("p"));
          if (p === 1) return rawHtml([1, 2, 3], policyTitle);
          if (p === 2) {
            return `<table><tbody>${[7, 8, 9]
              .map(
                (id) =>
                  `<tr><td class="subject"><a href="/v?id=${id}">공지사항</a></td><td class="date"></td></tr>`,
              )
              .join("")}</tbody></table>`;
          }
          return rawHtml([10, 11, 12], policyTitle);
        },
      }),
    );
    expect(out.map((r) => r.url)).toEqual([
      "https://x.kr/v?id=1",
      "https://x.kr/v?id=2",
      "https://x.kr/v?id=3",
    ]);
    expect(fetched.some((u) => u.includes("p=3"))).toBe(false);
    expect(onPageCap).not.toHaveBeenCalled();
  });

  it("opt-in 도 절대 상한 40을 넘기지 않는다", async () => {
    const pages: number[] = [];
    await fetchBoardAll(
      sparseCfg({ list: { ...base.list, maxPages: 99 }, expectMinRows: 1 }),
      deps({
        fetchText: async (url) => {
          const p = Number(new URL(url).searchParams.get("p"));
          pages.push(p);
          return rawHtml([p], policyTitle);
        },
      }),
    );
    expect(Math.max(...pages)).toBe(PAGE_HARD_CAP);
    expect(pages.some((p) => p === PAGE_HARD_CAP + 1)).toBe(false);
  });
});

describe("원본 구조가 깨지면 지어낸 정책 행으로 통과하지 않는다", () => {
  const invented = [
    { title: "2026 지원사업 공고 하나", detailUrl: "https://x.kr/v?id=1", dateText: "2026-08-01" },
    { title: "2026 지원사업 공고 둘", detailUrl: "https://x.kr/v?id=2", dateText: "2026-08-01" },
    { title: "2026 지원사업 공고 셋", detailUrl: "https://x.kr/v?id=3", dateText: "2026-08-01" },
  ];

  it("행 선택자가 없으면 custom·validation 이 멀쩡한 행을 줘도 실패한다", async () => {
    const onAllFailed = vi.fn();
    await expect(
      fetchBoardAll(
        sparseCfg({
          customParse: () => invented,
          validationParse: () => invented,
        }),
        deps({
          onAllFailed,
          fetchText: async () => "<div>목록 없음</div>",
        }),
      ),
    ).rejects.toThrow(/게시판 추출 전 단계 실패/);
    expect(onAllFailed).toHaveBeenCalledOnce();
  });

  it("제목 칸이 비면 실패한다", async () => {
    await expect(
      fetchBoardAll(
        sparseCfg(),
        deps({
          fetchText: async () =>
            rawHtml([1, 2, 3], () => "").replaceAll("></a>", "></a>"),
        }),
      ),
    ).rejects.toThrow(/게시판 추출 전 단계 실패/);
  });

  it("날짜 칸이 비면 실패한다", async () => {
    await expect(
      fetchBoardAll(
        sparseCfg(),
        deps({
          fetchText: async () => rawHtml([1, 2, 3], policyTitle, ""),
        }),
      ),
    ).rejects.toThrow(/게시판 추출 전 단계 실패/);
  });

  it("정규 주소 열쇠가 없으면 실패한다", async () => {
    await expect(
      fetchBoardAll(
        sparseCfg(),
        deps({
          fetchText: async () =>
            `<table><tbody>${[1, 2, 3]
              .map(
                (id) =>
                  `<tr><td class="subject"><a href="/v">2026 지원사업 공고 ${id}번</a></td><td class="date">2026-08-01</td></tr>`,
              )
              .join("")}</tbody></table>`,
        }),
      ),
    ).rejects.toThrow(/게시판 추출 전 단계 실패/);
  });

  it("validationParse 가 바깥 호스트만 주면 허용 호스트 검사를 우회하지 못한다", async () => {
    const onAllFailed = vi.fn();
    await expect(
      fetchBoardAll(
        sparseCfg({
          customParse: () => invented,
          validationParse: () =>
            invented.map((r) => ({ ...r, detailUrl: r.detailUrl.replace("x.kr", "evil.test") })),
        }),
        deps({
          onAllFailed,
          fetchText: async () => rawHtml([1, 2, 3], policyTitle),
        }),
      ),
    ).rejects.toThrow(/게시판 추출 전 단계 실패/);
    expect(onAllFailed).toHaveBeenCalledOnce();
  });

  it("validationParse·customParse 에 섞인 바깥 호스트 행은 결과에서 빠진다", async () => {
    const mixedHtml = rawHtml([1, 2, 3], policyTitle);
    const out = await fetchBoardAll(
      sparseCfg({
        customParse: () => [
          { title: "2026 지원사업 공고 하나", detailUrl: "https://x.kr/v?id=1", dateText: "2026-08-01" },
          { title: "2026 지원사업 공고 둘", detailUrl: "https://evil.test/v?id=2", dateText: "2026-08-01" },
          { title: "2026 지원사업 공고 셋", detailUrl: "https://x.kr/v?id=3", dateText: "2026-08-01" },
        ],
        validationParse: (html) => parseSparseValidation(html),
      }),
      deps({ fetchText: async () => mixedHtml }),
    );
    expect(out.map((r) => r.url)).toEqual(["https://x.kr/v?id=1", "https://x.kr/v?id=3"]);
  });
});

describe("opt-in 없는 기존 수집기는 최소 행 관문을 그대로 쓴다", () => {
  it("validationParse 없이 정책 1건이면 expectMinRows 2 에서 실패한다", async () => {
    const onAllFailed = vi.fn();
    await expect(
      fetchBoardAll(
        {
          ...base,
          skipHeuristic: true,
          customParse: (html) => parseSparsePolicies(html),
        },
        deps({
          onAllFailed,
          fetchText: async () =>
            rawHtml([1, 2, 3], (id) => (id === 1 ? policyTitle(id) : noticeTitle(id))),
        }),
      ),
    ).rejects.toThrow(/행 1 < 기대 2/);
    expect(onAllFailed).toHaveBeenCalledOnce();
  });
});

describe("전북신보·메인비즈 고정본 — 거르개 뒤 1건이어도 수집한다", () => {
  it("전북신보 1쪽 정책 1건 + 2쪽 정책을 합치고, 직전 절반 급락에 안 막힌다", async () => {
    const fetched: string[] = [];
    const out = await fetchBoardAll(
      jbsinboConfig,
      deps({
        prevOpenCount: 20,
        fetchText: async (url) => {
          fetched.push(url);
          const p = Number(new URL(url).searchParams.get("pageIndex") ?? "1");
          if (p === 1) return jbsinboP1;
          if (p === 2) return jbsinboP2;
          return `<table class="bbs_list"><tbody></tbody></table>`;
        },
      }),
    );
    expect(out.some((r) => r.title.includes("자영업자 사회보험료 지원사업"))).toBe(true);
    expect(out.some((r) => r.title.includes("카드뉴스") || r.title.includes("청탁금지법"))).toBe(
      false,
    );
    expect(out.some((r) => r.title.includes("희망리턴패키지"))).toBe(true);
    expect(out.every((r) => r.url.startsWith("https://www.jbcredit.or.kr/"))).toBe(true);
    expect(out.every((r) => !r.url.includes("pageIndex"))).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(fetched.some((u) => u.includes("pageIndex=2"))).toBe(true);
  });

  it("전북신보 행 선택자·제목·날짜·NTT 열쇠가 빠지면 실패한다", async () => {
    const cases = [
      jbsinboP1.replaceAll("bbs_list", "bbs_list-x"),
      jbsinboP1.replaceAll('class="title"', 'class="title-x"'),
      jbsinboP1.replaceAll('class="m_grey"', 'class="m_grey-x"'),
      jbsinboP1.replaceAll("NTT_", "XTT_"),
    ];
    for (const html of cases) {
      await expect(
        fetchBoardAll(
          { ...jbsinboConfig, list: { ...jbsinboConfig.list, maxPages: 1 } },
          deps({ fetchText: async () => html }),
        ),
      ).rejects.toThrow(/게시판 추출 전 단계 실패/);
    }
  });

  it("메인비즈 거르개 뒤 1건이어도 1쪽을 채택하고 바깥 호스트가 없다", async () => {
    const onePolicy = mainbizP1.replace("온오프라인 통합 품평회 모집 안내", "물류&모빌리티 포럼 개최");
    const out = await fetchBoardAll(
      { ...mainbizConfig, list: { ...mainbizConfig.list, maxPages: 1 } },
      deps({
        prevOpenCount: 20,
        fetchText: async () => onePolicy,
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("수출컨소시엄 부스기업 모집");
    expect(out[0].url).toMatch(
      /^https:\/\/www\.mainbiz\.or\.kr\/notice\/company\.asp\?bidx=5906&gbn=2&smem=2&bgbn=V$/,
    );
    expect(out[0].applyPeriodText).toBe("2026-09-04 ~");
  });

  it("메인비즈 행 선택자·제목·날짜·bidx 열쇠가 빠지면 실패한다", async () => {
    const cases = [
      mainbizP1.replaceAll("board_list", "board_list-x"),
      mainbizP1.replaceAll('class="tit"', 'class="tit-x"'),
      mainbizP1.replaceAll('class="date"', 'class="date-x"'),
      mainbizP1.replaceAll("bidx=", "xid="),
    ];
    for (const html of cases) {
      await expect(
        fetchBoardAll(
          { ...mainbizConfig, list: { ...mainbizConfig.list, maxPages: 1 } },
          deps({ fetchText: async () => html }),
        ),
      ).rejects.toThrow(/게시판 추출 전 단계 실패/);
    }
  });
});

it("중간 빈 쪽 뒤 마지막 정상 쪽에 새 공고가 있으면 상한 도달을 기록한다", async () => {
  const onPageCap = vi.fn();
  const out = await fetchBoardAll(sparseCfg({ list: { ...base.list, maxPages: 3 }, emptyStreakStop: 3 }), deps({
    onPageCap,
    fetchText: async url => {
      const page = Number(new URL(url).searchParams.get("p"));
      return rawHtml(page === 2 ? [] : [page * 10 + 1, page * 10 + 2], policyTitle);
    },
  }));
  expect(out).toHaveLength(4);
  expect(onPageCap).toHaveBeenCalledOnce();
});

it("날짜가 검증된 원본에서 개시일을 비우는 붙박이 정책만 남아도 읽는다", async () => {
  const config = sparseCfg({ list: { ...base.list, maxPages: 1 }, customParse: html => parseSparsePolicies(html).map(row => ({ ...row, dateText: "" })) });
  const d = deps({ fetchText: async () => rawHtml([1, 2, 3], id => id === 1 ? policyTitle(id) : noticeTitle(id)) });
  expect(await fetchBoardAll(config, d)).toHaveLength(1);
  await expect(fetchBoardAll(config, deps({ fetchText: async () => rawHtml([1, 2, 3], policyTitle, "날짜 깨짐") }))).rejects.toThrow(/날짜/);
});
