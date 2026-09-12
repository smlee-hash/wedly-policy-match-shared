import { describe, it, expect, vi } from "vitest";
import { fetchBoardWindow } from "./page-window";
import type { BoardConfig } from "./types";
import type { BoardDeps } from "./engine";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>2026 지원사업 공고 피드1</title><link>https://x.kr/v/f1</link><pubDate>2026-08-01</pubDate></item>
<item><title>2026 지원사업 공고 피드2</title><link>https://x.kr/v/f2</link><pubDate>2026-08-02</pubDate></item>
<item><title>2026 지원사업 공고 피드3</title><link>https://x.kr/v/f3</link><pubDate>2026-08-03</pubDate></item>
</channel></rss>`;

const fields = {
  title: { selector: "td.subject a" },
  detailUrl: { selector: "td.subject a", attr: "href" },
  date: { selector: "td.date" },
};

function rowsHtml(ids: number[], date = "2026-08-01"): string {
  return `<table><tbody>${ids.map((id) =>
    `<tr><td class="subject"><a href="/v?id=${id}">2026 지원사업 공고 ${id}번</a></td><td class="date">${date}</td></tr>`,
  ).join("")}</tbody></table>`;
}

function cfg(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    id: "tp-x",
    label: "X테크노파크",
    agency: "X테크노파크",
    region: "부산",
    baseUrl: "https://x.kr/b/",
    list: {
      url: (p) => `https://x.kr/b/list?p=${p}`,
      maxPages: 99,
      rowSelector: "tbody tr",
      fields,
    },
    expectMinRows: 3,
    ...overrides,
  };
}

function deps(overrides: Partial<BoardDeps> = {}): BoardDeps {
  return {
    fetchText: async () => rowsHtml([1, 2, 3]),
    prevOpenCount: 20,
    askModel: async () => "{}",
    onAllFailed: vi.fn(),
    ...overrides,
  };
}

function pageOf(url: string): number {
  return Number(new URL(url).searchParams.get("p"));
}

