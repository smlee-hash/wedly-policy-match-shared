/**
 * `engine/` 층 한곳 모으기 — 순수 판정 8개를 그대로 다시 내보낸다.
 *
 * 이 층은 **입력이 같으면 출력이 같은 것**만 모은 자리다(설계서 §2).
 * 앱(ERP·일루아)을 묻는 코드가 한 줄도 없고, 바깥으로 나가는 의존도 없다 —
 * 8파일이 서로만 부르는 닫힌 묶음이라 옮기면서 import 를 한 줄도 안 고쳤다
 * (원본 `wedly-erp/src/lib/policy-match/` 와 **글자 단위로 같다**, 2026-09-04).
 *
 * 층 안쪽 의존 방향(위가 아래를 부른다):
 *   structure-types            ← 뿌리(칸 이름·연산자·판정 등급). 아무것도 안 부른다
 *   match-engine               ← structure-types
 *   rule-extract               ← match-engine · structure-types
 *   region-augment             ← match-engine · rule-extract · structure-types
 *   recommend-score            ← structure-types
 *   profile-summary            ← match-engine
 *   wedly-category · types     ← 아무것도 안 부른다
 *
 * ★이름 충돌 없음(2026-09-04 실측): 8파일이 내보내는 이름 62개가 전부 다르다.
 *  그래서 `export * from` 으로 통째 재수출해도 가려지는 이름이 없다.
 *  (`types.ts` 는 파일 이름만 흔할 뿐 내보내는 이름은 `PolicySource`·
 *   `NormalizedAnnouncement` 처럼 고유하다 — 묶어서 감출 필요가 없었다.)
 *
 * ※ 앱의 껍데기(한 줄 재수출)는 이 파일이 아니라 **낱개 주소**를 부른다
 *   (예: `export * from "@wedly/policy-match-shared/match-engine";`).
 *   여기는 "판정 층을 한꺼번에 가져오고 싶을 때"용이다.
 */

export * from "./structure-types";
export * from "./match-engine";
export * from "./rule-extract";
export * from "./region-augment";
export * from "./recommend-score";
export * from "./profile-summary";
export * from "./wedly-category";
export * from "./types";
