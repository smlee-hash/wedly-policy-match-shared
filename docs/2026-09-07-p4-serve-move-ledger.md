# P4 Task A3 — 옮기기 대조표 (`src/serve/` · `src/collect/source-names.ts`)

「옮기기 + 주입」이라 **계산은 한 줄도 안 바꿨다**. 늘어난 줄은 전부 ① 주입 매개변수 ② 결과 객체 형
③ 옮기면서 새로 쓴 시험 ④ 주석이다. 아래 표로 원문 줄 수와 대조한다.

원문: `wedly-erp` 사본 `pipe-p4-lab-erp`(기준 `origin/main` `58e91555c`).
사본: `wedly-policy-match-shared` 사본 `pipe-p4-shared-serve`(기준 `5dd7d18`).

## 1. 실물

| 패키지 파일 | 줄 | 원문 | 원문 줄 | 늘어난 이유 |
|---|---:|---|---:|---|
| `serve/keyword-filter.ts` | 39 | `src/lib/policy-match/keyword-filter.ts` | 39 | **글자 단위 동일**(의존 0) |
| `serve/domain-map.ts` | 37 | `src/lib/policy-match/domain-map.ts` | 37 | **글자 단위 동일**(의존 0) |
| `serve/raw-prefilter.ts` | 140 | `src/lib/policy-match/raw-prefilter.ts` | 140 | import 한 줄만 상대경로로 |
| `serve/body-deadline.ts` | 181 | `src/lib/policy-match/body-deadline.ts` | 181 | import 한 줄만 상대경로로 |
| `serve/structure-status.ts` | 64 | `services/policy-match/structure-status.ts` | 65 | prisma import 빠지고 `q` 인자 하나 들어옴 |
| `serve/open-announcements.ts` | 95 | `services/policy-match/open-announcements.ts` | 79 | `OPEN_ANNOUNCEMENT_SELECT` 상수로 뽑기(20) + `makeOpenAnnouncementsLoader`(5) + 주석 |
| `serve/browse-groups.ts` | 148 | `services/policy-match/browse-groups.ts` | 123 | 함수마다 `db` 인자(+타입 별칭) + `makeBrowseGroups`(10) — **SQL 문장은 글자 단위 동일** |
| `serve/diagnose.ts` | 301 | `api/policy-match/diagnose/route.ts` | 330 | 라우트 껍데기·로그인 확인·기록 저장·`NextResponse` 가 빠지고 결과 형이 들어옴 |
| `serve/announcement-detail.ts` | 217 | 라우트 170 + `services/policy-match/announcement-detail.ts` 42 | 212 | 두 곳을 합치고 행 형·상세 형을 이름 붙여 뺌. AI 구조화 블록은 **안 가져왔다**(앱에 남음) |
| `serve/verdict.ts` | 322 | `api/policy-match/verdict/route.ts` | 332 | 라우트 껍데기·anthropic 호출·prisma 캐시 접근이 빠지고 주입 형(`RunVerdictDeps`)이 들어옴 |
| `serve/sources-summary.ts` | 110 | `api/policy-match/sources/route.ts` 16-88 | 73 | 읽기(4곳)가 빠지고 입력·출력 형 + `mergeSourceCounts` 가 들어옴 |
| `serve/attachment-download.ts` | 382 | 라우트 298 + `attachment-download-control.ts` 57 | 355 | 두 곳을 합치고 결과 형(`AttachmentDownloadResult`) + `ATTACHMENT_GAP_MS` 상수를 여기로 |
| `serve/types.ts` | 110 | — | 0 | **신설** — 주입 계약(`ServeQuery`·`VerdictModelCall`·`VerdictPromptModule`) |
| `serve/index.ts` | 103 | — | 0 | **신설** — 재수출 배럴(`src/index.ts` 에는 안 넣는다) |
| `collect/source-names.ts` | 52 | `services/policy-match/sync.ts` 의 `SOURCES` 이름 부분 | (일부) | **신설** — 주입 없이 이름만 만든다 |
| **합계(실물)** | **2,301** | | **1,966** | +335 = 주입 인자·결과 형·신설 3파일 |

## 2. 시험

