# `src/serve/` — 판정 통로 코어

ERP·정책매칭 랩이 **같은 계산**으로 진단·목록·상세·AI 판정·수집원 현황·첨부 내려받기를 내도록,
라우트 본문에서 **앱에 안 매인 부분만** 옮겨 온 곳이다. 계산은 한 글자도 안 바꿨다(옮기기 + 주입).

## 규칙 세 줄

1. **코어는 HTTP 도 DB 도 모른다.** 웹 응답·로그인 확인·Prisma·AI SDK 는 앱에 남는다.
   `no-app-imports.test.ts` 가 `next/server`·`@prisma/client`·`@anthropic-ai`·앱 별칭 경로를 0건으로 지킨다.
2. 앱은 `ServeQuery`(읽기·쓰기 창구)를 한 번 만들어 넘긴다 — 그 계약이 `types.ts` 에 있다.
3. **로그인 확인은 코어 앞에서** 한다. 코어의 어떤 함수도 「이 사람이 봐도 되는가」를 묻지 않는다.

## 결과 → HTTP 대응표 (ERP 원문과 **글자 단위로 같게** 감싼다)

성공은 `{ success: true, data }`, 실패는 `{ success: false, error: { code, message } }`.
모든 통로의 맨 앞에 **로그인 확인**이 있고, 없으면
`401 UNAUTHORIZED "로그인이 필요합니다."` — **수집원 현황만 마침표가 없다**(`"로그인이 필요합니다"`).
바깥 `try/catch` 의 마지막 그물도 통로마다 문구가 다르다(아래 「마지막 그물」).

### 진단 `POST /api/policy-match/diagnose` — `runDiagnose(profile, q)`

| 코어 결과 | HTTP | code | message |
|---|---|---|---|
| `{ ok: true, data }` | 200 | — | `data` 를 그대로 `data` 에 싣는다 |
| `{ ok: false, code: "BAD_PROFILE" }` | 400 | `BAD_PROFILE` | 코어가 준 `message` |

- ★ERP 원문에는 `BAD_PROFILE` 갈래가 **없다**(`parseBusinessProfile` 은 아무 입력이나 받아 빈 프로필을 만든다).
  계약에만 남겨 둔 자리이므로 지금은 절대 나오지 않는다 — 라우트는 한 줄로 막아만 두면 된다.
- 진단 기록 저장은 **앱 몫**: ERP `PolicyDiagnosis.create`, 랩 `PolicyLabDiagnosis`.
  원문대로 **실패해도 진단 결과는 그대로 돌려준다**(일지에만 남긴다).
- 마지막 그물: `500 SERVER_ERROR "진단에 실패했습니다."`

### 목록 `GET /api/policy-match/announcements` — `makeBrowseGroups(q)`

| 요청 | 코어 | 응답 |
|---|---|---|
| `?dedupKey=` 있음 | `listGroupMembers(key, params)` | `{ success: true, data: members }` |
| 그 밖 | `listBrowseGroups(params)` | `{ success: true, data: rows, total, page, pageSize, lastSyncAt }` |

- `page` 는 `clampPage(Number(...))`, `pageSize` 는 `BROWSE_PAGE_SIZE`(50).
- `lastSyncAt` 은 앱의 회차 시계(ERP `getLastSyncInfo()`)에서 온다 — 코어 밖이다.
- 마지막 그물: `500 SERVER_ERROR "공고를 불러오지 못했습니다."`

### 상세 `GET /api/policy-match/announcements/[id]`

ERP 는 중간에 AI 구조화를 끼우므로 **셋으로 나눠** 부른다(순서가 원문과 같아야 한다).

```
readAnnouncementDetailRow(q, id)   // 없으면 404
  → (ERP 만) noAi 아님 && !hasStoredSummary(row) && 예산 잡힘 → structurizeOne … 다시 읽기
  → toAnnouncementDetail(row)
```

| 코어 결과 | HTTP | code | message |
|---|---|---|---|
| 행 없음 · id 빈 문자열 | 404 | `NOT_FOUND` | `공고를 찾을 수 없습니다.` |
| 행 있음 | 200 | — | `toAnnouncementDetail(row)` |

