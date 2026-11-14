// 정책별 고객사·연락 예정 화면 — 주소(?tab=…&view=…&bucket=…&scope=…) ↔ 화면 상태, 카드·탭·보기·담당 단추, 앱이 넘기는 값의 전달.
// 두 보드(AnnouncementBoard·ContactsBoard)는 안쪽을 풀지 않고(opaque) 화면이 넘긴 props 만 본다 — 보드 안쪽은 다른 시험이 맡는다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import AnnouncementBoard from "./AnnouncementBoard";
import ContactsBoard from "./ContactsBoard";
import { DeadlineToast } from "./DeadlineBits";
import PolicyCompaniesScreen, { type PolicyCompaniesScreenProps } from "./PolicyCompaniesScreen";
import { OTHER_KINDS } from "./deadline-view";
import { DEADLINE_ENDPOINTS } from "./endpoints";
import { DEFAULT_DAYS, DEFAULT_SCREEN_STATE, completeSummary, descriptionLine, parseScreenSearch, screenSearch, type ScreenState } from "./screen-state";
import { buttonsWith, byTag, find, findAll, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast, AnnouncementBoard, ContactsBoard];
const NOW = new Date("2026-11-14T03:00:00Z");
const MINE_LINE = "정책마다 맞는 내 담당 고객사를 묶어 보고, 연락할 업체를 마감 순서로 봅니다.";
const ALL_LINE = "정책마다 맞는 고객사를 묶어 보고, 연락할 업체를 마감 순서로 봅니다. 모든 고객사가 보입니다.";
const summary = { within7Companies: 2, contacts: 4, buckets: { d7: 3, d14: 5, d30: 8, all: 9 }, contactKinds: { policyFund: 1, freeGrant: 2, other: 3 } };

const fetchMock = vi.fn();
let mounted: ReturnType<typeof mountTree> | null = null;
let browser: ReturnType<typeof stubBrowser>;

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const urls = () => fetchMock.mock.calls.map(([input]) => String(input));
const summaryUrls = () => urls().filter((url) => url.includes("view=summary"));
const announcementBoard = () => find(root(), (n) => n.tag === "AnnouncementBoard");
const contactsBoard = () => find(root(), (n) => n.tag === "ContactsBoard");
const group = (label: string) => find(root(), (n) => n.props.role === "group" && n.props["aria-label"] === label);
const segButton = (label: string, text: string) => {
  const holder = group(label);
  return holder ? buttonsWith(holder, text)[0] : undefined;
};
const tabButton = (text: string) => find(root(), (n) => n.props.role === "tab" && textOf(n).trim() === text);
const choice = (ariaLabel: string) => find(root(), (n) => n.tag === "button" && n.props["aria-label"] === ariaLabel);
const description = () => textOf(byTag(root(), "p")[0]);

async function draw(props: Partial<PolicyCompaniesScreenProps> = {}, search = "", hash = "") {
  mounted?.unmount();
  browser = stubBrowser(search, "/policy-companies", hash);
  mounted = mountTree(<PolicyCompaniesScreen endpoints={DEADLINE_ENDPOINTS} now={NOW} {...props} />, { opaque: OPAQUE });
  await mounted.settle();
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string) =>
    String(input).includes("view=summary") ? Promise.resolve(jsonResponse({ success: true, data: summary })) : new Promise<Response>(() => {}),
  );
  vi.stubGlobal("fetch", fetchMock);
  browser = stubBrowser();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe("주소 읽기 parseScreenSearch", () => {
  it("빈 주소는 기본값 — 정책별 고객사 · 목록 · 내 담당", () => {
    expect(parseScreenSearch("", true)).toEqual(DEFAULT_SCREEN_STATE);
    expect(DEFAULT_SCREEN_STATE).toEqual({ tab: "companies", view: "list", bucket: "", scope: "mine" });
    expect(DEFAULT_DAYS).toBe(14);
  });

  it("탭·보기·담당을 읽는다", () => {
    expect(parseScreenSearch("?tab=contacts&view=calendar&scope=all", true)).toEqual({ tab: "contacts", view: "calendar", bucket: "", scope: "all" });
    expect(parseScreenSearch("?tab=companies&view=list&scope=mine", true)).toEqual(DEFAULT_SCREEN_STATE);
  });

  it("scope 는 scopeToggle 이 켜진 앱에서만 읽는다", () => {
    expect(parseScreenSearch("?scope=all", false).scope).toBe("mine");
    expect(parseScreenSearch("?scope=all", true).scope).toBe("all");
  });

  it("옛 주소 tab=deadline&bucket= 은 정책별 고객사의 그 공고(슬랙 「공고 보기」)", () => {
    expect(parseScreenSearch("?tab=deadline&bucket=B1", false)).toEqual({ tab: "companies", view: "list", bucket: "B1", scope: "mine" });
  });

  it("연락 예정 탭에서는 bucket 을 읽지 않고, 모르는 값은 기본값", () => {
    expect(parseScreenSearch("?tab=contacts&bucket=B1", false).bucket).toBe("");
    expect(parseScreenSearch("?tab=엉터리&view=엉터리&scope=엉터리", true)).toEqual(DEFAULT_SCREEN_STATE);
  });
});

