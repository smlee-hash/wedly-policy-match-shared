# 정책별 고객사·연락 예정 화면 (`ui/policy-deadline`)

ERP 와 컨설턴트 앱(일루아)이 **같은 화면**을 쓰는 부품 묶음이다. 계산(어느 업체가 어느 공고에 맞는지, 연락할 업체를
마감 순서로 세는 일)은 `serve/policy-deadline/*` 가, 화면은 이 폴더가 맡는다. 앱은 **로그인·보는 범위·통로 껍데기·
앱에만 있는 기능**만 넘긴다.

제목은 앱 위 띠가 그린다 — 화면은 설명 한 줄부터. 위에서 아래로: 설명 한 줄 · 요약 카드 두 장(「정책별 고객사」·
「연락 예정 업체」) · 탭 둘 · 탭 줄 오른쪽의 「보기: 목록·캘린더」(연락 예정 탭에서만)와 「담당: 내 담당·전체」(`scopeToggle`
일 때만) · 탭 안쪽 목록 또는 캘린더. 본문에 `<h1>` 이나 화면 제목 글자를 그리지 않는다(`screen-title.test.tsx` 가 잰다).

## 쓰는 쪽 코드

```tsx
// ERP — src/app/(erp)/policy-companies/PolicyCompaniesErpClient.tsx
"use client";
import { useState } from "react";
import { PolicyCompaniesScreen, DEADLINE_ENDPOINTS } from "@wedly/policy-match-shared/ui/policy-deadline";
import { companyCardRowOf } from "@wedly/policy-match-shared/ui/policy-deadline/deadline-view";
import CompanyCard from "@/app/(erp)/_shared/CompanyCard";

// 모듈 상수 하나로 넘긴다 — 그리는 자리에서 새로 만들지 않는다.
const ERP_DEADLINE_ENDPOINTS = { ...DEADLINE_ENDPOINTS, export: "/api/policy-track/deadline" };

export default function PolicyCompaniesErpClient() {
  const [card, setCard] = useState<{ customerKey: string; companyName: string } | null>(null);
  // 업체 상세창에서 저장하면 올린다 — 화면이 지금 탭과 요약 카드를 다시 읽는다.
  const [revision, setRevision] = useState(0);
  return (
    <>
      <PolicyCompaniesScreen
        endpoints={ERP_DEADLINE_ENDPOINTS}
        scopeToggle                                 // 「담당: 내 담당·전체」
        features={{ saveSheet: saveSheetXlsx }}     // ERP 엑셀 저장기(앱이 파일 저장을 맡는다)
        onOpenCompany={(row) => setCard(row)}       // 업체명 누르기 → 같은 화면 위에 업체 상세창
        onViewProgress={(row) => setCard(row)}      // 알림 「업무 현황 보기」
        revision={revision}
      />
      {card && (
        <CompanyCard
          row={companyCardRowOf(card.customerKey, card.companyName)}
          domain="government-subsidy"
          openTrack
          onClose={() => setCard(null)}
          onSaved={() => setRevision((value) => value + 1)}
        />
      )}
    </>
  );
}

// 컨설턴트 앱 — src/app/(main)/policy-companies/PolicyCompaniesIlluaClient.tsx
const openUrl = (key: string) => "/policy-companies/open?key=" + encodeURIComponent(key);

<PolicyCompaniesScreen
  endpoints={DEADLINE_ENDPOINTS}                    // export 없음 → 엑셀 단추를 그리지 않는다
  scopeToggle={false}
  seesAll={isSuper}                                 // 최고 관리자만 「담당」 칸·「모든 고객사」 설명
  onOpenCompany={(row) => window.open(openUrl(row.customerKey), "_blank", "noopener")}
  onViewProgress={(row) => window.open(openUrl(row.customerKey), "_blank", "noopener")}
/>
```

통로 쪽(두 앱 모두 `GET /api/policy-track/deadline`) — 로그인·범위는 앱, 본문은 공용이다.

```ts
import { handleDeadlineGet } from "@wedly/policy-match-shared/serve/policy-deadline/handler";
import { deadlineReadSource } from "@wedly/policy-match-shared/serve/policy-deadline/db";

// scopeOf(요청한 담당 범위 "mine" | "all" | null) → DeadlineScope. 막을 때는 DeadlineReadError(403) 를 던진다.
const { status, body } = await handleDeadlineGet(req.nextUrl.searchParams, (requested) => scopeOfUser(user, requested), {
  now: new Date(),
  src: deadlineReadSource(prisma),
  allowExport: true, // ERP · 컨설턴트 앱은 false
});
return NextResponse.json(body, { status });
```

