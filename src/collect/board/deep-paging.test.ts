import { describe, expect, it } from "vitest";
import { BOARD_SOURCES } from "./registry";

/**
 * 「몇 쪽까지 긁을지」는 **그 게시판이 마감일을 읽어 주는가**로 갈린다.
 *
 * 왜(2026-09-01 실측): 게시판 21곳이 3쪽까지만 긁고 있었는데, 접수기간이 긴 공고는
 * 게시판에서 뒤로 밀려 **한 번도 수집된 적이 없었다**(부산TP 실측: 1~3쪽 모집중 26건,
 * 4쪽에 모집중 9건이 D-36~D-122 로 남아 있었다).
 *
 * 그런데 쪽수를 무턱대고 올리면 안 된다. 뒷쪽은 대개 **이미 끝난 공고**인데,
 * 마감일을 못 읽는 게시판에서는 `markExpiredClosed` 가 닫지 못해 **끝난 공고가 「모집중」으로
 * 목록에 섞인다.** 그래서 열린 공고의 마감일 보유율이 높은 곳만 깊이 판다.
 *
 * 운영 실측 보유율(2026-09-01): bizok·djbea·gepa·gjtp·jbba·semas·tp-busan·
 * tp-daejeon·tp-gyeongbuk·tp-gyeongnam·tp-jeonbuk·ulsan = 100%, tp-chungnam = 86%.
 *
 * ★2026-09-01 2차 개정 — 「마감일 0%면 얕게」의 전제가 바뀌었다.
 * 그 사이 `store.ts` 에 **등록 90일 자동 마감**(applyEnd 없고 applyStart 가 90일 넘으면 닫음,
 * 단 본문에 아직 안 지난 날짜가 있으면 열어 둠)이 생겼다. 즉 **등록일만 주는 게시판도**
 * 뒷쪽 옛 공고가 「모집중」으로 섞이지 않는다 — 저장 시점에 닫힌다.
 * 그래서 기준을 「마감일을 주는가」에서 **「마감일 또는 등록일 중 하나는 주는가」**로 넓혔다.
 *
 * 넓힌 근거(2026-09-01 22곳을 25쪽까지 실제로 긁어 DB와 대조):
 * 지금 안 보는 쪽에 gepa 34건·semas 24건·gjtp 1건이 **마감일이 미래인 채로** 남아 있었고,
 * cba 303·gcgf 88·mss 68·seoultp 24·khidi 12건이 마감일 미상으로 남아 있었다.
 * 사장님 지시(2026-09-01 「단 1건도 놓치면 안 된다」)로 이 일곱 곳을 깊이 판다.
 *
 * 아직 얕게 두는 곳과 이유:
 * · smartfactory — 목록을 **접수중(ING)만** 불러오게 이미 걸러 7쪽으로 못 박은 결정이 있다
 * · riia-gn·riia-jn — 25쪽까지 긁어도 **DB에 없는 새 공고가 0건**이었다(팔 게 없다)
 *
 * ★2026-09-02 3차 개정 — 상한 도달 21곳을 30쪽까지 직접 긁어 「아직 안 끝난 2026년 지원사업」만 셈.
 *   semas 40·mss 65·dgtp 25·gepa 11·tp-chungnam 10건이 상한 밖에 살아 있어 그 다섯만 연다.
 *   dgtp 는 전날 「25쪽까지 0건」이었으나 이번 탐침에서 살아 있는 공고가 나왔다.
 *   cba·gcgf·hsbiz 는 상한 밖이 지난 글·행사·용역이라 **일부러 얕게** 둔다.
 */
