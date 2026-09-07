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

`slots.verdictFeedback` 은 **세 자리**에 같은 조각을 끼운다 — 목록 카드 아래(`place:"card"`) · 상세 머리(`"detail"`) · **자금 조달 지도의 공고 카드 바닥**(`"map"`, 2026-09-07 추가). 진단 결과의 기본 보기가 지도라 지도를 빼면 랩의 핵심 기능이 「목록·상세」 탭 뒤에 숨는다(승인 시안 `2026-09-04-policy-lab-preview.html` 297·344~393줄). 지도 카드는 `FundingMap` 의 `renderCardFooter` 인자로 들어가고 **공고 카드에만** 그려진다(상품 줄은 `refId` 가 상품 id 라 공고 번호 자리에 넣을 수 없다 — `cardFooterOf`). 그 인자를 안 넘기는 앱(ERP·일루아)의 지도는 한 글자도 안 바뀐다.
| `features` | 앱이 대신 하는 일(`exportSources`·`parseError`·`sourcesTrailingPaddingClass`·`serverStructurizes`) | ERP 규약·엑셀 단추 없음·여백 0·true(서버가 상세를 열면 AI 구조화, 저장본만 주는 랩은 false로 「읽는 중」 폴링·안내를 끈다 — AI 판정 단추는 `endpoints.verdict` 로 따로 결정) |

```tsx
import PolicyMatchScreen from "@wedly/policy-match-shared/ui/policy/PolicyMatchScreen";
import { ERP_POLICY_MATCH_ENDPOINTS } from "@wedly/policy-match-shared/ui/policy/endpoints";

<PolicyMatchScreen
  endpoints={ERP_POLICY_MATCH_ENDPOINTS}
  features={{ exportSources: (rows, fileName) => downloadSheet({ /* … */ }), sourcesTrailingPaddingClass: "pr-14" }}
/>
```

`SourceDirectoryPanel` 을 **낱개로 쓰는 화면**(랩 `/sources`)은 `defaultOpen` 을 켠다 — 기본은 접힘(ERP `/policy-match` 동작 그대로)이라, 안 켜면 머리줄만 보이고 요약 카드(`header`)·「빠진 수집원 신고」(`actions`)가 통째로 안 보인다(2026-09-07 실측 결함).

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

> **평소에는 이 절을 볼 일이 없다 — 봇이 대신 한다(§5).** 아래 손 절차는 봇을 껐을 때·봇이 실패해
> 사람이 맞춰야 할 때를 위한 것이다. 봇이 켜져 있는 동안 손으로 핀을 올리면 봇의 푸시와 부딪친다.

이 보관함을 고쳤으면 **ERP 와 일루아의 핀을 같은 커밋으로 함께 올린다.** 한쪽만 올리면 그 순간부터 두 앱의 판정이 갈린다.

1. 이 저장소에서 고치고 `main` 에 push → CI(§6) 초록 확인
2. 올릴 커밋 해시를 딴다: `git rev-parse HEAD`
3. **두 앱 모두** `package.json` 의 의존을 같은 해시로 바꾼다

   ```json
   "@wedly/policy-match-shared": "github:smlee-hash/wedly-policy-match-shared#<커밋해시>"
   ```

4. 두 앱에서 각각 `npm install` → `npm run build`(각 앱의 배포 전 관문 시험 포함) → 배포
5. 두 앱의 **얇은 계약 시험**이 초록인지 확인 — 핀을 올리다 판정이 뒤집히면 여기서 막힌다

**핀 어긋남 관문**(`~/.claude/hooks/shared-pin-guard.sh`)이 두 앱 `package.json` 의 핀이 다르면 답변을 끝낼 수 없게 막는다. 메모리에 기대지 않고 훅으로 지킨다.

## 5. 자동 반영 봇 — 핀은 사람이 아니라 봇이 올린다

§4 를 **사람이 손으로 하지 않아도 되게** 만든 것이 이 절이다. 설계서 §6 D1·D2, 계획서
`docs/superpowers/plans/2026-09-07-p5-propagate-bot.md`.

