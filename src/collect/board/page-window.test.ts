import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { pagingParamsOf, type BoardDeps } from "./engine";
import { GTP_ARCHIVE_COLLECTION_REVISION } from "./gtp-archive";
import { archiveCollectionRevisionOf, fetchBoardWindow } from "./page-window";
import { gtpConfig } from "./sources/gtp";
import { gwtpConfig, parseGwtpList } from "./sources/gwtp";
import { kosmesConfig } from "./sources/kosmes";
import { kotraConfig } from "./sources/kotra";
import { smartfactoryConfig } from "./sources/smartfactory";
import type { BoardConfig, BoardRow } from "./types";

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
    expect(board.dropUrlParams).toBeUndefined();
    expect(board.keepPagingParamsInDetail).toBeUndefined();
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

function gwtpLikeUrl(page: number): string {
  if (page <= 1) return "https://www.gwtp.or.kr/gwtp/bbsNew_list.php?code=sub01b&keyvalue=sub01";
  const query = `startPage=${(page - 1) * 15}&code=sub01b&table=cs_bbs_data_new`;
  return `https://www.gwtp.or.kr/gwtp/bbsNew_list.php?bbs_data=${Buffer.from(query, "utf-8").toString("base64")}||`;
}

function gwtpLikeRows(count: number, startPage = 15): string {
  const rows = Array.from({ length: count }, (_, i) => {
    const idx = 3400 + i;
    const query =
      `idx=${idx}&startPage=${startPage}&listNo=${i}&table=cs_bbs_data_new&code=sub01b` +
      `&search_item=&search_order=&url=sub01b&keyvalue=sub01&bbs_malname=`;
    const b64 = Buffer.from(query, "utf-8").toString("base64");
    return `<tr><td class="subject"><a href="https://www.gwtp.or.kr/gwtp/bbsNew_view.php?bbs_data=${b64}||">2026 지원사업 공고 ${idx}번</a></td><td class="date">2026-08-01</td></tr>`;
  }).join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

describe("절대 쪽 주소 정규화", () => {
  it("GWTP 절대 2쪽은 bbs_data 를 쪽 변수로 재추론하지 않아 29개 주소를 유지하고 3쪽으로 간다", async () => {
    expect(pagingParamsOf({
      ...cfg({ skipHeuristic: true, list: { ...cfg().list, url: gwtpLikeUrl } }),
    })).toEqual([]);
    const html = gwtpLikeRows(29);
    const board = cfg({
      skipHeuristic: true,
      expectMinRows: 1,
      baseUrl: "https://www.gwtp.or.kr/gwtp/",
      list: {
        ...cfg().list,
        url: gwtpLikeUrl,
        rowSelector: "tbody tr",
        fields: {
          title: { selector: "td.subject a" },
          detailUrl: { selector: "td.subject a", attr: "href" },
          date: { selector: "td.date" },
        },
      },
    });
    const out = await fetchBoardWindow(board, deps({ fetchText: async () => html }), { startPage: 2, pageBudget: 1 });
    const ids = out.announcements.map((a) => a.sourceId);
    expect(new Set(ids).size).toBe(29);
    expect(ids.every((id) => id.includes("bbs_data="))).toBe(true);
    expect(out).toMatchObject({ nextPage: 3, complete: false, reason: "page-budget" });
  });

  it("GWTP 고정본 2쪽은 일반 파서와 같은 고유 주소를 유지한다", async () => {
    const html = readFileSync(join(__dirname, "__fixtures__/gwtp-list-p2.html"), "utf-8");
    const parsed = parseGwtpList(html, 2);
    const expected = [...new Set(parsed.map((r) => r.detailUrl))].sort();
    const out = await fetchBoardWindow(gwtpConfig, deps({ fetchText: async () => html }), { startPage: 2, pageBudget: 1 });
    expect(out.announcements.map((a) => a.sourceId).sort()).toEqual(expected);
    expect(out.nextPage).toBe(3);
    expect(out.complete).toBe(false);
    expect(pagingParamsOf(gwtpConfig)).toEqual([]);
  });

  it("일반 질의 쪽 변수는 절대 쪽에서도 상세 주소에서 지운다", async () => {
    const board = cfg({
      skipHeuristic: true,
      list: {
        ...cfg().list,
        url: (p) => `https://x.kr/b/list?p=${p}`,
      },
    });
    const out = await fetchBoardWindow(board, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        return `<table><tbody><tr><td class="subject"><a href="/v?id=${p}&p=${p}">2026 지원사업 공고 ${p}번</a></td><td class="date">2026-08-01</td></tr></tbody></table>`;
      },
    }), { startPage: 41, pageBudget: 1 });
    expect(out.announcements).toHaveLength(1);
    expect(out.announcements[0].sourceId).toBe("https://x.kr/v?id=41");
    expect(out.announcements[0].sourceId).not.toContain("p=");
  });

  it("경로 쪽넘김 표식은 절대 쪽에서도 상세 주소에서 지운다", async () => {
    const board = cfg({
      skipHeuristic: true,
      list: {
        ...cfg().list,
        url: (p) => `https://x.kr/index/page/${p}`,
      },
    });
    const out = await fetchBoardWindow(board, deps({
      fetchText: async () => `<table><tbody><tr><td class="subject"><a href="/view/page/41/id/1130">2026 지원사업 공고 1130번</a></td><td class="date">2026-08-01</td></tr></tbody></table>`,
    }), { startPage: 41, pageBudget: 1 });
    expect(out.announcements).toHaveLength(1);
    expect(out.announcements[0].sourceId).toBe("https://x.kr/view/id/1130");
  });

  it("손으로 적은 dropUrlParams 는 절대 쪽에서도 지운다", async () => {
    const board = cfg({
      skipHeuristic: true,
      dropUrlParams: ["tag"],
    });
    const out = await fetchBoardWindow(board, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        return `<table><tbody><tr><td class="subject"><a href="/v?id=${p}&p=${p}&tag=x">2026 지원사업 공고 ${p}번</a></td><td class="date">2026-08-01</td></tr></tbody></table>`;
      },
    }), { startPage: 41, pageBudget: 1 });
    expect(out.announcements[0].sourceId).toBe("https://x.kr/v?id=41");
  });

  it("keepPagingParamsInDetail 출처는 절대 쪽에서도 쪽 변수를 남긴다", async () => {
    const board = cfg({
      skipHeuristic: true,
      keepPagingParamsInDetail: true,
      list: {
        ...cfg().list,
        url: (p) => `https://x.kr/b/list?pageIndex=${p}`,
      },
    });
    const out = await fetchBoardWindow(board, deps({
      fetchText: async () => `<table><tbody><tr><td class="subject"><a href="/v?id=23384&pageIndex=41">2026 지원사업 공고 23384번</a></td><td class="date">2026-08-01</td></tr></tbody></table>`,
    }), { startPage: 41, pageBudget: 1 });
    expect(out.announcements[0].sourceId).toContain("pageIndex=41");
    expect(board.keepPagingParamsInDetail).toBe(true);
    expect(board.dropUrlParams).toBeUndefined();
  });
});