describe("주소 만들기 screenSearch", () => {
  const state = (over: Partial<ScreenState>): ScreenState => ({ ...DEFAULT_SCREEN_STATE, ...over });

  it("기본값은 주소에서 뺀다", () => {
    expect(screenSearch(DEFAULT_SCREEN_STATE, true)).toBe("");
    expect(screenSearch(state({ view: "calendar" }), true)).toBe("");
  });

  it("연락 예정은 tab=contacts, 캘린더는 view=calendar(연락 예정 탭에서만)", () => {
    expect(screenSearch(state({ tab: "contacts" }), false)).toBe("?tab=contacts");
    expect(screenSearch(state({ tab: "contacts", view: "calendar" }), false)).toBe("?tab=contacts&view=calendar");
  });

  it("정책별 고객사의 bucket 은 그 탭에서만 쓰고, 연락 예정으로 가면 빠진다", () => {
    expect(screenSearch(state({ bucket: "B1" }), false)).toBe("?bucket=B1");
    expect(screenSearch(state({ tab: "contacts", bucket: "B1" }), false)).toBe("?tab=contacts");
  });

  it("scope=all 은 scopeToggle 이 켜졌을 때만 쓰고, 꺼진 앱의 scope 값은 건드리지 않는다", () => {
    expect(screenSearch(state({ scope: "all" }), true)).toBe("?scope=all");
    expect(screenSearch(state({ scope: "all" }), false)).toBe("");
    expect(screenSearch(state({ tab: "contacts" }), false, "?scope=all")).toBe("?scope=all&tab=contacts");
    expect(screenSearch(DEFAULT_SCREEN_STATE, true, "?scope=all")).toBe("");
  });

  it("앱이 붙인 다른 값(key 등)은 그대로 두고 이 화면 값만 바꾼다", () => {
    expect(screenSearch(state({ tab: "contacts", view: "calendar" }), true, "?key=abc&tab=contacts&view=list")).toBe("?key=abc&tab=contacts&view=calendar");
    expect(screenSearch(DEFAULT_SCREEN_STATE, true, "?key=abc&tab=contacts&bucket=B1")).toBe("?key=abc");
  });

  it("만든 주소를 다시 읽으면 같은 상태다", () => {
    const states: ScreenState[] = [
      DEFAULT_SCREEN_STATE,
      state({ tab: "contacts" }),
      state({ tab: "contacts", view: "calendar", scope: "all" }),
      state({ bucket: "B 1/가" }),
      state({ scope: "all" }),
    ];
    for (const original of states) expect(parseScreenSearch(screenSearch(original, true), true), JSON.stringify(original)).toEqual(original);
  });
});

describe("요약·설명 글", () => {
  it("요약 응답이 두 카드를 그릴 만큼 다 오지 않았으면 못 읽은 것으로 본다", () => {
    expect(completeSummary(summary)).toBe(summary);
    expect(completeSummary(null)).toBeNull();
    expect(completeSummary({ within7Companies: 1, contacts: 1 } as never)).toBeNull();
    expect(completeSummary({ ...summary, contactKinds: undefined } as never)).toBeNull();
  });

  it("설명 한 줄 — 모든 고객사가 보이는지에 따라 두 가지", () => {
    expect(descriptionLine(true)).toBe(ALL_LINE);
    expect(descriptionLine(false)).toBe(MINE_LINE);
  });
});

