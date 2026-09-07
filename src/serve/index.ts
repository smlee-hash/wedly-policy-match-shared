/**
 * 판정 통로 코어 — ERP·랩이 **같은 계산**으로 진단·목록·상세·판정·수집원 현황·첨부를 낸다.
 *
 * ★이 폴더는 HTTP 도 DB 도 모른다(`no-app-imports.test.ts` 가 지킨다).
 *   결과 객체 → HTTP 상태·코드·문구 대응표는 같은 폴더 `README.md`.
 *
 * ★배럴(`src/index.ts`)에는 넣지 않는다 — 여기 몇몇 파일이 `node:crypto`·`undici` 를 물어
 *   화면 전용 소비자까지 그것을 끌고 가게 된다. 소비 앱은 `@wedly/policy-match-shared/serve/<파일>`
 *   로 필요한 것만 가져간다.
 */
export type {
  ServeQuery,
  SqlTag,
  VerdictModelCall,
  VerdictPromptModule,
  VerdictPromptInputLike,
  VerdictResultLike,
  VerdictCheckItemLike,
} from "./types";

export { prefilter, extractCanonicalRegions } from "./raw-prefilter";
export type { PrefilterAnnouncement, PrefilterDecision, PrefilterProfile } from "./raw-prefilter";
export { meaningfulKeywords, minKeywordScore } from "./keyword-filter";
export { mapCategoryToSources } from "./domain-map";
export type { ConsultingDomain, SectionKey, SourceMapping } from "./domain-map";
export { extractDeadlineFromText } from "./body-deadline";
export type { BodyDeadline } from "./body-deadline";

export {
  CURRENT_STRUCTURE_VERSION,
  isCurrentStructure,
  structureProgress,
} from "./structure-status";
export type { StructureProgress } from "./structure-status";

export {
  OPEN_ANNOUNCEMENT_SELECT,
  loadOpenAnnouncements,
  makeOpenAnnouncementsLoader,
  resetOpenAnnouncementsCache,
} from "./open-announcements";
export type { OpenAnnouncementRow } from "./open-announcements";

export {
  BROWSE_PAGE_SIZE,
  clampPage,
  escapeLike,
  listBrowseGroups,
  listGroupMembers,
  makeBrowseGroups,
} from "./browse-groups";
export type { BrowseGroupParams, BrowseGroupRow } from "./browse-groups";

export { ANN_SELECT, RULE_TEXT_SELECT, runDiagnose } from "./diagnose";
export type { DiagnoseData, DiagnoseItem, DiagnoseResult } from "./diagnose";

export {
  ANNOUNCEMENT_DETAIL_SELECT,
  DETAIL_STRUCTURE_WAIT_MS,
  defaultAttachmentHref,
  hasStoredSummary,
  readAnnouncementDetail,
  readAnnouncementDetailRow,
  readAttachments,
  toAnnouncementDetail,
} from "./announcement-detail";
export type {
  AnnouncementDetail,
  AnnouncementDetailResult,
  AnnouncementDetailRow,
} from "./announcement-detail";

export {
  VERDICT_AI_EFFORT,
  VERDICT_AI_TIMEOUT_MS,
  VERDICT_MAX_TOKENS,
  VERDICT_MODEL,
  VERDICT_SELECT,
  attachmentFingerprint,
  cacheKeyOf,
  parseVerdict,
  readModelJson,
  runVerdict,
  structureNeedsRawText,
} from "./verdict";
export type { RunVerdictDeps, RunVerdictInput, RunVerdictResult } from "./verdict";

export { buildSourcesSummary, mergeSourceCounts } from "./sources-summary";
export type { SourcesEntry, SourcesSummary, SyncLedgerValue, SourceRunReport } from "./sources-summary";

export {
  ATTACHMENT_BODY_TIMEOUT_MS,
  ATTACHMENT_DOWNLOAD_MAX_BYTES,
  ATTACHMENT_GAP_MS,
  ATTACHMENT_HEADERS_TIMEOUT_MS,
  ATTACHMENT_RATE_PER_MIN,
  attachmentInflight,
  contentDispositionOf,
  downloadAttachment,
  resetAttachmentRateLimitForTest,
  takeAttachmentToken,
} from "./attachment-download";
export type { AttachmentDownloadInput, AttachmentDownloadResult } from "./attachment-download";