## 화면 속성

| 이름 | 하는 일 |
|---|---|
| `endpoints` | (필수) 부를 통로 주소 — 아래 「주소」 표 |
| `scopeToggle` | 켜면 「담당: 내 담당·전체」를 그리고 `scope` 를 보낸다. 꺼진 앱은 보내지 않고 서버(앱의 `scopeOf`)가 정한 범위로 읽는다 |
| `seesAll` | `scopeToggle` 이 꺼진 앱에서 「담당」 칸·「모든 고객사」 설명을 보일지(컨설턴트 앱 최고 관리자) |
| `features.saveSheet` | 엑셀 파일 저장(앱이 저장 방식을 안다). `endpoints.export` 와 둘 다 있어야 「엑셀 내려받기」를 그린다 |
| `onOpenCompany` / `onViewProgress` | 업체명 누르기 · 알림 「업무 현황 보기」. 두 목록에는 하나(`onDetail`)로 합쳐 넘기며 `onOpenCompany` 가 먼저, 없으면 `onViewProgress`. 둘 다 없으면 업체명은 글자이고 「업무 현황 보기」도 그리지 않는다 |
| `revision` | 값이 **바뀌면** 지금 탭의 목록(펼친 업체 표 포함)과 요약 카드를 다시 읽는다. 업체 상세창에서 저장한 뒤 앱이 +1 한다 |
| `now` | 캘린더의 「오늘」 — 시험이 날짜를 고정할 때만 |

`showConsultant`(업체 표의 「담당」 칸)는 화면이 셈한다: `scopeToggle` 이면 「전체」를 골랐을 때, 아니면 `seesAll`.
`tab=deadline` 으로 온 옛 주소는 `tab=companies` 로 읽는다(옛 「마감」 탭 주소가 깨지지 않게).

## 목록만 따로 끼워 쓰기 (지원정책 매칭 「정책별 업체」 탭 등)

`AnnouncementBoard`(정책별 고객사)·`ContactsBoard`(연락 예정 업체)는 화면 안쪽 부품이면서 `index.ts` 에서 따로 내보낸다.
ERP 가 쓰던 속성을 **그대로** 받고, 새로 생긴 것은 `endpoints`(`AnnouncementBoard` 는 `features?` 도)뿐이다.

| 이름 | `AnnouncementBoard` | `ContactsBoard` |
|---|---|---|
| `endpoints` | 필수 | 필수 |
| `features` | 선택 — `saveSheet` 가 없으면 「엑셀 내려받기」 없음 | 없음 |
| `scope` | 선택 — 없으면 요청에 싣지 않는다 | 선택 — 같음 |
| `defaultDays` | 필수 — 처음 마감 거르기(`7｜14｜30｜all`) | 없음(카드가 쥔다) |
| `days` / `onDaysChange` | 둘 다 주면 바깥이 마감 거르기를 쥔다. 없으면 자체 상태 | 없음 |
| `onScopeChange` | 있으면 거르기 줄에 「담당」 구간 단추를 그린다(`canSeeAll` 로 「전체」 가능 여부) | 없음 |
| `kind` / `onKindChange` | 없음 | 둘 다 주면 바깥이 종류 거르기를 쥔다 |
| `initialBucket` | 슬랙 「공고 보기」로 온 공고 — 마감 「전체」로 펼쳐 그 줄로 옮긴다 | 없음 |
| `revision` | 선택 — 바뀌면 처음부터 다시 읽는다 | 선택 — 같음 |
| `onDetail(customerKey, companyName)` | 선택 — 없으면 업체명은 글자 | 선택 — 없으면 「업무 현황 보기」 없음 |
| `onProgressed` | 선택 — 「업무 현황에 추가」가 끝난 뒤 | 선택 — 같음 |
| `showConsultant` | 선택(기본 `true`) — 「담당」 칸 | 선택(기본 `true`) |
| `view` / `now` | 없음 | 선택 — `list`(기본)｜`calendar` / 캘린더의 「오늘」 |

```tsx
// 지원정책 매칭 「정책별 업체」 탭 — 카드·탭 없이 마감 거르기가 달린 정책별 고객사 목록만
import { AnnouncementBoard, DEADLINE_ENDPOINTS } from "@wedly/policy-match-shared/ui/policy-deadline";

<AnnouncementBoard
  endpoints={DEADLINE_ENDPOINTS}
  defaultDays="14"
  scope={scope}
  onScopeChange={setScope}
  canSeeAll={isAdmin}
  onDetail={(customerKey, companyName) => openCompany({ customerKey, companyName })}
/>
```

## 주소(endpoints)