**언제 도나.** 이 저장소 `main` 에 커밋이 올라가 CI(§6)가 초록이 되면, GitHub Actions 의
`Propagate` 워크플로우(`.github/workflows/propagate.yml`)가 앱 3곳의 핀을 그 커밋으로 올려
**커밋·푸시**한다. Railway 가 그 push 를 보고 3앱을 배포한다. 다른 가지의 CI 나 실패한 CI 로는 돌지 않는다.

| 앱 | 저장소 | 봇이 고치는 것 |
|---|---|---|
| ERP | `wedly-erp` | `package.json`·`package-lock.json` + `npm ci` 뒤 설계 등록부 `src/lib/design-system/registry.generated.json` 재생성 → **`npm run design:check`**(Railway 가 ERP `build` 첫 단계로 돌리는 바로 그 명령) |
| 일루아 | `wedly-illua-collab` | `package.json`·`package-lock.json` |
| 랩 | `wedly-policy-lab` | `package.json`·`package-lock.json` |

봇 커밋은 이렇게 생겼다 — **저자가 `WEDLY 정책매칭 봇 <policy-bot@wedly.kr>` 이면 봇이 만든 것이다.**

```
chore(정책매칭 공용): 핀 b404b4b — <이 저장소의 커밋 제목>
```

**봇이 하지 않는 일**(사고를 막는 네 가지 · `scripts/propagate/__tests__/propagate.test.ts` 가 실제로 잰다)

- **핀이 뒤로 가지 않는다.** 새 커밋이 지금 핀의 후손이 아니면(늦게 도착한 옛 반영·다른 갈래) 그 앱은 건너뛴다. 실패가 아니라 「건너뜀」이다.
- **위 표의 파일 말고 다른 것이 바뀌면 멈춘다.** 무엇이 바뀌었는지 로그에 적고 아무것도 밀지 않는다.
- **사람 커밋을 덮어쓰지 않는다.** 같은 순간에 사람이 밀어 푸시가 거부되면 `origin/main` 위로 다시 얹어 최대 3번 다시 민다. 충돌하면 멈추고 사람을 부른다.
- **실패를 조용히 넘기지 않는다.** 실패하면 슬랙(ERP 내부 알림 통로)으로 알린다. 그때 그 앱의 `main` 은 **옛 핀 그대로**다 — 반쯤 반영된 상태가 남지 않는다.

**배포까지 확인한다.** 핀을 민 뒤 봇은 그 앱이 공개로 내놓는 `GET /api/build-id`(`{commitSha}`)를
**30초마다 최대 30분** 물어, 방금 만든 봇 커밋이 배포본에 나타나는지 본다. 나타나면 거기서 끝이고,
안 나타나면 슬랙(위와 같은 통로)으로 **「배포 확인 못 함」** 이 온다. 그때도 **반영 자체는 성공**이다 —
앱 `main` 에는 새 핀이 이미 들어가 있다. 이 방법은 비밀값이 하나도 필요 없는 대신
**「빌드 실패」와 「그냥 늦음」을 구분하지 못한다**. 알림이 오면 Railway 화면에서 그 서비스의 배포를 본다.
빌드가 실패한 것이면 **옛 배포가 그대로 살아 있고**(새 핀은 코드에만 있다), 고칠 곳은 앱이 아니라
대개 이 저장소다. Railway 토큰은 일부러 쓰지 않는다 — 프로젝트 토큰 하나면 그 환경의 **모든 변수**
(운영 DB 주소·AI 열쇠까지)를 읽을 수 있어 공개 저장소 시크릿에 두기엔 위험이 너무 크다.

**끄기 · 켜기** — 저장소 변수 하나다. 변수가 **아예 없으면 켜진 것**이고, `false` 일 때만 꺼진다.

```bash
gh variable set PROPAGATE_ENABLED -b false -R smlee-hash/wedly-policy-match-shared   # 끄기
gh variable set PROPAGATE_ENABLED -b true  -R smlee-hash/wedly-policy-match-shared   # 다시 켜기
```

**예행연습(푸시 없이 보기)** — 손으로 돌리면 예행이 기본이다. 커밋까지 만들어 보고 **밀지는 않는다.**

