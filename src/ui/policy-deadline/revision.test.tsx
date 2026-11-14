// `revision` — 앱이 올리면(ERP 는 업체 상세창에서 저장한 뒤) 지금 탭과 요약 카드를 한 번 더 읽는다.
// 보드를 풀지 않고 실제로 돌려(effect 포함) 읽기 통로 호출 수로 확인한다. 값이 그대로면 다시 읽지 않는다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import AnnouncementBoard from "./AnnouncementBoard";
import ContactsBoard from "./ContactsBoard";
import { DeadlineToast } from "./DeadlineBits";
import PolicyCompaniesScreen from "./PolicyCompaniesScreen";
import { DEADLINE_ENDPOINTS } from "./endpoints";
import { buttonsWith, jsonResponse, mountTree, stubBrowser, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast];
const fetchMock = vi.fn();
let mounted: ReturnType<typeof mountTree> | null = null;

const company = {
  customerKey: "c1", companyName: "가나상사", consultant: "담당", consultantNames: ["담당"], statusText: "",
  nearestApplyEnd: "2026-11-20", nearestDDay: 7, kinds: [{ category: "정책자금", count: 1, nearestDDay: 7 }],
  announcementCount: 1, progressCount: 0,
};
const bucket = {
  bucketKey: "b1", repAnnouncementId: "a1", title: "공고 하나", agency: "기관", category: "정책자금", url: "",
  applyEnd: "2026-11-20", dDay: 7, fit: 1, unverified: 0,
};
const list = { lastRun: null, companyCount: 1, bucketCount: 1, categories: ["정책자금"], dated: [bucket], always: [] };
const announcement = {
  bucketKey: "b1", repAnnouncementId: "a1", title: "공고 하나", agency: "기관", category: "정책자금", url: "", applyEnd: "2026-11-20", dDay: 7,
  verdict: "fit", fitLabels: ["업력"], toCheck: [], gaps: [], progress: null,
};
const summary = { within7Companies: 1, contacts: 1, buckets: { d7: 1, d14: 1, d30: 1, all: 1 }, contactKinds: { policyFund: 1, freeGrant: 0, other: 0 } };

const never = () => new Promise<Response>(() => {});
const reads = (part: string) => fetchMock.mock.calls.filter(([input]) => String(input).includes(part)).length;
const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string) => {
    const url = String(input);
    if (url.includes("view=summary")) return Promise.resolve(jsonResponse({ success: true, data: summary }));
    if (url.includes("view=list")) return Promise.resolve(jsonResponse({ success: true, data: list }));
    if (url.includes("view=contacts")) return Promise.resolve(jsonResponse({ success: true, data: { companies: [company] } }));
    if (url.includes("view=company")) return Promise.resolve(jsonResponse({ success: true, data: { announcements: [announcement] } }));
    return never();
  });
  vi.stubGlobal("fetch", fetchMock);
  stubBrowser();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("화면 PolicyCompaniesScreen — revision 을 올리면 지금 탭과 요약 카드를 한 번 더 읽는다", () => {
  it("정책별 고객사 탭: 요약 한 번 + 목록 한 번 → revision 1 로 올리면 각각 한 번 더", async () => {
    mounted = mountTree(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} revision={0} />, { opaque: OPAQUE });
    await mounted.settle();
    expect([reads("view=summary"), reads("view=list"), reads("view=contacts")]).toEqual([1, 1, 0]);

    mounted.update(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} revision={1} />);
    await mounted.settle();
    expect([reads("view=summary"), reads("view=list"), reads("view=contacts")]).toEqual([2, 2, 0]);
  });

  it("연락 예정 탭: 요약 한 번 + 연락 예정 한 번 → revision 을 올리면 각각 한 번 더(목록 읽기는 부르지 않는다)", async () => {
    stubBrowser("?tab=contacts");
    mounted = mountTree(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} revision={0} />, { opaque: OPAQUE });
    await mounted.settle();
    expect([reads("view=summary"), reads("view=list"), reads("view=contacts")]).toEqual([1, 0, 1]);

    mounted.update(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} revision={1} />);
    await mounted.settle();
    expect([reads("view=summary"), reads("view=list"), reads("view=contacts")]).toEqual([2, 0, 2]);
  });

  it("같은 revision 으로 다시 그려도 더 읽지 않는다", async () => {
    mounted = mountTree(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} revision={2} />, { opaque: OPAQUE });
    await mounted.settle();
    mounted.update(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} revision={2} />);
    await mounted.settle();
    expect([reads("view=summary"), reads("view=list")]).toEqual([1, 1]);
  });
});

describe("보드 — 앱이 보드를 따로 쓸 때(지원정책 매칭 「정책별 업체」 탭)도 같다", () => {
  it("AnnouncementBoard: revision 을 올리면 목록을 한 번 더 읽는다", async () => {
    mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} revision={0} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    expect(reads("view=list")).toBe(1);
    mounted.update(<AnnouncementBoard scope="all" defaultDays={14} revision={1} endpoints={DEADLINE_ENDPOINTS} />);
    await mounted.settle();
    expect(reads("view=list")).toBe(2);
  });

  it("ContactsBoard: revision 을 올리면 연락 예정을 한 번 더 읽고, 펼쳐 둔 업체의 공고도 다시 읽는다", async () => {
    mounted = mountTree(<ContactsBoard scope="all" revision={0} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    expect([reads("view=contacts"), reads("view=company")]).toEqual([1, 0]);
    await mounted.click(buttonsWith(root(), /가나상사/)[0]);
    expect([reads("view=contacts"), reads("view=company")]).toEqual([1, 1]);

    mounted.update(<ContactsBoard scope="all" revision={1} endpoints={DEADLINE_ENDPOINTS} />);
    await mounted.settle();
    expect([reads("view=contacts"), reads("view=company")]).toEqual([2, 2]);
  });

  it("revision 을 안 넘기면 처음 한 번만 읽는다", async () => {
    mounted = mountTree(<ContactsBoard scope="all" endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    mounted.update(<ContactsBoard scope="all" endpoints={DEADLINE_ENDPOINTS} />);
    await mounted.settle();
    expect(reads("view=contacts")).toBe(1);
  });
});
