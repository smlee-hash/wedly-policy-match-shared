// NO.789 정책별 고객사 — 공고를 펼친 업체 표를 「맞을 확률」 순 한 표로 보이고, 공고 목록을 단계로 거른다.
// 맞음·확인 필요 두 표 대신 표 하나(높음 → 보통 → 낮음), 판단 전·해당 없음 업체는 표 끝 접힌 묶음.
// 줄마다 단계 딱지·근거 한 줄·다음 할 일·확인할 것(펼치면 업체 정보에서 채울 것 / 공고 원문에서 확인할 것), 「해당 없음」으로 사유를 남기면 아래로 내려간다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import type { CheckItem } from "../../serve/policy-deadline/tier";
import type { AnnouncementListRow, BucketCompaniesView, CompanyMatchRow } from "../../serve/policy-deadline/types";
import AnnouncementBoard, { announcementListKey, type AnnouncementBoardProps } from "./AnnouncementBoard";
import { DeadlineToast } from "./DeadlineBits";
import { CompanyTable } from "./DeadlineTables";
import { DEADLINE_DISMISS_ENDPOINT, DEADLINE_ENDPOINTS, type DeadlineEndpoints } from "./endpoints";

/** 「해당 없음」 통로를 켠 앱의 통로 — 기본 상수에는 dismiss 가 없다. */
const WITH_DISMISS: DeadlineEndpoints = { ...DEADLINE_ENDPOINTS, dismiss: DEADLINE_DISMISS_ENDPOINT };
import { buttonsWith, byTag, cellOf, find, headsOf, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast];
const fetchMock = vi.fn();
const never = () => new Promise<Response>(() => {});
let mounted: ReturnType<typeof mountTree> | null = null;

const meta = {
  bucketKey: "b1", repAnnouncementId: "a1", title: "공고 하나", agency: "기관", category: "정책자금",
  url: "https://example.invalid/a1", applyEnd: "2026-11-20", dDay: 6,
};
const listRow = (over: Partial<AnnouncementListRow> = {}): AnnouncementListRow => ({
  ...meta, fit: 2, unverified: 3, tiers: { high: 2, mid: 1, low: 1 }, unstructured: 1, bestTier: "high", summary: "", ...over,
});
const listOf = (dated: AnnouncementListRow[], always: AnnouncementListRow[] = []) => ({
  lastRun: null, companyCount: 5, bucketCount: dated.length + always.length, categories: ["정책자금"], dated, always,
});

const item = (over: Partial<CheckItem> & Pick<CheckItem, "what" | "group">): CheckItem => ({ label: over.what, rank: 50, where: "", ...over });
const TAX = item({ what: "체납", group: "company", rank: 7, field: "taxArrears", where: "기업상태표 「체납」", current: "모름" });
const EXPORT = item({ what: "수출 실적", group: "notice", rank: 20, where: "공고 원문", evidence: "수출 실적이 있는 중소기업" });

const line = (customerKey: string, companyName: string, over: Partial<CompanyMatchRow> = {}): CompanyMatchRow => ({
  customerKey, companyName, consultant: "김컨설", consultantNames: ["김컨설"], statusText: "계약", verdict: "fit",
  fitLabels: [], toCheck: [], gaps: [], progress: null, amountMaxWon: null, dismissed: null,
  tier: "high", tierScore: 100, tierReason: "조건 6개 모두 맞음", checkItems: [], checkCount: 0, nextAction: "고객에게 연락해 신청 안내", unstructured: false,
  ...over,
});
const gana = line("cA", "가나상사", { amountMaxWon: 300_000_000 });
const dara = line("cB", "다라상사", {
  verdict: "unverified", tier: "mid", tierScore: 77, tierReason: "조건 6개 중 4개 맞음 · 체납 확인", checkItems: [TAX, EXPORT], checkCount: 2,
  nextAction: "체납 확인 후 연락", toCheck: ["수출 실적"], gaps: ["체납"], amountMaxWon: 300_000_000,
});
const maba = line("cC", "마바상사", {
  verdict: "unverified", tier: "low", tierScore: 40, tierReason: "조건 6개 중 2개 맞음", checkItems: [EXPORT], checkCount: 1, nextAction: "공고 원문에서 자격 먼저 확인",
});
const saa = line("cD", "사아상사", {
  verdict: "unverified", tier: "low", tierScore: 0, tierReason: "공고 조건을 아직 정리하지 않음", nextAction: "공고 조건 정리 대기", unstructured: true,
  toCheck: ["공고 원문 확인(조건 정리 전)"],
});
const jacha = line("cE", "자차상사", { dismissed: { reason: "이미 신청함", byName: "김컨설", at: "2026-11-21T01:00:00.000Z" } });

