# Resume historical policy pages safely

Goal: resume confirmed stuck historical cursors without skipping policy rows or treating unknown/failed responses as completed. Root actual2026-09-13 observations: GWTP page2 parses29validrows but fetchBoardWindow fails because rebasing list.url(1/2) changes inferred paging key from[] to[bbs_data], deleting the announcement identity. Preserve the original source URL normalization rules when binding an absolute page. KOTRA3, IRIS5, Ansan8, Kosmes6, GWSinbo3, SeoulTP8, Smartfactory7, GyeongnamTP7 are source-specific empty/end responses that the generic predicate currently rejects.

Scope: page-window.ts and page-window.test.ts plus a small page-end.ts/helper test if needed. BoardConfig/types and narrowly scoped source end callbacks may be added if safer than a central source-specific predicate; do not edit unrelated source parser behavior, engine.ts, registry.ts or collection-baseline files. Root owns this plan and integration. No UI/schema/store/proxy/model/API/billing/deployment changes by worker. Source has another reviewed baseline fix underway; preserve its separate ownership.

Design: when rebasing page addresses, freeze the original effective dropUrlParams+pagingParamsOf(cfg) and disable re-inference in bound config. Keep existing allowHosts, parsing, page ceilings and structural validation. Empty completion needs explicit evidence inside a recognized list container with no announcement links, or a validated source JSON schema with expected empty result array and internally consistent requested-page/total-page/total-count metadata. Do not accept arbitrary body keywords, blank200, login/challenge/error HTML, JSON error objects, missing required metadata or plausible other JSON arrays. Preserve two consecutive proven-empty pages across calls. Interleaved KOTRA streams must both be exhausted; one empty stream alone must not finish the other.

Actual end data:
- KOTRA3: div.card > div.card-inner > div.card-body contains only 조회된 데이터가 없습니다. and no links; hidden limtTotCnt91; pagination1. Source alternates business kinds across pages; require consecutive2empty pages, never conclude from one.
- IRIS5: ul.dbody > li contains 데이터가 존재하지 않습니다.
- Ansan8: table.p-table.simple tbody tr contains 등록된 게시글이 존재하지 않습니다.
- GWSinbo3: table.basic_board tbody contains 등록된 게시글이 없습니다.; actual empty row lacks tr.hover_list.
- SeoulTP8: table.board-list tbody tr contains 조회결과가 존재하지 않습니다.
- GyeongnamTP7: #gridData tr.table-contents contains 해당되는 결과가 존재하지 않습니다.
- Kosmes6 JSON: {"pageInfo":{"rowMax":44,"pageCount":10,"startPage":1,"startRowNum":51,"scopeRow":50,"endRowNum":61,"rowCount":10,"endPage":5,"maxPage":5,"nowPage":6},"ds_infoList":[]}.
- Smartfactory7 JSON: paginationInfo{blockPage:"10",pageBasic:"1",startNumber:"60",showPage:"10",totalPageCount:"6",endNumber:"51",currentPage:"7",totalCount:"51"}, pbancList:[], key:"list" and matching nested modelAndView model/modelMap copies.

GTP5 contains10actualclosedpolicyannouncements with dates replaced by 마감. It is NOT an empty source. Leave that source incomplete for a separate archive lifecycle contract; do not skip its rows or mark complete. This plan does not claim full historical coverage.

Regression tests first reproduce GWTP identity collapse and each observed end false failure; then assert same29unique sourceIds as normal parsing, nextPage3. Verify normalization of ordinary query/path paging is preserved; explicit drop parameters still stripped; keepPagingParamsInDetail sources unchanged; repeated pinned rows cannot imply source-end. End tests include correct selector-local messages, missing containers, same message in footer or login shell, populated list plus footer empty text, unknown JSON/error metadata mismatch, source-specific selectors. Live read-only probes against captured current responses and actual production inputs remain root responsibility.

Required gates: focused tests/full shared tests/typecheck; independent qualified review; integrate reviewed baseline+thisfix, exact pins and builds in ERP/Illua/Lab, push+deploy-check each; resume ordinary/archive runners with currentSHA and existing leases; capture actual cursor progression and UI status. Never manually erase locks/counters or call incomplete work complete.
