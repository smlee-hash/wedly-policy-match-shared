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

## 6. 리뷰 반영으로 **원문과 달라진 자리 2곳** (2026-09-07 독립 리뷰 GPT-6 Astra)

이 회차의 이동은 「글자 그대로」가 원칙이었지만, 아래 두 곳은 **원문(ERP 라우트)에도 있던 결함**이라
옮기면서 함께 고쳤다. ERP 는 이 보관함을 물어 쓰므로 ERP 도 같이 고쳐진다 — 그래서 원문 파일의
그 줄들은 **껍데기로 바뀔 때 사라진다**(따로 손댈 필요가 없다).

| # | 무엇이 잘못이었나 | 원문(ERP) | 이 보관함(고친 자리) | 잠그는 시험 |
|---|---|---|---|---|
| ① | **첨부 잠금 고착.** 본문을 흘리다 상류가 끊기면 `reader.read()` 가 거절하는데 그 길에 잠금 해제가 없었다. 한 번 끊기면 그 공고의 다음 내려받기가 **프로세스가 죽을 때까지 429**. | `src/app/api/policy-match/announcements/[id]/attachments/[idx]/route.ts:85` (`await reader.read()` — 거절 경로에 `onDone()` 없음) | `src/serve/attachment-download.ts:119~124`(해제를 **한 번만** 돌리는 `finish`) · `:134~143`(`read()` 를 try 로 감싸 거절에도 해제) | `attachment-download.test.ts` 「★본문 도중 연결이 끊겨도 잠금이 풀린다」 |
| ② | **동시 1건 경쟁.** 잠금 **확인**과 잠금 **설정** 사이에 DB 조회(`await`)가 있어, 같은 공고 두 요청이 그 틈에 둘 다 통과했다(상류를 두 번 두드린다). | 같은 파일 `:150`(확인) ↔ `:208`(설정) — 사이에 `findUnique` | `src/serve/attachment-download.ts:256`(확인) → `:268`(설정, **바로 다음 줄**·조회 앞) · `:420`(`finally` 한 자리에서 모든 조기 반환을 해제) | 같은 파일 「★같은 공고 두 요청이 **동시에** 와도 상류는 한 번만 두드린다」 |

**왜 이렇게 고쳤나(설계 한 줄):** 해제 자리를 종료 경로마다 손으로 적으면 언젠가 한 자리를 빠뜨린다.
그래서 해제를 **한 함수**(`release`, 두 번 불려도 한 번만 돈다)로 모으고, 잠금을 잡은 뒤의 모든 조기
반환은 `try…finally` 가 지나가게 했다. 흘려보내기로 넘어간 경우에만 해제를 스트림(`cappedStream`)에
넘긴다(`handedOff`) — 그 스트림도 끝·오류·취소·상한 네 경로에서 정확히 한 번 푼다.

### 같은 회차의 나머지 리뷰 반영 3건(원문과의 차이는 아님 — 이 보관함에서 새로 생긴 계약)

- **지도 서랍의 AI 약속** — `src/ui/FundingDrawer.tsx` 에 `aiVerdictAvailable?: boolean`(기본 true)을
  더했다. `src/ui/policy/PolicyMatchScreen.tsx:592` 가 `!!endpoints.verdict` 를 넘긴다. 판정 통로가
  없는 앱에서 「AI 상세 판정」이라고 적으면 **없는 기능을 약속**하게 된다(다른 자리와 같은 규칙).
  기본값이 true 라 ERP·일루아 동작은 그대로다(대조군 시험이 잠근다).
- **README 예제 오류** — 낱개 주소에서 `{ PolicyMatchScreen }` 을 이름으로 가져오는 예제였는데 그
  파일은 기본 내보내기만 있었다(소비 앱에서 TS2724). 예제를 기본 가져오기로 고치고 **이름 내보내기도
  함께** 추가해 둘 다 되게 했다. `src/readme-imports.test.ts` 가 README 코드칸을 읽어 주소를 `exports`
  지도로 풀고 **실제로 불러** 이름·기본 내보내기가 있는지 잰다.
- **30초/10분 경계 시험 공백** — 옛 시험은 30ms 만 기다려 본문 시계로 갈아 끼우는 `clearTimeout` 을
  지워도 초록이었다. 가짜 시계(`vi.useFakeTimers`)로 ① 45초를 보내도 본문이 흐르는지 ② 10분에
  끊기는지를 각각 고정했다(둘 다 `clearTimeout` 을 지우면 빨개지는 것을 확인했다).
