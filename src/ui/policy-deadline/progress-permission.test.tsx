// 「업무 현황에 추가」 단추는 업무 현황(정책 진행)을 만들 수 있는 사람에게만 — 앱이 `canProgress` 로 끈다.
// 2026-11-15 화면 검토: 정책 진행 화면 권한이 없는 사람에게도 단추가 보여 누르면 권한 오류만 떴다.
// 꺼도 이미 넣은 공고의 「업무 현황에 있음」은 그대로 보이고, 칸 폭은 그대로다(표가 흔들리지 않게). 기본(값 없음)은 지금처럼 단추가 보인다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import AnnouncementBoard from "./AnnouncementBoard";
import ContactsBoard from "./ContactsBoard";
import { DeadlineToast, ProgressCell } from "./DeadlineBits";
import PolicyCompaniesScreen from "./PolicyCompaniesScreen";
import { DEADLINE_ENDPOINTS } from "./endpoints";
import { buttonsWith, byTag, find, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast];
const ADD = "업무 현황에 추가";
const IN = "업무 현황에 있음";
const NOW = new Date("2026-11-14T03:00:00Z");
const fetchMock = vi.fn();
const never = () => new Promise<Response>(() => {});
let mounted: ReturnType<typeof mountTree> | null = null;

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const done = { trackId: "t0", byName: "김컨설", via: "web", at: "2026-11-13T00:00:00.000Z" };
const meta = {
  bucketKey: "b1", repAnnouncementId: "a1", title: "공고 하나", agency: "기관", category: "정책자금",
  url: "", applyEnd: "2026-11-20", dDay: 6,
};
const list = { lastRun: null, companyCount: 2, bucketCount: 1, categories: ["정책자금"], dated: [{ ...meta, fit: 1, unverified: 1 }], always: [] };
const company = (customerKey: string, companyName: string, progress: typeof done | null) => ({
  customerKey, companyName, consultant: "김컨설", consultantNames: ["김컨설"], statusText: "계약", fitLabels: [], toCheck: [], gaps: [], progress,
});
// 가나상사는 아직 안 넣은 업체, 다라상사는 이미 업무 현황에 넣은 업체.
const bucket = { bucket: meta, fit: [company("cA", "가나상사", null)], unverified: [company("cB", "다라상사", done)] };
const contact = {
  customerKey: "cB", companyName: "다라상사", consultant: "김컨설", consultantNames: ["김컨설"], statusText: "",
  nearestApplyEnd: "2026-11-20", nearestDDay: 6, kinds: [{ category: "정책자금", count: 2, nearestDDay: 6 }],
  announcementCount: 2, progressCount: 1,
};
const announcement = (bucketKey: string, title: string, progress: typeof done | null) => ({
  ...meta, bucketKey, title, verdict: "fit", fitLabels: [], toCheck: [], gaps: [], progress,
});
const companyView = {
  company: { customerKey: "cB", companyName: "다라상사" },
  announcements: [announcement("b1", "공고 하나", null), announcement("b2", "공고 둘", done)],
};

