// 정책별 고객사 공고 줄의 업체 수 — 「맞음 N곳」「확인 필요 M곳」 두 딱지 대신 「대상 기업 N곳」 하나로 보인다.
// 대표 요청(2026-11-16): 「맞음 0곳 확인 필요 15곳으로 되있는거 그냥 대상 기업 15곳 이렇게 표시되게」.
// 수는 그 공고를 펼치면 나오는 업체 수(맞음 + 확인 필요)다. 「맞음만」을 켜면 펼친 표도 맞음만 보이므로 맞음 수만 센다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import AnnouncementBoard from "./AnnouncementBoard";
import { DeadlineToast } from "./DeadlineBits";
import { DEADLINE_ENDPOINTS } from "./endpoints";
import { buttonsWith, find, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast];
const fetchMock = vi.fn();
const never = () => new Promise<Response>(() => {});
let mounted: ReturnType<typeof mountTree> | null = null;

const bucketOf = (bucketKey: string, title: string, fit: number, unverified: number) => ({
  bucketKey, repAnnouncementId: bucketKey, title, agency: "기관", category: "정책자금", url: "",
  applyEnd: "2026-11-20", dDay: 4, fit, unverified,
  tiers: { high: fit, mid: unverified, low: 0 }, unstructured: 0, bestTier: fit > 0 ? "high" : unverified > 0 ? "mid" : null, summary: "",
});
const list = {
  lastRun: null, companyCount: 20, bucketCount: 3, categories: ["정책자금"],
  dated: [bucketOf("b1", "확인만 있는 공고", 0, 15), bucketOf("b2", "섞인 공고", 2, 3), bucketOf("b3", "빈 공고", 0, 0)],
  always: [],
};

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const rowText = (title: string) => textOf(buttonsWith(root(), new RegExp(title))[0] ?? []);
const checkbox = (label: string) => find(root(), (n) => n.tag === "Checkbox" && n.props.label === label);
const toggle = (label: string, checked: boolean) => () =>
  (checkbox(label)?.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubBrowser();
  fetchMock.mockImplementation((input: string) =>
    String(input).includes("view=list") ? Promise.resolve(jsonResponse({ success: true, data: list })) : never(),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

async function draw() {
  mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
  await mounted.settle();
  // 「0곳 숨기기」는 기본으로 켜져 있다 — 빈 공고 줄까지 보려고 끈다.
  await mounted.act(toggle("0곳 숨기기", false));
}

describe("정책별 고객사 — 공고 줄 업체 수", () => {
  it("맞음 0곳·확인 필요 15곳인 공고는 「대상 기업 15곳」 하나로 보인다", async () => {
    await draw();
    const text = rowText("확인만 있는 공고");
    expect(text).toContain("대상 기업 15곳");
    expect(text).not.toMatch(/맞음 \d+곳/);
    expect(text).not.toMatch(/확인 필요 \d+곳/);
  });

  it("맞음과 확인 필요를 더한 수를 보인다", async () => {
    await draw();
    expect(rowText("섞인 공고")).toContain("대상 기업 5곳");
  });

  it("「맞음만」을 켜면 맞음 수만 센다", async () => {
    await draw();
    await mounted?.act(toggle("맞음만", true));
    expect(rowText("섞인 공고")).toContain("대상 기업 2곳");
    expect(rowText("확인만 있는 공고")).toContain("대상 기업 없음");
  });

  it("업체가 없는 공고는 「대상 기업 없음」으로 보인다", async () => {
    await draw();
    const text = rowText("빈 공고");
    expect(text).toContain("대상 기업 없음");
    expect(text).not.toContain("맞는 업체 없음");
  });
});
