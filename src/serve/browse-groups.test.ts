import { describe, expect, it, vi } from "vitest";
import {
  BROWSE_PAGE_SIZE,
  clampPage,
  escapeLike,
  listBrowseGroups,
  listGroupMembers,
} from "./browse-groups";

describe("escapeLike — LIKE 특수문자 이스케이프", () => {
  it("%·_·\\ 를 이스케이프한다", () => {
    expect(escapeLike("100%_지원\\")).toBe("100\\%\\_지원\\\\");
  });
  it("보통 글자는 그대로", () => {
    expect(escapeLike("창업 지원")).toBe("창업 지원");
  });
});

describe("clampPage — 쪽 번호 보정", () => {
  it("1 미만·숫자 아님은 1", () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(NaN)).toBe(1);
  });
  it("정상 값은 그대로", () => {
    expect(clampPage(3)).toBe(3);
  });
});

/* ── SQL 문장을 글자로 잡아 두는 가짜 창구 ───────────────────────────────
 * 값은 `$1`·`$2` 로, 조각(`sql`/`raw`/`join`)은 그 자리에 펴서 그린다.
 * ★이 시험이 지키는 것: 옮기면서 문장이 한 글자라도 달라지면 목록의 대표 선택·쪽 경계가
 *  달라진다. 「옮기기 + 주입」이라는 약속을 이 파일이 실제로 지키는지 잰다. */
type Frag = { __sql: true; text: string; values: unknown[] };
const isFrag = (v: unknown): v is Frag =>
  !!v && typeof v === "object" && (v as Frag).__sql === true;

/** 값 자리 표식 — 조각을 다 펴고 나서 앞에서부터 `$1`·`$2` 로 번호를 매긴다(Prisma 와 같은 순서). */
const SLOT = "\u0000";

function render(frag: Frag): { text: string; values: unknown[] } {
  let i = 0;
  return { text: frag.text.replaceAll(SLOT, () => `$${++i}`), values: frag.values };
}

function fakeDb() {
  const captured: Array<{ text: string; values: unknown[] }> = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]): Frag => {
    let text = "";
    const out: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i >= values.length) return;
      const v = values[i];
      if (isFrag(v)) {
        text += v.text;
        out.push(...v.values);
      } else {
        out.push(v);
        text += SLOT;
      }
    });
    return { __sql: true, text, values: out };
  };
  const raw = (s: string): Frag => ({ __sql: true, text: s, values: [] });
  const join = (parts: unknown[], sep: string): Frag => ({
    __sql: true,
    text: parts.map((p) => (isFrag(p) ? p.text : String(p))).join(sep),
    values: parts.flatMap((p) => (isFrag(p) ? p.values : [p])),
  });
  const findMany = vi.fn(async (_args: unknown) => [] as unknown[]);
  const db = {
    sql,
    raw,
    join,
    queryRaw: vi.fn(async (frag: unknown) => {
      captured.push(render(frag as Frag));
      return captured.length === 2 ? ([{ n: 7 }] as never) : ([] as never);
    }),
    findAnnouncements: findMany,
  } as never;
  return { db, captured, findMany };
}

/** ERP `services/policy-match/browse-groups.ts` 원문과 **글자 단위로 같은** 목록 문장. */
const EXPECTED_LIST_SQL = `
      WITH filtered AS (
        SELECT id, source, title, agency, category, region, summary,
               "targetText", "applyStart", "applyEnd", "applyPeriodText", url, status,
               "dedupKey", "firstSeenAt", "lastSeenAt",
               COALESCE(NULLIF("dedupKey", ''), id) AS grp
        FROM "PolicyAnnouncement"
        WHERE "status" = $1
      ),
      reps AS (
        SELECT DISTINCT ON (grp) *
        FROM filtered
        ORDER BY grp, "applyEnd" ASC NULLS LAST, "lastSeenAt" DESC, id ASC
      ),
      counts AS (
        SELECT grp, COUNT(*)::int AS "groupCount",
               (ARRAY_AGG(id ORDER BY "applyEnd" ASC NULLS LAST, "lastSeenAt" DESC, id ASC))[1:50] AS "groupIds"
        FROM filtered
        GROUP BY grp
      )
      SELECT r.id, r.source, r.title, r.agency, r.category, r.region, r.summary,
             r."targetText", r."applyStart", r."applyEnd", r."applyPeriodText", r.url, r.status,
             r."dedupKey", r."firstSeenAt", c."groupCount", c."groupIds"
      FROM reps r JOIN counts c USING (grp)
      ORDER BY "applyEnd" ASC NULLS LAST, "lastSeenAt" DESC, id ASC
      LIMIT $2 OFFSET $3
    `;