describe("fetchBoardWindow", () => {
  const emptyList = "<table><tbody><tr><td colspan='3'>등록된 게시물이 없습니다.</td></tr></tbody></table>";
  it("기관의 빈 목록 표식을 연속 확인한 뒤에만 끝으로 기록한다", async () => {
    const out = await fetchBoardWindow(cfg({ skipHeuristic: true }), deps({ fetchText: async url => pageOf(url) === 41 ? rowsHtml([41]) : emptyList }), { startPage: 41, pageBudget: 5 });
    expect(out).toMatchObject({ complete: true, nextPage: 44, lastPageRead: 43 });
    expect(out.announcements).toHaveLength(1);
  });
  it("목록 밖 오류 문구를 빈 목록으로 오인하지 않는다", async () => {
    const out = await fetchBoardWindow(cfg({ skipHeuristic: true }), deps({ fetchText: async () => "<html><p>검색 결과가 없습니다. 접근이 제한되었습니다.</p></html>" }), { startPage: 41, pageBudget: 3 });
    expect(out).toMatchObject({ complete: false, nextPage: 41, reason: "incomplete" });
  });
  it("거르개로 정책만 비었어도 원본 행이 유효하면 뒤 쪽을 읽는다", async () => {
    const board = cfg({ skipHeuristic: true, customParse: (_html, page) => page === 41 ? [] : [{ title: "실제 지원사업 공고", detailUrl: `https://x.kr/v?id=${page}`, dateText: "2026-08-01" }] });
    const out = await fetchBoardWindow(board, deps({ fetchText: async url => rowsHtml([pageOf(url)]) }), { startPage: 41, pageBudget: 2 });
    expect(out).toMatchObject({ complete: false, nextPage: 43 });
    expect(out.announcements.map(a => a.sourceId)).toEqual(["https://x.kr/v?id=42"]);
  });
  it("쪽 변수가 없는 RSS는 다음 쪽에서 목록 읽기로 넘어간다", async () => {
    const board = cfg({ feed: { kind: "rss", url: () => "https://x.kr/rss", map: { title: "title", link: "link", date: "pubDate" } } });
    const out = await fetchBoardWindow(board, deps({ fetchText: async url => url.endsWith("/rss") ? RSS : rowsHtml([pageOf(url)]) }), { startPage: 41, pageBudget: 2 });
    expect(out.announcements.map(a => a.sourceId)).toEqual(["https://x.kr/v?id=41", "https://x.kr/v?id=42"]);
  });
  it("반복 고정 공고는 한 번만 반환하며 반복만으로 끝을 주장하지 않는다", async () => {
    const out = await fetchBoardWindow(cfg(), deps({ fetchText: async () => rowsHtml([1, 2]) }), { startPage: 41, pageBudget: 2 });
    expect(out.announcements).toHaveLength(2);
    expect(out.complete).toBe(false);
  });
  it("시작 쪽·쪽 예산을 정수 범위로 검사한다", async () => {
    const d = deps();
    const board = cfg();
    await expect(fetchBoardWindow(board, d, { startPage: 0, pageBudget: 1 })).rejects.toThrow(/시작 쪽/);
    await expect(fetchBoardWindow(board, d, { startPage: 1.5, pageBudget: 1 })).rejects.toThrow(/시작 쪽/);
    await expect(fetchBoardWindow(board, d, { startPage: 1, pageBudget: 0 })).rejects.toThrow(/쪽 예산/);
    await expect(fetchBoardWindow(board, d, { startPage: 1, pageBudget: 41 })).rejects.toThrow(/쪽 예산/);
    await expect(fetchBoardWindow(board, d, { startPage: 1, pageBudget: 1.2 })).rejects.toThrow(/쪽 예산/);
  });

  it("GET 41..43 을 절대 쪽으로 읽고 예산 소진은 끝이 아니다", async () => {
    const fetched: number[] = [];
    const board = cfg();
    const out = await fetchBoardWindow(board, deps({
      fetchText: async (url) => {
        const p = pageOf(url);
        fetched.push(p);
        return rowsHtml([p]);
      },
    }), { startPage: 41, pageBudget: 3 });
    expect(fetched).toEqual([41, 42, 43]);
    expect(out.announcements.map((a) => a.url)).toEqual([
      "https://x.kr/v?id=41",
      "https://x.kr/v?id=42",
      "https://x.kr/v?id=43",
    ]);
    expect(out.nextPage).toBe(44);
    expect(out.lastPageRead).toBe(43);
    expect(out.complete).toBe(false);
    expect(out.reason).toBe("page-budget");
  });

  it("POST 본문에 절대 쪽 번호를 싣는다", async () => {
    const bodies: string[] = [];
    const board = cfg({
      list: {
        url: () => "https://x.kr/b/list",
        maxPages: 99,
        init: (p) => ({ method: "POST", body: `page=${p}` }),
        rowSelector: "tbody tr",
        fields,
      },
    });
    const out = await fetchBoardWindow(board, deps({
      fetchText: async (_url, _c, init) => {
        const body = String(init?.body ?? "");
        bodies.push(body);
        const p = Number(new URLSearchParams(body).get("page"));
        return rowsHtml([p]);
      },
    }), { startPage: 41, pageBudget: 3 });
    expect(bodies).toEqual(["page=41", "page=42", "page=43"]);
    expect(out.announcements.map((a) => a.url)).toEqual([
      "https://x.kr/v?id=41",
      "https://x.kr/v?id=42",
      "https://x.kr/v?id=43",
    ]);
    expect(out.complete).toBe(false);
    expect(out.reason).toBe("page-budget");
  });

  it("customParse 에 절대 쪽 번호를 넘긴다", async () => {
    const parsed: number[] = [];
    const board = cfg({
      customParse: (_html, page) => {
        parsed.push(page);
        return [{
          title: `2026 지원사업 공고 ${page}번`,
          detailUrl: `https://x.kr/v/${page}`,
          dateText: "2026-08-01",
        }];
      },
    });
    const out = await fetchBoardWindow(board, deps({
      fetchText: async (url) => rowsHtml([pageOf(url)]),
    }), { startPage: 41, pageBudget: 3 });
    expect(parsed).toEqual([41, 42, 43]);
    expect(out.announcements.map((a) => a.url)).toEqual([
      "https://x.kr/v/41",
      "https://x.kr/v/42",
      "https://x.kr/v/43",
    ]);
  });

  it("feed 주소도 절대 쪽으로 대응한다", async () => {
    const fetched: string[] = [];
    const board = cfg({
      feed: {
        url: (p) => `https://x.kr/feed?p=${p}`,
        kind: "rss",
        map: { title: "title", link: "link", date: "pubDate" },
      },
    });
    await fetchBoardWindow(board, deps({
      fetchText: async (url) => {
        fetched.push(url);
        return RSS;
      },
    }), { startPage: 41, pageBudget: 3 });
    expect(fetched).toEqual([
      "https://x.kr/feed?p=41",
      "https://x.kr/feed?p=42",
      "https://x.kr/feed?p=43",
    ]);
  });

  it("창 중간 실패는 앞쪽 행을 남기고 실패 쪽부터 재시도한다", async () => {
    let fail42 = true;
    const fetched: number[] = [];
    const board = cfg({ skipHeuristic: true });
    const d = deps({
      fetchText: async (url) => {
        const p = pageOf(url);
        fetched.push(p);
        if (p === 42 && fail42) throw new Error("HTTP 503");
        return rowsHtml([p]);
      },
    });
    const first = await fetchBoardWindow(board, d, { startPage: 41, pageBudget: 3 });
    expect(first.announcements.map((a) => a.url)).toEqual(["https://x.kr/v?id=41"]);
    expect(first.nextPage).toBe(42);
    expect(first.lastPageRead).toBe(41);
    expect(first.complete).toBe(false);
    expect(first.reason).toBe("incomplete");
    expect(fetched.includes(43)).toBe(false);

    fail42 = false;
    fetched.length = 0;
    const second = await fetchBoardWindow(board, d, { startPage: first.nextPage, pageBudget: 2 });
    expect(fetched).toEqual([42, 43]);
    expect(second.announcements.map((a) => a.url)).toEqual([
      "https://x.kr/v?id=42",
      "https://x.kr/v?id=43",
    ]);
    expect(second.nextPage).toBe(44);
    expect(second.complete).toBe(false);
    expect(second.reason).toBe("page-budget");
  });

  it("abort 는 다음 요청을 막는다", async () => {
    const ac = new AbortController();
    const fetched: number[] = [];
    const board = cfg({ skipHeuristic: true, customParse: (_html, page) => [{
      title: `2026 지원사업 공고 ${page}번`,
      detailUrl: `https://x.kr/v/${page}`,
      dateText: "2026-08-01",
    }] });
    await expect(fetchBoardWindow(board, deps({
      fetchText: async (url) => {
        fetched.push(pageOf(url));
        ac.abort();
        return rowsHtml([pageOf(url)]);
      },
    }), { startPage: 41, pageBudget: 3, signal: ac.signal })).resolves.toMatchObject({ announcements: [], nextPage: 41, complete: false, reason: "incomplete" });
    expect(fetched).toEqual([41]);
  });

  it("원본 설정은 그대로다", async () => {
    const url = (p: number) => `https://x.kr/b/list?p=${p}`;
    const init = (p: number) => ({ method: "POST" as const, body: `page=${p}` });
    const parse = (_html: string, page: number) => [{
      title: `2026 지원사업 공고 ${page}번`,
      detailUrl: `https://x.kr/v/${page}`,
      dateText: "2026-08-01",
    }];
    const list = Object.freeze({
      url,
      init,
      maxPages: 99,
      rowSelector: "tbody tr",
      fields,
    });
    const board = Object.freeze(cfg({
      list,
      customParse: parse,
      expectMinRows: 3,
    }));
    await fetchBoardWindow(board, deps({
      fetchText: async (_url, _c, initArg) => {
        const p = Number(new URLSearchParams(String(initArg?.body ?? "")).get("page"));
        return rowsHtml([p]);
      },
    }), { startPage: 41, pageBudget: 2 });
    expect(board.list).toBe(list);
    expect(board.list.url).toBe(url);
    expect(board.list.init).toBe(init);
    expect(board.customParse).toBe(parse);
    expect(board.list.maxPages).toBe(99);
    expect(board.expectMinRows).toBe(3);
    expect(board.list.url(2)).toBe("https://x.kr/b/list?p=2");
    expect(board.list.init!(2).body).toBe("page=2");
  });

  it("빈 쪽·오류 HTML 로 complete 하지 않는다", async () => {
    const board = cfg({ skipHeuristic: true });
    const empty = await fetchBoardWindow(board, deps({
      fetchText: async () => "<div>없음</div>",
    }), { startPage: 41, pageBudget: 3 });
    expect(empty.announcements).toEqual([]);
    expect(empty.nextPage).toBe(41);
    expect(empty.complete).toBe(false);
    expect(empty.reason).toBe("incomplete");

    const errored = await fetchBoardWindow(board, deps({
      fetchText: async (url) => {
        if (pageOf(url) === 41) return rowsHtml([41]);
        return "<html><body>오류</body></html>";
      },
    }), { startPage: 41, pageBudget: 3 });
    expect(errored.announcements.map((a) => a.url)).toEqual(["https://x.kr/v?id=41"]);
    expect(errored.nextPage).toBe(42);
    expect(errored.complete).toBe(false);
    expect(errored.reason).toBe("incomplete");
  });
});

