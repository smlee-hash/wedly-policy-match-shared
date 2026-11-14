/**
 * 정책별 고객사·연락 예정(미리 대조 결과 읽기) — 읽기 계산·통로·화면이 함께 쓰는 모양.
 * 판정은 업체별 매칭 화면과 같은 공용 `buildFundingMap` 으로 하고, 맞음·확인 필요만 남긴다(제외는 안 남김).
 * 대조를 **실행**하는 쪽(배치·슬랙 알림)의 모양은 앱 한 곳에만 있어 여기에 옮기지 않는다.
 */

/** 저장하는 판정 — 제외(excluded)는 저장하지 않는다. */
export type DeadlineVerdict = "fit" | "unverified";

/**
 * 같은 사업(dedupKey 같음) 공고 묶음 한 줄.
 * 열쇠 = dedupKey 앞뒤 공백 뺀 값(비면 `a:<공고 id>`) — 공용 `groupAnnouncements` 가 묶는 열쇠와 같다.
 */
export interface DeadlineBucket {
  bucketKey: string;
  /** 표시 줄 = 마감이 가장 가까운 자격 줄(같으면 id 순). 제목·기관·분류·주소는 이 줄 것. */
  repAnnouncementId: string;
  /** 묶음의 열린 공고 id 전부(진행 여부를 PolicyTrack.announcementId 로 맞출 때 쓴다). */
  announcementIds: string[];
  title: string;
  agency: string;
  /** 공고 분야 분류(wedlyCategory) — 「정책자금」·「무상지원금」·그 밖은 분류 이름. */
  category: string;
  url: string;
  /** 자격 줄 마감의 최솟값. null = 상시. */
  applyEnd: Date | null;
}

/** 업체 하나 × 묶음 하나의 판정. */
export interface DeadlineJudgement {
  bucketKey: string;
  /** 공용 판정이 그 묶음 대표로 고른 공고 id. */
  repAnnouncementId: string;
  verdict: DeadlineVerdict;
  /** 맞은 조건 — 판정 줄 `fit` 중 verdict 가 pass 인 이름표. */
  fitLabels: string[];
  /** 확인할 조건 — 판정 줄 `toCheck` 다음 `obstacles`. */
  toCheck: string[];
  /** 채울 칸 — 업체 빈 칸 중 이 공고 판정이 「<칸> 미입력」으로 못 가린 것. */
  gaps: string[];
}

/** 진행 기록 한 줄(PolicyDeadlineProgress). */
export interface StoredProgress {
  customerKey: string;
  bucketKey: string;
  trackId: string;
  byUserId: string | null;
  byName: string;
  via: "web" | "slack" | "track";
  createdAt: Date;
}

/** 대조 한 번의 결과 — JsonCache `policy-deadline:last` 에 남고 화면의 「마지막 대조」로 보인다. */
export interface RunSummary {
  kind: "full" | "dirty";
  startedAt: string;
  finishedAt: string;
  /** 판정한 업체 수. */
  companies: number;
  /** 판정에 쓴 묶음 수. */
  buckets: number;
  /** 새로 쓰거나 바뀐 판정 줄 수 · 지운 판정 줄 수. */
  upserts: number;
  deletes: number;
  /** 실패한 업체 수 + 판정 못 한 묶음 수. */
  errors: number;
  /** 할 일이 없어 건너뛴 까닭(대기열 비었음 등). */
  skipped?: string;
  /** 이어받은 전체 대조가 앞 회차 결과를 그대로 둔 업체 수(이어받지 않았으면 없음). */
  kept?: number;
}

/** 마감 거르기 — 날짜 마감이 오늘부터 n일 안(D-0 ~ D-n). 「all」은 날짜 마감 전부. 상시는 어느 거르기에서나 따로 보인다. */
export type DaysFilter = 7 | 14 | 30 | "all";
export type ScopeFilter = "mine" | "all";

/** 「정책별 업체」 탭 기본 마감 거르기. 「정책별 고객사」 탭은 화면이 14 를 넘긴다. */
export const LIST_DEFAULT_DAYS: DaysFilter = 30;
/** 「연락 예정 업체」 기본 마감 거르기. */
export const CONTACTS_DEFAULT_DAYS: DaysFilter = 14;
/**
 * 「연락 예정 업체」 기본에 「조건 정리 전」 판정 줄을 넣을지 — 대표님 확인 2번(추천: 넣지 않음, 「조건 정리 전 포함」을 켜야 보임).
 * 기본 목록과 요약 숫자가 모두 이 값 하나를 따른다. 답이 달라지면 이 값만 바꾼다.
 */
