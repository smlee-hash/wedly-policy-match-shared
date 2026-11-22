// NO.789 연락 예정 업체 — 업체를 「맞을 확률」 순으로 보이고(높음 → 보통 → 낮음, 판단 전은 끝 접힌 묶음), 단계로 거른다.
// 접은 업체 줄은 가장 좋은 공고 한 줄(단계 딱지·공고 이름·D-n·지원 금액)과 근거 한 줄(근거 · 다음 할 일 · 확인할 것)을 보인다.
// 업체를 펼친 공고 표는 공고명·마감·맞을 확률·다음 할 일·확인할 것·업무 현황 — 확인할 것을 펼치면 표 폭 전체에 두 묶음,
// 「해당 없음」으로 사유를 남기면 그 공고가 아래 「해당 없음」 묶음으로 내려가고 되돌리면 제자리로 돌아온다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import type { CheckItem } from "../../serve/policy-deadline/tier";
import type { CompanyAnnouncementRow, ContactBest, ContactCompanyRow, SortOrder } from "../../serve/policy-deadline/types";
import ContactsBoard, { contactsListKey, type ContactsBoardProps } from "./ContactsBoard";
import { DeadlineToast } from "./DeadlineBits";
import { CompanyAnnouncementsPanel, ContactAnnouncementTable } from "./DeadlineTables";
import { rebuildContactRow } from "./deadline-view";
import { DEADLINE_DISMISS_ENDPOINT, DEADLINE_ENDPOINTS, type DeadlineEndpoints } from "./endpoints";

/** 「해당 없음」 통로를 켠 앱의 통로 — 기본 상수에는 dismiss 가 없다. */
const WITH_DISMISS: DeadlineEndpoints = { ...DEADLINE_ENDPOINTS, dismiss: DEADLINE_DISMISS_ENDPOINT };
import { DEFAULT_TIERS, sortAnnouncementLines } from "./tier-view";
import { buttonsWith, byTag, cellOf, find, findAll, headsOf, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast, ChevronLeft, ChevronRight];
const fetchMock = vi.fn();
const never = () => new Promise<Response>(() => {});
let mounted: ReturnType<typeof mountTree> | null = null;
const NOW = new Date("2026-11-14T03:00:00.000Z"); // 서울 2026-11-14 낮 12시(토)
const DISMISSED_AT = "2026-11-22T03:00:00.000Z";

const item = (over: Partial<CheckItem> & Pick<CheckItem, "what" | "group">): CheckItem => ({ label: over.what, rank: 50, where: "", ...over });
const TAX = item({ what: "체납", group: "company", rank: 7, field: "taxArrears", where: "기업상태표 「체납」", current: "모름" });
const EXPORT = item({ what: "수출 실적", group: "notice", rank: 20, where: "공고 원문", evidence: "수출 실적이 있는 중소기업" });

const line = (bucketKey: string, title: string, over: Partial<CompanyAnnouncementRow> = {}): CompanyAnnouncementRow => ({
  bucketKey, repAnnouncementId: `a-${bucketKey}`, title, agency: "기관", category: "정책자금", url: `https://example.invalid/${bucketKey}`,
  applyEnd: "2026-11-20", dDay: 6, verdict: "fit", fitLabels: [], toCheck: [], gaps: [], progress: null, amountMaxWon: null, dismissed: null,
  tier: "high", tierScore: 100, tierReason: "조건 6개 모두 맞음", checkItems: [], checkCount: 0, nextAction: "고객에게 연락해 신청 안내", unstructured: false,
  ...over,
});
const MID: Partial<CompanyAnnouncementRow> = {
  verdict: "unverified", toCheck: ["체납 여부 입력", "수출 실적 확인"], tier: "mid", tierScore: 77, tierReason: "조건 6개 중 4개 맞음 · 체납 확인", checkItems: [TAX, EXPORT], checkCount: 2, nextAction: "체납 확인 후 연락",
};
const LOW: Partial<CompanyAnnouncementRow> = {
  verdict: "unverified", toCheck: ["수출 실적 확인"], tier: "low", tierScore: 40, tierReason: "조건 6개 중 2개 맞음", checkItems: [EXPORT], checkCount: 1, nextAction: "공고 원문에서 자격 먼저 확인",
};
const FLAT: Partial<CompanyAnnouncementRow> = {
  verdict: "unverified", toCheck: ["공고 원문 확인(조건 정리 전)"], tier: "low", tierScore: 0, tierReason: "공고 조건을 아직 정리하지 않음", nextAction: "공고 조건 정리 대기", unstructured: true,
};

const GA = line("g1", "공고 가", { amountMaxWon: 300_000_000, applyEnd: "2026-11-17", dDay: 3 });
const B1 = line("b1", "공고 하나", { ...MID, amountMaxWon: 300_000_000, applyEnd: "2026-11-20", dDay: 6 });
const B5 = line("b5", "공고 다섯", { ...MID, applyEnd: "2026-11-23", dDay: 9 });
const B2 = line("b2", "공고 둘", { ...LOW, category: "무상지원금", applyEnd: "2026-11-16", dDay: 2 });
const B3 = line("b3", "공고 셋", { ...FLAT, applyEnd: "2026-11-25", dDay: 11 });
const B4 = line("b4", "공고 넷", { applyEnd: "2026-11-18", dDay: 4, dismissed: { reason: "이미 신청함", byName: "김컨설", at: "2026-11-21T01:00:00.000Z" } });
const MA = line("m1", "공고 마", { ...LOW, applyEnd: "2026-11-19", dDay: 5 });
const SA = line("s1", "공고 사", { ...FLAT, applyEnd: "2026-11-21", dDay: 7 });