const DEEP_PAGING_ALLOWED = new Set([
  // 2026-09-03 「누락 0」 물결 — 새 수집기(등록일/접수기간을 주고 90일 자동 마감·감시 장치가 뒷정리)
  "sba", "gtp", "itp", "gbsa", "ketep", "kiat", "gwtp", "ipet", "keiti", "kidp", "kotra", "atkorea", "kita", "nipa", "motie", "kicox", "smes24", "cbf",
  // 2026-09-03 「누락 0」 물결 — 새 수집기(등록일/접수기간을 주고 90일 자동 마감·감시 장치가 뒷정리)
  "geri", "ypa", "gopa", "cistep", "dgsinbo", "paju", "nyj", "bssinbo", "djsinbo", "icsinbo", "sjsinbo", "gnsinbo", "jbsinbo", "cnsinbo", "cbsinbo", "seoulsinbo", "jnsinbo", "dapa", "jepa", "touraz", "koreg", "kocca", "jba", "sjtp", "cbtp", "ptp", "bepa",
  "bizok", "djbea", "gepa", "gjtp", "jbba", "semas",
  "tp-busan", "tp-chungnam", "tp-daejeon", "tp-gyeongbuk", "tp-gyeongnam", "tp-jeonbuk", "ulsan",
  // 2차 개정 — 등록일만 주지만 90일 자동 마감이 뒷정리를 해 준다
  "cba", "gcgf", "mss", "seoultp", "khidi",
  // 앞선 「POST 전용이라 1쪽이 끝」 기록이 틀렸다. 폼이 method=get 이고 변수는 pageNo 다(2026-09-01 실측)
  "exportvoucher",
  // 2026-09-01 신규 연결 — 등록일을 주므로 90일 자동 마감이 뒷정리를 해 준다
  "hsbiz",
  // 신청기간을 목록에서 주는 드문 곳 — 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다
  "cwip",
  // 2026-09-02 실측 — 상한 밖 살아 있는 2026년 지원사업 25건
  "dgtp",
  // 2026-09-02 신규 연결 — 목록이 **접수기간을 통째로** 준다(`td.term` = 「2026-08-31~2026-09-17」).
  // 마감일을 읽으므로 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다. 총 3,627건.
  "snip",
  // 2026-09-03 상한 올림 — 감시 장치 실측 상한 밖, 사장님 누락 0 지시. 이번에 7을 넘김.
  "pipa",
  "jica",
  // 2026-09-03 — 등록일만 있어 저장 단계의 「등록 90일 자동 마감」이 옛 글을 닫아 주는 개시형 게시판.
  // 담당부서 4곳 × 2쪽(한 쪽씩 번갈아)이라 상한이 8이다.
  "ansan",
  // 2026-09-05 신규 연결 — 목록이 **접수기간을 시작·마감 둘 다** 준다(`2026-08-20~2026-09-04`,
  // 실측 286건 전부). 마감일을 읽으므로 깊이 파도 끝난 공고가 「모집중」으로 안 섞인다.
  // 분류 8곳 × 1쪽(한 분류가 500행 한 쪽에 다 들어온다)이라 상한이 8 — SHALLOW_MAX(7)를 넘어 등록이 필요하다.
  "aca",
]);
/** 얕은 게시판의 상한 — 이보다 크면 「깊이 파는 것」으로 본다. */
const SHALLOW_MAX = 7;

describe("깊이 파는 게시판은 마감일을 읽는 곳만", () => {
  it("허용 목록 밖 게시판은 얕게 둔다 — 마감일을 못 읽으면 끝난 공고가 「모집중」으로 섞인다", () => {
    const violations = BOARD_SOURCES
      .filter((c) => !DEEP_PAGING_ALLOWED.has(c.id) && c.list.maxPages > SHALLOW_MAX)
      .map((c) => `${c.id}(${c.list.maxPages}쪽)`);
    expect(violations).toEqual([]);
  });

  it("허용 목록의 게시판은 실제로 깊이 판다 — 안 그러면 이 목록이 죽은 글이 된다", () => {
    const notDeep = BOARD_SOURCES
      .filter((c) => DEEP_PAGING_ALLOWED.has(c.id) && c.list.maxPages <= SHALLOW_MAX)
      .map((c) => `${c.id}(${c.list.maxPages}쪽)`);
    expect(notDeep).toEqual([]);
  });

  it("허용 목록에 적힌 id 는 전부 실재하는 출처다 — 오타·이름 변경을 잡는다", () => {
    const known = new Set(BOARD_SOURCES.map((c) => c.id));
    const missing = [...DEEP_PAGING_ALLOWED].filter((id) => !known.has(id));
    expect(missing).toEqual([]);
  });

  it("엔진 상한(45쪽)을 넘는 설정은 없다", () => {
    expect(BOARD_SOURCES.filter((c) => c.list.maxPages > 45).map((c) => c.id)).toEqual([]);
  });

  it("실익이 실측된 게시판은 깊이를 열어 둔다(2026-09-02 30쪽 탐침)", () => {
    const by = Object.fromEntries(BOARD_SOURCES.map((c) => [c.id, c.list.maxPages]));
    // 살아 있는 2026년 지원사업이 상한 밖에 있던 곳 — 실측 근거는 계획서 표
    expect(by["semas"]).toBeGreaterThanOrEqual(30);
    expect(by["mss"]).toBeGreaterThanOrEqual(30);
    expect(by["dgtp"]).toBeGreaterThanOrEqual(30);
    expect(by["gepa"]).toBeGreaterThanOrEqual(30);
    expect(by["tp-chungnam"]).toBeGreaterThanOrEqual(20);
  });

  it("2026-09-03 상한 올림 — 감시 장치 상한 밖 건을 값어치로 빼지 않는다", () => {
    const by = Object.fromEntries(BOARD_SOURCES.map((c) => [c.id, c.list.maxPages]));
    expect(by["cba"]).toBeGreaterThanOrEqual(30);
    expect(by["gcgf"]).toBeGreaterThanOrEqual(25);
    expect(by["hsbiz"]).toBeGreaterThanOrEqual(20);
  });
});

