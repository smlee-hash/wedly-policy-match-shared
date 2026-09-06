import { describe, it, expect, vi } from "vitest";
import { fetchBoardAll, fetchBoardDetail, endOfKstDay, allowedHostsOf, PAGE_CAP_WRITE_TIMEOUT_MS, PAGE_HARD_CAP } from "./engine";
import type { BoardConfig } from "./types";

const LIST = `<table><tbody>
<tr><td class="subject"><a href="/v?id=1">2026 지원사업 공고 하나</a></td><td class="date">2026-08-01</td></tr>
<tr><td class="subject"><a href="/v?id=2">2026 지원사업 공고 둘</a></td><td class="date">2026-08-02</td></tr>
<tr><td class="subject"><a href="/v?id=3">2026 지원사업 공고 셋</a></td><td class="date">2026-08-03</td></tr>
</tbody></table>`;

const cfg: BoardConfig = {
  id: "tp-x", label: "X테크노파크", agency: "X테크노파크", region: "부산", baseUrl: "https://x.kr/b/",
  list: { url: () => "https://x.kr/b/list", maxPages: 1, rowSelector: "tbody tr",
    fields: { title: { selector: "td.subject a" }, detailUrl: { selector: "td.subject a", attr: "href" }, date: { selector: "td.date" } } },
  expectMinRows: 1,
};

function deps(overrides: Partial<Parameters<typeof fetchBoardAll>[1]> = {}) {
  return {
    fetchText: async () => LIST,
    prevOpenCount: 0,
    askModel: async () => "{}",
    onAllFailed: vi.fn(),
    ...overrides,
  };
}

function rowsHtml(ids: number[], date = "2026-08-01"): string {
  return `<table><tbody>${ids.map((id) =>
    `<tr><td class="subject"><a href="/v?id=${id}">2026 지원사업 공고 ${id}번</a></td><td class="date">${date}</td></tr>`,
  ).join("")}</tbody></table>`;
}

describe("endOfKstDay", () => {
  it("KST 하루 끝은 UTC 같은 날 14:59:59", () => {
    expect(endOfKstDay(2026, 8, 28)?.toISOString()).toBe("2026-08-28T14:59:59.000Z");
  });
  it("달력에 없는 날짜는 null (2월 30일 포함)", () => {
    expect(endOfKstDay(2026, 2, 30)).toBeNull();
    expect(endOfKstDay(2026, 2, 31)).toBeNull();
    expect(endOfKstDay(2026, 2, 29)).toBeNull();
  });
  it("윤년 2월 29일은 허용", () => {
    expect(endOfKstDay(2024, 2, 29)?.toISOString()).toBe("2024-02-29T14:59:59.000Z");
  });
});