/** 서버가 가진 업체 하나 — lines 는 해당 없음이 아닌 줄, order 는 view=company 가 순서마다 주는 공고 열쇠 순. */
interface Seed {
  customerKey: string;
  companyName: string;
  lines: CompanyAnnouncementRow[];
  dismissed: CompanyAnnouncementRow[];
  order?: Record<SortOrder, string[]>;
}
const GANA: Seed = { customerKey: "cA", companyName: "가나상사", lines: [GA], dismissed: [] };
const DARA: Seed = {
  customerKey: "cB", companyName: "다라상사", lines: [B1, B5, B2, B3], dismissed: [B4],
  order: { tier: ["b1", "b5", "b2", "b3"], deadline: ["b2", "b1", "b5", "b3"] },
};
const MABA: Seed = { customerKey: "cC", companyName: "마바상사", lines: [MA], dismissed: [] };
const SAA: Seed = { customerKey: "cD", companyName: "사아상사", lines: [SA], dismissed: [] };
// 일부러 섞어 둔다 — 줄 순서는 보드가 세운다.
const ALL: readonly Seed[] = [SAA, MABA, DARA, GANA];
const NAMES = ["가나상사", "다라상사", "마바상사", "사아상사"];

const BLANK_BEST: ContactBest = {
  bucketKey: "", title: "", category: "", url: "", applyEnd: "", dDay: 0, amountMaxWon: null,
  tier: "low", tierScore: 0, tierReason: "", checkItems: [], checkCount: 0, nextAction: "", unstructured: false,
};
/** 「판단 전 포함」이 꺼지면 서버는 판단 전 줄을 싣지 않는다. */
const linesOf = (seed: Seed, include: boolean) => seed.lines.filter((l) => include || !l.unstructured);
/** 서버의 업체 줄 — 남은 공고로 센 값(셈은 화면의 rebuildContactRow 와 같다). 남은 공고가 없으면 목록에 없다. */
function contactOf(seed: Seed, include: boolean): ContactCompanyRow | null {
  const base: ContactCompanyRow = {
    customerKey: seed.customerKey, companyName: seed.companyName, consultant: "김컨설", consultantNames: ["김컨설"], statusText: "",
    nearestApplyEnd: "", nearestDDay: 0, kinds: [], announcementCount: 0, progressCount: 0,
    bestTier: "low", tiers: { high: 0, mid: 0, low: 0, unstructured: 0 }, best: BLANK_BEST,
  };
  return rebuildContactRow(base, linesOf(seed, include));
}
const PROGRESS = {
  created: true, trackCreated: true, trackId: "t1", policyName: "공고 하나", companyName: "다라상사", todo: "신청 마감", due: "2026-11-20",
  progress: { byName: "김컨설", via: "web", at: "2026-11-14T00:00:00.000Z" },
};

function serve(seeds: readonly Seed[] = ALL, dismissStatus = 200) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/deadline/dismiss") && init?.method === "POST") {
      if (dismissStatus !== 200) {
        return Promise.resolve(jsonResponse({ success: false, error: { code: "FORBIDDEN", message: "이 업체의 담당자만 남길 수 있습니다." } }, dismissStatus));
      }
      const { reason } = JSON.parse(String(init.body)) as { reason: string | null };
      return Promise.resolve(jsonResponse({ success: true, data: { dismissed: reason ? { reason, byName: "김컨설", at: DISMISSED_AT } : null } }));
    }
    if (url.endsWith("/deadline/progress") && init?.method === "POST") return Promise.resolve(jsonResponse({ success: true, data: PROGRESS }));
    const params = new URL(url, "http://localhost").searchParams;
    const include = params.get("includeUnstructured") === "1";
    if (params.get("view") === "contacts") {
      const companies = seeds.map((s) => contactOf(s, include)).filter((c): c is ContactCompanyRow => c !== null);
      return Promise.resolve(jsonResponse({ success: true, data: { companies } }));
    }
    if (params.get("view") === "company") {
      const seed = seeds.find((s) => s.customerKey === params.get("customerKey"));
      if (!seed) return Promise.resolve(jsonResponse({ success: false, error: { code: "NOT_FOUND", message: "업체를 찾지 못했습니다." } }, 404));
      const sort: SortOrder = params.get("sort") === "deadline" ? "deadline" : "tier";
      const lines = linesOf(seed, include);
      const order = seed.order?.[sort];
      const announcements = order ? order.flatMap((key) => lines.filter((l) => l.bucketKey === key)) : lines;
      return Promise.resolve(
        jsonResponse({ success: true, data: { company: { customerKey: seed.customerKey, companyName: seed.companyName }, announcements, dismissed: seed.dismissed } }),
      );
    }
    return never();
  });
}

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const flat = (node: HostNode | string | ReadonlyArray<HostNode | string>) => textOf(node).replace(/\s+/g, " ").trim();
/** 목록 카드(또는 빈 카드) — aria-busy 를 가진 첫 요소. */
const card = () => findAll(root(), (n) => "aria-busy" in n.props)[0];
const tables = () => byTag(root(), "table");
/** 표의 공고 이름 — 줄마다 첫 링크(펼친 확인 항목 줄은 링크가 없어 빠진다). */
const titlesOf = (t: HostNode) => byTag(byTag(t, "tbody")[0], "tr").flatMap((tr) => byTag(tr, "a").slice(0, 1)).map((a) => flat(a));
const companyButton = (name: string) => byTag(root(), "button").find((b) => "aria-expanded" in b.props && flat(b).includes(name));
/** 목록 카드에 보이는 업체 이름 — 위에서 아래 순. */
const companyOrder = () => {
  const text = flat(card() ?? []);
  return NAMES.filter((n) => text.includes(n)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
};
const rowOf = (text: string) => byTag(root(), "tbody").flatMap((body) => byTag(body, "tr")).find((tr) => flat(tr).includes(text));
const groupOf = (label: string, within: HostNode = root()) => find(within, (n) => n.props.role === "group" && n.props["aria-label"] === label);
const filters = () => groupOf("거르기");
const tierButtons = () => byTag(groupOf("맞을 확률") ?? root(), "button");
const tierButton = (label: string) => tierButtons().find((b) => flat(b).includes(label));
const sortButton = (label: string) => buttonsWith(groupOf("순서") ?? root(), label)[0];
const foldButton = (start: string, within: HostNode = root()) => byTag(within, "button").find((b) => flat(b).startsWith(start));
const checkbox = (label: string) => find(root(), (n) => n.tag === "Checkbox" && n.props.label === label);
const toggle = (label: string, checked: boolean) => () =>
  (checkbox(label)?.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked } });
