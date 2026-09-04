/**
 * `@wedly/policy-match-shared` 뿌리 — 네 층을 한곳에서 다시 내보내는 자리.
 *
 * 앱이 부르는 주소는 `package.json` 의 `exports` 지도에 낱개로 전부 적혀 있고,
 * 껍데기(한 줄 재수출)는 뿌리가 아니라 **낱개 주소**를 부른다
 * (예: `export * from "@wedly/policy-match-shared/match-engine";`).
 * 그래서 이 뿌리는 「한꺼번에 가져오고 싶을 때」용이다.
 *
 * ★이름 충돌 없음(2026-09-04 실측, TypeScript 검사기로 층별 내보내기 이름을 뽑아 대조):
 *  engine 62 + funding 66 + build 7 + ui 50 = **185개가 전부 다르다**.
 *  그래서 `export * as ...` 로 묶지 않고 평범한 `export * from` 네 줄로 끝냈다
 *  (겹치는 이름이 생기면 그때 묶어야 한다 — 그냥 두면 조용히 하나가 가려진다).
 *
 * ※ `./ui` 안의 부품 다섯(`SidePanel`·`CustomSelect`·`FundingMap`·`FundingDrawer`·
 *   `FundingRecommendPanel`)은 첫 줄에 `"use client"` 가 있다. 뿌리로 한꺼번에 가져오면
 *   화면 부품까지 딸려 오므로, 서버에서 판정 함수만 쓸 자리에서는 낱개 주소를 부르는 편이 가볍다.
 */

// ── 순수 판정 (입력이 같으면 출력이 같다) ───────────────────────────
export * from "./engine";

// ── 순수 규칙 — 갈래·낱말 도우미·필터·정렬·집계·상품 ────────────────
export * from "./funding";

// ── 지도 조립 (자료 읽기는 인자로 받는다 · 설계서 §2-a) ──────────────
export * from "./build";

// ── 화면 (두 앱이 같은 모양) ────────────────────────────────────────
export * from "./ui";
