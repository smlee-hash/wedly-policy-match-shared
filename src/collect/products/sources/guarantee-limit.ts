/**
 * 보증 상품 표(서울신보·경기신보)의 한도 칸 → 숫자. **글에 처음 나오는 금액** 하나만 쓴다.
 *
 * 왜 공용 `extractAmount`(가장 큰 금액)를 안 쓰나: 이 표들은 대표 한도를 맨 앞에 쓰고 뒤에 조건부 금액을
 * 붙인다 — 「3천만원 이내(기보증금액 포함 5천만원 이내)」「1억원 이내 ※ 단, 업력 3개월 미만 최대 2천만원」
 * 「본 특례보증 5억원 이내 업체당 8억원 이하」. 가장 큰 값을 고르면 기보증 포함 총액을, 뒤에서 고르면 단서의
 * 좁은 상한을 이 상품 한도로 적게 된다(2026-09-24 실사이트 대조). 글자는 limitText 에 원문 그대로 남는다.
 */
import { wonOf } from "../../../funding/amount-rate-extract";

const FIRST_AMOUNT_RE = /[\d][\d,.]*\s*(?:억|천만|백만|만|천)(?:\s*[\d,.]+\s*(?:천만|백만|만|천))?\s*원/;

export function firstLimitWon(limitText: string): number | null {
  const m = limitText.match(FIRST_AMOUNT_RE);
  return m ? wonOf(m[0]) : null;
}
