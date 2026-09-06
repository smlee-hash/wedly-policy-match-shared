/**
 * TIPS(민간투자주도형 기술창업지원) — 상시 상품 수집기(설계 2026-09-03, 계획서 Task 13-b).
 * 페이지가 정적 HTML 문장으로 지원 내용·대상을 그대로 내려준다 — 표도 API 도 아닌 자유 문장 두 개뿐
 * (2026-09-03 10:21 실측 고정본 `__fixtures__/tips-about.html`).
 *
 * ★대출이 아니라 「지분 투자」다 — 그래서 다른 원천과 다르게 rateText/rateMin 을 본문에서 뽑지 않고
 * 고정값("지분 투자"/null)으로 둔다. 한도는 대출 한도처럼 "가장 큰 값 하나"가 아니라, 문장이 말하는
 * 투자·R&D·추가투자 **세 값을 더한 합계**다 — 사람이 실제로 받을 수 있는 총액이 그 합계이기
 * 때문이다(1+5+2=8억).
 * ★괄호 안 「창업자금 1억원, 해외마케팅 1억원」은 별개 항목이 아니라 **앞의 「추가투자 최대 2억원」의
 * 내역**(사용처 세부)이다 — 계획서 §Task13-b 가 다섯 값을 전부 더해 10억(1+5+2+1+1)으로 확정했던
 * 것은 이 내역을 다시 세는 이중 계산이었다(2026-09-03 코덱스 리뷰 지적으로 정정, F3). limitText 도
 * 괄호 안 값을 숫자 없이 항목 이름만 적어 "다시 더할 값"처럼 보이지 않게 한다.
 *
 * ★TIPS 는 「운영사 추천」·「기술 기반 창업」처럼 절대·상대 수치가 아니라 기계로 못 재는 필수조건도
 * 있다 — 지어낸 숫자로 흉내내지 않고 targetRules.humanCheck 원문으로 남겨 사람이 확인하게 한다(F3).
 *
 * 문장 두 개(지원 금액·지원 대상)를 못 찾으면 값을 지어내지 않고 던진다 — 페이지 개편의 신호다.
 *
 * ★fetchTipsAll 은 공용 fetchProductText(게시판 엔진)를 안 쓴다(2026-09-03 실사이트 실측으로 원인 확정).
 * 왜 공용 엔진을 안 쓰는가 — jointips.or.kr 의 응답 헤더(Content-Security-Policy)가 CRLF 폴딩 없이
 * 순수 개행(\n)만으로 여러 줄에 접혀 있다(옛날식 헤더 폴딩). undici(Node 기본 fetch)의 엄격한 파서는
 * 이를 "Missing expected CR after header value" 로 거부한다(curl -D 로 헤더 구조 확인 완료). 그래서
 * **이 파일 안에서만** core `https` 모듈에 insecureHTTPParser: true 를 준 내부 함수 fetchTipsHtml 로
 * 우회한다 — 공용 `fetch.ts`·`board/registry.ts`·`board/proxy.ts` 는 그대로 두고, 다른 26곳 원천은
 * 영향 없다. 요청 주소는 SSRF 표면이 없다 — TIPS_DETAIL_URL 코드 상수 하나뿐이고 사용자 입력을 받지
 * 않는다. 그래도 리다이렉트는 같은 호스트(www.jointips.or.kr)만 최대 3홉 따라가고, 다른 호스트로
 * 튀면 던진다(허용 호스트 검문 대체).
 */
import { get as httpsGet } from "node:https";
import { parse } from "node-html-parser";
import { wonOf } from "../../amount-rate-extract";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(2026-09-03 자금 조달 지도 공통 계약). */
const SOURCE_ID = "product-tips";
export const TIPS_DETAIL_URL = "https://www.jointips.or.kr/about.php";
const APPLY_URL = "https://www.jointips.or.kr/";
const NAME = "TIPS (민간투자주도형 기술창업지원)";
const INSTITUTION = "창업진흥원·TIPS 운영사";

