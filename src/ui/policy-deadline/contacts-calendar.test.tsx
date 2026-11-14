// 「연락 예정 업체」 캘린더 보기 — 날짜 셈(순수 함수)·한 달 칸·칩·고른 업체 판·보드 안 동작.
// 훅이 든 부품(ContactsCalendar·ContactsBoard)은 test-kit 의 실행기로 돌린다.
import { Checkbox, Toast } from "@wedly/ui-shared/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "../CustomSelect";
import type { ContactCompanyRow } from "../../serve/policy-deadline/types";
import ContactsBoard from "./ContactsBoard";
import ContactsCalendar, {
  CalendarView,
  PickedCompany,
  addMonths,
  buildMonth,
  calendarEntries,
  chipTone,
  kstDay,
  monthHint,
  monthOf,
  narrowDayLabel,
  shiftDay,
  type CalendarEntry,
} from "./ContactsCalendar";
import { DeadlineToast } from "./DeadlineBits";
import { contactRowsFor, OTHER_KINDS } from "./deadline-view";
import { DEADLINE_ENDPOINTS } from "./endpoints";
import { buttonsWith, byTag, find, findAll, jsonResponse, mountTree, stubBrowser, textOf, type HostNode } from "./test-kit";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...(await import("./test-kit")).hooks,
}));

const OPAQUE = [Checkbox, Toast, CustomSelect, DeadlineToast, ChevronLeft, ChevronRight];
let mounted: ReturnType<typeof mountTree> | null = null;
const root = (): HostNode => {
  if (!mounted) throw new Error("먼저 화면을 그려야 합니다.");
  return mounted.tree;
};
const fetchMock = vi.fn();
const NOW = new Date("2026-11-14T03:00:00Z"); // 서울 2026-11-14 낮 12시(토)

function contact(over: Partial<ContactCompanyRow>): ContactCompanyRow {
  return {
    customerKey: "c1", companyName: "가나상사", consultant: "김컨설", consultantNames: ["김컨설"], statusText: "",
    nearestApplyEnd: "2026-11-20", nearestDDay: 6, kinds: [{ category: "정책자금", count: 2, nearestDDay: 6 }],
    announcementCount: 2, progressCount: 0, ...over,
  };
}
const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({ customerKey: "c1", companyName: "가나상사", consultant: "김컨설", day: "2026-11-20", dDay: 6, count: 2, ...over });

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

describe("날짜 셈 — 서울 날짜 글자만 쓴다", () => {
  it("칩 색은 D-n 7일 안 빨강 · 14일 안 금색 · 그 뒤 파랑", () => {
    expect([0, 7, 8, 14, 15, 60].map(chipTone)).toEqual(["red", "red", "gold", "gold", "blue", "blue"]);
  });

  it("오늘은 서울 기준 — UTC 로는 아직 어제여도 서울은 다음 날", () => {
    expect(kstDay(new Date("2026-11-13T14:59:59Z"))).toBe("2026-11-13");
    expect(kstDay(new Date("2026-11-13T15:00:00Z"))).toBe("2026-11-14");
  });

  it("날짜 옮기기·달 옮기기는 달·해를 넘어도 맞다", () => {
    expect([shiftDay("2026-11-30", 1), shiftDay("2026-12-31", 1), shiftDay("2026-03-01", -1), shiftDay("엉터리", 3)]).toEqual(["2026-12-01", "2027-01-01", "2026-02-28", "엉터리"]);
    expect(monthOf("2026-11-14")).toEqual({ year: 2026, month: 11 });
    expect([addMonths({ year: 2026, month: 11 }, 2), addMonths({ year: 2026, month: 1 }, -1), addMonths({ year: 2026, month: 11 }, -23)]).toEqual([
      { year: 2027, month: 1 },
      { year: 2025, month: 12 },
      { year: 2024, month: 12 },
    ]);
  });

  it("좁은 화면 날짜 줄은 「11/17 (화)」", () => {
    expect(narrowDayLabel(11, 17, 2)).toBe("11/17 (화)");
  });
});