const callsTo = (part: string) => fetchMock.mock.calls.filter(([input]) => String(input).includes(part));
const lastUrl = (part: string) => String(callsTo(part).at(-1)?.[0] ?? "");
const paramsOf = (url: string) => new URL(url, "http://localhost").searchParams;
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
const toast = () => find(root(), (n) => n.tag === "DeadlineToast");
const notice = () => toast()?.props.notice as { tone: string; text: string } | null | undefined;

async function draw(props: Partial<ContactsBoardProps> = {}, seeds: readonly Seed[] = ALL, dismissStatus = 200) {
  serve(seeds, dismissStatus);
  const onDetail = vi.fn();
  const onProgressed = vi.fn();
  mounted?.unmount();
  mounted = mountTree(
    <ContactsBoard scope="all" onDetail={onDetail} onProgressed={onProgressed} endpoints={WITH_DISMISS} now={NOW} {...props} />,
    { opaque: OPAQUE },
  );
  await mounted.settle();
  return { onDetail, onProgressed };
}
const openCompany = async (name = "다라상사") => mounted?.click(companyButton(name));
const includeFlat = async () => mounted?.act(toggle("판단 전 포함", true));

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

describe("연락 예정 업체 목록 — 맞을 확률 순(NO.789)", () => {
  it("처음엔 맞을 확률 순·높음/보통·14일로 읽고, 낮음은 카드 아래에 숨겼다고 알린다", async () => {
    await draw();
    const params = paramsOf(lastUrl("view=contacts"));
    expect([params.get("sort"), params.get("includeUnstructured"), params.get("days")]).toEqual(["tier", "0", "14"]);
    expect(companyOrder()).toEqual(["가나상사", "다라상사"]);
    expect(flat(card() ?? [])).not.toContain("숨겼습니다");
    expect(flat(root())).toContain("고르지 않은 단계의 업체 1곳은 숨겼습니다");
    expect(foldButton("판단 전 업체")).toBeUndefined();
  });

  it("「판단 전 포함」을 켜면 판단 전 업체가 카드 안 끝 접힌 묶음으로 오고, 펼치면 「판단 전」 딱지다", async () => {
    await draw();
    await includeFlat();
    expect(paramsOf(lastUrl("view=contacts")).get("includeUnstructured")).toBe("1");
    const fold = foldButton("판단 전 업체 1곳 · 공고 조건을 정리하면 맞을 확률이 나옵니다", card());
    expect(fold?.props["aria-expanded"]).toBe(false);
    expect(flat(card() ?? [])).not.toContain("사아상사");
    await mounted?.click(fold);
    expect(companyOrder()).toEqual(["가나상사", "다라상사", "사아상사"]);
    expect(flat(companyButton("사아상사") ?? [])).toContain("맞을 확률 판단 전");
  });

  it("거르기 줄 — 「맞을 확률」 이름과 단계 단추(숫자), 순서 단추, 「판단 전 포함」", async () => {
    await draw();
    const row = filters() ?? root();
    expect(find(row, (n) => n.tag === "span" && n.props.role === undefined && flat(n) === "맞을 확률")?.tag).toBe("span");
    expect(tierButtons().map((b) => flat(b))).toEqual(["● 높음 1곳", "◐ 보통 1곳", "○ 낮음 1곳"]);
    expect(tierButtons().map((b) => b.props["aria-pressed"])).toEqual([true, true, false]);
    expect(sortButton("맞을 확률 순")?.props["aria-pressed"]).toBe(true);
    expect(sortButton("마감 순")?.props["aria-pressed"]).toBe(false);
    expect(checkbox("판단 전 포함")?.props.checked).toBe(false);
    expect(checkbox("조건 정리 전 포함")).toBeUndefined();
  });

  it("접은 업체 줄 — 가장 좋은 공고 한 줄(딱지·이름·D-n·금액)과 근거 한 줄, 줄 안에 단추가 없다", async () => {
    await draw();
    const gana = companyButton("가나상사");
    expect(flat(gana ?? [])).toContain("맞을 확률 높음");
    expect(flat(gana ?? [])).toContain("공고 가");
    expect(flat(gana ?? [])).toContain("최대 3억원");
    expect(find(gana ?? root(), (n) => n.tag === "span" && flat(n) === "조건 6개 모두 맞음 · 고객에게 연락해 신청 안내 · 확인할 것 없음")?.tag).toBe("span");
    const dara = companyButton("다라상사");
    expect(flat(dara ?? [])).toContain("맞을 확률 보통");
    expect(flat(dara ?? [])).toContain("공고 하나");
    expect(flat(dara ?? [])).toContain("D-6");
    expect(flat(dara ?? [])).toContain("D-2");
    expect(find(dara ?? root(), (n) => n.tag === "span" && flat(n) === "조건 6개 중 4개 맞음 · 체납 확인 · 체납 확인 후 연락 · 확인할 것 2개 · 체납")?.tag).toBe("span");
    for (const b of [gana, dara]) expect(byTag(b ?? root(), "button")).toHaveLength(1);
    expect(flat(root())).toContain("담당 김컨설");
  });

  it("단계 단추를 바꾸면 화면 안에서만 거른다 — 다시 읽지 않는다", async () => {
    await draw();
    await mounted?.click(tierButton("낮음"));
    expect(companyOrder()).toEqual(["가나상사", "다라상사", "마바상사"]);
    expect(flat(root())).not.toContain("숨겼습니다");
    await mounted?.click(tierButton("높음"));
    expect(companyOrder()).toEqual(["다라상사", "마바상사"]);
    expect(flat(root())).toContain("고르지 않은 단계의 업체 1곳은 숨겼습니다");
    expect(callsTo("view=contacts")).toHaveLength(1);
  });

  it("「마감 순」은 목록과 펼친 업체를 sort=deadline 으로 다시 읽고, 줄을 가까운 마감 순으로 놓는다", async () => {
    await draw();
    await openCompany();
    expect(paramsOf(lastUrl("view=company")).get("sort")).toBe("tier");
    await mounted?.click(sortButton("마감 순"));
    expect(paramsOf(lastUrl("view=contacts")).get("sort")).toBe("deadline");
    expect(paramsOf(lastUrl("view=company")).get("sort")).toBe("deadline");
    expect(companyOrder()).toEqual(["다라상사", "가나상사"]);
    await mounted?.click(tierButton("낮음"));
    expect(titlesOf(tables()[0])).toEqual(["공고 둘", "공고 하나", "공고 다섯"]);
    await mounted?.click(sortButton("맞을 확률 순"));
    expect(paramsOf(lastUrl("view=company")).get("sort")).toBe("tier");
    expect(titlesOf(tables()[0])).toEqual(["공고 하나", "공고 다섯", "공고 둘"]);
  });

  it("목록 열쇠는 순서까지 담는다(앞 다섯 값 글자는 그대로)", () => {
    expect(contactsListKey("all", 14, false, false, 0)).toBe("all|14|false|false|0|tier");
    expect(contactsListKey(undefined, 7, true, true, 2, "deadline")).toBe("-|7|true|true|2|deadline");
    expect(contactsListKey("all", 14, false, false, 0, "deadline")).not.toBe(contactsListKey("all", 14, false, false, 0));
  });

  it("종류로 거르면 그 종류 안 가장 좋은 공고로 줄을 세우고, 다 숨으면 단계를 더 고르라고 알린다", async () => {
    await draw();
    await mounted?.click(buttonsWith(groupOf("종류") ?? root(), "무상지원금")[0]);
    expect(flat(card() ?? [])).toContain("연락할 업체가 없습니다");
    expect(flat(card() ?? [])).toContain("고르지 않은 단계의 업체 1곳은 숨겼습니다 — 「맞을 확률」에서 단계를 더 골라 보세요.");
    await mounted?.click(tierButton("낮음"));
    const dara = companyButton("다라상사");
    expect(flat(dara ?? [])).toContain("맞을 확률 낮음");
    expect(flat(dara ?? [])).toContain("공고 둘");
    expect(flat(dara ?? [])).not.toContain("공고 하나");
  });

  it("업체가 없으면 빈 카드 — 「판단 전 포함」이 꺼졌으면 켜 보라고, 켰으면 종류를 바꿔 보라고", async () => {
    await draw({}, []);
    expect(flat(card() ?? [])).toContain("연락할 업체가 없습니다");
    expect(flat(card() ?? [])).toContain("마감 기간을 넓히거나 「판단 전 포함」을 켜 보세요.");
    await includeFlat();
    expect(flat(card() ?? [])).toContain("마감 기간을 넓히거나 종류를 바꿔 보세요.");
  });

  it("판단 전 업체만 있으면 빈 카드 없이 묶음이 처음부터 펼쳐져 있다", async () => {
    await draw({}, [SAA]);
    await includeFlat();
    expect(flat(root())).not.toContain("연락할 업체가 없습니다");
    expect(foldButton("판단 전 업체 1곳", card())?.props["aria-expanded"]).toBe(true);
    expect(flat(card() ?? [])).toContain("사아상사");
  });

  it("캘린더 — 순서 단추가 없고, 단계 거르기와 「판단 전 포함」을 그대로 따른다", async () => {
    await draw({ view: "calendar" });
    expect(buttonsWith(root(), "마감 순")).toHaveLength(0);
    expect(buttonsWith(root(), "맞을 확률 순")).toHaveLength(0);
    expect(flat(root())).toContain("가나상사");
    expect(flat(root())).not.toContain("마바상사");
    await mounted?.click(tierButton("낮음"));
    expect(flat(root())).toContain("마바상사");
    expect(flat(root())).not.toContain("사아상사");
    await includeFlat();
    expect(flat(root())).toContain("사아상사");
  });

  it("showConsultant 를 끄면 접은 줄에 담당을 그리지 않는다", async () => {
    await draw({ showConsultant: false });
    expect(flat(root())).toContain("가나상사");
    expect(flat(root())).not.toContain("담당 김컨설");
  });

  it("화면 글에 내부 용어가 나오지 않는다", async () => {
    await draw();
    await includeFlat();
    await mounted?.click(foldButton("판단 전 업체", card()));
    await openCompany();
    await mounted?.click(foldButton("판단 전 공고"));
    await mounted?.click(foldButton("해당 없음 공고"));
    expect(flat(root())).not.toMatch(/조건 정리 전|unverified|unstructured|tier/);
  });
});