export const CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT = false;
/** 엑셀 한 번에 담는 최대 줄 수 — 넘으면 앞에서부터 이만큼만 싣고 truncated 를 켠다. */
export const EXPORT_MAX_ROWS = 50_000;
/** 엑셀 줄을 묶음 몇 개씩 나눠 읽을지 — 한 번에 전부 읽으면 수만 줄이 서버 메모리에 한꺼번에 올라온다. */
export const EXPORT_BUCKET_CHUNK = 100;

/** 읽기에 쓰는 업체 칸. */
export interface ReadCompany {
  customerKey: string;
  companyName: string;
  consultant: string;
  consultantNames: string[];
  readConsultantIds: string[];
  statusText: string;
  profileGaps: string[];
}

/** 판정 줄 + 업체 열쇠. */
export type ReadMatch = DeadlineJudgement & { customerKey: string };

/** 판정 줄의 거르기 칸만 — 요약 숫자는 업체·묶음·판정·확인할 조건만 있으면 센다. */
export type ReadMatchKey = Pick<ReadMatch, "customerKey" | "bucketKey" | "verdict" | "toCheck">;

/** 표 다섯 개를 읽는 자리 — 시험은 메모리 가짜, 앱은 `deadlineReadSource(db)`. customerKeys 가 null 이면 업체로 거르지 않는다. */
export interface ReadSource {
  /** 업체 줄. readerId 를 주면 readConsultantIds 에 그 id 가 든 업체만, customerKeys 를 주면 그 업체만(둘 다 주면 둘 다 맞는 것). */
  companies(filter: { readerId?: string; customerKeys?: string[] }): Promise<ReadCompany[]>;
  /** 묶음 줄 전부, 또는 bucketKeys 의 묶음만. */
  buckets(bucketKeys?: string[]): Promise<DeadlineBucket[]>;
  /** (묶음, 판정)별 판정 줄 수. */
  matchCounts(customerKeys: string[] | null): Promise<{ bucketKey: string; verdict: DeadlineVerdict; count: number }[]>;
  /** 판정 줄 — bucketKeys 를 주면 그 묶음 것만. */
  matches(filter: { customerKeys: string[] | null; bucketKeys?: string[] }): Promise<ReadMatch[]>;
  /** 판정 줄의 거르기 칸만 — 요약 숫자용. bucketKeys 를 주면 그 묶음 것만. */
  matchKeys(filter: { customerKeys: string[] | null; bucketKeys?: string[] }): Promise<ReadMatchKey[]>;
  /** 진행 줄 — bucketKeys 를 주면 그 묶음 것만. */
  progress(filter: { customerKeys: string[] | null; bucketKeys?: string[] }): Promise<StoredProgress[]>;
  lastRun(): Promise<RunSummary | null>;
}

/** 진행한 사람·때 — 「진행 중」 표시에 쓴다. at 은 ISO 시각. */
export interface ProgressInfo {
  trackId: string;
  byName: string;
  via: StoredProgress["via"];
  at: string;
}

/** 공고 묶음 한 줄의 표시 칸. applyEnd 는 KST 날짜(YYYY-MM-DD), 상시는 null. */
export interface BucketMeta {
  bucketKey: string;
  repAnnouncementId: string;
  title: string;
  agency: string;
  /** 공고 분야 분류 그대로(정책자금·무상지원금·그 밖은 분류 이름, 빈 글자 = 분류 없음). */
  category: string;
  url: string;
  applyEnd: string | null;
  dDay: number | null;
}

export interface AnnouncementListRow extends BucketMeta {
  /** 범위 안 업체 중 맞음 · 확인 필요 곳 수. */
  fit: number;
  unverified: number;
}

export interface AnnouncementListView {
  lastRun: RunSummary | null;
  /** 범위 안 업체 수(「계약 업체 N곳」). */
  companyCount: number;
  /** 표의 묶음 수 전부(「모집 중 공고 M건」) — 거르기와 상관없다. */
  bucketCount: number;
  /** 표의 묶음 분류 이름 — 빈 것 빼고 겹친 것 빼고 글자 순. */
  categories: string[];
  /** 마감 거르기 안 날짜 마감 묶음 — 마감 가까운 순(같으면 bucketKey 순). */
  dated: AnnouncementListRow[];
  /** 상시 묶음 전부 — bucketKey 순. */
  always: AnnouncementListRow[];
}

export interface CompanyMatchRow {
  customerKey: string;
  companyName: string;
  consultant: string;
  consultantNames: string[];
  statusText: string;
  fitLabels: string[];
  toCheck: string[];
  gaps: string[];
  progress: ProgressInfo | null;
}