import { pagingParamsOf, fetchBoardAll } from "./engine";
import type { BoardConfig } from "./types";

/**
 * 상세 주소가 곧 sourceId 라, 목록이 상세 링크에 **자기가 보던 쪽 번호**를 달아 주면
 * 같은 공고가 쪽마다 다른 공고로 저장된다(2026-09-01 운영 실측: 열린 291건 중 20묶음이 그 중복).
 * 쪽수를 더 파면 그만큼 늘어나므로, 깊이 파기 전에 이걸 먼저 막아야 한다.
 */
/**
 * 쪽 변수가 주소 변수로 드러나지 않는 게시판(2026-09-03 실측):
 * - gwtp: 쪽 번호가 base64 봉투(bbs_data) 안의 startPage 라 변수 이름이 없다. 상세 봉투는 startPage 가 빈칸이라 쪽마다 안 갈린다.
 * - sba: ASP.NET 포스트백(__EVENTTARGET·__VIEWSTATE)이라 목록 주소가 쪽마다 같고, 상세는 PostingDetail.aspx?p=0&mid=<GUID> 로 쪽 정보가 없다.
 * 둘 다 상세 주소에 쪽이 안 섞이므로 중복 저장이 원리적으로 안 난다 — 그래서 감지 대상에서 뺀다.
 */
const PAGING_WITHOUT_URL_PARAM = new Set(["gwtp", "sba", "kita", "atkorea", "ansan"]);
// - kita: 진행중·상시지원 두 목록을 홀짝으로 번갈아 읽어 url(1)·url(2) 의 경로가 다르다(둘 다 pageIndex=1).
//   상세 주소는 goDetailPage 식별자로 조립해 쪽 정보가 없다(kita.test 가 pageIndex 미포함을 단언).
// - atkorea: 게시판 4곳(d00·e00·f00·400)을 한 쪽씩 번갈아 읽어 url(1)·url(2) 의 경로만 다르고
//   쪽 번호는 둘 다 1 이다. 상세 주소는 articleId 로만 조립해 쪽 정보가 없다
//   (atkorea.test 가 「currentPage 미포함 + d00 한 모양」을 단언). 한 쪽씩 번갈아 읽는 이유는
//   「연속 두 쪽 신규 0」 규칙이 대상 하나의 빈 결과와 전체 끝을 구분하지 못해서다(2026-09-03).
// - ansan: 담당부서 4곳을 한 쪽씩 번갈아 읽어 url(1)·url(2) 는 부서명(sch_text)만 다르다
//   (쪽 번호는 둘 다 1). 상세 주소는 bbs_seq 로만 조립해 쪽 번호도 검색어도 없다
//   (ansan.test 가 「currentPage·sch_text 미포함」을 단언).