describe("화면 구성", () => {
  it("본문 제목이 없다 — 설명 한 줄, 카드 두 장, 탭 둘 순서(제목은 앱 위 띠가 그린다)", async () => {
    await draw();
    expect(byTag(root(), "h1")).toHaveLength(0);
    expect(textOf(root())).not.toContain("정책별 고객사·연락 예정");
    expect(description()).toBe(MINE_LINE);
    expect(findAll(root(), (n) => typeof n.props["data-scorecard"] === "string").map((n) => n.props["data-scorecard"])).toEqual(["정책별 고객사", "연락 예정 업체"]);
    expect(findAll(root(), (n) => n.props.role === "tab").map((n) => textOf(n).trim())).toEqual(["정책별 고객사", "연락 예정 업체"]);
    const top = root().kids[0] as HostNode;
    expect(top.kids.map((kid) => (typeof kid === "string" ? kid : kid.tag))).toEqual(["p", "section", "div", "div"]);
  });

  it("처음에는 정책별 고객사 탭 — 탭에 선택 표시, 보드는 정책별 고객사 하나", async () => {
    await draw();
    expect(tabButton("정책별 고객사")?.props["aria-selected"]).toBe(true);
    expect(tabButton("연락 예정 업체")?.props["aria-selected"]).toBe(false);
    expect(announcementBoard()?.tag).toBe("AnnouncementBoard");
    expect(contactsBoard()).toBeUndefined();
    expect(find(root(), (n) => n.props.role === "tabpanel")?.props["aria-labelledby"]).toBe("pdl-tab-companies");
  });

  it("「보기」는 연락 예정 탭에서만, 「담당」은 scopeToggle 일 때만 그린다", async () => {
    await draw();
    expect(group("보기")).toBeUndefined();
    expect(group("담당")).toBeUndefined();
    await draw({ scopeToggle: true }, "?tab=contacts");
    expect(buttonsWith(group("보기") ?? root(), "목록")).toHaveLength(1);
    expect(buttonsWith(group("보기") ?? root(), "캘린더")).toHaveLength(1);
    expect(group("담당")?.kids).toHaveLength(2);
    await draw({ scopeToggle: true });
    expect(group("보기")).toBeUndefined();
    expect(group("담당")?.props.role).toBe("group");
  });

  it("핸들러가 없는 단추는 그리지 않는다 — 업체 열기가 없으면 보드에 onDetail 을 넘기지 않는다", async () => {
    await draw();
    expect(announcementBoard()?.props.onDetail).toBeUndefined();
    await draw({}, "?tab=contacts");
    expect(contactsBoard()?.props.onDetail).toBeUndefined();
  });
});