export interface BucketCompaniesView {
  bucket: BucketMeta;
  /** 맞음 · 확인 필요 업체 — 각각 업체명 글자 순(같으면 customerKey 순). */
  fit: CompanyMatchRow[];
  unverified: CompanyMatchRow[];
}

export interface ContactKind {
  category: string;
  count: number;
  /** 그 분야 공고 중 가장 가까운 D-n. */
  nearestDDay: number;
}

export interface ContactCompanyRow {
  customerKey: string;
  companyName: string;
  consultant: string;
  consultantNames: string[];
  statusText: string;
  /** 남은 공고 중 가장 가까운 마감(YYYY-MM-DD)과 D-n. */
  nearestApplyEnd: string;
  nearestDDay: number;
  /** 분야별 공고 수 — 정책자금, 무상지원금, 그 밖은 분류 이름 글자 순(빈 분류는 맨 끝). 0인 분야는 넣지 않는다. */
  kinds: ContactKind[];
  announcementCount: number;
  /** 그중 진행한 공고 수(includeProgress 가 꺼져 있으면 늘 0). */
  progressCount: number;
}

export interface ContactsView {
  /** 가장 가까운 마감 순(같으면 업체명 글자 순, 그다음 customerKey 순). */
  companies: ContactCompanyRow[];
}

export interface CompanyAnnouncementRow extends BucketMeta {
  verdict: DeadlineVerdict;
  fitLabels: string[];
  toCheck: string[];
  gaps: string[];
  progress: ProgressInfo | null;
}

export interface CompanyAnnouncementsView {
  company: ReadCompany;
  /** 마감 가까운 순(같으면 bucketKey 순). */
  announcements: CompanyAnnouncementRow[];
}

export interface SummaryView {
  /** 범위 안 업체 중 마감 D-0~D-7 묶음에 맞음·확인 필요 판정이 하나라도 있는 업체 수(진행 여부·조건 정리 여부와 상관없이). */
  within7Companies: number;
  /** 「연락 예정 업체」 기본 거르기(CONTACTS_DEFAULT_DAYS·CONTACTS_INCLUDE_UNSTRUCTURED_DEFAULT·진행 빼기)의 업체 수. */
  contacts: number;
  /**
   * 「정책별 고객사」 마감 고르기별 공고 수 — readAnnouncementList(scope, { days, hideEmpty: true }).dated.length 와 늘 같다.
   * 범위 안 업체에 맞음·확인 필요 판정이 하나라도 있는 날짜 마감 묶음 중 inDays(dDay, 7|14|30|"all") 인 것. 상시·지난 마감·판정 0인 묶음은 세지 않는다.
   */
  buckets: { d7: number; d14: number; d30: number; all: number };
  /**
   * 「연락 예정 업체」 기본 거르기 업체 줄을 분야별로 센 업체 수 — 화면의 contactRowsFor(companies, 정책자금|무상지원금|그 밖의 분야).length 와 늘 같다.
   * 한 업체가 여러 분야면 각 분야에 센다(합이 contacts 보다 클 수 있다). other = 정책자금·무상지원금이 아닌 분류(빈 분류 포함)가 하나라도 있는 업체.
   */
  contactKinds: { policyFund: number; freeGrant: number; other: number };
}

export interface ExportRow {
  applyEnd: string | null;
  dDay: number | null;
  title: string;
  agency: string;
  category: string;
  url: string;
  companyName: string;
  consultant: string;
  statusText: string;
  verdict: DeadlineVerdict;
  fitLabels: string[];
  toCheck: string[];
  gaps: string[];
  inProgress: boolean;
}

export interface ExportView {
  rows: ExportRow[];
  /** 거르기에 맞는 줄 수 전부(잘리기 전). */
  total: number;
  truncated: boolean;
}

/** 「업무 현황에 추가」 결과 — POST 응답 data 와 같은 모양. */
export interface ProgressResult {
  /** 이번에 진행 줄을 새로 남겼나(false = 이미 누가 진행함). */
  created: boolean;
  /** 이번에 정책 진행을 새로 만들었나(false = 같은 이름·공고의 정책이 이미 있어 그것에 이었거나 이미 진행함). */
  trackCreated: boolean;
  trackId: string;
  policyName: string;
  companyName: string;
  /** 할 일 이름(늘 「신청 마감」). */
  todo: string;
  /** 할 일 기한 = 공고 마감 KST 날짜(YYYY-MM-DD), 상시면 "". */
  due: string;
  progress: { byName: string; via: StoredProgress["via"]; at: string };
}
