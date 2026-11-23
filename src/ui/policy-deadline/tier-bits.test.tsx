// 맞을 확률 단계 부품(NO.789) — 단계 딱지·단계 거르기·순서 단추·확인 항목 목록·「해당 없음」·접는 묶음.
// 딱지는 사장님 표준 「흰 칩 + 색 점」(2026-08-25, ../Badge)을 그대로 쓴다 — 높음 초록 점·보통 노랑(gold-ink) 점·낮음과 판단 전은 점 없음.
// 화면 글에는 내부 용어(조건 정리 전·unverified·unstructured·tier)를 쓰지 않는다.
import { describe, expect, it, vi } from "vitest";
import type { CheckItem } from "../../serve/policy-deadline/tier";
import { DISMISS_REASONS, type DismissInfo } from "../../serve/policy-deadline/types";
import { CheckList, CheckSummary, DismissControl, FoldGroup, SortSeg, TierBadge, TierCell, TierFilter, TodayLine } from "./TierBits";
import { buttonsWith, byTag, find, findAll, mountTree, propOf, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const flat = (node: HostNode | string) => textOf(node).replace(/\s+/g, " ").trim();
const cls = (node: HostNode | undefined) => String(node?.props.className ?? "");
/** 딱지 안의 색 점(Badge 의 aria-hidden 동그라미). */
const dotOf = (tree: HostNode) => find(tree, (n) => n.tag === "span" && n.props["aria-hidden"] === "true" && cls(n).includes("rounded-full"));
const groupOf = (tree: HostNode, label: string) => find(tree, (n) => n.props.role === "group" && n.props["aria-label"] === label);
const INTERNAL = ["조건 정리 전", "unverified", "unstructured", "tier"];

describe("단계 딱지", () => {
  it.each([
    ["high", false, "높음", "bg-wedly-green"],
    ["mid", false, "보통", "bg-wedly-gold-ink"],
    ["low", false, "낮음", null],
    ["low", true, "원문 확인 필요", null],
    ["high", true, "원문 확인 필요", null],
  ] as const)("%s(판단 전 %s) — 「%s」, 점 %s", (tier, unstructured, label, dot) => {
    const { tree } = mountTree(<TierBadge tier={tier} unstructured={unstructured} />);
    expect(flat(tree)).toBe(`맞을 확률 ${label}`);
    // 「맞을 확률」은 읽어 주는 글(sr-only)로만 — 눈에는 단계 글자만.
    const hidden = find(tree, (n) => cls(n).split(" ").includes("sr-only"));
    expect(hidden && flat(hidden)).toBe("맞을 확률");
    // 흰 칩 표준(Badge soft) 그대로.
    const chip = find(tree, (n) => n.tag === "span" && cls(n).includes("rounded-full") && cls(n).includes("border-wedly-bd") && cls(n).includes("bg-white"));
    expect(chip?.tag).toBe("span");
    const found = dotOf(tree);
    if (dot === null) expect(found).toBeUndefined();
    else expect(cls(found)).toContain(dot);
  });

  it("단계 칸 — 딱지 아래 근거 한 줄", () => {
    const { tree } = mountTree(<TierCell tier="mid" unstructured={false} tierReason="조건 6개 중 5개 맞음 · 매출 확인" />);
    expect(flat(tree)).toContain("맞을 확률 보통");
    expect(cls(dotOf(tree))).toContain("bg-wedly-gold-ink");
    // 근거는 딱지 밖 제 요소에 한 줄로.
    const reason = find(tree, (n) => n.kids.length === 1 && n.kids[0] === "조건 6개 중 5개 맞음 · 매출 확인");
    expect(reason && flat(reason)).toBe("조건 6개 중 5개 맞음 · 매출 확인");
    expect(flat(tree).indexOf("조건 6개")).toBeGreaterThan(flat(tree).indexOf("보통"));
  });
});

describe("단계 거르기 단추", () => {
  const counts = { high: 2, mid: 1, low: 4, unstructured: 3 };

  it("세 단추 — 표시·이름·수·단위, 고른 단계만 눌림", () => {
    const { tree } = mountTree(<TierFilter value={["high", "mid"]} counts={counts} unit="곳" onChange={() => {}} />);
    const group = groupOf(tree, "맞을 확률");
    expect(group?.props.role).toBe("group");
    const buttons = byTag(group!, "button");
    expect(buttons.map(flat)).toEqual(["● 높음 2곳", "◐ 보통 1곳", "○ 낮음 4곳"]);
    expect(buttons.map((b) => b.props["aria-pressed"])).toEqual([true, true, false]);
    expect(buttons.map((b) => b.props.type)).toEqual(["button", "button", "button"]);
  });

  it("공고 단위는 건", () => {
    const { tree } = mountTree(<TierFilter value={["high"]} counts={counts} unit="건" onChange={() => {}} />);
    expect(byTag(tree, "button").map(flat)).toEqual(["● 높음 2건", "◐ 보통 1건", "○ 낮음 4건"]);
  });

  it("누르면 켜고 끈 새 목록(높음 → 보통 → 낮음 순)을 넘긴다", async () => {
    const onChange = vi.fn();
    const root = mountTree(<TierFilter value={["mid"]} counts={counts} unit="곳" onChange={onChange} />);
    await root.click(buttonsWith(root.tree, /낮음/)[0]);
    expect(onChange).toHaveBeenLastCalledWith(["mid", "low"]);
    await root.click(buttonsWith(root.tree, /높음/)[0]);
    expect(onChange).toHaveBeenLastCalledWith(["high", "mid"]);
  });

  it("마지막 하나는 끌 수 없다 — 눌러도 넘기지 않고 까닭을 title 로", async () => {
    const onChange = vi.fn();
    const root = mountTree(<TierFilter value={["mid"]} counts={counts} unit="곳" onChange={onChange} />);
    const only = buttonsWith(root.tree, /보통/)[0];
    expect(propOf(only, "title")).toBe("단계는 하나 이상 골라야 합니다");
    await root.click(only);
    expect(onChange).not.toHaveBeenCalled();
    expect(propOf(buttonsWith(root.tree, /높음/)[0], "title")).toBeUndefined();
  });
});

describe("순서 단추", () => {
  it("맞을 확률 순 · 마감 순 — 하나만 눌림, 누르면 값을 넘긴다", async () => {
    const onChange = vi.fn();
    const root = mountTree(<SortSeg value="tier" onChange={onChange} />);
    const group = groupOf(root.tree, "순서");
    expect(group?.props.role).toBe("group");
    const buttons = byTag(group!, "button");
    expect(buttons.map(flat)).toEqual(["맞을 확률 순", "마감 순"]);
    expect(buttons.map((b) => b.props["aria-pressed"])).toEqual([true, false]);
    await root.click(buttons[1]);
    expect(onChange).toHaveBeenCalledWith("deadline");
  });
});

describe("오늘 줄", () => {
  it("오늘 연락할 곳 · 확인 후 연락 · 진행함", () => {
    const { tree } = mountTree(<TodayLine today={{ contactNow: 3, checkFirst: 1, inProgress: 0 }} />);
    expect(flat(tree)).toBe("오늘 연락할 곳 3곳 · 확인 후 연락 1곳 · 진행함 0곳");
  });
});

const ITEMS: CheckItem[] = [
  { label: "국세 체납 입력", what: "국세 체납", group: "company", rank: 7, field: "taxArrears", where: "기업상태표 › 국세 체납여부", current: "비어 있음" },
  { label: "업종", what: "업종", group: "notice", rank: 1, where: "공고 원문", evidence: "업종: 제조업 한정" },
  { label: "사업장 소재지 입력", what: "소재지", group: "company", rank: 2, field: "address", where: "기업상태표 › 사업장 소재지", current: "서울 강남구", hint: "공고 지역: 부산" },
  { label: "출품 방법", what: "출품 방법", group: "ref", rank: 9, where: "공고 원문", evidence: "출품: 온라인 접수" },
  { label: "휴폐업", what: "휴업·폐업", group: "company", rank: 0, where: "기본정보 › 사업자번호", obstacle: true, evidence: "휴폐업: 휴업 중" },
  { label: "매출 원문", what: "매출 기준", group: "notice", rank: 5, where: "공고 원문" },
];

describe("확인 항목 한 줄 요약", () => {
  it("항목이 있으면 펼치기 단추 — 수 · 첫 항목", async () => {
    const onToggle = vi.fn();
    const root = mountTree(<CheckSummary checkItems={ITEMS} checkCount={5} open={false} onToggle={onToggle} />);
    const button = byTag(root.tree, "button")[0];
    expect(flat(button)).toBe("확인할 것 5개 · 휴업·폐업");
    expect(button.props["aria-expanded"]).toBe(false);
    await root.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    root.update(<CheckSummary checkItems={ITEMS} checkCount={5} open onToggle={onToggle} />);
    expect(byTag(root.tree, "button")[0].props["aria-expanded"]).toBe(true);
  });

  it("확인할 것이 없으면 단추 없이 글만", () => {
    const { tree } = mountTree(<CheckSummary checkItems={[]} checkCount={0} open={false} onToggle={() => {}} />);
    expect(byTag(tree, "button")).toHaveLength(0);
    expect(flat(tree)).toBe("확인할 것 없음");
  });

  it("펼치기를 받지 않으면 글만", () => {
    const { tree } = mountTree(<CheckSummary checkItems={ITEMS} checkCount={5} />);
    expect(byTag(tree, "button")).toHaveLength(0);
    expect(flat(tree)).toBe("확인할 것 5개 · 휴업·폐업");
  });
});

describe("확인 항목 목록", () => {
  it("두 묶음 — 업체 정보에서 채울 것(먼저) · 공고 원문에서 확인할 것, 묶음 안은 순위 순", () => {
    const { tree } = mountTree(<CheckList items={ITEMS} onField={() => {}} />);
    const text = flat(tree);
    const at = (s: string) => text.indexOf(s);
    expect(at("업체 정보에서 채울 것")).toBeGreaterThanOrEqual(0);
    expect(at("공고 원문에서 확인할 것")).toBeGreaterThan(at("업체 정보에서 채울 것"));
    // 업체 묶음: 휴업·폐업(0) → 소재지(2) → 국세 체납(7) — 모두 공고 묶음 머리보다 앞.
    expect(at("휴업·폐업")).toBeLessThan(at("소재지"));
    expect(at("소재지")).toBeLessThan(at("국세 체납"));
    expect(at("국세 체납")).toBeLessThan(at("공고 원문에서 확인할 것"));
    // 공고 묶음: 업종(1) → 매출 기준(5).
    expect(at("업종")).toBeGreaterThan(at("공고 원문에서 확인할 것"));
    expect(at("업종")).toBeLessThan(at("매출 기준"));
  });

  it("업체 항목 — 지금 값 · 확인할 곳 · 힌트, 걸림돌 표시", () => {
    const { tree } = mountTree(<CheckList items={ITEMS} onField={() => {}} />);
    const text = flat(tree);
    expect(text).toContain("지금 값: 비어 있음");
    expect(text).toContain("지금 값: 서울 강남구");
    expect(text).toContain("기업상태표 › 국세 체납여부");
    expect(text).toContain("기업상태표 › 사업장 소재지");
    expect(text).toContain("공고 지역: 부산");
    expect(text).toContain("걸림돌");
    expect(text.match(/걸림돌/g)).toHaveLength(1);
  });

  it("공고 항목 — 근거 문장(공고 원문에서 읽은 글)", () => {
    const { tree } = mountTree(<CheckList items={ITEMS} onField={() => {}} />);
    const text = flat(tree);
    expect(text).toContain("업종: 제조업 한정");
    expect(text).toContain("휴폐업: 휴업 중");
  });

  it("칸이 있는 업체 항목은 단추 — 누르면 그 칸을 넘긴다(상세창에서 그 칸 열기). 칸이 없으면 글", async () => {
    const onField = vi.fn();
    const root = mountTree(<CheckList items={ITEMS} onField={onField} />);
    const tax = buttonsWith(root.tree, /국세 체납/);
    expect(tax).toHaveLength(1);
    expect(tax[0].props.type).toBe("button");
    await root.click(tax[0]);
    expect(onField).toHaveBeenCalledWith("taxArrears");
    await root.click(buttonsWith(root.tree, /소재지/)[0]);
    expect(onField).toHaveBeenLastCalledWith("address");
    expect(buttonsWith(root.tree, /휴업·폐업/)).toHaveLength(0);
    expect(buttonsWith(root.tree, /업종/)).toHaveLength(0);
  });

  it("칸 열기를 받지 않으면 업체 항목도 글만", () => {
    const { tree } = mountTree(<CheckList items={ITEMS} />);
    expect(buttonsWith(tree, /국세 체납|소재지/)).toHaveLength(0);
    expect(flat(tree)).toContain("국세 체납");
  });

  it("참고 항목은 접어 둔다 — 「참고 1개」를 눌러야 보인다", async () => {
    const root = mountTree(<CheckList items={ITEMS} onField={() => {}} />);
    const fold = buttonsWith(root.tree, "참고 1개")[0];
    expect(fold?.tag).toBe("button");
    expect(fold.props["aria-expanded"]).toBe(false);
    expect(flat(root.tree)).not.toContain("출품 방법");
    await root.click(fold);
    expect(buttonsWith(root.tree, "참고 1개")[0].props["aria-expanded"]).toBe(true);
    expect(flat(root.tree)).toContain("출품 방법");
    expect(flat(root.tree)).toContain("출품: 온라인 접수");
  });

  it("빈 묶음은 그리지 않는다 · 항목이 없으면 아무것도", () => {
    const notice = ITEMS.filter((i) => i.group === "notice");
    const { tree } = mountTree(<CheckList items={notice} onField={() => {}} />);
    expect(flat(tree)).not.toContain("업체 정보에서 채울 것");
    expect(flat(tree)).toContain("공고 원문에서 확인할 것");
    expect(buttonsWith(tree, /참고/)).toHaveLength(0);
    expect(mountTree(<CheckList items={[]} onField={() => {}} />).tree.kids).toHaveLength(0);
  });

  it("화면 글에 내부 용어가 없다", async () => {
    const root = mountTree(<CheckList items={ITEMS} onField={() => {}} />);
    await root.click(buttonsWith(root.tree, "참고 1개")[0]);
    for (const word of INTERNAL) expect(flat(root.tree)).not.toContain(word);
  });
});

describe("해당 없음", () => {
  const dismissed: DismissInfo = { reason: "고객이 원하지 않음", byName: "김지현", at: "2026-11-20T03:00:00.000Z" };

  it("단추 → 사유 다섯 + 취소 → 고르면 그 사유를 넘기고 닫는다", async () => {
    const onDismiss = vi.fn();
    const root = mountTree(<DismissControl dismissed={null} busy={false} onDismiss={onDismiss} />);
    const open = buttonsWith(root.tree, "해당 없음")[0];
    expect(open.props["aria-expanded"]).toBe(false);
    expect(groupOf(root.tree, "해당 없음 사유 고르기")).toBeUndefined();
    await root.click(open);
    const group = groupOf(root.tree, "해당 없음 사유 고르기");
    expect(group?.props.role).toBe("group");
    expect(byTag(group!, "button").map(flat)).toEqual([...DISMISS_REASONS, "취소"]);
    expect(buttonsWith(root.tree, "해당 없음")[0].props["aria-expanded"]).toBe(true);
    await root.click(buttonsWith(root.tree, "자격이 안 됨")[0]);
    expect(onDismiss).toHaveBeenCalledWith("자격이 안 됨");
    expect(groupOf(root.tree, "해당 없음 사유 고르기")).toBeUndefined();
  });

  it("취소는 넘기지 않고 닫는다", async () => {
    const onDismiss = vi.fn();
    const root = mountTree(<DismissControl dismissed={null} busy={false} onDismiss={onDismiss} />);
    await root.click(buttonsWith(root.tree, "해당 없음")[0]);
    await root.click(buttonsWith(root.tree, "취소")[0]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(groupOf(root.tree, "해당 없음 사유 고르기")).toBeUndefined();
  });

  it("남기는 중에는 단추를 잠근다", () => {
    const { tree } = mountTree(<DismissControl dismissed={null} busy onDismiss={() => {}} />);
    expect(buttonsWith(tree, "해당 없음")[0].props.disabled).toBe(true);
  });

  it("이미 해당 없음이면 기록 한 줄 + 되돌리기(사유 null)", async () => {
    const onDismiss = vi.fn();
    const root = mountTree(<DismissControl dismissed={dismissed} busy={false} onDismiss={onDismiss} />);
    expect(flat(root.tree)).toContain("해당 없음 · 고객이 원하지 않음 · 김지현 · 11/20(금)");
    expect(buttonsWith(root.tree, "해당 없음")).toHaveLength(0);
    await root.click(buttonsWith(root.tree, "되돌리기")[0]);
    expect(onDismiss).toHaveBeenCalledWith(null);
  });

  it("남기기를 받지 않으면(통로 없음) 단추를 그리지 않는다 — 기록은 보인다", () => {
    expect(mountTree(<DismissControl dismissed={null} busy={false} />).tree.kids).toHaveLength(0);
    const { tree } = mountTree(<DismissControl dismissed={dismissed} busy={false} />);
    expect(flat(tree)).toContain("해당 없음 · 고객이 원하지 않음");
    expect(byTag(tree, "button")).toHaveLength(0);
  });
});

describe("접는 묶음", () => {
  it("처음엔 접혀 있고 머리를 누르면 펼친다", async () => {
    const root = mountTree(
      <FoldGroup title="원문 확인 필요 업체 4곳 · AI가 공고 자격 조건을 확정하지 못해 맞을 확률 대신 확인할 것을 보여 줍니다">
        <p>안쪽 줄</p>
      </FoldGroup>,
    );
    const head = byTag(root.tree, "button")[0];
    expect(flat(head)).toContain("원문 확인 필요 업체 4곳 · AI가 공고 자격 조건을 확정하지 못해 맞을 확률 대신 확인할 것을 보여 줍니다");
    expect(head.props["aria-expanded"]).toBe(false);
    expect(flat(root.tree)).not.toContain("안쪽 줄");
    await root.click(head);
    expect(byTag(root.tree, "button")[0].props["aria-expanded"]).toBe(true);
    expect(flat(root.tree)).toContain("안쪽 줄");
    await root.click(byTag(root.tree, "button")[0]);
    expect(flat(root.tree)).not.toContain("안쪽 줄");
  });

  it("defaultOpen 이면 펼친 채 시작", () => {
    const { tree } = mountTree(
      <FoldGroup title="해당 없음 공고 2건" defaultOpen>
        <p>안쪽 줄</p>
      </FoldGroup>,
    );
    expect(byTag(tree, "button")[0].props["aria-expanded"]).toBe(true);
    expect(flat(tree)).toContain("안쪽 줄");
  });

  it("머리 단추가 펼칠 곳을 가리킨다(aria-controls = 안쪽 id)", async () => {
    const root = mountTree(
      <FoldGroup title="해당 없음 공고 2건">
        <p>안쪽 줄</p>
      </FoldGroup>,
    );
    await root.click(byTag(root.tree, "button")[0]);
    const id = byTag(root.tree, "button")[0].props["aria-controls"];
    expect(typeof id).toBe("string");
    expect(findAll(root.tree, (n) => n.props.id === id)).toHaveLength(1);
  });
});
