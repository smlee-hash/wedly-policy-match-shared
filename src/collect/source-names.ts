/**
 * 회차(`SOURCES`)가 도는 **수집원 이름 목록** — 조립기(`buildSources`) 없이 이름만 필요한 곳이 쓴다.
 *
 * 왜 따로 뺐나: 수집원 현황판(`serve/sources-summary`)은 이름 목록만 있으면 되는데,
 * 이름을 얻자고 `buildSources(deps)` 를 부르면 **DB·AI·슬랙 주입(`CollectDeps`)이 필요**해진다.
 * 랩 앱은 그 주입을 만들 수 없다(수집을 안 한다) — 그래서 이름만 따로 만든다.
 *
 * ★순서는 ERP `services/policy-match/sync.ts` 의 `SOURCES` 와 **같아야 한다.**
 *   4개 공공API → 게시판(`buildSources`) → 상시 상품(`buildProductSources`) → 고용24(맨 뒤).
 *   `source-names.test.ts` 가 스텁 주입으로 만든 실제 목록과 대조해 이 순서를 지킨다.
 *
 * ★`clockOnly` 는 **거르지 않는다.** ERP 의 `SOURCES` 도 안 거른다 —
 *   거르는 곳은 수동 새로고침(`api/policy-match/sync`) 한 곳뿐이고, 현황판은 전부를 본다.
 *   (여기서 걸러 버리면 고용24·게시판·상품이 현황판에서 통째로 사라진다.)
 */
import { BOARD_SOURCES } from "./board/source-list";
import { boardProxyUrl } from "./board/proxy";
import { PRODUCT_SOURCES } from "./products/registry";

/** 공공 API 어댑터 — 조립 밖이라 앱이 직접 편다. `SOURCES` 맨 앞. */
export const API_SOURCE_NAMES = ["bizinfo", "bojo24", "kstartup", "msit"] as const;

/**
 * 고용24 — **반드시 맨 뒤.** 번호 716개를 순차 조회해 한 곳이 13분을 쓴다(2026-09-02 실측).
 * 앞에 두면 뒤의 게시판에 차례가 영영 안 온다.
 */
export const TAIL_SOURCE_NAMES = ["work24"] as const;

/**
 * 게시판 수집원 이름 — `boardSyncSources` 와 **같은 거르기**를 쓴다.
 * 국내 경유가 없으면 그 출처는 회차에서 아예 빠지므로 이름 목록에도 없어야 한다
 * (있으면 현황판이 「안 돌았는데 옛 오류가 붙은 줄」을 그린다).
 */
export function boardSourceNames(): string[] {
  const proxied = boardProxyUrl() !== null;
  return BOARD_SOURCES.filter((cfg) => proxied || !cfg.requiresProxy).map((cfg) => cfg.id);
}

/** 상시 상품(자금 조달 지도) 수집원 이름. */
export function productSourceNames(): string[] {
  return PRODUCT_SOURCES.map((s) => s.id);
}

/** 회차가 도는 수집원 이름 전부 — `SOURCES.map((s) => s.name)` 과 같다. */
export function collectSourceNames(): string[] {
  return [
    ...API_SOURCE_NAMES,
    ...boardSourceNames(),
    ...productSourceNames(),
    ...TAIL_SOURCE_NAMES,
  ];
}
