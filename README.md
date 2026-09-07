# @wedly/policy-match-shared

WEDLY **정책매칭 판정 + 자금 조달 지도** 공용 보관함. ERP·일루아가 **같은 커밋을 물어** 코드가 글자 단위로 같아지게 하는 것이 이 보관함의 존재 이유다.

> 설계서: `docs/2026-09-04-design.md` — 경계 규칙·인자화·위험 대비가 전부 거기 있다.

## 1. 무엇이 들어 있나

| 층 | 폴더 | 내용 |
|---|---|---|
| 판정 엔진 | `src/engine/` | `structure-types` · `match-engine` · `recommend-score` · `region-augment` · `rule-extract` · `wedly-category` · `types` · `profile-summary` |
| 자금 규칙 | `src/funding/` | `funding-group` · `funding-map`(낱말 도우미·필터·정렬·집계) · `amount-rate-extract` · `source-directory` · `products/{types, rules-to-conditions, sources/manual}` |
| 지도 조립 | `src/build/` | `buildFundingMap(profile, now, opts, loaders)` |
| 화면 | `src/ui/` | `FundingMap` · `FundingDrawer` · `FundingRecommendPanel` · `Badge` · `SidePanel` · `CustomSelect` |

**경계 규칙 하나 — 이 보관함 안에는 「어느 앱인지」를 묻는 코드가 한 줄도 없다.** 앱마다 다른 것은 전부 인자로 받는다. `if (app === "erp")` 같은 분기가 생기면 그건 경계를 잘못 그은 것이다.

**여기 안 들어오는 것**(앱 몫): Prisma 클라이언트·자료 읽기 구현 · 통로(route) · 인증·회사 접근 검사 · 회사 프로필 조립 · 스키마.

## 2. 앱이 쓰는 법 — 「같은 자리에 한 줄 껍데기」

기존 소비자 파일은 **한 줄도 고치지 않는다.** 원래 있던 파일의 내용만 껍데기로 바꾼다(ERP 가 이미 쓰는 관례 — `src/components/ui/Table.tsx`).

```ts
// ERP src/lib/policy-match/match-engine.ts
export * from "@wedly/policy-match-shared/match-engine";
```

**기본 내보내기가 있는 부품**(2026-09-07 실측 8개 — `FundingMap` · `FundingDrawer` · `CustomSelect` · `ui/policy` 의 `PolicyMatchScreen` · `ProfileForm` · `ResultList` · `DetailPanel` · `SourceDirectoryPanel`)은 두 줄로 적어야 기본 내보내기가 넘어간다:

```ts
export { default } from "@wedly/policy-match-shared/ui/FundingMap";
export * from "@wedly/policy-match-shared/ui/FundingMap";
```

부를 수 있는 주소는 `package.json` 의 `exports` 지도에 **47개**가 전부 적혀 있다(2026-09-07 P4 에서 17개 추가 — `./ai*` 4 · `./ui/policy*` 10 · `./serve` 2 · `./collect/source-names` 1. 그 전 값은 30개였고 이 문서가 25개로 낡아 있었다). 지도에 없는 깊은 경로(`.../src/engine/...`)를 직접 부르지 마라 — 지도가 계약이다. **지도와 실물이 어긋나는지는 `src/exports-map.test.ts` 가 잰다** — 안 재면 잘못이 소비 앱 배포에서만 터진다(`ERR_PACKAGE_PATH_NOT_EXPORTED`).

### 2-b. 지원정책 매칭 화면 한 벌(`./ui/policy/*`) — 2026-09-07 P4

ERP `/policy-match` 화면(조립기 `PolicyMatchScreen` + 조각 넷 + `Modal`)이 이 보관함으로 왔다. **부품 안에 「어느 앱인지」를 묻는 코드는 없다** — 앱마다 다른 것은 전부 세 묶음으로 받는다(`./ui/policy/endpoints`):

| 묶음 | 무엇 | 없을 때 |
|---|---|---|
| `endpoints` | 부를 통로 주소 10개 | **그 단추·칸을 아예 안 그린다**(`verdict`·`breakthrough`·`askInstructor`·`sync`·`prefill`) |
| `slots` | 앱만 아는 조각(`verdictFeedback`·`sourcesActions`·`sourcesHeader`) | 아무것도 안 그린다 |
| `features` | 앱이 대신 하는 일(`exportSources`·`parseError`·`sourcesTrailingPaddingClass`) | ERP 규약·엑셀 단추 없음·여백 0 |

```tsx
import PolicyMatchScreen from "@wedly/policy-match-shared/ui/policy/PolicyMatchScreen";
import { ERP_POLICY_MATCH_ENDPOINTS } from "@wedly/policy-match-shared/ui/policy/endpoints";

<PolicyMatchScreen
  endpoints={ERP_POLICY_MATCH_ENDPOINTS}
  features={{ exportSources: (rows, fileName) => downloadSheet({ /* … */ }), sourcesTrailingPaddingClass: "pr-14" }}
/>
```

**이 여섯 부품은 `./ui`(배럴)에 넣지 않았다** — "use client" 부품을 통째로 끌고 오기 때문이다. 낱개 주소로 부른다.