describe("업체를 펼친 공고 표 — 맞을 확률 순 한 표(NO.789)", () => {
  it("표 하나에 고른 단계 공고, 낮음은 숨겼다고 알리고, 판단 전·해당 없음은 접힌 묶음이다", async () => {
    await draw();
    await includeFlat();
    await openCompany();
    expect(tables()).toHaveLength(1);
    expect(headsOf(tables()[0])).toEqual(["공고명", "마감", "맞을 확률", "다음 할 일", "확인할 것", "업무 현황"]);
    expect(titlesOf(tables()[0])).toEqual(["공고 하나", "공고 다섯"]);
    expect(flat(root())).toContain("고르지 않은 단계의 공고 1건은 숨겼습니다");
    expect(foldButton("판단 전 공고 1건 · 공고 조건을 정리하면 맞을 확률이 나옵니다")?.props["aria-expanded"]).toBe(false);
    expect(foldButton("해당 없음 공고 1건")?.props["aria-expanded"]).toBe(false);
    for (const title of ["공고 둘", "공고 셋", "공고 넷"]) expect(flat(root())).not.toContain(title);
  });

  it("칸마다 — 공고명 아래 종류·기관·지원 금액, 마감, 단계와 근거, 다음 할 일, 확인할 것 수와 첫 항목", async () => {
    await draw();
    await openCompany();
    const t = tables()[0];
    const cell = (title: string, head: string) => cellOf(t, title, head) ?? root();
    expect(flat(cell("공고 하나", "공고명"))).toContain("정책자금");
    expect(flat(cell("공고 하나", "공고명"))).toContain("기관");
    expect(flat(cell("공고 하나", "공고명"))).toContain("지원 금액 최대 3억원");
    expect(flat(cell("공고 다섯", "공고명"))).not.toContain("지원 금액");
    expect(find(cell("공고 하나", "공고명"), (n) => n.tag === "a")?.props).toMatchObject({
      href: "https://example.invalid/b1", target: "_blank", rel: "noopener noreferrer",
    });
    expect(flat(cell("공고 하나", "마감"))).toContain("D-6");
    expect(flat(cell("공고 하나", "마감"))).toContain("11/20(금)");
    expect(flat(cell("공고 하나", "맞을 확률"))).toContain("보통");
    expect(flat(cell("공고 하나", "맞을 확률"))).toContain("조건 6개 중 4개 맞음 · 체납 확인");
    expect(flat(cell("공고 하나", "다음 할 일"))).toBe("체납 확인 후 연락");
    expect(flat(cell("공고 하나", "확인할 것"))).toBe("확인할 것 2개 · 체납");
  });

  it("확인할 것을 펼치면 바로 아래 줄이 표 폭 전체 — 두 묶음·근거·지금 값, 업체 칸 이름을 누르면 상세창의 그 칸", async () => {
    const { onDetail } = await draw();
    await openCompany();
    const summary = buttonsWith(cellOf(tables()[0], "공고 하나", "확인할 것") ?? root(), "확인할 것 2개 · 체납")[0];
    expect(summary?.props["aria-expanded"]).toBe(false);
    await mounted?.click(summary);
    expect(buttonsWith(cellOf(tables()[0], "공고 하나", "확인할 것") ?? root(), "확인할 것 2개 · 체납")[0]?.props["aria-expanded"]).toBe(true);
    const sub = byTag(byTag(tables()[0], "tbody")[0], "tr")[1];
    expect(byTag(sub, "td")).toHaveLength(1);
    expect(byTag(sub, "td")[0].props.colSpan).toBe(6);
    for (const text of ["업체 정보에서 채울 것", "공고 원문에서 확인할 것", "수출 실적이 있는 중소기업", "지금 값: 모름"]) expect(flat(sub)).toContain(text);
    await mounted?.click(buttonsWith(sub, "체납")[0]);
    expect(onDetail.mock.calls.at(-1)).toEqual(["cB", "다라상사", undefined, "taxArrears"]);
  });

  it("「업체 상세 열기」는 칸 없이 그 업체 상세를 연다 — 상세를 열 수 없으면 그리지 않는다", async () => {
    const { onDetail } = await draw();
    await openCompany();
    await mounted?.click(buttonsWith(root(), "업체 상세 열기")[0]);
    expect(onDetail.mock.calls.at(-1)).toEqual(["cB", "다라상사"]);
    await draw({ onDetail: undefined });
    await openCompany();
    expect(buttonsWith(root(), "업체 상세 열기")).toHaveLength(0);
  });

  it("「해당 없음」 사유를 고르면 그 공고가 해당 없음 묶음으로 내려가고, 되돌리면 제자리로 돌아온다", async () => {
    const { onProgressed } = await draw();
    await openCompany();
    await mounted?.click(buttonsWith(rowOf("공고 하나") ?? root(), "해당 없음")[0]);
    await mounted?.click(buttonsWith(rowOf("공고 하나") ?? root(), "자격이 안 됨")[0]);
    expect(bodyOf(callsTo("/deadline/dismiss").at(-1))).toEqual({ customerKey: "cB", bucketKey: "b1", reason: "자격이 안 됨" });
    expect(titlesOf(tables()[0])).toEqual(["공고 다섯"]);
    expect(notice()?.tone).toBe("success");
    expect(notice()?.text).toBe("다라상사 · 「자격이 안 됨」 — 해당 없음으로 옮겼습니다");
    expect(onProgressed).toHaveBeenCalledTimes(1);
    expect(flat(companyButton("다라상사") ?? [])).toContain("공고 다섯");
    expect(flat(companyButton("다라상사") ?? [])).not.toContain("공고 하나");

    await mounted?.click(foldButton("해당 없음 공고 2건"));
    const folded = tables()[1];
    expect(titlesOf(folded)).toEqual(["공고 넷", "공고 하나"]);
    expect(flat(rowOf("공고 하나") ?? [])).toContain("해당 없음 · 자격이 안 됨 · 김컨설 · 11/22(일)");
    expect(flat(rowOf("공고 넷") ?? [])).toContain("해당 없음 · 이미 신청함 · 김컨설 · 11/21(토)");
    expect(buttonsWith(folded, "업무 현황에 추가")).toHaveLength(0);
    expect(buttonsWith(folded, "해당 없음")).toHaveLength(0);

    await mounted?.click(buttonsWith(rowOf("공고 하나") ?? root(), "되돌리기")[0]);
    expect(bodyOf(callsTo("/deadline/dismiss").at(-1))).toEqual({ customerKey: "cB", bucketKey: "b1", reason: null });
    expect(titlesOf(tables()[0])).toEqual(["공고 하나", "공고 다섯"]);
    expect(notice()?.text).toBe("다라상사 · 해당 없음을 되돌렸습니다");
    expect(foldButton("해당 없음 공고 1건")?.tag).toBe("button");
    expect(flat(companyButton("다라상사") ?? [])).toContain("공고 하나");
    expect(onProgressed).toHaveBeenCalledTimes(2);
  });

  it("「해당 없음」을 남기지 못하면 오류 알림만 — 줄은 그대로다", async () => {
    const { onProgressed } = await draw({}, ALL, 403);
    await openCompany();
    await mounted?.click(buttonsWith(rowOf("공고 하나") ?? root(), "해당 없음")[0]);
    await mounted?.click(buttonsWith(rowOf("공고 하나") ?? root(), "자격이 안 됨")[0]);
    expect(notice()).toEqual({ tone: "error", text: "이 업체의 담당자만 남길 수 있습니다." });
    expect(titlesOf(tables()[0])).toEqual(["공고 하나", "공고 다섯"]);
    expect(onProgressed).not.toHaveBeenCalled();
  });

  it("업무 현황 권한이 없거나 통로가 없으면 「해당 없음」·「되돌리기」를 그리지 않고 기록만 보인다", async () => {
    await draw({ canProgress: false });
    await openCompany();
    expect(buttonsWith(root(), "해당 없음")).toHaveLength(0);
    expect(buttonsWith(root(), "업무 현황에 추가")).toHaveLength(0);
    await mounted?.click(foldButton("해당 없음 공고 1건"));
    expect(flat(root())).toContain("해당 없음 · 이미 신청함 · 김컨설 · 11/21(토)");
    expect(buttonsWith(root(), "되돌리기")).toHaveLength(0);

    expect(DEADLINE_ENDPOINTS.dismiss).toBeUndefined();
    await draw({ endpoints: DEADLINE_ENDPOINTS });
    await openCompany();
    expect(buttonsWith(root(), "업무 현황에 추가")).toHaveLength(2);
    expect(buttonsWith(root(), "해당 없음")).toHaveLength(0);
    await mounted?.click(foldButton("해당 없음 공고 1건"));
    expect(buttonsWith(root(), "되돌리기")).toHaveLength(0);
  });

  it("「업무 현황에 추가」하면 그 공고만 빠지고 해당 없음 묶음은 그대로, 알림의 「업무 현황 보기」가 업무 번호까지 넘긴다", async () => {
    const { onDetail } = await draw();
    await openCompany();
    await mounted?.click(buttonsWith(rowOf("공고 하나") ?? root(), "업무 현황에 추가")[0]);
    expect(bodyOf(callsTo("/deadline/progress").at(-1))).toEqual({ customerKey: "cB", bucketKey: "b1" });
    expect(titlesOf(tables()[0])).toEqual(["공고 다섯"]);
    expect(foldButton("해당 없음 공고 1건")?.tag).toBe("button");
    expect(notice()?.text).toContain("컨설팅 업무 현황에 「공고 하나」 추가");
    const open = toast()?.props.onOpen as ((customerKey: string, companyName: string, trackId?: string) => void) | undefined;
    await mounted?.act(() => open?.("cB", "다라상사", "t1"));
    expect(onDetail.mock.calls.at(-1)).toEqual(["cB", "다라상사", "t1"]);
  });

  it("「진행 중 포함」이 켜져 있으면 추가한 공고가 남고 다음 할 일이 「업무 현황에서 진행 중」으로 바뀐다", async () => {
    await draw();
    await mounted?.act(toggle("진행 중 포함", true));
    await openCompany();
    expect(flat(rowOf("공고 하나") ?? [])).toContain("체납 확인 후 연락");
    await mounted?.click(buttonsWith(rowOf("공고 하나") ?? root(), "업무 현황에 추가")[0]);
    expect(titlesOf(tables()[0])).toEqual(["공고 하나", "공고 다섯"]);
    expect(flat(rowOf("공고 하나") ?? [])).toContain("업무 현황에서 진행 중");
    expect(flat(rowOf("공고 하나") ?? [])).not.toContain("체납 확인 후 연락");
  });

  it("되돌린 공고가 지금 거르기(진행 중 포함 꺼짐)에 맞지 않으면 표에 다시 넣지 않는다", async () => {
    const progressed = line("b6", "공고 여섯", {
      ...MID,
      progress: { trackId: "t9", byName: "김컨설", via: "web", at: "2026-11-13T00:00:00.000Z" },
      dismissed: { reason: "기타", byName: "김컨설", at: "2026-11-21T01:00:00.000Z" },
    });
    await draw({}, [{ customerKey: "cB", companyName: "다라상사", lines: [B1], dismissed: [progressed] }]);
    await openCompany();
    await mounted?.click(foldButton("해당 없음 공고 1건"));
    await mounted?.click(buttonsWith(rowOf("공고 여섯") ?? root(), "되돌리기")[0]);
    expect(bodyOf(callsTo("/deadline/dismiss").at(-1))).toEqual({ customerKey: "cB", bucketKey: "b6", reason: null });
    expect(titlesOf(tables()[0])).toEqual(["공고 하나"]);
    expect(foldButton("해당 없음 공고")).toBeUndefined();
    expect(flat(root())).not.toContain("공고 여섯");
    expect(notice()?.text).toBe("다라상사 · 해당 없음을 되돌렸습니다");
  });

  it("되돌린 공고가 판단 전(확인할 것이 모두 뭉뚱그린 문구)이면 「판단 전 포함」이 꺼진 동안 표에 넣지 않고, 다른 확인이 섞인 조건 정리 전 줄은 맨 뒤 접힌 묶음에 남긴다", async () => {
    const was = { reason: "기타", byName: "김컨설", at: "2026-11-21T01:00:00.000Z" } as const;
    const flatOnly = line("b7", "공고 일곱", { ...FLAT, dismissed: was });
    const mixed = line("b8", "공고 여덟", { ...FLAT, toCheck: ["체납 여부 입력", "공고 원문 확인(조건 정리 전)"], dismissed: was });
    await draw({}, [{ customerKey: "cB", companyName: "다라상사", lines: [B1], dismissed: [flatOnly, mixed] }]);
    await openCompany();
    await mounted?.click(foldButton("해당 없음 공고 2건"));
    await mounted?.click(buttonsWith(rowOf("공고 일곱") ?? root(), "되돌리기")[0]);
    expect(bodyOf(callsTo("/deadline/dismiss").at(-1))).toEqual({ customerKey: "cB", bucketKey: "b7", reason: null });
    expect(flat(root())).not.toContain("공고 일곱");
    await mounted?.click(buttonsWith(rowOf("공고 여덟") ?? root(), "되돌리기")[0]);
    expect(bodyOf(callsTo("/deadline/dismiss").at(-1))).toEqual({ customerKey: "cB", bucketKey: "b8", reason: null });
    expect(foldButton("해당 없음 공고")).toBeUndefined();
    expect(flat(root())).not.toContain("공고 여덟");
    await mounted?.click(foldButton("판단 전 공고 1건"));
    expect(flat(root())).toContain("공고 여덟");
  });

  it("판단 전 공고만 있는 업체는 그 묶음이 처음부터 펼쳐져 있다", async () => {
    await draw({}, [SAA]);
    await includeFlat();
    await openCompany("사아상사");
    expect(foldButton("판단 전 공고 1건")?.props["aria-expanded"]).toBe(true);
    expect(flat(cellOf(tables()[0], "공고 사", "맞을 확률") ?? [])).toContain("판단 전");
    expect(flat(root())).not.toContain("맞는 공고가 없습니다");
  });
});