describe("연락 예정 줄 → 캘린더 줄", () => {
  it("업체 하나는 칩 하나 — 날은 가장 가까운 마감일, 건수는 종류별 공고 수의 합", () => {
    const rows = contactRowsFor([contact({ kinds: [{ category: "정책자금", count: 2, nearestDDay: 6 }, { category: "수출", count: 1, nearestDDay: 9 }], announcementCount: 3 })], "");
    expect(calendarEntries(rows)).toEqual([{ customerKey: "c1", companyName: "가나상사", consultant: "김컨설", day: "2026-11-20", dDay: 6, count: 3 }]);
  });

  it("종류를 거르면 그 종류 공고의 마감일·건수로 옮겨 목록의 D-n 딱지와 같은 날에 놓는다", () => {
    const company = contact({ nearestDDay: 6, nearestApplyEnd: "2026-11-20", kinds: [{ category: "정책자금", count: 1, nearestDDay: 6 }, { category: "수출", count: 2, nearestDDay: 9 }], announcementCount: 3 });
    expect(calendarEntries(contactRowsFor([company], OTHER_KINDS))).toEqual([{ customerKey: "c1", companyName: "가나상사", consultant: "김컨설", day: "2026-11-23", dDay: 9, count: 2 }]);
  });
});

describe("한 달 칸", () => {
  const entries = [
    entry({ customerKey: "a", companyName: "가", day: "2026-11-17", dDay: 3 }),
    entry({ customerKey: "b", companyName: "나", day: "2026-11-17", dDay: 3 }),
    entry({ customerKey: "c", companyName: "다", day: "2026-12-02", dDay: 18 }),
    entry({ customerKey: "d", companyName: "라", day: "2026-10-30", dDay: -1 }),
  ];

  it("달력 칸 — 11월은 일요일 시작이라 앞 빈 칸 0, 12월은 화요일 시작이라 2", () => {
    const nov = buildMonth(entries, { year: 2026, month: 11 }, "2026-11-14");
    expect([nov.leading, nov.cells.length, nov.cells[16].day, nov.cells[16].weekday]).toEqual([0, 30, "2026-11-17", 2]);
    expect(buildMonth(entries, { year: 2026, month: 12 }, "2026-11-14").leading).toBe(2);
    expect(buildMonth(entries, { year: 2024, month: 2 }, "2026-11-14").cells).toHaveLength(29);
  });

  it("칩은 날짜별로 — 같은 날은 받은 순서, 이달·앞·뒤 업체 수를 센다", () => {
    const nov = buildMonth(entries, { year: 2026, month: 11 }, "2026-11-14");
    expect(nov.cells[16].entries.map((e) => e.customerKey)).toEqual(["a", "b"]);
    expect([nov.inMonth, nov.before, nov.after]).toEqual([2, 1, 1]);
    expect(nov.cells.filter((c) => c.isToday).map((c) => c.day)).toEqual(["2026-11-14"]);
  });

  it("머리 글 — 0곳인 조각은 뺀다(「이달」은 0이어도 둔다)", () => {
    expect(monthHint({ inMonth: 2, before: 1, after: 3 })).toBe("이달 2곳 · 지난달에 1곳 · 다음 달에 3곳");
    expect(monthHint({ inMonth: 2, before: 0, after: 0 })).toBe("이달 2곳");
    expect(monthHint({ inMonth: 0, before: 0, after: 4 })).toBe("이달 0곳 · 다음 달에 4곳");
  });
});