- 랩처럼 구조화를 안 끼우는 앱은 `readAnnouncementDetail(q, id)` 한 번이면 된다
  (`{ status: "ok" | "not_found" }`).
- 마지막 그물: `500 SERVER_ERROR "공고를 불러오지 못했습니다."`

### AI 판정 `POST /api/policy-match/verdict` — `runVerdict(input, deps)`

| `status` | HTTP | code | message |
|---|---|---|---|
| `ok` | 200 | — | `data`(판정 + `cached`) |
| `bad_request` | 400 | `BAD_REQUEST` | 코어가 준 `message` |
| `not_found` | 404 | `NOT_FOUND` | `공고를 찾을 수 없습니다.` |
| `limit` | 429 | `DAILY_LIMIT` | 코어가 준 `message`(하루 상한 수가 들어 있다) |
| `ai_failed` | 502 | `AI_FAILED` | 코어가 준 `message` |

- `bad_request` 문구는 고정이 아니다. 공고 번호가 비면 「공고를 선택해 주세요.」,
  고객 자료 칸이 잘못되면 「고객 자료 형식이 올바르지 않습니다.」,
  최종 system+user 지시문이 앱 입력 상한(`MAX_AI_INPUT_BYTES` = 160000 UTF-8 바이트,
  여유 `AI_INPUT_OVERHEAD_BYTES` 포함)을 넘으면
  「고객 자료 전체가 한 번에 분석할 수 있는 크기를 넘습니다. 나눠서 검토해 주세요.」.
  상한을 넘으면 자료를 자르거나 빼지 않고, `reserve`·`callModel` 도 부르지 않는다.
  이 숫자는 앱 자원 한도이지 모든 모델의 토큰 한도가 아니며, 저장된 파일을 모두 읽었다는 증거도 아니다.
- `deps.customerEvidence` 는 **요청 본문에서 읽지 않는다.** 앱이 그 고객의 접근 권한을
  확인한 뒤에만 서버가 붙인다. 본문·판본 글자·불완전 여부를 캐시 열쇠에 **통째로** 넣는다
  (첨부처럼 앞머리+길이가 아니다). `incomplete: true` 이면 모델이나 캐시가 possible 을
  줘도 uncertain 으로 내리고, 완전히 확인됨으로 보고하지 말라는 이유를 붙인다.
- 최종 지시문은 한 번만 조립해 그 글자 그대로 `callModel` 에 넘긴다.
  호출 전에 모델이 HTTP 400 으로 맥락/입력이 너무 길다고 거절하면 하루 자리를 한 번
  돌려준다. 그 밖의 400 과 생성 후 `max_tokens` 끊김은 기존처럼 환불하지 않는다.
- 돌파구 호출은 이 코어 `runVerdict` 밖에 있다. 앱이 **같은**
  `@wedly/policy-match-shared/ai/customer-evidence` 의 `checkAiInputBytes` 가드와
  고객 자료 전체 지문 캐시를 스스로 붙여야 한다. 이 코어가 돌파구 예산·캐시를 지키지 않는다.
- `deps.callModel` 은 **앱이 자기 열쇠·자기 SDK 로** 부른다. 모델·상한은 코어 상수를 쓴다
  (`VERDICT_MODEL`·`VERDICT_MAX_TOKENS`·`VERDICT_AI_TIMEOUT_MS`·`VERDICT_AI_EFFORT`).
  응답에서 글자와 `stop_reason` 을 뽑아 `{ text, stopReason }` 으로만 돌려준다 —
  「거절·끊김·빈 답」을 사람 말로 옮기는 일은 코어가 한다.
- `deps.prompt` 는 `@wedly/policy-match-shared/ai/verdict` 모듈을 **통째로** 넘긴다.
- `deps.reserve/refund` 는 앱의 하루 예산 장부(ERP `reserveAiBudget({ minGapMs: 0, by })`·`refundAiBudget()`).
  `refund(by, n)` 인자는 ERP 구현이 안 쓴다 — 랩 장부가 쓰라고 남긴 자리다.