describe("CompanyAnnouncementsPanel · ContactAnnouncementTable — 부품만", () => {
  const panel = (rows: CompanyAnnouncementRow[], dismissed: CompanyAnnouncementRow[] = []) =>
    mountTree(
      <CompanyAnnouncementsPanel
        state={{ status: "ok", rows, dismissed }}
        kind=""
        customerKey="cB"
        busyKey=""
        tiers={DEFAULT_TIERS}
        onProgress={() => {}}
        onRetry={() => {}}
      />,
      { opaque: OPAQUE },
    ).tree;

  it("공고도 해당 없음도 없을 때만 「맞는 공고가 없습니다」", () => {
    expect(flat(panel([]))).toContain("지금 거르기 조건에서 맞는 공고가 없습니다.");
    const hiddenOnly = panel([B2]);
    expect(byTag(hiddenOnly, "table")).toHaveLength(0);
    expect(flat(hiddenOnly)).toContain("고르지 않은 단계의 공고 1건은 숨겼습니다");
    expect(flat(hiddenOnly)).not.toContain("맞는 공고가 없습니다");
    const dismissedOnly = panel([], [B4]);
    expect(flat(dismissedOnly)).toContain("해당 없음 공고 1건");
    expect(flat(dismissedOnly)).not.toContain("맞는 공고가 없습니다");
  });

  it("해당 없음 통로(onDismiss)가 없으면 단추 없이 — 안 넣은 공고는 「업무 현황에 추가」, 해당 없음 공고는 기록만", () => {
    const t = byTag(mountTree(<ContactAnnouncementTable rows={[B1, B4]} customerKey="cB" busyKey="" onProgress={() => {}} />).tree, "table")[0];
    const lineOf = (title: string) => byTag(byTag(t, "tbody")[0], "tr").find((tr) => flat(tr).includes(title)) ?? t;
    expect(buttonsWith(t, "해당 없음")).toHaveLength(0);
    expect(buttonsWith(lineOf("공고 하나"), "업무 현황에 추가")).toHaveLength(1);
    expect(buttonsWith(lineOf("공고 넷"), "업무 현황에 추가")).toHaveLength(0);
    expect(flat(lineOf("공고 넷"))).toContain("해당 없음 · 이미 신청함 · 김컨설");
    expect(buttonsWith(lineOf("공고 넷"), "되돌리기")).toHaveLength(0);
  });

  it("바쁜 줄의 「해당 없음」은 눌리지 않고, 확인할 것이 없는 줄은 글만, 이름 없는 공고는 링크 없이", () => {
    const busy = byTag(
      mountTree(<ContactAnnouncementTable rows={[B1, B5]} customerKey="cB" busyKey="cB|b1" onProgress={() => {}} onDismiss={() => {}} />).tree,
      "table",
    )[0];
    const lineOf = (title: string) => byTag(byTag(busy, "tbody")[0], "tr").find((tr) => flat(tr).includes(title)) ?? busy;
    expect(buttonsWith(lineOf("공고 하나"), "해당 없음")[0]?.props.disabled).toBe(true);
    expect(buttonsWith(lineOf("공고 다섯"), "해당 없음")[0]?.props.disabled).toBe(false);

    const plain = byTag(mountTree(<ContactAnnouncementTable rows={[GA, line("n1", "", { url: "" })]} customerKey="cA" busyKey="" onProgress={() => {}} />).tree, "table")[0];
    const check = cellOf(plain, "공고 가", "확인할 것") ?? plain;
    expect(flat(check)).toBe("확인할 것 없음");
    expect(byTag(check, "button")).toHaveLength(0);
    expect(flat(plain)).toContain("이름 없는 공고");
    expect(byTag(plain, "a").map((a) => a.props.href)).toEqual(["https://example.invalid/g1"]);
  });
});

describe("sortAnnouncementLines — 되돌린 공고의 제자리", () => {
  it("맞을 확률 순 — 높음 → 보통(확인 적은 순 → 마감 가까운 순) → 낮음 → 판단 전 → 해당 없음, 받은 배열은 그대로", () => {
    const input = [B3, B2, B5, GA, B1, B4];
    expect(sortAnnouncementLines(input, "tier").map((r) => r.bucketKey)).toEqual(["g1", "b1", "b5", "b2", "b3", "b4"]);
    expect(input.map((r) => r.bucketKey)).toEqual(["b3", "b2", "b5", "g1", "b1", "b4"]);
  });

  it("마감 순 — 마감 글자 순(마감 없음은 맨 앞), 같으면 공고 열쇠 순", () => {
    const rows = [B5, B1, line("a9", "공고 아홉"), B2, line("z1", "상시 공고", { applyEnd: null, dDay: null })];
    expect(sortAnnouncementLines(rows, "deadline").map((r) => r.bucketKey)).toEqual(["z1", "b2", "a9", "b1", "b5"]);
  });
});
