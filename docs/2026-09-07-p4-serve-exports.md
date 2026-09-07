# P4 Task A3 — `package.json` 에 넣을 항목 (메인이 병합 때 반영)

일꾼 A3 는 `package.json` 을 **건드리지 않았다**(다른 일꾼이 같은 파일의 `exports` 를 고치는 중이라
합칠 때 충돌한다). 아래를 그대로 넣으면 된다. 시험·형 검사는 상대경로로 돌아가므로
이 항목이 없어도 패키지 안에서는 초록이고, **소비 앱(ERP·랩)에서만** 필요하다.

## 1. `exports` 에 더할 것

```jsonc
    "./serve": {
      "types": "./src/serve/index.ts",
      "default": "./src/serve/index.ts"
    },
    "./serve/*": {
      "types": "./src/serve/*.ts",
      "default": "./src/serve/*.ts"
    },
    "./collect/source-names": {
      "types": "./src/collect/source-names.ts",
      "default": "./src/collect/source-names.ts"
    },
```

- `./serve/*` 는 `./collect/*` 와 같은 꼴의 와일드카드다 — 파일이 늘어도 항목을 안 늘려도 된다.
- `./collect/source-names` 는 **와일드카드 `./collect/*` 가 이미 덮는다.** 위 항목은 없어도 되지만,
  자주 쓰는 진입점이라 눈에 보이게 적어 두는 편이 낫다(넣어도 덮어쓰기가 아니라 정확히 같은 파일).
- `src/index.ts`(배럴)에는 **넣지 않았다.** `serve/verdict`·`serve/attachment-download` 가
  `node:crypto`·`undici` 계열을 물어, 화면만 쓰는 소비자까지 그것을 끌고 가게 된다.

## 2. 의존성

**새로 더할 것 없음.** `src/serve/` 가 쓰는 바깥 것은 두 가지뿐이다.

| 쓰는 것 | 어디서 | 지금 상태 |
|---|---|---|
| `node:crypto` 의 `createHash` (`serve/verdict.ts`) | Node 기본 모듈 | 그대로 됨(`@types/node` 이미 devDependency) |
| `undici`(경유 통로 — `collect/board/proxy` 를 거쳐 간접) | 이미 `dependencies` | 그대로 됨 |

`serve/attachment-download.ts` 는 `fetch`·`ReadableStream`·`AbortController` 만 쓴다(Node 20+ 기본).

## 3. 소비 앱이 가져가는 모양

```ts
// ERP · 랩 공통
import type { ServeQuery } from "@wedly/policy-match-shared/serve/types";
import { runDiagnose } from "@wedly/policy-match-shared/serve/diagnose";
import { makeBrowseGroups } from "@wedly/policy-match-shared/serve/browse-groups";
import {
  readAnnouncementDetailRow, toAnnouncementDetail, hasStoredSummary,
} from "@wedly/policy-match-shared/serve/announcement-detail";
import { runVerdict } from "@wedly/policy-match-shared/serve/verdict";
import { buildSourcesSummary, mergeSourceCounts } from "@wedly/policy-match-shared/serve/sources-summary";
import { downloadAttachment } from "@wedly/policy-match-shared/serve/attachment-download";
import { collectSourceNames } from "@wedly/policy-match-shared/collect/source-names";
// 한 덩이로 받고 싶으면
import { runDiagnose, runVerdict } from "@wedly/policy-match-shared/serve";
```

## 4. README(패키지 루트)의 exports 개수

루트 `README.md` 36번째 줄 「exports 지도에 **25개**」 → **28개**(`./serve`·`./serve/*`·`./collect/source-names`).
이 일꾼은 `README.md` 도 안 건드렸다 — A2 일꾼이 같은 줄을 고칠 수 있어서다.
정확한 대응표(코어 결과 → HTTP 상태·code·문구)는 `src/serve/README.md` 에 있다.