| 패키지 시험 | 줄 | 원문 | 원문 줄 |
|---|---:|---|---:|
| `serve/keyword-filter.test.ts` | 45 | `lib/policy-match/keyword-filter.test.ts` | 45 (그대로) |
| `serve/domain-map.test.ts` | 50 | `lib/policy-match/domain-map.test.ts` | 50 (그대로) |
| `serve/raw-prefilter.test.ts` | 199 | `lib/policy-match/raw-prefilter.test.ts` | 199 (그대로) |
| `serve/body-deadline.test.ts` | 110 | `lib/policy-match/body-deadline.test.ts` | 110 (그대로) |
| `serve/open-announcements.test.ts` | 68 | `services/policy-match/open-announcements.test.ts` | 68 (prisma 흉내 → `q` 흉내) |
| `serve/browse-groups.test.ts` | 200 | `services/policy-match/browse-groups.test.ts` | 21 + **SQL 글자 잠금 신설** |
| `serve/structure-status.test.ts` | 52 | 없음 | **신설** |
| `serve/diagnose.test.ts` | 230 | 라우트 시험 761 중 코어에 해당하는 부분 | **다시 씀**(라우트 시험은 ERP 에 남는다) |
| `serve/announcement-detail.test.ts` | 140 | 없음(라우트 시험 505 는 ERP 에 남음) | **신설** |
| `serve/verdict.test.ts` | 284 | 라우트 시험 445 중 코어 부분 | **다시 씀** |
| `serve/sources-summary.test.ts` | 160 | `api/policy-match/sources/route.test.ts` 178 | 라우트 흉내를 코어 입력으로 바꿔 옮김 |
| `serve/attachment-download.test.ts` | 420 | `attachments/[idx]/route.test.ts` 327 | 안전장치 7개를 그대로 옮기고 **사람별 제한·홉 상한·창 닫기** 3건 보탬 |
| `serve/no-app-imports.test.ts` | 56 | 없음 | **신설** — 경계 지킴이 |
| `collect/source-names.test.ts` | 58 | 없음 | **신설** — 조립기 결과와 이름·순서 대조 |
| **합계(시험)** | **2,072** | | |

## 3. SQL·상수 동일성 증거

- `browse-groups` 의 여러 줄 SQL 두 문장을 원문과 **글자 단위로 대조**했다. 유일한 차이는
  `Prisma.raw(...)` → `db.raw(...)` 한 곳뿐(허용된 주입 치환). 나머지는 완전 일치.
  `browse-groups.test.ts` 가 렌더한 문장을 상수와 견줘 앞으로도 잠근다.
- `ATTACHMENT_GAP_MS = 250` — ERP `services/policy-match/sync.ts:779` 와 같은 값(시험이 잰다).
- 크기 30MB · 머리글 30초 · 본문 10분 · 분당 6회 · 홉 3 — 전부 원문 값 그대로(시험이 잰다).
- `CURRENT_STRUCTURE_VERSION = 3` · `VERDICT_MODEL = "claude-sonnet-5"` ·
  `VERDICT_MAX_TOKENS = 4096` · `ATTACHMENT_EXCERPT_CAP = 6000` — 원문 그대로.

## 4. 이번 회차에서 **안 옮긴 것**(일부러)

| 원문 | 왜 안 옮겼나 |
|---|---|
| `structurizeOne`·`StructurizeAbort`·AI 예산 장부 | 앱마다 열쇠·장부가 다르다(랩은 자기 `PolicyLabAiLedger`) |
| `store.ts` 의 저장·수집 | 계획서대로 **순수 파서(`readAttachments`)만** 옮겼다 |
| `PolicyDiagnosis.create` | 표 이름이 앱마다 다르다(ERP `PolicyDiagnosis` / 랩 `PolicyLabDiagnosis`) |
| `getLastSyncInfo()`(목록의 `lastSyncAt`) | 회차 시계는 수집 쪽 살림이라 랩엔 없다 |
| `isBillingOrAuthError` | 계획서대로 주입(`RunVerdictDeps`) — ERP `structurize.ts:499` 를 그대로 넘긴다 |
| 라우트 시험 5개 | ERP 에 남는다(B2 가 코어를 흉내 내 상태·code 를 고정한다) |

## 5. 되짚어 볼 곳 (메인 통합 때)

1. `package.json` 의 `exports` — 이 일꾼은 안 건드렸다. `docs/2026-09-07-p4-serve-exports.md` 참조.
2. 루트 `README.md` 의 「exports 지도에 **25개**」 → **28개**(A2 일꾼이 같은 줄을 고칠 수 있다).
3. `serve/verdict.ts` 는 지시문 모듈을 **주입**받는다(A1 의 `src/ai/verdict.ts` 를 import 하지 않는다) —
   두 일꾼이 다른 사본에서 일해 서로를 못 보기 때문이다. 병합 뒤에도 이 모양을 유지하면
   코어가 지시문 판본에 묶이지 않는다.
