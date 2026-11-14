/**
 * 정책별 고객사 읽기 통로(`GET /api/policy-track/deadline`)의 본문 — 두 앱의 통로가 같은 코드를 부른다.
 *
 * 로그인·권한·「누가 어느 범위를 보나」는 앱 몫이다. 앱은 `scopeOf` 로 보는 범위를 정해 넘기고(막을 때는
 * `DeadlineReadError` 를 던진다), 이 함수가 돌려준 `{ status, body }` 를 응답으로 감싸기만 한다.
 * 앱의 로그인 오류는 앱이 이 함수를 부르기 전에 처리하므로 여기에는 없다.
 */
import { BadDeadlineQuery, parseDeadlineQuery, type RequestedScope } from "./query";
import {
  readAnnouncementList,
  readBucketCompanies,
  readCompanyAnnouncements,
  readContacts,
  readExport,
  readSummary,
} from "./read";
import { DeadlineReadError, type DeadlineScope } from "./scope";
import type { ReadSource } from "./types";

export type { RequestedScope } from "./query";

export interface DeadlineGetDeps {
  now: Date;
  src: ReadSource;
  /** 엑셀 줄(view=export)을 이 앱이 내주는가. false 면 403. */
  allowExport: boolean;
}

export type DeadlineGetBody =
  | { success: true; data: unknown }
  | { success: false; error: { code: string; message: string } };

export interface DeadlineGetResult {
  status: number;
  body: DeadlineGetBody;
}

function fail(status: number, code: string, message: string): DeadlineGetResult {
  return { status, body: { success: false, error: { code, message } } };
}

function ok(data: unknown): DeadlineGetResult {
  return { status: 200, body: { success: true, data } };
}

export async function handleDeadlineGet(
  params: URLSearchParams,
  scopeOf: (requested: RequestedScope) => DeadlineScope | Promise<DeadlineScope>,
  deps: DeadlineGetDeps,
): Promise<DeadlineGetResult> {
  try {
    const query = parseDeadlineQuery(params);
    if (query.view === "export" && !deps.allowExport) {
      return fail(403, "FORBIDDEN", "엑셀 내려받기를 쓸 수 없습니다.");
    }
    const { now, src } = deps;

    // 업체 보기는 요청한 범위를 보지 않는다 — 앱이 「이 사람이 볼 수 있는 전부」를 정해 준다.
    const scope = await scopeOf(query.view === "company" ? null : query.scope);

    switch (query.view) {
      case "list":
        return ok(await readAnnouncementList(scope, { days: query.days, hideEmpty: query.hideEmpty }, now, src));
      case "bucket": {
        const data = await readBucketCompanies(scope, { bucketKey: query.bucketKey }, now, src);
        return data ? ok(data) : fail(404, "NOT_FOUND", "공고를 찾지 못했습니다.");
      }
      case "contacts":
        return ok(
          await readContacts(
            scope,
            { days: query.days, includeUnstructured: query.includeUnstructured, includeProgress: query.includeProgress },
            now,
            src,
          ),
        );
      case "company": {
        const data = await readCompanyAnnouncements(
          scope,
          {
            customerKey: query.customerKey,
            days: query.days,
            includeUnstructured: query.includeUnstructured,
            includeProgress: query.includeProgress,
          },
          now,
          src,
        );
        return data ? ok(data) : fail(404, "NOT_FOUND", "업체를 찾지 못했습니다.");
      }
      case "summary":
        return ok(await readSummary(scope, now, src));
      case "export":
        return ok(
          await readExport(
            scope,
            { days: query.days, fitOnly: query.fitOnly, ...(query.category !== undefined ? { category: query.category } : {}) },
            now,
            src,
          ),
        );
    }
  } catch (error) {
    if (error instanceof BadDeadlineQuery) return fail(400, "BAD_REQUEST", error.message);
    if (error instanceof DeadlineReadError) return fail(error.status, error.code, error.message);
    console.error("[policy-deadline] 읽기 실패", error instanceof Error ? error.name : "unknown");
    return fail(500, "INTERNAL", "공고 대조 결과를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