describe("fetchBoardAll", () => {
  it("① selector 로 뽑아 정규화한다(source=id, 절대링크, dedupKey)", async () => {
    const out = await fetchBoardAll(cfg, {
      fetchText: async () => LIST, prevOpenCount: 0,
      askModel: async () => "{}", onAllFailed: vi.fn(),
    });
    expect(out).toHaveLength(3);
    expect(out[0].source).toBe("tp-x");
    expect(out[0].url).toBe("https://x.kr/v?id=1");
    expect(out[0].region).toBe("부산");
    expect(out[0].targetText).toBe("");   // 상세는 lazy
  });

  it("① 이 깨지면 ② heuristic 이 받는다", async () => {
    const broken = { ...cfg, list: { ...cfg.list, rowSelector: "table.nope tr" } };
    const out = await fetchBoardAll(broken, {
      fetchText: async () => LIST, prevOpenCount: 0, askModel: async () => "{}", onAllFailed: vi.fn(),
    });
    expect(out.length).toBe(3);   // heuristic 이 구조로 복구
  });

  it("전 단계 실패면 onAllFailed 후 throw 하고 층별 사유를 담는다", async () => {
    const onAllFailed = vi.fn();
    await expect(fetchBoardAll(cfg, {
      fetchText: async () => "<div>깨진 페이지</div>", prevOpenCount: 20,
      askModel: async () => "{}", onAllFailed,
    })).rejects.toThrow(/게시판 추출 전 단계 실패:.*selector:.*heuristic:/);
    expect(onAllFailed).toHaveBeenCalledOnce();
    const reason = String(onAllFailed.mock.calls[0][1]);
    expect(reason).toMatch(/selector:/);
    expect(reason).toMatch(/heuristic:/);
  });

  it("합산 검증 실패면 그 층만 버리고 다음 층으로 내려간다", async () => {
    // selector 는 tbody 3행, heuristic 은 ul 12행. customParse 가 있으면 heuristic 으로
    // 내려가지 않으므로(2026-09-02) 이 시험은 selector-only 설정으로 하강을 잰다.
    const html = `${LIST}<ul>${Array.from({ length: 12 }, (_, i) =>
      `<li><a href="/v?id=${i}">2026 지원사업 공고 ${i}번 모집</a><em>2026-08-01</em></li>`,
    ).join("")}</ul>`;
    const onAllFailed = vi.fn();
    const out = await fetchBoardAll(cfg, deps({
      fetchText: async () => html,
      prevOpenCount: 20,
      onAllFailed,
    }));
    expect(out.length).toBe(12);
    expect(onAllFailed).not.toHaveBeenCalled();
  });

  it("2페이지를 합친다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
      expectMinRows: 3,
    };
    const fetched: string[] = [];
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        fetched.push(url);
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        if (p === 2) return rowsHtml([4, 5]);
        if (p === 3) return rowsHtml([6]);
        return "<div>없음</div>";
      },
    }));
    expect(out.map((r) => r.url)).toEqual([
      "https://x.kr/v?id=1",
      "https://x.kr/v?id=2",
      "https://x.kr/v?id=3",
      "https://x.kr/v?id=4",
      "https://x.kr/v?id=5",
      "https://x.kr/v?id=6",
    ]);
    expect(fetched.filter((u) => u.includes("p=2")).length).toBeGreaterThan(0);
  });

  // ★2026-09-01 동작 변경. 예전에는 「이미 본 것뿐인 쪽」 하나로 즉시 멈췄는데, 그러면
  //   고정 공지가 쪽마다 되풀이되는 게시판에서 **그 뒤의 진짜 새 공고를 통째로 잃는다.**
  //   (이 시험이 바로 그 손실을 기대값으로 못 박고 있었다 — 3쪽의 7·8·9 를 버리는 것이 정답이었다.)
  //   사장님 지시(「단 1건도 놓치면 안 된다」)로 **연속 두 쪽**이 빌 때만 멈추게 바꿨다.
  it("뒤 페이지가 이미 본 것뿐이어도 한 쪽은 더 넘겨 본다 — 그 뒤의 새 공고를 잃지 않게", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const fetched: string[] = [];
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        fetched.push(url);
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        if (p === 2) return rowsHtml([1, 2, 3]);
        if (p === 3) return rowsHtml([7, 8, 9]);
        return "<div>없음</div>";
      },
    }));
    expect(out.map((r) => r.url)).toEqual([
      "https://x.kr/v?id=1",
      "https://x.kr/v?id=2",
      "https://x.kr/v?id=3",
      "https://x.kr/v?id=7",
      "https://x.kr/v?id=8",
      "https://x.kr/v?id=9",
    ]);
    expect(fetched.some((u) => u.includes("p=3"))).toBe(true);
  });

  it("연속 두 쪽이 이미 본 것뿐이면 멈춘다 — 끝없이 넘기지 않는다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 8 },
    };
    const fetched: string[] = [];
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        fetched.push(url);
        return rowsHtml([1, 2, 3]); // 어느 쪽이든 같은 목록
      },
    }));
    expect(out).toHaveLength(3);
    // 2쪽·3쪽이 연속으로 신규 0 → 4쪽부터는 안 부른다
    expect(fetched.some((u) => u.includes("p=3"))).toBe(true);
    expect(fetched.some((u) => u.includes("p=4"))).toBe(false);
  });

  /**
   * ★분류·부서를 한 쪽씩 번갈아 도는 출처(안양 8분류)는 「연속 N쪽 신규 0」의 N 을 올려 받는다
   * (2026-09-05 독립 검사 지적 4). 기본 2 는 「이 분류가 비었다」와 「전체가 끝났다」를
   * 구분하지 못해서, 작은 분류 둘이 나란히 오면 그 자리에서 끊겨 뒤 분류가 통째로 안 들어온다.
   */
  it("emptyStreakStop 을 올리면 빈 쪽이 이어져도 한 바퀴를 끝까지 돈다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      emptyStreakStop: 4,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 5 },
    };
    const fetched: string[] = [];
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        fetched.push(url);
        const p = Number(new URL(url).searchParams.get("p"));
        // 2·3·4쪽은 「이 분류가 비었다」(신규 0) — 기본값 2 였다면 3쪽에서 끊겨 5쪽을 영영 못 본다.
        if (p <= 4) return rowsHtml([1, 2, 3]);
        return rowsHtml([7, 8, 9]);
      },
    }));
    expect(out.map((r) => r.url)).toContain("https://x.kr/v?id=7");
    expect(fetched.some((u) => u.includes("p=5"))).toBe(true);
  });

  it("emptyStreakStop 을 안 적으면 예전대로 연속 두 쪽에서 멈춘다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 5 },
    };
    const fetched: string[] = [];
    await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        fetched.push(url);
        const p = Number(new URL(url).searchParams.get("p"));
        return p === 5 ? rowsHtml([7, 8, 9]) : rowsHtml([1, 2, 3]);
      },
    }));
    expect(fetched.some((u) => u.includes("p=4"))).toBe(false);
  });

  it("뒤 페이지 오류·행 0이면 그까지 모은 것을 유지한다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const outZero = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        return `<table><tbody></tbody></table>`;
      },
    }));
    expect(outZero).toHaveLength(3);

    const outErr = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        throw new Error("timeout");
      },
    }));
    expect(outErr).toHaveLength(3);
  });

  it("단일 날짜 뒤 ~ 만 있고 둘째 날짜가 없으면 applyStart (상시)", async () => {
    const html = rowsHtml([1, 2, 3], "2026-08-28 ~ 예산 소진 시");
    const out = await fetchBoardAll(cfg, deps({ fetchText: async () => html }));
    expect(out[0].applyStart?.toISOString()).toBe("2026-08-27T15:00:00.000Z");
    expect(out[0].applyEnd).toBeNull();
    expect(out[0].applyPeriodText).toBe("2026-08-28 ~ 예산 소진 시");
  });

  it("단일 날짜+시각(충남형)은 여전히 applyEnd", async () => {
    const html = rowsHtml([1, 2, 3], "2026-08-28 17:00");
    const out = await fetchBoardAll(cfg, deps({ fetchText: async () => html }));
    expect(out[0].applyStart).toBeNull();
    expect(out[0].applyEnd?.toISOString()).toBe("2026-08-28T14:59:59.000Z");
    expect(out[0].applyPeriodText).toBe("2026-08-28 17:00");
  });

  it("범위 날짜는 parseApplyPeriod 결과 그대로", async () => {
    const html = rowsHtml([1, 2, 3], "2026-08-14~2026-09-02");
    const out = await fetchBoardAll(cfg, deps({ fetchText: async () => html }));
    expect(out[0].applyStart?.toISOString()).toBe("2026-08-13T15:00:00.000Z");
    expect(out[0].applyEnd?.toISOString()).toBe("2026-09-02T14:59:59.000Z");
    expect(out[0].applyPeriodText).toBe("2026-08-14~2026-09-02");
  });

  it("달력에 없는 단일 날짜는 applyEnd null", async () => {
    const html = rowsHtml([1, 2, 3], "2026-02-30");
    const out = await fetchBoardAll(cfg, deps({ fetchText: async () => html }));
    expect(out[0].applyStart).toBeNull();
    expect(out[0].applyEnd).toBeNull();
  });

  it("feed 가 있으면 ⓪ 를 우선하고 성공 시 ① 을 호출하지 않는다", async () => {
    const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>2026 지원사업 공고 피드1</title><link>https://x.kr/v/f1</link><pubDate>2026-08-01</pubDate></item>
<item><title>2026 지원사업 공고 피드2</title><link>https://x.kr/v/f2</link><pubDate>2026-08-02</pubDate></item>
<item><title>2026 지원사업 공고 피드3</title><link>https://x.kr/v/f3</link><pubDate>2026-08-03</pubDate></item>
</channel></rss>`;
    const withFeed: BoardConfig = {
      ...cfg,
      feed: {
        url: (p) => `https://x.kr/feed?p=${p}`,
        kind: "rss",
        map: { title: "title", link: "link", date: "pubDate" },
      },
    };
    const urls: string[] = [];
    const out = await fetchBoardAll(withFeed, deps({
      fetchText: async (url) => {
        urls.push(url);
        if (url.includes("/feed")) return RSS;
        return LIST;
      },
    }));
    expect(out).toHaveLength(3);
    expect(out[0].title).toContain("피드");
    expect(out[0].url).toBe("https://x.kr/v/f1");
    expect(urls.some((u) => u.includes("/b/list"))).toBe(false);
    expect(urls.every((u) => u.includes("/feed"))).toBe(true);
  });

  it("행 agency 가 있으면 그걸 쓰고 없으면 cfg.agency", async () => {
    const withParse: BoardConfig = {
      ...cfg,
      customParse: () => [
        { title: "2026 행기관 공고 하나", detailUrl: "https://x.kr/v/a1", dateText: "2026-08-01", agency: "울산경제진흥원" },
        { title: "2026 행기관 공고 둘", detailUrl: "https://x.kr/v/a2", dateText: "2026-08-02" },
      ],
    };
    const out = await fetchBoardAll(withParse, deps());
    expect(out[0].agency).toBe("울산경제진흥원");
    expect(out[1].agency).toBe("X테크노파크");
  });

  it("자가수리 채택 시 onHealedRule 을 호출한다", async () => {
    const html = `<table><tbody>
<tr class="row"><td><a href="/v/1">2026 지원사업 공고 하나</a><time>2026-08-01</time></td></tr>
<tr class="row"><td><a href="/v/2">2026 지원사업 공고 둘</a><time>2026-08-02</time></td></tr>
</tbody></table>`;
    const broken: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, rowSelector: "table.nope tr" },
      expectMinRows: 1,
    };
    const onHealedRule = vi.fn(async () => {});
    const out = await fetchBoardAll(broken, deps({
      fetchText: async () => html,
      askModel: async () => JSON.stringify({
        rowSelector: "tr.row",
        fields: {
          title: { selector: "a" },
          detailUrl: { selector: "a", attr: "href" },
          date: { selector: "time" },
        },
      }),
      onHealedRule,
    }));
    expect(out).toHaveLength(2);
    expect(onHealedRule).toHaveBeenCalledOnce();
    expect(onHealedRule.mock.calls[0][0].rowSelector).toBe("tr.row");
  });

  it("페이지 안 중복 URL 은 한 번만 모은다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        if (p === 2) return rowsHtml([4, 4, 5]);
        return rowsHtml([6]);
      },
    }));
    expect(out.map((r) => r.url)).toEqual([
      "https://x.kr/v?id=1",
      "https://x.kr/v?id=2",
      "https://x.kr/v?id=3",
      "https://x.kr/v?id=4",
      "https://x.kr/v?id=5",
      "https://x.kr/v?id=6",
    ]);
  });

  it("뒤 페이지 검증 실패면 그 페이지를 버리고 중단한다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const fetched: string[] = [];
    const junkPage = `<table><tbody>${[7, 8, 9].map((id) =>
      `<tr><td class="subject"><a href="/v?id=${id}">공지사항</a></td><td class="date">2026-08-01</td></tr>`,
    ).join("")}</tbody></table>`;
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        fetched.push(url);
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        if (p === 2) return junkPage;
        return rowsHtml([7, 8, 9]);
      },
    }));
    expect(out).toHaveLength(3);
    expect(fetched.some((u) => u.includes("p=3"))).toBe(false);
  });

  it("2페이지 이후는 expectMinRows 없이 검증해 짧은 페이지도 모은다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 2 },
      expectMinRows: 5,
    };
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3, 4, 5]);
        return rowsHtml([6, 7]);
      },
    }));
    expect(out).toHaveLength(7);
  });

  it("maxPages 는 30 으로 자른다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 99 },
      expectMinRows: 1,
    };
    const pages: number[] = [];
    await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        pages.push(p);
        return rowsHtml([p]);
      },
    }));
    expect(Math.max(...pages)).toBe(PAGE_HARD_CAP);
    expect(pages.filter((p) => p === PAGE_HARD_CAP + 1).length).toBe(0);
  });

  it("허용 호스트 밖 http 상세주소 행은 검증 전에 제거한다", async () => {
    const withParse: BoardConfig = {
      ...cfg,
      customParse: () => [
        { title: "2026 지원사업 공고 하나", detailUrl: "https://x.kr/v/1", dateText: "2026-08-01" },
        { title: "2026 지원사업 공고 둘", detailUrl: "https://evil.test/v/2", dateText: "2026-08-01" },
        { title: "2026 지원사업 공고 셋", detailUrl: "https://x.kr/v/3", dateText: "2026-08-01" },
      ],
    };
    const out = await fetchBoardAll(withParse, deps());
    expect(out.map((r) => r.url)).toEqual(["https://x.kr/v/1", "https://x.kr/v/3"]);
  });

  it("allowedHosts 는 baseUrl 호스트에 추가된다", () => {
    const hosts = allowedHostsOf({ ...cfg, allowedHosts: ["cdn.x.kr"] });
    expect(hosts.sort()).toEqual(["cdn.x.kr", "x.kr"].sort());
  });

  it("비패딩 하이픈 단일 날짜도 applyEnd 가 나온다", async () => {
    const html = rowsHtml([1, 2, 3], "2026-8-1");
    const out = await fetchBoardAll(cfg, deps({ fetchText: async () => html }));
    expect(out[0].applyEnd?.toISOString()).toBe("2026-08-01T14:59:59.000Z");
  });

  it("customParse 의 점 날짜는 방어적으로 정규화하고, 이미 정규화된 값은 그대로 둔다", async () => {
    const withParse: BoardConfig = {
      ...cfg,
      customParse: () => [
        { title: "2026 점날짜 공고 하나", detailUrl: "https://x.kr/v/d1", dateText: "2026.08.26 ~ 2026.09.04" },
        { title: "2026 점날짜 공고 둘", detailUrl: "https://x.kr/v/d2", dateText: "2026-08-01" },
      ],
    };
    const out = await fetchBoardAll(withParse, deps());
    expect(out[0].applyPeriodText).toBe("2026-08-26 ~ 2026-09-04");
    expect(out[0].applyStart?.toISOString()).toBe("2026-08-25T15:00:00.000Z");
    expect(out[0].applyEnd?.toISOString()).toBe("2026-09-04T14:59:59.000Z");
    expect(out[1].applyPeriodText).toBe("2026-08-01");
  });

  it("customParse 가 있으면 selfheal 을 건너뛴다", async () => {
    const askModel = vi.fn(async () => "{}");
    const onAllFailed = vi.fn();
    const withParse: BoardConfig = {
      ...cfg,
      customParse: () => [],
      expectMinRows: 1,
    };
    await expect(fetchBoardAll(withParse, deps({
      fetchText: async () => "<div>없음</div>",
      askModel,
      onAllFailed,
    }))).rejects.toThrow(/selfheal: customParse 게시판이라 건너뜀/);
    expect(askModel).not.toHaveBeenCalled();
    expect(onAllFailed).toHaveBeenCalledOnce();
  });

  // ★2026-09-02 운영 실측(한국수출입은행): customParse 1쪽은 맞는데 2쪽 fetch 가
  //   ECONNRESET 으로 끊기면 합산 급락으로 selector 가 버리고, heuristic 이 첨부 파일
  //   링크를 공고로 저장했다. customParse 는 사람이 확정한 구조라 추측 층은 정답이 될 수 없다.
  it("skipHeuristic 설정이면 selector 실패 때 heuristic 으로 내려가지 않는다(한국수출입은행)", async () => {
    const withParse: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 2 },
      skipHeuristic: true,
      customParse: () => [0, 1, 2].map((i) => ({
        title: `2026 지원사업 공고 ${i}번 모집`,
        detailUrl: `https://x.kr/v?id=${i}`,
        dateText: "2026-08-01",
      })),
      expectMinRows: 1,
    };
    const fetched: string[] = [];
    const onAllFailed = vi.fn();
    await expect(fetchBoardAll(withParse, deps({
      prevOpenCount: 20,
      onAllFailed,
      fetchText: async (url) => {
        fetched.push(url);
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return LIST;
        throw new TypeError("fetch failed");
      },
    }))).rejects.toThrow(/heuristic: 설정\(skipHeuristic\)으로 건너뜀/);
    expect(onAllFailed).toHaveBeenCalledOnce();
    expect(String(onAllFailed.mock.calls[0][1])).toMatch(/heuristic: 설정\(skipHeuristic\)으로 건너뜀/);
    // selector 가 1·2쪽만. heuristic 이 목록을 다시 부르면 p=1 이 2회.
    expect(fetched.filter((u) => u.includes("p=1"))).toHaveLength(1);
    expect(fetched.filter((u) => u.includes("p=2"))).toHaveLength(1);
  });

  it("onAllFailed 가 던져도 층별 사유 throw 가 산다", async () => {
    const onAllFailed = vi.fn(async () => { throw new Error("slack down"); });
    await expect(fetchBoardAll(cfg, {
      fetchText: async () => "<div>깨진 페이지</div>",
      prevOpenCount: 20,
      askModel: async () => "{}",
      onAllFailed,
    })).rejects.toThrow(/게시판 추출 전 단계 실패:.*selector:.*heuristic:/);
  });

  it("dropUrlParams 는 절대화 직후 쿼리를 지워 같은 공고를 한 건으로 본다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      dropUrlParams: ["nPage"],
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 2 },
    };
    const out = await fetchBoardAll(paged, deps({
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) {
          return `<table><tbody>
<tr><td class="subject"><a href="/v?id=1&nPage=1">2026 지원사업 공고 하나</a></td><td class="date">2026-08-01</td></tr>
<tr><td class="subject"><a href="/v?id=2&nPage=1">2026 지원사업 공고 둘</a></td><td class="date">2026-08-01</td></tr>
<tr><td class="subject"><a href="/v?id=3&nPage=1">2026 지원사업 공고 셋</a></td><td class="date">2026-08-01</td></tr>
</tbody></table>`;
        }
        return `<table><tbody>
<tr><td class="subject"><a href="/v?id=1&nPage=2">2026 지원사업 공고 하나</a></td><td class="date">2026-08-01</td></tr>
<tr><td class="subject"><a href="/v?id=4&nPage=2">2026 지원사업 공고 넷</a></td><td class="date">2026-08-01</td></tr>
</tbody></table>`;
      },
    }));
    const ids = out.map((r) => new URL(r.url).searchParams.get("id")).sort();
    expect(ids).toEqual(["1", "2", "3", "4"]);
    expect(out.every((r) => !new URL(r.url).searchParams.has("nPage"))).toBe(true);
  });

  it("비어있지 않은 javascript·mailto 상세주소 행은 제거하고 빈 URL 은 남긴다", async () => {
    const withParse: BoardConfig = {
      ...cfg,
      customParse: () => [
        { title: "2026 지원사업 공고 하나", detailUrl: "https://x.kr/v/1", dateText: "2026-08-01" },
        { title: "2026 지원사업 공고 둘", detailUrl: "javascript:goView(2)", dateText: "2026-08-01" },
        { title: "2026 지원사업 공고 셋", detailUrl: "https://x.kr/v/3", dateText: "2026-08-01" },
        { title: "2026 지원사업 공고 넷", detailUrl: "", dateText: "2026-08-01" },
        { title: "2026 지원사업 공고 다섯", detailUrl: "mailto:a@x.kr", dateText: "2026-08-01" },
        { title: "2026 지원사업 공고 여섯", detailUrl: "https://x.kr/v/6", dateText: "2026-08-01" },
      ],
    };
    const out = await fetchBoardAll(withParse, deps());
    expect(out.some((r) => r.url.startsWith("javascript:") || r.url.startsWith("mailto:"))).toBe(false);
    expect(out.some((r) => r.url === "")).toBe(true);
    expect(out.filter((r) => r.url.startsWith("https://")).map((r) => r.url)).toEqual([
      "https://x.kr/v/1",
      "https://x.kr/v/3",
      "https://x.kr/v/6",
    ]);
  });

  it("마지막 쪽(maxPages)에 이 회차 신규가 있으면 onPageCap(hitCap: true)", async () => {
    const onPageCap = vi.fn();
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const out = await fetchBoardAll(paged, deps({
      onPageCap,
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2]);
        if (p === 2) return rowsHtml([3, 4]);
        return rowsHtml([5, 6]);
      },
    }));
    expect(out).toHaveLength(6);
    expect(onPageCap).toHaveBeenCalledWith({ hitCap: true, lastPageNew: 2 });
  });

  it("마지막 쪽이 이미 본 공고뿐이면 onPageCap(hitCap: false)", async () => {
    const onPageCap = vi.fn();
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    await fetchBoardAll(paged, deps({
      onPageCap,
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        if (p === 2) return rowsHtml([4, 5]);
        return rowsHtml([1, 2, 3]);
      },
    }));
    expect(onPageCap).toHaveBeenCalledWith({ hitCap: false, lastPageNew: 0 });
  });

  it("상한 전에 멈추면 마지막 쪽을 안 봤으니 hitCap false 로 기록한다", async () => {
    const onPageCap = vi.fn();
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 8 },
    };
    await fetchBoardAll(paged, deps({
      onPageCap,
      fetchText: async () => rowsHtml([1, 2, 3]),
    }));
    expect(onPageCap).toHaveBeenCalledWith({ hitCap: false, lastPageNew: 0 });
  });

  it("전 단계 실패면 onPageCap 을 부르지 않는다", async () => {
    const onPageCap = vi.fn();
    await expect(fetchBoardAll(cfg, deps({
      onPageCap,
      fetchText: async () => "<div>깨진 페이지</div>",
      prevOpenCount: 20,
    }))).rejects.toThrow(/게시판 추출 전 단계 실패/);
    expect(onPageCap).not.toHaveBeenCalled();
  });

  it("onPageCap 이 던져도 수집 결과는 그대로 돌아온다", async () => {
    const onPageCap = vi.fn(async () => { throw new Error("db down"); });
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const out = await fetchBoardAll(paged, deps({
      onPageCap,
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2]);
        if (p === 2) return rowsHtml([3]);
        return rowsHtml([4]);
      },
    }));
    expect(out).toHaveLength(4);
  });

  it("① onPageCap 이 멈추면 시간 제한 뒤 수집은 끝나고, 나중에 던져도 떠도는 거부가 없다", async () => {
    vi.useFakeTimers();
    const leaked: unknown[] = [];
    const onUnhandled = (reason: unknown) => { leaked.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      let rejectLate!: (err: Error) => void;
      const onPageCap = vi.fn(() => new Promise<void>((_, reject) => { rejectLate = reject; }));
      const paged: BoardConfig = {
        ...cfg,
        list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
      };
      const hanging = fetchBoardAll(paged, deps({
        onPageCap,
        fetchText: async (url) => {
          const p = Number(new URL(url).searchParams.get("p"));
          if (p === 1) return rowsHtml([1, 2]);
          if (p === 2) return rowsHtml([3]);
          return rowsHtml([4]);
        },
      }));
      await vi.advanceTimersByTimeAsync(PAGE_CAP_WRITE_TIMEOUT_MS);
      const out = await hanging;
      expect(out).toHaveLength(4);
      rejectLate(new Error("late fail"));
      await Promise.resolve();
      await Promise.resolve();
      expect(leaked).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });

  it("② 마지막 쪽이 0행·검증실패·HTTP 오류면 장부를 쓰지 않는다", async () => {
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const fetchByPage = (last: (p: number) => Promise<string> | string) => async (url: string) => {
      const p = Number(new URL(url).searchParams.get("p"));
      if (p === 1) return rowsHtml([1, 2, 3]);
      if (p === 2) return rowsHtml([4, 5, 6]);
      return last(p);
    };

    const onEmpty = vi.fn();
    const emptyOut = await fetchBoardAll(paged, deps({
      onPageCap: onEmpty,
      fetchText: fetchByPage(async () => "<table><tbody></tbody></table>"),
    }));
    expect(emptyOut).toHaveLength(6);
    expect(onEmpty).not.toHaveBeenCalled();

    const onBad = vi.fn();
    const badHtml = `<table><tbody>${[7, 8, 9].map((id) =>
      `<tr><td class="subject"><a href="/v?id=${id}">2026 지원사업 공고 ${id}번</a></td><td class="date"></td></tr>`,
    ).join("")}</tbody></table>`;
    const badOut = await fetchBoardAll(paged, deps({
      onPageCap: onBad,
      fetchText: fetchByPage(async () => badHtml),
    }));
    expect(badOut).toHaveLength(6);
    expect(onBad).not.toHaveBeenCalled();

    const onHttp = vi.fn();
    const httpOut = await fetchBoardAll(paged, deps({
      onPageCap: onHttp,
      fetchText: fetchByPage(async () => { throw new Error("HTTP 503"); }),
    }));
    expect(httpOut).toHaveLength(6);
    expect(onHttp).not.toHaveBeenCalled();
  });

  it("⑤ 빈 detailUrl 행만 되풀이되는 마지막 쪽은 hitCap false 다", async () => {
    const onPageCap = vi.fn();
    const paged: BoardConfig = {
      ...cfg,
      list: { ...cfg.list, url: (p) => `https://x.kr/b/list?p=${p}`, maxPages: 3 },
    };
    const emptyHrefRows = (ids: number[]) => `<table><tbody>${ids.map((id) =>
      `<tr><td class="subject"><a href="">2026 지원사업 공고 빈${id}</a></td><td class="date">2026-08-01</td></tr>`,
    ).join("")}${[1, 2, 3].map((id) =>
      `<tr><td class="subject"><a href="/v?id=${id}">2026 지원사업 공고 ${id}번</a></td><td class="date">2026-08-01</td></tr>`,
    ).join("")}</tbody></table>`;
    await fetchBoardAll(paged, deps({
      onPageCap,
      fetchText: async (url) => {
        const p = Number(new URL(url).searchParams.get("p"));
        if (p === 1) return rowsHtml([1, 2, 3]);
        if (p === 2) return rowsHtml([4, 5, 6]);
        return emptyHrefRows([91, 92]);
      },
    }));
    expect(onPageCap).toHaveBeenCalledWith({ hitCap: false, lastPageNew: 0 });
  });
});