describe("출처 끝 증거", () => {
  const kotraEmpty = `<div class="card"><div class="card-inner"><div class="card-body">조회된 데이터가 없습니다.</div></div></div><input type="hidden" id="limtTotCnt" value="91">`;
  const kotraRow = `<div class="card"><div class="card-inner"><div class="card-body"><a class="card-tit" href="javascript:fn_selectBizMntInfoDetailNew('/subList/20000020753/subhome/bizAply/selectBizMntInfoDetail.do?&dtlBizMntNo=26CN0O6&cpbizYn=N');">2026 멕시코 경제사절단</a><dl><dt>신청기간</dt><dd>2026-08-27 ~ 2026-09-03</dd></dl></div></div></div>`;
  const kosmesEnd = JSON.stringify({
    pageInfo: {
      rowMax: 44, pageCount: 10, startPage: 1, startRowNum: 51, scopeRow: 50,
      endRowNum: 61, rowCount: 10, endPage: 5, maxPage: 5, nowPage: 6,
    },
    ds_infoList: [],
  });
  const sfPage = {
    blockPage: "10", pageBasic: "1", startNumber: "60", showPage: "10",
    totalPageCount: "6", endNumber: "51", currentPage: "7", totalCount: "51",
  };
  const smartfactoryEnd = JSON.stringify({
    paginationInfo: sfPage,
    pbancList: [],
    key: "list",
    modelAndView: {
      model: { pbancList: [], paginationInfo: sfPage, key: "list" },
      modelMap: { pbancList: [], paginationInfo: sfPage, key: "list" },
    },
  });

  it("KOTRA 빈 쪽 하나만으로는 끝내지 않고 연속 두 쪽만 끝낸다", async () => {
    const one = await fetchBoardWindow(kotraConfig, deps({ fetchText: async () => kotraEmpty }), { startPage: 3, pageBudget: 1 });
    expect(one).toMatchObject({ complete: false, nextPage: 4, endStreak: 1 });
    const both = await fetchBoardWindow(kotraConfig, deps({ fetchText: async () => kotraEmpty }), { startPage: 3, pageBudget: 2 });
    expect(both).toMatchObject({ complete: true, nextPage: 5, reason: "empty-list", endStreak: 2 });
  });

  it("KOTRA 한 목록만 비어도 다른 목록을 끝내지 않는다", async () => {
    const out = await fetchBoardWindow(kotraConfig, deps({
      fetchText: async (_url, _c, init) => {
        const body = String(init?.body ?? "");
        return body.includes("sch_appl_yn=Y") ? kotraRow : kotraEmpty;
      },
    }), { startPage: 3, pageBudget: 2 });
    expect(out.complete).toBe(false);
    expect(out.endStreak).toBe(0);
    expect(out.announcements.some((a) => a.sourceId.includes("26CN0O6"))).toBe(true);
  });

  it("중진공·스마트공장 관측 JSON 끝은 연속 빈 쪽으로 완료한다", async () => {
    let kp = 6;
    const kosmes = await fetchBoardWindow(kosmesConfig, deps({ fetchText: async () => {
      const body = JSON.parse(kosmesEnd);
      Object.assign(body.pageInfo, { nowPage: kp, startRowNum: (kp - 1) * 10 + 1, scopeRow: (kp - 1) * 10, endRowNum: kp * 10 + 1 });
      kp++;
      return JSON.stringify(body);
    } }), { startPage: 6, pageBudget: 2 });
    expect(kosmes).toMatchObject({ complete: true, nextPage: 8, reason: "empty-list" });
    let sp = 7;
    const sf = await fetchBoardWindow(smartfactoryConfig, deps({ fetchText: async () => {
      const body = JSON.parse(smartfactoryEnd);
      for (const page of [body.paginationInfo, body.modelAndView.model.paginationInfo, body.modelAndView.modelMap.paginationInfo]) {
        Object.assign(page, { currentPage: String(sp), startNumber: String((sp - 1) * 10) });
      }
      sp++;
      return JSON.stringify(body);
    } }), { startPage: 7, pageBudget: 2 });
    expect(sf).toMatchObject({ complete: true, nextPage: 9, reason: "empty-list" });
  });

  it("JSON의 쪽 번호가 요청과 다르면 진행 위치를 유지한다", async () => {
    const stale = await fetchBoardWindow(kosmesConfig, deps({ fetchText: async () => kosmesEnd }), { startPage: 7, pageBudget: 2 });
    expect(stale).toMatchObject({ complete: false, nextPage: 7, reason: "incomplete", endStreak: 0 });
  });

  it("경기TP 마감 10줄은 건너뛰지 않고 미완료로 남긴다", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      `<tr><td class="subject"><a href="#none" onclick="fn_goView('${172000 + i}'); return false;" title="2026 지원사업 공고 ${i + 1}번">2026 지원사업 공고 ${i + 1}번</a></td><td class="last">마감</td></tr>`,
    ).join("");
    const out = await fetchBoardWindow(gtpConfig, deps({
      fetchText: async () => `<table class="t01"><tbody>${rows}</tbody></table>`,
    }), { startPage: 5, pageBudget: 2 });
    expect(out.complete).toBe(false);
    expect(out.reason).toBe("incomplete");
    expect(out.nextPage).toBe(5);
    expect(out.announcements).toHaveLength(0);
  });

  it("알 수 없는 JSON·오류 본문은 끝으로 보지 않는다", async () => {
    const unknown = await fetchBoardWindow(kosmesConfig, deps({ fetchText: async () => JSON.stringify({ items: [] }) }), { startPage: 6, pageBudget: 2 });
    expect(unknown).toMatchObject({ complete: false, reason: "incomplete", nextPage: 6 });
    const errored = await fetchBoardWindow(kosmesConfig, deps({
      fetchText: async () => JSON.stringify({ pageInfo: { resultCd: "999", resultMsg: "시스템 오류가 발생하였습니다." } }),
    }), { startPage: 6, pageBudget: 2 });
    expect(errored).toMatchObject({ complete: false, reason: "incomplete" });
  });
});

