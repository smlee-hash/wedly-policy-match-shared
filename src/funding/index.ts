/**
 * `src/funding/` — 자금 조달 규칙 층의 재수출 자리(설계서 §2 「순수 규칙」).
 *
 * 여기 있는 것은 전부 **입력이 같으면 출력이 같은** 함수·상수·타입뿐이다.
 * DB(Prisma)·네트워크·화면 부품을 하나도 부르지 않는다 — 자료를 어디서 읽는지는
 * `src/build/` 가 인자(`FundingMapLoaders`)로 받는다(설계서 §2-a).
 *
 * 앱(ERP·일루아)이 부르는 **낱개 주소**는 `package.json` 의 `exports` 지도에 따로 있다
 * (예: `@wedly/policy-match-shared/funding-map`). 이 파일은 "한꺼번에 가져오고 싶을 때"용이다.
 *
 * 2026-09-04 실측: 아래 8개 파일이 내보내는 이름 중 **겹치는 것은 하나도 없다** —
 * 그래서 `export *` 를 그대로 쓴다(겹치면 `export * as ...` 로 묶어야 한다).
 */

// ── 갈래 분류 (7갈래 정본 + 색조·설명) ──────────────────────────────
export * from "./funding-group";

// ── 지도 본체 — 낱말 도우미·필터·정렬·집계 ─────────────────────────
export * from "./funding-map";

// ── 금액·금리 뽑아내기 (본문 글자 → 숫자) ──────────────────────────
export * from "./amount-rate-extract";

// ── 수집원 정본 명부 + 연결 여부 판정 ───────────────────────────────
export * from "./source-directory";

// ── 게시판 쪽수 상한 장부 (source-directory 가 쓰는 순수 장부 규칙) ──
export * from "./board/page-cap";

// ── 상시 상품 — 모양·규칙 변환·손 등록 목록 ─────────────────────────
export * from "./products/types";
export * from "./products/rules-to-conditions";
export * from "./products/sources/manual";