describe("요약 카드", () => {
  it("읽기 통로에 view=summary 로 한 번 읽고, 숫자를 카드에 보인다(scopeToggle 이 꺼지면 scope 를 싣지 않는다)", async () => {
    await draw();
    expect(summaryUrls()).toEqual(["/api/policy-track/deadline?view=summary"]);
    const first = find(root(), (n) => n.props["data-scorecard"] === "정책별 고객사");
    const second = find(root(), (n) => n.props["data-scorecard"] === "연락 예정 업체");
    expect(textOf(first ?? [])).toContain("2곳");
    expect(textOf(second ?? [])).toContain("4곳");
    expect(choice("7일 안 마감 공고 3건")?.props["aria-pressed"]).toBe(false);
    expect(choice("14일 안 마감 공고 5건")?.props["aria-pressed"]).toBe(true);
  });

  it("못 읽으면 숫자 자리에 「…」, 단추는 그대로 누를 수 있다", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    await draw();
    const first = find(root(), (n) => n.props["data-scorecard"] === "정책별 고객사");
    expect(textOf(first ?? [])).toContain("…");
    const pending = buttonsWith(first ?? root(), /7일 안 마감/)[0];
    expect(pending?.props.onClick).toBeTypeOf("function");
  });

  it("읽기가 실패하면 카드는 「…」로 남고 화면은 그대로다", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ success: false, error: { message: "읽기 실패" } }, 500)));
    await draw();
    expect(textOf(find(root(), (n) => n.props["data-scorecard"] === "연락 예정 업체") ?? [])).toContain("…");
    expect(announcementBoard()?.tag).toBe("AnnouncementBoard");
  });

  it("정책별 고객사 카드의 줄을 누르면 그 마감으로 정책별 고객사 탭이 열린다", async () => {
    await draw({}, "?tab=contacts");
    expect(contactsBoard()?.tag).toBe("ContactsBoard");
    await mounted?.click(choice("30일 안 마감 공고 8건"));
    expect(contactsBoard()).toBeUndefined();
    expect(announcementBoard()?.props.days).toBe(30);
    expect(choice("30일 안 마감 공고 8건")?.props["aria-pressed"]).toBe(true);
    expect(tabButton("정책별 고객사")?.props["aria-selected"]).toBe(true);
    await mounted?.click(choice("전체 공고 9건"));
    expect(announcementBoard()?.props.days).toBe("all");
  });

  it("연락 예정 카드의 줄을 누르면 그 종류로 연락 예정 탭이 열리고, 같은 줄을 또 누르면 전체로 돌아간다", async () => {
    await draw();
    await mounted?.click(choice("정책자금 1곳"));
    expect(announcementBoard()).toBeUndefined();
    expect(contactsBoard()?.props.kind).toBe("정책자금");
    expect(tabButton("연락 예정 업체")?.props["aria-selected"]).toBe(true);
    expect(choice("정책자금 1곳")?.props["aria-pressed"]).toBe(true);
    await mounted?.click(choice("정책자금 1곳"));
    expect(contactsBoard()?.props.kind).toBe("");
    await mounted?.click(choice("그 밖의 분야 3곳"));
    // 「그 밖의 분야」 줄은 화면 글자가 아니라 내부 열쇠(OTHER_KINDS)로 종류를 거른다.
    expect(contactsBoard()?.props.kind).toBe(OTHER_KINDS);
  });

  it("카드 줄을 누르면 슬랙에서 온 공고 열쇠(bucket)는 비운다", async () => {
    await draw({}, "?bucket=B1");
    expect(announcementBoard()?.props.initialBucket).toBe("B1");
    expect(announcementBoard()?.props.days).toBe("all");
    await mounted?.click(choice("7일 안 마감 공고 3건"));
    expect(announcementBoard()?.props.initialBucket).toBeUndefined();
    expect(announcementBoard()?.props.days).toBe(7);
    expect(browser.location.search).toBe("");
  });
});

