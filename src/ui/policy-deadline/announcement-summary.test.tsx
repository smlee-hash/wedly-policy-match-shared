// 정책별 고객사 공고 줄의 「핵심 내용」 칸 — 공고마다 요약 한 줄, 요약 전이면 「아직 요약 전」, 넓은 화면 머리줄 네 글자.
// 요약 글은 서버가 공고 묶음의 summary 로 내려 준다(읽기 계산은 serve/policy-deadline/read.test.ts).
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import AnnouncementBoard from "./AnnouncementBoard";
import { DeadlineToast } from "./DeadlineBits";
import { DEADLINE_ENDPOINTS } from "./endpoints";
import { buttonsWith, findAll, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast];
const fetchMock = vi.fn();
const never = () => new Promise<Response>(() => {});
let mounted: ReturnType<typeof mountTree> | null = null;

const SUMMARY = "운전자금 최대 5억 원을 연 2% 대 금리로 빌려 줍니다";
const MD_GRID = "md:grid-cols-[64px_minmax(0,1.2fr)_minmax(0,1fr)_132px_20px]";

const bucketOf = (bucketKey: string, title: string, summary: string, applyEnd: string | null = "2026-11-20") => ({
  bucketKey, repAnnouncementId: bucketKey, title, agency: "기관", category: "정책자금", url: "",
  applyEnd, dDay: applyEnd ? 4 : null, fit: 1, unverified: 0, summary,
});
const datedList = {
  lastRun: null, companyCount: 3, bucketCount: 3, categories: ["정책자금"],
  dated: [bucketOf("b1", "요약 있는 공고", SUMMARY), bucketOf("b2", "요약 전 공고", "")],
  always: [bucketOf("b3", "상시 공고", "", null)],
};
const alwaysOnlyList = { ...datedList, bucketCount: 1, dated: [], always: [bucketOf("b3", "상시 공고", "", null)] };

const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const rowButton = (title: string) => {
  const button = buttonsWith(root(), new RegExp(title))[0];
  if (!button) throw new Error(`「${title}」 줄이 없습니다.`);
  return button;
};
const classOf = (node: HostNode | undefined) => String(node?.props.className ?? "");
/** aria-hidden 머리줄 — 「▶」 같은 장식 칸이 아니라 머리 글자가 든 것만. */
const headerRows = () => findAll(root(), (n) => n.props["aria-hidden"] === true && textOf(n).includes("핵심 내용"));

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

async function draw(list: unknown) {
  fetchMock.mockImplementation((input: string) =>
    String(input).includes("view=list") ? Promise.resolve(jsonResponse({ success: true, data: list })) : never(),
  );
  mounted = mountTree(<AnnouncementBoard scope="all" defaultDays={14} endpoints={DEADLINE_ENDPOINTS} />, { opaque: OPAQUE });
  await mounted.settle();
}

describe("정책별 고객사 — 공고 줄 핵심 내용", () => {
  it("요약이 있으면 글이 보이고 전체 글은 title 로, 두 줄까지만 보인다", async () => {
    await draw(datedList);
    expect(textOf(rowButton("요약 있는 공고"))).toContain(SUMMARY);
    const [summary] = findAll(rowButton("요약 있는 공고"), (n) => n.tag === "span" && n.props.title === SUMMARY);
    expect(textOf(summary)).toBe(SUMMARY);
    expect(classOf(summary)).toContain("line-clamp-2");
    expect(classOf(summary)).toContain("break-keep");
    expect(classOf(summary)).toContain("text-wedly-sub text-wedly-t2");
  });

  it("요약이 빈 글이면 「아직 요약 전」", async () => {
    await draw(datedList);
    const text = textOf(rowButton("요약 전 공고"));
    expect(text).toContain("아직 요약 전");
    expect(text).not.toContain(SUMMARY);
    const [pending] = findAll(rowButton("요약 전 공고"), (n) => textOf(n) === "아직 요약 전");
    expect(classOf(pending)).toContain("text-wedly-hint text-wedly-muted");
  });

  it("좁은 화면은 제목 아래 줄(col-start-2), 넓은 화면은 제목과 대상 기업 칸 사이", async () => {
    await draw(datedList);
    const row = rowButton("요약 있는 공고");
    expect(classOf(row)).toContain(MD_GRID);
    expect(classOf(row)).toContain("grid-cols-[56px_minmax(0,1fr)_16px]");
    const kids = row.kids.filter((k): k is HostNode => typeof k !== "string");
    const order = kids.map((k) => textOf(k));
    const summaryAt = order.findIndex((t) => t === SUMMARY);
    expect(summaryAt).toBeGreaterThan(0);
    expect(order[summaryAt - 1]).toContain("요약 있는 공고");
    expect(order[summaryAt + 1]).toContain("대상 기업");
    expect(classOf(kids[summaryAt])).toContain("col-start-2 ");
    expect(classOf(kids[summaryAt])).toContain("md:col-start-auto");
  });
});

describe("정책별 고객사 — 목록 머리줄", () => {
  it("공고가 있으면 넓은 화면에서만 보이는 머리줄 하나가 「마감」「공고」「핵심 내용」「대상 기업」 네 글자를 보인다", async () => {
    await draw(datedList);
    const headers = headerRows();
    expect(headers).toHaveLength(1);
    const [head] = headers;
    expect(head.kids.filter((k): k is HostNode => typeof k !== "string").map((k) => textOf(k))).toEqual(["마감", "공고", "핵심 내용", "대상 기업", ""]);
    expect(classOf(head)).toContain("hidden");
    expect(classOf(head)).toContain("md:grid");
    expect(classOf(head)).toContain(MD_GRID);
    expect(classOf(head)).toContain("px-3.5");
  });

  it("머리줄은 공고 줄들 앞에 하나, 「상시 모집」 열기 단추 줄에는 다시 넣지 않는다", async () => {
    await draw(datedList);
    const toggle = buttonsWith(root(), /마감일이 없는 상시 모집/)[0];
    await mounted?.click(toggle);
    expect(textOf(root())).toContain("상시 공고");
    expect(headerRows()).toHaveLength(1);
  });

  it("보이는 공고 줄이 없으면(상시만, 접힘) 머리줄도 없고, 상시를 열면 하나 나온다", async () => {
    await draw(alwaysOnlyList);
    expect(headerRows()).toHaveLength(0);
    await mounted?.click(buttonsWith(root(), /마감일이 없는 상시 모집/)[0]);
    expect(headerRows()).toHaveLength(1);
  });
});