function gtpArchiveRow(opts: { id: string; title: string; agency: string; period: string }): string {
  return `<tr>
    <td>1</td>
    <td class="subject"><a href="#none" onclick="fn_goView('${opts.id}'); return false;" title="${opts.title}">${opts.title.slice(0, 12)}</a></td>
    <td>기술</td>
    <td></td>
    <td>${opts.agency}</td>
    <td class="last">${opts.period}</td>
  </tr>`;
}

describe("경기TP 지난 공고 창", () => {
  const closed = Array.from({ length: 10 }, (_, i) => {
    const id = String(172310 + i);
    const day = String(10 + i).padStart(2, "0");
    return {
      id,
      title: `2026년 지원사업 공고 ${id}번`,
      agency: i % 2 ? "경기도" : "경기 테크노파크",
      start: `2026-08-${day}`,
      end: `2026-08-${String(11 + i).padStart(2, "0")}`,
    };
  });

  it("출처 개정값은 GTP 만 고정이고 다른 출처는 비운다", () => {
    expect(archiveCollectionRevisionOf(gtpConfig)).toBe(GTP_ARCHIVE_COLLECTION_REVISION);
    expect(archiveCollectionRevisionOf(kosmesConfig)).toBeNull();
    expect(archiveCollectionRevisionOf(kotraConfig)).toBeNull();
    expect(archiveCollectionRevisionOf({ ...gtpConfig, id: "dgtp" })).toBeNull();
    expect(gtpConfig.createListSession).toBeUndefined();
  });

  it("마감 10줄은 상세의 지난 기간으로 10건을 남기고 쪽은 한 칸만 진행한다", async () => {
    const fetched: string[] = [];
    const list = `<table class="t01"><tbody>${closed.map((row) => gtpArchiveRow({ ...row, period: "마감" })).join("")}</tbody></table>`;
    const out = await fetchBoardWindow(gtpConfig, deps({
      fetchText: async (url) => {
        fetched.push(url);
        if (url.includes("webBusinessList.do")) return list;
        const id = new URL(url).searchParams.get("b_idx") ?? "";
        const row = closed.find((item) => item.id === id);
        if (!row) throw new Error(`unexpected ${url}`);
        return `<dl><dt>접수 기간</dt><dd>${row.start} 00:00&nbsp;~&nbsp;${row.end} 18:00</dd></dl>`;
      },
    }), { startPage: 5, pageBudget: 1 });
    expect(out.complete).toBe(false);
    expect(out.reason).toBe("page-budget");
    expect(out.nextPage).toBe(6);
    expect(out.lastPageRead).toBe(5);
    expect(out.announcements).toHaveLength(10);
    expect(out.announcements.map((a) => a.sourceId)).toEqual(
      closed.map((row) => `https://pms.gtp.or.kr/web/business/webBusinessView.do?b_idx=${row.id}`),
    );
    expect(out.announcements.map((a) => a.title)).toEqual(closed.map((row) => row.title));
    expect(out.announcements.map((a) => a.agency)).toEqual(closed.map((row) => row.agency));
    expect(out.announcements.map((a) => a.applyPeriodText)).toEqual(
      closed.map((row) => `${row.start} ~ ${row.end}`),
    );
    expect(fetched.filter((url) => url.includes("webBusinessView.do"))).toHaveLength(10);
    expect(gtpConfig.createListSession).toBeUndefined();
  });

  it("상세가 비면 그 쪽을 비우지 않고 커서를 그대로 둔다", async () => {
    const list = `<table class="t01"><tbody>${closed.map((row) => gtpArchiveRow({ ...row, period: "마감" })).join("")}</tbody></table>`;
    const out = await fetchBoardWindow(gtpConfig, deps({
      fetchText: async (url) => url.includes("webBusinessList.do") ? list : "<div>본문만</div>",
    }), { startPage: 5, pageBudget: 2 });
    expect(out).toMatchObject({
      complete: false,
      reason: "incomplete",
      nextPage: 5,
      lastPageRead: 4,
    });
    expect(out.announcements).toHaveLength(0);
  });

  it("날짜 있는 줄은 상세를 부르지 않고 마감 줄만 채운다", async () => {
    const fetched: string[] = [];
    const list = `<table class="t01"><tbody>${[
      gtpArchiveRow({ id: "172300", title: "2026년 지원사업 공고 열린줄", agency: "경기도", period: "2026-09-01 09:00 <br>~ 2026-09-21 17:00" }),
      gtpArchiveRow({ id: "172316", title: "2026년 지원사업 공고 316번", agency: "안산시", period: "마감" }),
    ].join("")}</tbody></table>`;
    const out = await fetchBoardWindow(gtpConfig, deps({
      fetchText: async (url) => {
        fetched.push(url);
        if (url.includes("webBusinessList.do")) return list;
        if (url.includes("b_idx=172316")) return `<dl><dt>접수 기간</dt><dd>2026-08-07 00:00&nbsp;~&nbsp;2026-08-31 18:00</dd></dl>`;
        throw new Error(`unexpected ${url}`);
      },
    }), { startPage: 5, pageBudget: 1 });
    expect(out.announcements.map((a) => a.sourceId)).toEqual([
      "https://pms.gtp.or.kr/web/business/webBusinessView.do?b_idx=172300",
      "https://pms.gtp.or.kr/web/business/webBusinessView.do?b_idx=172316",
    ]);
    expect(out.announcements.map((a) => a.applyPeriodText)).toEqual([
      "2026-09-01 ~ 2026-09-21",
      "2026-08-07 ~ 2026-08-31",
    ]);
    expect(fetched.filter((url) => url.includes("webBusinessView.do"))).toEqual([
      "https://pms.gtp.or.kr/web/business/webBusinessView.do?b_idx=172316",
    ]);
  });

  it("상세 요청 중단도 가드 fetch 를 타고 미완료로 남긴다", async () => {
    const ac = new AbortController();
    const fetched: string[] = [];
    const list = `<table class="t01"><tbody>${gtpArchiveRow({
      id: "172316",
      title: "2026년 지원사업 공고 316번",
      agency: "경기도",
      period: "마감",
    })}</tbody></table>`;
    const out = await fetchBoardWindow(gtpConfig, deps({
      fetchText: async (url) => {
        fetched.push(url);
        if (url.includes("webBusinessView.do")) {
          setTimeout(() => ac.abort(), 10);
          return new Promise<string>(() => {});
        }
        return list;
      },
    }), { startPage: 5, pageBudget: 1, signal: ac.signal });
    expect(out).toMatchObject({ complete: false, reason: "incomplete", nextPage: 5, lastPageRead: 4 });
    expect(out.announcements).toHaveLength(0);
    expect(fetched.some((url) => url.includes("webBusinessView.do"))).toBe(true);
  }, 500);
});