function serve() {
  fetchMock.mockImplementation((input: string) => {
    const url = String(input);
    if (url.includes("view=list")) return Promise.resolve(jsonResponse({ success: true, data: list }));
    if (url.includes("view=bucket")) return Promise.resolve(jsonResponse({ success: true, data: bucket }));
    if (url.includes("view=contacts")) return Promise.resolve(jsonResponse({ success: true, data: { companies: [contact] } }));
    if (url.includes("view=company")) return Promise.resolve(jsonResponse({ success: true, data: companyView }));
    return never();
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubBrowser();
  serve();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("ProgressCell — canProgress", () => {
  it("기본은 단추를 그린다", () => {
    const html = renderToStaticMarkup(<ProgressCell inProgress={false} busy={false} onProgress={() => {}} />);
    expect(html).toContain(ADD);
  });

  it("끄면 아직 안 넣은 공고에 단추를 그리지 않는다", () => {
    const html = renderToStaticMarkup(<ProgressCell inProgress={false} busy={false} canProgress={false} onProgress={() => {}} />);
    expect(html).not.toContain(ADD);
    expect(html).not.toContain("<button");
  });

  it("꺼도 이미 넣은 공고는 「업무 현황에 있음」을 그린다", () => {
    const html = renderToStaticMarkup(<ProgressCell inProgress busy={false} canProgress={false} onProgress={() => {}} />);
    expect(html).toContain(IN);
  });
});

describe("정책별 고객사 보드 — canProgress", () => {
  async function open(canProgress?: boolean) {
    mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} endpoints={DEADLINE_ENDPOINTS} canProgress={canProgress} />, { opaque: OPAQUE });
    await mounted.settle();
    await mounted.click(buttonsWith(root(), /공고 하나/)[0]);
  }

  it("기본은 안 넣은 업체에 단추가 보인다", async () => {
    await open();
    expect(buttonsWith(root(), ADD)).toHaveLength(1);
  });

  it("끄면 펼친 업체 표에 단추가 없고, 이미 넣은 업체의 「업무 현황에 있음」·칸 머리는 그대로다", async () => {
    await open(false);
    expect(buttonsWith(root(), ADD)).toHaveLength(0);
    expect(textOf(root())).toContain(IN);
    expect(textOf(root())).toContain("가나상사");
    const cols = byTag(byTag(root(), "table")[0], "col");
    expect(cols.length).toBeGreaterThan(0);
  });
});

describe("연락 예정 보드 — canProgress", () => {
  async function openList(canProgress?: boolean) {
    mounted = mountTree(<ContactsBoard scope="all" endpoints={DEADLINE_ENDPOINTS} canProgress={canProgress} />, { opaque: OPAQUE });
    await mounted.settle();
    await mounted.click(buttonsWith(root(), /다라상사/)[0]);
  }
  async function openCalendar(canProgress?: boolean) {
    mounted = mountTree(<ContactsBoard scope="all" endpoints={DEADLINE_ENDPOINTS} view="calendar" now={NOW} canProgress={canProgress} />, { opaque: OPAQUE });
    await mounted.settle();
    await mounted.click(buttonsWith(root(), /다라상사/)[0]);
    return find(root(), (n) => n.props["aria-label"] === "고른 업체");
  }

  it("목록 — 기본은 단추가 보이고, 끄면 없고 「업무 현황에 있음」은 그대로다", async () => {
    await openList();
    expect(buttonsWith(root(), ADD)).toHaveLength(1);
    mounted?.unmount();
    await openList(false);
    expect(buttonsWith(root(), ADD)).toHaveLength(0);
    expect(textOf(root())).toContain("공고 하나");
    expect(textOf(root())).toContain(IN);
  });

  it("캘린더 고른 업체 — 끄면 단추가 없고 「업무 현황에 있음」은 그대로다", async () => {
    const shown = await openCalendar();
    expect(buttonsWith(shown ?? root(), ADD)).toHaveLength(1);
    mounted?.unmount();
    const hidden = await openCalendar(false);
    expect(textOf(hidden ?? [])).toContain("공고 하나");
    expect(buttonsWith(hidden ?? root(), ADD)).toHaveLength(0);
    expect(textOf(hidden ?? [])).toContain(IN);
  });
});

describe("화면 PolicyCompaniesScreen — canProgress 를 두 보드에 넘긴다", () => {
  const BOARDS = [...OPAQUE, AnnouncementBoard, ContactsBoard];
  const summary = { within7Companies: 0, contacts: 0, buckets: { d7: 0, d14: 0, d30: 0, all: 0 }, contactKinds: { policyFund: 0, freeGrant: 0, other: 0 } };
  beforeEach(() => {
    fetchMock.mockImplementation((input: string) =>
      String(input).includes("view=summary") ? Promise.resolve(jsonResponse({ success: true, data: summary })) : never(),
    );
  });
  const boardProp = (tag: string) => find(root(), (n) => n.tag === tag)?.props.canProgress;

  it("정책별 고객사·연락 예정 탭 모두 같은 값을 받는다(기본 true)", async () => {
    mounted = mountTree(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} now={NOW} />, { opaque: BOARDS });
    await mounted.settle();
    expect(boardProp("AnnouncementBoard")).toBe(true);
    mounted.unmount();
    stubBrowser("?tab=contacts");
    mounted = mountTree(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} now={NOW} canProgress={false} />, { opaque: BOARDS });
    await mounted.settle();
    expect(boardProp("ContactsBoard")).toBe(false);
    mounted.unmount();
    stubBrowser("");
    mounted = mountTree(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} now={NOW} canProgress={false} />, { opaque: BOARDS });
    await mounted.settle();
    expect(boardProp("AnnouncementBoard")).toBe(false);
  });
});
