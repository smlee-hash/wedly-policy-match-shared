// 공고 분야(자유 한글)를 두 자료원 taxonomy로 잇는다. 키워드 우선순위: 위에서부터 먼저 맞는 것.
export type ConsultingDomain = "sojt" | "policy-fund" | "cert" | "patent" | "corp" | "hr" | "sales";
export type SectionKey = "tax-amendment" | "government-subsidy" | "labor-subsidy" | "cert" | "patent";

export interface SourceMapping { consultingDomain: ConsultingDomain; sectionKey: SectionKey; }

/**
 * 공고 분야 → 우리 자료실 분야.
 *
 * ★**기업마당이 실제로 쓰는 분야 이름을 먼저 맞춘다**(2026-08-25 실측으로 고침).
 * 예전 규칙은 「고용·인건비·인증·특허」 같은 낱말을 찾았는데, 기업마당 공고 분야는
 * **경영·기술·수출·금융·인력·내수·창업·기타 여덟 가지뿐**이라 **한 건도 안 걸렸다.**
 * 그래서 공고 1,521건이 전부 기본값(policy-fund) 한 칸만 뒤졌고, 자료실의 나머지
 * 1,171건(바우처·인력·환급·훈련·인증 등)은 통째로 사장돼 있었다.
 *
 * 아래 규칙은 **기업마당 여덟 분야를 먼저** 놓고, 그 밖의 출처가 늘 때를 대비해
 * 옛 낱말 규칙을 뒤에 남겨 둔다(순서가 곧 우선순위다).
 */
const RULES: { re: RegExp; map: SourceMapping }[] = [
  // ── 기업마당 여덟 분야 (지금 공고의 100%) ──────────────────────
  { re: /^인력$/, map: { consultingDomain: "hr", sectionKey: "labor-subsidy" } },
  { re: /^기술$/, map: { consultingDomain: "cert", sectionKey: "cert" } },
  // 경영·금융·수출·내수·창업·기타는 자금·지원사업 성격이라 기본값이 맞다(아래에서 처리).

  // ── 그 밖의 출처가 늘 때를 위한 낱말 규칙 ─────────────────────
  { re: /인증|벤처확인|이노비즈|메인비즈|기업부설연구소/, map: { consultingDomain: "cert", sectionKey: "cert" } },
  { re: /특허|지식재산|상표|디자인권|실용신안/, map: { consultingDomain: "patent", sectionKey: "patent" } },
  { re: /고용|채용|인건비|일자리|장려금|근로|직업능력|훈련/, map: { consultingDomain: "hr", sectionKey: "labor-subsidy" } },
  { re: /경정청구|환급|세액공제/, map: { consultingDomain: "policy-fund", sectionKey: "tax-amendment" } },
];
const DEFAULT_MAP: SourceMapping = { consultingDomain: "policy-fund", sectionKey: "government-subsidy" };

export function mapCategoryToSources(category: string | null | undefined): SourceMapping {
  const c = (category ?? "").trim();
  for (const { re, map } of RULES) if (re.test(c)) return map;
  return DEFAULT_MAP; // 자금·융자·정책자금·무상지원금 등 대다수가 여기
}
