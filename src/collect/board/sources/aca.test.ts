import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const create = vi.fn();
const updateMany = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyAnnouncement: {
      upsert: (...a: unknown[]) => upsert(...a),
      create: (...a: unknown[]) => create(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

import { acaConfig, acaListUrl, acaTargetOf, isAcaDropTitle, parseAcaList } from "./aca";
import { parseHtml, normalizeDateText } from "../html";
import { upgradeTruncatedTitle } from "../title-upgrade";
import { harvestBoardAttachments } from "../detail-fill";
import { parseApplyPeriod } from "../../../engine/types";
import { upsertAnnouncements } from "@/lib/services/policy-match/store";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "..", "__fixtures__", name), "utf-8");

/** 쪽 크기 500 응답(분류 하나) — 행 20개만 남기고 `Total Pages 1` 문구는 그대로. 앞에 미끼 표가 있다. */
const list = fixture("aca-list.html");
/** 쪽 크기를 무시해 15쪽으로 나뉜 옛 응답(rcp 기본 10) — 「중단」 판정용. */
const listSplit = fixture("aca-list-split.html");
const listSmall = fixture("aca-list-sbtp0011.html");
const detail = fixture("aca-detail.html");
const detailNoAttach = fixture("aca-detail-noattach.html");

describe("안양산업진흥원(aca) 목록", () => {
  it("1쪽(마케팅지원)에서 20건을 뽑고 첫 줄이 실측과 같다", () => {
    const rows = parseAcaList(list, 1);
    expect(rows).toHaveLength(20);
    const first = rows[0];
    // ★목록 제목은 서버가 20자에서 자른 채로 온다 — 여기서는 잘린 그대로 담는 게 맞다.
    expect(first.title).toBe("2026년 안양시 유망기업 온‧오프라...");
    expect(first.title.endsWith("...")).toBe(true);
    expect(first.dateText).toBe("2026-08-20 ~ 2026-09-04");
    expect(first.detailUrl).toBe("https://aca.or.kr/support/supportBizView.do?sbIdx=541");
    expect(first.agency).toBe("안양산업진흥원");
    expect(first.category).toBe("마케팅지원 · 진행완료");
  });

  /**
   * ★행 선택자를 지키는 시험(2026-09-05 독립 검사 보강).
   * 고정본 맨 앞에 **미끼 표**를 끼워 뒀다 — `table.table-hover` 로 좁히지 않고
   * `querySelectorAll("tr")` 같은 넓은 선택자로 바꾸면 이 줄이 공고로 저장된다.
   */
  it("목록 표 밖의 다른 표(미끼)는 담지 않는다", () => {
    expect(list).toContain("sbIdx=99999"); // 고정본에 미끼가 실제로 들어 있다
    const rows = parseAcaList(list, 1);
    expect(rows.some((r) => r.detailUrl.includes("99999"))).toBe(false);
    expect(rows.some((r) => r.title.includes("미끼"))).toBe(false);
  });

  it("접수기간을 시작·마감 둘 다 준다 — 모든 줄이 「시작 ~ 마감」 꼴이다", () => {
    for (const r of parseAcaList(list, 1)) {
      expect(r.dateText, r.title).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
    }
  });

  it("진행중인 줄은 상태가 category 에 남는다 — 닫힘은 마감일이 정한다", () => {
    const rows = parseAcaList(list, 1);
    const open = rows.find((r) => r.title.startsWith("2026년 중소기업 수출보험"));
    expect(open?.category).toBe("마케팅지원 · 진행중");
    expect(open?.dateText).toBe("2026-03-09 ~ 2026-11-30");
  });

  it("상세 주소에 sbPart·menuId·쪽 번호가 안 들어간다 — 한 사업이 두 줄로 저장되지 않게", () => {
    for (const r of [...parseAcaList(list, 1), ...parseAcaList(listSmall, 8)]) {
      expect(r.detailUrl, r.title).toMatch(
        /^https:\/\/aca\.or\.kr\/support\/supportBizView\.do\?sbIdx=\d+$/,
      );
    }
  });

  it("가장 작은 분류(중장년센터 6건)도 expectMinRows 4 를 넘는다", () => {
    const rows = parseAcaList(listSmall, 8);
    expect(rows).toHaveLength(6);
    expect(rows.length).toBeGreaterThanOrEqual(acaConfig.expectMinRows ?? 0);
    expect(rows[0].category?.startsWith("중장년센터")).toBe(true);
  });

  /** ★서버가 쪽 크기를 무시하면 조용히 잃지 말고 소리 나게 멈춘다(독립 검사 지적 5). */
  it("Total Pages 가 1보다 크면 중단한다 — 쪽 크기를 무시당한 채로 앞 10건만 담지 않게", () => {
    expect(listSplit).toContain("Total Pages");
    expect(() => parseAcaList(listSplit, 1)).toThrow(/쪽 크기.*무시.*15쪽/);
  });

  it("분류 8개가 1~8쪽에 정확히 하나씩 대응한다", () => {
    const targets = Array.from({ length: 8 }, (_, i) => acaTargetOf(i + 1));
    expect(targets.map((t) => t.code)).toEqual([
      "sbtp0001", "sbtp0002", "sbtp0003", "sbtp0004",
      "sbtp0005", "sbtp0007", "sbtp0010", "sbtp0011",
    ]);
    expect(targets.map((t) => t.menuId)).toEqual([
      "849", "850", "851", "853", "852", "854", "1169", "1222",
    ]);
    // 한 바퀴는 전부 1쪽이다 — 분류마다 500행 한 쪽에 다 들어온다.
    expect(new Set(targets.map((t) => t.page))).toEqual(new Set([1]));
    expect(acaConfig.list.maxPages).toBe(8);
    // ★한 바퀴 도는 동안 「신규 0」으로 끊기지 않게 한 바퀴 길이를 준다.
    expect(acaConfig.emptyStreakStop).toBe(8);
  });

  it("쪽 주소에 page 와 recordCountPerPage 가 들어간다 — 분류가 한 쪽에 다 담기게", () => {
    expect(acaListUrl(1)).toBe(
      "https://aca.or.kr/support/supportBizList/sbtp0001.do?menuId=849&page=1&recordCountPerPage=500",
    );
    expect(acaListUrl(9)).toBe(
      "https://aca.or.kr/support/supportBizList/sbtp0001.do?menuId=849&page=2&recordCountPerPage=500",
    );
  });

  it("국내 경유 전용이라 requiresProxy 가 켜져 있다", () => {
    expect(acaConfig.requiresProxy).toBe(true);
  });

  it("결과 알림·입찰은 버리고 「채용」이 든 지원사업은 버리지 않는다", () => {
    expect(isAcaDropTitle("2026년 지원사업 선정 결과 발표")).toBe(true);
    expect(isAcaDropTitle("사무기기 구매 입찰 공고")).toBe(true);
    expect(isAcaDropTitle("청년 채용 지원사업 참여기업 모집")).toBe(false);
  });
});