describe("쪽 번호 변수를 스스로 알아낸다 — 같은 공고가 쪽마다 중복 저장되던 것", () => {
  it("GET 쪽넘김 게시판은 전부 쪽 번호 변수를 하나 이상 찾아낸다", () => {
    const missed = BOARD_SOURCES
      .filter((c) => {
        // 목록 주소가 쪽마다 달라지는 곳만 대상(POST 본문으로 넘기는 곳은 제외)
        let differs = false;
        try { differs = c.list.url(1) !== c.list.url(2); } catch { differs = false; }
        return differs && pagingParamsOf(c).length === 0;
      })
      .map((c) => c.id)
      .filter((id) => !PAGING_WITHOUT_URL_PARAM.has(id));
    expect(missed).toEqual([]);
  });

  it("경로 조각·POST 본문으로 쪽을 넘기는 게시판도 쪽 번호를 알아낸다(2026-09-03 대전·세종신보·인천신보)", () => {
    const pathCfg = { id: "x", list: { url: (p: number) => (p === 1 ? "https://a.test/sub/index" : `https://a.test/sub/index/page/${p}`) } } as unknown as BoardConfig;
    expect(pagingParamsOf(pathCfg)).toEqual(["/path"]);
    const postCfg = { id: "y", list: { url: () => "https://a.test/list.do", init: (p: number) => ({ method: "POST", body: `currentPage=${p}&searchData=data` }) } } as unknown as BoardConfig;
    expect(pagingParamsOf(postCfg)).toEqual(["currentPage"]);
  });

  it("깊이 파는 게시판은 반드시 쪽 번호를 지운다 — 안 그러면 중복이 쪽수만큼 늘어난다", () => {
    const risky = BOARD_SOURCES
      .filter((c) => DEEP_PAGING_ALLOWED.has(c.id) && pagingParamsOf(c).length === 0)
      .map((c) => c.id)
      .filter((id) => !PAGING_WITHOUT_URL_PARAM.has(id));
    expect(risky).toEqual([]);
  });

  // ★위 시험들은 pagingParamsOf 만 재므로, 그 결과를 **실제로 쓰는지**는 못 잡는다
  //   (배선을 끊어도 통과하는 것을 확인했다). 아래가 그 배선을 지킨다.
  it("★수집 결과의 sourceId 에서 쪽 번호가 실제로 지워진다 — 배선까지 확인", async () => {
    const cfg: BoardConfig = {
      id: "paging-x", label: "X", agency: "X", region: "부산", baseUrl: "https://www.btp.or.kr/b/",
      list: {
        // url(1) 과 url(2) 가 page 로 갈린다 → page 가 쪽 번호 변수로 인식돼야 한다
        url: (p) => `https://www.btp.or.kr/b/list?page=${p}`,
        maxPages: 1, rowSelector: "tbody tr",
        fields: {
          title: { selector: "td.s a" },
          detailUrl: { selector: "td.s a", attr: "href" },
          date: { selector: "td.d" },
        },
      },
      expectMinRows: 1,
    };
    // 목록이 상세 링크에 자기가 보던 쪽 번호를 달아 준 모양(운영 실측과 같은 꼴)
    const html = `<table><tbody><tr><td class="s"><a href="/b/view?seq=9582070&page=3">2026 지원사업 공고</a></td><td class="d">2026-08-01 ~ 2026-12-31</td></tr></tbody></table>`;
    const out = await fetchBoardAll(cfg, {
      fetchText: async () => html,
      prevOpenCount: 0,
      askModel: async () => "{}",
      onAllFailed: async () => {},
    });
    expect(out).toHaveLength(1);
    expect(out[0].sourceId).not.toContain("page=3");
    expect(out[0].sourceId).toContain("seq=9582070");
  });

  it("keepPagingParamsInDetail 을 켠 게시판만 상세 주소의 쪽 변수를 남긴다 — 서울신보는 pageIndex 없이는 상세가 500(2026-09-03)", async () => {
    const mk = (keep: boolean): BoardConfig => ({
      id: keep ? "keep-x" : "drop-x", label: "X", agency: "X", region: "서울", baseUrl: "https://www.seoulshinbo.test/",
      list: {
        url: (p) => `https://www.seoulshinbo.test/wbase/contents/bbs/list?mng_cd=STRY9788&pageIndex=${p}`,
        maxPages: 1, rowSelector: "tbody tr",
        fields: {
          title: { selector: "td.s a" },
          detailUrl: { selector: "td.s a", attr: "href" },
          date: { selector: "td.d" },
        },
      },
      expectMinRows: 1,
      ...(keep ? { keepPagingParamsInDetail: true as const } : {}),
    });
    const html = `<table><tbody><tr><td class="s"><a href="/wbase/contents/bbs/view/23384?mng_cd=STRY9788&pageIndex=1">안심통장 4호 지원사업 공고</a></td><td class="d">2026-09-02 ~ 2026-12-31</td></tr></tbody></table>`;
    const deps = { fetchText: async () => html, prevOpenCount: 0, askModel: async () => "{}", onAllFailed: async () => {} };
    const kept = await fetchBoardAll(mk(true), deps);
    expect(kept).toHaveLength(1);
    expect(kept[0].sourceId).toContain("pageIndex=1");
    const dropped = await fetchBoardAll(mk(false), deps);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].sourceId).not.toContain("pageIndex");
  });

  it("손으로 적어 둔 곳과 자동 인식이 어긋나지 않는다(광주TP·대전TP)", () => {
    const gjtp = BOARD_SOURCES.find((c) => c.id === "gjtp")!;
    const djtp = BOARD_SOURCES.find((c) => c.id === "tp-daejeon")!;
    expect(pagingParamsOf(gjtp)).toContain("pageIndex");
    expect(pagingParamsOf(djtp)).toContain("nPage");
  });
});