```bash
gh workflow run Propagate -R smlee-hash/wedly-policy-match-shared -f dry_run=true
gh run watch -R smlee-hash/wedly-policy-match-shared            # 로그에 result=dry-run 과 바뀐 줄이 보인다
gh workflow run Propagate -R … -f dry_run=true -f sha=<40자리>  # 특정 커밋으로 해 보기
```

**되돌리기 — 앱이 아니라 여기서 되돌린다.**

1. 이 저장소에서 `git revert <되돌릴 커밋>` → `main` 에 push
2. CI 초록 → 봇이 3앱 핀을 **되돌린 커밋**으로 다시 올린다

앱 저장소에서 봇 커밋을 revert 하지 마라. 그러면 앱 핀만 옛 커밋으로 돌아가고 이 저장소는 그대로라,
다음 반영 때 「후손이 아님」으로 건너뛰어 그 앱만 조용히 뒤처진다. 급할 때는 `PROPAGATE_ENABLED=false`
로 끄고 §4 대로 손으로 맞춘 뒤, 정리되면 다시 켠다.

**★봇 커밋을 손으로 고치지 마라.** rebase·amend·강제 푸시로 봇 커밋을 바꾸면 앱의 핀과 이 저장소의
이력이 어긋나 위 「후손」 판정이 무너진다. 고칠 것이 있으면 **이 저장소에 새 커밋**을 올린다.

**열쇠(PAT)와 알림 설정** — 값은 채팅·문서·커밋 어디에도 적지 않는다.

| 이름 | 무엇 | 없으면 |
|---|---|---|
| 시크릿 `PROPAGATE_TOKEN` | 세밀 권한 PAT(`wedly-policy-propagate-bot`) · 앱 3저장소 Contents: Read and write · 만료 1년 | 봇이 클론부터 실패한다 |
| 시크릿 `WEDLY_NOTIFY_KEY` | ERP 내부 알림 열쇠(= ERP `POLICY_LAB_INTERNAL_KEY`) | 알림만 건너뛴다(봇은 정상) |
| 변수 `WEDLY_NOTIFY_URL` | ERP 주소 | 알림만 건너뛴다 |
| 변수 `PROPAGATE_ENABLED` | 끄는 스위치 | 켜진 것으로 본다 |

**PAT 만료 = 봇 정지.** 만료되면 3앱 모두 클론에서 인증 실패로 죽고 슬랙 알림이 온다.
만료일은 **발급일 + 1년**이며, 재발급 절차는 메모 `github-token-rotation-via-aside` 에 있다.
발급한 뒤 이 자리에 **실제 만료일을 적어 둔다**(2026-09-08 현재 아직 발급 전 — 첫 가동 순서는 계획서 Task 6).

## 6. 시험과 CI

- `npm test` — `src/**/*.test.ts(x)` 전량(vitest, 환경 `node`)
- `npm run typecheck` — `tsc --noEmit`, **검사 범위는 `src` 전체**(`src/**/*.ts`, `src/**/*.tsx`)
- CI(`.github/workflows/ci.yml`)가 push·pull request 마다 위 둘을 돌린다

★`tsconfig.json` 의 `include` 를 **좁히지 마라.** `@wedly/ui-shared` 가 `include` 를 두 폴더로 좁혀 두는 바람에 상세창 코드가 타입 검사 없이 앱으로 나간 사고가 있었다. 이 보관함은 `src` 전체를 검사한다.

★화면 시험은 브라우저 흉내(jsdom)가 아니라 `react-dom/server` 의 `renderToStaticMarkup` 으로 **그려서 잰다.** ERP 와 같은 방식이다(ERP 에 jsdom·@testing-library/react·@vitejs/plugin-react 가 없다 — 2026-09-04 실측).

## 7. 하지 않는 것

- `@wedly/ui-shared`·`@wedly/detail-modal-shared` 포크 통합 — 별건(§2-c)
- 정책매칭 화면 본체(`/policy-match`)를 일루아에 만들기 — 상세창 탭만
- 수집기·AI 구조화·슬랙 알림을 일루아에 두기 — 공고 자료는 공유 DB 에서 읽는다
