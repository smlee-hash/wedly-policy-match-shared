import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGtpArchiveListSession,
  GTP_ARCHIVE_COLLECTION_REVISION,
  gtpArchiveWindowConfig,
} from "./gtp-archive";
import { gtpConfig, parseGtpList } from "./sources/gtp";
import { kosmesConfig } from "./sources/kosmes";
import type { BoardFetchInit } from "./types";

const LIST = "https://pms.gtp.or.kr/web/business/webBusinessList.do";
const VIEW = "https://pms.gtp.or.kr/web/business/webBusinessView.do";

type ClosedCase = {
  id: string;
  title: string;
  agency: string;
  start: string;
  end: string;
};

const TEN_CLOSED: ClosedCase[] = [
  { id: "172316", title: "2026년 지원사업 공고 316번", agency: "경기 테크노파크", start: "2026-08-07", end: "2026-08-31" },
  { id: "172315", title: "2026년 지원사업 공고 315번", agency: "경기도", start: "2026-08-21", end: "2026-09-11" },
  { id: "172313", title: "2026년 지원사업 공고 313번", agency: "안산시", start: "2026-08-19", end: "2026-08-31" },
  { id: "172310", title: "2026년 지원사업 공고 310번", agency: "경기 테크노파크", start: "2026-08-01", end: "2026-08-10" },
  { id: "172311", title: "2026년 지원사업 공고 311번", agency: "수원시", start: "2026-08-02", end: "2026-08-11" },
  { id: "172312", title: "2026년 지원사업 공고 312번", agency: "고양시", start: "2026-08-03", end: "2026-08-12" },
  { id: "172314", title: "2026년 지원사업 공고 314번", agency: "성남시", start: "2026-08-04", end: "2026-08-13" },
  { id: "172317", title: "2026년 지원사업 공고 317번", agency: "용인시", start: "2026-08-05", end: "2026-08-14" },
  { id: "172318", title: "2026년 지원사업 공고 318번", agency: "화성시", start: "2026-08-06", end: "2026-08-15" },
  { id: "172319", title: "2026년 지원사업 공고 319번", agency: "부천시", start: "2026-08-08", end: "2026-08-16" },
];

function gtpRow(opts: {
  id?: string;
  title: string;
  agency?: string;
  period: string;
  onclick?: string;
}): string {
  const onclick = opts.onclick ?? (opts.id ? `onclick="fn_goView('${opts.id}'); return false;"` : "");
  return `<tr>
    <td>1</td>
    <td class="subject"><a href="#none" ${onclick} title="${opts.title}">${opts.title.slice(0, 12)}</a></td>
    <td>기술</td>
    <td></td>
    <td>${opts.agency ?? "경기 테크노파크"}</td>
    <td class="last">${opts.period}</td>
  </tr>`;
}

function gtpListHtml(rows: string): string {
  return `<table class="t01"><tbody>${rows}</tbody></table>`;
}

function officialDetail(start: string, end: string, extra = ""): string {
  return `<div class="view">${extra}<dl>
    <dt>사업명</dt><dd>지원사업</dd>
    <dt>접수 기간</dt><dd>${start} 00:00&nbsp;~&nbsp;${end} 18:00</dd>
  </dl></div>`;
}

function listUrl(page: number): string {
  return `${LIST}?page=${page}`;
}

function viewUrl(id: string): string {
  return `${VIEW}?b_idx=${id}`;
}

function closedList(rows = TEN_CLOSED, period = "마감"): string {
  return gtpListHtml(rows.map((row) => gtpRow({ ...row, period })).join(""));
}

async function readArchive(
  fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
  page = 5,
): Promise<string> {
  return createGtpArchiveListSession(fetchText)(page);
}

// 시험 시계를 2026-09-13에 고정한다. 12월 기간이 해가 지나 과거가 되면 실패 시험이 뒤집힌다.
const ARCHIVE_TEST_NOW = new Date("2026-09-13T00:00:00+09:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ARCHIVE_TEST_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("경기TP 지난 공고 기간 — 일반 파서는 그대로", () => {
  it("날짜 없는 「마감」 줄은 일반 파서가 담지 않는다", () => {
    expect(parseGtpList(closedList())).toEqual([]);
    expect(gtpConfig.createListSession).toBeUndefined();
    expect(gtpConfig.customParse).toBe(parseGtpList);
  });
  it("주어진 목록 주소와 요청 설정을 유지한다", async () => {
    const calls: { url: string; init?: BoardFetchInit }[] = [];
    const init: BoardFetchInit = { method: "POST", body: "page=8" };
    const cfg = {
      ...gtpConfig,
      list: { ...gtpConfig.list, url: (page: number) => `${LIST}?archive=${page}`, init: () => init },
    };
    const read = gtpArchiveWindowConfig(cfg).createListSession!(async (url, request) => {
      calls.push({ url, init: request });
      return gtpListHtml("");
    });
    await read(8);
    expect(calls).toEqual([{ url: `${LIST}?archive=8`, init }]);
  });
});

