/**
 * `ui/policy-deadline` — 정책별 고객사·연락 예정 화면(ERP·컨설턴트 앱 공용).
 *
 *  · 화면 한 장: `PolicyCompaniesScreen` — 카드 두 장 · 탭 둘 · 「보기」「담당」. 앱이 대부분 이것 하나만 쓴다.
 *  · 목록 두 개: `AnnouncementBoard`(정책별 고객사)·`ContactsBoard`(연락 예정 업체) — 화면 안쪽 부품이면서,
 *    지원정책 매칭의 「정책별 업체」 탭이나 컨설팅 업무 현황이 따로 끼워 쓸 수도 있다. 쓰는 법은 README.
 *  · 통로 주소: `DEADLINE_ENDPOINTS`(두 앱 공통) — 엑셀 줄은 앱이 `export` 를, 「해당 없음」은 `dismiss: DEADLINE_DISMISS_ENDPOINT` 를 더해 켠다.
 *    「다시 맞추기」(`DEADLINE_REMATCH_ENDPOINT`)는 상세창을 닫을 때 앱 화면이 직접 부른다.
 *
 * 낱개 주소(`@wedly/policy-match-shared/ui/policy-deadline/<파일>`)로도 불러올 수 있다.
 */
export { default as PolicyCompaniesScreen } from "./PolicyCompaniesScreen";
export type { DeadlineCompanyRef, PolicyCompaniesScreenProps } from "./PolicyCompaniesScreen";

export { default as AnnouncementBoard } from "./AnnouncementBoard";
export type { AnnouncementBoardProps } from "./AnnouncementBoard";

export { default as ContactsBoard } from "./ContactsBoard";
export type { ContactsBoardProps, ContactsBoardView } from "./ContactsBoard";

export { DEADLINE_DISMISS_ENDPOINT, DEADLINE_ENDPOINTS, DEADLINE_REMATCH_ENDPOINT } from "./endpoints";
export type { DeadlineEndpoints, DeadlineFeatures, DeadlineSheet } from "./endpoints";