describe("안양산업진흥원(aca) 저장 경로", () => {
  beforeEach(() => {
    upsert.mockReset().mockResolvedValue({});
    create.mockReset().mockResolvedValue({});
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    findMany.mockReset().mockResolvedValue([]);
  });

  /** ★목록 접수기간이 저장 단계까지 살아 applyStart·applyEnd 가 되고, 지난 공고는 닫힌다. */
  it("접수기간이 applyStart·applyEnd 로 채워지고 과거 마감은 closed 로 저장된다", async () => {
    const row = parseAcaList(list, 1)[0]; // 2026-08-20 ~ 2026-09-04
    const { start, end } = parseApplyPeriod(normalizeDateText(row.dateText));
    expect(start?.toISOString()).toBe("2026-08-19T15:00:00.000Z"); // KST 08-20 00:00
    expect(end?.toISOString()).toBe("2026-09-04T14:59:59.000Z"); // KST 09-04 23:59:59

    const now = new Date("2026-09-30T00:00:00Z"); // 마감 뒤
    await upsertAnnouncements(
      [{
        source: acaConfig.id, sourceId: row.detailUrl, title: row.title,
        agency: row.agency ?? acaConfig.agency, category: row.category ?? "",
        region: acaConfig.region, summary: "", targetText: "",
        applyStart: start, applyEnd: end, applyPeriodText: normalizeDateText(row.dateText),
        url: row.detailUrl, attachments: [], raw: {},
      }],
      now,
    );
    const data = (updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("closed");
    expect(data.applyEnd).toEqual(end);
  });

  /**
   * ★승격 전 임시 열쇠(독립 검사 지적 3) — 앞 20자가 같은 **서로 다른** 공고가
   * 한 열쇠로 뭉쳐 결과 목록에서 한 줄로 접히면 안 된다.
   */
  it("잘린 제목이 같은 두 줄은 서로 다른 열쇠를 받는다", async () => {
    const mk = (sbIdx: string) => ({
      source: acaConfig.id, sourceId: `https://aca.or.kr/support/supportBizView.do?sbIdx=${sbIdx}`,
      title: "2026년 안양시 유망기업 온‧오프라...", agency: "안양산업진흥원",
      category: "마케팅지원", region: "경기", summary: "", targetText: "",
      applyStart: null, applyEnd: null, applyPeriodText: "",
      url: `https://aca.or.kr/support/supportBizView.do?sbIdx=${sbIdx}`, attachments: [], raw: {},
    });
    await upsertAnnouncements([mk("541"), mk("540")], new Date("2026-09-01T00:00:00Z"));
    const keys = updateMany.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data.dedupKey as string,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    for (const k of keys) expect(k).toContain("#https://aca.or.kr");
  });

  it("제목이 승격되면 임시 표식이 빠진 정상 열쇠가 된다", async () => {
    findMany.mockResolvedValue([
      {
        source: acaConfig.id,
        sourceId: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
        targetText: "", summary: "", applyPeriodText: "",
        title: "2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업",
      },
    ]);
    await upsertAnnouncements(
      [{
        source: acaConfig.id, sourceId: "https://aca.or.kr/support/supportBizView.do?sbIdx=541",
        title: "2026년 안양시 유망기업 온‧오프라...", agency: "안양산업진흥원",
        category: "마케팅지원", region: "경기", summary: "", targetText: "",
        applyStart: null, applyEnd: null, applyPeriodText: "",
        url: "https://aca.or.kr/support/supportBizView.do?sbIdx=541", attachments: [], raw: {},
      }],
      new Date("2026-09-01T00:00:00Z"),
    );
    const data = (updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.title).toBe("2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업");
    expect(data.dedupKey).not.toContain("#");
  });
});

describe("안양산업진흥원(aca) 상세", () => {
  const titleOf = (html: string) =>
    (parseHtml(html).querySelector(acaConfig.detailTitle!.selector)?.text ?? "")
      .replace(acaConfig.detailTitle!.strip!, "")
      .replace(/\s+/g, " ")
      .trim();

  it("본문 선택자가 첫 문장을 집는다", () => {
    const body = (parseHtml(detail).querySelector(acaConfig.detailContentSelector!)?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(body).toContain("소비재 관련 안양시 유망기업 우수 제품의 판매촉진");
  });

  it("첨부 2건의 이름·주소를 집는다", () => {
    const scoped = parseHtml(detail)
      .querySelectorAll(acaConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    const atts = harvestBoardAttachments(scoped, acaConfig.baseUrl, detail);
    expect(atts.map((a) => a.name)).toEqual(["공고문.hwp", "신청서류 및 매뉴얼.hwp"]);
    expect(atts.map((a) => a.url)).toEqual([
      "https://aca.or.kr/cmmn/download.do?idx=45383",
      "https://aca.or.kr/cmmn/download.do?idx=45384",
    ]);
  });

  it("첨부가 없는 상세는 빈 배열 — 바닥글의 다른 파일을 끌어오지 않는다", () => {
    const scoped = parseHtml(detailNoAttach)
      .querySelectorAll(acaConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(harvestBoardAttachments(scoped, acaConfig.baseUrl, detailNoAttach)).toEqual([]);
  });

  it("★상세 제목이 목록의 잘린 제목을 온전한 제목으로 올린다", () => {
    const listTitle = parseAcaList(list, 1)[0].title;
    const full = titleOf(detail);
    expect(full).toBe("2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업");
    expect(upgradeTruncatedTitle(listTitle, full)).toBe(
      "2026년 안양시 유망기업 온‧오프라인 유통망 입점 지원사업",
    );
  });

  it("`[사업안내] - ` 접두를 떼지 않으면 승격이 안 된다 — strip 설정이 필요한 이유", () => {
    const listTitle = parseAcaList(list, 1)[0].title;
    const raw = (parseHtml(detail).querySelector(acaConfig.detailTitle!.selector)?.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(raw.startsWith("[사업안내] -")).toBe(true);
    expect(upgradeTruncatedTitle(listTitle, raw)).toBeNull();
  });

  /** ★목록 거르개가 못 본 「결과 발표」를 온전한 제목에서 잡는다(독립 검사 지적 8). */
  it("승격 뒤 거르개가 목록에서 못 걸러진 결과 알림을 잡는다", () => {
    expect(acaConfig.detailTitle?.drop).toBeDefined();
    // 목록에선 20자에서 잘려 「… 지식재산권 출원 지원사업 (」 까지만 보여 통과한다.
    expect(isAcaDropTitle("2025 지식재산권 출원 지원사업 (")).toBe(false);
    // 온전한 제목을 보면 걸린다.
    expect(acaConfig.detailTitle!.drop!.test("2025 지식재산권 출원 지원사업 (선정 결과 발표)")).toBe(true);
  });
});