const EXPECTED_TOTAL_SQL = `
      SELECT COUNT(*)::int AS n FROM (
        SELECT DISTINCT COALESCE(NULLIF("dedupKey", ''), id)
        FROM "PolicyAnnouncement"
        WHERE "status" = $1
      ) g
    `;

const P = { q: "", category: "", region: "", status: "open", page: 1 };

describe("listBrowseGroups — 문장이 원문 그대로인가", () => {
  it("목록 문장·묶음 수 문장이 ERP 원문과 글자 단위로 같다", async () => {
    const { db, captured } = fakeDb();
    await listBrowseGroups(db, P);
    expect(captured).toHaveLength(2);
    expect(captured[0].text).toBe(EXPECTED_LIST_SQL);
    expect(captured[1].text).toBe(EXPECTED_TOTAL_SQL);
  });

  it("쪽 크기·건너뛰기는 값으로 나간다 — 2쪽이면 50 건너뛴다", async () => {
    const { db, captured } = fakeDb();
    await listBrowseGroups(db, { ...P, page: 2 });
    expect(captured[0].values).toEqual(["open", BROWSE_PAGE_SIZE, 50]);
  });

  it("status 가 all 이면 조건이 TRUE 하나 — 조건 값이 안 나간다", async () => {
    const { db, captured } = fakeDb();
    await listBrowseGroups(db, { ...P, status: "all" });
    expect(captured[0].text).toContain("WHERE TRUE");
    expect(captured[0].values).toEqual([BROWSE_PAGE_SIZE, 0]);
  });

  it("검색어는 ILIKE 넷을 OR 로 묶고 LIKE 특수문자를 막는다", async () => {
    const { db, captured } = fakeDb();
    await listBrowseGroups(db, { ...P, q: "100%", category: "창업", region: "서울" });
    expect(captured[0].text).toContain(
      `("title" ILIKE $4 OR "agency" ILIKE $5 OR "summary" ILIKE $6 OR "targetText" ILIKE $7)`,
    );
    expect(captured[0].values.slice(0, 4)).toEqual(["open", "%창업%", "%서울%", "%100\\%%"]);
  });

  it("모집중이 아니면 정렬이 lastSeenAt 부터다 — 마감 정렬을 안 쓴다", async () => {
    const { db, captured } = fakeDb();
    await listBrowseGroups(db, { ...P, status: "closed" });
    expect(captured[0].text).toContain(`ORDER BY grp, "lastSeenAt" DESC, id ASC`);
    expect(captured[0].text).not.toContain("applyEnd\" ASC NULLS LAST");
  });

  it("묶음 수는 두 번째 문장의 첫 줄 n 을 쓴다", async () => {
    const { db } = fakeDb();
    const r = await listBrowseGroups(db, P);
    expect(r.total).toBe(7);
  });
});

describe("listGroupMembers — 펼침", () => {
  it("빈 열쇠는 조회 없이 빈 배열", async () => {
    const { db, findMany } = fakeDb();
    expect(await listGroupMembers(db, "   ", P)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("목록과 같은 필터 + 같은 정렬 + 상한 100", async () => {
    const { db, findMany } = fakeDb();
    await listGroupMembers(db, "k1", { ...P, q: "창업", category: "경영", region: "서울" });
    const arg = findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
      take: number;
    };
    expect(arg.where.dedupKey).toBe("k1");
    expect(arg.where.status).toBe("open");
    expect(arg.where.category).toEqual({ contains: "경영" });
    expect(arg.where.region).toEqual({ contains: "서울" });
    expect(arg.where.OR).toEqual([
      { title: { contains: "창업", mode: "insensitive" } },
      { agency: { contains: "창업", mode: "insensitive" } },
      { summary: { contains: "창업", mode: "insensitive" } },
      { targetText: { contains: "창업", mode: "insensitive" } },
    ]);
    expect(arg.orderBy).toEqual([
      { applyEnd: { sort: "asc", nulls: "last" } },
      { lastSeenAt: "desc" },
      { id: "asc" },
    ]);
    expect(arg.take).toBe(100);
  });
});
