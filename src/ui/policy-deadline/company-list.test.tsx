// 정책별 고객사·연락 예정 업체의 펼친 업체 표 — ERP `company-list.test.tsx`(jsdom)를 test-kit(훅 실행기)으로 옮긴 것이다.
// 공고를 누르면 업체가 한 표에 맞을 확률 순으로 한 번에 보이고(NO.789 — 칸·단계 거르기·해당 없음은 bucket-tier.test.tsx),
// 「상세」 대신 상호명을 누르면 상세창을 열고, 「진행」은 무엇을 하는지 드러나는 이름으로 바꾼다.
// 판정은 ERP 와 같고, 확인 방식만 다르다: DOM 대신 풀어 낸 요소 트리(글자·속성)를 읽고 onClick 을 직접 부른다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import AnnouncementBoard from "./AnnouncementBoard";
import ContactsBoard from "./ContactsBoard";
import { DeadlineToast } from "./DeadlineBits";
import { DEADLINE_ENDPOINTS, type DeadlineEndpoints } from "./endpoints";
import {
  buttonsWith,
  byTag,
  cellOf,
  find,
  findAll,
  headsOf,
  jsonResponse,
  mountTree,
  stubBrowser,
  textOf,
  type HostNode,
} from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast];
const fetchMock = vi.fn();
const never = () => new Promise<Response>(() => {});
let mounted: ReturnType<typeof mountTree> | null = null;

const GENERIC = "공고 원문 확인(조건 정리 전)";
const meta = {
  bucketKey: "b1", repAnnouncementId: "a1", title: "공고 하나", agency: "기관", category: "정책자금",
  url: "https://example.invalid/a1", applyEnd: "2026-11-20", dDay: 6,
};
const list = { lastRun: null, companyCount: 3, bucketCount: 1, categories: ["정책자금"], dated: [{ ...meta, fit: 1, unverified: 2, tiers: { high: 1, mid: 2, low: 0 }, unstructured: 0, bestTier: "high", summary: "" }], always: [] };
const row = (customerKey: string, companyName: string, extra: Partial<{ fitLabels: string[]; toCheck: string[]; gaps: string[]; verdict: string; tier: string }>) => ({
  customerKey, companyName, consultant: "김컨설", consultantNames: ["김컨설"], statusText: "계약", verdict: "unverified", fitLabels: [], toCheck: [], gaps: [], progress: null,
  tier: "mid", tierScore: 77, tierReason: "조건 6개 중 4개 맞음", checkItems: [], checkCount: 0, nextAction: "확인 후 연락", unstructured: false, amountMaxWon: null, dismissed: null, ...extra,
});
const rowA = row("cA", "가나상사", { fitLabels: ["업력 3년 이상"], verdict: "fit", tier: "high" });
const rowB = row("cB", "다라상사", { toCheck: [GENERIC, "수출 실적"], gaps: ["매출"] });
const rowC = row("cC", "마바상사", { toCheck: [GENERIC] });
const mixedBucket = {
  bucket: meta,
  fit: [rowA],
  unverified: [rowB, rowC],
  rows: [rowA, rowB, rowC],
  tierCounts: { high: 1, mid: 2, low: 0, unstructured: 0, dismissed: 0 },
};
const progressResult = (created: boolean) => ({
  created, trackCreated: created, trackId: "t1", policyName: "공고 하나", companyName: "다라상사", todo: "신청 마감", due: "2026-11-20",
  progress: { byName: "김컨설", via: "web", at: "2026-11-14T00:00:00.000Z" },
});

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const tables = () => byTag(root(), "table");
const progressCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/deadline/progress"));
const rowOf = (company: string) => byTag(root(), "tbody").flatMap((body) => byTag(body, "tr")).find((tr) => textOf(tr).includes(company));
const addButton = (company: string) => buttonsWith(rowOf(company) ?? root(), "업무 현황에 추가")[0];
const toast = () => find(root(), (n) => n.tag === "DeadlineToast");
const notice = () => toast()?.props.notice as { tone: string; text: string; trackId?: string } | null | undefined;

function serve(bucket: unknown, progress: unknown = progressResult(true)) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/deadline/progress") && init?.method === "POST") return Promise.resolve(jsonResponse({ success: true, data: progress }));
    if (url.includes("view=list")) return Promise.resolve(jsonResponse({ success: true, data: list }));
    if (url.includes("view=bucket")) return Promise.resolve(jsonResponse({ success: true, data: bucket }));
    return never();
  });
}