describe("CalendarView — 그림", () => {
  const entries = [
    entry({ customerKey: "a", companyName: "가나상사", day: "2026-11-17", dDay: 3, count: 2 }),
    entry({ customerKey: "b", companyName: "다라상사", day: "2026-11-25", dDay: 11, count: 1 }),
    entry({ customerKey: "c", companyName: "마바상사", day: "2026-12-10", dDay: 26, count: 4 }),
  ];
  const draw = (over: Partial<Omit<Parameters<typeof CalendarView>[0], "onSelect" | "onMonth">> = {}) => {
    const props = { onSelect: vi.fn(), onMonth: vi.fn() };
    mounted?.unmount();
    mounted = mountTree(<CalendarView entries={entries} monthRef={{ year: 2026, month: 11 }} today="2026-11-14" selectedKey={null} {...over} {...props} />, { opaque: OPAQUE });
    return props;
  };
  const chips = () => byTag(root(), "button").filter((b) => "aria-pressed" in b.props);
  const cellOfDay = (day: string) => find(root(), (n) => n.props["data-day"] === day);

  it("머리 — 「2026년 11월」·「이달 2곳 · 다음 달에 1곳」·색 설명 세 가지", () => {
    draw();
    expect(textOf(find(root(), (n) => n.tag === "h3") ?? [])).toBe("2026년 11월");
    expect(textOf(root())).toContain("이달 2곳 · 다음 달에 1곳");
    const legend = find(root(), (n) => n.props["aria-label"] === "색 설명");
    expect(textOf(legend ?? [])).toBe("7일 안14일 안그 뒤");
  });

  it("업체마다 칩 하나 — 이름과 「N건」, 날짜 칸에 한 번만 나온다", () => {
    draw();
    expect(chips().map((c) => textOf(c))).toEqual(["가나상사2건", "다라상사1건"]);
    expect(textOf(cellOfDay("2026-11-17") ?? [])).toContain("가나상사");
    expect(textOf(cellOfDay("2026-11-25") ?? [])).toContain("다라상사");
  });

  it("칩 색은 D-n 구간에 따른다", () => {
    draw();
    const [first, second] = chips();
    expect(String(first.props.className)).toContain("border-l-wedly-red-ink");
    expect(String(second.props.className)).toContain("border-l-wedly-gold-ink");
    draw({ entries: [entry({ day: "2026-11-30", dDay: 20 })] });
    expect(String(chips()[0].props.className)).toContain("border-l-wedly-accent");
  });

  it("오늘 칸에는 「오늘」이 있다", () => {
    draw();
    expect(textOf(cellOfDay("2026-11-14") ?? [])).toContain("오늘");
    expect(textOf(cellOfDay("2026-11-15") ?? [])).not.toContain("오늘");
  });

  it("좁은 화면(640px 아래)은 빈 날을 숨기고, 업체 있는 날은 「11/17 (화)」 줄로 보인다", () => {
    draw();
    expect(String(cellOfDay("2026-11-15")?.props.className).split(" ")).toContain("hidden");
    expect(String(cellOfDay("2026-11-17")?.props.className).split(" ")).toContain("flex");
    expect(String(cellOfDay("2026-11-17")?.props.className)).toContain("sm:flex");
    expect(textOf(cellOfDay("2026-11-17") ?? [])).toContain("11/17 (화)");
    const header = find(root(), (n) => n.tag === "div" && String(n.props.className).includes("grid-cols-7") && n.props["aria-hidden"] === true);
    expect(String(header?.props.className)).toContain("hidden");
    expect(String(header?.props.className)).toContain("sm:grid");
  });

  it("이달에 업체가 없으면 안내 글, 있으면 안내 글이 없다", () => {
    draw();
    expect(textOf(root())).not.toContain("이달에는 연락할 업체가 없습니다");
    draw({ monthRef: { year: 2027, month: 3 } });
    expect(textOf(root())).toContain("이달에는 연락할 업체가 없습니다");
  });

  it("‹ › 는 달을 옮기고, 칩은 그 업체를 고른다 — 고른 칩은 눌림 표시", async () => {
    const props = draw({ selectedKey: "b" });
    await mounted?.click(find(root(), (n) => n.props["aria-label"] === "이전 달"));
    await mounted?.click(find(root(), (n) => n.props["aria-label"] === "다음 달"));
    expect(props.onMonth.mock.calls).toEqual([[-1], [1]]);
    expect(chips().map((c) => c.props["aria-pressed"])).toEqual([false, true]);
    await mounted?.click(chips()[0]);
    expect(props.onSelect).toHaveBeenCalledWith("a");
  });
});