describe("주소 읽기·맞추기 — 화면", () => {
  it("연락 예정·캘린더 주소로 열면 그 탭·그 보기로 연다", async () => {
    await draw({}, "?tab=contacts&view=calendar");
    expect(announcementBoard()).toBeUndefined();
    expect(contactsBoard()?.props.view).toBe("calendar");
    expect(segButton("보기", "캘린더")?.props["aria-pressed"]).toBe(true);
    expect(segButton("보기", "목록")?.props["aria-pressed"]).toBe(false);
  });

  it("옛 주소(tab=deadline&bucket=)로 열면 정책별 고객사에서 그 공고를 펼칠 값을 보드에 넘기고 마감은 「전체」", async () => {
    await draw({}, "?tab=deadline&bucket=B1");
    expect(announcementBoard()?.props.initialBucket).toBe("B1");
    expect(announcementBoard()?.props.days).toBe("all");
    expect(contactsBoard()).toBeUndefined();
  });

  it("기본 주소로 열면 주소를 건드리지 않는다", async () => {
    await draw();
    expect(browser.replaceState).not.toHaveBeenCalled();
    await draw({}, "?tab=contacts&view=calendar");
    expect(browser.replaceState).not.toHaveBeenCalled();
  });

  it("탭·보기를 바꾸면 replaceState 로 주소를 맞춘다(뒤로 가기 칸을 늘리지 않는다)", async () => {
    await draw();
    await mounted?.click(tabButton("연락 예정 업체"));
    expect(browser.replaceState).toHaveBeenLastCalledWith(null, "", "/policy-companies?tab=contacts");
    await mounted?.click(segButton("보기", "캘린더"));
    expect(browser.replaceState).toHaveBeenLastCalledWith(null, "", "/policy-companies?tab=contacts&view=calendar");
    expect(contactsBoard()?.props.view).toBe("calendar");
    await mounted?.click(segButton("보기", "목록"));
    expect(browser.replaceState).toHaveBeenLastCalledWith(null, "", "/policy-companies?tab=contacts");
    await mounted?.click(tabButton("정책별 고객사"));
    expect(browser.replaceState).toHaveBeenLastCalledWith(null, "", "/policy-companies");
    expect(browser.location.search).toBe("");
  });

  it("보기는 연락 예정 탭을 떠났다 돌아와도 기억한다", async () => {
    await draw({}, "?tab=contacts&view=calendar");
    await mounted?.click(tabButton("정책별 고객사"));
    await mounted?.click(tabButton("연락 예정 업체"));
    expect(contactsBoard()?.props.view).toBe("calendar");
    expect(browser.location.search).toBe("?tab=contacts&view=calendar");
  });

  it("앱이 붙인 다른 주소 값과 #조각은 그대로 둔다", async () => {
    await draw({}, "?key=abc", "#top");
    await mounted?.click(tabButton("연락 예정 업체"));
    expect(browser.replaceState).toHaveBeenLastCalledWith(null, "", "/policy-companies?key=abc&tab=contacts#top");
  });

  it("scopeToggle 이 켜지면 「전체」가 scope=all 로 주소에 남고, 「내 담당」은 기본이라 주소에서 빠진다", async () => {
    await draw({ scopeToggle: true });
    await mounted?.click(segButton("담당", "전체"));
    expect(browser.replaceState).toHaveBeenLastCalledWith(null, "", "/policy-companies?scope=all");
    await mounted?.click(segButton("담당", "내 담당"));
    expect(browser.replaceState).toHaveBeenLastCalledWith(null, "", "/policy-companies");
  });

  it("scopeToggle 이 꺼진 앱은 주소의 scope 를 읽지도 쓰지도 않는다", async () => {
    await draw({}, "?scope=all");
    expect(announcementBoard()?.props.scope).toBeUndefined();
    await mounted?.click(tabButton("연락 예정 업체"));
    expect(browser.location.search).toBe("?scope=all&tab=contacts");
    expect(contactsBoard()?.props.scope).toBeUndefined();
    expect(urls().filter((url) => url.includes("scope="))).toEqual([]);
  });
});

describe("담당 범위(scopeToggle)", () => {
  it("켜면 scope 를 요약 읽기와 두 보드에 넘기고, 처음은 내 담당", async () => {
    await draw({ scopeToggle: true });
    expect(summaryUrls()).toEqual(["/api/policy-track/deadline?view=summary&scope=mine"]);
    expect(announcementBoard()?.props.scope).toBe("mine");
    expect(announcementBoard()?.props.showConsultant).toBe(false);
    expect(description()).toBe(MINE_LINE);
    expect(segButton("담당", "내 담당")?.props["aria-pressed"]).toBe(true);
  });

  it("주소의 scope=all 로 열면 전체 — 담당 칸을 보이고 설명도 「모든 고객사」", async () => {
    await draw({ scopeToggle: true }, "?scope=all");
    expect(summaryUrls()).toEqual(["/api/policy-track/deadline?view=summary&scope=all"]);
    expect(announcementBoard()?.props.scope).toBe("all");
    expect(announcementBoard()?.props.showConsultant).toBe(true);
    expect(description()).toBe(ALL_LINE);
  });

  it("「전체」를 누르면 요약을 다시 읽고 보드에 scope=all 을 넘기며 공고 열쇠는 비운다", async () => {
    await draw({ scopeToggle: true }, "?bucket=B1");
    expect(announcementBoard()?.props.initialBucket).toBe("B1");
    await mounted?.click(segButton("담당", "전체"));
    expect(summaryUrls()).toEqual(["/api/policy-track/deadline?view=summary&scope=mine", "/api/policy-track/deadline?view=summary&scope=all"]);
    expect(announcementBoard()?.props.scope).toBe("all");
    expect(announcementBoard()?.props.initialBucket).toBeUndefined();
    expect(announcementBoard()?.props.showConsultant).toBe(true);
    expect(description()).toBe(ALL_LINE);
  });

  it("scopeToggle 이 꺼져 있어도 seesAll 이면 담당 칸·「모든 고객사」 설명을 보인다(scope 는 안 싣는다)", async () => {
    await draw({ seesAll: true });
    expect(announcementBoard()?.props.showConsultant).toBe(true);
    expect(announcementBoard()?.props.scope).toBeUndefined();
    expect(description()).toBe(ALL_LINE);
    expect(group("담당")).toBeUndefined();
    await draw({}, "?tab=contacts");
    expect(contactsBoard()?.props.showConsultant).toBe(false);
  });
});