- `deps.isBillingOrAuthError` 는 ERP `services/policy-match/structurize.ts` 의 같은 이름 함수를 넘긴다.
- 랩은 열쇠가 없으면 `runVerdict` 를 부르기 전에
  `503 AI_NOT_CONFIGURED`(「AI 판정은 준비 중」)로 정직하게 실패한다(설계 결정 4).
- 마지막 그물: `500 SERVER_ERROR "정밀 판정에 실패했습니다."`

### 수집원 현황 `GET /api/policy-match/sources` — `buildSourcesSummary(...)`

앱이 넷을 읽어 넘긴다(원문과 같은 방어를 그대로 유지한다).

| 넘길 것 | ERP 가 읽는 곳 | 실패했을 때 |
|---|---|---|
| `names` | `collectSourceNames()`(`@wedly/policy-match-shared/collect/source-names`) | — |
| `countBy` | 공고 `groupBy(source)` + 상품 `groupBy(source, active)` → `mergeSourceCounts` | **상품 표 조회는 따로 감싼다** — 표가 없어도 화면 전체가 500 이 되면 안 된다 |
| `ledgerValue` | `JsonCache["policy-match-sync-ledger"].value` | `null` |
| `capRows`·`capsUnknown` | `JsonCache` 중 `board-cap:` 로 시작하는 줄 | 던지면 `capRows: []`·`capsUnknown: true` |

- 200: `{ success: true, data: { entries, summary } }`
- 마지막 그물: `500 INTERNAL "수집원 현황을 불러오지 못했습니다"`(**마침표 없음**)

### 첨부 내려받기 `GET /api/policy-match/announcements/[id]/attachments/[idx]`

`downloadAttachment(q, { id, idx, userKey, now, signal })`.
`userKey` 는 사람 한 명(ERP `user.id`), `signal` 은 `req.signal`.

| `kind` | HTTP | 라우트가 할 일 |
|---|---|---|
| `redirect` | 302 | `NextResponse.redirect(url, 302)` |
| `stream` | 200 | `new NextResponse(body, { status: 200, headers })` — `headers` 를 그대로 |
| `error` | `status` | `{ success: false, error: { code, message } }` + `headers`(있으면 `Retry-After`) |

나오는 오류: `404 NOT_FOUND` · `400 BAD_ATTACHMENT` · `429 TOO_MANY_REQUESTS` ·
`502 UPSTREAM_FAILED` · `502 NOT_A_FILE` · `500 SERVER_ERROR`.

- ★`logMessage` 는 **일지에만** 적는다. 응답에 실으면 경유 주소(비밀번호 포함)가 샐 수 있다.
- ★로그인 확인을 코어 앞에 두어야 「로그인 없으면 DB 도 안 본다」가 유지된다 —
  ERP 라우트 시험이 그것을 재고 있으니 그 시험을 지우지 마라.

## 정책별 고객사 통로 (`serve/policy-deadline/*`)

정책별 고객사·연락 예정 화면이 부르는 두 통로다 — ERP 와 컨설턴트 앱이 `GET`·`POST` 껍데기만 만들고 본문은 같은 코드를 부른다.
이 통로는 위 `ServeQuery` 를 쓰지 않는다. 읽기는 `ReadSource`(`deadlineReadSource(prisma)` 가 만든다), 진행은 `ProgressDeps` 를 앱이 넘긴다.
화면 쪽 쓰는 법은 `src/ui/policy-deadline/README.md`.

### 읽기 `GET /api/policy-track/deadline` — `handleDeadlineGet(params, scopeOf, { now, src, allowExport })`

로그인 확인은 앱이 이 함수 앞에서 한다(`401` 은 앱 몫). 이 함수는 `{ status, body }` 를 돌려주고 라우트는 `NextResponse.json(body, { status })` 만 한다.
`scopeOf(요청한 범위)` 가 `DeadlineScope`(`all`·`reader`·`keys`)를 돌려주고, 막을 때는 `DeadlineReadError` 를 던진다.
업체 보기(`view=company`)는 요청한 범위를 보지 않는다 — `scopeOf(null)` 로 부른다.