/** 서버가 주는 묶음 — rows 는 맞을 확률 순(높음 → 보통 → 낮음 → 판단 전 → 해당 없음)으로 받은 그대로. */
const bucketOf = (rows: CompanyMatchRow[]): BucketCompaniesView => {
  const live = rows.filter((r) => !r.dismissed);
  const counted = live.filter((r) => !r.unstructured);
  return {
    bucket: meta,
    fit: rows.filter((r) => r.verdict === "fit"),
    unverified: rows.filter((r) => r.verdict === "unverified"),
    rows,
    tierCounts: {
      high: counted.filter((r) => r.tier === "high").length,
      mid: counted.filter((r) => r.tier === "mid").length,
      low: counted.filter((r) => r.tier === "low").length,
      unstructured: live.length - counted.length,
      dismissed: rows.length - live.length,
    },
  };
};
const MAIN = bucketOf([gana, dara, maba, saa, jacha]);
const DISMISSED_AT = "2026-11-22T03:00:00.000Z";

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const tables = () => byTag(root(), "table");
const namesOf = (t: HostNode) => byTag(byTag(t, "tbody")[0], "tr").map((tr) => textOf(byTag(tr, "td")[0] ?? []));
const rowOf = (company: string) => byTag(root(), "tbody").flatMap((body) => byTag(body, "tr")).find((tr) => textOf(tr).includes(company));
const callsTo = (part: string) => fetchMock.mock.calls.filter(([input]) => String(input).includes(part));
const lastUrl = (part: string) => String(callsTo(part).at(-1)?.[0] ?? "");
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
const toast = () => find(root(), (n) => n.tag === "DeadlineToast");
const notice = () => toast()?.props.notice as { tone: string; text: string } | null | undefined;
const tierGroup = () => find(root(), (n) => n.props.role === "group" && n.props["aria-label"] === "맞을 확률");
const flat = (node: HostNode | string | ReadonlyArray<HostNode | string>) => textOf(node).replace(/\s+/g, " ").trim();
const tierButton = (label: string) => {
  const group = tierGroup();
  return group ? byTag(group, "button").find((b) => flat(b).includes(label)) : undefined;
};
const foldButton = (start: string) => byTag(root(), "button").find((b) => flat(b).startsWith(start));
const checkbox = (label: string) => find(root(), (n) => n.tag === "Checkbox" && n.props.label === label);
const toggle = (label: string, checked: boolean) => () =>
  (checkbox(label)?.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked } });

function serve(view: BucketCompaniesView, list: unknown = listOf([listRow()]), dismissStatus = 200) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/deadline/dismiss") && init?.method === "POST") {
      if (dismissStatus !== 200) {
        return Promise.resolve(jsonResponse({ success: false, error: { code: "FORBIDDEN", message: "이 업체의 담당자만 남길 수 있습니다." } }, dismissStatus));
      }
      const { reason } = JSON.parse(String(init.body)) as { reason: string | null };
      return Promise.resolve(jsonResponse({ success: true, data: { dismissed: reason ? { reason, byName: "김컨설", at: DISMISSED_AT } : null } }));
    }
    if (url.includes("view=list")) return Promise.resolve(jsonResponse({ success: true, data: list }));
    if (url.includes("view=bucket")) return Promise.resolve(jsonResponse({ success: true, data: view }));
    if (url.includes("view=export")) return Promise.resolve(jsonResponse({ success: true, data: { rows: [], total: 0, truncated: false } }));
    return never();
  });
}

async function draw(
  view: BucketCompaniesView = MAIN,
  props: Partial<AnnouncementBoardProps> = {},
  list: unknown = listOf([listRow()]),
  dismissStatus = 200,
) {
  serve(view, list, dismissStatus);
  const onDetail = vi.fn();
  const onProgressed = vi.fn();
  mounted = mountTree(
    <AnnouncementBoard scope="all" defaultDays={14} onDetail={onDetail} onProgressed={onProgressed} endpoints={WITH_DISMISS} {...props} />,
    { opaque: OPAQUE },
  );
  await mounted.settle();
  return { onDetail, onProgressed };
}