describe("경기TP 지난 공고 기간 — 상세 칸", () => {
  it("셀 하나가 사라진 마감 정책 행을 정상 행 옆에서 조용히 버리지 않는다", async () => {
    const malformed = gtpRow({ id: "172316", title: TEN_CLOSED[0].title, period: "마감" }).replace("<td></td>", "");
    const valid = gtpRow({ id: "172315", title: TEN_CLOSED[1].title, period: "2026-08-21 ~ 2026-09-11" });
    await expect(readArchive(async (url) => url.startsWith(LIST)
      ? gtpListHtml(malformed + valid)
      : officialDetail("2026-08-07", "2026-08-31"))).rejects.toThrow(/지난 공고/);
  });
  it("기간 칸에 들어 있어도 범위로 연결되지 않은 두 날짜를 기간으로 만들지 않는다", async () => {
    await expect(readArchive(async (url) => url.startsWith(LIST) ? closedList([TEN_CLOSED[0]])
      : "<dl><dt>접수 기간</dt><dd>기준일 2026-08-07 및 게시일 2026-08-31</dd></dl>"))
      .rejects.toThrow(/지난 공고/);
  });
  it("실측 형식 마감 10줄의 제목·주소·기관·기간을 그대로 살린다", async () => {
    const fetched: string[] = [];
    const html = await readArchive(async (url) => {
      fetched.push(url);
      if (url === listUrl(5)) return closedList();
      const id = new URL(url).searchParams.get("b_idx") ?? "";
      const row = TEN_CLOSED.find((item) => item.id === id);
      if (!row) throw new Error(`unexpected ${url}`);
      return officialDetail(row.start, row.end);
    });
    const rows = parseGtpList(html);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.detailUrl)).toEqual(TEN_CLOSED.map((row) => viewUrl(row.id)));
    expect(rows.map((r) => r.title)).toEqual(TEN_CLOSED.map((row) => row.title));
    expect(rows.map((r) => r.agency)).toEqual(TEN_CLOSED.map((row) => row.agency));
    expect(rows.map((r) => r.dateText)).toEqual(TEN_CLOSED.map((row) => `${row.start} ~ ${row.end}`));
    expect(fetched.filter((url) => url.startsWith(VIEW))).toHaveLength(10);
    expect(fetched.filter((url) => url === listUrl(5))).toHaveLength(1);
  });

  it("이미 날짜가 있는 줄과 공고가 아닌 「마감」 줄은 상세를 부르지 않는다", async () => {
    const fetched: string[] = [];
    const html = gtpListHtml([
      gtpRow({ id: "172300", title: "2026년 지원사업 공고 열린줄", agency: "경기도", period: "2026-09-01 09:00 <br>~ 2026-09-21 17:00" }),
      gtpRow({ id: "172301", title: "2026년 경기테크노파크 시설관리 용역 입찰 공고", period: "마감" }),
      gtpRow({ id: "172316", title: TEN_CLOSED[0].title, agency: TEN_CLOSED[0].agency, period: "마감" }),
    ].join(""));
    const out = await readArchive(async (url) => {
      fetched.push(url);
      if (url === listUrl(5)) return html;
      if (url === viewUrl("172316")) return officialDetail("2026-08-07", "2026-08-31");
      throw new Error(`unexpected ${url}`);
    });
    const rows = parseGtpList(out);
    expect(rows.map((r) => r.detailUrl)).toEqual([viewUrl("172300"), viewUrl("172316")]);
    expect(rows[0].dateText).toBe("2026-09-01 ~ 2026-09-21");
    expect(rows[1].dateText).toBe("2026-08-07 ~ 2026-08-31");
    expect(fetched).toEqual([listUrl(5), viewUrl("172316")]);
  });

  it("같은 상세 번호는 쪽마다 한 번만 받는다", async () => {
    const fetched: string[] = [];
    const html = gtpListHtml([
      gtpRow({ id: "172316", title: "2026년 지원사업 공고 첫째", agency: "경기도", period: "마감" }),
      gtpRow({ id: "172316", title: "2026년 지원사업 공고 둘째", agency: "안산시", period: "마감" }),
    ].join(""));
    await readArchive(async (url) => {
      fetched.push(url);
      if (url === listUrl(5)) return html;
      if (url === viewUrl("172316")) return officialDetail("2026-08-07", "2026-08-31");
      throw new Error(`unexpected ${url}`);
    });
    expect(fetched.filter((url) => url === viewUrl("172316"))).toHaveLength(1);
  });

  it("본문 다른 날짜가 있어도 접수 기간 칸만 쓴다", async () => {
    const html = await readArchive(async (url) => {
      if (url === listUrl(5)) return gtpListHtml(gtpRow({ id: "172316", title: TEN_CLOSED[0].title, period: "마감" }));
      return officialDetail("2026-08-07", "2026-08-31", "<footer>2019-01-01 ~ 2019-01-02</footer><dt>사업 기간</dt><dd>2020-01-01 ~ 2020-12-31</dd>");
    });
    expect(parseGtpList(html)[0].dateText).toBe("2026-08-07 ~ 2026-08-31");
  });

  it("마감 정책 줄에 번호가 없으면 그 쪽을 실패로 돌린다", async () => {
    const fetched: string[] = [];
    await expect(readArchive(async (url) => {
      fetched.push(url);
      return gtpListHtml(gtpRow({ title: "2026년 지원사업 공고 번호없음", period: "마감" }));
    })).rejects.toThrow(/지난 공고/);
    expect(fetched).toEqual([listUrl(5)]);
  });
  it("마감 줄의 제목이 사라지면 조용히 누락하지 않고 실패한다", async () => {
    await expect(readArchive(async (url) =>
      url.startsWith(LIST)
        ? gtpListHtml(gtpRow({ id: "172316", title: "", period: "마감" }))
        : officialDetail("2026-08-07", "2026-08-31"),
    )).rejects.toThrow(/지난 공고/);
  });
});