| 결과 | HTTP | 본문 |
|---|---|---|
| 읽기 성공 | 200 | `{ success: true, data }` |
| `days` 가 `7｜14｜30｜all` 이 아님 | 400 `BAD_REQUEST` | "days 는 7·14·30·all 중 하나입니다." |
| 거르기 값이 `0`·`1` 이 아님 | 400 `BAD_REQUEST` | "거르기 값은 0 또는 1 입니다." |
| `view` 가 모르는 값 | 400 `BAD_REQUEST` | "view 값이 올바르지 않습니다." |
| `scope` 가 `mine｜all` 이 아님 | 400 `BAD_REQUEST` | "보기 범위가 올바르지 않습니다." |
| 묶음 보기인데 공고 열쇠가 비었거나 300자 초과 | 400 `BAD_REQUEST` | "공고를 골라 주세요." |
| 업체 보기인데 업체 열쇠가 올바르지 않음 | 400 `BAD_REQUEST` | "업체를 골라 주세요." |
| 분류 값이 100자 초과 | 400 `BAD_REQUEST` | "분류 값이 너무 깁니다." |
| 엑셀 줄(`view=export`)인데 `allowExport` 가 거짓 | 403 `FORBIDDEN` | "엑셀 내려받기를 쓸 수 없습니다." |
| `scopeOf` 가 막음 | 던진 `DeadlineReadError` 의 status·code·message 그대로(ERP: 403 "관리자만 전체를 봅니다.") | |
| 묶음 보기인데 그 공고가 없음 | 404 `NOT_FOUND` | "공고를 찾지 못했습니다." |
| 업체 보기인데 그 업체가 없거나 범위 밖 | 404 `NOT_FOUND` | "업체를 찾지 못했습니다." |
| 그 밖의 예외 | 500 `INTERNAL` | "공고 대조 결과를 읽지 못했습니다. 잠시 후 다시 시도해 주세요." |

- 앞의 400 은 **범위를 정하기 전에** 나온다 — 그래서 `scopeOf` 가 부르는 곳(DB)에 닿지 않는다.
  엑셀 403 도 질의를 읽은 뒤·`scopeOf` 앞에서 나온다.
- 500 의 일지에는 오류 이름만 적는다(메시지·질의 값은 적지 않는다).

### 진행 `POST /api/policy-track/deadline/progress` — `readProgressBody(json)` → `startDeadlineProgress(input, now, deps)`

본문 해석과 진행이 던지는 `DeadlineProgressError` 는 status·code·message 그대로 응답한다. 앱은 본문 읽기와 진행 호출을 **같은 `try` 안에** 둔다.

| 결과 | HTTP | 본문 |
|---|---|---|
| 새로 만듦(`created: true`) | 201 | `{ success: true, data }` |
| 이미 진행돼 있어 그 줄을 돌려줌(`created: false`) | 200 | `{ success: true, data }` |
| 본문이 맞지 않음(`customerKey`·`bucketKey`) | 400 `BAD_REQUEST` | "업체와 공고를 골라 주세요." |
| `isAssigned` 가 거짓(없는 업체도 같은 403) | 403 `FORBIDDEN` | "이 업체 담당자만 누를 수 있습니다." |
| 담당 확인을 통과했는데 업체가 없음 | 404 `NOT_FOUND` | "업체를 찾지 못했습니다." |
| 그 업체에 맞는 판정 줄이 없음 | 404 `NOT_FOUND` | "이 업체에 맞는 공고가 아닙니다." |
| 공고 묶음을 못 읽음 | 404 `NOT_FOUND` | "공고를 찾지 못했습니다." |