describe("fetchBoardDetail", () => {
  it("detailContentSelector 매칭 전부 텍스트를 줄바꿈으로 이어 붙인다", async () => {
    const html = `<div>
      <table class="table-bordered2"><tr><td>   </td></tr></table>
      <table class="table-bordered2"><tr><td>신청대상 : 중소기업</td></tr></table>
      <table class="table-bordered2"><tr><td>세번째 표 내용</td></tr></table>
    </div>`;
    const detailCfg: BoardConfig = { ...cfg, detailContentSelector: "table.table-bordered2" };
    const text = await fetchBoardDetail(detailCfg, "https://x.kr/v/1", { fetchText: async () => html });
    expect(text).toContain("신청대상 : 중소기업");
    expect(text).toContain("세번째 표 내용");
    expect(text).toContain("\n\n");
  });
  it("허용 호스트 밖 URL 이면 throw", async () => {
    await expect(fetchBoardDetail(cfg, "https://evil.test/v/1", { fetchText: async () => "<div/>" }))
      .rejects.toThrow(/허용/);
  });
  it("상세 텍스트가 2만자를 넘으면 자르고 잘림 표식을 붙인다", async () => {
    const html = `<div class="c">${"가".repeat(20_050)}</div>`;
    const detailCfg: BoardConfig = { ...cfg, detailContentSelector: "div.c" };
    const text = await fetchBoardDetail(detailCfg, "https://x.kr/v/1", { fetchText: async () => html });
    expect(text.endsWith("\n[상세 잘림]")).toBe(true);
    expect(text.slice(0, 20_000)).toBe("가".repeat(20_000));
    expect(text.length).toBe(20_000 + "\n[상세 잘림]".length);
  });
});