`PolicyMatchScreen` 은 **기본 내보내기**다(위 예제). 이름으로 쓰고 싶으면 배럴(`…/ui/policy`)이나 같은 파일의 이름 내보내기(`import { PolicyMatchScreen } from "…/ui/policy/PolicyMatchScreen"`) 둘 다 된다 — 셋이 같은 부품을 가리킨다. **README 의 가져오기 예제가 실물과 맞는지는 `src/readme-imports.test.ts` 가 실제로 불러서 잰다**(예제를 고칠 땐 그 시험도 함께 돌린다).

### 2-a. 자료 읽기는 인자로 받는다

`buildFundingMap` 은 DB 를 직접 부르지 않는다. **행 모양(타입)은 이 보관함이 정하고, 읽는 방법은 앱이 낸다.**

```ts
export interface FundingMapLoaders {
  loadAnnouncements(now: Date): Promise<AnnouncementRow[]>;
  loadProducts(): Promise<FinanceProductRow[]>;
}
```

### 2-b. Tailwind — 앱 `globals.css` 에 한 줄

```css
@import "@wedly/policy-match-shared/styles.css";
```

이 줄이 있어야 보관함 안 부품의 클래스가 앱 빌드 결과 CSS 에 들어간다(안 하면 화면이 통째 깨져 보인다). `node_modules/@wedly` 아래를 통째로 훑는 와일드카드 `@source` 를 이미 걸어 둔 앱은 자동으로 잡힌다.

### 2-c. 바탕 부품은 `@wedly/ui-shared` (peer dependency)

`EmptyState · SegmentedControl · Skeleton · StatCard · StatusBox · Table` 과 `cn` 은 `@wedly/ui-shared` 에서 가져온다. **두 앱의 ui-shared 핀이 갈라져 있어도 안전하다** — 이 7개는 두 핀에서 코드가 글자 단위로 같다(2026-09-04 실측). `Badge · SidePanel · CustomSelect` 는 ui-shared 에 없어서 이 보관함이 가져간다.

## 3. ★갈래는 `main` 하나 — 앱별 갈래 금지

**`-erp` / `-illua` 같은 앱별 갈래를 만들지 않는다.** 그게 `@wedly/ui-shared` 를 3중 포크로 만든 원인이고, 「ERP 를 고치면 일루아도 바뀌나?」의 답을 영원히 **아니오**로 만든다.

- 앱마다 다른 정책이 필요하면 **갈래가 아니라 인자로** 푼다(§2-a·§2-b).
- 작업은 `main` 에서 갈라진 짧은 가지에서 하고, 합치면 곧바로 `main` 으로 되돌린다.
- 임시로라도 앱 이름이 붙은 갈래를 밀지 마라 — 남아 있으면 다음 사람이 그걸 문다.

## 4. 핀 올리는 법 — **두 앱을 같은 회차에 함께**

이 보관함을 고쳤으면 **ERP 와 일루아의 핀을 같은 커밋으로 함께 올린다.** 한쪽만 올리면 그 순간부터 두 앱의 판정이 갈린다.

1. 이 저장소에서 고치고 `main` 에 push → CI(§5) 초록 확인
2. 올릴 커밋 해시를 딴다: `git rev-parse HEAD`
3. **두 앱 모두** `package.json` 의 의존을 같은 해시로 바꾼다

   ```json
   "@wedly/policy-match-shared": "github:smlee-hash/wedly-policy-match-shared#<커밋해시>"
   ```

4. 두 앱에서 각각 `npm install` → `npm run build`(각 앱의 배포 전 관문 시험 포함) → 배포
5. 두 앱의 **얇은 계약 시험**이 초록인지 확인 — 핀을 올리다 판정이 뒤집히면 여기서 막힌다

**핀 어긋남 관문**(`~/.claude/hooks/shared-pin-guard.sh`)이 두 앱 `package.json` 의 핀이 다르면 답변을 끝낼 수 없게 막는다. 메모리에 기대지 않고 훅으로 지킨다.

## 5. 시험과 CI

- `npm test` — `src/**/*.test.ts(x)` 전량(vitest, 환경 `node`)
- `npm run typecheck` — `tsc --noEmit`, **검사 범위는 `src` 전체**(`src/**/*.ts`, `src/**/*.tsx`)
- CI(`.github/workflows/ci.yml`)가 push·pull request 마다 위 둘을 돌린다

★`tsconfig.json` 의 `include` 를 **좁히지 마라.** `@wedly/ui-shared` 가 `include` 를 두 폴더로 좁혀 두는 바람에 상세창 코드가 타입 검사 없이 앱으로 나간 사고가 있었다. 이 보관함은 `src` 전체를 검사한다.

★화면 시험은 브라우저 흉내(jsdom)가 아니라 `react-dom/server` 의 `renderToStaticMarkup` 으로 **그려서 잰다.** ERP 와 같은 방식이다(ERP 에 jsdom·@testing-library/react·@vitejs/plugin-react 가 없다 — 2026-09-04 실측).

## 6. 하지 않는 것

- `@wedly/ui-shared`·`@wedly/detail-modal-shared` 포크 통합 — 별건(§2-c)
- 정책매칭 화면 본체(`/policy-match`)를 일루아에 만들기 — 상세창 탭만
- 수집기·AI 구조화·슬랙 알림을 일루아에 두기 — 공고 자료는 공유 DB 에서 읽는다