/** fetchTipsHtml 이 요청을 내보내는 유일한 호스트 — TIPS_DETAIL_URL·APPLY_URL 과 같은 도메인. */
const TIPS_HOST = "www.jointips.or.kr";
/** board/registry.ts 의 FETCH_UA 와 같은 문자열이다(그 파일은 고치지 않고 값만 그대로 복사해 둔다). */
const TIPS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIPS_FETCH_TIMEOUT_MS = 30_000;
const TIPS_MAX_BODY_BYTES = 2_000_000;

/**
 * 「중소기업창업 지원법」 제2조의 창업기업 정의(설립 후 7년 이내)를 그대로 쓴다 — 이 상수는 본문에서
 * 뽑는 게 아니라 법령상 고정값이다(sbiz.ts 의 TARGET_RULES 와 같은 방식: 조건이 본문에 숫자로 없을 때는
 * 도메인 지식을 상수로 못박고 targetText 원문으로 사람이 다시 확인할 수 있게 한다).
 * ★「TIPS 운영사로부터 투자(확약) 및 추천을 받은」·「기술 기반 창업」은 절대·상대 수치가 아니라 기계로
 * 못 재는 필수조건이다 — 지어낸 숫자로 대신하지 않고 humanCheck 원문 두 항목으로 남긴다(F3, 2026-09-03
 * 코덱스 리뷰: 비구조 필수조건이 통째로 사라지고 있었다).
 */
const TARGET_RULES: ProductTargetRules = {
  bizAgeMaxYears: 7,
  humanCheck: ["TIPS 운영사의 투자·추천 필요", "기술 기반 창업"],
};

/** "대학 및 연구기관 등과의 컨소시엄을 통해 … 창업팀당 최장 3년간 투자 1억원, R&D 5억원 및 추가투자 최대 2억원을 지원합니다. (창업자금 1억원, 해외마케팅 1억원)" */
const AMOUNT_SENTENCE_RE =
  /최장\s*(\d+)년간\s*투자\s*([\d.]+)억원,\s*R&D\s*([\d.]+)억원\s*및\s*추가투자\s*최대\s*([\d.]+)억원을\s*지원합니다\.\s*\(창업자금\s*([\d.]+)억원,\s*해외마케팅\s*([\d.]+)억원\)/;

/** FAQ "팁스 지원대상은 어떻게 되나요?" 답변의 첫 문장. */
const TARGET_SENTENCE_RE =
  /「중소기업창업\s*지원법」\s*제2조에\s*따른\s*창업기업\s*또는\s*예비창업자로,\s*팁스\s*운영사로부터\s*투자\(확약\)\s*및\s*추천을\s*받은\s*창업기업을\s*지원하고\s*있습니다\./;