it("여러 게시판의 빈 쪽 확인 횟수를 다음 창으로 이어간다", async () => {
  const board = cfg({ emptyStreakStop: 6, skipHeuristic: true });
  const d = deps({ fetchText: async () => '<table><tbody><tr><td>등록된 게시물이 없습니다</td></tr></tbody></table>' });
  const first = await fetchBoardWindow(board, d, { startPage: 41, pageBudget: 3 });
  expect(first).toMatchObject({ complete: false, nextPage: 44, endStreak: 3 });
  const second = await fetchBoardWindow(board, d, { startPage: first.nextPage, pageBudget: 3, endStreak: first.endStreak });
  expect(second).toMatchObject({ complete: true, nextPage: 47, endStreak: 6 });
});

it("응답 없는 다음 쪽에서 중단해도 앞서 읽은 공고와 재시작 쪽을 돌려준다", async () => {
  const controller = new AbortController();
  const requested: number[] = [];
  const out = await fetchBoardWindow(cfg({ skipHeuristic: true }), deps({ fetchText: async url => {
    const page = pageOf(url);
    requested.push(page);
    if (page === 41) return rowsHtml([41]);
    setTimeout(() => controller.abort(), 10);
    return new Promise<string>(() => {});
  } }), { startPage: 41, pageBudget: 3, signal: controller.signal });
  expect(out).toMatchObject({ nextPage: 42, lastPageRead: 41, complete: false, reason: "incomplete" });
  expect(out.announcements).toHaveLength(1);
  expect(requested).toEqual([41, 42]);
}, 500);

it("행이 링크인 목록도 목록 안의 명시적인 빈 표식을 확인한다", async () => {
  const board = cfg({ list: { ...cfg().list, rowSelector: "div.board_list ul.content_wrap > a" }, skipHeuristic: true });
  const result = await fetchBoardWindow(board, deps({ fetchText: async () => '<div class="board_list"><ul class="content_wrap"><li>등록된 게시물이 없습니다.</li></ul></div>' }), { startPage: 102, pageBudget: 3 });
  expect(result).toMatchObject({ complete: true, nextPage: 104, reason: "empty-list" });
});
