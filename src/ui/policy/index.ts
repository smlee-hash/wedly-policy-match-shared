/**
 * `src/ui/policy/` — 「지원정책 매칭」 화면 한 벌(조립기 + 조각 넷 + 그 짝들).
 *
 * ERP `src/app/(erp)/policy-match/`·`src/components/ui/Modal.tsx`·`src/lib/policy-match/`
 * 에서 **글자 그대로** 옮겨 왔다. 바꾼 것은 두 가지뿐:
 *   ① import 주소(앱 별칭 `@/…` → 이 보관함 안 상대경로 · `@wedly/ui-shared` 통로)
 *   ② 앱마다 다른 것을 인자로(`endpoints`·`slots`·`features` — `./endpoints` 참고)
 * 색·클래스·문구는 승인받은 시안이라 한 글자도 안 바꿨다.
 *
 * ★`src/ui/index.ts`(화면 층 배럴)에는 **넣지 않았다.** 이 폴더는 "use client" 부품이 여섯이라
 *  배럴에 얹으면 그 배럴을 한 줄만 쓰는 화면까지 여섯을 통째로 끌고 간다(같은 이유가
 *  `src/ui/index.ts` 머리주석에도 적혀 있다). 앱은 **낱개 주소**로 부른다:
 *    `@wedly/policy-match-shared/ui/policy/PolicyMatchScreen`
 *  여기(`/ui/policy`)는 「화면 한 벌을 한꺼번에 가져오고 싶을 때」용이다.
 */

// ── 조립기(화면 하나 = 이 부품 하나) ─────────────────────────────────
export { default as PolicyMatchScreen } from "./PolicyMatchScreen";
export * from "./PolicyMatchScreen";

// ── 앱마다 다른 것을 받는 계약 ────────────────────────────────────────
export * from "./endpoints";

// ── 조각 넷 ───────────────────────────────────────────────────────────
export { default as ProfileForm } from "./ProfileForm";
export { default as ResultList } from "./ResultList";
export * from "./ResultList";
export { default as DetailPanel } from "./DetailPanel";
export * from "./DetailPanel";
export { default as SourceDirectoryPanel } from "./SourceDirectoryPanel";
export * from "./SourceDirectoryPanel";

// ── 조각들이 쓰는 바탕·순수 함수 ──────────────────────────────────────
export * from "./Modal";
export * from "./detail-poll";
export * from "./ask-instructor-text";