| 칸 | 부르는 곳 | 없으면 |
|---|---|---|
| `read` | `GET` 목록·묶음·연락 예정·업체·요약(`?view=list｜bucket｜contacts｜company｜summary`) | 필수 — 화면이 그려지지 않는다 |
| `progress` | `POST` 「업무 현황에 추가」 | 필수 — `DEADLINE_ENDPOINTS.progress` 를 쓴다 |
| `export` | `GET ?view=export` 엑셀 줄 | 「엑셀 내려받기」 단추를 그리지 않는다(`features.saveSheet` 도 있어야 그린다) |

`DEADLINE_ENDPOINTS` = `{ read: "/api/policy-track/deadline", progress: "/api/policy-track/deadline/progress" }` —
두 앱의 통로 주소가 같다. **주소를 안 넘긴 단추는 존재하지 않는다**(그리지도, 부르지도 않는다 — `ui/policy/endpoints.ts` 와 같은 규칙).

## 앱별 `scopeOf` 표

화면은 `scopeToggle` 이 켜졌을 때만 `scope` 를 보내고, 업체 보기(`view=company`)는 보내지 않는다.

| 요청한 범위 | ERP 관리자 | ERP 그 밖 | 컨설턴트 앱 최고 관리자 | 컨설턴트 앱 그 밖 |
|---|---|---|---|---|
| `all` | `{ kind: "all" }` | 403 「관리자만 전체를 봅니다.」 | `{ kind: "all" }` | `keys`(요청 무시) |
| `mine` | `reader`(내 id) | `reader`(내 id) | `{ kind: "all" }` | `keys` |
| 없음(업체 보기) | `{ kind: "all" }` | `reader`(내 id) | `{ kind: "all" }` | `keys` |

`DeadlineScope` 의 세 모양: `all`(거르지 않음) · `reader`(업체의 `readConsultantIds` 에 내 id 가 든 곳) ·
`keys`(앱이 정한 업체 열쇠 목록 — 빈 배열이면 DB 를 부르지 않고 빈 결과).

화면에는 「전체」를 막는 속성이 없다 — ERP 의 관리자가 아닌 사람이 「전체」를 누르면 서버의 403 문구(「관리자만 전체를 봅니다.」)가
목록 자리에 보인다. 단추 자체를 숨기려면 앱이 `scopeToggle` 을 그 사람에게만 끈다.

## 화면 주소

화면 주소는 화면이 직접 맞춘다: `?tab=companies|contacts&view=list|calendar&bucket=&scope=mine|all`
(`scope` 는 `scopeToggle` 일 때만). 기본값(`tab=companies`·`view=list`·`scope=mine`)은 주소에서 뺀다. 모르는 값은 그대로 둔다.
새로 고침해도 같은 탭·보기로 열린다 — Next 라우터에 묶이지 않고 `window.history.replaceState` 로 맞춘다.

## 파일 안내

| 파일 | 내용 |
|---|---|
| `PolicyCompaniesScreen.tsx` | 화면 한 장(카드·탭·보기·담당) |
| `AnnouncementBoard.tsx` · `ContactsBoard.tsx` · `ContactsCalendar.tsx` | 정책별 고객사 목록 · 연락 예정 목록 · 연락 예정 월 캘린더 |
| `SummaryCards.tsx` · `Scorecard.tsx` | 위쪽 카드 두 장 |
| `DeadlineTables.tsx` · `DeadlineBits.tsx` | 업체 표 · 작은 부품(구간 단추 `Seg` 등) |
| `deadline-api.ts` · `deadline-view.ts` · `screen-state.ts` · `endpoints.ts` · `classes.ts` | 통로 부르기 · 보이는 글·순서 셈 · 화면 주소 상태 · 주소 모양 · 단추·카드 클래스 글자 |
| `test-kit.ts` | **시험 전용** 작은 훅 실행기(jsdom 없이 화면을 펼쳐 본다). `exports` 에 없고 앱이 가져오지 않는다 |

## 규칙: 어느 앱인지 묻는 코드 0줄

이 폴더의 부품 안에는 「지금 ERP 인가 컨설턴트 앱인가」를 묻는 코드가 없다. 앱마다 다른 것은 위 표의 주입으로만 받는다.
`no-app-word.test.ts` 가 `"erp"`·`"illua"` 문자열 비교를 글자로 잡는다. 새로 다른 점이 생기면 분기를 넣지 말고 주입 칸을 하나 더 만든다.

Button·Card 는 앱 부품을 가져오지 않고 `classes.ts` 의 클래스 글자(원본과 같은지는 `classes.test.ts` 가 잰다)로 그린다.