describe("끝 쪽 판정 보강", () => {
  const pagingHtml = (pages: number[]) =>
    `<div class="paging">${pages.map((n) => `<a>${n}</a>`).join("")}</div><table><tbody></tbody></table>`;
  const endBoard = cfg({ skipHeuristic: true });

  it("쪽 이동 최댓값이 출처 쪽보다 작고 그 번호가 없으면 beyond-last-page 이다", async () => {
    // 즉시 완료하지 않고 빈 쪽처럼 endStreak 를 올린다. 한 쪽만이면 예산 소진이다.
    const out = await fetchBoardWindow(endBoard, deps({ fetchText: async () => pagingHtml([1, 2]) }), { startPage: 3, pageBudget: 1 });
    expect(out).toMatchObject({ reason: "page-budget", complete: false, nextPage: 4, lastPageRead: 3, endStreak: 1 });
  });

  it("쪽 이동 상자에 그 쪽 번호가 있으면 beyond-last-page 가 아니다", async () => {
    const out = await fetchBoardWindow(endBoard, deps({ fetchText: async () => pagingHtml([1, 2, 3]) }), { startPage: 3, pageBudget: 1 });
    expect(out.reason).not.toBe("beyond-last-page");
  });

  it("1쪽은 beyond-last-page 가 아니다", async () => {
    const out = await fetchBoardWindow(endBoard, deps({ fetchText: async () => pagingHtml([1, 2]) }), { startPage: 1, pageBudget: 1 });
    expect(out.reason).not.toBe("beyond-last-page");
  });

  it("offset 형 쪽 변수는 beyond-last-page 로 오인하지 않는다", async () => {
    const board = cfg({
      skipHeuristic: true,
      list: { ...cfg().list, url: (p) => `https://x.kr/b/list?offset=${(p - 1) * 10}` },
    });
    const out = await fetchBoardWindow(
      board,
      deps({ fetchText: async () => pagingHtml([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }),
      { startPage: 3, pageBudget: 1 },
    );
    expect(out.reason).not.toBe("beyond-last-page");
  });

  it("직전 쪽과 행 지문이 같으면 repeated-page 이다", async () => {
    const out = await fetchBoardWindow(cfg(), deps({
      fetchText: async (url) => pageOf(url) === 1 ? rowsHtml([4, 5, 6]) : rowsHtml([1, 2, 3]),
    }), { startPage: 2, pageBudget: 3 });
    expect(out).toMatchObject({ reason: "repeated-page", complete: true });
    expect(out.announcements.map((a) => a.sourceId).sort()).toEqual([
      "https://x.kr/v?id=1",
      "https://x.kr/v?id=2",
      "https://x.kr/v?id=3",
    ]);
    expect(out.lastPageKey).toEqual(expect.any(String));
  });

  it("lastPageKey 로 이어 받으면 첫 쪽부터 연속을 센다", async () => {
    const probe = await fetchBoardWindow(cfg(), deps({ fetchText: async () => rowsHtml([1, 2, 3]) }), { startPage: 2, pageBudget: 1 });
    expect(probe.lastPageKey).toEqual(expect.any(String));
    const out = await fetchBoardWindow(cfg(), deps({ fetchText: async () => rowsHtml([1, 2, 3]) }), {
      startPage: 2,
      pageBudget: 2,
      lastPageKey: probe.lastPageKey,
    });
    expect(out).toMatchObject({ reason: "repeated-page", complete: true, nextPage: 4 });
  });

  it("incomplete 창은 소비하지 않은 쪽의 지문을 lastPageKey 에 남기지 않는다", async () => {
    const errorHtml = "<div>오류</div>";
    const page2Html = rowsHtml([1, 2, 3]);
    const board = cfg({ skipHeuristic: true });
    const htmlOf = async (url: string) => pageOf(url) === 2 ? page2Html : errorHtml;
    const probe = await fetchBoardWindow(board, deps({ fetchText: htmlOf }), { startPage: 2, pageBudget: 1 });
    const first = await fetchBoardWindow(board, deps({ fetchText: htmlOf }), { startPage: 2, pageBudget: 2 });
    expect(first).toMatchObject({ reason: "incomplete", complete: false, nextPage: 3 });
    expect(first.lastPageKey).toBe(probe.lastPageKey);
    const second = await fetchBoardWindow(board, deps({ fetchText: async () => errorHtml }), {
      startPage: 3,
      pageBudget: 2,
      lastPageKey: first.lastPageKey,
    });
    expect(second).toMatchObject({ reason: "incomplete", complete: false });
    expect(second.reason).not.toBe("repeated-page");
  });

  it("목록 상자만 있고 행이 없으면 empty-list 이다", async () => {
    // 쪽 이동 상자 숫자가 없으면 행 없는 목록으로 끝내지 않는다(점검·차단 안내와 구분).
    const out = await fetchBoardWindow(endBoard, deps({ fetchText: async () => "<table><tbody></tbody></table>" }), { startPage: 2, pageBudget: 2 });
    expect(out).toMatchObject({ reason: "incomplete", complete: false, nextPage: 2 });
  });

  it("로그인 폼이 있으면 행 없는 목록으로 끝내지 않는다", async () => {
    const html = `<form action="/login"><input type="password" name="pw"></form><table><tbody></tbody></table>`;
    const out = await fetchBoardWindow(endBoard, deps({ fetchText: async () => html }), { startPage: 2, pageBudget: 2 });
    expect(out).toMatchObject({ complete: false, reason: "incomplete" });
  });

  it("0000 날짜만 있으면 empty-list 로 끝낸다", async () => {
    // 쪽 이동 상자 숫자가 없으면 0000 날짜 행만으로 끝내지 않는다.
    const out = await fetchBoardWindow(endBoard, deps({
      fetchText: async (url) => rowsHtml(pageOf(url) === 2 ? [1, 2, 3] : [4, 5, 6], "0000-00-00"),
    }), { startPage: 2, pageBudget: 2 });
    expect(out).toMatchObject({ reason: "incomplete", complete: false, nextPage: 2 });
  });

  it("범위 안 JSON 거른 쪽은 읽은 쪽으로 세고 다음으로 간다", async () => {
    const json = '{"paginationInfo":{"currentPageNo":2,"totalPageCount":5},"list":[{"a":1}]}';
    const out = await fetchBoardWindow(
      cfg({ skipHeuristic: true, customParse: (): BoardRow[] => [] }),
      deps({ fetchText: async () => json }),
      { startPage: 2, pageBudget: 1 },
    );
    expect(out).toMatchObject({ nextPage: 3, lastPageRead: 2, complete: false, reason: "page-budget", endStreak: 0 });
  });

  it("블록 끝 쪽에서 customParse 0행이면 beyond-last-page 가 아니고 진행한다", async () => {
    const board = cfg({
      skipHeuristic: true,
      customParse: (_html, page) => page === 5 ? [] : [{
        title: "실제 지원사업 공고",
        detailUrl: `https://x.kr/v?id=${page}`,
        dateText: "2026-08-01",
      }],
    });
    const paging = `<div class="board-page"><a>1</a><a>2</a><a>3</a><a>4</a><strong>5</strong><a>다음페이지</a></div>`;
    const out = await fetchBoardWindow(board, deps({
      fetchText: async (url) => rowsHtml([pageOf(url)]) + paging,
    }), { startPage: 4, pageBudget: 3 });
    expect(out).toMatchObject({ complete: false, nextPage: 7 });
  });

  it("표만 있는 점검 화면은 연속이어도 incomplete 이다", async () => {
    const html = "<table><tbody><tr><td>서비스 점검 중입니다.</td></tr></tbody></table>";
    const out = await fetchBoardWindow(endBoard, deps({ fetchText: async () => html }), { startPage: 41, pageBudget: 3 });
    expect(out).toMatchObject({ reason: "incomplete", complete: false, nextPage: 41 });
  });

  it("JSON 범위 안이어도 customParse 검증 실패 쪽은 incomplete 이다", async () => {
    const json = (p: number) => JSON.stringify({
      pageInfo: { nowPage: p, maxPage: 5 },
      ds_infoList: [{ SLNO: "1", TITL_NM: "실제 지원사업 공고" }],
    });
    const out = await fetchBoardWindow(
      kosmesConfig,
      deps({ fetchText: async () => json(2) }),
      { startPage: 2, pageBudget: 2 },
    );
    expect(out).toMatchObject({ reason: "incomplete", complete: false, nextPage: 2 });
  });

  it("beyond-last-page 는 연속 빈 쪽에서만 완료한다", async () => {
    const d = deps({ fetchText: async () => pagingHtml([1, 2]) });
    const both = await fetchBoardWindow(endBoard, d, { startPage: 3, pageBudget: 3 });
    expect(both).toMatchObject({ complete: true, reason: "beyond-last-page", nextPage: 5, endStreak: 2 });
    const one = await fetchBoardWindow(endBoard, d, { startPage: 3, pageBudget: 1 });
    expect(one).toMatchObject({ complete: false, reason: "page-budget", endStreak: 1 });
  });
});
