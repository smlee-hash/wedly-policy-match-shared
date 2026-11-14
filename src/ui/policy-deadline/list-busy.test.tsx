// 거르기를 바꾼 첫 화면부터 목록 카드가 aria-busy=true 여야 한다 — ERP `list-busy.test.tsx`(jsdom)를 test-kit 으로 옮긴 것이다.
// 「불러오는 중」을 효과 안에서 켜면 그 효과의 갱신이 다음 일감으로 밀려, 그 사이 화면이 옛 목록을 「다 불러옴」(aria-busy=false)으로 보인다.
// 운영 화면 검사에서 그 틈에 찍힌 캡처가 옛 목록이었다(2026-11-13). 그래서 누른 뒤 **첫 판만** 그려 본다(`clickFirstFrame`/`actFirstFrame`) —
// 효과가 켠 갱신은 아직 안 그린 상태다.
import { readFileSync } from "node:fs";
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import AnnouncementBoard, { announcementListKey } from "./AnnouncementBoard";
import ContactsBoard, { contactsListKey } from "./ContactsBoard";
import { DeadlineToast } from "./DeadlineBits";
import { DEADLINE_ENDPOINTS } from "./endpoints";
import { buttonsWith, byTag, find, findAll, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast];
const fetchMock = vi.fn();
const never = () => new Promise<Response>(() => {});
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

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
/** 목록 카드(거르기 줄 다음)의 aria-busy — 값이 없으면 null. */
const busyOfList = (): boolean | null => {
  const holder = findAll(root(), (n) => "aria-busy" in n.props)[0];
  return holder ? Boolean(holder.props["aria-busy"]) : null;
};
const checkbox = (label: string) => find(root(), (n) => n.tag === "Checkbox" && n.props.label === label);
const toggle = (label: string, checked: boolean) => () => (checkbox(label)?.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked } });
const segButton = (group: string, text: string) => {
  const holder = find(root(), (n) => n.tag === "span" && n.props["aria-label"] === group);
  return holder ? buttonsWith(holder, text)[0] : undefined;
};

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

describe("거르기를 바꾼 첫 화면의 바쁨 표시", () => {
  it("연락 예정 업체: 「조건 정리 전 포함」을 켠 첫 화면부터 aria-busy=true, 새 답이 오면 false", async () => {
    const gate: { release: ((r: Response) => void) | null } = { release: null };
    fetchMock.mockImplementation((input: string) => {
      const url = String(input);
      if (url.includes("view=contacts") && url.includes("includeUnstructured=1")) return new Promise<Response>((r) => { gate.release = r; });
      if (url.includes("view=contacts")) return Promise.resolve(jsonResponse({ success: true, data: { companies: [company] } }));
      return never();
    });
    mounted = mountTree(<ContactsBoard scope="all" onDetail={() => {}} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    expect(busyOfList()).toBe(false);

    await mounted.actFirstFrame(toggle("조건 정리 전 포함", true));
    expect(checkbox("조건 정리 전 포함")?.props.checked).toBe(true);
    expect(busyOfList()).toBe(true);

    await mounted.settle();
    expect(busyOfList()).toBe(true);
    await mounted.act(() => gate.release?.(jsonResponse({ success: true, data: { companies: [company] } })));
    expect(busyOfList()).toBe(false);
  });

  it("정책별 고객사: 마감 「7일」을 누른 첫 화면부터 aria-busy=true, 새 답이 오면 false", async () => {
    const gate: { release: ((r: Response) => void) | null } = { release: null };
    fetchMock.mockImplementation((input: string) => {
      const url = String(input);
      if (url.includes("view=list") && url.includes("days=7")) return new Promise<Response>((r) => { gate.release = r; });
      if (url.includes("view=list")) return Promise.resolve(jsonResponse({ success: true, data: list }));
      return never();
    });
    mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} onDetail={() => {}} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    expect(busyOfList()).toBe(false);

    await mounted.clickFirstFrame(segButton("마감", "7일"));
    expect(segButton("마감", "7일")?.props["aria-pressed"]).toBe(true);
    expect(busyOfList()).toBe(true);

    await mounted.act(() => gate.release?.(jsonResponse({ success: true, data: list })));
    expect(busyOfList()).toBe(false);
  });

  it("정책별 고객사: 다시 읽기가 실패해 옛 목록과 오류를 함께 보이면 바쁨을 끈다", async () => {
    fetchMock.mockImplementation((input: string) => {
      const url = String(input);
      if (url.includes("view=list") && url.includes("days=7")) {
        return Promise.resolve(jsonResponse({ success: false, error: { message: "읽기 실패" } }, 500));
      }
      if (url.includes("view=list")) return Promise.resolve(jsonResponse({ success: true, data: list }));
      return never();
    });
    mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} onDetail={() => {}} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
    await mounted.settle();
    await mounted.click(segButton("마감", "7일"));
    const alert = byTag(root(), "p").find((p) => p.props.role === "alert");
    expect(alert ? textOf(alert) : "").toContain("읽기 실패");
    expect(busyOfList()).toBe(false);
  });
});

describe("바쁨은 그릴 때 셈한다 — 효과가 켜는 상태 변수가 없다", () => {
  it("목록 열쇠는 거르기 값 하나만 달라도 달라진다(그래서 거르기를 바꾼 첫 그림이 곧 「불러오는 중」이다)", () => {
    const base = announcementListKey("all", 14, true, 0);
    expect([announcementListKey("mine", 14, true, 0), announcementListKey("all", 7, true, 0), announcementListKey("all", 14, false, 0), announcementListKey("all", 14, true, 1), announcementListKey(undefined, 14, true, 0)]).not.toContain(base);
    const contacts = contactsListKey("all", 14, false, false, 0);
    expect([contactsListKey("mine", 14, false, false, 0), contactsListKey("all", 7, false, false, 0), contactsListKey("all", 14, true, false, 0), contactsListKey("all", 14, false, true, 0), contactsListKey("all", 14, false, false, 1)]).not.toContain(contacts);
  });

  it("보드 글에 setLoading 같은 「불러오는 중」 상태 변수가 없다", () => {
    for (const file of ["AnnouncementBoard.tsx", "ContactsBoard.tsx"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/setLoading\b/);
      expect(source, file).toMatch(/const loading = settledKey !== listKey;/);
    }
  });
});