describe("경기TP 지난 공고 기간 — 실패는 미완료", () => {
  const closedOne = gtpListHtml(gtpRow({ id: "172316", title: TEN_CLOSED[0].title, period: "마감" }));

  async function expectArchiveFail(
    detail: string | ((url: string) => Promise<string>),
  ): Promise<void> {
    await expect(readArchive(async (url) => {
      if (url === listUrl(5)) return closedOne;
      if (typeof detail === "string") return detail;
      return detail(url);
    })).rejects.toThrow(/지난 공고|ECONNRESET|중단/);
  }

  it("상세 오류·없는 기간·여러 기간·잘못된 날짜·아직 안 끝난 기간은 실패한다", async () => {
    expect(Date.now()).toBe(ARCHIVE_TEST_NOW.getTime());
    await expectArchiveFail(async () => { throw new Error("ECONNRESET"); });
    await expectArchiveFail("<div>본문만</div>");
    await expectArchiveFail(`<dl>
      <dt>접수 기간</dt><dd>2026-08-07 00:00&nbsp;~&nbsp;2026-08-31 18:00</dd>
      <dt>접수 기간</dt><dd>2026-08-01 00:00&nbsp;~&nbsp;2026-08-10 18:00</dd>
    </dl>`);
    await expectArchiveFail(officialDetail("2026-02-31", "2026-08-31"));
    await expectArchiveFail(officialDetail("2026-08-31", "2026-08-01"));
    await expectArchiveFail(officialDetail("2026-12-01", "2026-12-31"));
    await expectArchiveFail("<dl><dt>접수 기간</dt><p>2026-08-07 ~ 2026-08-31</p></dl>");
    await expectArchiveFail(officialDetail("2026-08-07", "2026-08-31").replace(
      "2026-08-31 18:00",
      "2026-08-31 18:00 (변경 2026-08-01)",
    ));
  });

  it("빈 목록은 원문 그대로 돌려 기존 끝 판정에 맡긴다", async () => {
    const empty = `<table class="t01"><tbody><tr><td colspan="6">등록된 게시물이 없습니다.</td></tr></tbody></table>`;
    const fetched: string[] = [];
    const out = await readArchive(async (url) => {
      fetched.push(url);
      return empty;
    });
    expect(out).toBe(empty);
    expect(fetched).toEqual([listUrl(5)]);
    expect(parseGtpList(out)).toEqual([]);
  });
});

describe("경기TP 지난 공고 설정 범위", () => {
  it("다른 출처 설정은 같은 객체로 두고 GTP 만 세션을 붙인다", () => {
    expect(gtpArchiveWindowConfig(kosmesConfig)).toBe(kosmesConfig);
    expect(gtpArchiveWindowConfig(kosmesConfig).createListSession).toBe(kosmesConfig.createListSession);
    const archived = gtpArchiveWindowConfig(gtpConfig);
    expect(archived).not.toBe(gtpConfig);
    expect(archived.createListSession).toBeTypeOf("function");
    expect(gtpConfig.createListSession).toBeUndefined();
    expect(GTP_ARCHIVE_COLLECTION_REVISION).toBe("gtp-archive-detail-dates-v1");
  });
});
