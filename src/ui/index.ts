/**
 * `src/ui/` — 화면 층의 재수출 자리(설계서 §2 「화면 — 두 앱이 같은 모양이어야 한다」).
 *
 * 여기 있는 부품은 ERP `src/app/(erp)/policy-match/`·`src/components/ui/` 에서 **글자 그대로**
 * 옮겨 온 것이다. 바꾼 것은 두 가지뿐:
 *   ① import 주소(앱 별칭 `@/…` → 이 보관함 안 상대경로 · `@wedly/ui-shared` 통로)
 *   ② `FundingRecommendPanel` 의 인자화 4개(설계서 §2-b — 앱마다 다른 것만 props 로)
 * 색·클래스·문구는 승인받은 시안이라 한 글자도 안 바꿨다.
 *
 * ── 어디서 가져오나 ────────────────────────────────────────────────
 *  · `EmptyState·SegmentedControl·Skeleton·StatCard·StatusBox·Table`·`cn`·`useAnchoredPosition`
 *    → **`@wedly/ui-shared`**(peer dependency). 두 앱의 ui-shared 핀이 갈라져 있어도 안전하다는
 *      실측 근거는 설계서 §2-c.
 *  · `Badge·SidePanel·CustomSelect`(+ 그 짝 `selectGrouping`·`selectKeyboard`)
 *    → ui-shared 에 **없는** 부품이라 이 보관함이 가져왔다.
 *
 * ★이름 충돌 없음(2026-09-04 실측): 아래 8파일이 내보내는 이름이 전부 다르고, 기본 내보내기에
 *  붙인 이름 4개(`FundingMap`·`FundingDrawer`·`FundingRecommendPanel`·`CustomSelect`)와도
 *  겹치지 않는다. 그래서 `export *` 를 그대로 쓴다.
 *
 * ※ 앱의 껍데기(한 줄 재수출)는 이 파일이 아니라 **낱개 주소**를 부른다
 *   (예: `export { default } from "@wedly/policy-match-shared/ui/FundingMap";`).
 *   여기는 "화면 층을 한꺼번에 가져오고 싶을 때"용이다.
 */

// ── 자금 조달 지도 본체 ─────────────────────────────────────────────
export { default as FundingMap } from "./FundingMap";
export * from "./FundingMap";

// ── 상시 상품 서랍(공고는 상세 화면이 받는다) ───────────────────────
export { default as FundingDrawer } from "./FundingDrawer";
export * from "./FundingDrawer";

// ── 상세창 레일의 「추천 정책」 탭 본체(인자화 4개 · 설계서 §2-b) ────
export { default as FundingRecommendPanel } from "./FundingRecommendPanel";
export * from "./FundingRecommendPanel";

// ── ui-shared 에 없어서 이 보관함이 가져온 바탕 부품 3개 ─────────────
export * from "./Badge";
export * from "./SidePanel";
export { default as CustomSelect } from "./CustomSelect";
export * from "./CustomSelect";

// ── CustomSelect 의 짝(순수 함수) — ui-shared 에 없다 ────────────────
export * from "./selectGrouping";
export * from "./selectKeyboard";