앱이 넘기는 것(`ProgressDeps`): `readCompany` · `isAssigned(actor, company|null)`(담당 확인) · `isSamePolicyName`(정책 이름 같음 판정) ·
`hasMatch` · `readBucket` · `readProgress` · `findTracks` · `createTrack`·`insertProgress`(같은 값이 이미 있으면 `code === "P2002"` 인 오류를 던진다) ·
`appendHistory`(실패해도 진행은 성공이다). 새 정책을 만들었을 때만 분야 히스토리에 「(정책별 고객사에서 시작)」
(슬랙이면 「(정책별 고객사 · 슬랙에서 시작)」)가 한 줄 남는다.

## 앱이 만드는 `ServeQuery` (요약)

`Prisma.sql`/`Prisma.join`/`Prisma.raw`/`$queryRaw` 는 그대로 꽂고 나머지는 한 줄로 감싼다.

| 칸 | ERP 구현 |
|---|---|
| `findAnnouncements(args)` | `prisma.policyAnnouncement.findMany(args)` |
| `findAnnouncement(id, select)` | `prisma.policyAnnouncement.findUnique({ where: { id }, select })` |
| `countAnnouncements(where)` | `prisma.policyAnnouncement.count({ where })` |
| `findProducts(args)` | `prisma.financeProduct.findMany(args)` |
| `groupAnnouncementsBySource()` | `groupBy({ by: ["source"], _count: { _all: true } })` → `{ source, count }` |
| `groupProductsBySource()` | `groupBy({ by: ["source"], where: { active: true }, _count: { _all: true } })` |
| `groupAnnouncementsByStructure()` | `groupBy({ by: ["structureStatus","structureVersion"], _count: { _all: true } })` → `{ structureStatus, structureVersion, count }` |
| `cacheGet(key)` | `prisma.jsonCache.findUnique({ where: { key } })` 의 `value`(행 없으면 `null`) |
| `cacheSet(key, value)` | `prisma.jsonCache.upsert({ where: { key }, create: { key, value }, update: { value } })` |
| `cacheListByPrefix(p)` | `prisma.jsonCache.findMany({ where: { key: { startsWith: p } }, select: { key: true, value: true } })` |

## 코어가 읽고 쓰는 DB 표 (랩 계정 권한 목록의 근거)

| 표 | 읽기 | 쓰기 |
|---|---|---|
| `PolicyAnnouncement` | ○ (목록·상세·진단·판정·첨부·현황 건수) | ✕ |
| `FinanceProduct` | ○ (현황 건수 — `active` 만) | ✕ |
| `JsonCache` | ○ `policy-verdict:%` · `policy-match-sync-ledger` · `board-cap:%` | ○ **`policy-verdict:%` 만** |

- 그 밖의 표는 **코어가 아예 모른다.** 진단 기록(`PolicyDiagnosis`/`PolicyLabDiagnosis`)·
  사용자 표·AI 예산 장부는 앱이 자기 권한으로 읽고 쓴다.

## ERP 껍데기로 남길 곳 (B2 참고 — 지우면 다른 파일이 깨진다)

`src/lib/services/policy-match/announcement-detail.ts` 는 **지우지 말고 껍데기로** 남긴다.
`readAttachments`·`DETAIL_STRUCTURE_WAIT_MS` 는 여기(패키지)에서 재수출하되,
`DETAIL_MIN_GAP_MS`·`DETAIL_DAILY_MAX` 는 **ERP 예산 장부(`ai-budget.ts`)에서 오는 값**이라
그대로 둔다 — `api/policy-match/announcements/[id]/route.test.ts:27-30` 이 이 경로로 가져간다.

```ts
export { readAttachments, DETAIL_STRUCTURE_WAIT_MS } from "@wedly/policy-match-shared/serve/announcement-detail";
export { DETAIL_MIN_GAP_MS as ..., DAILY_MAX as DETAIL_DAILY_MAX } from "./ai-budget"; // 원문 그대로
```

`attachment-download-control.ts` 도 마찬가지다 — 실물은 `serve/attachment-download.ts` 로 갔으니
껍데기로 재수출만 남기면 `attachments/[idx]/route.test.ts` 의 import 가 그대로 산다.
