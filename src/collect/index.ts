// 수집기(정책 공고·상시 상품) 공개 진입점.
//
// 앱(ERP)은 DB·AI·슬랙을 담은 `CollectDeps` 를 만들어 `buildSources`/`buildProductSources` 를
// 부른다 — 그 결과(수집원 목록)를 회차(`sync.ts` 의 `SOURCES`)에 편다. 고용24 번호 훑기
// (`sources/work24.ts` 의 `fetchWork24All`)와 4개 공공API 어댑터(bizinfo·bojo24·kstartup·msit)는
// 이 조립 밖이라 앱이 직접 편다(work24 는 자기 옵션 `FetchWork24Options` 로 DB 를 주입받는다).
export type {
  CollectDeps,
  PolicyAnnouncementUpdate,
  AnnouncementSyncSource,
  ProductSyncSource,
  PolicyMatchSource,
} from "./types";

import type { CollectDeps, AnnouncementSyncSource, ProductSyncSource } from "./types";
import { boardSyncSources } from "./board/registry";
import { productSyncSources } from "./products/registry";

/** 게시판 수집원(등록된 게시판 전부)을 `CollectDeps` 로 조립한다. */
export function buildSources(deps: CollectDeps): AnnouncementSyncSource[] {
  return boardSyncSources(deps);
}

/** 상시 상품(자금 조달 지도) 수집원을 `CollectDeps` 로 조립한다. */
export function buildProductSources(deps: CollectDeps): ProductSyncSource[] {
  return productSyncSources(deps);
}