async function openAnnouncement(bucket: unknown, onDetail = vi.fn(), progress?: unknown, endpoints: DeadlineEndpoints = DEADLINE_ENDPOINTS) {
  serve(bucket, progress);
  mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} onDetail={onDetail} endpoints={endpoints} />, { opaque: OPAQUE });
  await mounted.settle();
  await mounted.click(buttonsWith(root(), /공고 하나/)[0]);
  return onDetail;
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

describe("DeadlineToast — 「업무 현황 보기」", () => {
  it("알림에 업무 번호가 있으면 onOpen 에 함께 넘긴다", async () => {
    const onOpen = vi.fn();
    mounted = mountTree(
      <DeadlineToast notice={{ tone: "success", text: "추가했습니다", customerKey: "cB", companyName: "다라상사", trackId: "t1" }} onOpen={onOpen} />,
    );
    await mounted.settle();
    await mounted.click(buttonsWith(root(), "업무 현황 보기")[0]);
    expect(onOpen).toHaveBeenCalledWith("cB", "다라상사", "t1");
  });
});

describe("정책별 고객사 — 펼친 업체 표", () => {
  it("공고를 누르면 맞음·확인 필요 업체가 한 번에 보인다(「확인 필요 N곳 보기」를 또 누르지 않는다)", async () => {
    await openAnnouncement(mixedBucket);
    const text = textOf(root());
    expect(["가나상사", "다라상사", "마바상사"].every((name) => text.includes(name))).toBe(true);
    expect(buttonsWith(root(), /확인 필요 \d+곳 보기/)).toHaveLength(0);
    expect(buttonsWith(root(), "확인 필요 접기")).toHaveLength(0);
  });

  it("「상세」 단추 없이 상호명을 누르면 그 업체 상세를 연다", async () => {
    const onDetail = await openAnnouncement(mixedBucket);
    expect(buttonsWith(root(), "상세")).toHaveLength(0);
    await mounted?.click(buttonsWith(root(), "다라상사")[0]);
    expect(onDetail).toHaveBeenCalledWith("cB", "다라상사");
  });

  it("onDetail 을 안 넘기면 상호명은 글자이고 알림에도 「업무 현황 보기」를 그리지 않는다", async () => {
    serve(mixedBucket);
    mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    await mounted.click(buttonsWith(root(), /공고 하나/)[0]);
    expect(buttonsWith(root(), "다라상사")).toHaveLength(0);
    expect(textOf(root())).toContain("다라상사");
    expect(toast()?.props.onOpen).toBeUndefined();
  });

  it("「업무 현황에 추가」 — 무엇이 생기는지 알리고 「업무 현황 보기」로 그 업체 상세를 연다", async () => {
    const onDetail = await openAnnouncement(mixedBucket);
    expect(buttonsWith(root(), "진행")).toHaveLength(0);
    expect(String(addButton("다라상사")?.props.title)).toContain("공고에 맞춘 할 일");
    expect(String(addButton("다라상사")?.props.title)).toContain("「신청 마감」");
    await mounted?.click(addButton("다라상사"));
    expect(progressCalls()).toHaveLength(1);
    expect(JSON.parse(String((progressCalls()[0][1] as RequestInit).body))).toEqual({ customerKey: "cB", bucketKey: "b1" });
    expect(textOf(rowOf("다라상사") ?? [])).toContain("업무 현황에 있음");
    expect(notice()).toMatchObject({ tone: "success", text: "다라상사 · 컨설팅 업무 현황에 「공고 하나」 추가 · 할 일 「신청 마감」 · 기한 11/20(금)", trackId: "t1" });
    const open = toast()?.props.onOpen as ((customerKey: string, companyName: string, trackId?: string) => void) | undefined;
    expect(typeof open).toBe("function");
    await mounted?.act(() => open?.("cB", "다라상사", "t1"));
    // 방금 만든(또는 이은) 업무 번호까지 넘긴다 — 앱이 상세창에서 그 업무를 바로 연다.
    expect(onDetail).toHaveBeenCalledWith("cB", "다라상사", "t1");
    expect(notice()).toBeNull();
  });

  it("이미 누가 넣은 공고는 누가 넣었는지 알린다", async () => {
    await openAnnouncement(mixedBucket, vi.fn(), progressResult(false));
    await mounted?.click(addButton("다라상사"));
    expect(notice()?.text).toBe("다라상사 · 「공고 하나」 · 이미 김컨설 님이 업무 현황에 추가했습니다");
  });

  it("엑셀 내려받기 — 주소(export)와 저장 함수(saveSheet)가 둘 다 있을 때만 그린다", async () => {
    serve(mixedBucket);
    const draw = async (endpoints: DeadlineEndpoints, features?: { saveSheet?: () => Promise<void> }) => {
      mounted?.unmount();
      mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} endpoints={endpoints} features={features} />, { opaque: OPAQUE });
      await mounted.settle();
      return buttonsWith(root(), /엑셀 내려받기/).length;
    };
    const withExport = { ...DEADLINE_ENDPOINTS, export: "/api/policy-track/deadline" };
    const saveSheet = async () => {};
    expect(await draw(DEADLINE_ENDPOINTS)).toBe(0);
    expect(await draw(DEADLINE_ENDPOINTS, { saveSheet })).toBe(0);
    expect(await draw(withExport)).toBe(0);
    expect(await draw(withExport, { saveSheet })).toBe(1);
  });
});

