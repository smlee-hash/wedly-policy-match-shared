// 자격 본문·제목·요약·기관에서 **자금 갈래·한도·금리 칸**을 뽑는다.
//
// ERP `services/policy-match/store.ts` 의 `fundingFieldsOf` 를 **글자 그대로** 옮긴 것이다
// (P3-B2, 2026-09-06). 저장(`store.upsertAnnouncements`)과 상세 채움(`detail-fill.fillBoardDetail`)이
// **같은 규칙**으로 갈래·한도·금리를 뽑아야, 같은 공고가 자리마다 다른 갈래로 갈리지 않는다.
// 판정에 필요한 부품(갈래 분류·금액/금리 추출)이 이미 이 보관함(`../funding/*`)에 있어 인자로 받지
// 않고 여기서 바로 부른다 — ERP `store.ts` 는 이 함수를 다시 내보내 쓴다(로컬 정의 제거).
import { classifyFundingGroup } from "../funding/funding-group";
import { extractAmount, extractRate } from "../funding/amount-rate-extract";

export type FundingFields = {
  fundingGroup: string;
  amountText: string;
  amountMaxWon: bigint | null;
  rateText: string;
  rateMin: number | null;
};

export function fundingFieldsOf(a: {
  title: string;
  summary: string;
  agency: string;
  targetText: string;
  wedlyCategory: string;
}): FundingFields {
  const moneySource = `${a.title}\n${a.summary}\n${a.targetText}`;
  const rate = extractRate(moneySource);
  const fundingGroup =
    classifyFundingGroup({
      title: a.title,
      summary: a.summary,
      agency: a.agency,
      wedlyCategory: a.wedlyCategory,
      rateText: rate.rateText,
    }) ?? "";
  const money = extractAmount(moneySource);
  return {
    fundingGroup,
    amountText: money.amountText,
    // Prisma BigInt 칸 — Number 로 넘기면 저장이 거부된다(응답에서는 Number 로 되돌린다).
    amountMaxWon: money.amountMaxWon === null ? null : BigInt(money.amountMaxWon),
    rateText: rate.rateText,
    rateMin: rate.rateMin,
  };
}