async function openAnnouncement(view: BucketCompaniesView = MAIN, props: Partial<AnnouncementBoardProps> = {}, dismissStatus = 200) {
  const handlers = await draw(view, props, listOf([listRow()]), dismissStatus);
  await mounted?.click(buttonsWith(root(), /공고 하나/)[0]);
  return handlers;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubBrowser();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("펼친 업체 표 — 맞을 확률 순 한 표(NO.789)", () => {
  it("표 하나에 높음 → 보통 순, 낮음은 숨겼다고 알리고, 판단 전·해당 없음은 접힌 묶음이다", async () => {
    await openAnnouncement();
    expect(tables()).toHaveLength(1);
    expect(headsOf(tables()[0])).toEqual(["업체명", "담당", "맞을 확률", "다음 할 일", "확인할 것", "업무 현황"]);
    expect(namesOf(tables()[0])).toEqual(["가나상사", "다라상사"]);
    expect(flat(root())).toContain("고르지 않은 단계의 업체 1곳은 숨겼습니다");
    expect(foldButton("판단 전 업체 1곳 · 공고 조건을 정리하면 맞을 확률이 나옵니다")?.props["aria-expanded"]).toBe(false);
    expect(foldButton("해당 없음 업체 1곳")?.props["aria-expanded"]).toBe(false);
    for (const name of ["마바상사", "사아상사", "자차상사"]) expect(flat(root())).not.toContain(name);
  });

  it("맞음·확인 필요 제목과 「조건 정리 전 공고입니다」 안내 없이 — 원문 링크는 한 번, 금액을 알면 위에 한 줄", async () => {
    await openAnnouncement();
    const text = flat(root());
    expect(text).not.toMatch(/맞음 \d+곳|확인 필요 \d+곳/);
    expect(text).not.toContain("조건 정리 전 공고입니다");
    expect(byTag(root(), "a").filter((a) => a.props.href === meta.url)).toHaveLength(1);
    expect(text).toContain("지원 금액 최대 3억원");
  });

  it("금액을 모르는 공고는 금액 줄을 그리지 않는다", async () => {
    await openAnnouncement(bucketOf([line("cA", "가나상사"), line("cB", "다라상사", { tier: "mid" })]));
    expect(flat(root())).not.toContain("지원 금액");
  });

  it("줄마다 단계 딱지 · 근거 한 줄 · 다음 할 일 · 확인할 것 수와 첫 항목", async () => {
    await openAnnouncement();
    const t = tables()[0];
    const cell = (name: string, head: string) => flat(cellOf(t, name, head) ?? []);
    expect(cell("가나상사", "맞을 확률")).toContain("높음");
    expect(cell("가나상사", "맞을 확률")).toContain("조건 6개 모두 맞음");
    expect(cell("다라상사", "맞을 확률")).toContain("보통");
    expect(cell("다라상사", "맞을 확률")).toContain("조건 6개 중 4개 맞음 · 체납 확인");
    expect(cell("가나상사", "다음 할 일")).toBe("고객에게 연락해 신청 안내");
    expect(cell("다라상사", "다음 할 일")).toBe("체납 확인 후 연락");
    expect(cell("가나상사", "확인할 것")).toBe("확인할 것 없음");
    expect(cell("다라상사", "확인할 것")).toBe("확인할 것 2개 · 체납");
  });

  it("확인할 것을 펼치면 두 묶음 — 업체 칸 이름을 누르면 상세창의 그 칸을 연다", async () => {
    const { onDetail } = await openAnnouncement();
    const summary = buttonsWith(cellOf(tables()[0], "다라상사", "확인할 것")!, "확인할 것 2개 · 체납")[0];
    expect(summary?.props["aria-expanded"]).toBe(false);
    await mounted?.click(summary);
    const cell = cellOf(tables()[0], "다라상사", "확인할 것")!;
    expect(flat(cell)).toContain("업체 정보에서 채울 것");
    expect(flat(cell)).toContain("공고 원문에서 확인할 것");
    expect(flat(cell)).toContain("수출 실적이 있는 중소기업");
    expect(flat(cell)).toContain("지금 값: 모름");
    await mounted?.click(buttonsWith(cell, "체납")[0]);
    expect(onDetail.mock.calls.at(-1)).toEqual(["cB", "다라상사", undefined, "taxArrears"]);
  });

  it("상호명을 누르면 칸 없이 그 업체 상세를 연다(받는 값 둘)", async () => {
    const { onDetail } = await openAnnouncement();
    await mounted?.click(buttonsWith(root(), "다라상사")[0]);
    expect(onDetail.mock.calls.at(-1)).toEqual(["cB", "다라상사"]);
  });

  it("「맞을 확률」 거르기를 바꾸면 펼친 표도 바뀐다 — 다시 읽지 않는다", async () => {
    await openAnnouncement();
    const reads = callsTo("view=").length;
    await mounted?.click(tierButton("낮음"));
    expect(namesOf(tables()[0])).toEqual(["가나상사", "다라상사", "마바상사"]);
    expect(flat(root())).not.toContain("숨겼습니다");
    await mounted?.click(tierButton("높음"));
    expect(namesOf(tables()[0])).toEqual(["다라상사", "마바상사"]);
    expect(flat(root())).toContain("고르지 않은 단계의 업체 1곳은 숨겼습니다");
    expect(callsTo("view=").length).toBe(reads);
  });

  it("「맞음만」을 켜면 맞음 업체만 — 해당 없음 묶음은 맞음 업체만 센다", async () => {
    await openAnnouncement();
    await mounted?.act(toggle("맞음만", true));
    expect(namesOf(tables()[0])).toEqual(["가나상사"]);
    expect(foldButton("판단 전 업체")).toBeUndefined();
    expect(foldButton("해당 없음 업체 1곳")?.tag).toBe("button");
    expect(flat(root())).not.toContain("숨겼습니다");
  });

  it("판단 전 묶음을 누르면 같은 표 모양으로 펼친다 — 딱지는 「판단 전」", async () => {
    await openAnnouncement();
    await mounted?.click(foldButton("판단 전 업체 1곳"));
    expect(foldButton("판단 전 업체 1곳")?.props["aria-expanded"]).toBe(true);
    expect(tables()).toHaveLength(2);
    expect(headsOf(tables()[1])).toEqual(headsOf(tables()[0]));
    expect(flat(cellOf(tables()[1], "사아상사", "맞을 확률") ?? [])).toContain("판단 전");
  });

  it("판단 전 업체만 있는 공고는 묶음을 처음부터 펼친다 — 「맞는 업체가 없습니다」는 쓰지 않는다", async () => {
    const onlyFlat = listRow({ fit: 0, unverified: 1, tiers: { high: 0, mid: 0, low: 0 }, unstructured: 1, bestTier: null });
    await draw(bucketOf([saa]), {}, listOf([onlyFlat]));
    await mounted?.click(foldButton("판단 전 공고 1건"));
    await mounted?.click(buttonsWith(root(), /공고 하나/)[0]);
    expect(foldButton("판단 전 업체 1곳")?.props["aria-expanded"]).toBe(true);
    expect(flat(root())).toContain("사아상사");
    expect(flat(root())).not.toContain("맞는 업체가 없습니다");
  });

  it("거르기로 다 숨으면 숨긴 수만 알리고, 줄이 하나도 없을 때만 「지금 거르기 조건에서 맞는 업체가 없습니다」", async () => {
    await openAnnouncement(bucketOf([gana]));
    await mounted?.click(tierButton("낮음"));
    await mounted?.click(tierButton("높음"));
    await mounted?.click(tierButton("보통"));
    // 낮음만 고름 — 높음 업체 하나가 숨는다.
    expect(tables()).toHaveLength(0);
    expect(flat(root())).toContain("고르지 않은 단계의 업체 1곳은 숨겼습니다");
    expect(flat(root())).not.toContain("맞는 업체가 없습니다");

    mounted?.unmount();
    await openAnnouncement(bucketOf([dara]));
    await mounted?.act(toggle("맞음만", true));
    expect(flat(root())).toContain("지금 거르기 조건에서 맞는 업체가 없습니다.");

    mounted?.unmount();
    await openAnnouncement(bucketOf([]));
    expect(flat(root())).toContain("지금 거르기 조건에서 맞는 업체가 없습니다.");
    expect(byTag(root(), "a").filter((a) => a.props.href === meta.url)).toHaveLength(1);
  });

  it("넓은 화면(표 폭 1,060px)에서 「확인할 것」 칸이 200px 넘게 남고 칸마다 폭이 정해져 있다", async () => {
    await openAnnouncement();
    const t = tables()[0];
    const cols = byTag(byTag(t, "colgroup")[0], "col").map((c) => String(c.props.className ?? ""));
    expect(String(t.props.className)).toContain("table-fixed");
    expect(cols).toHaveLength(headsOf(t).length);
    expect(cols.at(-2)).toBe("");
    const percent = cols.reduce((sum, c) => sum + Number(/w-\[(\d+)%\]/.exec(c)?.[1] ?? 0), 0);
    const fixedPx = cols.reduce((sum, c) => sum + Number(/w-\[(\d+)px\]/.exec(c)?.[1] ?? 0), 0);
    expect(1060 - (1060 * percent) / 100 - fixedPx).toBeGreaterThanOrEqual(200);
  });
});

describe("해당 없음 — 사유를 남기면 아래로 내려간다(NO.789)", () => {
  it("사유를 고르면 남기고 그 업체를 해당 없음 묶음으로 옮긴다 · 되돌리면 표로 돌아온다", async () => {
    const { onProgressed } = await openAnnouncement();
    const start = buttonsWith(rowOf("다라상사")!, "해당 없음")[0];
    expect(start?.props["aria-expanded"]).toBe(false);
    await mounted?.click(start);
    await mounted?.click(buttonsWith(rowOf("다라상사")!, "자격이 안 됨")[0]);
    const posts = () => callsTo("/deadline/dismiss");
    expect(posts()).toHaveLength(1);
    expect((posts()[0][1] as RequestInit).method).toBe("POST");
    expect(bodyOf(posts()[0])).toEqual({ customerKey: "cB", bucketKey: "b1", reason: "자격이 안 됨" });
    expect(namesOf(tables()[0])).toEqual(["가나상사"]);
    expect(notice()).toMatchObject({ tone: "success", text: "다라상사 · 「자격이 안 됨」 — 해당 없음으로 옮겼습니다" });
    // 오늘 연락할 곳 수가 바뀌므로 위 카드를 다시 읽게 알린다.
    expect(onProgressed).toHaveBeenCalledTimes(1);

    await mounted?.click(foldButton("해당 없음 업체 2곳"));
    const folded = tables()[1];
    // 해당 없음 묶음 안도 맞을 확률 순 — 높음(자차) → 보통(다라).
    expect(namesOf(folded)).toEqual(["자차상사", "다라상사"]);
    expect(flat(rowOf("다라상사")!)).toContain("해당 없음 · 자격이 안 됨 · 김컨설 · 11/22(일)");
    expect(flat(rowOf("자차상사")!)).toContain("해당 없음 · 이미 신청함 · 김컨설 · 11/21(토)");
    expect(buttonsWith(rowOf("다라상사")!, "해당 없음")).toHaveLength(0);
    expect(buttonsWith(rowOf("다라상사")!, "업무 현황에 추가")).toHaveLength(0);

    await mounted?.click(buttonsWith(rowOf("다라상사")!, "되돌리기")[0]);
    expect(bodyOf(posts()[1])).toEqual({ customerKey: "cB", bucketKey: "b1", reason: null });
    expect(namesOf(tables()[0])).toEqual(["가나상사", "다라상사"]);
    expect(notice()?.text).toBe("다라상사 · 해당 없음을 되돌렸습니다");
    expect(foldButton("해당 없음 업체 1곳")?.tag).toBe("button");
    expect(onProgressed).toHaveBeenCalledTimes(2);
  });

  it("남기지 못하면 서버 글을 알리고 줄은 그대로", async () => {
    await openAnnouncement(MAIN, {}, 403);
    await mounted?.click(buttonsWith(rowOf("다라상사")!, "해당 없음")[0]);
    await mounted?.click(buttonsWith(rowOf("다라상사")!, "기타")[0]);
    expect(notice()).toMatchObject({ tone: "error", text: "이 업체의 담당자만 남길 수 있습니다." });
    expect(namesOf(tables()[0])).toEqual(["가나상사", "다라상사"]);
  });

  it("업무 현황을 만들 수 없거나 통로가 없으면 「해당 없음」 단추를 그리지 않는다 — 남긴 기록은 보인다", async () => {
    await openAnnouncement(MAIN, { canProgress: false });
    expect(buttonsWith(root(), "해당 없음")).toHaveLength(0);
    await mounted?.click(foldButton("해당 없음 업체 1곳"));
    expect(flat(rowOf("자차상사")!)).toContain("해당 없음 · 이미 신청함");
    expect(buttonsWith(root(), "되돌리기")).toHaveLength(0);

    mounted?.unmount();
    // 기본 통로 상수에는 「해당 없음」이 없다 — 통로를 만든 앱만 켠다.
    expect(DEADLINE_ENDPOINTS.dismiss).toBeUndefined();
    await openAnnouncement(MAIN, { endpoints: DEADLINE_ENDPOINTS });
    expect(buttonsWith(root(), "해당 없음")).toHaveLength(0);
    expect(buttonsWith(root(), "업무 현황에 추가").length).toBeGreaterThan(0);
  });
});

describe("공고 목록 — 맞을 확률 순 · 단계 거르기(NO.789)", () => {
  const high = listRow({ bucketKey: "b1", title: "높은 공고", fit: 1, unverified: 2, tiers: { high: 1, mid: 1, low: 1 }, unstructured: 0, bestTier: "high" });
  const mid = listRow({ bucketKey: "b2", title: "보통 공고", fit: 0, unverified: 1, tiers: { high: 0, mid: 1, low: 0 }, unstructured: 0, bestTier: "mid" });
  const low = listRow({ bucketKey: "b3", title: "낮은 공고", fit: 0, unverified: 1, tiers: { high: 0, mid: 0, low: 1 }, unstructured: 0, bestTier: "low" });
  const flatRow = listRow({ bucketKey: "b4", title: "판단 전 공고 하나", fit: 0, unverified: 2, tiers: { high: 0, mid: 0, low: 0 }, unstructured: 2, bestTier: null });
  const FOUR = listOf([high, mid, low, flatRow]);
  const titles = () => byTag(root(), "button").map(flat).filter((t) => /높은 공고|보통 공고|낮은 공고|판단 전 공고 하나/.test(t));

  it("거르기 줄에 「맞을 확률」 단추 셋(공고·업체 짝 수) — 처음엔 높음·보통", async () => {
    await draw(MAIN, {}, FOUR);
    // 단추 묶음 앞에 보이는 이름 「맞을 확률」(빈 카드 안내가 이 이름을 가리킨다).
    expect(find(root(), (n) => n.tag === "span" && n.kids.length === 1 && n.kids[0] === "맞을 확률")?.tag).toBe("span");
    const group = tierGroup();
    expect(group?.props.role).toBe("group");
    expect(byTag(group!, "button").map(flat)).toEqual(["● 높음 1건", "◐ 보통 2건", "○ 낮음 2건"]);
    expect(byTag(group!, "button").map((b) => b.props["aria-pressed"])).toEqual([true, true, false]);
  });

  it("고르지 않은 단계만 있는 공고는 숨기고 알린다 · 판단 전 공고는 목록 끝 접힌 묶음", async () => {
    await draw(MAIN, {}, FOUR);
    expect(titles()).toHaveLength(2);
    expect(titles()[0]).toContain("높은 공고");
    expect(titles()[1]).toContain("보통 공고");
    expect(flat(root())).toContain("고르지 않은 단계의 공고 1건은 숨겼습니다");
    const fold = foldButton("판단 전 공고 1건 · 공고 조건을 정리하면 맞을 확률이 나옵니다");
    expect(fold?.props["aria-expanded"]).toBe(false);
    expect(flat(root())).not.toContain("판단 전 공고 하나");
    await mounted?.click(tierButton("낮음"));
    expect(flat(root())).toContain("낮은 공고");
    expect(flat(root())).not.toContain("숨겼습니다");
    await mounted?.click(fold);
    expect(flat(root())).toContain("판단 전 공고 하나");
  });

  it("공고 줄의 「대상 기업」 아래에 고른 단계의 곳 수 한 줄 — 「맞음만」이면 그리지 않는다", async () => {
    await draw(MAIN, {}, FOUR);
    const rowText = () => flat(buttonsWith(root(), /높은 공고/)[0] ?? []);
    expect(rowText()).toContain("대상 기업 3곳");
    expect(rowText()).toContain("높음 1곳 · 보통 1곳");
    await mounted?.click(tierButton("낮음"));
    expect(rowText()).toContain("높음 1곳 · 보통 1곳 · 낮음 1곳");
    await mounted?.act(toggle("맞음만", true));
    expect(rowText()).toContain("대상 기업 1곳");
    expect(rowText()).not.toContain("높음 1곳");
  });

  it("고른 단계에 맞는 공고가 없으면 빈 카드에 숨긴 수와 고칠 곳을 알린다", async () => {
    await draw(MAIN, {}, listOf([low]));
    expect(flat(root())).toContain("조건에 맞는 공고가 없습니다");
    expect(flat(root())).toContain("고르지 않은 단계의 공고 1건은 숨겼습니다 — 「맞을 확률」에서 단계를 더 골라 보세요.");
  });

  it("슬랙 「공고 보기」로 들어오면 단계를 모두 고르고, 판단 전 공고면 그 묶음을 펼친다", async () => {
    await draw(bucketOf([saa]), { initialBucket: "b4" }, FOUR);
    expect(byTag(tierGroup()!, "button").map((b) => b.props["aria-pressed"])).toEqual([true, true, true]);
    expect(foldButton("판단 전 공고 1건")?.props["aria-expanded"]).toBe(true);
    expect(flat(root())).toContain("사아상사");
  });

  it("순서 — 처음엔 맞을 확률 순으로 읽고, 「마감 순」을 누르면 마감 순으로 다시 읽는다 · 엑셀도 같은 순서", async () => {
    const saveSheet = vi.fn(async () => {});
    await draw(MAIN, { endpoints: { ...DEADLINE_ENDPOINTS, export: "/api/policy-track/deadline" }, features: { saveSheet } }, FOUR);
    expect(lastUrl("view=list")).toContain("sort=tier");
    const sortGroup = buttonsWith(root(), "맞을 확률 순")[0];
    expect(sortGroup?.props["aria-pressed"]).toBe(true);
    await mounted?.click(buttonsWith(root(), /엑셀 내려받기/)[0]);
    expect(lastUrl("view=export")).toContain("sort=tier");
    await mounted?.click(buttonsWith(root(), "마감 순")[0]);
    expect(lastUrl("view=list")).toContain("sort=deadline");
    await mounted?.click(buttonsWith(root(), /엑셀 내려받기/)[0]);
    expect(lastUrl("view=export")).toContain("sort=deadline");
    expect(saveSheet).toHaveBeenCalledTimes(2);
  });

  it("목록 열쇠에 순서가 들어간다 — 순서를 바꾼 첫 화면부터 「불러오는 중」", () => {
    expect(announcementListKey("all", 7, true, 0)).toBe("all|7|true|0|tier");
    expect(announcementListKey(undefined, "all", false, 2, "deadline")).toBe("-|all|false|2|deadline");
  });
});

describe("업체 표 부품 — 칸·해당 없음 단추(NO.789)", () => {
  it("해당 없음을 받지 않으면 단추를 그리지 않고, 해당 없음 줄은 업무 현황 단추 대신 기록만", async () => {
    mounted = mountTree(<CompanyTable rows={[gana, jacha]} busyKey="" bucketKey="b1" onProgress={() => {}} />);
    await mounted.settle();
    expect(buttonsWith(root(), "해당 없음")).toHaveLength(0);
    expect(buttonsWith(rowOf("가나상사")!, "업무 현황에 추가")).toHaveLength(1);
    expect(buttonsWith(rowOf("자차상사")!, "업무 현황에 추가")).toHaveLength(0);
    expect(flat(rowOf("자차상사")!)).toContain("해당 없음 · 이미 신청함 · 김컨설 · 11/21(토)");
  });

  it("담당 칸을 끄면 머리에서도 빠진다", async () => {
    mounted = mountTree(<CompanyTable rows={[gana]} busyKey="" bucketKey="b1" showConsultant={false} onProgress={() => {}} />);
    await mounted.settle();
    expect(headsOf(tables()[0])).toEqual(["업체명", "맞을 확률", "다음 할 일", "확인할 것", "업무 현황"]);
  });
});