describe("앱이 넘기는 값의 전달", () => {
  it("endpoints·features·revision·now 를 보드에 그대로 넘긴다", async () => {
    const features = { saveSheet: vi.fn() };
    await draw({ features, revision: 3 });
    expect(announcementBoard()?.props.endpoints).toBe(DEADLINE_ENDPOINTS);
    expect(announcementBoard()?.props.features).toBe(features);
    expect(announcementBoard()?.props.revision).toBe(3);
    expect(announcementBoard()?.props.defaultDays).toBe(14);
    await draw({ revision: 2 }, "?tab=contacts");
    expect(contactsBoard()?.props.endpoints).toBe(DEADLINE_ENDPOINTS);
    expect(contactsBoard()?.props.revision).toBe(2);
    expect(contactsBoard()?.props.now).toBe(NOW);
  });

  it("업체 열기(onOpenCompany)를 보드의 onDetail 로 풀어 넘긴다 — 두 탭 모두", async () => {
    const onOpenCompany = vi.fn();
    await draw({ onOpenCompany });
    (announcementBoard()?.props.onDetail as (key: string, name: string) => void)("c1", "가나상사");
    await draw({ onOpenCompany }, "?tab=contacts");
    (contactsBoard()?.props.onDetail as (key: string, name: string) => void)("c2", "다라상사");
    expect(onOpenCompany.mock.calls).toEqual([[{ customerKey: "c1", companyName: "가나상사" }], [{ customerKey: "c2", companyName: "다라상사" }]]);
  });

  it("onViewProgress 만 있으면 그것을 쓰고, 둘 다 있으면 onOpenCompany 가 먼저다", async () => {
    const onViewProgress = vi.fn();
    const onOpenCompany = vi.fn();
    await draw({ onViewProgress });
    (announcementBoard()?.props.onDetail as (key: string, name: string) => void)("c1", "가나상사");
    expect(onViewProgress).toHaveBeenCalledWith({ customerKey: "c1", companyName: "가나상사" });
    await draw({ onViewProgress, onOpenCompany });
    (announcementBoard()?.props.onDetail as (key: string, name: string) => void)("c9", "마바상사");
    expect(onOpenCompany).toHaveBeenCalledWith({ customerKey: "c9", companyName: "마바상사" });
    expect(onViewProgress).toHaveBeenCalledTimes(1);
  });

  it("보드가 마감·종류·진행을 알리면 화면이 받는다 — 마감 바꾸면 공고 열쇠 비움, 진행하면 요약을 다시 읽음", async () => {
    await draw({ scopeToggle: true }, "?bucket=B1");
    await mounted?.act(() => (announcementBoard()?.props.onDaysChange as (days: number) => void)(30));
    expect(announcementBoard()?.props.days).toBe(30);
    expect(announcementBoard()?.props.initialBucket).toBeUndefined();
    expect(browser.location.search).toBe("");
    expect(summaryUrls()).toHaveLength(1);
    await mounted?.act(() => (announcementBoard()?.props.onProgressed as () => void)());
    expect(summaryUrls()).toHaveLength(2);
    await mounted?.click(tabButton("연락 예정 업체"));
    await mounted?.act(() => (contactsBoard()?.props.onKindChange as (kind: string) => void)("무상지원금"));
    expect(contactsBoard()?.props.kind).toBe("무상지원금");
    await mounted?.act(() => (contactsBoard()?.props.onProgressed as () => void)());
    expect(summaryUrls()).toHaveLength(3);
  });
});