describe("연락 예정 업체 — 펼친 공고 표", () => {
  const company = {
    customerKey: "cB", companyName: "다라상사", consultant: "김컨설", consultantNames: ["김컨설"], statusText: "",
    nearestApplyEnd: "2026-11-20", nearestDDay: 6, kinds: [{ category: "정책자금", count: 2, nearestDDay: 6 }],
    announcementCount: 2, progressCount: 0,
  };
  const announcement = (bucketKey: string, title: string, extra: Partial<{ toCheck: string[]; gaps: string[] }>) => ({
    ...meta, bucketKey, title, verdict: "unverified", fitLabels: [], toCheck: [], gaps: [], progress: null, ...extra,
  });
  const companyView = {
    company: { customerKey: "cB", companyName: "다라상사" },
    announcements: [announcement("b1", "공고 하나", { toCheck: [GENERIC] }), announcement("b2", "공고 둘", { toCheck: ["수출 실적"], gaps: ["매출"] })],
  };

  async function openCompany(onDetail = vi.fn()) {
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/deadline/progress") && init?.method === "POST") return Promise.resolve(jsonResponse({ success: true, data: progressResult(true) }));
      if (url.includes("view=contacts")) return Promise.resolve(jsonResponse({ success: true, data: { companies: [company] } }));
      if (url.includes("view=company")) return Promise.resolve(jsonResponse({ success: true, data: companyView }));
      return never();
    });
    mounted = mountTree(<ContactsBoard scope="all" onDetail={onDetail} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    await mounted.click(buttonsWith(root(), /다라상사/)[0]);
    return onDetail;
  }

  it("「맞은 조건」 칸이 없고, 조건 정리 전 공고는 짧은 「조건 정리 전」 표시만 한다", async () => {
    await openCompany();
    const [t] = tables();
    expect(String(t.props.className)).toContain("table-fixed");
    expect(byTag(byTag(t, "colgroup")[0], "col")).toHaveLength(headsOf(t).length);
    expect(headsOf(t)).not.toContain("맞은 조건");
    expect(textOf(t)).not.toContain(GENERIC);
    expect(textOf(t)).not.toContain("없음");
    expect(textOf(cellOf(t, "공고 하나", "확인할 조건") ?? ["(칸 없음)"])).toBe("조건 정리 전");
    expect(textOf(cellOf(t, "공고 둘", "확인할 조건") ?? [])).toContain("수출 실적");
  });

  it("「업무 현황에 추가」 뒤 알림의 「업무 현황 보기」가 그 업체 상세를 연다", async () => {
    const onDetail = await openCompany();
    await mounted?.click(addButton("공고 하나"));
    expect(notice()?.text).toContain("컨설팅 업무 현황에 「공고 하나」 추가");
    expect(notice()?.trackId).toBe("t1");
    const open = toast()?.props.onOpen as ((customerKey: string, companyName: string, trackId?: string) => void) | undefined;
    await mounted?.act(() => open?.("cB", "다라상사", "t1"));
    expect(onDetail).toHaveBeenCalledWith("cB", "다라상사", "t1");
  });

  it("담당 줄은 showConsultant 가 켜졌을 때만 그린다(기본은 그림)", async () => {
    await openCompany();
    expect(textOf(root())).toContain("담당 김컨설");
    mounted?.unmount();
    mounted = mountTree(<ContactsBoard scope="all" showConsultant={false} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    expect(textOf(root())).toContain("다라상사");
    expect(textOf(root())).not.toContain("담당 김컨설");
    expect(findAll(root(), (n) => n.tag === "button").length).toBeGreaterThan(0);
  });
});