/**
 * 한 쪽이 통째로 「이미 본 것」이면 거기서 멈추던 규칙이, **고정 공지가 쪽마다 되풀이되는
 * 게시판**에서는 뒷쪽을 통째로 포기하게 만든다. 사장님 지시(2026-09-01 「단 1건도 놓치면
 * 안 된다」)로 **연속 두 쪽이 빌 때만** 멈추게 바꾼다 — 한 쪽 헛걸음의 비용은 요청 1회뿐이다.
 */
describe("신규 0인 쪽 하나로 뒷쪽을 포기하지 않는다", () => {
  const rowHtml = (seq: number, title: string) =>
    `<tr><td class="s"><a href="/b/view?seq=${seq}">${title}</a></td><td class="d">2026-08-01 ~ 2026-12-31</td></tr>`;
  const pageHtml = (rows: string) => `<table><tbody>${rows}</tbody></table>`;

  const cfg: BoardConfig = {
    id: "repeat-x", label: "X", agency: "X", region: "부산", baseUrl: "https://www.btp.or.kr/b/",
    list: {
      url: (p) => `https://www.btp.or.kr/b/list?page=${p}`,
      maxPages: 4, rowSelector: "tbody tr",
      fields: {
        title: { selector: "td.s a" },
        detailUrl: { selector: "td.s a", attr: "href" },
        date: { selector: "td.d" },
      },
    },
    expectMinRows: 1,
  };

  /** 1쪽=공지+새글 / 2쪽=공지만(신규 0) / 3쪽=공지+새글 / 4쪽=공지만 */
  const fetchText = async (url: string) => {
    const p = Number(new URL(url).searchParams.get("page") ?? 1);
    const notice = rowHtml(1, "[공지] 고정 안내");
    if (p === 1) return pageHtml(notice + rowHtml(11, "1쪽 공고"));
    if (p === 3) return pageHtml(notice + rowHtml(33, "3쪽 공고"));
    return pageHtml(notice);
  };

  it("2쪽이 전부 이미 본 것이어도 3쪽의 새 공고를 가져온다", async () => {
    const out = await fetchBoardAll(cfg, {
      fetchText, prevOpenCount: 0, askModel: async () => "{}", onAllFailed: async () => {},
    });
    expect(out.map((a) => a.title)).toContain("3쪽 공고");
  });

  // ★적대 리뷰 ② — 제목 거르개를 지나 남는 게 0행인 쪽이 중간에 끼면 거기서 즉시 끊겼다.
  //   수출바우처 8쪽이 전부 「선정결과·수행기관」이라 0행이 되어 9~11쪽 공고 9건을 잃고 있었다.
  it("한 쪽이 0행이어도 그 뒤 쪽의 새 공고를 가져온다", async () => {
    const fetch0 = async (url: string) => {
      const p = Number(new URL(url).searchParams.get("page") ?? 1);
      if (p === 1) return pageHtml(rowHtml(11, "1쪽 공고"));
      if (p === 2) return pageHtml(""); // 거른 뒤 남는 것이 없는 쪽
      if (p === 3) return pageHtml(rowHtml(33, "3쪽 공고"));
      return pageHtml("");
    };
    const out = await fetchBoardAll(cfg, {
      fetchText: fetch0, prevOpenCount: 0, askModel: async () => "{}", onAllFailed: async () => {},
    });
    expect(out.map((a) => a.title)).toContain("3쪽 공고");
  });

  it("연속 두 쪽이 비면 멈춘다 — 무한정 긁지 않는다", async () => {
    const asked: number[] = [];
    const onlyFirst = async (url: string) => {
      const p = Number(new URL(url).searchParams.get("page") ?? 1);
      asked.push(p);
      return pageHtml(p === 1 ? rowHtml(11, "1쪽 공고") : rowHtml(11, "1쪽 공고"));
    };
    await fetchBoardAll({ ...cfg, list: { ...cfg.list, maxPages: 10 } }, {
      fetchText: onlyFirst, prevOpenCount: 0, askModel: async () => "{}", onAllFailed: async () => {},
    });
    // 2쪽·3쪽이 연속으로 신규 0 → 4쪽은 안 부른다
    expect(Math.max(...asked)).toBe(3);
  });
});
