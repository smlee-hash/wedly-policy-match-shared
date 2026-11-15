// 좁은 화면의 펼친 표 — 표는 최소 폭까지만 줄고 그 아래는 가로로 밀어 본다(overflow-x-auto).
// 최소 폭에서도 폭을 두지 않은 칸(공고 표의 공고명·업체 표의 마지막 칸)이 글자를 읽을 만큼 남아야 한다.
// 2026-11-15 운영 QA(390px 화면): 두 조건 칸이 다 나온 공고 표가 760px 에서 고정 칸·% 칸에 754px 을 내줘 공고명이 한 글자씩 줄을 바꿨다.
import { describe, expect, it, vi } from "vitest";
import { CompanyTable, ContactAnnouncementTable } from "./DeadlineTables";
import { byTag, find, findAll, headsOf, mountTree, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const announcement = (extra: Partial<{ fitLabels: string[]; toCheck: string[]; gaps: string[] }>) => ({
  bucketKey: "b1", repAnnouncementId: "a1", title: "2026년 시설농업 AI로봇 실증기반 구축사업 기술지원 수혜기업 모집 공고", agency: "기관",
  category: "R&D·기술", url: "", applyEnd: "2026-11-15", dDay: 0, verdict: "unverified" as const,
  fitLabels: [], toCheck: [], gaps: [], progress: null, ...extra,
});
const company = (extra: Partial<{ fitLabels: string[]; toCheck: string[]; gaps: string[] }>) => ({
  customerKey: "cA", companyName: "가나상사", consultant: "김컨설", consultantNames: ["김컨설"], statusText: "계약",
  fitLabels: [], toCheck: [], gaps: [], progress: null, ...extra,
});
const BOTH = { fitLabels: ["업력 3년 이상"], toCheck: ["수출 실적"] };
const FIT = { fitLabels: ["업력 3년 이상"] };
const CHECK = { toCheck: ["수출 실적"] };

const tableOf = (tree: HostNode) => byTag(tree, "table")[0];
const colsOf = (t: HostNode) => byTag(byTag(t, "colgroup")[0], "col").map((c) => String(c.props.className ?? ""));
/** 표 className 의 최소 폭 — 화면 너비 구간(앞붙이 없음·lg:)마다 하나씩. */
const minWidthsOf = (t: HostNode) => [...String(t.props.className).matchAll(/(?:^|\s)((?:lg:)?)min-w-\[(\d+)px\]/g)].map((m) => ({ at: m[1], px: Number(m[2]) }));
/** 표가 px 폭일 때 폭을 두지 않은 칸에 남는 폭 — % 칸은 표 폭의 비율, px 칸은 그대로 뺀다. */
function leftover(t: HostNode, tablePx: number): number {
  const cols = colsOf(t);
  const percent = cols.reduce((sum, c) => sum + Number(/w-\[(\d+)%\]/.exec(c)?.[1] ?? 0), 0);
  const fixedPx = cols.reduce((sum, c) => sum + Number(/w-\[(\d+)px\]/.exec(c)?.[1] ?? 0), 0);
  return tablePx - (tablePx * percent) / 100 - fixedPx;
}

describe("좁은 화면의 펼친 표", () => {
  it.each([
    ["두 조건 칸", BOTH],
    ["맞은 조건만", FIT],
    ["확인할 조건만", CHECK],
    ["조건 칸 없음", {}],
  ])("공고 표(%s) — 최소 폭에서도 공고명 칸이 100px 넘게 남고, 사이드바 없는 좁은 화면은 180px 넘게 남는다", (_, extra) => {
    const t = tableOf(mountTree(<ContactAnnouncementTable rows={[announcement(extra)]} customerKey="cA" busyKey="" onProgress={() => {}} />).tree);
    expect(String(t.props.className)).toContain("table-fixed");
    expect(headsOf(t)[0]).toBe("공고명");
    expect(colsOf(t)[0]).toBe("");
    const widths = minWidthsOf(t);
    expect(widths.length).toBeGreaterThan(0);
    for (const { px } of widths) expect(leftover(t, px)).toBeGreaterThanOrEqual(100);
    // 앞붙이 없는 최소 폭은 사이드바가 없는 좁은 화면(휴대폰·태블릿) 몫이다.
    expect(leftover(t, widths.find((w) => w.at === "")!.px)).toBeGreaterThanOrEqual(180);
  });

  it("공고 표 — 넓은 화면(ERP 1280 너비, 표 폭 약 900px)에서는 가로로 밀지 않아도 다 보인다", () => {
    const t = tableOf(mountTree(<ContactAnnouncementTable rows={[announcement(BOTH)]} customerKey="cA" busyKey="" onProgress={() => {}} />).tree);
    const wide = minWidthsOf(t).find((w) => w.at === "lg:") ?? minWidthsOf(t).find((w) => w.at === "")!;
    expect(wide.px).toBeLessThanOrEqual(900);
  });

  it.each([
    ["담당 칸 있음", true],
    ["담당 칸 없음", false],
  ])("업체 표(%s) — 두 조건 칸이 다 나와도 최소 폭에서 마지막 칸이 100px 넘게 남는다", (_, showConsultant) => {
    const t = tableOf(
      mountTree(
        <CompanyTable rows={[company(BOTH)]} columns={{ fit: true, check: true }} busyKey="" bucketKey="b1" showConsultant={showConsultant} onProgress={() => {}} />,
      ).tree,
    );
    expect(colsOf(t).at(-2)).toBe("");
    for (const { px } of minWidthsOf(t)) expect(leftover(t, px)).toBeGreaterThanOrEqual(100);
  });

  // 2026-11-16 운영 QA(390px 화면): 「업무 현황」 머리 칸의 sr-only 글자(절대 위치)가 기준 상자 없이 문서 전체를 기준으로 자리를 잡아,
  // 가로 밀기 상자에 잘리지 않고 문서 폭을 932px 로 늘렸다. 밀기 상자가 기준 상자(relative)여야 그 글자가 상자 안에서 잘린다.
  it.each([
    ["공고 표", () => <ContactAnnouncementTable rows={[announcement(BOTH)]} customerKey="cA" busyKey="" onProgress={() => {}} />],
    ["업체 표", () => <CompanyTable rows={[company(BOTH)]} columns={{ fit: true, check: true }} busyKey="" bucketKey="b1" onProgress={() => {}} />],
  ])("%s — 가로 밀기 상자가 기준 상자라 안쪽 절대 위치 글자(sr-only)가 문서를 넓히지 않는다", (_, render) => {
    const tree = mountTree(render()).tree;
    const box = find(tree, (n) => n.kids.some((k) => typeof k !== "string" && k.tag === "table"));
    const cls = String(box?.props.className ?? "").split(/\s+/);
    expect(cls).toContain("overflow-x-auto");
    expect(cls).toContain("relative");
    expect(findAll(tableOf(tree), (n) => String(n.props.className ?? "").split(/\s+/).includes("sr-only")).length).toBeGreaterThan(0);
  });
});