describe("PickedCompany — 고른 업체 판", () => {
  const draw = (over: Partial<Parameters<typeof PickedCompany>[0]> = {}) => {
    const onClose = vi.fn();
    mounted?.unmount();
    mounted = mountTree(
      <PickedCompany entry={entry({})} showConsultant onClose={onClose} {...over}>
        <p>공고 표 자리</p>
      </PickedCompany>,
      { opaque: OPAQUE },
    );
    return onClose;
  };

  it("업체 이름·담당·가장 가까운 마감·공고 수와 닫기, 그 아래는 받은 표", async () => {
    const onClose = draw();
    expect(find(root(), (n) => n.props["aria-label"] === "고른 업체")?.tag).toBe("section");
    const text = textOf(root());
    expect(text).toContain("가나상사");
    expect(text).toContain("담당 김컨설 · 가장 가까운 마감 11/20(금) · 공고 2건");
    expect(text).toContain("공고 표 자리");
    await mounted?.click(buttonsWith(root(), "닫기")[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("담당 칸은 showConsultant 일 때만, 담당이 비면 「없음」", () => {
    draw({ showConsultant: false });
    expect(textOf(root())).not.toContain("담당");
    draw({ entry: entry({ consultant: "" }) });
    expect(textOf(root())).toContain("담당 없음");
  });
});

describe("ContactsCalendar — 달 옮기기·고르기", () => {
  const rows = contactRowsFor([contact({}), contact({ customerKey: "c2", companyName: "다라상사", nearestApplyEnd: "2026-12-04", nearestDDay: 20, kinds: [{ category: "수출", count: 1, nearestDDay: 20 }], announcementCount: 1 })], "");
  const draw = (selectedKey: string | null = null) => {
    const onSelect = vi.fn();
    mounted?.unmount();
    mounted = mountTree(<ContactsCalendar rows={rows} showConsultant selectedKey={selectedKey} onSelect={onSelect} renderCompany={(c) => <p>{`공고 표: ${c.companyName}`}</p>} now={NOW} />, { opaque: OPAQUE });
    return onSelect;
  };
  const title = () => textOf(find(root(), (n) => n.tag === "h3") ?? []);

  it("첫 달은 오늘(서울 날짜)의 달이고 ‹ › 로 앞뒤로 옮긴다", async () => {
    draw();
    expect(title()).toBe("2026년 11월");
    expect(textOf(root())).toContain("이달 1곳 · 다음 달에 1곳");
    await mounted?.click(find(root(), (n) => n.props["aria-label"] === "다음 달"));
    expect(title()).toBe("2026년 12월");
    expect(textOf(root())).toContain("이달 1곳 · 지난달에 1곳");
    await mounted?.click(find(root(), (n) => n.props["aria-label"] === "이전 달"));
    await mounted?.click(find(root(), (n) => n.props["aria-label"] === "이전 달"));
    expect(title()).toBe("2026년 10월");
    expect(textOf(root())).toContain("이달에는 연락할 업체가 없습니다");
  });

  it("칩을 누르면 그 업체를 고르고, 같은 칩을 또 누르면 접는다", async () => {
    const onSelect = draw();
    await mounted?.click(buttonsWith(root(), /가나상사/)[0]);
    expect(onSelect).toHaveBeenLastCalledWith("c1");
    mounted?.unmount();
    const onSelectAgain = draw("c1");
    await mounted?.click(buttonsWith(root(), /가나상사/)[0]);
    expect(onSelectAgain).toHaveBeenLastCalledWith(null);
  });

  it("고른 업체 판은 고른 업체가 줄에 있을 때만 열리고, 「닫기」는 고른 것을 비운다", async () => {
    const onSelect = draw("c1");
    expect(textOf(root())).toContain("공고 표: 가나상사");
    await mounted?.click(buttonsWith(root(), "닫기")[0]);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    draw("없는열쇠");
    expect(textOf(root())).not.toContain("공고 표");
    expect(buttonsWith(root(), "닫기")).toHaveLength(0);
  });
});

describe("ContactsBoard 캘린더 보기", () => {
  const announcement = {
    bucketKey: "b1", repAnnouncementId: "a1", title: "공고 하나", agency: "기관", category: "정책자금", url: "", applyEnd: "2026-11-20", dDay: 6,
    verdict: "fit", fitLabels: ["업력"], toCheck: [], gaps: [], progress: null,
  };
  const single = contact({ kinds: [{ category: "정책자금", count: 1, nearestDDay: 6 }], announcementCount: 1 });
  const progressResult = {
    created: true, trackCreated: true, trackId: "t1", policyName: "공고 하나", companyName: "가나상사", todo: "신청 마감", due: "2026-11-20",
    progress: { byName: "김컨설", via: "web", at: "2026-11-14T00:00:00.000Z" },
  };

  function serve() {
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/deadline/progress") && init?.method === "POST") return Promise.resolve(jsonResponse({ success: true, data: progressResult }));
      if (url.includes("view=contacts")) return Promise.resolve(jsonResponse({ success: true, data: { companies: [single] } }));
      if (url.includes("view=company")) return Promise.resolve(jsonResponse({ success: true, data: { company: { customerKey: "c1", companyName: "가나상사" }, announcements: [announcement] } }));
      return new Promise<Response>(() => {});
    });
  }
  const draw = async (view: "list" | "calendar") => {
    serve();
    mounted?.unmount();
    mounted = mountTree(<ContactsBoard scope="all" endpoints={DEADLINE_ENDPOINTS} view={view} now={NOW} onDetail={() => {}} />, { opaque: OPAQUE });
    await mounted.settle();
  };

  it("보기 값에 따라 목록 또는 캘린더를 그리고, 거르기 줄은 같다", async () => {
    await draw("list");
    expect(findAll(root(), (n) => n.tag === "h3")).toHaveLength(0);
    expect(find(root(), (n) => n.props["aria-label"] === "거르기")?.tag).toBe("div");
    await draw("calendar");
    expect(textOf(find(root(), (n) => n.tag === "h3") ?? [])).toBe("2026년 11월");
    expect(find(root(), (n) => n.props["aria-label"] === "거르기")?.tag).toBe("div");
  });

  it("칩을 누르면 그 업체의 공고 표를 읽어 「고른 업체」 판에 보이고, 담당은 showConsultant 를 따른다", async () => {
    await draw("calendar");
    await mounted?.click(buttonsWith(root(), /가나상사/)[0]);
    const panel = find(root(), (n) => n.props["aria-label"] === "고른 업체");
    expect(textOf(panel ?? [])).toContain("담당 김컨설 · 가장 가까운 마감 11/20(금) · 공고 1건");
    expect(textOf(panel ?? [])).toContain("공고 하나");
    expect(buttonsWith(panel ?? root(), "업무 현황에 추가")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("view=company"))).toHaveLength(1);
  });

  it("「업무 현황에 추가」 하면 같은 알림이 뜨고, 「진행 중 포함」이 꺼져 있으면 칩이 사라진다", async () => {
    await draw("calendar");
    await mounted?.click(buttonsWith(root(), /가나상사/)[0]);
    const panel = find(root(), (n) => n.props["aria-label"] === "고른 업체");
    await mounted?.click(buttonsWith(panel ?? root(), "업무 현황에 추가")[0]);
    const toast = find(root(), (n) => n.tag === "DeadlineToast");
    expect((toast?.props.notice as { text: string }).text).toBe("가나상사 · 컨설팅 업무 현황에 「공고 하나」 추가 · 할 일 「신청 마감」 · 기한 11/20(금)");
    expect(buttonsWith(root(), /가나상사/)).toHaveLength(0);
    expect(textOf(root())).toContain("연락할 업체가 없습니다");
    expect(find(root(), (n) => n.props["aria-label"] === "고른 업체")).toBeUndefined();
  });
});