describe("목록 POST(init) passthrough", () => {
  it("list.init 이 있으면 fetchText 3번째 인자로 페이지별 init 이 전달된다", async () => {
    const calls: Array<{ url: string; init?: unknown }> = [];
    const cfg: BoardConfig = {
      id: "t", label: "t", agency: "t", region: "t",
      baseUrl: "https://ex.com/",
      list: {
        url: () => "https://ex.com/api",
        maxPages: 2,
        init: (p) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPage: p }) }),
        rowSelector: "tr",
        fields: { title: {}, detailUrl: {}, date: {} },
      },
      customParse: (text) => JSON.parse(text).map((t: string, i: number) => ({
        title: t, detailUrl: `https://ex.com/v/${i}`, dateText: "2026-08-01 ~ 2026-12-31",
      })),
      expectMinRows: 1,
    };
    const deps = {
      prevOpenCount: 0,
      fetchText: async (url: string, _c?: unknown, init?: unknown) => {
        calls.push({ url, init });
        const body = init && typeof init === "object" ? JSON.parse((init as { body: string }).body) : { currentPage: 0 };
        return body.currentPage === 1 ? JSON.stringify(["공고 A", "공고 B"]) : JSON.stringify([]);
      },
      askModel: async () => "",
      onAllFailed: async () => {},
    };
    const rows = await fetchBoardAll(cfg, deps as never);
    expect(rows.length).toBe(2);
    const bodies = calls.map((c) => (c.init as { body?: string } | undefined)?.body ?? "");
    expect(bodies[0]).toContain('"currentPage":1');
    expect(bodies.some((b) => b.includes('"currentPage":2'))).toBe(true);
  });
});
