/**
 * 상시 상품 수집의 공통 HTTP — **게시판 엔진을 그대로 빌린다**(설계 2026-09-03 §3).
 *
 * 왜 새로 안 만드나: 게시판 쪽 `fetchBoardText` 에는 허용 호스트 검문(SSRF)·시간 상한·본문 크기 상한·
 * 글자표(euc-kr)·쿠키 항아리·네트워크 오류 한 번 재시도·국내 경유가 이미 다 들어 있다. 여기서 따로
 * `fetch` 를 부르면 그 방어선이 상품 쪽만 빠진다 — 원천이 7곳이라 빠진 자리가 7배로 벌어진다.
 *
 * `BoardConfig` 의 `list` 칸은 상품 수집에 쓰이지 않지만 타입이 요구해 빈 껍데기를 채운다.
 */
import { fetchBoardText, fetchBoardTextWithCookies } from "../board/registry";
import type { BoardConfig, BoardFetchInit } from "../board/types";

export interface ProductFetchConfig {
  /** 수집원 id — 오류 메시지에 쓰인다(FinanceProduct.source 와 같은 값). */
  id: string;
  /** 허용 호스트의 기준. 이 호스트 밖 주소는 요청 자체를 안 한다. */
  baseUrl: string;
  /** baseUrl 말고도 열어 줄 호스트(소진공 ols.semas.or.kr 처럼 하위 도메인이 다를 때). */
  allowedHosts?: string[];
  charset?: "utf-8" | "euc-kr";
}

/** 게시판 설정 모양으로 감싼 껍데기 — 검문에 쓰이는 칸(baseUrl·allowedHosts·charset)만 뜻이 있다. */
function boardStubOf(cfg: ProductFetchConfig): BoardConfig {
  return {
    id: cfg.id,
    label: cfg.id,
    agency: "",
    region: "",
    baseUrl: cfg.baseUrl,
    allowedHosts: cfg.allowedHosts,
    charset: cfg.charset ?? "utf-8",
    list: { url: () => cfg.baseUrl, maxPages: 1, rowSelector: "", fields: { title: {}, detailUrl: {}, date: {} } },
  };
}

/** 한 주소를 받아 글로 돌려준다. init 으로 POST·헤더를 실을 수 있다(목록이 폼/JSON 통로인 원천). */
export function fetchProductText(
  cfg: ProductFetchConfig,
  url: string,
  init?: BoardFetchInit,
  limits?: { timeoutMs: number; maxBytes: number },
): Promise<string> {
  const stub = boardStubOf(cfg);
  return fetchBoardText(url, stub.charset, stub, init, limits);
}

/**
 * 응답 헤더까지 필요한 어댑터용(금감원 개인사업자대출) — 같은 검문·같은 상한을 지키되 쿠키를 돌려준다.
 *
 * 왜 따로 있나: `fetchBoardText` 의 쿠키 항아리는 **그 호출 안에서만** 살아서 밖에서 읽을 수 없다.
 * 금감원은 ① GET 으로 `WMONID` 를 받고 ② 같은 쿠키를 `Cookie` 헤더에 실어 POST 를 보내야 목록을 준다.
 * (`fetchBoardText` 는 본문을 다시 못 보내는 POST 리다이렉트를 막으므로 어댑터가 쿠키를 직접 들고 가야 한다.)
 */
export function fetchProductWithCookies(
  cfg: ProductFetchConfig,
  url: string,
  init?: BoardFetchInit,
  limits?: { timeoutMs: number; maxBytes: number },
): Promise<{ text: string; cookie: string }> {
  const stub = boardStubOf(cfg);
  return fetchBoardTextWithCookies(url, stub.charset, stub, init, limits);
}