/** sourceId = 상품명 정규화(공백·괄호 제거) — sbiz.ts 와 같은 규칙. */
function sourceIdOf(name: string): string {
  return name.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

function wonOfOrZero(amountText: string): number {
  return wonOf(amountText) ?? 0;
}

/** 정적 페이지 하나에서 TIPS 상품 1건을 만든다. 두 문장 중 하나라도 못 찾으면 던진다(값을 지어내지 않는다). */
export function parseTips(html: string): NormalizedProduct[] {
  const root = parse(html);
  const text = root.text.replace(/\s+/g, " ");

  const amountMatch = text.match(AMOUNT_SENTENCE_RE);
  if (!amountMatch) {
    throw new Error("TIPS 지원 금액 문장을 찾지 못했다 — 페이지 개편으로 보고 값을 지어내지 않는다");
  }
  const targetMatch = text.match(TARGET_SENTENCE_RE);
  if (!targetMatch) {
    throw new Error("TIPS 지원 대상 문장을 찾지 못했다 — 페이지 개편으로 보고 값을 지어내지 않는다");
  }

  // 괄호(창업자금·해외마케팅)는 앞의 "추가투자 최대 N억원"의 내역이다 — 별개 항목이 아니라서
  // 정규식은 문장 구조 검증을 위해 계속 캡처하지만(사이트 개편 감지), 한도 합계·문구에는 세 값만 쓴다.
  const [, years, invest, rnd, extra] = amountMatch;
  const limitText = `투자 ${invest}억원 + R&D ${rnd}억원 + 추가투자 최대 ${extra}억원(창업자금·해외마케팅)`;
  const limitMaxWon = wonOfOrZero(`${invest}억원`) + wonOfOrZero(`${rnd}억원`) + wonOfOrZero(`${extra}억원`);

  const product: NormalizedProduct = {
    source: SOURCE_ID,
    sourceId: sourceIdOf(NAME),
    fundingGroup: "invest",
    institution: INSTITUTION,
    institutionType: "invest",
    name: NAME,
    productType: "equity",
    targetText: targetMatch[0],
    targetRules: TARGET_RULES,
    limitText,
    limitMaxWon,
    rateText: "지분 투자",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: `최장 ${years}년`,
    channel: "TIPS 운영사 추천",
    applyUrl: APPLY_URL,
    detailUrl: TIPS_DETAIL_URL,
    deadlineText: "운영사 추천 상시",
    raw: { 지원내용문장: amountMatch[0], 지원대상문장: targetMatch[0] },
  };

  return [product];
}

/**
 * jointips.or.kr 전용 fetch — 왜 공용 엔진을 안 쓰는지는 파일 맨 위 설명 참고.
 * 지금은 항상 TIPS_DETAIL_URL(코드 상수)만 넘어오지만, 리다이렉트를 포함해 매 요청마다
 * 호스트를 다시 확인해 www.jointips.or.kr 밖으로는 절대 나가지 않는다.
 */
function fetchTipsHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let hop = 0;

    const requestOnce = (currentUrl: string): void => {
      let host = "";
      try {
        host = new URL(currentUrl).hostname;
      } catch {
        reject(new Error(`TIPS: 요청 주소가 올바르지 않다 — ${currentUrl}`));
        return;
      }
      if (host !== TIPS_HOST) {
        reject(new Error(`TIPS: 허용되지 않은 호스트 — ${host}`));
        return;
      }

      const req = httpsGet(
        currentUrl,
        {
          headers: { "User-Agent": TIPS_UA, "Accept-Language": "ko" },
          timeout: TIPS_FETCH_TIMEOUT_MS,
          // CSP 헤더 폴딩(옛날식, CRLF 없이 개행만) 우회 — undici(fetch)엔 없는 core http(s) 전용 옵션.
          insecureHTTPParser: true,
        },
        (res) => {
          const status = res.statusCode ?? 0;

          if (status >= 300 && status < 400) {
            const location = res.headers.location;
            res.resume();
            if (!location) {
              reject(new Error("TIPS: 리다이렉트 Location 없음"));
              return;
            }
            if (hop >= 3) {
              reject(new Error("TIPS: 리다이렉트 3홉 초과"));
              return;
            }
            hop += 1;
            let next: string;
            try {
              next = new URL(location, currentUrl).toString();
            } catch {
              reject(new Error(`TIPS: 리다이렉트 주소가 올바르지 않다 — ${location}`));
              return;
            }
            requestOnce(next);
            return;
          }

          if (status !== 200) {
            res.resume();
            reject(new Error(`TIPS: HTTP ${status}`));
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > TIPS_MAX_BODY_BYTES) {
              res.destroy();
              reject(new Error(`TIPS: 본문 ${Math.round(TIPS_MAX_BODY_BYTES / 1_000_000)}MB 초과`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            if (total > TIPS_MAX_BODY_BYTES) return; // 이미 위(data 핸들러)에서 던졌다
            resolve(Buffer.concat(chunks).toString("utf-8"));
          });
          res.on("error", reject);
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error("TIPS: 요청 시간 초과"));
      });
      req.on("error", reject);
    };

    requestOnce(url);
  });
}

/** 정적 페이지를 받아 1건을 만든다. 문장을 못 찾으면 parseTips 가 던진다(빈 껍데기 방어). */
export async function fetchTipsAll(): Promise<NormalizedProduct[]> {
  const html = await fetchTipsHtml(TIPS_DETAIL_URL);
  return parseTips(html);
}

export const tipsSource: ProductSource = {
  id: SOURCE_ID,
  label: "TIPS(민간투자주도형 기술창업지원)",
  url: TIPS_DETAIL_URL,
  fetchAll: fetchTipsAll,
};
