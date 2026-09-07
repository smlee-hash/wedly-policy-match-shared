/**
 * 공고 목록(browse) — 묶음(dedupKey) 단위 쪽나눔.
 * SQL 문장은 ERP 원문과 **글자 단위로 같다**(DISTINCT ON·동률 깨기 id ASC 포함).
 * 바뀐 것은 `Prisma.sql` → `q.sql` 처럼 **주입받은 창구를 쓰는 것뿐**이다.
 */
import type { ServeQuery } from "./types";

export const BROWSE_PAGE_SIZE = 50;
/** 묶음 구성원 id 목록 상한(응답 크기 방어 — 현실 묶음은 수십 이하). */
const GROUP_IDS_CAP = 50;
/** 펼침 구성원 조회 상한. */
const MEMBERS_CAP = 100;

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function clampPage(n: number): number {
  return Math.max(1, Number.isFinite(n) ? Math.floor(n) : 1);
}

export type BrowseGroupParams = { q: string; category: string; region: string; status: string; page: number };

export type BrowseGroupRow = {
  id: string; source: string; title: string; agency: string; category: string; region: string;
  summary: string; targetText: string; applyStart: Date | null; applyEnd: Date | null;
  applyPeriodText: string; url: string; status: string; dedupKey: string; firstSeenAt: Date;
  groupCount: number; groupIds: string[];
};

type Q = Pick<ServeQuery, "sql" | "join" | "raw" | "queryRaw" | "findAnnouncements">;

function whereFrag(db: Q, p: BrowseGroupParams): unknown {
  const conds: unknown[] = [];
  if (p.status !== "all") conds.push(db.sql`"status" = ${p.status}`);
  // 기존 contains(대소문자 구분)와 동일하게 LIKE, q 만 insensitive(ILIKE) — 기존 라우트와 같은 동작.
  if (p.category) conds.push(db.sql`"category" LIKE ${`%${escapeLike(p.category)}%`}`);
  if (p.region) conds.push(db.sql`"region" LIKE ${`%${escapeLike(p.region)}%`}`);
  if (p.q) {
    const like = `%${escapeLike(p.q)}%`;
    conds.push(db.sql`("title" ILIKE ${like} OR "agency" ILIKE ${like} OR "summary" ILIKE ${like} OR "targetText" ILIKE ${like})`);
  }
  return conds.length ? db.join(conds, " AND ") : db.sql`TRUE`;
}

// 맨 뒤 id 는 동률 깨기 — 수집 작업이 여러 행에 같은 lastSeenAt 을 남기므로, 이게 없으면
// DISTINCT ON 대표 선택과 쪽 경계가 실행마다 달라질 수 있다(적대 리뷰 지적).
function orderFrag(db: Q, status: string): unknown {
  return status === "open"
    ? db.sql`"applyEnd" ASC NULLS LAST, "lastSeenAt" DESC, id ASC`
    : db.sql`"lastSeenAt" DESC, id ASC`;
}

/** browse 목록을 묶음(dedupKey) 단위로 쪽나눔해 준다. 대표 = 기존 정렬 첫 행, total = 묶음 수. */
export async function listBrowseGroups(
  db: Q,
  p: BrowseGroupParams,
): Promise<{ rows: BrowseGroupRow[]; total: number }> {
  const where = whereFrag(db, p);
  const order = orderFrag(db, p.status);
  const offset = (clampPage(p.page) - 1) * BROWSE_PAGE_SIZE;

  const [rows, totals] = await Promise.all([
    db.queryRaw<Omit<BrowseGroupRow, "groupCount" | "groupIds"> & { groupCount: number; groupIds: string[] }>(db.sql`
      WITH filtered AS (
        SELECT id, source, title, agency, category, region, summary,
               "targetText", "applyStart", "applyEnd", "applyPeriodText", url, status,
               "dedupKey", "firstSeenAt", "lastSeenAt",
               COALESCE(NULLIF("dedupKey", ''), id) AS grp
        FROM "PolicyAnnouncement"
        WHERE ${where}
      ),
      reps AS (
        SELECT DISTINCT ON (grp) *
        FROM filtered
        ORDER BY grp, ${order}
      ),
      counts AS (
        SELECT grp, COUNT(*)::int AS "groupCount",
               (ARRAY_AGG(id ORDER BY ${order}))[1:${db.raw(String(GROUP_IDS_CAP))}] AS "groupIds"
        FROM filtered
        GROUP BY grp
      )
      SELECT r.id, r.source, r.title, r.agency, r.category, r.region, r.summary,
             r."targetText", r."applyStart", r."applyEnd", r."applyPeriodText", r.url, r.status,
             r."dedupKey", r."firstSeenAt", c."groupCount", c."groupIds"
      FROM reps r JOIN counts c USING (grp)
      ORDER BY ${order}
      LIMIT ${BROWSE_PAGE_SIZE} OFFSET ${offset}
    `),
    db.queryRaw<{ n: number }>(db.sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT DISTINCT COALESCE(NULLIF("dedupKey", ''), id)
        FROM "PolicyAnnouncement"
        WHERE ${where}
      ) g
    `),
  ]);
  return { rows: rows as BrowseGroupRow[], total: totals[0]?.n ?? 0 };
}

/**
 * 한 묶음의 구성원(펼침용). 빈 키는 묶음이 아니므로 빈 배열.
 * 목록과 **같은 필터**로 거른다 — 「외 N건」 수(필터 기준)와 펼친 내용이 어긋나면 안 된다(적대 리뷰 지적).
 */
export async function listGroupMembers(
  db: Q,
  dedupKey: string,
  p: Omit<BrowseGroupParams, "page">,
) {
  const key = dedupKey.trim();
  if (!key) return [];
  return db.findAnnouncements<Omit<BrowseGroupRow, "groupCount" | "groupIds">>({
    where: {
      dedupKey: key,
      ...(p.status !== "all" ? { status: p.status } : {}),
      ...(p.category ? { category: { contains: p.category } } : {}),
      ...(p.region ? { region: { contains: p.region } } : {}),
      ...(p.q ? { OR: [
        { title: { contains: p.q, mode: "insensitive" } },
        { agency: { contains: p.q, mode: "insensitive" } },
        { summary: { contains: p.q, mode: "insensitive" } },
        { targetText: { contains: p.q, mode: "insensitive" } },
      ] } : {}),
    },
    orderBy: [
      { applyEnd: { sort: "asc", nulls: "last" } },
      { lastSeenAt: "desc" },
      { id: "asc" },
    ],
    take: MEMBERS_CAP,
    select: { id: true, source: true, title: true, agency: true, category: true, region: true,
      summary: true, targetText: true, applyStart: true, applyEnd: true, applyPeriodText: true,
      url: true, status: true, dedupKey: true, firstSeenAt: true },
  });
}

/** 앱이 한 번 물려 두고 쓰는 묶음. */
export function makeBrowseGroups(db: Q) {
  return {
    listBrowseGroups: (p: BrowseGroupParams) => listBrowseGroups(db, p),
    listGroupMembers: (dedupKey: string, p: Omit<BrowseGroupParams, "page">) =>
      listGroupMembers(db, dedupKey, p),
    clampPage,
    escapeLike,
    BROWSE_PAGE_SIZE,
  };
}
